import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CHANNEL_RPC,
  type Channel,
  decodeReport,
  encodeFrames,
  encodeLine,
  feedReport,
  feedRpcLine,
  initialReassembly,
  initialRpcAccumulator,
  parseMessage,
  type ReassemblyState,
} from "../src/protocol/index.js";

interface Vector {
  name: string;
  channel: Channel;
  message: string;
  terminated: boolean;
  reports: string[];
}

const { vectors } = JSON.parse(
  readFileSync(new URL("./vectors.json", import.meta.url), "utf8"),
) as { vectors: Vector[] };

const toHex = (report: Uint8Array) =>
  Array.from(report, (b) => b.toString(16).padStart(2, "0")).join("");

const fromHex = (hex: string) =>
  new Uint8Array(hex.match(/.{2}/g)?.map((b) => Number.parseInt(b, 16)) ?? []);

describe("committed byte vectors (docs/protocol.md §10)", () => {
  for (const vector of vectors) {
    it(`${vector.name}: encoder reproduces the committed bytes`, () => {
      const reports = vector.terminated
        ? encodeLine(vector.channel, vector.message)
        : encodeFrames(vector.channel, vector.message);
      expect(reports.map(toHex)).toEqual(vector.reports);
    });
  }

  for (const vector of vectors.filter((v) => v.terminated)) {
    it(`${vector.name}: line reassembly recovers the message`, () => {
      let state: ReassemblyState = initialReassembly;
      const collected: { channel: Channel; text: string }[] = [];
      for (const hex of vector.reports) {
        const [next, events] = feedReport(state, fromHex(hex));
        state = next;
        for (const event of events) {
          expect(event.kind).toBe("line");
          if (event.kind === "line") collected.push(event);
        }
      }
      expect(collected).toEqual([
        { kind: "line", channel: vector.channel, text: vector.message },
      ]);
    });
  }

  it("rpc-request-bare: decodes and parses without a terminator", () => {
    const vector = vectors.find((v) => v.name === "rpc-request-bare");
    if (!vector) throw new Error("vector missing");
    let text = "";
    for (const hex of vector.reports) {
      const decoded = decodeReport(fromHex(hex));
      expect(decoded.ok).toBe(true);
      if (decoded.ok) {
        text += new TextDecoder().decode(decoded.frame.payload);
      }
    }
    expect(text).toBe(vector.message);
    const [, result] = feedRpcLine(initialRpcAccumulator, text);
    expect(result).toMatchObject({
      ok: true,
      message: { kind: "request", id: 1, method: "device.status" },
    });
  });

  it("RPC vectors parse as RPC messages", () => {
    for (const vector of vectors.filter((v) => v.channel === CHANNEL_RPC)) {
      expect(parseMessage(vector.message).ok).toBe(true);
    }
  });
});
