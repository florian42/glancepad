import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  CHANNEL_RPC,
  decodeReport,
  encodeFrames,
  encodeLine,
  MAX_FRAGMENT,
  PAYLOAD_OFFSET,
  REPORT_ID,
  REPORT_SIZE,
} from "../src/protocol/index.js";
import { channelArb, messageArb, payloadsOf, rawReport } from "./helpers.js";

const byteLength = (s: string) => new TextEncoder().encode(s).length;

describe("encodeFrames (docs/protocol.md §2–§3, bare direction)", () => {
  it("frames text exactly as given, no terminator added", () => {
    fc.assert(
      fc.property(
        channelArb,
        fc.string({ unit: "grapheme" }),
        (channel, text) => {
          const reports = encodeFrames(channel, text);
          const bytes = new TextEncoder().encode(text);
          expect(reports).toHaveLength(Math.ceil(bytes.length / MAX_FRAGMENT));
          expect(payloadsOf(reports)).toEqual(bytes);
        },
      ),
    );
  });

  it("produces no reports for empty text", () => {
    expect(encodeFrames(CHANNEL_RPC, "")).toEqual([]);
  });
});

describe("encodeLine (docs/protocol.md §2–§3)", () => {
  it("emits ceil((bytes+1)/61) reports of exactly 64 bytes", () => {
    fc.assert(
      fc.property(channelArb, messageArb, (channel, message) => {
        const reports = encodeLine(channel, message);
        const lineBytes = byteLength(message) + 1;
        expect(reports).toHaveLength(Math.ceil(lineBytes / MAX_FRAGMENT));
        for (const report of reports) {
          expect(report).toHaveLength(REPORT_SIZE);
        }
      }),
    );
  });

  it("writes the header and zero padding on every report", () => {
    fc.assert(
      fc.property(channelArb, messageArb, (channel, message) => {
        for (const report of encodeLine(channel, message)) {
          expect(report[0]).toBe(REPORT_ID);
          expect(report[1]).toBe(channel);
          const length = report[2] as number;
          expect(length).toBeGreaterThan(0);
          expect(length).toBeLessThanOrEqual(MAX_FRAGMENT);
          for (let i = PAYLOAD_OFFSET + length; i < REPORT_SIZE; i++) {
            expect(report[i]).toBe(0);
          }
        }
      }),
    );
  });

  it("concatenated payloads equal the UTF-8 line, terminator included", () => {
    fc.assert(
      fc.property(channelArb, messageArb, (channel, message) => {
        expect(payloadsOf(encodeLine(channel, message))).toEqual(
          new TextEncoder().encode(`${message}\n`),
        );
      }),
    );
  });

  it("fills every report except the last to the 61-byte maximum", () => {
    fc.assert(
      fc.property(channelArb, messageArb, (channel, message) => {
        const reports = encodeLine(channel, message);
        for (const report of reports.slice(0, -1)) {
          expect(report[2]).toBe(MAX_FRAGMENT);
        }
      }),
    );
  });

  it("rejects a message that contains a line terminator", () => {
    expect(() => encodeLine(CHANNEL_RPC, "a\nb")).toThrow(TypeError);
    expect(() => encodeLine(CHANNEL_RPC, "a\rb")).toThrow(TypeError);
  });
});

describe("decodeReport on malformed input (docs/protocol.md §2)", () => {
  const good = () => rawReport(CHANNEL_RPC, "x");

  it("accepts a well-formed report", () => {
    expect(decodeReport(good()).ok).toBe(true);
  });

  it("reports, and does not throw on, a wrong report id", () => {
    const report = good();
    report[0] = 5;
    expect(decodeReport(report)).toEqual({
      ok: false,
      reason: "bad-report-id",
      reportId: 5,
    });
  });

  it("reports an unknown channel", () => {
    expect(decodeReport(rawReport(3, "x"))).toEqual({
      ok: false,
      reason: "bad-channel",
      channel: 3,
    });
  });

  it("reports a length above 61", () => {
    const report = good();
    report[2] = 62;
    expect(decodeReport(report)).toEqual({
      ok: false,
      reason: "bad-length",
      length: 62,
    });
  });

  it("reports a wrong report size", () => {
    expect(decodeReport(new Uint8Array(63))).toEqual({
      ok: false,
      reason: "bad-size",
      size: 63,
    });
  });
});
