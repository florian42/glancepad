// The macOS HID access path: the `node-hid` library, which uses IOKit
// through hidapi (ADR-0004). This file does not import the library.
// The caller loads it and gives it to the backend, so Linux never
// loads the native module and the tests use a fake.
//
// NOT TESTED ON macOS. The report layout below comes from the hidapi
// source that `node-hid` 3.4.0 contains. See research/macos-support.md.

import type { HidBackend, HidHandle } from "./hidtransport.js";
import {
  KEYPAD_PRODUCT_ID,
  KEYPAD_USAGE_PAGE,
  KEYPAD_VENDOR_ID,
} from "./keypadid.js";

/** One entry of the device list. The part of it that we read. */
export interface NodeHidDeviceInfo {
  readonly vendorId: number;
  readonly productId: number;
  readonly path?: string | undefined;
  readonly usagePage?: number | undefined;
}

/** One open device. The part of the library class that we call. */
export interface NodeHidDevice {
  /**
   * Returns the next report as numbers, and an empty array when no
   * report arrives in `ms` milliseconds. Throws when the device is
   * gone.
   */
  readTimeout(ms: number): number[];
  /** Writes one report. Byte 0 is the report id. Throws on a failure. */
  write(values: number[] | Buffer): number;
  close(): void;
}

/** The part of the `node-hid` module that the backend uses. */
export interface NodeHidLibrary {
  devices(vendorId: number, productId: number): NodeHidDeviceInfo[];
  HID: new (
    path: string,
    options?: { nonExclusive?: boolean },
  ) => NodeHidDevice;
}

export interface NodeHidQuery {
  readonly vendorId: number;
  readonly productId: number;
  readonly usagePage: number;
}

/**
 * Finds the path of the interface that matches the query. The keypad
 * has three HID interfaces with one vendor id and product id. Only
 * the usage page tells them apart.
 */
export function findNodeHidPath(
  library: NodeHidLibrary,
  query: NodeHidQuery,
): string | undefined {
  return library
    .devices(query.vendorId, query.productId)
    .find(
      (info) =>
        info.vendorId === query.vendorId &&
        info.productId === query.productId &&
        info.usagePage === query.usagePage &&
        typeof info.path === "string",
    )?.path;
}

/**
 * Opens one interface for reports. hidapi collects the input reports
 * on its own thread, so a read with a timeout of 0 returns at once. A
 * report keeps its report id in byte 0 in both directions, which is
 * the layout of `docs/protocol.md` §2.
 */
export function openNodeHid(library: NodeHidLibrary, path: string): HidHandle {
  // Non-exclusive: the default mode seizes the device from all other
  // processes. The Linux path does not do that either.
  const device = new library.HID(path, { nonExclusive: true });
  return {
    read: () => {
      const data = device.readTimeout(0);
      return data.length === 0 ? undefined : Uint8Array.from(data);
    },
    write: async (report) => {
      const written = device.write(Buffer.from(report));
      if (written !== report.length) {
        throw new Error(`short write: ${written} of ${report.length}`);
      }
    },
    close: () => {
      device.close();
    },
  };
}

/** The backend that finds and opens the keypad through `node-hid`. */
export function nodeHidKeypadBackend(
  library: NodeHidLibrary,
  overrides: Partial<NodeHidQuery> = {},
): HidBackend {
  const query: NodeHidQuery = {
    vendorId: KEYPAD_VENDOR_ID,
    productId: KEYPAD_PRODUCT_ID,
    usagePage: KEYPAD_USAGE_PAGE,
    ...overrides,
  };
  return {
    open: () => {
      const path = findNodeHidPath(library, query);
      return path === undefined ? undefined : openNodeHid(library, path);
    },
  };
}
