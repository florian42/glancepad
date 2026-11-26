// Hardware mode drives two devices from one host: the keypad, and the
// simulated device that the page draws. The tee sends each report to
// both and merges their incoming reports.

import { INCOMPLETE_MESSAGE_TIMEOUT_MS } from "../protocol/index.js";
import type { DeviceTransport } from "./transport.js";

export interface TeeOptions {
  /**
   * Silence toward the primary after a write to it fails. Default is
   * the keypad's timeout for an incomplete message, plus a margin.
   */
  readonly resyncQuietMs?: number;
}

/**
 * Joins a primary transport and a mirror. The mirror receives each
 * report, so the page shows the intended lighting also while the
 * primary is absent.
 *
 * A failure of the primary never rejects a send. A rejected send
 * stops the host in the middle of a message, and the mirror would
 * keep a part that never completes. The tee instead treats the
 * primary as absent, and `onConnect` tells the host when to send its
 * full state again. After a failed write that is not before the
 * silence has passed, because the primary can hold a part
 * (docs/protocol.md §11).
 */
export function teeTransport(
  primary: DeviceTransport,
  mirror: DeviceTransport,
  options: TeeOptions = {},
): DeviceTransport {
  const resyncQuietMs =
    options.resyncQuietMs ?? INCOMPLETE_MESSAGE_TIMEOUT_MS + 500;
  let quietUntilMs = 0;
  const timers = new Set<NodeJS.Timeout>();

  return {
    get connected() {
      return primary.connected;
    },
    send: async (report) => {
      await mirror.send(report);
      if (!primary.connected || Date.now() < quietUntilMs) return;
      try {
        await primary.send(report);
      } catch {
        quietUntilMs = Date.now() + resyncQuietMs;
      }
    },
    onReport: (cb) => {
      const offPrimary = primary.onReport(cb);
      const offMirror = mirror.onReport(cb);
      return () => {
        offPrimary();
        offMirror();
      };
    },
    onConnect: (cb) =>
      primary.onConnect(() => {
        const quietMs = quietUntilMs - Date.now();
        if (quietMs <= 0) {
          cb();
          return;
        }
        const timer = setTimeout(() => {
          timers.delete(timer);
          cb();
        }, quietMs);
        timers.add(timer);
      }),
    close: async () => {
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      await mirror.close();
      await primary.close();
    },
  };
}
