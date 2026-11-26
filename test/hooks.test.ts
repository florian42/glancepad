// Settings-hook payloads to session events — issue #6. The payloads
// follow the hook input examples in the Claude Code hooks reference
// (fetched 2026-10-03). The adapter must drop prompt text and
// last_assistant_message.

import { describe, expect, it } from "vitest";
import { sessionEventFromHook } from "../src/sessions/index.js";

const SECRET_PROMPT = "PROMPT_TEXT_MUST_NOT_LEAK";
const SECRET_REPLY = "ASSISTANT_TEXT_MUST_NOT_LEAK";

/** A documented hook body, plus the two fields the adapter must drop. */
const payload = (
  hookEventName: string,
  extra: Record<string, unknown> = {},
) => ({
  session_id: "abc123",
  transcript_path: "/tmp/transcript.jsonl",
  cwd: "/work/glancepad",
  permission_mode: "default",
  hook_event_name: hookEventName,
  prompt: SECRET_PROMPT,
  last_assistant_message: SECRET_REPLY,
  ...extra,
});

const dropped = (value: unknown): void => {
  expect(JSON.stringify(value)).not.toContain("MUST_NOT_LEAK");
};

describe("sessionEventFromHook", () => {
  it("maps each accepted event to one session event", () => {
    const cases: { body: unknown; event: unknown }[] = [
      {
        body: payload("SessionStart", { source: "startup" }),
        event: {
          kind: "started",
          sessionId: "abc123",
          cwd: "/work/glancepad",
          resumedFromCompact: false,
        },
      },
      {
        body: payload("SessionStart", { source: "compact" }),
        event: {
          kind: "started",
          sessionId: "abc123",
          cwd: "/work/glancepad",
          resumedFromCompact: true,
        },
      },
      {
        body: payload("UserPromptSubmit"),
        event: { kind: "prompted", sessionId: "abc123" },
      },
      {
        body: payload("PreToolUse", {
          tool_name: "Bash",
          tool_input: { command: "npm test" },
        }),
        event: { kind: "active", sessionId: "abc123" },
      },
      {
        body: payload("PreToolUse", { tool_name: "AskUserQuestion" }),
        event: { kind: "awaiting-response", sessionId: "abc123" },
      },
      {
        body: payload("PostToolUse", { tool_name: "Write" }),
        event: { kind: "active", sessionId: "abc123" },
      },
      {
        body: payload("PostToolUseFailure", { tool_name: "Bash" }),
        event: { kind: "active", sessionId: "abc123" },
      },
      {
        body: payload("SubagentStart", { agent_type: "Explore" }),
        event: { kind: "active", sessionId: "abc123" },
      },
      {
        body: payload("SubagentStop", { agent_type: "Explore" }),
        event: { kind: "active", sessionId: "abc123" },
      },
      {
        body: payload("PermissionRequest", { tool_name: "Bash" }),
        event: { kind: "awaiting-approval", sessionId: "abc123" },
      },
      {
        body: payload("Stop"),
        event: {
          kind: "turn-ended",
          sessionId: "abc123",
          outcome: "answer",
        },
      },
      {
        body: payload("StopFailure", { error: "rate_limit" }),
        event: {
          kind: "turn-ended",
          sessionId: "abc123",
          outcome: "error",
        },
      },
      {
        body: payload("SessionEnd", { reason: "other" }),
        event: { kind: "ended", sessionId: "abc123" },
      },
    ];

    for (const { body, event } of cases) {
      const got = sessionEventFromHook(body);
      expect(got).toEqual(event);
      dropped(got);
    }
  });

  it("ignores events outside the status table", () => {
    expect(
      sessionEventFromHook(
        payload("Notification", { notification_type: "permission_prompt" }),
      ),
    ).toBeUndefined();
    expect(
      sessionEventFromHook(payload("PermissionDenied", { tool_name: "Bash" })),
    ).toBeUndefined();
    expect(sessionEventFromHook(payload("PreCompact"))).toBeUndefined();
    expect(sessionEventFromHook(payload("PostCompact"))).toBeUndefined();
  });

  it("ignores a payload with no session id", () => {
    expect(
      sessionEventFromHook({ hook_event_name: "Stop", prompt: SECRET_PROMPT }),
    ).toBeUndefined();
    expect(sessionEventFromHook(null)).toBeUndefined();
    expect(sessionEventFromHook("Stop")).toBeUndefined();
  });
});

describe("scripts/glancepad.settings.json", () => {
  // Observed on Claude Code 2.1.332: a `type: "http"` hook prints a
  // "hook failed" notice for each event when nothing listens on the
  // port. A command hook that ends in `|| true` stays silent.
  it("registers a silent command hook for each event the adapter reads", async () => {
    const { readFile } = await import("node:fs/promises");
    const { DEFAULT_PORT } = await import("../src/ui/port.js");
    const snippet = JSON.parse(
      await readFile(
        new URL("../scripts/glancepad.settings.json", import.meta.url),
        "utf8",
      ),
    ) as {
      hooks: Record<string, { hooks: { type: string; command: string }[] }[]>;
    };
    for (const [name, groups] of Object.entries(snippet.hooks)) {
      const hooks = groups.flatMap((group) => group.hooks);
      expect(hooks).toHaveLength(1);
      expect(hooks[0]?.type).toBe("command");
      expect(hooks[0]?.command).toContain(
        `http://127.0.0.1:${DEFAULT_PORT}/events`,
      );
      expect(hooks[0]?.command).toMatch(/\|\| true$/);
      expect(
        sessionEventFromHook({ hook_event_name: name, session_id: "s" }),
      ).toBeDefined();
    }
  });
});
