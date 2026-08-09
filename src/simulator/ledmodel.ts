// The LED model: what the simulated device currently displays. It
// stores only what the protocol carries per zone — effect, packed
// color, brightness, speed. It stores no LED count and no geometry,
// because those are unknown; the renderer decides the visual details.

import type {
  WireLightingConfig,
  WireThreadLighting,
} from "../protocol/index.js";

/** One zone's stored state, in decoded member names. */
export interface ZoneState {
  readonly effect: number;
  readonly color: number;
  readonly brightness: number;
  readonly speed: number;
}

export const OFF_ZONE_STATE: ZoneState = {
  effect: 0,
  color: 0,
  brightness: 0,
  speed: 0,
};

export const SLOT_COUNT = 6;

/** The six agent-key slots plus the two config zones. */
export interface LedState {
  readonly slots: readonly ZoneState[];
  readonly ambient: ZoneState;
  readonly keys: ZoneState;
}

export const initialLedState: LedState = {
  slots: Array.from({ length: SLOT_COUNT }, () => OFF_ZONE_STATE),
  ambient: OFF_ZONE_STATE,
  keys: OFF_ZONE_STATE,
};

/**
 * Applies one `v.oai.thstatus` call. An omitted member leaves that
 * aspect of the slot unchanged; an id beyond the six slots is ignored.
 */
export function applyThreadsLighting(
  state: LedState,
  entries: readonly WireThreadLighting[],
): LedState {
  const slots = [...state.slots];
  for (const entry of entries) {
    const previous = slots[entry.id];
    if (previous === undefined) continue;
    slots[entry.id] = {
      effect: entry.e ?? previous.effect,
      color: entry.c ?? previous.color,
      brightness: entry.b ?? previous.brightness,
      speed: entry.s ?? previous.speed,
    };
  }
  return { ...state, slots };
}

/** Applies one `v.oai.rgbcfg` call to the two zones. */
export function applyLightingConfig(
  state: LedState,
  config: WireLightingConfig,
): LedState {
  return {
    ...state,
    ambient: zoneState(config.ambient),
    keys: zoneState(config.keys),
  };
}

const zoneState = (zone: {
  e: number;
  b: number;
  s: number;
  c: number;
}): ZoneState => ({
  effect: zone.e,
  color: zone.c,
  brightness: zone.b,
  speed: zone.s,
});
