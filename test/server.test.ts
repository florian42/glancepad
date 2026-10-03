// The simulator server, exercised over real HTTP and WebSocket: the
// driver panel path (statuses in, lighting out) and the key path
// (clicks in, notifications out).

import { afterEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
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
  ambient: ZoneDump;
  keys: ZoneDump;
}
interface DriverDump {
  slots: { status: string; selected: boolean; pulsing: boolean }[];
  brightness: number;
  selectionVisible: boolean;
}
interface FrameEntry {
  direction: string;
  ts: number;
  hex: string;
  decoded: string[];
  note?: string;
}
interface FeedDump {
  source: "panel" | "sessions";
  sessionIds: (string | null)[];
}
type ServerMessage =
  | {
      type: "hello";
      state: StateDump;
      driver: DriverDump;
      feed: FeedDump;
      log: FrameEntry[];
    }
  | { type: "state"; state: StateDump }
  | { type: "driver"; driver: DriverDump }
  | { type: "feed"; feed: FeedDump }
  | { type: "frame"; entry: FrameEntry };

interface Client {
  send(message: unknown): void;
  next<T extends ServerMessage>(
    predicate: (message: ServerMessage) => boolean,
  ): Promise<T>;
  received(): ServerMessage[];
  close(): void;
}

function connect(port: number): Promise<Client> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const messages: ServerMessage[] = [];
  const waiters: {
    predicate: (m: ServerMessage) => boolean;
    resolve: (m: ServerMessage) => void;
  }[] = [];
  ws.on("message", (data) => {
    const message = JSON.parse(String(data)) as ServerMessage;
    messages.push(message);
    for (const [index, waiter] of waiters.entries()) {
      if (waiter.predicate(message)) {
        waiters.splice(index, 1);
        waiter.resolve(message);
        break;
      }
    }
  });
  const client: Client = {
    send: (message) => ws.send(JSON.stringify(message)),
    next: <T extends ServerMessage>(
      predicate: (m: ServerMessage) => boolean,
    ) => {
      const found = messages.find(predicate);
      if (found) return Promise.resolve(found as T);
      return new Promise<T>((resolve, reject) => {
        waiters.push({ predicate, resolve: (m) => resolve(m as T) });
        setTimeout(() => reject(new Error("timed out waiting")), 2000);
      });
    },
    received: () => [...messages],
    close: () => ws.close(),
  };
  return new Promise((resolve, reject) => {
    ws.on("open", () => resolve(client));
    ws.on("error", reject);
  });
}

describe("simulator server", () => {
  let server: SimulatorServer | undefined;
  let client: Client | undefined;

  afterEach(async () => {
    client?.close();
    client = undefined;
    await server?.close();
    server = undefined;
  });

  it("serves the LED state dump over GET /state", async () => {
    server = await startSimulatorServer(new SimulatedDevice(), { port: 0 });
    const response = await fetch(`http://127.0.0.1:${server.port}/state`);
    const state = (await response.json()) as StateDump;
    expect(state.slots.AG00).toEqual({
      effect: "off",
      color: "#000000",
      brightness: 0,
      speed: 0,
    });
    expect(state.ambient.effect).toBe("off");
    expect(state.keys.effect).toBe("off");
  });

  it("greets a client with state, driver, and the frame log", async () => {
    server = await startSimulatorServer(new SimulatedDevice(), { port: 0 });
    client = await connect(server.port);
    const hello = await client.next<Extract<ServerMessage, { type: "hello" }>>(
      (m) => m.type === "hello",
    );
    expect(hello.driver.slots).toHaveLength(6);
    expect(hello.log).toEqual([]);
  });

  it("drives a status change through the byte path to the LEDs", async () => {
    const device = new SimulatedDevice();
    server = await startSimulatorServer(device, { port: 0 });
    client = await connect(server.port);

    type StateMessage = Extract<ServerMessage, { type: "state" }>;
    client.send({ type: "slot", slot: 0, status: "working" });
    const state = await client.next<StateMessage>(
      (m) => m.type === "state" && m.state.slots.AG00?.color === "#304ffe",
    );
    expect(state.state.slots.AG00?.effect).toBe("solid");

    client.send({ type: "slot", slot: 0, selected: true });
    await client.next<StateMessage>(
      (m) => m.type === "state" && m.state.slots.AG00?.effect === "breath",
    );
    const withRing = await client.next<StateMessage>(
      (m) => m.type === "state" && m.state.ambient.effect === "snake",
    );
    expect(withRing.state.ambient.speed).toBe(0.4);
    expect(withRing.state.keys.effect).toBe("solid");

    const dump = (await (
      await fetch(`http://127.0.0.1:${server.port}/state`)
    ).json()) as StateDump;
    expect(dump.slots.AG00?.effect).toBe("breath");
  });

  it("turns the keys backlight off when selection lighting expires", async () => {
    server = await startSimulatorServer(new SimulatedDevice(), {
      port: 0,
      selectionLightingMs: 50,
      sendCooldownMs: 0,
    });
    client = await connect(server.port);

    type StateMessage = Extract<ServerMessage, { type: "state" }>;
    client.send({ type: "slot", slot: 2, status: "working" });
    client.send({ type: "slot", slot: 2, selected: true });
    await client.next<StateMessage>(
      (m) => m.type === "state" && m.state.keys.effect === "solid",
    );
    // After expiry the keys backlight is off, but the ring keeps
    // snaking while the selected slot works — only the keys backlight
    // follows the selection window.
    await client.next<StateMessage>(
      (m) =>
        m.type === "state" &&
        m.state.keys.effect === "off" &&
        m.state.ambient.effect === "snake",
    );
    await client.next<Extract<ServerMessage, { type: "driver" }>>(
      (m) => m.type === "driver" && m.driver.selectionVisible === false,
    );
  });

  it("turns a key click into a framed v.oai.hid notification", async () => {
    server = await startSimulatorServer(new SimulatedDevice(), { port: 0 });
    client = await connect(server.port);
    client.send({ type: "key", key: "AG03", act: 1 });
    const frame = await client.next<Extract<ServerMessage, { type: "frame" }>>(
      (m) =>
        m.type === "frame" &&
        m.entry.direction === "device-to-host" &&
        m.entry.decoded.some((text: string) => text.includes("v.oai.hid")),
    );
    expect(frame.entry.decoded[0]).toContain('"key":"AG03"');
    expect(frame.entry.decoded[0]).toContain('"act":1');
    expect(frame.entry.hex).toMatch(/^0602/);
  });

  it("logs host-to-device frames for lighting pushes", async () => {
    server = await startSimulatorServer(new SimulatedDevice(), { port: 0 });
    client = await connect(server.port);
    client.send({ type: "slot", slot: 0, status: "idle" });
    const frame = await client.next<Extract<ServerMessage, { type: "frame" }>>(
      (m) =>
        m.type === "frame" &&
        m.entry.direction === "host-to-device" &&
        m.entry.decoded.some((text: string) => text.includes("v.oai.thstatus")),
    );
    expect(frame.entry.hex).toHaveLength(128);
  });

  it("starts with the panel as the lighting source", async () => {
    server = await startSimulatorServer(new SimulatedDevice(), { port: 0 });
    client = await connect(server.port);
    const hello = await client.next<Extract<ServerMessage, { type: "hello" }>>(
      (m) => m.type === "hello",
    );
    expect(hello.feed).toEqual({
      source: "panel",
      sessionIds: [null, null, null, null, null, null],
    });
  });

  it("lights a key from hook events and skips an unchanged payload", async () => {
    server = await startSimulatorServer(new SimulatedDevice(), { port: 0 });
    client = await connect(server.port);
    await client.next((m) => m.type === "hello");

    const post = async (body: unknown): Promise<void> => {
      const response = await fetch(`http://127.0.0.1:${server?.port}/events`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      expect(response.status).toBe(204);
      expect(await response.text()).toBe("");
    };
    const hook = (name: string, extra: Record<string, unknown> = {}) => ({
      hook_event_name: name,
      session_id: "abc123",
      cwd: "/work/glancepad",
      prompt: "PROMPT_TEXT_MUST_NOT_LEAK",
      last_assistant_message: "ASSISTANT_TEXT_MUST_NOT_LEAK",
      ...extra,
    });
    const logs: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args) => {
      logs.push(args.map(String).join(" "));
    });

    type StateMessage = Extract<ServerMessage, { type: "state" }>;
    type FrameMessage = Extract<ServerMessage, { type: "frame" }>;
    const slotColor = (color: string) => (m: ServerMessage) =>
      m.type === "state" && m.state.slots.AG00?.color === color;

    await post(hook("SessionStart", { source: "startup" }));
    const idle = await client.next<StateMessage>(slotColor("#ffffff"));
    expect(idle.state.slots.AG00?.effect).toBe("solid");
    const idleFrame = await client.next<FrameMessage>(
      (m) =>
        m.type === "frame" &&
        m.entry.direction === "host-to-device" &&
        m.entry.decoded.some((text) => text.includes('"c":16777215')),
    );
    expect(idleFrame.entry.decoded[0]).toContain("v.oai.thstatus");

    const frameCount = () =>
      client?.received().filter((m) => m.type === "frame").length ?? 0;
    // The feed message is broadcast after the lighting push, so a new
    // feed means every frame for that event has already been sent.
    const applied = async (mark: number): Promise<void> => {
      const start = Date.now();
      while (
        !client
          ?.received()
          .slice(mark)
          .some((m) => m.type === "feed")
      ) {
        if (Date.now() - start > 1000) throw new Error("timed out");
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    };

    const workingMark = client.received().length;
    await post(hook("UserPromptSubmit"));
    await applied(workingMark);
    const working = client
      .received()
      .slice(workingMark)
      .find(
        (m): m is StateMessage =>
          m.type === "state" && m.state.slots.AG00?.color === "#304ffe",
      );
    expect(working?.state.slots.AG00?.effect).toBe("solid");
    const workingFrame = client
      .received()
      .slice(workingMark)
      .find(
        (m): m is FrameMessage =>
          m.type === "frame" &&
          m.entry.decoded.some((text) => text.includes('"c":3166206')),
      );
    expect(workingFrame).toBeDefined();

    const toolMark = client.received().length;
    const framesBeforeTool = frameCount();
    await post(hook("PreToolUse", { tool_name: "Bash" }));
    await applied(toolMark);
    expect(frameCount()).toBe(framesBeforeTool);

    const permissionMark = client.received().length;
    await post(hook("PermissionRequest", { tool_name: "Bash" }));
    await applied(permissionMark);
    const amber = client
      .received()
      .slice(permissionMark)
      .find(
        (m): m is StateMessage =>
          m.type === "state" && m.state.slots.AG00?.color === "#ff6d00",
      );
    expect(amber).toBeDefined();
    const amberFrame = client
      .received()
      .slice(permissionMark)
      .find(
        (m): m is FrameMessage =>
          m.type === "frame" &&
          m.entry.decoded.some((text) => text.includes('"c":16739584')),
      );
    expect(amberFrame?.entry.decoded[0]).toContain("v.oai.thstatus");

    // awaiting-response uses the same amber payload as awaiting-approval.
    const questionMark = client.received().length;
    const framesBeforeQuestion = frameCount();
    await post(hook("PreToolUse", { tool_name: "AskUserQuestion" }));
    await applied(questionMark);
    expect(frameCount()).toBe(framesBeforeQuestion);
    const feeds = client
      .received()
      .filter(
        (m): m is Extract<ServerMessage, { type: "feed" }> => m.type === "feed",
      );
    expect(feeds.at(-1)?.feed.sessionIds[0]).toBe("abc123");
    await client.next<Extract<ServerMessage, { type: "driver" }>>(
      (m) =>
        m.type === "driver" &&
        m.driver.slots[0]?.status === "awaiting-response",
    );

    await post(hook("Stop"));
    const unread = await client.next<StateMessage>(slotColor("#00ff4c"));
    expect(unread.state.slots.AG00?.effect).toBe("solid");

    await post(hook("SessionEnd", { reason: "other" }));
    const ended = await client.next<StateMessage>(slotColor("#000000"));
    expect(ended.state.slots.AG00?.effect).toBe("off");

    expect(logs.join("\n")).not.toContain("MUST_NOT_LEAK");
    spy.mockRestore();
  });

  it("keeps the panel from overriding session lighting", async () => {
    server = await startSimulatorServer(new SimulatedDevice(), {
      port: 0,
      selectionLightingMs: 40,
    });
    client = await connect(server.port);
    await client.next((m) => m.type === "hello");

    const response = await fetch(`http://127.0.0.1:${server.port}/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        hook_event_name: "UserPromptSubmit",
        session_id: "abc123",
        prompt: "PROMPT_TEXT_MUST_NOT_LEAK",
      }),
    });
    expect(response.status).toBe(204);

    type StateMessage = Extract<ServerMessage, { type: "state" }>;
    await client.next<StateMessage>(
      (m) => m.type === "state" && m.state.slots.AG00?.color === "#304ffe",
    );
    client.send({ type: "slot", slot: 0, status: "error", selected: true });
    client.send({ type: "brightness", value: 0.5 });
    const dimmed = await client.next<StateMessage>(
      (m) => m.type === "state" && m.state.slots.AG00?.brightness === 0.5,
    );
    expect(dimmed.state.slots.AG00?.color).toBe("#304ffe");
    expect(dimmed.state.ambient.effect).toBe("off");
    await new Promise((resolve) => setTimeout(resolve, 80));
    const dump = (await (
      await fetch(`http://127.0.0.1:${server.port}/state`)
    ).json()) as StateDump;
    expect(dump.slots.AG00?.color).toBe("#304ffe");
    expect(dump.slots.AG00?.effect).toBe("solid");
    expect(dump.ambient.effect).toBe("off");
    expect(dump.keys.effect).toBe("off");
  });

  it("forgets one session and turns that key off", async () => {
    server = await startSimulatorServer(new SimulatedDevice(), { port: 0 });
    client = await connect(server.port);
    await client.next((m) => m.type === "hello");

    const post = (sessionId: string) =>
      fetch(`http://127.0.0.1:${server?.port}/events`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          hook_event_name: "SessionStart",
          session_id: sessionId,
          cwd: "/work",
          source: "startup",
        }),
      });
    await post("session-a");
    await post("session-b");
    await client.next<Extract<ServerMessage, { type: "feed" }>>(
      (m) =>
        m.type === "feed" &&
        m.feed.sessionIds[0] === "session-b" &&
        m.feed.sessionIds[1] === "session-a",
    );

    client.send({ type: "forget", sessionId: "session-b" });
    const state = await client.next<Extract<ServerMessage, { type: "state" }>>(
      (m) => m.type === "state" && m.state.slots.AG01?.effect === "off",
    );
    expect(state.state.slots.AG00?.color).toBe("#ffffff");
    const feed = await client.next<Extract<ServerMessage, { type: "feed" }>>(
      (m) => m.type === "feed" && m.feed.sessionIds[0] === "session-a",
    );
    expect(feed.feed.sessionIds[1]).toBeNull();
  });
});
