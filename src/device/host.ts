// The host: it owns the slot state, derives the lighting, encodes the
// RPC, frames it, and sends the reports. It talks to the device only
// through DeviceTransport, so the simulator and real hardware plug in
// alike (ADR-0001). `pnpm lint:deps` forbids imports of src/simulator
// and src/ui from here.

import {
  AGENT_KEYS,
  CHANNEL_RPC,
  deriveLightingConfig,
  deriveThreadsLighting,
  encodeFrames,
  encodeRequest,
  METHOD_LIGHTING_CONFIG,
  METHOD_THREADS_LIGHTING,
  nextRequestId,
  SELECTION_LIGHTING_MS,
  SEND_COOLDOWN_MS,
  type SlotSignal,
  type SlotStatus,
} from "../protocol/index.js";
import type { DeviceTransport } from "./transport.js";

/** The slot state the host drives, and the values derived beside it. */
export interface DriverState {
  readonly slots: readonly SlotSignal[];
  readonly brightness: number;
  readonly selectionVisible: boolean;
}

/** A partial update to one slot. Omitted members stay as they are. */
export interface SlotChange {
  readonly status?: SlotStatus;
  readonly pulsing?: boolean;
  readonly selected?: boolean;
}

export interface Host {
  /** The current slot state. */
  readonly driver: DriverState;
  /**
   * Changes one slot and pushes the lighting. Selecting a slot clears
   * the selection on every other slot. An index outside the agent keys
   * does nothing.
   */
  setSlot(index: number, change: SlotChange): Promise<void>;
  /** Sets the brightness, clamped to [0, 1], and pushes the lighting. */
  setBrightness(value: number): Promise<void>;
  /**
   * Replaces every slot and pushes the lighting. A derived payload
   * equal to the last one sends no frames.
   */
  replaceSlots(next: readonly SlotSignal[]): Promise<void>;
  /** Subscribes to slot state changes. Returns an unsubscribe function. */
  onDriver(cb: (driver: DriverState) => void): () => void;
  /** Stops the selection timer. The transport stays open. */
  close(): void;
}

export interface HostOptions {
  /** Selection-lighting duration override, for tests. */
  readonly selectionLightingMs?: number;
  /** Gap between reports. Tests pass 0. Default is SEND_COOLDOWN_MS. */
  readonly sendCooldownMs?: number;
}

export function createHost(
  transport: DeviceTransport,
  options: HostOptions = {},
): Host {
  type MutableSlot = { -readonly [K in keyof SlotSignal]: SlotSignal[K] };
  const slots: MutableSlot[] = AGENT_KEYS.map(() => ({
    status: "off",
    selected: false,
    pulsing: false,
  }));
  let brightness = 1;
  let selectionVisible = false;
  let selectionTimer: NodeJS.Timeout | undefined;
  const selectionLightingMs =
    options.selectionLightingMs ?? SELECTION_LIGHTING_MS;
  const sendCooldownMs = options.sendCooldownMs ?? SEND_COOLDOWN_MS;
  let requestId = 0;
  const driverSubscribers = new Set<(driver: DriverState) => void>();

  const driver = (): DriverState => ({ slots, brightness, selectionVisible });
  const emitDriver = (): void => {
    const state = driver();
    for (const cb of driverSubscribers) cb(state);
  };

  // Sends are serialized on one chain. Two concurrent changes would
  // otherwise interleave the reports of two RPC messages, and the
  // device-side accumulator cannot untangle that. The vendor host
  // serializes its sends through a queue for the same reason.
  let sendChain: Promise<void> = Promise.resolve();
  let lastSendMs = 0;
  // The host waits between reports. Three fragments must not share
  // one timestamp. SEND_COOLDOWN_MS is 50.
  const paceSend = async (): Promise<void> => {
    if (lastSendMs === 0) return;
    while (Date.now() - lastSendMs < sendCooldownMs) {
      const remain = sendCooldownMs - (Date.now() - lastSendMs);
      await new Promise((resolve) => setTimeout(resolve, remain));
    }
  };
  const sendRpc = (method: string, params: unknown): Promise<void> => {
    sendChain = sendChain
      .then(async () => {
        const text = encodeRequest(requestId, method, params);
        requestId = nextRequestId(requestId);
        for (const report of encodeFrames(CHANNEL_RPC, text)) {
          await paceSend();
          await transport.send(report);
          lastSendMs = Date.now();
        }
      })
      // A failed send must not jam the chain, and callers discard the
      // returned promise — report here and keep the chain settled. A
      // failure mid-message still leaves a partial fragment in the
      // device-side accumulator; a real transport owes a resync there.
      .catch((error) => {
        console.error("lighting push failed:", error);
      });
    return sendChain;
  };

  const threadsParams = () => deriveThreadsLighting(slots, brightness);
  const configParams = () =>
    deriveLightingConfig(slots, selectionVisible, brightness);

  // Each lighting call is compared on its own. An unchanged call sends
  // no frames. Request ids stay out of the comparison, so a repeat of
  // the same slots does not count as a new frame.
  let lastThreads = JSON.stringify(threadsParams());
  let lastConfig = JSON.stringify(configParams());

  const pushThreads = () => sendRpc(METHOD_THREADS_LIGHTING, threadsParams());
  const pushConfig = () => sendRpc(METHOD_LIGHTING_CONFIG, configParams());

  const pushLighting = async (): Promise<void> => {
    const threadsText = JSON.stringify(threadsParams());
    const configText = JSON.stringify(configParams());
    if (threadsText !== lastThreads) {
      lastThreads = threadsText;
      await pushThreads();
    }
    if (configText !== lastConfig) {
      lastConfig = configText;
      await pushConfig();
    }
  };

  const applyChange = async (restartSelection: boolean): Promise<void> => {
    if (restartSelection) {
      clearTimeout(selectionTimer);
      selectionVisible = slots.some((slot) => slot.selected);
      if (selectionVisible) {
        selectionTimer = setTimeout(() => {
          selectionVisible = false;
          emitDriver();
          void pushLighting();
        }, selectionLightingMs);
      }
    }
    emitDriver();
    await pushLighting();
  };

  return {
    get driver() {
      return driver();
    },
    setSlot: async (index, change) => {
      const slot = slots[index];
      if (slot === undefined) return;
      let selectionChanged = false;
      if (change.status !== undefined) slot.status = change.status;
      if (change.pulsing !== undefined) slot.pulsing = change.pulsing;
      if (change.selected !== undefined) {
        selectionChanged = slot.selected !== change.selected;
        if (change.selected) {
          for (const other of slots) other.selected = false;
        }
        slot.selected = change.selected;
      }
      await applyChange(selectionChanged);
    },
    setBrightness: async (value) => {
      brightness = Math.min(1, Math.max(0, value));
      await applyChange(false);
    },
    replaceSlots: async (next) => {
      if (next.length !== slots.length) return;
      let selectionChanged = false;
      for (let index = 0; index < slots.length; index++) {
        const slot = slots[index];
        const incoming = next[index];
        if (slot === undefined || incoming === undefined) return;
        if (slot.selected !== incoming.selected) selectionChanged = true;
        slot.status = incoming.status;
        slot.pulsing = incoming.pulsing;
        slot.selected = incoming.selected;
      }
      await applyChange(selectionChanged);
    },
    onDriver: (cb) => {
      driverSubscribers.add(cb);
      return () => driverSubscribers.delete(cb);
    },
    close: () => {
      clearTimeout(selectionTimer);
    },
  };
}
