// The push-to-talk key machine, as a pure reducer. The behavior and
// the 350 ms window come from research/codex-micro-state-machines.md
// section 5. Each event carries its own time, so this file reads no
// clock and starts no timer. src/talk/runner.ts owns the timer.

/** Both windows of the machine use this one duration. */
export const TALK_WINDOW_MS = 350;

export type TalkState =
  | { readonly phase: "idle" }
  /** The key is down and the recording runs. */
  | { readonly phase: "pressed"; readonly pressedAtMs: number }
  /** A quick tap ended. A second press before the deadline latches. */
  | { readonly phase: "waiting"; readonly deadlineMs: number }
  /** Hands-free. The recording runs until the next press. */
  | { readonly phase: "latched" }
  /** The stopping press came. Presses before the deadline do nothing. */
  | { readonly phase: "suppressing"; readonly deadlineMs: number };

export type TalkEvent =
  | { readonly kind: "press"; readonly atMs: number }
  | { readonly kind: "release"; readonly atMs: number }
  /** The runner sends this when the deadline of a state arrives. */
  | { readonly kind: "timeout"; readonly atMs: number }
  /** The device left, or the feature went off. */
  | { readonly kind: "reset" };

export type TalkAction = "talk-start" | "talk-stop";

export const initialTalkState: TalkState = { phase: "idle" };

const IDLE: TalkState = { phase: "idle" };
const NONE: readonly TalkAction[] = [];

/** True while a recording runs. */
export const isTalking = (state: TalkState): boolean =>
  state.phase === "pressed" ||
  state.phase === "waiting" ||
  state.phase === "latched";

/** The time at which the runner must send a timeout, if any. */
export const talkDeadlineMs = (state: TalkState): number | undefined =>
  state.phase === "waiting" || state.phase === "suppressing"
    ? state.deadlineMs
    : undefined;

/**
 * Applies one event. Returns the next state and the actions to run, in
 * order. An event with no meaning in the current state returns the
 * same state object and no action.
 */
export function reduceTalk(
  state: TalkState,
  event: TalkEvent,
): readonly [TalkState, readonly TalkAction[]] {
  if (event.kind === "reset") {
    return [IDLE, isTalking(state) ? ["talk-stop"] : NONE];
  }
  const pressed = (): TalkState => ({
    phase: "pressed",
    pressedAtMs: event.atMs,
  });

  switch (state.phase) {
    case "idle":
      return event.kind === "press"
        ? [pressed(), ["talk-start"]]
        : [state, NONE];

    case "pressed":
      if (event.kind !== "release") return [state, NONE];
      // A hold. The release stops the recording.
      if (event.atMs - state.pressedAtMs >= TALK_WINDOW_MS) {
        return [IDLE, ["talk-stop"]];
      }
      // A quick tap. The recording continues until the deadline.
      return [
        {
          phase: "waiting",
          deadlineMs: state.pressedAtMs + TALK_WINDOW_MS,
        },
        NONE,
      ];

    case "waiting":
      if (event.kind === "release") return [state, NONE];
      if (event.atMs >= state.deadlineMs) {
        // The deadline passed. A late timer must not let a late press
        // latch, so a press here stops the old recording and starts a
        // new one. This order is our decision. The research note does
        // not cover it.
        return event.kind === "press"
          ? [pressed(), ["talk-stop", "talk-start"]]
          : [IDLE, ["talk-stop"]];
      }
      // A timeout before the deadline does nothing. The runner never
      // sends one.
      return event.kind === "press"
        ? [{ phase: "latched" }, NONE]
        : [state, NONE];

    case "latched":
      return event.kind === "press"
        ? [
            {
              phase: "suppressing",
              deadlineMs: event.atMs + TALK_WINDOW_MS,
            },
            ["talk-stop"],
          ]
        : [state, NONE];

    case "suppressing":
      if (event.kind === "release") return [state, NONE];
      if (event.atMs < state.deadlineMs) return [state, NONE];
      return event.kind === "press"
        ? [pressed(), ["talk-start"]]
        : [IDLE, NONE];
  }
}
