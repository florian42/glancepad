// The Linux HID access path: sysfs for discovery, and plain file I/O
// on the /dev/hidraw node for reports (ADR-0003). No native module.

import {
  closeSync,
  constants,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  write,
} from "node:fs";
import { join } from "node:path";
import { REPORT_SIZE } from "../protocol/index.js";
import type { HidBackend, HidHandle } from "./hidtransport.js";
import {
  KEYPAD_PRODUCT_ID,
  KEYPAD_USAGE_PAGE,
  KEYPAD_VENDOR_ID,
} from "./keypadid.js";

export {
  KEYPAD_PRODUCT_ID,
  KEYPAD_USAGE_PAGE,
  KEYPAD_VENDOR_ID,
} from "./keypadid.js";

export interface HidrawQuery {
  readonly vendorId: number;
  readonly productId: number;
  readonly usagePage: number;
  /** Default `/sys/class/hidraw`. Tests pass a temporary tree. */
  readonly sysRoot?: string;
  /** Default `/dev`. */
  readonly devRoot?: string;
}

/**
 * Returns the first Usage Page that a HID report descriptor declares,
 * or `undefined` when it declares none. A short item is one prefix
 * byte and 0, 1, 2, or 4 data bytes. Usage Page is the global item
 * with tag 0.
 */
export function firstUsagePage(descriptor: Uint8Array): number | undefined {
  let offset = 0;
  while (offset < descriptor.length) {
    const prefix = descriptor[offset] as number;
    if (prefix === 0xfe) {
      // A long item: its second byte is the data size.
      offset += 3 + (descriptor[offset + 1] ?? 0);
      continue;
    }
    const sizeCode = prefix & 0x03;
    const size = sizeCode === 3 ? 4 : sizeCode;
    if (offset + 1 + size > descriptor.length) return undefined;
    if ((prefix & 0xfc) === 0x04) {
      let value = 0;
      for (let i = size - 1; i >= 0; i--) {
        value = value * 256 + (descriptor[offset + 1 + i] ?? 0);
      }
      return value;
    }
    offset += 1 + size;
  }
  return undefined;
}

/**
 * Finds the hidraw node of the interface that matches the query. The
 * keypad has three HID interfaces with one vendor id and product id.
 * Only the usage page tells them apart, and the node number changes
 * between plug-ins. Returns `undefined` when no node matches.
 */
export function findHidraw(query: HidrawQuery): string | undefined {
  const sysRoot = query.sysRoot ?? "/sys/class/hidraw";
  let names: string[];
  try {
    names = readdirSync(sysRoot).sort();
  } catch {
    return undefined;
  }
  for (const name of names) {
    try {
      const uevent = readFileSync(join(sysRoot, name, "device/uevent"), "utf8");
      // HID_ID is `bus:vendor:product`, each part in hexadecimal.
      const id = /^HID_ID=[0-9A-Fa-f]+:([0-9A-Fa-f]+):([0-9A-Fa-f]+)$/m.exec(
        uevent,
      );
      if (id === null) continue;
      if (Number.parseInt(id[1] as string, 16) !== query.vendorId) continue;
      if (Number.parseInt(id[2] as string, 16) !== query.productId) continue;
      const descriptor = readFileSync(
        join(sysRoot, name, "device/report_descriptor"),
      );
      if (firstUsagePage(descriptor) !== query.usagePage) continue;
      return join(query.devRoot ?? "/dev", name);
    } catch {
      // The node went away during the scan. The next scan sees the
      // new state.
    }
  }
  return undefined;
}

const isErrno = (error: unknown, code: string): boolean =>
  error instanceof Error && (error as NodeJS.ErrnoException).code === code;

/**
 * Opens one hidraw node for reports. The open is non-blocking: a
 * blocked read would hold a thread of the Node pool, and the process
 * could not exit. `read` therefore returns at once.
 */
export function openHidraw(path: string): HidHandle {
  const fd = openSync(path, constants.O_RDWR | constants.O_NONBLOCK);
  const buffer = new Uint8Array(REPORT_SIZE);
  return {
    read: () => {
      let size: number;
      try {
        size = readSync(fd, buffer, 0, REPORT_SIZE, null);
      } catch (error) {
        if (isErrno(error, "EAGAIN")) return undefined;
        throw error;
      }
      return size === 0 ? undefined : buffer.slice(0, size);
    },
    write: (report) =>
      new Promise<void>((resolve, reject) => {
        write(fd, report, 0, report.length, null, (error, written) => {
          if (error) reject(error);
          else if (written !== report.length)
            reject(new Error(`short write: ${written} of ${report.length}`));
          else resolve();
        });
      }),
    close: () => {
      closeSync(fd);
    },
  };
}

/** The backend that finds and opens the keypad on Linux. */
export function linuxKeypadBackend(
  overrides: Partial<HidrawQuery> = {},
): HidBackend {
  const query: HidrawQuery = {
    vendorId: KEYPAD_VENDOR_ID,
    productId: KEYPAD_PRODUCT_ID,
    usagePage: KEYPAD_USAGE_PAGE,
    ...overrides,
  };
  return {
    open: () => {
      const path = findHidraw(query);
      return path === undefined ? undefined : openHidraw(path);
    },
  };
}
