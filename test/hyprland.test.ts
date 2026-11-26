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

function fakes(answers: { lua?: string; legacy?: string; clients?: string }) {
  const calls: string[][] = [];
  const hyprctl = async (args: readonly string[]): Promise<string> => {
    calls.push([...args]);
    if (args[0] === "clients") return answers.clients ?? CLIENTS;
    if (args[1] === "focuswindow") return answers.legacy ?? "ok\n";
    return answers.lua ?? "ok\n";
  };
  const parentOf = async (pid: number) => PARENTS.get(pid);
  return { calls, focuser: createHyprlandFocuser({ hyprctl, parentOf }) };
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
