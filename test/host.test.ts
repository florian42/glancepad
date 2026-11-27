// The host, driven against a fake transport: it must emit the exact
// 64-byte reports for a lighting change, with no simulator involved.

import { describe, expect, it } from "vitest";
import { createHost } from "../src/device/host.js";
import type { DeviceTransport } from "../src/device/transport.js";
import {
  feedRpcLine,
  initialRpcAccumulator,
  MAX_FRAGMENT,
  SEND_COOLDOWN_MS,
} from "../src/protocol/index.js";
import { payloadOf, rawReport, toHex } from "./helpers.js";

/** Records every report the host sends. Delivers nothing back. */
class FakeTransport implements DeviceTransport {
  readonly sent: Uint8Array[] = [];
  readonly sentAt: number[] = [];
  connected = true;
  /** Sends to reject, counted from the next send. Zero rejects none. */
  failAtSend = 0;
  /** The device is absent: each send rejects and takes nothing. */
  refuse = false;
  /** The time of the last send that `failAtSend` rejected. */
  failedAt = 0;
  #connect: (() => void) | undefined;

  async send(report: Uint8Array): Promise<void> {
    if (this.refuse) throw new Error("DEVICE_DISCONNECTED");
    if (this.failAtSend > 0 && --this.failAtSend === 0) {
      this.failedAt = Date.now();
      throw new Error("WRITE_FAILED");
    }
    this.sentAt.push(Date.now());
    this.sent.push(Uint8Array.from(report));
  }

  onReport(): () => void {
    return () => {};
  }

  onConnect(cb: () => void): () => void {
    this.#connect = cb;
    return () => {
      this.#connect = undefined;
    };
  }

  /** The device connects, for the first time or again. */
  connect(): void {
    this.#connect?.();
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

/**
 * Reads reports the way the device does: it joins the fragments and
 * takes a message each time the text parses. Returns the methods of
 * the complete messages. A fragment that follows a partial message
 * never parses, so a missing method here means a bad boundary.
 */
const methodsIn = (reports: readonly Uint8Array[]): string[] => {
  const methods: string[] = [];
  let state = initialRpcAccumulator;
  for (const report of reports) {
    const text = new TextDecoder().decode(payloadOf(report));
    const [next, result] = feedRpcLine(state, text);
    state = next;
    if (result?.ok && result.message.kind === "request") {
      methods.push(result.message.method);
    }
  }
  return methods;
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

  it("sends both lighting calls in full after a send fails mid-message", async () => {
    const transport = new FakeTransport();
    const QUIET_MS = 120;
    const host = createHost(transport, {
      sendCooldownMs: 0,
      resyncQuietMs: QUIET_MS,
    });
    const silenced = console.error;
    console.error = () => {};
    try {
      // The second report of the first message fails.
      transport.failAtSend = 2;
      await host.setSlot(0, { status: "working" });
    } finally {
      console.error = silenced;
    }
    expect(transport.sent).toHaveLength(1);

    transport.sent.length = 0;
    transport.sentAt.length = 0;
    await host.setSlot(1, { status: "error" });
    // The keypad drops the part after a silence. The host waits for it.
    // The silence starts at the failed send, so measure from there: a
    // later clock reading in the test makes the wait look too short.
    expect(
      (transport.sentAt[0] ?? 0) - transport.failedAt,
    ).toBeGreaterThanOrEqual(QUIET_MS - 5);
    // The first report starts a message. Both calls arrive, although
    // the second change alone would alter one of them at most.
    expect(methodsIn(transport.sent)).toEqual([
      "v.oai.thstatus",
      "v.oai.rgbcfg",
    ]);
    host.close();
  });

  it("does not wait after a send that an absent device refused", async () => {
    const transport = new FakeTransport();
    const host = createHost(transport, {
      sendCooldownMs: 0,
      resyncQuietMs: 60_000,
    });
    transport.connected = false;
    transport.refuse = true;
    await host.setSlot(0, { status: "working" });
    transport.connected = true;
    transport.refuse = false;
    transport.connect();
    await host.setBrightness(1);
    expect(methodsIn(transport.sent)).toEqual([
      "v.oai.thstatus",
      "v.oai.rgbcfg",
    ]);
    host.close();
  });

  it("sends the full lighting when the device connects", async () => {
    const transport = new FakeTransport();
    const host = createHost(transport, { sendCooldownMs: 0 });
    await host.setSlot(0, { status: "working" });
    transport.sent.length = 0;

    transport.connect();
    await host.setBrightness(1);
    expect(methodsIn(transport.sent)).toEqual([
      "v.oai.thstatus",
      "v.oai.rgbcfg",
    ]);
    host.close();
  });
});
