import {
  eventForTurn,
  HEARTBEAT_INTERVAL_MS,
  heartbeatEvent,
  postModEvent,
} from "../../../src/mods/report.ts";

// Optional glancepad mod. It posts an interrupt and a heartbeat.
// It does not post the events a settings hook already sends.
// Load: claude --plugin-dir scripts/glancepad-mod
// Targets Claude Code 2.1.287. The mod API is early access.

export const GLANCEPAD_EVENTS_URL = "http://127.0.0.1:4180/events";

interface SessionStartEvent {
  readonly sessionId?: string;
}

interface TurnCompleteEvent {
  readonly reason: string;
  readonly agentId?: string;
}

interface Dollar {
  session: { id: () => Promise<string> };
  clock: {
    every: (ms: number, tick: () => void | Promise<void>) => void;
  };
  http: {
    fetch: (
      url: string,
      init: { method: string; body: string },
    ) => Promise<unknown>;
  };
}

type Next<E> = (event: E) => E | Promise<E>;

export interface ModOn {
  (
    event: "session.start",
    hook: (
      $: Dollar,
      event: SessionStartEvent,
      next: Next<SessionStartEvent>,
    ) => Promise<unknown>,
  ): void;
  (
    event: "turn.complete",
    hook: (
      $: Dollar,
      event: TurnCompleteEvent,
      next: Next<TurnCompleteEvent>,
    ) => Promise<unknown>,
  ): void;
}

export const register = (on: ModOn): void => {
  let sessionId = "";
  let timerOn = false;

  on("session.start", async ($, event, next) => {
    sessionId = await $.session.id();
    if (!timerOn) {
      timerOn = true;
      $.clock.every(HEARTBEAT_INTERVAL_MS, () => {
        const beat = heartbeatEvent(sessionId);
        if (beat === undefined) return;
        void postModEvent(
          (body) =>
            $.http.fetch(GLANCEPAD_EVENTS_URL, { method: "POST", body }),
          beat,
        );
      });
    }
    return next(event);
  });

  on("turn.complete", async ($, event, next) => {
    const fact = eventForTurn({
      sessionId: await $.session.id(),
      reason: event.reason,
      agentId: event.agentId,
    });
    if (fact !== undefined) {
      await postModEvent(
        (body) => $.http.fetch(GLANCEPAD_EVENTS_URL, { method: "POST", body }),
        fact,
      );
    }
    return next(event);
  });
};
