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
  /** Subscribes to slot state changes. Returns an unsubscribe function. */
  onDriver(cb: (driver: DriverState) => void): () => void;
  /** Stops the selection timer. The transport stays open. */
  close(): void;
}

export interface HostOptions {
  /** Selection-lighting duration override, for tests. */
  readonly selectionLightingMs?: number;
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
  const sendRpc = (method: string, params: unknown): Promise<void> => {
    sendChain = sendChain
      .then(async () => {
        const text = encodeRequest(requestId, method, params);
        requestId = nextRequestId(requestId);
        for (const report of encodeFrames(CHANNEL_RPC, text)) {
          await transport.send(report);
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

  const pushThreads = () =>
    sendRpc(METHOD_THREADS_LIGHTING, deriveThreadsLighting(slots, brightness));
  const pushConfig = () =>
    sendRpc(
      METHOD_LIGHTING_CONFIG,
      deriveLightingConfig(slots, selectionVisible, brightness),
    );

  const applyChange = async (restartSelection: boolean): Promise<void> => {
    if (restartSelection) {
      clearTimeout(selectionTimer);
      selectionVisible = slots.some((slot) => slot.selected);
      if (selectionVisible) {
        selectionTimer = setTimeout(() => {
          selectionVisible = false;
          emitDriver();
          void pushConfig();
        }, selectionLightingMs);
      }
    }
    emitDriver();
    await pushThreads();
    await pushConfig();
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
    onDriver: (cb) => {
      driverSubscribers.add(cb);
      return () => driverSubscribers.delete(cb);
    },
    close: () => {
      clearTimeout(selectionTimer);
    },
  };
}
