// RPC message-boundary accumulation — docs/protocol.md §5. Above the
// line split, the receiver finds message boundaries by JSON
// completeness: text accumulates until it parses. A pure reducer, like
// the reassembler.

import { type ParseResult, parseMessage } from "./jsonrpc.js";

export interface RpcAccumulator {
  /** Text of a JSON value that has not completed yet. */
  readonly pending: string;
}

export const initialRpcAccumulator: RpcAccumulator = { pending: "" };

/**
 * Feeds one complete line of RPC-channel text. When nothing is pending,
 * text before the first `{` is discarded; a line with no `{` at all is
 * ignored. The line then joins the pending text, and one JSON parse is
 * attempted: on success the message (or a structurally-invalid report)
 * is emitted and the pending text clears; on failure the text stays
 * pending for the next line.
 */
export function feedRpcLine(
  state: RpcAccumulator,
  line: string,
): readonly [RpcAccumulator, ParseResult | undefined] {
  let pending = state.pending;
  if (pending.length === 0) {
    const jsonStart = line.indexOf("{");
    if (jsonStart === -1) return [state, undefined];
    pending = line.slice(jsonStart);
  } else {
    pending += line;
  }
  const result = parseMessage(pending);
  if (!result.ok && result.reason === "invalid-json") {
    return [{ pending }, undefined];
  }
  return [initialRpcAccumulator, result];
}
