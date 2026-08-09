// HID report framing — docs/protocol.md §2–§3.

import {
  CHANNEL_DEBUG,
  CHANNEL_RPC,
  type Channel,
  MAX_FRAGMENT,
  PAYLOAD_OFFSET,
  REPORT_ID,
  REPORT_SIZE,
} from "./constants.js";

export interface Frame {
  readonly channel: Channel;
  /** Raw payload bytes of this report; a fragment of a line. */
  readonly payload: Uint8Array;
}

export type FrameDecodeError =
  | { readonly reason: "bad-size"; readonly size: number }
  | { readonly reason: "bad-report-id"; readonly reportId: number }
  | { readonly reason: "bad-channel"; readonly channel: number }
  | { readonly reason: "bad-length"; readonly length: number };

export type FrameDecodeResult =
  | { readonly ok: true; readonly frame: Frame }
  | ({ readonly ok: false } & FrameDecodeError);

/**
 * Encodes text into 64-byte reports exactly as given: encodes UTF-8 and
 * splits into fragments of at most 61 bytes. Adds no terminator — a
 * host-to-device RPC message travels bare (docs/protocol.md §3). Empty
 * text produces no reports.
 */
export function encodeFrames(channel: Channel, text: string): Uint8Array[] {
  const bytes = new TextEncoder().encode(text);
  const reports: Uint8Array[] = [];
  for (let offset = 0; offset < bytes.length; offset += MAX_FRAGMENT) {
    const fragment = bytes.subarray(offset, offset + MAX_FRAGMENT);
    const report = new Uint8Array(REPORT_SIZE);
    report[0] = REPORT_ID;
    report[1] = channel;
    report[2] = fragment.length;
    report.set(fragment, PAYLOAD_OFFSET);
    reports.push(report);
  }
  return reports;
}

/**
 * Encodes one newline-terminated line — the device-to-host direction,
 * and the debug channel. Appends `\n` and frames the result. The
 * message itself must not contain a line terminator — that is a caller
 * bug, not device input, so it throws.
 */
export function encodeLine(channel: Channel, message: string): Uint8Array[] {
  if (/[\r\n]/.test(message)) {
    throw new TypeError("message must not contain a line terminator");
  }
  return encodeFrames(channel, `${message}\n`);
}

/**
 * Decodes one incoming report. Never throws on device input: malformed
 * reports come back as `{ok: false}` results (docs/protocol.md §2).
 */
export function decodeReport(report: Uint8Array): FrameDecodeResult {
  if (report.length !== REPORT_SIZE) {
    return { ok: false, reason: "bad-size", size: report.length };
  }
  const reportId = report[0] as number;
  const channel = report[1] as number;
  const length = report[2] as number;
  if (reportId !== REPORT_ID) {
    return { ok: false, reason: "bad-report-id", reportId };
  }
  if (channel !== CHANNEL_DEBUG && channel !== CHANNEL_RPC) {
    return { ok: false, reason: "bad-channel", channel };
  }
  if (length > MAX_FRAGMENT) {
    return { ok: false, reason: "bad-length", length };
  }
  return {
    ok: true,
    frame: {
      channel,
      payload: report.subarray(PAYLOAD_OFFSET, PAYLOAD_OFFSET + length),
    },
  };
}
