// The simulator server: one process that owns the simulated device,
// serves the browser page, and bridges it over a WebSocket. It composes
// the host (src/device/host.ts) with the simulated device: the driver
// panel's slot statuses run through the real derivation, framing, and
// transport code — the same byte path hardware mode will use
// (ADR-0001). The lighting and frame-log feeds exist only on the
// simulator, so this server subscribes to them for its page. Headless
// mode is this same server with no browser connected; `GET /state`
// serves the JSON dump.

import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage } from "node:http";
import { join } from "node:path";
import { WebSocketServer } from "ws";
import { createHost } from "../device/host.js";
import { parseModEvent, toSessionEvent } from "../mods/index.js";
import {
  AGENT_KEYS,
  COMMAND_KEYS,
  type CommandKey,
  LIGHTING_EFFECTS,
  SELECTION_LIGHTING_MS,
  type SlotStatus,
  STATUS_COLORS,
} from "../protocol/index.js";
import {
  emptySessions,
  expireSilentSessions,
  reduceSessions,
  SESSION_SILENCE_MS,
  type SessionEvent,
  type Sessions,
  selectSlots,
} from "../sessions/index.js";
import {
  type DeviceKey,
  type LedState,
  OFF_ZONE_STATE,
  type SimulatedDevice,
  type ZoneState,
} from "../simulator/index.js";

const FRAME_LOG_LIMIT = 200;

// The default hardware layout: keycap legends per command key, with the
// microphone keys merged — research/codex-micro-agent-key-assignment.md,
// "Default hardware layout". Sent to the page in the hello message so
// the key lists live in one place.
const COMMAND_KEY_LAYOUT = [
  { key: "ACT06", cap: "FAST" },
  { key: "ACT07", cap: "APPR" },
  { key: "ACT08", cap: "REJ" },
  { key: "ACT09", cap: "SPLIT" },
  { key: "ACT10_ACT11", cap: "MIC" },
  { key: "ACT12", cap: "CODEX" },
] as const satisfies readonly { key: CommandKey; cap: string }[];

interface FrameLogEntry {
  readonly direction: "host-to-device" | "device-to-host";
  readonly ts: number;
  readonly hex: string;
  /** Report byte 0. Kept even when the report fails to decode. */
  readonly reportId: number;
  /** Report byte 1. */
  readonly channel: number;
  /** Report byte 2, the payload length in this frame. */
  readonly length: number;
  readonly decoded: readonly string[];
  readonly note?: string;
}

export interface SimulatorServer {
  readonly port: number;
  /**
   * Applies one normalized session event and pushes lighting when a
   * slot status changes. Issue 6's hook adapter will call this. The
   * mod route is the only HTTP caller in this build.
   */
  applySession(event: SessionEvent, nowMs?: number): Promise<void>;
  close(): Promise<void>;
}

export interface SimulatorServerOptions {
  /** TCP port; 0 picks a free one. */
  readonly port: number;
  /** Selection-lighting duration override, for tests. */
  readonly selectionLightingMs?: number;
  /** Silence before a watched session leaves. Default 15 seconds. */
  readonly sessionSilenceMs?: number;
  /** How often to check silence. Default 1 second. */
  readonly livenessIntervalMs?: number;
}

const BODY_LIMIT = 64 * 1024;

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > BODY_LIMIT) throw new Error("body too large");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

const EFFECT_NAMES = new Map<number, string>(
  Object.entries(LIGHTING_EFFECTS).map(([name, value]) => [value, name]),
);

const effectName = (value: number): string =>
  EFFECT_NAMES.get(value) ?? `unknown(${value})`;

const colorHex = (color: number): string =>
  `#${color.toString(16).padStart(6, "0")}`;

const zoneDump = (zone: ZoneState) => ({
  effect: effectName(zone.effect),
  color: colorHex(zone.color),
  brightness: zone.brightness,
  speed: zone.speed,
});

/** The six keys and both zones, as the state command prints them. */
export function dumpState(led: LedState) {
  return {
    slots: Object.fromEntries(
      AGENT_KEYS.map((key, index) => [
        key,
        zoneDump(led.slots[index] ?? OFF_ZONE_STATE),
      ]),
    ),
    ambient: zoneDump(led.ambient),
    keys: zoneDump(led.keys),
  };
}

const isDeviceKey = (value: unknown): value is DeviceKey =>
  typeof value === "string" &&
  ((AGENT_KEYS as readonly string[]).includes(value) ||
    (COMMAND_KEYS as readonly string[]).includes(value));

const isSlotStatus = (value: unknown): value is SlotStatus =>
  typeof value === "string" && value in STATUS_COLORS;

export async function startSimulatorServer(
  device: SimulatedDevice,
  options: SimulatorServerOptions,
): Promise<SimulatorServer> {
  // The host owns the slot state and the send chain. The panel only
  // drives it.
  const host = createHost(device, options);
  const frameLog: FrameLogEntry[] = [];
  let sessions: Sessions = emptySessions;
  const silenceMs = options.sessionSilenceMs ?? SESSION_SILENCE_MS;

  const publishSessions = async (): Promise<void> => {
    const signals = selectSlots(sessions);
    for (let index = 0; index < signals.length; index++) {
      const signal = signals[index];
      const current = host.driver.slots[index];
      if (signal === undefined || current === undefined) continue;
      if (current.status === signal.status) continue;
      await host.setSlot(index, { status: signal.status });
    }
  };

  const applySession = async (
    event: SessionEvent,
    nowMs = Date.now(),
  ): Promise<void> => {
    const next = reduceSessions(sessions, event, nowMs);
    if (next === sessions) return;
    sessions = next;
    await publishSessions();
  };

  const wss = new WebSocketServer({ noServer: true });

  const broadcast = (message: unknown): void => {
    const text = JSON.stringify(message);
    for (const client of wss.clients) {
      if (client.readyState === client.OPEN) client.send(text);
    }
  };

  host.onDriver((driver) => {
    broadcast({ type: "driver", driver });
  });

  device.onLighting((state) => {
    broadcast({ type: "state", state: dumpState(state) });
  });

  device.onFrame((event) => {
    const entry: FrameLogEntry = {
      direction: event.direction,
      ts: Date.now(),
      hex: Array.from(event.report, (b) =>
        b.toString(16).padStart(2, "0"),
      ).join(""),
      reportId: event.report[0] ?? 0,
      channel: event.report[1] ?? 0,
      length: event.report[2] ?? 0,
      decoded: event.decoded,
      ...(event.note === undefined ? {} : { note: event.note }),
    };
    frameLog.push(entry);
    if (frameLog.length > FRAME_LOG_LIMIT) frameLog.shift();
    broadcast({ type: "frame", entry });
  });

  const handleClientMessage = async (raw: string): Promise<void> => {
    let message: unknown;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }
    if (typeof message !== "object" || message === null) return;
    const record = message as Record<string, unknown>;

    if (record.type === "key" && isDeviceKey(record.key)) {
      if (record.act === 1) device.pressKey(record.key);
      if (record.act === 0) device.releaseKey(record.key);
      return;
    }
    if (record.type === "slot" && typeof record.slot === "number") {
      await host.setSlot(record.slot, {
        ...(isSlotStatus(record.status) ? { status: record.status } : {}),
        ...(typeof record.pulsing === "boolean"
          ? { pulsing: record.pulsing }
          : {}),
        ...(typeof record.selected === "boolean"
          ? { selected: record.selected }
          : {}),
      });
      return;
    }
    if (record.type === "brightness" && typeof record.value === "number") {
      await host.setBrightness(record.value);
    }
  };

  const httpServer = createServer(async (req, res) => {
    if (req.method === "POST" && req.url === "/events") {
      let event: ReturnType<typeof parseModEvent>;
      try {
        const text = await readBody(req);
        event = parseModEvent(JSON.parse(text));
      } catch {
        // Bad JSON or a huge body. Do not log the body.
        res.writeHead(204);
        res.end();
        return;
      }
      if (event) await applySession(toSessionEvent(event));
      res.writeHead(204);
      res.end();
      return;
    }
    if (req.url === "/state") {
      res.writeHead(200, { "content-type": "application/json" });
      // The LED dump cannot tell two statuses of one color apart, and
      // it cannot show whether selection lighting is still on. The
      // driver sits beside it so a headless check can.
      res.end(
        JSON.stringify(
          { ...dumpState(device.lighting), driver: host.driver },
          null,
          2,
        ),
      );
      return;
    }
    if (req.url === "/" || req.url === "/index.html") {
      const html = await readFile(join(import.meta.dirname, "index.html"));
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(html);
      return;
    }
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
  });

  httpServer.on("upgrade", (req, socket, head) => {
    if (req.url !== "/ws") {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (client) => {
      client.send(
        JSON.stringify({
          type: "hello",
          layout: {
            agentKeys: AGENT_KEYS,
            commandKeys: COMMAND_KEY_LAYOUT,
            statuses: Object.keys(STATUS_COLORS),
            logLimit: FRAME_LOG_LIMIT,
            selectionLightingMs:
              options.selectionLightingMs ?? SELECTION_LIGHTING_MS,
          },
          state: dumpState(device.lighting),
          driver: host.driver,
          log: frameLog,
        }),
      );
      client.on("message", (data) => {
        void handleClientMessage(String(data));
      });
    });
  });

  // Loopback only: the panel injects key events and must not be
  // reachable from the network.
  await new Promise<void>((resolve) =>
    httpServer.listen(options.port, "127.0.0.1", resolve),
  );
  const address = httpServer.address();
  const port =
    typeof address === "object" && address !== null
      ? address.port
      : options.port;

  const liveness = setInterval(() => {
    const next = expireSilentSessions(sessions, Date.now(), silenceMs);
    if (next === sessions) return;
    sessions = next;
    void publishSessions();
  }, options.livenessIntervalMs ?? 1000);

  return {
    port,
    applySession,
    close: async () => {
      clearInterval(liveness);
      host.close();
      wss.close();
      for (const client of wss.clients) client.terminate();
      await new Promise<void>((resolve, reject) =>
        httpServer.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}
