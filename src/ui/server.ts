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
import { onKeyEvent } from "../device/keyevents.js";
import { teeTransport } from "../device/tee.js";
import type { DeviceTransport } from "../device/transport.js";
import { createAgentTaps, type WindowFocuser } from "../focus/index.js";
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
  selectSessionIds,
  selectSlots,
  sessionEventFromHook,
} from "../sessions/index.js";
import {
  type DeviceKey,
  type LedState,
  OFF_ZONE_STATE,
  type SimulatedDevice,
  type ZoneState,
} from "../simulator/index.js";
import { attachPushToTalk } from "./talk.js";
import {
  createTalkCommandRunner,
  type TalkCommands,
  talkCommandsFromEnv,
} from "./talkaction.js";

const FRAME_LOG_LIMIT = 200;
// A hook body carries prompt text. The adapter drops that text after
// the parse. The cap only stops a runaway body.
const BODY_LIMIT = 1024 * 1024;

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

/** Which input drives the six keys. Sessions win after the first event. */
export interface FeedState {
  readonly source: "panel" | "sessions";
  readonly sessionIds: readonly (string | null)[];
}

export interface SimulatorServer {
  readonly port: number;
  /**
   * Applies one normalized session event and pushes lighting when a
   * slot status changes. The hook adapter and the mod route both call
   * this.
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
  /** Gap between reports. Tests pass 0. Default is SEND_COOLDOWN_MS. */
  readonly sendCooldownMs?: number;
  /** Push-to-talk commands. Default: the GLANCEPAD_TALK_* variables. */
  readonly talkCommands?: TalkCommands;
  /** Brings a session window to the front on a tap. Default: none. */
  readonly focuser?: WindowFocuser;
  /** False asks for a double tap. Default is true. */
  readonly singleTapAgentKeys?: boolean;
  /**
   * A physical keypad. The host then drives the keypad and the
   * simulated device together, and the page mirrors the keypad.
   */
  readonly hardware?: DeviceTransport;
}

// A SessionStart command hook reports the process id of its session
// in this header. See research/session-window-handle.md.
const PROCESS_HEADER = "x-glancepad-pid";

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
  // The host owns the slot state and the send chain. The panel drives
  // it until the first session event. After that, sessions win.
  // Subscribe to `transport` for key events, not to `device`: in
  // hardware mode only `transport` carries the keypad's reports.
  const transport: DeviceTransport =
    options.hardware === undefined
      ? device
      : teeTransport(options.hardware, device);
  const host = createHost(transport, options);
  const frameLog: FrameLogEntry[] = [];
  let sessions: Sessions = emptySessions;
  let source: FeedState["source"] = "panel";
  const silenceMs = options.sessionSilenceMs ?? SESSION_SILENCE_MS;
  let lastNowMs = 0;

  const feedState = (): FeedState => ({
    source,
    sessionIds:
      source === "sessions"
        ? selectSessionIds(sessions)
        : AGENT_KEYS.map(() => null),
  });

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

  // One chain. A lighting send waits between reports, and a second
  // post must not read the map before the first write lands.
  let applyChain: Promise<void> = Promise.resolve();
  const applySession = (
    event: SessionEvent,
    nowMs = Date.now(),
  ): Promise<void> => {
    const run = applyChain.then(async () => {
      const stamped = nowMs > lastNowMs ? nowMs : lastNowMs + 1;
      lastNowMs = stamped;
      const next = reduceSessions(sessions, event, stamped);
      if (event.kind === "ended") taps.forget(event.sessionId);
      if (next === sessions) return;
      sessions = next;
      await publishSessions();
    });
    applyChain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };

  // A press on an agent key marks its session as read and brings the
  // session window to the front (issue 12).
  const taps = createAgentTaps({
    sessionIds: () => feedState().sessionIds,
    markRead: (sessionId) => applySession({ kind: "read", sessionId }),
    tap: { singleTap: options.singleTapAgentKeys ?? true },
    ...(options.focuser === undefined ? {} : { focuser: options.focuser }),
  });
  const stopKeys = onKeyEvent(transport, ({ key, act }) => {
    void taps.key(key, act);
  });

  const wss = new WebSocketServer({ noServer: true });

  const broadcast = (message: unknown): void => {
    const text = JSON.stringify(message);
    for (const client of wss.clients) {
      if (client.readyState === client.OPEN) client.send(text);
    }
  };

  const broadcastFeed = (): void => {
    broadcast({ type: "feed", feed: feedState() });
  };

  host.onDriver((driver) => {
    broadcast({ type: "driver", driver });
  });

  // Push-to-talk listens on the transport, beside the host.
  const talk = attachPushToTalk(transport, {
    runAction: createTalkCommandRunner(
      options.talkCommands ?? talkCommandsFromEnv(process.env),
    ),
    onStatus: (status) => broadcast({ type: "talk", talk: status }),
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
    if (
      record.type === "forget" &&
      source === "sessions" &&
      typeof record.sessionId === "string"
    ) {
      await applySession({ kind: "ended", sessionId: record.sessionId });
      broadcastFeed();
      return;
    }
    if (record.type === "slot" && typeof record.slot === "number") {
      // Sessions own the keys. The panel cannot override them.
      if (source === "sessions") return;
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
    // No authentication. The loopback bind is the only guard.
    // The handler does not log the body.
    if (req.method === "POST" && req.url === "/events") {
      let payload: unknown;
      try {
        const text = await readBody(req);
        payload = text.length === 0 ? undefined : JSON.parse(text);
      } catch {
        res.writeHead(204);
        res.end();
        return;
      }
      const modEvent = parseModEvent(payload);
      const sessionEvent = modEvent
        ? toSessionEvent(modEvent)
        : sessionEventFromHook(payload);
      try {
        if (sessionEvent) {
          const pid = Number(req.headers[PROCESS_HEADER]);
          if (Number.isInteger(pid) && pid > 1) {
            taps.setProcess(sessionEvent.sessionId, pid);
          }
          source = "sessions";
          await applySession(sessionEvent);
          broadcastFeed();
        }
      } catch {
        // The body stays out of the log.
      }
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
          {
            ...dumpState(device.lighting),
            driver: host.driver,
            talk: talk.status,
          },
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
          feed: feedState(),
          talk: talk.status,
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
    const run = applyChain.then(async () => {
      const next = expireSilentSessions(sessions, Date.now(), silenceMs);
      if (next === sessions) return;
      sessions = next;
      await publishSessions();
      broadcastFeed();
    });
    applyChain = run.then(
      () => undefined,
      () => undefined,
    );
  }, options.livenessIntervalMs ?? 1000);

  return {
    port,
    applySession,
    close: async () => {
      clearInterval(liveness);
      talk.close();
      stopKeys();
      host.close();
      wss.close();
      for (const client of wss.clients) client.terminate();
      await new Promise<void>((resolve, reject) =>
        httpServer.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}
