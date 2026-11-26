// The agent-key tap machine: transitions and the double-tap window,
// with the time supplied by the test.

import { describe, expect, it } from "vitest";
import {
  DOUBLE_TAP_WINDOW_MS,
  initialTapState,
  reduceTap,
  type TapOptions,
  type TapState,
} from "../src/sessions/index.js";

const doubleTap: TapOptions = { singleTap: false };

/** Feeds presses in order. Returns the activation of each press. */
function run(
  presses: readonly [slot: number, sessionId: string | null, nowMs: number][],
  options?: TapOptions,
): (string | null)[] {
  let state: TapState = initialTapState;
  return presses.map(([slot, sessionId, nowMs]) => {
    const result = reduceTap(state, { slot, sessionId, nowMs }, options);
    state = result.state;
    return result.activate;
  });
}

describe("the double-tap window", () => {
  it("is 350 ms", () => {
    expect(DOUBLE_TAP_WINDOW_MS).toBe(350);
  });
});

describe("single-tap mode, the default", () => {
  it("activates on the first press", () => {
    expect(run([[2, "a", 1000]])).toEqual(["a"]);
  });

  it("activates on each press, and never arms", () => {
    expect(
      run([
        [2, "a", 1000],
        [2, "a", 1100],
        [3, "b", 1200],
      ]),
    ).toEqual(["a", "a", "b"]);
    expect(
      reduceTap(null, { slot: 2, sessionId: "a", nowMs: 1000 }).state,
    ).toBeNull();
  });

  it("does nothing on an empty key", () => {
    expect(run([[4, null, 1000]])).toEqual([null]);
  });
});

describe("double-tap mode", () => {
  it("arms on the first press, and does not activate", () => {
    const result = reduceTap(
      null,
      { slot: 1, sessionId: "a", nowMs: 1000 },
      doubleTap,
    );
    expect(result.activate).toBeNull();
    expect(result.state).toEqual({
      slot: 1,
      sessionId: "a",
      pressedAtMs: 1000,
    });
  });

  it("activates on a second press at the edge of the window", () => {
    expect(
      run(
        [
          [1, "a", 1000],
          [1, "a", 1000 + DOUBLE_TAP_WINDOW_MS],
        ],
        doubleTap,
      ),
    ).toEqual([null, "a"]);
  });

  it("does not activate 1 ms after the window, and arms again", () => {
    expect(
      run(
        [
          [1, "a", 1000],
          [1, "a", 1000 + DOUBLE_TAP_WINDOW_MS + 1],
          [1, "a", 1000 + DOUBLE_TAP_WINDOW_MS + 2],
        ],
        doubleTap,
      ),
    ).toEqual([null, null, "a"]);
  });

  it("disarms after an activation, so a third press arms again", () => {
    expect(
      run(
        [
          [1, "a", 1000],
          [1, "a", 1100],
          [1, "a", 1200],
        ],
        doubleTap,
      ),
    ).toEqual([null, "a", null]);
  });

  it("does not pair presses on two keys", () => {
    expect(
      run(
        [
          [1, "a", 1000],
          [2, "b", 1100],
          [2, "b", 1200],
        ],
        doubleTap,
      ),
    ).toEqual([null, null, "b"]);
  });

  it("does not pair presses when the key changed its session", () => {
    expect(
      run(
        [
          [1, "a", 1000],
          [1, "b", 1100],
        ],
        doubleTap,
      ),
    ).toEqual([null, null]);
  });

  it("does not pair a press with an earlier time", () => {
    expect(
      run(
        [
          [1, "a", 1000],
          [1, "a", 900],
        ],
        doubleTap,
      ),
    ).toEqual([null, null]);
  });

  it("disarms on an empty key", () => {
    expect(
      run(
        [
          [1, "a", 1000],
          [3, null, 1050],
          [1, "a", 1100],
        ],
        doubleTap,
      ),
    ).toEqual([null, null, null]);
  });

  it("honors a window override", () => {
    expect(
      run(
        [
          [1, "a", 1000],
          [1, "a", 1101],
        ],
        { singleTap: false, doubleTapWindowMs: 100 },
      ),
    ).toEqual([null, null]);
  });
});
