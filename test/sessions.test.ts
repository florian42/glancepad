// Session events to slot signals — issue #5. The status table is in
// research/claude-code-session-signals.md; the ordering and duplicate
// guards come from research/claude-code-mods-as-state-source.md.

import { describe, expect, it } from "vitest";
import type { SlotStatus } from "../src/protocol/index.js";
import {
  emptySessions,
  reduceSessions,
  type SessionEvent,
  type Sessions,
  selectSlots,
} from "../src/sessions/index.js";

// Feeds the events in order, one millisecond apart, so that each event
// is more recent than the one before it.
const feed = (events: readonly SessionEvent[], from = emptySessions) =>
  events.reduce<Sessions>(
    (sessions, event, i) => reduceSessions(sessions, event, i + 1),
    from,
  );

const statuses = (events: readonly SessionEvent[]): SlotStatus[] =>
  selectSlots(feed(events)).map((slot) => slot.status);

const off = (count: number): SlotStatus[] => Array(count).fill("off");

const started = (sessionId: string): SessionEvent => ({
  kind: "started",
  sessionId,
  cwd: "/work",
  resumedFromCompact: false,
});
const prompted = (sessionId: string): SessionEvent => ({
  kind: "prompted",
  sessionId,
});
const active = (sessionId: string): SessionEvent => ({
  kind: "active",
  sessionId,
});
const turnEnded = (
  sessionId: string,
  outcome: "answer" | "interrupted" | "error",
): SessionEvent => ({ kind: "turn-ended", sessionId, outcome });

describe("selectSlots", () => {
  it("shows six off slots with no sessions", () => {
    expect(selectSlots(emptySessions)).toEqual(
      Array(6).fill({ status: "off", selected: false, pulsing: false }),
    );
  });

  it("puts the session with the last activity first", () => {
    expect(
      statuses([
        started("a"),
        started("b"),
        prompted("b"),
        started("c"),
        prompted("c"),
        turnEnded("c", "answer"),
        prompted("a"),
      ]),
    ).toEqual(["working", "unread", "working", ...off(3)]);
  });

  it("pushes the least recent session off the keys for a seventh", () => {
    const seven = ["s0", "s1", "s2", "s3", "s4", "s5", "s6"];
    const events: SessionEvent[] = [
      started("s0"),
      prompted("s0"),
      turnEnded("s0", "error"),
      ...seven.slice(1).map(started),
    ];
    expect(statuses(events)).toEqual(Array(6).fill("idle"));
  });

  it("brings a pushed-off session back on new activity", () => {
    const seven = ["s0", "s1", "s2", "s3", "s4", "s5", "s6"];
    expect(statuses([...seven.map(started), prompted("s0")])).toEqual([
      "working",
      ...Array(5).fill("idle"),
    ]);
  });
});

describe("reduceSessions, one test per row of the event table", () => {
  it("started makes a new session idle", () => {
    expect(statuses([started("a")])).toEqual(["idle", ...off(5)]);
  });

  it("prompted makes a session working and clears unread", () => {
    expect(
      statuses([started("a"), prompted("a"), turnEnded("a", "answer")]),
    ).toEqual(["unread", ...off(5)]);
    expect(
      statuses([
        started("a"),
        prompted("a"),
        turnEnded("a", "answer"),
        prompted("a"),
      ]),
    ).toEqual(["working", ...off(5)]);
  });

  it("active keeps a session working", () => {
    expect(statuses([started("a"), prompted("a"), active("a")])).toEqual([
      "working",
      ...off(5),
    ]);
  });

  it("active after awaiting-approval makes the session working again", () => {
    expect(
      statuses([
        started("a"),
        prompted("a"),
        { kind: "awaiting-approval", sessionId: "a" },
        active("a"),
      ]),
    ).toEqual(["working", ...off(5)]);
  });

  it("awaiting-approval makes a session awaiting-approval", () => {
    expect(
      statuses([
        started("a"),
        prompted("a"),
        { kind: "awaiting-approval", sessionId: "a" },
      ]),
    ).toEqual(["awaiting-approval", ...off(5)]);
  });

  it("awaiting-response makes a session awaiting-response", () => {
    expect(
      statuses([
        started("a"),
        prompted("a"),
        { kind: "awaiting-response", sessionId: "a" },
      ]),
    ).toEqual(["awaiting-response", ...off(5)]);
  });

  it("turn-ended with an answer makes a session unread", () => {
    expect(
      statuses([started("a"), prompted("a"), turnEnded("a", "answer")]),
    ).toEqual(["unread", ...off(5)]);
  });

  it("turn-ended with an error makes a session error", () => {
    expect(
      statuses([started("a"), prompted("a"), turnEnded("a", "error")]),
    ).toEqual(["error", ...off(5)]);
  });

  it("turn-ended with an interrupt makes a session idle", () => {
    expect(
      statuses([started("a"), prompted("a"), turnEnded("a", "interrupted")]),
    ).toEqual(["idle", ...off(5)]);
  });

  it("ended turns that session's key off", () => {
    expect(
      statuses([
        started("a"),
        started("b"),
        prompted("b"),
        { kind: "ended", sessionId: "b" },
      ]),
    ).toEqual(["idle", ...off(5)]);
  });
});

describe("reduceSessions, ordering and duplicate guards", () => {
  it("ignores active after the turn ended", () => {
    expect(
      statuses([
        started("a"),
        prompted("a"),
        turnEnded("a", "answer"),
        active("a"),
      ]),
    ).toEqual(["unread", ...off(5)]);
  });

  it("ignores active on a known session outside a turn", () => {
    expect(statuses([started("a"), active("a")])).toEqual(["idle", ...off(5)]);
  });

  it("keeps the status when a session resumes from compaction", () => {
    expect(
      statuses([
        started("a"),
        prompted("a"),
        {
          kind: "started",
          sessionId: "a",
          cwd: "/work",
          resumedFromCompact: true,
        },
      ]),
    ).toEqual(["working", ...off(5)]);
  });

  it("ignores a second turn-ended for the same turn", () => {
    expect(
      statuses([
        started("a"),
        prompted("a"),
        turnEnded("a", "answer"),
        turnEnded("a", "interrupted"),
      ]),
    ).toEqual(["unread", ...off(5)]);
  });

  it("does not move a session forward on an ignored event", () => {
    const events = [
      started("a"),
      prompted("a"),
      turnEnded("a", "answer"),
      started("b"),
      turnEnded("a", "answer"),
      active("a"),
    ];
    expect(statuses(events)).toEqual(["idle", "unread", ...off(4)]);
  });

  it("creates the session for an event with an unknown session id", () => {
    expect(statuses([prompted("a")])).toEqual(["working", ...off(5)]);
    expect(statuses([active("a")])).toEqual(["working", ...off(5)]);
    expect(statuses([{ kind: "awaiting-approval", sessionId: "a" }])).toEqual([
      "awaiting-approval",
      ...off(5),
    ]);
    expect(statuses([turnEnded("a", "answer")])).toEqual(["unread", ...off(5)]);
  });

  it("ignores ended for an unknown session id", () => {
    const sessions = feed([started("a")]);
    const after = reduceSessions(
      sessions,
      { kind: "ended", sessionId: "b" },
      99,
    );
    expect(selectSlots(after)).toEqual(selectSlots(sessions));
  });
});
