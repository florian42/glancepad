// The agent-key tap machine. The source behavior is in
// research/codex-micro-state-machines.md, section 4. A pure reducer:
// the caller supplies the time of each press and threads the state.
//
// The parts of the source machine that glancepad does not have are
// left out: the session lock, the custom action keys, and the closed
// application window.

/** Two presses this close together are a double tap. From section 4. */
export const DOUBLE_TAP_WINDOW_MS = 350;

/** The first press of a possible double tap. */
export interface ArmedTap {
  readonly slot: number;
  readonly sessionId: string;
  readonly pressedAtMs: number;
}

/** `null` when no press is armed. */
export type TapState = ArmedTap | null;

export const initialTapState: TapState = null;

export interface TapOptions {
  /**
   * When true, one press activates. When false, only the second press
   * of a double tap activates. The default is true.
   */
  readonly singleTap?: boolean;
  readonly doubleTapWindowMs?: number;
}

/** One press of an agent key. `sessionId` is `null` for an empty key. */
export interface TapPress {
  readonly slot: number;
  readonly sessionId: string | null;
  readonly nowMs: number;
}

export interface TapResult {
  readonly state: TapState;
  /** The session to bring to the front, or `null` for no action. */
  readonly activate: string | null;
}

/**
 * Applies one key press. A press on an empty key does nothing and
 * disarms the machine. A release is not an input: the machine acts on
 * the press, as the source machine does.
 */
export function reduceTap(
  state: TapState,
  press: TapPress,
  options: TapOptions = {},
): TapResult {
  const { slot, sessionId, nowMs } = press;
  if (sessionId === null) return { state: null, activate: null };

  const windowMs = options.doubleTapWindowMs ?? DOUBLE_TAP_WINDOW_MS;
  const elapsedMs = state === null ? -1 : nowMs - state.pressedAtMs;
  const doubleTap =
    state !== null &&
    state.slot === slot &&
    state.sessionId === sessionId &&
    elapsedMs >= 0 &&
    elapsedMs <= windowMs;

  if (doubleTap || (options.singleTap ?? true)) {
    return { state: null, activate: sessionId };
  }
  return { state: { slot, sessionId, pressedAtMs: nowMs }, activate: null };
}
