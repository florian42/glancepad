// Push-to-talk through the real server: a microphone key click on the
// WebSocket becomes a framed notification, the machine reads it from
// the transport, and the command of the user runs.

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { SimulatedDevice } from "../src/simulator/index.js";
import {
  type SimulatorServer,
  startSimulatorServer,
} from "../src/ui/server.js";
import {
  createTalkCommandRunner,
  talkCommandsFromEnv,
} from "../src/ui/talkaction.js";

interface TalkStatus {
  phase: string;
  talking: boolean;
  lastAction: string | null;
  lastOutcome: string | null;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("push-to-talk on the server", () => {
  let dir: string;
  let server: SimulatorServer | undefined;
  let socket: WebSocket | undefined;
  const seen: TalkStatus[] = [];

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "glancepad-talk-"));
    seen.length = 0;
  });
  afterEach(async () => {
    socket?.close();
    await server?.close();
    server = undefined;
    await rm(dir, { recursive: true, force: true });
  });

  const start = async (talkCommands: { start?: string; stop?: string }) => {
    server = await startSimulatorServer(new SimulatedDevice(), {
      port: 0,
      talkCommands,
    });
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}/ws`);
    socket = ws;
    ws.on("message", (data) => {
      const message = JSON.parse(String(data));
      if (message.type === "talk" || message.type === "hello") {
        seen.push(message.talk);
      }
    });
    await new Promise((resolve) => ws.once("open", resolve));
    return (key: string, act: number) =>
      ws.send(JSON.stringify({ type: "key", key, act }));
  };

  const until = async (test: () => boolean): Promise<void> => {
    for (let i = 0; i < 200 && !test(); i++) await sleep(10);
    expect(test()).toBe(true);
  };

  it("runs the start and stop commands for a hold", async () => {
    const log = join(dir, "log");
    const key = await start({
      start: `echo start >> "${log}"`,
      stop: `echo stop >> "${log}"`,
    });
    key("ACT10_ACT11", 1);
    await until(() => seen.some((s) => s.phase === "pressed" && s.talking));
    await sleep(400);
    key("ACT10_ACT11", 0);
    await until(
      () =>
        seen.at(-1)?.phase === "idle" &&
        seen.at(-1)?.lastAction === "talk-stop" &&
        seen.at(-1)?.lastOutcome === "ok",
    );
    expect(await readFile(log, "utf8")).toBe("start\nstop\n");
    const dump = (await (
      await fetch(`http://127.0.0.1:${server?.port}/state`)
    ).json()) as { talk: TalkStatus };
    expect(dump.talk).toMatchObject({ phase: "idle", talking: false });
  });

  it("ignores the other keys", async () => {
    const key = await start({});
    key("ACT09", 1);
    key("AG00", 1);
    await sleep(100);
    expect(seen.every((s) => s.phase === "idle")).toBe(true);
  });

  it("stays up when a command fails or no command is set", async () => {
    const key = await start({ start: "exit 3" });
    key("ACT10_ACT11", 1);
    await until(() => seen.at(-1)?.lastOutcome === "failed");
    await sleep(400);
    key("ACT10_ACT11", 0);
    await until(() => seen.at(-1)?.lastOutcome === "no-command");
    const response = await fetch(`http://127.0.0.1:${server?.port}/state`);
    expect(response.status).toBe(200);
  });
});

describe("talk command runner", () => {
  it("reports a failure in one line without the command output", async () => {
    const lines: string[] = [];
    const run = createTalkCommandRunner(
      { start: "echo secret-words; exit 2", stop: "kill -TERM $$" },
      { report: (line) => lines.push(line) },
    );
    expect(await run("talk-start")).toBe("failed");
    expect(await run("talk-stop")).toBe("failed");
    expect(lines).toEqual([
      "talk-start command failed: exit code 2",
      "talk-stop command failed: signal SIGTERM",
    ]);
  });

  it("stops a command that runs too long", async () => {
    const lines: string[] = [];
    const run = createTalkCommandRunner(
      { start: "exec sleep 30" },
      { timeoutMs: 100, report: (line) => lines.push(line) },
    );
    expect(await run("talk-start")).toBe("failed");
    expect(lines).toEqual(["talk-start command failed: signal SIGTERM"]);
  });

  it("reads the two environment variables", () => {
    expect(
      talkCommandsFromEnv({
        GLANCEPAD_TALK_START: " a ",
        GLANCEPAD_TALK_STOP: "",
      }),
    ).toEqual({ start: "a" });
  });
});
