// Agent-key taps: a press on an agent key brings the session of that
// key to the front and marks it as read (issue 12). This module joins
// the tap machine, the session-to-process table, and the focus seam.
// It performs no I/O of its own.

import { AGENT_KEYS, KEY_ACTS } from "../protocol/index.js";
import {
  initialTapState,
  reduceTap,
  type TapOptions,
  type TapState,
} from "../sessions/index.js";
import type { FocusResult, WindowFocuser } from "./focuser.js";

export interface AgentTapsOptions {
  /** Session ids in key order. An empty key is `null`. */
  readonly sessionIds: () => readonly (string | null)[];
  /** Applies the mark-as-read rule to one session. */
  readonly markRead: (sessionId: string) => Promise<void> | void;
  /** Without a focuser, a tap only marks the session as read. */
  readonly focuser?: WindowFocuser;
  /** The clock, in milliseconds. Default is `Date.now`. */
  readonly now?: () => number;
  readonly tap?: TapOptions;
  /** Receives each failed focus. Default writes one line to stderr. */
  readonly onFocusFailure?: (sessionId: string, reason: string) => void;
}

export interface AgentTaps {
  /** Records the process id that a session reported. */
  setProcess(sessionId: string, pid: number): void;
  /** Drops the process id of a session that ended. */
  forget(sessionId: string): void;
  /**
   * Feeds one key event. Returns the session that the tap activated,
   * or `null`. The promise resolves after the focus attempt, and it
   * never rejects.
   */
  key(key: string, act: number): Promise<string | null>;
}

export function createAgentTaps(options: AgentTapsOptions): AgentTaps {
  const now = options.now ?? Date.now;
  const onFocusFailure =
    options.onFocusFailure ??
    ((sessionId: string, reason: string) => {
      console.error(`focus failed for session ${sessionId}: ${reason}`);
    });
  const processes = new Map<string, number>();
  let state: TapState = initialTapState;

  const focus = async (sessionId: string): Promise<void> => {
    if (options.focuser === undefined) return;
    const pid = processes.get(sessionId);
    let result: FocusResult;
    if (pid === undefined) {
      result = { focused: false, reason: "the session reported no process" };
    } else {
      try {
        result = await options.focuser.focusProcess(pid);
      } catch (error) {
        result = { focused: false, reason: String(error) };
      }
    }
    if (!result.focused) onFocusFailure(sessionId, result.reason);
  };

  return {
    setProcess: (sessionId, pid) => {
      processes.set(sessionId, pid);
    },
    forget: (sessionId) => {
      processes.delete(sessionId);
    },
    key: async (key, act) => {
      if (act !== KEY_ACTS.press) return null;
      const slot = (AGENT_KEYS as readonly string[]).indexOf(key);
      if (slot === -1) return null;
      const sessionId = options.sessionIds()[slot] ?? null;
      const result = reduceTap(
        state,
        { slot, sessionId, nowMs: now() },
        options.tap,
      );
      state = result.state;
      if (result.activate === null) return null;
      // The user looked at the session, even when the focus fails.
      try {
        await options.markRead(result.activate);
      } catch (error) {
        console.error("mark as read failed:", error);
      }
      await focus(result.activate);
      return result.activate;
    },
  };
}
