// The host, driven against a fake transport: it must emit the exact
// 64-byte reports for a lighting change, with no simulator involved.

import { describe, expect, it } from "vitest";
import { createHost } from "../src/device/host.js";
import type { DeviceTransport } from "../src/device/transport.js";
import { MAX_FRAGMENT, SEND_COOLDOWN_MS } from "../src/protocol/index.js";
import { rawReport, toHex } from "./helpers.js";

/** Records every report the host sends. Delivers nothing back. */
class FakeTransport implements DeviceTransport {
  readonly sent: Uint8Array[] = [];
  readonly sentAt: number[] = [];
  connected = true;

  async send(report: Uint8Array): Promise<void> {
    this.sentAt.push(Date.now());
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
    const sent = transport.sent.map(toHex);
    // The zone config is still off, so that call sends no frames.
    expect(sent).toEqual(expectedReports(threads));
    // Pin the header bytes once: report id 6, RPC channel 2, and a
    // full 61-byte fragment.
    expect(sent[0]?.slice(0, 6)).toBe("06023d");
    expect(transport.sent.every((report) => report.length === 64)).toBe(true);
    host.close();
  });

  it("sends no frames when the derived payload is unchanged", async () => {
    const transport = new FakeTransport();
    const host = createHost(transport);
    const unread = {
      status: "unread" as const,
      selected: false,
      pulsing: false,
    };
    const off = { status: "off" as const, selected: false, pulsing: false };
    await host.replaceSlots([unread, off, off, off, off, off]);

    const threads =
      `{"method":"v.oai.thstatus","params":[` +
      `{"id":0,"c":65356,"b":1,"e":1,"s":0,"sk":0,"sa":0},` +
      [1, 2, 3, 4, 5].map(OFF_SLOT).join(",") +
      `],"id":0}`;
    const sent = expectedReports(threads);
    expect(transport.sent.map(toHex)).toEqual(sent);

    await host.replaceSlots([unread, off, off, off, off, off]);
    await host.setSlot(0, { status: "unread" });
    expect(transport.sent.map(toHex)).toEqual(sent);
    expect(host.driver.slots[0]?.status).toBe("unread");
    host.close();
  });

  it("waits SEND_COOLDOWN_MS between reports", async () => {
    const transport = new FakeTransport();
    const host = createHost(transport);
    await host.setSlot(0, { status: "working" });
    expect(transport.sentAt.length).toBeGreaterThan(1);
    for (let index = 1; index < transport.sentAt.length; index++) {
      const gap =
        (transport.sentAt[index] ?? 0) - (transport.sentAt[index - 1] ?? 0);
      expect(gap).toBeGreaterThanOrEqual(SEND_COOLDOWN_MS);
    }
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
