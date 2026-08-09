// Per-channel line reassembly — docs/protocol.md §4. A pure reducer:
// callers thread the state value; no mutation, no I/O.

import { CHANNEL_DEBUG, CHANNEL_RPC, type Channel } from "./constants.js";
import { decodeReport, type FrameDecodeError } from "./framing.js";

const LF = 0x0a;
const CR = 0x0d;

export interface ReassemblyState {
  readonly buffers: { readonly [C in Channel]: Uint8Array };
}

export const initialReassembly: ReassemblyState = {
  buffers: {
    [CHANNEL_DEBUG]: new Uint8Array(0),
    [CHANNEL_RPC]: new Uint8Array(0),
  },
};

export type ReassemblyEvent =
  | { readonly kind: "line"; readonly channel: Channel; readonly text: string }
  | { readonly kind: "decode-error"; readonly error: FrameDecodeError };

/**
 * Feeds one incoming report. Returns the next state and the events it
 * produced: zero or more complete lines, or one decode error. Buffers
 * hold raw bytes so a UTF-8 character split across reports survives;
 * text is decoded only when a line completes.
 */
export function feedReport(
  state: ReassemblyState,
  report: Uint8Array,
): readonly [ReassemblyState, readonly ReassemblyEvent[]] {
  const decoded = decodeReport(report);
  if (!decoded.ok) {
    const { ok: _ok, ...error } = decoded;
    return [state, [{ kind: "decode-error", error }]];
  }
  const { channel, payload } = decoded.frame;

  const previous = state.buffers[channel];
  let buffer = new Uint8Array(previous.length + payload.length);
  buffer.set(previous, 0);
  buffer.set(payload, previous.length);

  const events: ReassemblyEvent[] = [];
  const utf8 = new TextDecoder();
  let start = 0;
  for (let i = 0; i < buffer.length; i++) {
    if (buffer[i] !== LF) continue;
    const end = i > start && buffer[i - 1] === CR ? i - 1 : i;
    events.push({
      kind: "line",
      channel,
      text: utf8.decode(buffer.subarray(start, end)),
    });
    start = i + 1;
  }
  if (start > 0) buffer = buffer.slice(start);

  return [{ buffers: { ...state.buffers, [channel]: buffer } }, events];
}
