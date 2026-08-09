// The LED model reducer: stores only what the protocol carries per
// zone, merges partial per-slot updates, ignores unknown slot ids.

import { describe, expect, it } from "vitest";
import {
  applyLightingConfig,
  applyThreadsLighting,
  initialLedState,
  OFF_ZONE_STATE,
} from "../src/simulator/index.js";

describe("initial state", () => {
  it("starts with six dark slots and two dark zones", () => {
    expect(initialLedState.slots).toHaveLength(6);
    for (const slot of initialLedState.slots) {
      expect(slot).toEqual(OFF_ZONE_STATE);
    }
    expect(initialLedState.ambient).toEqual(OFF_ZONE_STATE);
    expect(initialLedState.keys).toEqual(OFF_ZONE_STATE);
  });
});

describe("applyThreadsLighting", () => {
  it("stores effect, color, brightness, and speed per slot", () => {
    const state = applyThreadsLighting(initialLedState, [
      { id: 2, c: 0x304ffe, b: 1, e: 4, s: 0.4 },
    ]);
    expect(state.slots[2]).toEqual({
      effect: 4,
      color: 0x304ffe,
      brightness: 1,
      speed: 0.4,
    });
  });

  it("leaves an omitted member unchanged", () => {
    const lit = applyThreadsLighting(initialLedState, [
      { id: 0, c: 0xff0033, b: 0.5, e: 1, s: 0 },
    ]);
    const next = applyThreadsLighting(lit, [{ id: 0, e: 4, s: 0.4 }]);
    expect(next.slots[0]).toEqual({
      effect: 4,
      color: 0xff0033,
      brightness: 0.5,
      speed: 0.4,
    });
  });

  it("ignores a slot id the device does not have", () => {
    const state = applyThreadsLighting(initialLedState, [{ id: 6, c: 1 }]);
    expect(state).toEqual(initialLedState);
  });

  it("does not mutate the previous state", () => {
    applyThreadsLighting(initialLedState, [{ id: 0, c: 1, b: 1, e: 1, s: 0 }]);
    expect(initialLedState.slots[0]).toEqual(OFF_ZONE_STATE);
  });
});

describe("applyLightingConfig", () => {
  it("stores both zones, dropping the magic member", () => {
    const state = applyLightingConfig(initialLedState, {
      ambient: { e: 2, b: 0.7, s: 0.4, m: 0, c: 0x304ffe },
      keys: { e: 1, b: 0.7, s: 0, m: 0, c: 0x304ffe },
    });
    expect(state.ambient).toEqual({
      effect: 2,
      color: 0x304ffe,
      brightness: 0.7,
      speed: 0.4,
    });
    expect(state.keys.effect).toBe(1);
    expect(state.slots).toEqual(initialLedState.slots);
  });
});
