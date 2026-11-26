// The Linux access path against a temporary sysfs tree and a FIFO.
// No test opens a real device.

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  findHidraw,
  firstUsagePage,
  openHidraw,
} from "../src/device/hidraw.js";
import { CHANNEL_RPC } from "../src/protocol/index.js";
import { fromHex, rawReport } from "./helpers.js";

// The first items of the three report descriptors, as read from sysfs
// with the keypad attached (docs/protocol.md §11).
const VENDOR_DESCRIPTOR = fromHex("0600ff0901a1018506");
const KEYBOARD_DESCRIPTOR = fromHex("05010906a101");
const CONSUMER_DESCRIPTOR = fromHex("050c0901a101");

const QUERY = { vendorId: 0x303a, productId: 0x8360, usagePage: 0xff00 };

describe("report descriptor", () => {
  it("reads the first usage page", () => {
    expect(firstUsagePage(VENDOR_DESCRIPTOR)).toBe(0xff00);
    expect(firstUsagePage(KEYBOARD_DESCRIPTOR)).toBe(0x01);
    expect(firstUsagePage(CONSUMER_DESCRIPTOR)).toBe(0x0c);
  });

  it("skips items before the usage page, and survives a cut descriptor", () => {
    // Report Size 8, then Usage Page 0xFF00.
    expect(firstUsagePage(fromHex("75080600ff"))).toBe(0xff00);
    expect(firstUsagePage(fromHex("7508"))).toBeUndefined();
    expect(firstUsagePage(fromHex("750806ff"))).toBeUndefined();
    expect(firstUsagePage(new Uint8Array(0))).toBeUndefined();
  });
});

describe("hidraw discovery", () => {
  let root: string;
  const addNode = (name: string, hidId: string, descriptor: Uint8Array) => {
    const dir = join(root, name, "device");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "uevent"),
      `DRIVER=hid-generic\nHID_ID=${hidId}\nHID_NAME=A device\n`,
    );
    writeFileSync(join(dir, "report_descriptor"), descriptor);
  };

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "glancepad-sysfs-"));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const find = () => findHidraw({ ...QUERY, sysRoot: root, devRoot: "/dev" });

  it("picks the interface with the vendor usage page", () => {
    addNode("hidraw0", "0003:0000303A:00008360", KEYBOARD_DESCRIPTOR);
    addNode("hidraw1", "0003:0000303A:00008360", CONSUMER_DESCRIPTOR);
    addNode("hidraw2", "0003:0000303A:00008360", VENDOR_DESCRIPTOR);
    expect(find()).toBe("/dev/hidraw2");
  });

  it("follows the interface to another node number", () => {
    addNode("hidraw3", "0003:0000046D:0000C52B", VENDOR_DESCRIPTOR);
    addNode("hidraw7", "0003:0000303A:00008360", VENDOR_DESCRIPTOR);
    addNode("hidraw8", "0003:0000303A:00008360", KEYBOARD_DESCRIPTOR);
    expect(find()).toBe("/dev/hidraw7");
  });

  it("finds nothing while the vendor interface is not bound", () => {
    // The kernel bound interface 0 alone on one slow plug-in.
    addNode("hidraw0", "0003:0000303A:00008360", KEYBOARD_DESCRIPTOR);
    expect(find()).toBeUndefined();
  });

  it("finds nothing without a hidraw class directory", () => {
    rmSync(root, { recursive: true });
    expect(find()).toBeUndefined();
  });
});

describe.runIf(process.platform === "linux")("hidraw file I/O", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "glancepad-fifo-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns at once when no report waits, and reads what was written", async () => {
    // A FIFO stands in for the node: the same open flags, the same
    // EAGAIN when it is empty.
    const path = join(dir, "node");
    execFileSync("mkfifo", [path]);
    const handle = openHidraw(path);
    try {
      expect(handle.read()).toBeUndefined();
      const report = rawReport(CHANNEL_RPC, "hello\n");
      await handle.write(report);
      expect(handle.read()).toEqual(report);
      expect(handle.read()).toBeUndefined();
    } finally {
      handle.close();
    }
  });

  it("throws when the node does not open", () => {
    expect(() => openHidraw(join(dir, "missing"))).toThrow("ENOENT");
  });
});
