// The wire body an optional Claude Code mod posts to POST /events.
// Settings hooks do not send this shape. Issue 6 owns the hook body.
//
// Interrupt:
//   { source: "mod", kind: "turn-ended", sessionId, outcome: "interrupted" }
// Heartbeat:
//   { source: "mod", kind: "heartbeat", sessionId }
//
// The parser drops every other field. Prompt text and
// last_assistant_message never enter session state.

import type { SessionEvent } from "../sessions/index.js";

export const MOD_SOURCE = "mod" as const;

/** Loopback path the mod posts to. Issue 6 will share this path. */
export const MOD_EVENTS_PATH = "/events";

const MAX_SESSION_ID = 200;

export type ModEvent =
  | {
      readonly source: typeof MOD_SOURCE;
      readonly kind: "turn-ended";
      readonly sessionId: string;
      readonly outcome: "interrupted";
    }
  | {
      readonly source: typeof MOD_SOURCE;
      readonly kind: "heartbeat";
      readonly sessionId: string;
    };

export function toSessionEvent(event: ModEvent): SessionEvent {
  if (event.kind === "heartbeat") {
    return { kind: "heartbeat", sessionId: event.sessionId };
  }
  return {
    kind: "turn-ended",
    sessionId: event.sessionId,
    outcome: "interrupted",
  };
}

const sessionIdOf = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  if (value.length === 0 || value.length > MAX_SESSION_ID) return undefined;
  return value;
};

/**
 * Returns a mod event, or `undefined` for anything else. A hook body,
 * an `answer` outcome, and extra fields all return `undefined`.
 */
export function parseModEvent(value: unknown): ModEvent | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;
  if (record.source !== MOD_SOURCE) return undefined;
  const sessionId = sessionIdOf(record.sessionId);
  if (sessionId === undefined) return undefined;
  if (record.kind === "heartbeat") {
    return { source: MOD_SOURCE, kind: "heartbeat", sessionId };
  }
  if (record.kind === "turn-ended" && record.outcome === "interrupted") {
    return {
      source: MOD_SOURCE,
      kind: "turn-ended",
      sessionId,
      outcome: "interrupted",
    };
  }
  return undefined;
}
