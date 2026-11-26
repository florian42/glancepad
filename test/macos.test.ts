// Window focus on macOS, with `ps` and `open` replaced by fakes. No
// test needs macOS, and no session ran the real commands on a Mac:
// see research/macos-support.md.

import { describe, expect, it } from "vitest";
import {
  appBundleOf,
  createMacFocuser,
  parsePsLine,
} from "../src/focus/index.js";

const SESSION = "local_0123abcd-4567-89ab-cdef-0123456789ab";

// claude 710 -> zsh 700 -> login 650 -> iTerm2 500 -> launchd 1
const PROCESSES = new Map([
  [710, "  700 /Users/me/.local/bin/claude\n"],
  [700, "  650 -zsh\n"],
  [650, "  500 login\n"],
  [500, "    1 /Applications/iTerm.app/Contents/MacOS/iTerm2\n"],
  // A tmux server has launchd as its parent.
  [810, "  800 /Users/me/.local/bin/claude\n"],
  [800, "    1 tmux\n"],
]);

function fakes(answers: { openFails?: boolean } = {}) {
  const calls: string[][] = [];
  const ps = async (pid: number): Promise<string> => {
    const line = PROCESSES.get(pid);
    if (line === undefined) throw new Error("ps: exit code 1");
    return line;
  };
  const open = async (args: readonly string[]): Promise<void> => {
    calls.push([...args]);
    if (answers.openFails && args[0] !== "-a") throw new Error("open failed");
  };
  return { calls, focuser: createMacFocuser({ ps, open }) };
}

describe("parsePsLine", () => {
  it("reads the parent and a command that contains spaces", () => {
    expect(
      parsePsLine(
        "  412 /Applications/Visual Studio Code.app/Contents/MacOS/Electron\n",
      ),
    ).toEqual({
      parent: 412,
      command: "/Applications/Visual Studio Code.app/Contents/MacOS/Electron",
    });
  });

  it("returns nothing for empty output", () => {
    expect(parsePsLine("")).toBeUndefined();
  });
});

describe("appBundleOf", () => {
  it("returns the bundle of an executable", () => {
    expect(appBundleOf("/Applications/iTerm.app/Contents/MacOS/iTerm2")).toBe(
      "/Applications/iTerm.app",
    );
  });

  it("returns the outer bundle for a helper in a nested bundle", () => {
    expect(
      appBundleOf(
        "/Applications/Visual Studio Code.app/Contents/Frameworks/Code Helper.app/Contents/MacOS/Code Helper",
      ),
    ).toBe("/Applications/Visual Studio Code.app");
  });

  it("returns nothing for an executable outside a bundle", () => {
    expect(appBundleOf("/bin/zsh")).toBeUndefined();
    expect(appBundleOf("-zsh")).toBeUndefined();
    expect(appBundleOf("tmux")).toBeUndefined();
  });
});

describe("the macOS focuser", () => {
  it("activates the terminal application of a session process", async () => {
    const { calls, focuser } = fakes();
    expect(await focuser.focusProcess(710)).toEqual({
      focused: true,
      window: "/Applications/iTerm.app",
    });
    expect(calls).toEqual([["-a", "/Applications/iTerm.app"]]);
  });

  it("reports a process with no application above it, as under tmux", async () => {
    const { calls, focuser } = fakes();
    expect(await focuser.focusProcess(810)).toEqual({
      focused: false,
      reason: "no application for the process",
    });
    expect(calls).toEqual([]);
  });

  it("reports a process that does not exist", async () => {
    const { focuser } = fakes();
    expect((await focuser.focusProcess(4242)).focused).toBe(false);
  });

  it("opens the session link of a Claude Desktop session", async () => {
    const { calls, focuser } = fakes();
    const result = await focuser.focusDesktopSession(SESSION, undefined);
    expect(result.focused).toBe(true);
    expect(calls).toEqual([[`claude://claude.ai/epitaxy/${SESSION}`]]);
  });

  it("refuses an id that is not a Claude Desktop session id", async () => {
    const { calls, focuser } = fakes();
    const result = await focuser.focusDesktopSession("--args; rm", 710);
    expect(result.focused).toBe(false);
    expect(calls).toEqual([]);
  });

  it("activates the application when the link does not open", async () => {
    const { calls, focuser } = fakes({ openFails: true });
    expect(await focuser.focusDesktopSession(SESSION, 710)).toEqual({
      focused: false,
      reason: "the session link did not open; only the window has focus",
    });
    expect(calls.at(-1)).toEqual(["-a", "/Applications/iTerm.app"]);
  });
});
