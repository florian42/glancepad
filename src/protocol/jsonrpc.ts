// RPC codec — docs/protocol.md §5. The wire format is JSON-RPC-like:
// it carries no "jsonrpc" version member, requests always carry a
// params member (null when absent), and receivers accept the compact
// key aliases `m`, `p`, and `i`.

import { RPC_ID_LIMIT } from "./constants.js";

export interface RpcRequest {
  readonly kind: "request";
  readonly id: number;
  readonly method: string;
  readonly params: unknown;
}

export interface RpcNotification {
  readonly kind: "notification";
  readonly method: string;
  readonly params: unknown;
}

export interface RpcError {
  readonly code: number;
  readonly message: string;
  readonly data?: unknown;
}

export interface RpcResponse {
  readonly kind: "response";
  readonly id: number;
  readonly result?: unknown;
  readonly error?: RpcError;
}

export type RpcMessage = RpcRequest | RpcNotification | RpcResponse;

export type ParseResult =
  | { readonly ok: true; readonly message: RpcMessage }
  | {
      readonly ok: false;
      readonly reason: "invalid-json" | "invalid-message";
      readonly raw: string;
    };

/** The firmware accepts request ids in [0, 999) only. */
export function isValidRequestId(id: unknown): id is number {
  return (
    typeof id === "number" &&
    Number.isInteger(id) &&
    id >= 0 &&
    id < RPC_ID_LIMIT
  );
}

/**
 * Next request id, wrapping inside the firmware's accepted range. Our
 * ids are sequential; the vendor host draws random ids from the same
 * range. Both are valid — only the range is firmware-constrained.
 */
export function nextRequestId(id: number): number {
  return (id + 1) % RPC_ID_LIMIT;
}

/**
 * Escapes every non-ASCII character as `\uXXXX` (one escape per UTF-16
 * code unit), so the encoded wire text is pure ASCII. The vendor host
 * escapes outgoing JSON this way; it also keeps its per-fragment UTF-8
 * decoding safe.
 */
export function escapeNonAscii(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    out +=
      unit < 0x80
        ? (text[i] as string)
        : `\\u${unit.toString(16).padStart(4, "0")}`;
  }
  return out;
}

/**
 * Encodes a request in the vendor wire shape: `{method, params, id}` in
 * that member order, params `null` when absent, non-ASCII escaped.
 * Throws on an id the firmware would reject.
 */
export function encodeRequest(
  id: number,
  method: string,
  params: unknown = null,
): string {
  if (!isValidRequestId(id)) {
    throw new RangeError(
      `request id must be an integer in [0, ${RPC_ID_LIMIT})`,
    );
  }
  return escapeNonAscii(JSON.stringify({ method, params, id }));
}

/** Encodes a notification: a request shape without an id. */
export function encodeNotification(
  method: string,
  params: unknown = null,
): string {
  return escapeNonAscii(JSON.stringify({ method, params }));
}

/**
 * Parses one complete RPC JSON text. Never throws on device input:
 * malformed text comes back as an `{ok: false}` result. Accepts the
 * compact aliases `m`/`p`/`i` and ignores an extra `jsonrpc` member.
 */
export function parseMessage(raw: string): ParseResult {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "invalid-json", raw };
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, reason: "invalid-message", raw };
  }
  const record = value as Record<string, unknown>;
  const id = record.id ?? record.i;
  const method = record.method ?? record.m;
  const params = record.params ?? record.p ?? null;

  if (typeof method === "string" && id === undefined) {
    return { ok: true, message: { kind: "notification", method, params } };
  }
  if (id !== undefined && typeof id !== "number") {
    return { ok: false, reason: "invalid-message", raw };
  }
  if (typeof method === "string" && typeof id === "number") {
    return { ok: true, message: { kind: "request", id, method, params } };
  }
  if (typeof id === "number" && ("result" in record || "error" in record)) {
    return {
      ok: true,
      message: {
        kind: "response",
        id,
        result: record.result,
        error: record.error as RpcError | undefined,
      },
    };
  }
  return { ok: false, reason: "invalid-message", raw };
}
