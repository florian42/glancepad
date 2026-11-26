// Which events the optional mod posts. No I/O, and no imports: Claude
// Code refuses a hooks module that imports from outside the plugin
// folder (observed on 2.1.332). The wire shape must match
// src/mods/mod-event.ts. test/mod.test.ts checks that it does.

/** The mod posts a heartbeat this often. Three intervals equal the silence window. */
export const HEARTBEAT_INTERVAL_MS = 5_000;

export type PostedEvent =
  | {
      readonly source: "mod";
      readonly kind: "turn-ended";
      readonly sessionId: string;
      readonly outcome: "interrupted";
    }
  | {
      readonly source: "mod";
      readonly kind: "heartbeat";
      readonly sessionId: string;
    };

export interface TurnFact {
  readonly sessionId: string;
  readonly reason: string;
  /** Present when the turn belongs to a subagent. Drop those turns. */
  readonly agentId?: string | null;
  /** True when `Stop` or `StopFailure` fired in this turn. */
  readonly stopSeen: boolean;
}

/**
 * The turn ends that settings hooks cannot see. Esc ends a turn with
 * reason `aborted` and no `Stop`. A denied permission dialog ends a
 * turn with reason `answer` and no `Stop`. Both captures are in
 * research/claude-code-mods-as-state-source.md. Any other turn, and
 * any turn that carries `agentId`, posts nothing.
 */
export function eventForTurn(fact: TurnFact): PostedEvent | undefined {
  if (fact.agentId != null) return undefined;
  if (fact.sessionId === "") return undefined;
  const hidden =
    fact.reason === "aborted" || (fact.reason === "answer" && !fact.stopSeen);
  if (!hidden) return undefined;
  return {
    source: "mod",
    kind: "turn-ended",
    sessionId: fact.sessionId,
    outcome: "interrupted",
  };
}

export function heartbeatEvent(sessionId: string): PostedEvent | undefined {
  if (sessionId === "") return undefined;
  return { source: "mod", kind: "heartbeat", sessionId };
}

/**
 * Posts one event. A rejected post is silence: glancepad is down,
 * and the hook must not fail.
 */
export async function postModEvent(
  post: (body: string) => Promise<unknown>,
  event: PostedEvent,
): Promise<void> {
  try {
    await post(JSON.stringify(event));
  } catch {
    // glancepad is down. Stay silent.
  }
}
