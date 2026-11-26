// The HID transport against a fake backend: reports written, reports
// delivered, and what happens when the keypad leaves and returns. No
// test opens a real device.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type HidBackend,
  type HidHandle,
  type HidStatus,
  HidTransport,
} from "../src/device/hidtransport.js";
import { createHost } from "../src/device/host.js";
import { teeTransport } from "../src/device/tee.js";
import {
  CHANNEL_RPC,
  encodeFrames,
  feedRpcLine,
  initialRpcAccumulator,
} from "../src/protocol/index.js";
import { SimulatedDevice } from "../src/simulator/index.js";
import { payloadOf, rawReport } from "./helpers.js";

class FakeHandle implements HidHandle {
  readonly written: Uint8Array[] = [];
  readonly incoming: Uint8Array[] = [];
  closed = false;
  /** The device left: each later read and write fails. */
  gone = false;
  /** Writes to reject, counted from the next write. */
  failAtWrite = 0;

  read(): Uint8Array | undefined {
    if (this.gone) throw new Error("ENODEV");
    return this.incoming.shift();
  }

  async write(report: Uint8Array): Promise<void> {
    if (this.gone) throw new Error("ENODEV");
    if (this.failAtWrite > 0 && --this.failAtWrite === 0) {
      throw new Error("EPIPE");
    }
    this.written.push(Uint8Array.from(report));
  }

  close(): void {
    this.closed = true;
  }
}

/** A keypad that tests plug in, unplug, and lock. */
class FakeBackend implements HidBackend {
  present: FakeHandle | undefined;
  openError: Error | undefined;
  opens = 0;

  open(): HidHandle | undefined {
    this.opens++;
    if (this.openError) throw this.openError;
    return this.present;
  }

  plugIn(): FakeHandle {
    this.present = new FakeHandle();
    return this.present;
  }
}

const REPORT = rawReport(CHANNEL_RPC, '{"method":"x","params":null,"id":1}');
const POLL_MS = 10;
const RETRY_MS = 1000;

const start = (backend: FakeBackend) => {
  const transport = new HidTransport(backend, {
    pollMs: POLL_MS,
    retryMs: RETRY_MS,
  });
  const statuses: HidStatus[] = [];
  const connects: number[] = [];
  transport.onStatus((status) => statuses.push(status));
  transport.onConnect(() => connects.push(Date.now()));
  return { transport, statuses, connects };
};

describe("HID transport", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("opens the keypad and writes each report unchanged", async () => {
    const backend = new FakeBackend();
    const handle = backend.plugIn();
    const { transport, connects } = start(backend);
    expect(transport.connected).toBe(false);

    await vi.advanceTimersByTimeAsync(0);
    expect(transport.connected).toBe(true);
    expect(connects).toHaveLength(1);

    await transport.send(REPORT);
    expect(handle.written).toEqual([REPORT]);
    await transport.close();
  });

  it("rejects a report that is not 64 bytes", async () => {
    const backend = new FakeBackend();
    const handle = backend.plugIn();
    const { transport } = start(backend);
    await vi.advanceTimersByTimeAsync(0);
    await expect(transport.send(new Uint8Array(63))).rejects.toThrow(TypeError);
    expect(handle.written).toEqual([]);
    await transport.close();
  });

  it("delivers each report the keypad sends, in order", async () => {
    const backend = new FakeBackend();
    const handle = backend.plugIn();
    const { transport } = start(backend);
    const received: Uint8Array[] = [];
    transport.onReport((report) => received.push(report));
    await vi.advanceTimersByTimeAsync(0);

    const first = rawReport(CHANNEL_RPC, "one\n");
    const second = rawReport(CHANNEL_RPC, "two\n");
    handle.incoming.push(first, second);
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(received).toEqual([first, second]);
    await transport.close();
  });

  it("waits for a keypad that enumerates late", async () => {
    const backend = new FakeBackend();
    const { transport, connects } = start(backend);
    await vi.advanceTimersByTimeAsync(0);
    await expect(transport.send(REPORT)).rejects.toThrow("DEVICE_DISCONNECTED");

    // The kernel took 40 seconds to bind the interface on one plug-in.
    await vi.advanceTimersByTimeAsync(40 * RETRY_MS);
    expect(connects).toHaveLength(0);
    const handle = backend.plugIn();
    await vi.advanceTimersByTimeAsync(RETRY_MS);
    expect(connects).toHaveLength(1);

    await transport.send(REPORT);
    expect(handle.written).toEqual([REPORT]);
    await transport.close();
  });

  it("reports a refused open one time and connects when it succeeds", async () => {
    const backend = new FakeBackend();
    backend.openError = new Error("EACCES: permission denied");
    const { transport, statuses } = start(backend);
    await vi.advanceTimersByTimeAsync(5 * RETRY_MS);
    expect(backend.opens).toBeGreaterThan(3);
    expect(statuses).toEqual([
      { kind: "open-failed", reason: "EACCES: permission denied" },
    ]);

    backend.openError = undefined;
    backend.plugIn();
    await vi.advanceTimersByTimeAsync(RETRY_MS);
    expect(statuses.at(-1)).toEqual({ kind: "connected" });
    await transport.close();
  });

  it("reconnects after an unplug and a replug", async () => {
    const backend = new FakeBackend();
    const first = backend.plugIn();
    const { transport, statuses, connects } = start(backend);
    const received: Uint8Array[] = [];
    transport.onReport((report) => received.push(report));
    await vi.advanceTimersByTimeAsync(0);

    first.gone = true;
    backend.present = undefined;
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(transport.connected).toBe(false);
    expect(first.closed).toBe(true);
    expect(statuses.at(-1)).toEqual({
      kind: "disconnected",
      reason: "read failed: ENODEV",
    });
    await expect(transport.send(REPORT)).rejects.toThrow("DEVICE_DISCONNECTED");

    const second = backend.plugIn();
    await vi.advanceTimersByTimeAsync(RETRY_MS);
    expect(transport.connected).toBe(true);
    expect(connects).toHaveLength(2);

    await transport.send(REPORT);
    expect(second.written).toEqual([REPORT]);
    second.incoming.push(REPORT);
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(received).toEqual([REPORT]);
    await transport.close();
  });

  it("drops the keypad after a failed write and opens it again", async () => {
    const backend = new FakeBackend();
    const handle = backend.plugIn();
    const { transport, connects } = start(backend);
    await vi.advanceTimersByTimeAsync(0);

    handle.failAtWrite = 1;
    await expect(transport.send(REPORT)).rejects.toThrow("WRITE_FAILED");
    expect(transport.connected).toBe(false);
    expect(handle.closed).toBe(true);

    await vi.advanceTimersByTimeAsync(RETRY_MS);
    expect(transport.connected).toBe(true);
    expect(connects).toHaveLength(2);
    await transport.close();
  });

  it("stops when closed", async () => {
    const backend = new FakeBackend();
    const handle = backend.plugIn();
    const { transport } = start(backend);
    await vi.advanceTimersByTimeAsync(0);
    await transport.close();
    expect(handle.closed).toBe(true);
    expect(transport.connected).toBe(false);
    await expect(transport.send(REPORT)).rejects.toThrow("DEVICE_DISCONNECTED");
    const opens = backend.opens;
    await vi.advanceTimersByTimeAsync(5 * RETRY_MS);
    expect(backend.opens).toBe(opens);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("resyncs the host: full lighting from a message boundary after a failed send", async () => {
    const backend = new FakeBackend();
    const handle = backend.plugIn();
    const transport = new HidTransport(backend, {
      pollMs: POLL_MS,
      retryMs: RETRY_MS,
    });
    const host = createHost(transport, {
      sendCooldownMs: 0,
      resyncQuietMs: 0,
    });
    await vi.advanceTimersByTimeAsync(0);
    const connectPush = handle.written.length;
    expect(connectPush).toBeGreaterThan(0);

    // The second report of the next message fails. The keypad now
    // holds one fragment of a message that never completes.
    handle.failAtWrite = 2;
    await host.setSlot(0, { status: "working" });
    expect(handle.written).toHaveLength(connectPush + 1);
    expect(transport.connected).toBe(false);

    // The keypad returns as a new handle. A real keypad that kept its
    // power drops the fragment after 5 seconds of silence
    // (docs/protocol.md §11); test/host.test.ts pins that wait.
    const fresh = backend.plugIn();
    await vi.advanceTimersByTimeAsync(RETRY_MS);
    await vi.advanceTimersByTimeAsync(0);

    const methods: string[] = [];
    let state = initialRpcAccumulator;
    for (const report of fresh.written) {
      const text = new TextDecoder().decode(payloadOf(report));
      const [next, result] = feedRpcLine(state, text);
      state = next;
      if (result?.ok && result.message.kind === "request") {
        methods.push(result.message.method);
      }
    }
    expect(methods).toEqual(["v.oai.thstatus", "v.oai.rgbcfg"]);
    expect(state.pending).toBe("");
    const text = fresh.written
      .map((report) => new TextDecoder().decode(payloadOf(report)))
      .join("");
    expect(text).toContain('"c":3166206');
    host.close();
    await transport.close();
  });
});

describe("tee transport", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends each report to the mirror and to the keypad", async () => {
    const backend = new FakeBackend();
    const handle = backend.plugIn();
    const keypad = new HidTransport(backend);
    const mirror = new SimulatedDevice();
    const mirrored: Uint8Array[] = [];
    mirror.onFrame((event) => {
      if (event.direction === "host-to-device") mirrored.push(event.report);
    });
    const tee = teeTransport(keypad, mirror);
    await vi.advanceTimersByTimeAsync(0);

    const [report] = encodeFrames(CHANNEL_RPC, "{}");
    await tee.send(report as Uint8Array);
    expect(handle.written).toEqual([report]);
    expect(mirrored).toEqual([report]);
    await tee.close();
  });

  it("keeps the mirror whole while the keypad is absent", async () => {
    const backend = new FakeBackend();
    const mirror = new SimulatedDevice();
    const tee = teeTransport(new HidTransport(backend), mirror);
    const host = createHost(tee, { sendCooldownMs: 0 });
    await vi.advanceTimersByTimeAsync(0);
    expect(tee.connected).toBe(false);

    // Each message has more than one report. The mirror must get all
    // of them, or it holds a part and reads nothing after it.
    await host.setSlot(0, { status: "working" });
    await host.setSlot(1, { status: "error" });
    expect(mirror.lighting.slots[0]?.color).toBe(0x304ffe);
    expect(mirror.lighting.slots[1]?.color).toBe(0xff0033);

    // The keypad arrives and gets the full state.
    const handle = backend.plugIn();
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(0);
    const text = handle.written
      .map((report) => new TextDecoder().decode(payloadOf(report)))
      .join("");
    expect(text).toContain('"c":3166206');
    expect(text).toContain("v.oai.rgbcfg");
    host.close();
    await tee.close();
  });

  it("after a failed write, keeps the mirror whole and leaves the keypad in silence", async () => {
    const QUIET_MS = 5500;
    const backend = new FakeBackend();
    const first = backend.plugIn();
    const mirror = new SimulatedDevice();
    const tee = teeTransport(new HidTransport(backend), mirror, {
      resyncQuietMs: QUIET_MS,
    });
    const host = createHost(tee, { sendCooldownMs: 0 });
    await vi.advanceTimersByTimeAsync(0);

    // The second report of the message fails: the keypad holds a part.
    first.failAtWrite = 2;
    await host.setSlot(0, { status: "working" });
    expect(mirror.lighting.slots[0]?.color).toBe(0x304ffe);

    // The keypad opens again after one second. It must get nothing
    // until the silence has passed, also when the state changes.
    const second = backend.plugIn();
    await vi.advanceTimersByTimeAsync(1000);
    await host.setSlot(1, { status: "error" });
    await vi.advanceTimersByTimeAsync(QUIET_MS - 1100);
    expect(second.written).toEqual([]);
    expect(mirror.lighting.slots[1]?.color).toBe(0xff0033);

    await vi.advanceTimersByTimeAsync(200);
    await vi.advanceTimersByTimeAsync(0);
    const text = second.written
      .map((report) => new TextDecoder().decode(payloadOf(report)))
      .join("");
    expect(text.startsWith('{"method":"v.oai.thstatus"')).toBe(true);
    expect(text).toContain('"c":3166206');
    expect(text).toContain('"c":16711731');
    expect(text).toContain("v.oai.rgbcfg");
    host.close();
    await tee.close();
  });

  it("delivers reports from the keypad and from the mirror", async () => {
    const backend = new FakeBackend();
    const handle = backend.plugIn();
    const mirror = new SimulatedDevice();
    const tee = teeTransport(new HidTransport(backend), mirror);
    const received: Uint8Array[] = [];
    tee.onReport((report) => received.push(report));
    await vi.advanceTimersByTimeAsync(0);

    handle.incoming.push(REPORT);
    await vi.advanceTimersByTimeAsync(POLL_MS);
    mirror.pressKey("AG00");
    expect(received).toHaveLength(2);
    expect(received[0]).toEqual(REPORT);
    await tee.close();
  });
});
