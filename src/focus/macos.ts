// Window focus on macOS, through `ps` and `open`. Both are part of
// macOS, and neither needs a privacy permission.
//
// NOT TESTED ON macOS. The method and its sources are in
// research/macos-support.md.
//
// A terminal session reports the process id of its `claude` process.
// `claude` is a descendant of the terminal application. So the walk
// goes up the parent chain until the executable of a process is
// inside an application bundle (`<name>.app`). `open -a <bundle>`
// then brings that application to the front.

import { execFile } from "node:child_process";
import { desktopSessionUri, parseHostSessionId } from "./desktop.js";
import type { FocusResult, WindowFocuser } from "./focuser.js";

const PS_TIMEOUT_MS = 2000;
const OPEN_TIMEOUT_MS = 5000;
// A process tree deeper than this is not a terminal with a shell.
const MAX_ANCESTORS = 32;

export interface MacProcess {
  readonly parent: number;
  /** The executable, as `ps -o comm=` prints it. */
  readonly command: string;
}

export interface MacDeps {
  /** Runs `ps -o ppid=,comm= -p <pid>`. Resolves with its stdout. */
  readonly ps?: (pid: number) => Promise<string>;
  /** Runs `open` with these arguments. Rejects on a failure. */
  readonly open?: (args: readonly string[]) => Promise<void>;
}

const runPs = (pid: number): Promise<string> =>
  new Promise((resolve, reject) => {
    execFile(
      "ps",
      ["-o", "ppid=,comm=", "-p", String(pid)],
      { timeout: PS_TIMEOUT_MS },
      (error, stdout) => (error ? reject(error) : resolve(stdout)),
    );
  });

const runOpen = (args: readonly string[]): Promise<void> =>
  new Promise((resolve, reject) => {
    execFile("open", [...args], { timeout: OPEN_TIMEOUT_MS }, (error) =>
      error ? reject(error) : resolve(),
    );
  });

/** Parses one line of `ps -o ppid=,comm=`. The command can contain spaces. */
export function parsePsLine(text: string): MacProcess | undefined {
  const match = /^\s*(\d+)\s+(\S.*?)\s*$/.exec(text.split("\n")[0] ?? "");
  if (match === null) return undefined;
  return { parent: Number(match[1]), command: match[2] as string };
}

/**
 * Returns the application bundle that contains an executable, or
 * `undefined` when the executable is not in a bundle. A helper in a
 * nested bundle gives the outer bundle, which owns the windows.
 */
export function appBundleOf(command: string): string | undefined {
  return /^(\/.*?\.app)\//.exec(command)?.[1];
}

export function createMacFocuser(deps: MacDeps = {}): WindowFocuser {
  const ps = deps.ps ?? runPs;
  const open = deps.open ?? runOpen;

  /** The bundle of the nearest ancestor of `pid` that is in a bundle. */
  const bundleOf = async (pid: number): Promise<string | undefined> => {
    const seen = new Set<number>();
    let current = pid;
    // Process 1 owns no window. The walk stops below it.
    while (current > 1 && !seen.has(current) && seen.size < MAX_ANCESTORS) {
      seen.add(current);
      let info: MacProcess | undefined;
      try {
        info = parsePsLine(await ps(current));
      } catch {
        // `ps` exits with 1 for a process that does not exist.
        return undefined;
      }
      if (info === undefined) return undefined;
      const bundle = appBundleOf(info.command);
      if (bundle !== undefined) return bundle;
      current = info.parent;
    }
    return undefined;
  };

  const reasonOf = (error: unknown): string =>
    error instanceof Error ? error.message : "open failed";

  const focusProcess = async (pid: number): Promise<FocusResult> => {
    const bundle = await bundleOf(pid);
    if (bundle === undefined) {
      return { focused: false, reason: "no application for the process" };
    }
    try {
      await open(["-a", bundle]);
      return { focused: true, window: bundle };
    } catch (error) {
      return { focused: false, reason: reasonOf(error) };
    }
  };

  return {
    focusProcess,

    focusDesktopSession: async (hostSessionId, pid): Promise<FocusResult> => {
      const id = parseHostSessionId(hostSessionId);
      if (id === undefined) {
        return { focused: false, reason: "not a Claude Desktop session id" };
      }
      const uri = desktopSessionUri(id);
      try {
        // `open` gives the link to the app and brings the app to the
        // front. No second step is necessary, unlike on Hyprland.
        await open([uri]);
        return { focused: true, window: uri };
      } catch (error) {
        // The link did not open. Bring the app to the front at least.
        if (pid !== undefined && (await focusProcess(pid)).focused) {
          return {
            focused: false,
            reason: "the session link did not open; only the window has focus",
          };
        }
        return { focused: false, reason: reasonOf(error) };
      }
    },
  };
}
