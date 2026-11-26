// Selects the HID access path for this system. Linux uses
// `/dev/hidraw` (ADR-0003). macOS uses `node-hid` (ADR-0004), and the
// import is lazy: Linux never loads the native module.

import { linuxKeypadBackend } from "../device/hidraw.js";
import type { HidBackend } from "../device/hidtransport.js";
import { nodeHidKeypadBackend } from "../device/nodehid.js";

export interface KeypadAccess {
  readonly backend: HidBackend;
  /** What to tell the user when a keypad is present but does not open. */
  readonly openHint: string;
}

/** Returns `undefined` for a system that has no access path. */
export async function keypadAccessFor(
  platform: NodeJS.Platform,
): Promise<KeypadAccess | undefined> {
  if (platform === "linux") {
    return {
      backend: linuxKeypadBackend(),
      openHint: "Install udev/70-glancepad.rules (see README).",
    };
  }
  if (platform === "darwin") {
    const { default: nodeHid } = await import("node-hid");
    return {
      backend: nodeHidKeypadBackend(nodeHid),
      openHint:
        "Close other applications that use the keypad, and see the macOS section of the README.",
    };
  }
  return undefined;
}
