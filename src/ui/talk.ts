// Push-to-talk, wired: key notifications from the transport drive the
// machine in src/talk, and each action of the machine runs the command
// of the user. The server adds this with a few lines.

import { onKeyEvent } from "../device/keyevents.js";
import type { DeviceTransport } from "../device/transport.js";
import { KEY_ACTS } from "../protocol/index.js";
import {
  createPushToTalk,
  isTalking,
  type TalkAction,
  type TalkClock,
} from "../talk/index.js";
import type { TalkOutcome } from "./talkaction.js";

// The identifiers of the microphone key. `ACT10_ACT11` is the merged
// key of the default layout. `ACT10` is the key when the two halves
// are separate. Both come from reading
// (research/codex-micro-agent-key-assignment.md, "Default hardware
// layout"). No keypad confirmed which one the firmware sends.
export const MICROPHONE_KEYS: readonly string[] = ["ACT10_ACT11", "ACT10"];

/** What the page and `GET /state` show. */
export interface TalkStatus {
  readonly phase: string;
  readonly talking: boolean;
  readonly lastAction: TalkAction | null;
  readonly lastOutcome: TalkOutcome | "running" | null;
}

export interface TalkWiringOptions {
  readonly runAction: (action: TalkAction) => Promise<TalkOutcome>;
  readonly onStatus?: (status: TalkStatus) => void;
  readonly clock?: TalkClock;
}

export interface TalkWiring {
  readonly status: TalkStatus;
  /** Stops a recording that runs, and leaves the transport. */
  close(): void;
}

export function attachPushToTalk(
  transport: DeviceTransport,
  options: TalkWiringOptions,
): TalkWiring {
  let lastAction: TalkStatus["lastAction"] = null;
  let lastOutcome: TalkStatus["lastOutcome"] = null;
  let actionCount = 0;

  const status = (): TalkStatus => ({
    phase: talk.state.phase,
    talking: isTalking(talk.state),
    lastAction,
    lastOutcome,
  });
  const publish = (): void => options.onStatus?.(status());

  const talk = createPushToTalk({
    ...(options.clock === undefined ? {} : { clock: options.clock }),
    onState: publish,
    onAction: (action) => {
      const count = ++actionCount;
      lastAction = action;
      lastOutcome = "running";
      publish();
      // A failed action must not reach the server as a rejection.
      options
        .runAction(action)
        .catch((): TalkOutcome => "failed")
        .then((outcome) => {
          if (count !== actionCount) return;
          lastOutcome = outcome;
          publish();
        });
    },
  });

  const unsubscribe = onKeyEvent(transport, ({ key, act }) => {
    if (!MICROPHONE_KEYS.includes(key)) return;
    if (act === KEY_ACTS.press) talk.press();
    if (act === KEY_ACTS.release) talk.release();
  });

  return {
    get status() {
      return status();
    },
    close: () => {
      unsubscribe();
      talk.reset();
    },
  };
}
