// The push-to-talk machine under fake time: the transitions and the
// 350 ms windows of research/codex-micro-state-machines.md section 5.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createPushToTalk,
  type PushToTalk,
  reduceTalk,
  TALK_WINDOW_MS,
  type TalkAction,
} from "../src/talk/index.js";

describe("push-to-talk", () => {
  let actions: TalkAction[];
  let phases: string[];
  let talk: PushToTalk;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    actions = [];
    phases = [];
    talk = createPushToTalk({
      onAction: (action) => actions.push(action),
      onState: (state) => phases.push(state.phase),
    });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const tap = (downMs = 50): void => {
    talk.press();
    vi.advanceTimersByTime(downMs);
    talk.release();
  };

  it("pins the window to 350 ms", () => {
    expect(TALK_WINDOW_MS).toBe(350);
  });

  it("records while the key is held", () => {
    talk.press();
    expect(actions).toEqual(["talk-start"]);
    vi.advanceTimersByTime(2000);
    expect(actions).toEqual(["talk-start"]);
    talk.release();
    expect(actions).toEqual(["talk-start", "talk-stop"]);
    expect(talk.state.phase).toBe("idle");
  });

  it("treats a release at exactly 350 ms as a hold", () => {
    talk.press();
    vi.advanceTimersByTime(350);
    talk.release();
    expect(actions).toEqual(["talk-start", "talk-stop"]);
    expect(talk.state.phase).toBe("idle");
  });

  it("keeps a single tap recording until 350 ms after the press", () => {
    talk.press();
    vi.advanceTimersByTime(349);
    talk.release();
    expect(talk.state.phase).toBe("waiting");
    expect(actions).toEqual(["talk-start"]);
    // The deadline counts from the press, not from the release.
    vi.advanceTimersByTime(1);
    expect(actions).toEqual(["talk-start", "talk-stop"]);
    expect(talk.state.phase).toBe("idle");
  });

  it("stops a 100 ms tap 250 ms after the release", () => {
    tap(100);
    vi.advanceTimersByTime(249);
    expect(actions).toEqual(["talk-start"]);
    vi.advanceTimersByTime(1);
    expect(actions).toEqual(["talk-start", "talk-stop"]);
  });

  it("latches on a second press inside the window", () => {
    tap(100);
    vi.advanceTimersByTime(249);
    talk.press();
    expect(talk.state.phase).toBe("latched");
    talk.release();
    vi.advanceTimersByTime(60_000);
    expect(talk.state.phase).toBe("latched");
    expect(actions).toEqual(["talk-start"]);
  });

  it("does not latch on a second press at the deadline", () => {
    tap(100);
    vi.advanceTimersByTime(250);
    talk.press();
    expect(talk.state.phase).toBe("pressed");
    expect(actions).toEqual(["talk-start", "talk-stop", "talk-start"]);
  });

  it("stops a latched recording on the next press", () => {
    tap();
    vi.advanceTimersByTime(100);
    tap();
    vi.advanceTimersByTime(5000);
    talk.press();
    expect(actions).toEqual(["talk-start", "talk-stop"]);
    expect(talk.state.phase).toBe("suppressing");
    talk.release();
    expect(talk.state.phase).toBe("suppressing");
  });

  it("ignores presses for 350 ms after the stopping press", () => {
    tap();
    vi.advanceTimersByTime(100);
    tap();
    talk.press();
    vi.advanceTimersByTime(349);
    talk.press();
    talk.release();
    expect(actions).toEqual(["talk-start", "talk-stop"]);
    vi.advanceTimersByTime(1);
    expect(talk.state.phase).toBe("idle");
    expect(actions).toEqual(["talk-start", "talk-stop"]);
    talk.press();
    expect(actions).toEqual(["talk-start", "talk-stop", "talk-start"]);
  });

  it("stops a recording on reset and stays silent when idle", () => {
    talk.reset();
    expect(actions).toEqual([]);
    tap();
    vi.advanceTimersByTime(100);
    tap();
    talk.reset();
    expect(actions).toEqual(["talk-start", "talk-stop"]);
    expect(talk.state.phase).toBe("idle");
    // The reset removed the pending timer.
    vi.advanceTimersByTime(1000);
    expect(actions).toEqual(["talk-start", "talk-stop"]);
  });

  it("ignores a release with no press and a repeated press", () => {
    talk.release();
    expect(actions).toEqual([]);
    talk.press();
    talk.press();
    expect(actions).toEqual(["talk-start"]);
  });

  it("reports each state change in order", () => {
    tap();
    vi.advanceTimersByTime(100);
    tap();
    talk.press();
    vi.advanceTimersByTime(350);
    expect(phases).toEqual([
      "pressed",
      "waiting",
      "latched",
      "suppressing",
      "idle",
    ]);
  });

  it("starts again on a press after a late suppression timer", () => {
    // The reducer alone: the timer did not fire, and a press arrives
    // after the deadline.
    const [state, none] = reduceTalk(
      { phase: "suppressing", deadlineMs: 500 },
      { kind: "press", atMs: 500 },
    );
    expect(state).toEqual({ phase: "pressed", pressedAtMs: 500 });
    expect(none).toEqual(["talk-start"]);
  });
});
