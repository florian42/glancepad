// Mod events and settings hooks share POST /events. Unknown bodies
// stay ignored. The server does not log the body.

import { afterEach, describe, expect, it, vi } from "vitest";
import { SimulatedDevice } from "../src/simulator/index.js";
import {
  type SimulatorServer,
  startSimulatorServer,
} from "../src/ui/server.js";

interface ZoneDump {
  effect: string;
  color: string;
  brightness: number;
  speed: number;
}
interface StateDump {
  slots: Record<string, ZoneDump>;
}

const SECRET = "do-not-log-last-assistant-message";

async function stateOf(server: SimulatorServer): Promise<StateDump> {
  const response = await fetch(`http://127.0.0.1:${server.port}/state`);
  return (await response.json()) as StateDump;
}

async function post(server: SimulatorServer, body: unknown): Promise<number> {
  const response = await fetch(`http://127.0.0.1:${server.port}/events`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  return response.status;
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("POST /events from the mod", () => {
  let server: SimulatorServer | undefined;

  afterEach(async () => {
    vi.restoreAllMocks();
    await server?.close();
    server = undefined;
  });

  it("turns a working key idle on an interrupt, then off after silence", async () => {
    const device = new SimulatedDevice();
    server = await startSimulatorServer(device, {
      port: 0,
      sessionSilenceMs: 200,
      livenessIntervalMs: 20,
    });
    await server.applySession({ kind: "prompted", sessionId: "s" });
    expect((await stateOf(server)).slots.AG00).toMatchObject({
      effect: "solid",
      color: "#304ffe",
    });

    expect(
      await post(server, {
        source: "mod",
        kind: "turn-ended",
        sessionId: "s",
        outcome: "interrupted",
        last_assistant_message: SECRET,
        prompt: SECRET,
      }),
    ).toBe(204);
    expect((await stateOf(server)).slots.AG00).toMatchObject({
      effect: "solid",
      color: "#ffffff",
    });

    const frames: string[] = [];
    device.onFrame((event) => {
      if (event.direction === "host-to-device") frames.push(event.direction);
    });
    expect(
      await post(server, { source: "mod", kind: "heartbeat", sessionId: "s" }),
    ).toBe(204);
    expect(frames).toEqual([]);
    expect((await stateOf(server)).slots.AG00?.color).toBe("#ffffff");

    await delay(500);
    expect((await stateOf(server)).slots.AG00).toMatchObject({
      effect: "off",
      color: "#000000",
    });
  });

  it("applies a settings hook and ignores an unknown body", async () => {
    server = await startSimulatorServer(new SimulatedDevice(), { port: 0 });
    await server.applySession({ kind: "prompted", sessionId: "s" });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});

    expect(
      await post(server, {
        hook_event_name: "Stop",
        session_id: "s",
        last_assistant_message: SECRET,
        prompt: SECRET,
      }),
    ).toBe(204);
    expect((await stateOf(server)).slots.AG00?.color).toBe("#00ff4c");
    expect(
      await post(server, {
        source: "mod",
        kind: "turn-ended",
        sessionId: "s",
        outcome: "answer",
        last_assistant_message: SECRET,
      }),
    ).toBe(204);

    expect((await stateOf(server)).slots.AG00?.color).toBe("#00ff4c");
    const text = [log, error, warn, info, debug]
      .flatMap((spy) => spy.mock.calls.flat())
      .map(String)
      .join("\n");
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain("Stop");
  });

  it("lights an idle key from a heartbeat, with no hook event", async () => {
    server = await startSimulatorServer(new SimulatedDevice(), { port: 0 });
    expect(
      await post(server, { source: "mod", kind: "heartbeat", sessionId: "s" }),
    ).toBe(204);
    expect((await stateOf(server)).slots.AG00).toMatchObject({
      effect: "solid",
      color: "#ffffff",
    });
  });
});
