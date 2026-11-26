// Agent-key taps: the key event to the focus call and the
// mark-as-read call.

import { describe, expect, it } from "vitest";
import {
  type AgentTapsOptions,
  createAgentTaps,
  type FocusResult,
} from "../src/focus/index.js";

function setup(overrides: Partial<AgentTapsOptions> = {}) {
  const focused: number[] = [];
  const read: string[] = [];
  const failures: string[] = [];
  let nowMs = 1000;
  const taps = createAgentTaps({
    sessionIds: () => ["a", "b", null, null, null, null],
    markRead: (sessionId) => {
      read.push(sessionId);
    },
    focuser: {
      focusProcess: async (pid): Promise<FocusResult> => {
        focused.push(pid);
        return { focused: true, window: "0x1" };
      },
    },
    now: () => nowMs,
    onFocusFailure: (sessionId, reason) => {
      failures.push(`${sessionId}: ${reason}`);
    },
    ...overrides,
  });
  taps.setProcess("a", 111);
  taps.setProcess("b", 222);
  return {
    taps,
    focused,
    read,
    failures,
    advance: (ms: number) => {
      nowMs += ms;
    },
  };
}

describe("agent taps", () => {
  it("focuses the session of the key and marks it as read", async () => {
    const { taps, focused, read } = setup();
    expect(await taps.key("AG01", 1)).toBe("b");
    expect(focused).toEqual([222]);
    expect(read).toEqual(["b"]);
  });

  it("does nothing on a release", async () => {
    const { taps, focused, read } = setup();
    expect(await taps.key("AG01", 0)).toBeNull();
    expect(focused).toEqual([]);
    expect(read).toEqual([]);
  });

  it("does nothing on an empty key", async () => {
    const { taps, focused, read } = setup();
    expect(await taps.key("AG04", 1)).toBeNull();
    expect(focused).toEqual([]);
    expect(read).toEqual([]);
  });

  it("does nothing on a command key", async () => {
    const { taps, focused } = setup();
    expect(await taps.key("ACT06", 1)).toBeNull();
    expect(focused).toEqual([]);
  });

  it("marks as read when the focus fails, and does not reject", async () => {
    const { taps, read, failures } = setup({
      focuser: {
        focusProcess: async () => {
          throw new Error("boom");
        },
      },
    });
    expect(await taps.key("AG00", 1)).toBe("a");
    expect(read).toEqual(["a"]);
    expect(failures).toEqual(["a: Error: boom"]);
  });

  it("reports a session that sent no process id", async () => {
    const { taps, focused, read, failures } = setup();
    taps.forget("a");
    expect(await taps.key("AG00", 1)).toBe("a");
    expect(focused).toEqual([]);
    expect(read).toEqual(["a"]);
    expect(failures).toEqual(["a: the session reported no process"]);
  });

  it("waits for the second press in double-tap mode", async () => {
    const { taps, focused, advance } = setup({ tap: { singleTap: false } });
    expect(await taps.key("AG00", 1)).toBeNull();
    advance(350);
    expect(await taps.key("AG00", 1)).toBe("a");
    advance(1);
    expect(await taps.key("AG00", 1)).toBeNull();
    advance(351);
    expect(await taps.key("AG00", 1)).toBeNull();
    expect(focused).toEqual([111]);
  });
});
