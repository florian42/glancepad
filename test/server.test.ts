// The simulator server, exercised over real HTTP and WebSocket: the
// driver panel path (statuses in, lighting out) and the key path
// (clicks in, notifications out).

import { afterEach, describe, expect, it } from "vitest";
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
type ServerMessage =
  | { type: "hello"; state: StateDump; driver: DriverDump; log: FrameEntry[] }
  | { type: "state"; state: StateDump }
  | { type: "driver"; driver: DriverDump }
  | { type: "frame"; entry: FrameEntry };

interface Client {
  send(message: unknown): void;
  next<T extends ServerMessage>(
    predicate: (message: ServerMessage) => boolean,
  ): Promise<T>;
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
    client.send({ type: "brightness", value: 0.5 });
    const frame = await client.next<Extract<ServerMessage, { type: "frame" }>>(
      (m) =>
        m.type === "frame" &&
        m.entry.direction === "host-to-device" &&
        m.entry.decoded.some((text: string) => text.includes("v.oai.thstatus")),
    );
    expect(frame.entry.hex).toHaveLength(128);
  });
});
