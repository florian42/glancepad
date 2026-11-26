// A tap on an agent key, through the real server: a hook reports the
// session process, the page sends the key over the WebSocket, and the
// key travels through the simulated device and the framing code.

import { afterEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import type { WindowFocuser } from "../src/focus/index.js";
import { SimulatedDevice } from "../src/simulator/index.js";
import {
  type SimulatorServer,
  startSimulatorServer,
} from "../src/ui/server.js";

let server: SimulatorServer | undefined;
let ws: WebSocket | undefined;

afterEach(async () => {
  ws?.close();
  ws = undefined;
  await server?.close();
  server = undefined;
  vi.restoreAllMocks();
});

const post = async (
  name: string,
  sessionId: string,
  headers: Record<string, string> = {},
): Promise<void> => {
  await fetch(`http://127.0.0.1:${server?.port}/events`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ hook_event_name: name, session_id: sessionId }),
  });
};

const statuses = async (): Promise<string[]> => {
  const response = await fetch(`http://127.0.0.1:${server?.port}/state`);
  const state = (await response.json()) as {
    driver: { slots: { status: string }[] };
  };
  return state.driver.slots.map((slot) => slot.status);
};

const until = async (check: () => Promise<boolean> | boolean) => {
  const start = Date.now();
  while (!(await check())) {
    if (Date.now() - start > 2000) throw new Error("timed out");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

async function start(focuser: WindowFocuser): Promise<WebSocket> {
  server = await startSimulatorServer(new SimulatedDevice(), {
    port: 0,
    sendCooldownMs: 0,
    focuser,
  });
  const socket = new WebSocket(`ws://127.0.0.1:${server.port}/ws`);
  await new Promise((resolve, reject) => {
    socket.on("open", resolve);
    socket.on("error", reject);
  });
  ws = socket;
  return socket;
}

const tap = (socket: WebSocket, key: string): void => {
  socket.send(JSON.stringify({ type: "key", key, act: 1 }));
  socket.send(JSON.stringify({ type: "key", key, act: 0 }));
};

describe("a tap on an agent key", () => {
  it("focuses the session process and turns unread into idle", async () => {
    const focused: number[] = [];
    const socket = await start({
      focusProcess: async (pid) => {
        focused.push(pid);
        return { focused: true, window: "0x1" };
      },
    });
    await post("SessionStart", "s1", { "x-glancepad-pid": "4321" });
    await post("UserPromptSubmit", "s1");
    await post("Stop", "s1");
    expect((await statuses())[0]).toBe("unread");

    tap(socket, "AG00");
    await until(() => focused.length === 1);
    expect(focused).toEqual([4321]);
    await until(async () => (await statuses())[0] === "idle");
  });

  it("keeps the key order, and leaves a working session as it is", async () => {
    const focused: number[] = [];
    const socket = await start({
      focusProcess: async (pid) => {
        focused.push(pid);
        return { focused: true, window: "0x1" };
      },
    });
    await post("SessionStart", "old", { "x-glancepad-pid": "100" });
    await post("UserPromptSubmit", "old");
    await post("Stop", "old");
    await post("SessionStart", "new", { "x-glancepad-pid": "200" });
    await post("UserPromptSubmit", "new");
    expect((await statuses()).slice(0, 2)).toEqual(["working", "unread"]);

    tap(socket, "AG01");
    tap(socket, "AG00");
    await until(() => focused.length === 2);
    expect(focused).toEqual([100, 200]);
    await until(async () => (await statuses())[1] === "idle");
    expect((await statuses()).slice(0, 2)).toEqual(["working", "idle"]);
  });

  it("does nothing on an empty key", async () => {
    const focused: number[] = [];
    const socket = await start({
      focusProcess: async (pid) => {
        focused.push(pid);
        return { focused: true, window: "0x1" };
      },
    });
    await post("SessionStart", "s1", { "x-glancepad-pid": "4321" });
    tap(socket, "AG05");
    tap(socket, "AG00");
    await until(() => focused.length === 1);
    expect(focused).toEqual([4321]);
  });

  it("survives a focus failure and still marks the session as read", async () => {
    const errors: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...args) => {
      errors.push(args.map(String).join(" "));
    });
    const socket = await start({
      focusProcess: async () => {
        throw new Error("hyprctl is gone");
      },
    });
    await post("SessionStart", "s1", { "x-glancepad-pid": "4321" });
    await post("UserPromptSubmit", "s1");
    await post("Stop", "s1");

    tap(socket, "AG00");
    await until(async () => (await statuses())[0] === "idle");
    await until(() => errors.length === 1);
    expect(errors[0]).toContain("focus failed for session s1");
    // The server still answers.
    await post("UserPromptSubmit", "s1");
    expect((await statuses())[0]).toBe("working");
  });

  it("forgets the process of a session that ended", async () => {
    const focused: number[] = [];
    const errors: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...args) => {
      errors.push(args.map(String).join(" "));
    });
    const socket = await start({
      focusProcess: async (pid) => {
        focused.push(pid);
        return { focused: true, window: "0x1" };
      },
    });
    await post("SessionStart", "s1", { "x-glancepad-pid": "4321" });
    await post("SessionEnd", "s1");
    // The same id returns from a source that sends no process id.
    await post("SessionStart", "s1");
    tap(socket, "AG00");
    await until(() => errors.length === 1);
    expect(focused).toEqual([]);
  });
});
