// Key notifications, read from the transport. It reassembles the
// reports that arrive, parses each complete RPC line, and reports each
// `v.oai.hid` notification as a key event (docs/protocol.md §5, §6).
// It reads the transport only, so the simulator and real hardware feed
// it alike.

import {
  CHANNEL_RPC,
  feedReport,
  initialReassembly,
  NOTIFY_KEYS,
  parseMessage,
} from "../protocol/index.js";
import type { DeviceTransport } from "./transport.js";

/** One key notification. `act` is 0 = release, 1 = press, 2 = tick. */
export interface KeyEvent {
  readonly key: string;
  readonly act: number;
}

/**
 * Subscribes to key notifications. Malformed lines and other methods
 * are ignored. An error in `cb` does not stop the feed. Returns an
 * unsubscribe function.
 */
export function onKeyEvent(
  transport: DeviceTransport,
  cb: (event: KeyEvent) => void,
): () => void {
  let reassembly = initialReassembly;
  return transport.onReport((report) => {
    const [next, events] = feedReport(reassembly, report);
    reassembly = next;
    for (const event of events) {
      if (event.kind !== "line" || event.channel !== CHANNEL_RPC) continue;
      const parsed = parseMessage(event.text);
      if (!parsed.ok || parsed.message.kind !== "notification") continue;
      if (parsed.message.method !== NOTIFY_KEYS) continue;
      const params = parsed.message.params;
      if (typeof params !== "object" || params === null) continue;
      // The keypad names the member `k`. The simulated device and
      // the vendor documentation name it `key` (docs/protocol.md §11).
      const record = params as Record<string, unknown>;
      const key = record.k ?? record.key;
      const act = record.act;
      if (typeof key !== "string" || typeof act !== "number") continue;
      try {
        cb({ key, act });
      } catch (error) {
        console.error("key event handler failed:", error);
      }
    }
  });
}
