// Window focus on Hyprland, with `hyprctl` and the process table
// replaced by fakes. The real commands are exercised by hand: see
// research/session-window-handle.md.

import { describe, expect, it } from "vitest";
import {
  createHyprlandFocuser,
  parseClients,
  pickClient,
} from "../src/focus/index.js";

const CLIENTS = JSON.stringify([
  { address: "0xaaa1", pid: 500, class: "kitty" },
  { address: "0xbbb2", pid: 900, class: "editor" },
]);

// hook shell 720 -> claude 710 -> shell 700 -> kitty 500 -> systemd 2
const PARENTS = new Map([
  [710, 700],
  [700, 500],
  [500, 2],
  [2, 1],
]);

function fakes(answers: {
  lua?: string;
  legacy?: string;
  clients?: string;
  openFails?: boolean;
}) {
  const calls: string[][] = [];
  const openUri = async (uri: string): Promise<void> => {
    calls.push(["open", uri]);
    if (answers.openFails) throw new Error("xdg-open failed");
  };
  const hyprctl = async (args: readonly string[]): Promise<string> => {
    calls.push([...args]);
    if (args[0] === "clients") return answers.clients ?? CLIENTS;
    if (args[1] === "focuswindow") return answers.legacy ?? "ok\n";
    return answers.lua ?? "ok\n";
  };
  const parentOf = async (pid: number) => PARENTS.get(pid);
  return {
    calls,
    focuser: createHyprlandFocuser({ hyprctl, parentOf, openUri }),
  };
}

describe("pickClient", () => {
  const clients = parseClients(CLIENTS);

  it("takes the nearest ancestor that owns a window", () => {
    expect(pickClient([710, 700, 500, 2], clients)?.address).toBe("0xaaa1");
  });

  it("returns nothing when no ancestor owns a window", () => {
    expect(pickClient([710, 700], clients)).toBeUndefined();
  });
});

describe("parseClients", () => {
  it("drops entries without a hexadecimal address or a pid", () => {
    expect(
      parseClients(
        JSON.stringify([
          { address: '0x1" }) os.exit(', pid: 1 },
          { address: "0x2" },
          { address: "0x3", pid: 3 },
        ]),
      ),
    ).toEqual([{ address: "0x3", pid: 3 }]);
  });

  it("returns an empty list for text that is not JSON", () => {
    expect(parseClients("error")).toEqual([]);
  });
});

describe("the Hyprland focuser", () => {
  it("focuses the terminal window of a session process", async () => {
    const { calls, focuser } = fakes({});
    expect(await focuser.focusProcess(710)).toEqual({
      focused: true,
      window: "0xaaa1",
    });
    expect(calls).toEqual([
      ["clients", "-j"],
      ["dispatch", 'hl.dsp.focus({ window = "address:0xaaa1" })'],
    ]);
  });

  it("uses the older dispatch form when the first one fails", async () => {
    const { calls, focuser } = fakes({ lua: "error: 3\n" });
    expect((await focuser.focusProcess(710)).focused).toBe(true);
    expect(calls.at(-1)).toEqual(["dispatch", "focuswindow", "address:0xaaa1"]);
  });

  it("reports a refusal when both forms fail", async () => {
    const { focuser } = fakes({
      lua: "warning: window not found\n",
      legacy: "error\n",
    });
    expect((await focuser.focusProcess(710)).focused).toBe(false);
  });

  it("reports a process with no window, and sends no dispatch", async () => {
    const { calls, focuser } = fakes({});
    expect((await focuser.focusProcess(4242)).focused).toBe(false);
    expect(calls).toEqual([["clients", "-j"]]);
  });

  it("does not reject when hyprctl is missing", async () => {
    const focuser = createHyprlandFocuser({
      hyprctl: async () => {
        throw new Error("spawn hyprctl ENOENT");
      },
      parentOf: async () => undefined,
    });
    expect(await focuser.focusProcess(710)).toEqual({
      focused: false,
      reason: "spawn hyprctl ENOENT",
    });
  });
});

// hook shell -> claude 810 -> helper 805 -> Claude Desktop 800
const HOST = "local_01234567-89ab-4cde-8f01-23456789abcd";
const DESKTOP_CLIENTS = JSON.stringify([
  { address: "0xaaa1", pid: 500, class: "kitty" },
  { address: "0xccc3", pid: 800, class: "com.anthropic.Claude" },
]);
PARENTS.set(810, 805).set(805, 800).set(800, 2);

describe("the Hyprland focuser, for a Claude Desktop session", () => {
  it("opens the session link, then focuses the app window", async () => {
    const { calls, focuser } = fakes({ clients: DESKTOP_CLIENTS });
    expect(await focuser.focusDesktopSession(HOST, 810)).toEqual({
      focused: true,
      window: "0xccc3",
    });
    expect(calls).toEqual([
      ["open", `claude://claude.ai/epitaxy/${HOST}`],
      ["clients", "-j"],
      ["dispatch", 'hl.dsp.focus({ window = "address:0xccc3" })'],
    ]);
  });

  it("finds the app window by its class when no process is known", async () => {
    const { focuser } = fakes({ clients: DESKTOP_CLIENTS });
    expect(await focuser.focusDesktopSession(HOST, undefined)).toEqual({
      focused: true,
      window: "0xccc3",
    });
    expect((await focuser.focusDesktopSession(HOST, 4242)).focused).toBe(true);
  });

  it("opens nothing for an id of the wrong shape", async () => {
    const { calls, focuser } = fakes({ clients: DESKTOP_CLIENTS });
    const result = await focuser.focusDesktopSession("local_1 --help", 810);
    expect(result.focused).toBe(false);
    expect(calls).toEqual([]);
  });

  it("focuses the window and reports the failure when the link fails", async () => {
    const { calls, focuser } = fakes({
      clients: DESKTOP_CLIENTS,
      openFails: true,
    });
    const result = await focuser.focusDesktopSession(HOST, 810);
    expect(result.focused).toBe(false);
    expect(calls.at(-1)?.[0]).toBe("dispatch");
  });

  it("reports a missing app window", async () => {
    const { focuser } = fakes({});
    expect(await focuser.focusDesktopSession(HOST, undefined)).toEqual({
      focused: false,
      reason: "no Claude Desktop window",
    });
  });
});
