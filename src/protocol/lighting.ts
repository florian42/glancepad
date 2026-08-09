// Lighting wire shapes and status-to-lighting derivation —
// docs/protocol.md §8, docs/protocol-conformance.md items 45–50. The
// derivation reproduces the vendor host's rules exactly; see
// research/virtual-device-options.md §6.

import {
  LIGHTING_EFFECTS,
  LIGHTING_SPEED,
  type SlotStatus,
  STATUS_COLORS,
} from "./constants.js";

/**
 * One zone on the wire, in the minimized member names the vendor host
 * sends: effect, brightness, speed, magic, packed RGB color. The host
 * always sends `m: 0`; its meaning is unknown.
 */
export interface WireZone {
  readonly e: number;
  readonly b: number;
  readonly s: number;
  readonly m: number;
  readonly c: number;
}

/**
 * One per-slot entry on the wire. Only `id` is required; per the vendor
 * API documentation an omitted member leaves that aspect unchanged on
 * the device (conformance item 46 — the firmware itself is unread).
 * `sk` and `sa` mirror the sync flags as 0 or 1.
 */
export interface WireThreadLighting {
  readonly id: number;
  readonly c?: number;
  readonly b?: number;
  readonly e?: number;
  readonly s?: number;
  readonly sk?: 0 | 1;
  readonly sa?: 0 | 1;
}

/** The two-zone config on the wire: ambient ring and keys backlight. */
export interface WireLightingConfig {
  readonly ambient: WireZone;
  readonly keys: WireZone;
}

/** A fully dark zone. */
export const OFF_ZONE: WireZone = {
  e: LIGHTING_EFFECTS.off,
  b: 0,
  s: 0,
  m: 0,
  c: 0,
};

/** What the lighting derivation needs to know about one agent-key slot. */
export interface SlotSignal {
  readonly status: SlotStatus;
  readonly selected: boolean;
  readonly pulsing: boolean;
}

/**
 * Derives the per-slot lighting entries. The rules: an `off` slot is
 * fully off; a selected or pulsing slot breathes at the fixed speed in
 * its status color; every other slot is solid in its status color.
 */
export function deriveThreadsLighting(
  slots: readonly SlotSignal[],
  brightness: number,
): WireThreadLighting[] {
  return slots.map((slot, id) => {
    if (slot.status === "off") {
      return { id, c: 0, b: 0, e: LIGHTING_EFFECTS.off, s: 0, sk: 0, sa: 0 };
    }
    const breathe = slot.selected || slot.pulsing;
    return {
      id,
      c: STATUS_COLORS[slot.status],
      b: brightness,
      e: breathe ? LIGHTING_EFFECTS.breath : LIGHTING_EFFECTS.solid,
      s: breathe ? LIGHTING_SPEED : 0,
      sk: 0,
      sa: 0,
    };
  });
}

/**
 * Derives the two-zone config. The ambient ring snakes at the fixed
 * speed while the selected slot works, shows the status color solid
 * while selection lighting is visible, and is off with no selection.
 * The keys backlight is solid in the ambient color while selection
 * lighting is visible, and off otherwise.
 */
export function deriveLightingConfig(
  slots: readonly SlotSignal[],
  selectionLightingVisible: boolean,
  brightness: number,
): WireLightingConfig {
  const selected = slots.find((slot) => slot.selected && slot.status !== "off");
  if (selected === undefined) {
    return { ambient: OFF_ZONE, keys: OFF_ZONE };
  }
  const color = STATUS_COLORS[selected.status];
  const solid = zone(LIGHTING_EFFECTS.solid, color, brightness, 0);
  const keys = selectionLightingVisible ? solid : OFF_ZONE;
  if (selected.status === "working") {
    return {
      ambient: zone(LIGHTING_EFFECTS.snake, color, brightness, LIGHTING_SPEED),
      keys,
    };
  }
  return selectionLightingVisible
    ? { ambient: solid, keys }
    : { ambient: OFF_ZONE, keys: OFF_ZONE };
}

const zone = (
  effect: number,
  color: number,
  brightness: number,
  speed: number,
): WireZone => ({ e: effect, b: brightness, s: speed, m: 0, c: color });

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const asNumber = (value: unknown): number | undefined =>
  typeof value === "number" ? value : undefined;

/**
 * Parses untrusted `v.oai.thstatus` params. Returns the valid entries,
 * or `undefined` when the params are not an array. An entry without a
 * non-negative integer `id` is dropped; a non-numeric optional member
 * is dropped from its entry.
 */
export function parseThreadsParams(
  params: unknown,
): WireThreadLighting[] | undefined {
  if (!Array.isArray(params)) return undefined;
  const entries: WireThreadLighting[] = [];
  for (const raw of params) {
    if (!isRecord(raw)) continue;
    const id = raw.id;
    if (typeof id !== "number" || !Number.isInteger(id) || id < 0) continue;
    const entry: {
      id: number;
      c?: number;
      b?: number;
      e?: number;
      s?: number;
    } = { id };
    const c = asNumber(raw.c);
    const b = asNumber(raw.b);
    const e = asNumber(raw.e);
    const s = asNumber(raw.s);
    if (c !== undefined) entry.c = c;
    if (b !== undefined) entry.b = b;
    if (e !== undefined) entry.e = e;
    if (s !== undefined) entry.s = s;
    entries.push(entry);
  }
  return entries;
}

/**
 * Parses untrusted `v.oai.rgbcfg` params. Returns the config, or
 * `undefined` when either zone is missing a numeric member.
 */
export function parseConfigParams(
  params: unknown,
): WireLightingConfig | undefined {
  if (!isRecord(params)) return undefined;
  const ambient = parseZone(params.ambient);
  const keys = parseZone(params.keys);
  if (ambient === undefined || keys === undefined) return undefined;
  return { ambient, keys };
}

function parseZone(value: unknown): WireZone | undefined {
  if (!isRecord(value)) return undefined;
  const e = asNumber(value.e);
  const b = asNumber(value.b);
  const s = asNumber(value.s);
  const m = asNumber(value.m);
  const c = asNumber(value.c);
  if (
    e === undefined ||
    b === undefined ||
    s === undefined ||
    m === undefined ||
    c === undefined
  ) {
    return undefined;
  }
  return { e, b, s, m, c };
}
