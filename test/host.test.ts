// The host, driven against a fake transport: it must emit the exact
// 64-byte reports for a lighting change, with no simulator involved.

import { describe, expect, it } from "vitest";
import { createHost } from "../src/device/host.js";
import type { DeviceTransport } from "../src/device/transport.js";
import { MAX_FRAGMENT } from "../src/protocol/index.js";
import { rawReport, toHex } from "./helpers.js";

/** Records every report the host sends. Delivers nothing back. */
class FakeTransport implements DeviceTransport {
  readonly sent: Uint8Array[] = [];
  connected = true;

  async send(report: Uint8Array): Promise<void> {
    this.sent.push(Uint8Array.from(report));
  }

  onReport(): () => void {
    return () => {};
  }

  async close(): Promise<void> {
    this.connected = false;
  }
}

/**
 * Splits ASCII wire text into RPC-channel reports by hand, so the
 * expectation does not reuse the encoder under test.
 */
const expectedReports = (text: string): string[] => {
  const reports: string[] = [];
  for (let offset = 0; offset < text.length; offset += MAX_FRAGMENT) {
    const fragment = text.slice(offset, offset + MAX_FRAGMENT);
    reports.push(toHex(rawReport(2, fragment)));
  }
  return reports;
};

const OFF_SLOT = (id: number) =>
  `{"id":${id},"c":0,"b":0,"e":0,"s":0,"sk":0,"sa":0}`;
const OFF_ZONE = `{"e":0,"b":0,"s":0,"m":0,"c":0}`;

describe("host", () => {
  it("sends the exact reports for one status change", async () => {
    const transport = new FakeTransport();
    const host = createHost(transport);

    await host.setSlot(0, { status: "working" });

    const threads =
      `{"method":"v.oai.thstatus","params":[` +
      `{"id":0,"c":3166206,"b":1,"e":1,"s":0,"sk":0,"sa":0},` +
      [1, 2, 3, 4, 5].map(OFF_SLOT).join(",") +
      `],"id":0}`;
    const config =
      `{"method":"v.oai.rgbcfg","params":` +
      `{"ambient":${OFF_ZONE},"keys":${OFF_ZONE}},"id":1}`;
    const sent = transport.sent.map(toHex);
    expect(sent).toEqual([
      ...expectedReports(threads),
      ...expectedReports(config),
    ]);
    // Pin the header bytes once: report id 6, RPC channel 2, and a
    // full 61-byte fragment.
    expect(sent[0]?.slice(0, 6)).toBe("06023d");
    expect(transport.sent.every((report) => report.length === 64)).toBe(true);
    host.close();
  });

  it("ignores a slot index outside the six agent keys", async () => {
    const transport = new FakeTransport();
    const host = createHost(transport);
    await host.setSlot(6, { status: "working" });
    expect(transport.sent).toEqual([]);
    host.close();
  });
});
