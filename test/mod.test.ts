// The optional mod posts an interrupt and a heartbeat. It stays silent
// when the post fails. It does not post events a settings hook already
// sends. Issue 10.

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  eventForTurn,
  HEARTBEAT_INTERVAL_MS,
  heartbeatEvent,
  parseModEvent,
  postModEvent,
} from "../src/mods/index.js";
import { SESSION_SILENCE_MS } from "../src/sessions/index.js";
import { DEFAULT_PORT } from "../src/ui/port.js";

describe("eventForTurn", () => {
  it("posts one interrupt for an aborted turn", () => {
    const event = eventForTurn({ sessionId: "s", reason: "aborted" });
    expect(event).toEqual({
      source: "mod",
      kind: "turn-ended",
      sessionId: "s",
      outcome: "interrupted",
    });
    expect(Object.keys(event ?? {}).sort()).toEqual([
      "kind",
      "outcome",
      "sessionId",
      "source",
    ]);
    expect(parseModEvent(event)).toEqual(event);
  });

  it("posts nothing for hook outcomes and for a subagent turn", () => {
    for (const reason of ["answer", "error", "refusal"]) {
      expect(eventForTurn({ sessionId: "s", reason })).toBeUndefined();
    }
    expect(
      eventForTurn({ sessionId: "s", reason: "aborted", agentId: "agent-1" }),
    ).toBeUndefined();
    expect(
      eventForTurn({ sessionId: "s", reason: "answer", agentId: "agent-1" }),
    ).toBeUndefined();
    expect(eventForTurn({ sessionId: "", reason: "aborted" })).toBeUndefined();
  });

  it("posts a heartbeat the parser accepts, and nothing else", () => {
    const event = heartbeatEvent("s");
    expect(event).toEqual({
      source: "mod",
      kind: "heartbeat",
      sessionId: "s",
    });
    expect(Object.keys(event ?? {}).sort()).toEqual([
      "kind",
      "sessionId",
      "source",
    ]);
    expect(parseModEvent(event)).toEqual(event);
    expect(heartbeatEvent("")).toBeUndefined();
  });

  it("locks the heartbeat interval to the silence window", () => {
    expect(HEARTBEAT_INTERVAL_MS * 3).toBe(SESSION_SILENCE_MS);
  });
});

describe("postModEvent", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("posts the event JSON and no other fields", async () => {
    const bodies: string[] = [];
    const event = eventForTurn({ sessionId: "s", reason: "aborted" });
    if (event === undefined) throw new Error("expected an interrupt");
    await postModEvent(async (body) => {
      bodies.push(body);
    }, event);
    expect(bodies).toEqual([JSON.stringify(event)]);
    expect(bodies[0]).not.toContain("last_assistant_message");
    expect(bodies[0]).not.toContain("prompt");
  });

  it("stays silent when the post fails", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
    const event = heartbeatEvent("secret-session");
    if (event === undefined) throw new Error("expected a heartbeat");
    await expect(
      postModEvent(async () => {
        throw new Error("connect ECONNREFUSED 127.0.0.1:4180");
      }, event),
    ).resolves.toBeUndefined();
    const text = [log, error, warn, info, debug]
      .flatMap((spy) => spy.mock.calls.flat())
      .map(String)
      .join("\n");
    expect(text).not.toContain("secret-session");
    expect(log).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });
});

describe("register", () => {
  interface Posted {
    url: string;
    body: string;
  }

  type Hook = (
    $: unknown,
    event: unknown,
    next: (event: unknown) => unknown,
  ) => Promise<unknown>;

  interface Harness {
    events: string[];
    posted: Posted[];
    eventsUrl: string;
    failNext: boolean;
    start: (id: string) => Promise<void>;
    complete: (reason: string, agentId?: string) => Promise<void>;
    beat: () => Promise<void>;
  }

  async function harness(): Promise<Harness> {
    const pluginUrl = new URL(
      "../scripts/glancepad-mod/hooks/register.ts",
      import.meta.url,
    );
    const plugin = (await import(pluginUrl.href)) as {
      GLANCEPAD_EVENTS_URL: string;
      register: (on: (event: string, hook: Hook) => void) => void;
    };
    const events: string[] = [];
    const posted: Posted[] = [];
    let failNext = false;
    let beat = async (): Promise<void> => {};
    const hooks = new Map<string, Hook>();
    const dollar = {
      session: { id: async () => "session-1" },
      clock: {
        every: (_ms: number, tick: () => void | Promise<void>) => {
          beat = async () => {
            await tick();
          };
        },
      },
      http: {
        fetch: async (url: string, init: { method: string; body: string }) => {
          if (failNext) {
            failNext = false;
            throw new Error("connect ECONNREFUSED");
          }
          posted.push({ url, body: init.body });
          return { status: 204 };
        },
      },
    };
    plugin.register((event, hook) => {
      events.push(event);
      hooks.set(event, hook);
    });
    const call = async (name: string, event: unknown) => {
      const hook = hooks.get(name);
      if (hook === undefined) throw new Error(`missing ${name}`);
      let continued = false;
      await hook(dollar, event, (value) => {
        continued = true;
        return value;
      });
      expect(continued).toBe(true);
    };
    return {
      events,
      posted,
      eventsUrl: plugin.GLANCEPAD_EVENTS_URL,
      get failNext() {
        return failNext;
      },
      set failNext(value: boolean) {
        failNext = value;
      },
      start: (id: string) => {
        dollar.session.id = async () => id;
        return call("session.start", {});
      },
      complete: (reason: string, agentId?: string) =>
        call("turn.complete", {
          reason,
          ...(agentId === undefined ? {} : { agentId }),
        }),
      beat: () => beat(),
    };
  }

  it("registers only session.start and turn.complete", async () => {
    const mod = await harness();
    expect(mod.events).toEqual(["session.start", "turn.complete"]);
    expect(mod.eventsUrl).toBe(`http://127.0.0.1:${DEFAULT_PORT}/events`);
  });

  it("posts an interrupt and a heartbeat, and skips hook outcomes", async () => {
    const mod = await harness();
    await mod.start("session-1");
    expect(mod.posted).toEqual([]);
    await mod.complete("answer");
    await mod.complete("error");
    await mod.complete("refusal");
    await mod.complete("aborted", "subagent-9");
    expect(mod.posted).toEqual([]);
    await mod.complete("aborted");
    await mod.beat();
    expect(mod.posted.map((item) => JSON.parse(item.body))).toEqual([
      {
        source: "mod",
        kind: "turn-ended",
        sessionId: "session-1",
        outcome: "interrupted",
      },
      { source: "mod", kind: "heartbeat", sessionId: "session-1" },
    ]);
    expect(mod.posted.every((item) => item.url === mod.eventsUrl)).toBe(true);
    for (const item of mod.posted) {
      expect(item.body).not.toContain("last_assistant_message");
      expect(item.body).not.toContain("agentId");
    }
  });

  it("calls next when the post fails and writes nothing", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const mod = await harness();
    await mod.start("secret-session");
    mod.failNext = true;
    await mod.complete("aborted");
    mod.failNext = true;
    await mod.beat();
    expect(mod.posted).toEqual([]);
    expect(log).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });
});
