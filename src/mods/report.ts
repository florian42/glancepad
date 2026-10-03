// Which events the optional mod posts. No I/O. The plugin in
// scripts/glancepad-mod calls these, then posts with $.http.fetch.

import { MOD_SOURCE, type ModEvent } from "./mod-event.js";

/** The mod posts a heartbeat this often. Three intervals equal the silence window. */
export const HEARTBEAT_INTERVAL_MS = 5_000;

export interface TurnFact {
  readonly sessionId: string;
  readonly reason: string;
  /** Present when the turn belongs to a subagent. Drop those turns. */
  readonly agentId?: string | null;
}

/**
 * The one turn event hooks cannot see: `turn.complete` with reason
 * `aborted`. Any other reason, and any turn that carries `agentId`,
 * posts nothing.
 */
export function eventForTurn(fact: TurnFact): ModEvent | undefined {
  if (fact.agentId != null) return undefined;
  if (fact.reason !== "aborted") return undefined;
  if (fact.sessionId === "") return undefined;
  return {
    source: MOD_SOURCE,
    kind: "turn-ended",
    sessionId: fact.sessionId,
    outcome: "interrupted",
  };
}

export function heartbeatEvent(sessionId: string): ModEvent | undefined {
  if (sessionId === "") return undefined;
  return { source: MOD_SOURCE, kind: "heartbeat", sessionId };
}

/**
 * Posts one event. A rejected post is silence: glancepad is down,
 * and the hook must not fail.
 */
export async function postModEvent(
  post: (body: string) => Promise<unknown>,
  event: ModEvent,
): Promise<void> {
  try {
    await post(JSON.stringify(event));
  } catch {
    // glancepad is down. Stay silent.
  }
}
