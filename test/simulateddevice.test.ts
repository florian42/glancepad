// The simulated device, exercised through the transport seam: real
// framed 64-byte reports in, real framed reports out (ADR-0001).

import { describe, expect, it } from "vitest";
import {
  CHANNEL_RPC,
  encodeFrames,
  encodeRequest,
  METHOD_LIGHTING_CONFIG,
  METHOD_THREADS_LIGHTING,
  NOTIFY_KEYS,
  parseMessage,
  REPORT_SIZE,
  type RpcMessage,
} from "../src/protocol/index.js";
import { type FrameEvent, SimulatedDevice } from "../src/simulator/index.js";
import { feedAll, lines } from "./helpers.js";

/** Frames one host-to-device RPC text and sends every report. */
async function sendRpc(device: SimulatedDevice, text: string): Promise<void> {
  for (const report of encodeFrames(CHANNEL_RPC, text)) {
    await device.send(report);
  }
}

/** Collects device-to-host reports and decodes them into RPC messages. */
function collect(device: SimulatedDevice): {
  reports: Uint8Array[];
  messages: () => RpcMessage[];
} {
  const reports: Uint8Array[] = [];
  device.onReport((report) => reports.push(report));
  return {
    reports,
    messages: () => {
      const [, events] = feedAll(reports);
      return lines(events).flatMap((event) => {
        const parsed = parseMessage(event.text);
        return parsed.ok ? [parsed.message] : [];
      });
    },
  };
}

const threadsRequest = (id: number) =>
  encodeRequest(id, METHOD_THREADS_LIGHTING, [
    { id: 0, c: 0x304ffe, b: 1, e: 4, s: 0.4, sk: 0, sa: 0 },
  ]);

describe("lighting calls through the byte path", () => {
  it("applies a threads-lighting request and answers {result: true}", async () => {
    const device = new SimulatedDevice();
    const out = collect(device);
    await sendRpc(device, threadsRequest(7));

    expect(device.lighting.slots[0]).toEqual({
      effect: 4,
      color: 0x304ffe,
      brightness: 1,
      speed: 0.4,
    });
    expect(out.messages()).toEqual([
      { kind: "response", id: 7, result: true, error: undefined },
    ]);
  });

  it("reassembles a request that spans several reports", async () => {
    const device = new SimulatedDevice();
    const entries = Array.from({ length: 6 }, (_, id) => ({
      id,
      c: 0x00ff4c,
      b: 0.5,
      e: 1,
      s: 0,
      sk: 0,
      sa: 0,
    }));
    const text = encodeRequest(3, METHOD_THREADS_LIGHTING, entries);
    expect(encodeFrames(CHANNEL_RPC, text).length).toBeGreaterThan(1);

    await sendRpc(device, text);
    for (const slot of device.lighting.slots) {
      expect(slot.color).toBe(0x00ff4c);
    }
  });

  it("applies a lighting-config request to both zones", async () => {
    const device = new SimulatedDevice();
    await sendRpc(
      device,
      encodeRequest(4, METHOD_LIGHTING_CONFIG, {
        ambient: { e: 2, b: 1, s: 0.4, m: 0, c: 0x304ffe },
        keys: { e: 1, b: 1, s: 0, m: 0, c: 0x304ffe },
      }),
    );
    expect(device.lighting.ambient.effect).toBe(2);
    expect(device.lighting.keys.effect).toBe(1);
  });

  it("notifies lighting subscribers on every applied call", async () => {
    const device = new SimulatedDevice();
    let seen = 0;
    device.onLighting(() => {
      seen += 1;
    });
    await sendRpc(device, threadsRequest(1));
    expect(seen).toBe(1);
  });
});

describe("request handling at the edges", () => {
  it("answers an unknown method with a method-not-found error", async () => {
    const device = new SimulatedDevice();
    const out = collect(device);
    await sendRpc(device, encodeRequest(9, "v.oai.nosuch", null));
    const [message] = out.messages();
    expect(message).toMatchObject({
      kind: "response",
      id: 9,
      error: { code: -32601 },
    });
  });

  it("answers invalid params with an error and keeps the model", async () => {
    const device = new SimulatedDevice();
    const out = collect(device);
    await sendRpc(
      device,
      encodeRequest(2, METHOD_THREADS_LIGHTING, { threads: [] }),
    );
    expect(out.messages()).toEqual([
      {
        kind: "response",
        id: 2,
        result: undefined,
        error: { code: -32602, message: "invalid params" },
      },
    ]);
    expect(device.lighting.slots[0]?.color).toBe(0);
  });

  it("drops a request with an id the firmware would reject", async () => {
    const device = new SimulatedDevice();
    const events: FrameEvent[] = [];
    device.onFrame((event) => events.push(event));
    const out = collect(device);
    // encodeRequest refuses invalid ids, so build the text by hand.
    await sendRpc(device, '{"method":"v.oai.thstatus","params":[],"id":999}');
    expect(out.reports).toHaveLength(0);
    expect(events.at(-1)?.decoded).toHaveLength(1);
  });

  it("ignores notifications and responses from the host", async () => {
    const device = new SimulatedDevice();
    const out = collect(device);
    await sendRpc(device, '{"method":"v.oai.thstatus","params":[]}');
    await sendRpc(device, '{"result":true,"id":1}');
    expect(out.reports).toHaveLength(0);
  });
});

describe("key events", () => {
  it("emits press then release as framed v.oai.hid notifications", () => {
    const device = new SimulatedDevice();
    const out = collect(device);
    device.pressKey("AG02");
    device.releaseKey("AG02");
    expect(out.messages()).toEqual([
      {
        kind: "notification",
        method: NOTIFY_KEYS,
        params: { key: "AG02", act: 1 },
      },
      {
        kind: "notification",
        method: NOTIFY_KEYS,
        params: { key: "AG02", act: 0 },
      },
    ]);
  });

  it("emits command-key events too", () => {
    const device = new SimulatedDevice();
    const out = collect(device);
    device.pressKey("ACT10_ACT11");
    expect(out.messages()).toMatchObject([
      { params: { key: "ACT10_ACT11", act: 1 } },
    ]);
  });
});

describe("the frame log feed", () => {
  it("labels directions and attaches decoded text to the completing report", async () => {
    const device = new SimulatedDevice();
    const events: FrameEvent[] = [];
    device.onFrame((event) => events.push(event));

    const text = threadsRequest(5);
    await sendRpc(device, text);

    const incoming = events.filter((e) => e.direction === "host-to-device");
    const outgoing = events.filter((e) => e.direction === "device-to-host");
    expect(incoming.length).toBe(encodeFrames(CHANNEL_RPC, text).length);
    for (const event of incoming.slice(0, -1)) {
      expect(event.decoded).toEqual([]);
    }
    expect(incoming.at(-1)?.decoded).toEqual([text]);
    expect(outgoing.at(-1)?.decoded).toEqual(['{"result":true,"id":5}']);
    expect(events[0]?.direction).toBe("host-to-device");
    for (const event of events) {
      expect(event.report).toHaveLength(REPORT_SIZE);
    }
  });

  it("notes a malformed report instead of throwing", async () => {
    const device = new SimulatedDevice();
    const events: FrameEvent[] = [];
    device.onFrame((event) => events.push(event));
    const bad = new Uint8Array(REPORT_SIZE);
    bad[0] = 6;
    bad[1] = 9;
    await device.send(bad);
    expect(events[0]?.note).toMatch(/bad-channel/);
  });
});

describe("transport contract", () => {
  it("rejects a report that is not exactly 64 bytes", async () => {
    const device = new SimulatedDevice();
    await expect(device.send(new Uint8Array(63))).rejects.toThrow(TypeError);
  });

  it("disconnects on close", async () => {
    const device = new SimulatedDevice();
    expect(device.connected).toBe(true);
    await device.close();
    expect(device.connected).toBe(false);
    await expect(device.send(new Uint8Array(64))).rejects.toThrow();
  });

  it("stops calling an unsubscribed report listener", () => {
    const device = new SimulatedDevice();
    const seen: Uint8Array[] = [];
    const unsubscribe = device.onReport((report) => seen.push(report));
    device.pressKey("AG00");
    const count = seen.length;
    unsubscribe();
    device.pressKey("AG00");
    expect(seen.length).toBe(count);
  });
});
