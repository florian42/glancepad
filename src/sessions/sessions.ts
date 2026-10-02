// Session state from normalized session events, and the six slot
// signals in `recent` order. The status table is in
// research/claude-code-session-signals.md. Delivery order is an
// inference, not a guarantee, so the reducer ignores events that
// arrive outside a turn (research/claude-code-mods-as-state-source.md).

import {
  AGENT_KEYS,
  type SlotSignal,
  type SlotStatus,
} from "../protocol/index.js";

/**
 * One session event, independent of its source. Adapters translate
 * settings hooks or a mod into this shape.
 */
export type SessionEvent =
  | {
      kind: "started";
      sessionId: string;
      cwd: string;
      resumedFromCompact: boolean;
    }
  | { kind: "prompted"; sessionId: string }
  /** Tool or subagent activity inside a turn. */
  | { kind: "active"; sessionId: string }
  | { kind: "awaiting-approval"; sessionId: string }
  /** Claude asks the user a structured question. */
  | { kind: "awaiting-response"; sessionId: string }
  | {
      kind: "turn-ended";
      sessionId: string;
      outcome: "answer" | "interrupted" | "error";
    }
  | { kind: "ended"; sessionId: string };

export interface Session {
  readonly status: SlotStatus;
  readonly lastActivityMs: number;
}

/** All known sessions, keyed by session id. */
export type Sessions = ReadonlyMap<string, Session>;

export const emptySessions: Sessions = new Map();

const SLOT_COUNT = AGENT_KEYS.length;

const TURN_END_STATUS = {
  answer: "unread",
  interrupted: "idle",
  error: "error",
} as const satisfies Record<string, SlotStatus>;

const inTurn = (status: SlotStatus): boolean =>
  status === "working" ||
  status === "awaiting-approval" ||
  status === "awaiting-response";

/**
 * Applies one event at time `nowMs`. An event for an unknown session
 * creates it, except `ended`. An ignored event changes nothing, not
 * even the last-activity time.
 */
export function reduceSessions(
  sessions: Sessions,
  event: SessionEvent,
  nowMs: number,
): Sessions {
  const current = sessions.get(event.sessionId);
  if (event.kind === "ended") {
    if (current === undefined) return sessions;
    const next = new Map(sessions);
    next.delete(event.sessionId);
    return next;
  }
  const status = nextStatus(current?.status, event);
  if (status === undefined) return sessions;
  return new Map(sessions).set(event.sessionId, {
    status,
    lastActivityMs: nowMs,
  });
}

/** Returns the new status, or `undefined` to ignore the event. */
function nextStatus(
  current: SlotStatus | undefined,
  event: Exclude<SessionEvent, { kind: "ended" }>,
): SlotStatus | undefined {
  switch (event.kind) {
    case "started":
      return event.resumedFromCompact && current !== undefined
        ? current
        : "idle";
    case "prompted":
      return "working";
    case "active":
      // A late tool event after the turn end must not relight blue.
      if (current === undefined || inTurn(current)) return "working";
      return undefined;
    case "awaiting-approval":
    case "awaiting-response":
      return event.kind;
    case "turn-ended":
      // A mod sees both Stop and turn.complete for one turn.
      if (current === undefined || inTurn(current)) {
        return TURN_END_STATUS[event.outcome];
      }
      return undefined;
  }
}

/**
 * Returns one signal per agent key: the sessions with the latest
 * activity first, and `off` for each key without a session.
 */
export function selectSlots(sessions: Sessions): SlotSignal[] {
  const recent = [...sessions.values()]
    .sort((a, b) => b.lastActivityMs - a.lastActivityMs)
    .slice(0, SLOT_COUNT);
  return Array.from({ length: SLOT_COUNT }, (_, i) => ({
    status: recent[i]?.status ?? "off",
    selected: false,
    pulsing: false,
  }));
}
