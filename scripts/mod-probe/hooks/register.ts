import type { EngineInterface, Register } from "claude-code";
import { atom, update } from "claude-code";

// The record type lives here, not in a declaration file: the CI marker
// scan refuses every tracked .d.ts file, because vendor typings are
// .d.ts files.
type ProbeRecord = {
  at: number;
  event: string;
  detail: Record<string, unknown>;
};

declare module "claude-code" {
  interface PluginState {
    "glancepad-probe": { records: ProbeRecord[] };
  }
}

// A throwaway probe: it records which mod events fire, and in what order,
// so research/claude-code-mods-as-state-source.md can cite observed behaviour.
// Use: claude --plugin-dir scripts/mod-probe
const LOG = "/tmp/glancepad-mod-events.jsonl";
const MAX = 500;

const records = atom(
  { plugin: "glancepad-probe", key: "records" } as const,
  [] as ProbeRecord[],
);

async function record(
  $: EngineInterface,
  event: string,
  detail: Record<string, unknown>,
) {
  const at = await $.clock.now();
  const all = await update($, records, (rs) =>
    [...rs, { at, event, detail }].slice(-MAX),
  );
  await $.fs.write(LOG, `${all.map((r) => JSON.stringify(r)).join("\n")}\n`);
}

export const register: Register = (on) => {
  on("session.start", async ($, e, next) => {
    await record($, "session.start", {
      sessionId: await $.session.id(),
      input: e,
    });
    return next(e);
  });

  on("session.end", async ($, e, next) => {
    await record($, "session.end", {
      sessionId: e.sessionId,
      reason: e.reason,
    });
    return next(e);
  });

  on("turn.start", async ($, e, next) => {
    await record($, "turn.start", { turnId: e.turnId });
    return next(e);
  });

  on("turn.complete", async ($, e, next) => {
    await record($, "turn.complete", {
      turnId: e.turnId,
      reason: e.reason,
      isAborted: e.isAborted,
      agentId: e.agentId,
      durationMs: e.durationMs,
    });
    return next(e);
  });

  on("tool.check", async ($, e, next) => {
    const verdict = await next(e);
    await record($, "tool.check", {
      tool: e.tool,
      toolUseId: e.tool_use_id,
      decision: verdict.decision,
    });
    return verdict;
  });

  on("tool.call", async ($, e, next) => {
    await record($, "tool.call:before", { tool: e.tool });
    const result = await next(e);
    await record($, "tool.call:after", {
      tool: e.tool,
      denied: result.deny !== undefined,
      isError: "isError" in result ? result.isError : undefined,
    });
    return result;
  });

  on("classic.PermissionRequest", async ($, e, next) => {
    await record($, "classic.PermissionRequest", { input: e });
    return next(e);
  });

  on("classic.PermissionDenied", async ($, e, next) => {
    await record($, "classic.PermissionDenied", { input: e });
    return next(e);
  });

  on("classic.Notification", async ($, e, next) => {
    await record($, "classic.Notification", { input: e });
    return next(e);
  });

  on("classic.Stop", async ($, e, next) => {
    await record($, "classic.Stop", { input: e });
    return next(e);
  });

  on("classic.StopFailure", async ($, e, next) => {
    await record($, "classic.StopFailure", { input: e });
    return next(e);
  });
};
