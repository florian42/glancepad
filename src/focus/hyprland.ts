// Window focus on Hyprland, through `hyprctl`. The method and its
// evidence are in research/session-window-handle.md.
//
// A session reports the process id of its `claude` process. A terminal
// owns its window, and `claude` is a descendant of the terminal. So
// the walk goes up the parent chain until a process id matches a
// Hyprland client.

import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import {
  DESKTOP_WINDOW_CLASS,
  desktopSessionUri,
  parseHostSessionId,
} from "./desktop.js";
import type { FocusResult, WindowFocuser } from "./focuser.js";

const HYPRCTL_TIMEOUT_MS = 2000;
const OPEN_TIMEOUT_MS = 5000;
// A process tree deeper than this is not a terminal with a shell.
const MAX_ANCESTORS = 32;
const ADDRESS = /^0x[0-9a-f]+$/;

export interface HyprlandClient {
  readonly address: string;
  readonly pid: number;
  /** The window class. Absent when Hyprland reports none. */
  readonly class?: string;
}

export interface HyprlandDeps {
  /** Runs `hyprctl` with these arguments. Resolves with its stdout. */
  readonly hyprctl?: (args: readonly string[]) => Promise<string>;
  /** Returns the parent process id, or `undefined` when unknown. */
  readonly parentOf?: (pid: number) => Promise<number | undefined>;
  /** Opens a link with the system handler. Rejects on a failure. */
  readonly openUri?: (uri: string) => Promise<void>;
}

// `xdg-open` starts a second `claude-desktop` process. That process
// gives the link to the running app and exits.
const xdgOpen = (uri: string): Promise<void> =>
  new Promise((resolve, reject) => {
    execFile("xdg-open", [uri], { timeout: OPEN_TIMEOUT_MS }, (error) =>
      error ? reject(error) : resolve(),
    );
  });

const runHyprctl = (args: readonly string[]): Promise<string> =>
  new Promise((resolve, reject) => {
    execFile(
      "hyprctl",
      [...args],
      { timeout: HYPRCTL_TIMEOUT_MS },
      (error, stdout) => (error ? reject(error) : resolve(stdout)),
    );
  });

/**
 * Reads the parent process id from `/proc/<pid>/stat`. The command
 * name sits in parentheses and can contain spaces, so the parse
 * starts after the last `)`. The fields there are state, then parent.
 */
const procParentOf = async (pid: number): Promise<number | undefined> => {
  try {
    const stat = await readFile(`/proc/${pid}/stat`, "utf8");
    const fields = stat
      .slice(stat.lastIndexOf(")") + 1)
      .trim()
      .split(" ");
    const parent = Number(fields[1]);
    return Number.isInteger(parent) && parent > 0 ? parent : undefined;
  } catch {
    return undefined;
  }
};

/** Parses `hyprctl clients -j`. Entries without an address are dropped. */
export function parseClients(text: string): HyprlandClient[] {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return [];
  }
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry: unknown) => {
    if (typeof entry !== "object" || entry === null) return [];
    const record = entry as Record<string, unknown>;
    const { address, pid } = record;
    if (typeof address !== "string" || !ADDRESS.test(address)) return [];
    if (typeof pid !== "number") return [];
    return typeof record.class === "string"
      ? [{ address, pid, class: record.class }]
      : [{ address, pid }];
  });
}

/**
 * Picks the window of the nearest process in `chain`. The chain starts
 * at the session process and goes up. When one process owns two
 * windows, the first client in the list wins: a process id cannot
 * tell them apart.
 */
export function pickClient(
  chain: readonly number[],
  clients: readonly HyprlandClient[],
): HyprlandClient | undefined {
  for (const pid of chain) {
    const client = clients.find((candidate) => candidate.pid === pid);
    if (client !== undefined) return client;
  }
  return undefined;
}

export function createHyprlandFocuser(deps: HyprlandDeps = {}): WindowFocuser {
  const hyprctl = deps.hyprctl ?? runHyprctl;
  const parentOf = deps.parentOf ?? procParentOf;
  const openUri = deps.openUri ?? xdgOpen;

  const ancestors = async (pid: number): Promise<number[]> => {
    const chain = [pid];
    let current = pid;
    while (chain.length < MAX_ANCESTORS) {
      const parent = await parentOf(current);
      // Process 1 owns no window. The walk stops below it.
      if (parent === undefined || parent <= 1 || chain.includes(parent)) break;
      chain.push(parent);
      current = parent;
    }
    return chain;
  };

  // hyprctl prints "ok" for an accepted dispatch. With a Lua
  // configuration it exits with 0 for an unknown window too, so the
  // text is the only reliable signal.
  const dispatch = async (args: readonly string[]): Promise<boolean> => {
    try {
      return (await hyprctl(["dispatch", ...args])).trim() === "ok";
    } catch {
      return false;
    }
  };

  const focusClient = async (client: HyprlandClient): Promise<FocusResult> => {
    const target = `address:${client.address}`;
    // A Lua configuration takes the first form. A hyprlang
    // configuration takes the second form.
    const focused =
      (await dispatch([`hl.dsp.focus({ window = "${target}" })`])) ||
      (await dispatch(["focuswindow", target]));
    return focused
      ? { focused: true, window: client.address }
      : { focused: false, reason: "hyprctl refused the dispatch" };
  };

  const failure = (error: unknown): FocusResult => ({
    focused: false,
    reason: error instanceof Error ? error.message : "hyprctl failed",
  });

  return {
    focusProcess: async (pid): Promise<FocusResult> => {
      try {
        const clients = parseClients(await hyprctl(["clients", "-j"]));
        const client = pickClient(await ancestors(pid), clients);
        if (client === undefined) {
          return { focused: false, reason: "no window for the process" };
        }
        return await focusClient(client);
      } catch (error) {
        return failure(error);
      }
    },

    focusDesktopSession: async (hostSessionId, pid): Promise<FocusResult> => {
      const id = parseHostSessionId(hostSessionId);
      if (id === undefined) {
        return { focused: false, reason: "not a Claude Desktop session id" };
      }
      try {
        // The link selects the session in the app. It does not bring
        // the window to the front on Hyprland, so both steps are
        // necessary.
        let opened = true;
        try {
          await openUri(desktopSessionUri(id));
        } catch {
          opened = false;
        }
        const clients = parseClients(await hyprctl(["clients", "-j"]));
        const client =
          (pid === undefined
            ? undefined
            : pickClient(await ancestors(pid), clients)) ??
          clients.find((entry) => entry.class === DESKTOP_WINDOW_CLASS);
        if (client === undefined) {
          return { focused: false, reason: "no Claude Desktop window" };
        }
        const result = await focusClient(client);
        if (result.focused && !opened) {
          return {
            focused: false,
            reason: "the session link did not open; only the window has focus",
          };
        }
        return result;
      } catch (error) {
        return failure(error);
      }
    },
  };
}
