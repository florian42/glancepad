// The macOS access path against a fake of the `node-hid` library. No
// test loads the native module, and no test needs macOS.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HidTransport } from "../src/device/hidtransport.js";
import {
  type NodeHidDevice,
  type NodeHidDeviceInfo,
  type NodeHidLibrary,
  nodeHidKeypadBackend,
} from "../src/device/nodehid.js";
import { CHANNEL_RPC } from "../src/protocol/index.js";
import { rawReport } from "./helpers.js";

const KEYPAD = { vendorId: 0x303a, productId: 0x8360 };
// The three interfaces of the keypad, by usage page (docs/protocol.md §11).
const KEYBOARD: NodeHidDeviceInfo = { ...KEYPAD, path: "kbd", usagePage: 1 };
const CONSUMER: NodeHidDeviceInfo = { ...KEYPAD, path: "ccd", usagePage: 12 };
const VENDOR: NodeHidDeviceInfo = { ...KEYPAD, path: "vnd", usagePage: 65280 };

class FakeDevice implements NodeHidDevice {
  readonly written: number[][] = [];
  readonly incoming: number[][] = [];
  closed = false;
  gone = false;
  shortWrite = false;

  readTimeout(ms: number): number[] {
    // A timeout above 0 would block the event loop.
    expect(ms).toBe(0);
    if (this.gone) throw new TypeError("could not read data from device");
    return this.incoming.shift() ?? [];
  }

  write(values: number[] | Buffer): number {
    if (this.gone) throw new TypeError("Cannot write to hid device");
    this.written.push([...values]);
    return this.shortWrite ? values.length - 1 : values.length;
  }

  close(): void {
    this.closed = true;
  }
}

/** A fake `node-hid` module with a list of attached interfaces. */
function fakeLibrary(attached: NodeHidDeviceInfo[]) {
  const opened: { path: string; options: unknown; device: FakeDevice }[] = [];
  let openError: Error | undefined;
  const library: NodeHidLibrary = {
    devices: (vendorId, productId) =>
      attached.filter(
        (info) => info.vendorId === vendorId && info.productId === productId,
      ),
    HID: class extends FakeDevice {
      constructor(path: string, options?: { nonExclusive?: boolean }) {
        super();
        if (openError) throw openError;
        opened.push({ path, options, device: this });
      }
    },
  };
  return {
    library,
    opened,
    attached,
    failOpen: (error: Error | undefined) => {
      openError = error;
    },
  };
}

describe("node-hid discovery", () => {
  it("opens the interface with the vendor usage page, not exclusive", () => {
    const fake = fakeLibrary([KEYBOARD, CONSUMER, VENDOR]);
    const handle = nodeHidKeypadBackend(fake.library).open();
    expect(handle).toBeDefined();
    expect(fake.opened.map(({ path, options }) => ({ path, options }))).toEqual(
      [{ path: "vnd", options: { nonExclusive: true } }],
    );
  });

  it("finds nothing without the vendor interface", () => {
    const fake = fakeLibrary([KEYBOARD, CONSUMER]);
    expect(nodeHidKeypadBackend(fake.library).open()).toBeUndefined();
  });

  it("ignores a different device with the same usage page", () => {
    const fake = fakeLibrary([{ ...VENDOR, productId: 0x1234 }]);
    expect(nodeHidKeypadBackend(fake.library).open()).toBeUndefined();
  });

  it("throws when the keypad is present and the open fails", () => {
    const fake = fakeLibrary([VENDOR]);
    fake.failOpen(new TypeError("cannot open device with path vnd"));
    expect(() => nodeHidKeypadBackend(fake.library).open()).toThrow(
      "cannot open device",
    );
  });
});

describe("node-hid reports", () => {
  const open = () => {
    const fake = fakeLibrary([VENDOR]);
    const handle = nodeHidKeypadBackend(fake.library).open();
    if (handle === undefined) throw new Error("no handle");
    const device = fake.opened[0]?.device as FakeDevice;
    return { handle, device };
  };

  it("writes all 64 bytes, with the report id in byte 0", async () => {
    const { handle, device } = open();
    const report = rawReport(CHANNEL_RPC, "{}\n");
    await handle.write(report);
    expect(device.written).toEqual([[...report]]);
    expect(device.written[0]?.length).toBe(64);
    expect(device.written[0]?.[0]).toBe(6);
  });

  it("rejects a short write and a failed write", async () => {
    const { handle, device } = open();
    device.shortWrite = true;
    await expect(handle.write(rawReport(CHANNEL_RPC, ""))).rejects.toThrow(
      "short write: 63 of 64",
    );
    device.gone = true;
    await expect(handle.write(rawReport(CHANNEL_RPC, ""))).rejects.toThrow(
      "Cannot write",
    );
  });

  it("returns each report that waits, then nothing", () => {
    const { handle, device } = open();
    const report = rawReport(CHANNEL_RPC, "abc");
    device.incoming.push([...report]);
    expect(handle.read()).toEqual(report);
    expect(handle.read()).toBeUndefined();
  });

  it("throws on a read after the keypad left, and closes the device", () => {
    const { handle, device } = open();
    device.gone = true;
    expect(() => handle.read()).toThrow("could not read");
    handle.close();
    expect(device.closed).toBe(true);
  });
});

describe("node-hid behind the transport", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("connects, delivers a report, and reconnects after an unplug", async () => {
    const fake = fakeLibrary([VENDOR]);
    const transport = new HidTransport(nodeHidKeypadBackend(fake.library));
    const reports: Uint8Array[] = [];
    let connects = 0;
    transport.onReport((report) => reports.push(report));
    transport.onConnect(() => connects++);

    await vi.advanceTimersByTimeAsync(0);
    expect(transport.connected).toBe(true);

    const first = fake.opened[0]?.device as FakeDevice;
    const report = rawReport(CHANNEL_RPC, "x");
    first.incoming.push([...report]);
    await vi.advanceTimersByTimeAsync(10);
    expect(reports).toEqual([report]);

    first.gone = true;
    fake.attached.length = 0;
    await vi.advanceTimersByTimeAsync(10);
    expect(transport.connected).toBe(false);
    expect(first.closed).toBe(true);

    fake.attached.push(VENDOR);
    await vi.advanceTimersByTimeAsync(1000);
    expect(transport.connected).toBe(true);
    expect(connects).toBe(2);
    await transport.close();
  });
});
