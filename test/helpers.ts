// Shared test helpers: arbitraries, hex codecs, report builders, and
// feed loops used across the protocol test files.

import fc from "fast-check";
import {
  CHANNEL_DEBUG,
  CHANNEL_RPC,
  type Channel,
  feedReport,
  initialReassembly,
  PAYLOAD_OFFSET,
  REPORT_ID,
  REPORT_SIZE,
  type ReassemblyEvent,
  type ReassemblyState,
} from "../src/protocol/index.js";

export const channelArb = fc.constantFrom<Channel>(CHANNEL_DEBUG, CHANNEL_RPC);

// Any line content, ASCII or multi-byte, without a line terminator.
export const messageArb = fc
  .oneof(fc.string(), fc.string({ unit: "grapheme" }))
  .filter((s) => !/[\r\n]/.test(s));

export const toHex = (report: Uint8Array): string =>
  Array.from(report, (b) => b.toString(16).padStart(2, "0")).join("");

export const fromHex = (hex: string): Uint8Array =>
  new Uint8Array(hex.match(/.{2}/g)?.map((b) => Number.parseInt(b, 16)) ?? []);

/** The payload bytes a report declares, per its length byte. */
export const payloadOf = (report: Uint8Array): Uint8Array =>
  report.subarray(PAYLOAD_OFFSET, PAYLOAD_OFFSET + (report[2] as number));

/** Concatenated declared payloads of a report sequence. */
export const payloadsOf = (reports: readonly Uint8Array[]): Uint8Array =>
  new Uint8Array(reports.flatMap((report) => [...payloadOf(report)]));

/** Builds a raw report by hand, bypassing the encoder under test. */
export function rawReport(channel: number, payload: string): Uint8Array {
  const bytes = new TextEncoder().encode(payload);
  const report = new Uint8Array(REPORT_SIZE);
  report[0] = REPORT_ID;
  report[1] = channel;
  report[2] = bytes.length;
  report.set(bytes, 3);
  return report;
}

/** Feeds reports through the reassembler, collecting all events. */
export function feedAll(
  reports: readonly Uint8Array[],
  state: ReassemblyState = initialReassembly,
): [ReassemblyState, ReassemblyEvent[]] {
  const events: ReassemblyEvent[] = [];
  for (const report of reports) {
    const [next, produced] = feedReport(state, report);
    state = next;
    events.push(...produced);
  }
  return [state, events];
}

/** The line events among a batch of reassembly events. */
export const lines = (events: readonly ReassemblyEvent[]) =>
  events.flatMap((e) => (e.kind === "line" ? [e] : []));
