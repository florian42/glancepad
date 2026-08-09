// The simulator server: one process that owns the simulated device,
// serves the browser page, and bridges it over a WebSocket. It also
// plays the host role: the driver panel's slot statuses run through the
// real derivation, framing, and transport code — the same byte path
// hardware mode will use (ADR-0001). Headless mode is this same server
// with no browser connected; `GET /state` serves the JSON dump.

import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import { WebSocketServer } from "ws";
import {
  AGENT_KEYS,
  CHANNEL_RPC,
  COMMAND_KEYS,
  deriveLightingConfig,
  deriveThreadsLighting,
  encodeFrames,
  encodeRequest,
  LIGHTING_EFFECTS,
  METHOD_LIGHTING_CONFIG,
  METHOD_THREADS_LIGHTING,
  nextRequestId,
  SELECTION_LIGHTING_MS,
  type SlotSignal,
  type SlotStatus,
  STATUS_COLORS,
} from "../protocol/index.js";
import {
  type DeviceKey,
  type LedState,
  type SimulatedDevice,
  SLOT_COUNT,
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
] as const;

interface FrameLogEntry {
  readonly direction: "host-to-device" | "device-to-host";
  readonly ts: number;
  readonly hex: string;
  readonly decoded: readonly string[];
  readonly note?: string;
}

export interface SimulatorServer {
  readonly port: number;
  close(): Promise<void>;
}

export interface SimulatorServerOptions {
  /** TCP port; 0 picks a free one. */
  readonly port: number;
  /** Selection-lighting duration override, for tests. */
  readonly selectionLightingMs?: number;
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
      AGENT_KEYS.map((key, index) => {
        const slot = led.slots[index];
        return [
          key,
          zoneDump(slot ?? { effect: 0, color: 0, brightness: 0, speed: 0 }),
        ];
      }),
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
  // Host-side driver state: what the human set in the panel.
  type DriverSlot = { -readonly [K in keyof SlotSignal]: SlotSignal[K] };
  const slots: DriverSlot[] = Array.from({ length: SLOT_COUNT }, () => ({
    status: "off",
    selected: false,
    pulsing: false,
  }));
  let brightness = 1;
  let selectionVisible = false;
  let selectionTimer: NodeJS.Timeout | undefined;
  const selectionLightingMs =
    options.selectionLightingMs ?? SELECTION_LIGHTING_MS;
  let requestId = 0;
  const frameLog: FrameLogEntry[] = [];

  // Sends are serialized on one chain. Two concurrent panel changes
  // would otherwise interleave the reports of two RPC messages, and the
  // device-side accumulator cannot untangle that. The vendor host
  // serializes its sends through a queue for the same reason.
  let sendChain: Promise<void> = Promise.resolve();
  const sendRpc = (method: string, params: unknown): Promise<void> => {
    sendChain = sendChain.then(async () => {
      const text = encodeRequest(requestId, method, params);
      requestId = nextRequestId(requestId);
      for (const report of encodeFrames(CHANNEL_RPC, text)) {
        await device.send(report);
      }
    });
    return sendChain;
  };

  const pushThreads = () =>
    sendRpc(METHOD_THREADS_LIGHTING, deriveThreadsLighting(slots, brightness));
  const pushConfig = () =>
    sendRpc(
      METHOD_LIGHTING_CONFIG,
      deriveLightingConfig(slots, selectionVisible, brightness),
    );

  const driverDump = () => ({ slots, brightness, selectionVisible });

  const wss = new WebSocketServer({ noServer: true });

  const broadcast = (message: unknown): void => {
    const text = JSON.stringify(message);
    for (const client of wss.clients) {
      if (client.readyState === client.OPEN) client.send(text);
    }
  };

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
      decoded: event.decoded,
      ...(event.note === undefined ? {} : { note: event.note }),
    };
    frameLog.push(entry);
    if (frameLog.length > FRAME_LOG_LIMIT) frameLog.shift();
    broadcast({ type: "frame", entry });
  });

  const applyDriverChange = async (
    restartSelection: boolean,
  ): Promise<void> => {
    if (restartSelection) {
      clearTimeout(selectionTimer);
      selectionVisible = slots.some((slot) => slot.selected);
      if (selectionVisible) {
        selectionTimer = setTimeout(() => {
          selectionVisible = false;
          broadcast({ type: "driver", driver: driverDump() });
          void pushConfig();
        }, selectionLightingMs);
      }
    }
    broadcast({ type: "driver", driver: driverDump() });
    await pushThreads();
    await pushConfig();
  };

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
      const slot = slots[record.slot];
      if (slot === undefined) return;
      let selectionChanged = false;
      if (isSlotStatus(record.status)) slot.status = record.status;
      if (typeof record.pulsing === "boolean") slot.pulsing = record.pulsing;
      if (typeof record.selected === "boolean") {
        selectionChanged = slot.selected !== record.selected;
        if (record.selected) {
          for (const other of slots) other.selected = false;
        }
        slot.selected = record.selected;
      }
      await applyDriverChange(selectionChanged);
      return;
    }
    if (record.type === "brightness" && typeof record.value === "number") {
      brightness = Math.min(1, Math.max(0, record.value));
      await applyDriverChange(false);
    }
  };

  const httpServer = createServer(async (req, res) => {
    if (req.url === "/state") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(dumpState(device.lighting), null, 2));
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
          },
          state: dumpState(device.lighting),
          driver: driverDump(),
          log: frameLog,
        }),
      );
      client.on("message", (data) => {
        void handleClientMessage(String(data));
      });
    });
  });

  await new Promise<void>((resolve) =>
    httpServer.listen(options.port, resolve),
  );
  const address = httpServer.address();
  const port =
    typeof address === "object" && address !== null
      ? address.port
      : options.port;

  return {
    port,
    close: async () => {
      clearTimeout(selectionTimer);
      wss.close();
      for (const client of wss.clients) client.terminate();
      await new Promise<void>((resolve, reject) =>
        httpServer.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}
