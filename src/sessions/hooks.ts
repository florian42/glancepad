// Settings-hook payloads to session events. The status table is in
// research/claude-code-session-signals.md. The adapter reads only the
// fields below and builds a new object, so prompt text and
// last_assistant_message never leave this function.
//
//   hook_event_name  which row of the table
//   session_id       session id
//   cwd              SessionStart only
//   source           SessionStart only; "compact" keeps the status
//   tool_name        PreToolUse only; "AskUserQuestion" waits

import type { SessionEvent } from "./sessions.js";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Translates one settings-hook payload into a session event.
 * Returns `undefined` for events outside the status table, and for a
 * payload that has no session id.
 */
export function sessionEventFromHook(
  payload: unknown,
): SessionEvent | undefined {
  if (!isRecord(payload)) return undefined;
  const sessionId = payload.session_id;
  const name = payload.hook_event_name;
  if (typeof sessionId !== "string" || sessionId.length === 0) return undefined;
  if (typeof name !== "string") return undefined;

  switch (name) {
    case "SessionStart":
      return {
        kind: "started",
        sessionId,
        cwd: typeof payload.cwd === "string" ? payload.cwd : "",
        resumedFromCompact: payload.source === "compact",
      };
    case "UserPromptSubmit":
      return { kind: "prompted", sessionId };
    case "PreToolUse":
      return payload.tool_name === "AskUserQuestion"
        ? { kind: "awaiting-response", sessionId }
        : { kind: "active", sessionId };
    case "PostToolUse":
    case "PostToolUseFailure":
    case "SubagentStart":
    case "SubagentStop":
      return { kind: "active", sessionId };
    case "PermissionRequest":
      return { kind: "awaiting-approval", sessionId };
    case "Stop":
      return { kind: "turn-ended", sessionId, outcome: "answer" };
    case "StopFailure":
      return { kind: "turn-ended", sessionId, outcome: "error" };
    case "SessionEnd":
      return { kind: "ended", sessionId };
    default:
      return undefined;
  }
}
