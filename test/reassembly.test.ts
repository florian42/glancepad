import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  CHANNEL_DEBUG,
  CHANNEL_RPC,
  encodeLine,
  MAX_FRAGMENT,
} from "../src/protocol/index.js";
import {
  channelArb,
  feedAll,
  lines,
  messageArb,
  rawReport,
} from "./helpers.js";

describe("round trip through reassembly (docs/protocol.md §3–§4)", () => {
  it("any single message survives encode → feed", () => {
    fc.assert(
      fc.property(channelArb, messageArb, (channel, message) => {
        const [, events] = feedAll(encodeLine(channel, message));
        expect(events).toEqual([{ kind: "line", channel, text: message }]);
      }),
    );
  });

  it("sub-frame, exact-frame, and multi-frame sizes survive", () => {
    // One deterministic case per size class, at the boundaries.
    for (const size of [0, 1, 59, 60, 61, 62, 121, 122, 300]) {
      const message = "m".repeat(size);
      const reports = encodeLine(CHANNEL_RPC, message);
      expect(reports).toHaveLength(
        Math.max(1, Math.ceil((size + 1) / MAX_FRAGMENT)),
      );
      const [, events] = feedAll(reports);
      expect(lines(events).map((l) => l.text)).toEqual([message]);
    }
  });

  it("a sequence of messages arrives complete and in order", () => {
    fc.assert(
      fc.property(
        channelArb,
        fc.array(messageArb, { maxLength: 8 }),
        (channel, messages) => {
          const reports = messages.flatMap((m) => encodeLine(channel, m));
          const [state, events] = feedAll(reports);
          expect(lines(events).map((l) => l.text)).toEqual(messages);
          expect(state.buffers[channel]).toHaveLength(0);
        },
      ),
    );
  });

  it("a multi-byte UTF-8 character split across two reports survives", () => {
    // 60 ASCII bytes + one 3-byte character: the character's bytes span
    // the 61-byte fragment boundary.
    const message = `${"a".repeat(60)}€`;
    const reports = encodeLine(CHANNEL_RPC, message);
    expect(reports).toHaveLength(2);
    const [, events] = feedAll(reports);
    expect(lines(events).map((l) => l.text)).toEqual([message]);
  });
});

describe("channel independence (docs/protocol.md §4)", () => {
  it("debug and RPC fragments interleave without mixing", () => {
    fc.assert(
      fc.property(messageArb, messageArb, (debugMessage, rpcMessage) => {
        const debugReports = encodeLine(CHANNEL_DEBUG, debugMessage);
        const rpcReports = encodeLine(CHANNEL_RPC, rpcMessage);
        // Strict alternation, then the tail of the longer sequence.
        const interleaved: Uint8Array[] = [];
        const max = Math.max(debugReports.length, rpcReports.length);
        for (let i = 0; i < max; i++) {
          const d = debugReports[i];
          const r = rpcReports[i];
          if (d) interleaved.push(d);
          if (r) interleaved.push(r);
        }
        const [, events] = feedAll(interleaved);
        expect(
          lines(events)
            .filter((l) => l.channel === CHANNEL_DEBUG)
            .map((l) => l.text),
        ).toEqual([debugMessage]);
        expect(
          lines(events)
            .filter((l) => l.channel === CHANNEL_RPC)
            .map((l) => l.text),
        ).toEqual([rpcMessage]);
      }),
    );
  });
});

describe("receiver tolerance (docs/protocol.md §4)", () => {
  it("accepts \\r\\n as a line terminator", () => {
    const [, events] = feedAll([rawReport(CHANNEL_RPC, "x\r\ny\n")]);
    expect(lines(events).map((l) => l.text)).toEqual(["x", "y"]);
  });

  it("keeps its state and buffer across a malformed report", () => {
    const partial = rawReport(CHANNEL_RPC, "par");
    const bad = rawReport(3, "z\n");
    const rest = rawReport(CHANNEL_RPC, "tial\n");
    const [, events] = feedAll([partial, bad, rest]);
    expect(events).toEqual([
      { kind: "decode-error", error: { reason: "bad-channel", channel: 3 } },
      { kind: "line", channel: CHANNEL_RPC, text: "partial" },
    ]);
  });
});
