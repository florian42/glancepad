// Lighting derivation and wire-params parsing — the rules in issue #2,
// sourced from research/virtual-device-options.md §6 and the vendor
// bundle (docs/protocol-conformance.md items 45–50).

import { describe, expect, it } from "vitest";
import {
  deriveLightingConfig,
  deriveThreadsLighting,
  LIGHTING_EFFECTS,
  LIGHTING_SPEED,
  OFF_ZONE,
  parseConfigParams,
  parseThreadsParams,
  type SlotSignal,
  STATUS_COLORS,
} from "../src/protocol/index.js";

const idle = (over: Partial<SlotSignal> = {}): SlotSignal => ({
  status: "idle",
  selected: false,
  pulsing: false,
  ...over,
});

const sixSlots = (over: Partial<SlotSignal>, at = 0): SlotSignal[] => {
  const slots = Array.from({ length: 6 }, () => idle({ status: "off" }));
  slots[at] = idle(over);
  return slots;
};

describe("deriveThreadsLighting", () => {
  it("produces one entry per slot, with sequential ids", () => {
    const entries = deriveThreadsLighting(sixSlots({}), 1);
    expect(entries).toHaveLength(6);
    expect(entries.map((e) => e.id)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("turns an off slot fully off", () => {
    const [entry] = deriveThreadsLighting(sixSlots({ status: "off" }), 1);
    expect(entry).toEqual({
      id: 0,
      c: 0,
      b: 0,
      e: LIGHTING_EFFECTS.off,
      s: 0,
      sk: 0,
      sa: 0,
    });
  });

  it("renders a plain status as solid in the status color", () => {
    const [entry] = deriveThreadsLighting(sixSlots({ status: "working" }), 0.8);
    expect(entry).toEqual({
      id: 0,
      c: STATUS_COLORS.working,
      b: 0.8,
      e: LIGHTING_EFFECTS.solid,
      s: 0,
      sk: 0,
      sa: 0,
    });
  });

  it("breathes at the fixed speed when selected", () => {
    const [entry] = deriveThreadsLighting(
      sixSlots({ status: "unread", selected: true }),
      1,
    );
    expect(entry?.e).toBe(LIGHTING_EFFECTS.breath);
    expect(entry?.s).toBe(LIGHTING_SPEED);
    expect(entry?.c).toBe(STATUS_COLORS.unread);
  });

  it("breathes when pulsing without selection", () => {
    const [entry] = deriveThreadsLighting(
      sixSlots({ status: "error", pulsing: true }),
      1,
    );
    expect(entry?.e).toBe(LIGHTING_EFFECTS.breath);
    expect(entry?.s).toBe(LIGHTING_SPEED);
  });

  it("keeps an off slot off even when selected", () => {
    const [entry] = deriveThreadsLighting(
      sixSlots({ status: "off", selected: true }),
      1,
    );
    expect(entry?.e).toBe(LIGHTING_EFFECTS.off);
    expect(entry?.b).toBe(0);
  });
});

describe("deriveLightingConfig", () => {
  it("turns both zones off when no slot is selected", () => {
    const config = deriveLightingConfig(
      sixSlots({ status: "working" }),
      true,
      1,
    );
    expect(config.ambient).toEqual(OFF_ZONE);
    expect(config.keys).toEqual(OFF_ZONE);
  });

  it("snakes the ambient ring while the selected slot works", () => {
    const config = deriveLightingConfig(
      sixSlots({ status: "working", selected: true }),
      false,
      0.7,
    );
    expect(config.ambient).toEqual({
      e: LIGHTING_EFFECTS.snake,
      b: 0.7,
      s: LIGHTING_SPEED,
      m: 0,
      c: STATUS_COLORS.working,
    });
    expect(config.keys).toEqual(OFF_ZONE);
  });

  it("lights the keys backlight while selection lighting is visible", () => {
    const config = deriveLightingConfig(
      sixSlots({ status: "working", selected: true }),
      true,
      1,
    );
    expect(config.ambient.e).toBe(LIGHTING_EFFECTS.snake);
    expect(config.keys).toEqual({
      e: LIGHTING_EFFECTS.solid,
      b: 1,
      s: 0,
      m: 0,
      c: STATUS_COLORS.working,
    });
  });

  it("shows solid selection lighting for a non-working selected slot", () => {
    const config = deriveLightingConfig(
      sixSlots({ status: "idle", selected: true }),
      true,
      1,
    );
    expect(config.ambient).toEqual({
      e: LIGHTING_EFFECTS.solid,
      b: 1,
      s: 0,
      m: 0,
      c: STATUS_COLORS.idle,
    });
    expect(config.keys.c).toBe(STATUS_COLORS.idle);
  });

  it("turns off after selection lighting expires on a non-working slot", () => {
    const config = deriveLightingConfig(
      sixSlots({ status: "idle", selected: true }),
      false,
      1,
    );
    expect(config.ambient).toEqual(OFF_ZONE);
    expect(config.keys).toEqual(OFF_ZONE);
  });

  it("treats a selected off slot as no selection", () => {
    const config = deriveLightingConfig(
      sixSlots({ status: "off", selected: true }),
      true,
      1,
    );
    expect(config.ambient).toEqual(OFF_ZONE);
    expect(config.keys).toEqual(OFF_ZONE);
  });
});

describe("parseThreadsParams", () => {
  it("accepts a minimized entry array", () => {
    const entries = parseThreadsParams([
      { id: 0, c: 0x304ffe, b: 1, e: 1, s: 0, sk: 0, sa: 0 },
      { id: 5, e: 4 },
    ]);
    expect(entries).toEqual([
      { id: 0, c: 0x304ffe, b: 1, e: 1, s: 0 },
      { id: 5, e: 4 },
    ]);
  });

  it("rejects a non-array", () => {
    expect(parseThreadsParams({ threads: [] })).toBeUndefined();
    expect(parseThreadsParams(null)).toBeUndefined();
  });

  it("drops entries without an integer id", () => {
    const entries = parseThreadsParams([
      { id: "0", c: 1 },
      { c: 2 },
      { id: 1.5 },
      { id: -1 },
      { id: 2, c: 3 },
    ]);
    expect(entries).toEqual([{ id: 2, c: 3 }]);
  });

  it("drops non-numeric optional members instead of the entry", () => {
    const entries = parseThreadsParams([{ id: 1, c: "red", b: 0.5 }]);
    expect(entries).toEqual([{ id: 1, b: 0.5 }]);
  });
});

describe("parseConfigParams", () => {
  const zone = { e: 2, b: 1, s: 0.4, m: 0, c: 0x304ffe };

  it("accepts a two-zone config", () => {
    const config = parseConfigParams({ ambient: zone, keys: OFF_ZONE });
    expect(config).toEqual({ ambient: zone, keys: OFF_ZONE });
  });

  it("rejects a config with a missing zone", () => {
    expect(parseConfigParams({ ambient: zone })).toBeUndefined();
  });

  it("rejects a zone with a non-numeric member", () => {
    expect(
      parseConfigParams({ ambient: { ...zone, e: "snake" }, keys: zone }),
    ).toBeUndefined();
  });

  it("rejects non-objects", () => {
    expect(parseConfigParams(null)).toBeUndefined();
    expect(parseConfigParams([zone, zone])).toBeUndefined();
  });
});
