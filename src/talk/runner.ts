// Runs the push-to-talk reducer against a clock. It stamps each key
// event, keeps the one pending timer, and reports each action. The
// clock is a parameter, so the tests use fake time.

import {
  initialTalkState,
  reduceTalk,
  type TalkAction,
  type TalkEvent,
  type TalkState,
  talkDeadlineMs,
} from "./machine.js";

/** The time source and the timer. The default is the system clock. */
export interface TalkClock {
  now(): number;
  setTimer(run: () => void, delayMs: number): unknown;
  clearTimer(handle: unknown): void;
}

export const systemTalkClock: TalkClock = {
  now: () => Date.now(),
  setTimer: (run, delayMs) => setTimeout(run, delayMs),
  clearTimer: (handle) => clearTimeout(handle as NodeJS.Timeout),
};

export interface PushToTalk {
  readonly state: TalkState;
  /** The microphone key went down. */
  press(): void;
  /** The microphone key went up. */
  release(): void;
  /** Returns to idle. Stops a recording that runs. */
  reset(): void;
}

export interface PushToTalkOptions {
  readonly clock?: TalkClock;
  /** Called one time for each action, in order. It must not throw. */
  readonly onAction: (action: TalkAction) => void;
  /** Called after each state change. */
  readonly onState?: (state: TalkState) => void;
}

export function createPushToTalk(options: PushToTalkOptions): PushToTalk {
  const clock = options.clock ?? systemTalkClock;
  let state = initialTalkState;
  let timer: unknown;

  const dispatch = (event: TalkEvent): void => {
    const [next, actions] = reduceTalk(state, event);
    if (next !== state) {
      state = next;
      clock.clearTimer(timer);
      timer = undefined;
      const deadlineMs = talkDeadlineMs(state);
      if (deadlineMs !== undefined) {
        timer = clock.setTimer(
          // A system timer can fire a millisecond early. The timer of
          // this deadline fired, so the deadline counts as reached.
          () =>
            dispatch({
              kind: "timeout",
              atMs: Math.max(clock.now(), deadlineMs),
            }),
          Math.max(0, deadlineMs - clock.now()),
        );
      }
      options.onState?.(state);
    }
    for (const action of actions) options.onAction(action);
  };

  return {
    get state() {
      return state;
    },
    press: () => dispatch({ kind: "press", atMs: clock.now() }),
    release: () => dispatch({ kind: "release", atMs: clock.now() }),
    reset: () => dispatch({ kind: "reset" }),
  };
}
