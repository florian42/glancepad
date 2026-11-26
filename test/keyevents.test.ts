// The key feed against lines a physical keypad sent (docs/protocol.md
// §11), and against the simulated device.

import { describe, expect, it } from "vitest";
import { type KeyEvent, onKeyEvent } from "../src/device/keyevents.js";
import { CHANNEL_RPC } from "../src/protocol/index.js";
import { SimulatedDevice } from "../src/simulator/index.js";
import { rawReport } from "./helpers.js";

describe("key feed", () => {
  it("reads the lines a keypad sends: compact members, CR LF", () => {
    const device = new SimulatedDevice();
    let deliver: (report: Uint8Array) => void = () => {};
    const events: KeyEvent[] = [];
    onKeyEvent(
      {
        ...device,
        connected: true,
        send: async () => {},
        close: async () => {},
        onConnect: () => () => {},
        onReport: (cb) => {
          deliver = cb;
          return () => {};
        },
      },
      (event) => events.push(event),
    );
    for (const line of [
      '{"m":"v.oai.hid","p":{"k":"AG00","act":1}}\r\n',
      '{"m":"v.oai.hid","p":{"k":"AG00","act":0}}\r\n',
      '{"m":"v.oai.rad","p":{"a":0.161292,"d":0.02128}}\r\n',
      '{"m":"v.oai.hid","p":{"k":"ENC_CW","act":2}}\r\n',
      '{"result":{"ok":1},"id":100,"method":"v.oai.thstatus"}\r\n',
      '{"m":"v.oai.hid","p":{"k":"ENC_CLK","act":1}}\r\n',
    ]) {
      deliver(rawReport(CHANNEL_RPC, line));
    }
    expect(events).toEqual([
      { key: "AG00", act: 1 },
      { key: "AG00", act: 0 },
      { key: "ENC_CW", act: 2 },
      { key: "ENC_CLK", act: 1 },
    ]);
  });

  it("still reads the simulated device", () => {
    const device = new SimulatedDevice();
    const events: KeyEvent[] = [];
    onKeyEvent(device, (event) => events.push(event));
    device.pressKey("AG03");
    expect(events).toEqual([{ key: "AG03", act: 1 }]);
  });
});
