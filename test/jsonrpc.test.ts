import { describe, expect, it } from "vitest";
import {
  encodeNotification,
  encodeRequest,
  encodeResponse,
  escapeNonAscii,
  isValidRequestId,
  nextRequestId,
  parseMessage,
  RPC_ID_LIMIT,
} from "../src/protocol/index.js";

describe("request ids (docs/protocol.md §5)", () => {
  it("accepts integers in [0, 999)", () => {
    expect(isValidRequestId(0)).toBe(true);
    expect(isValidRequestId(998)).toBe(true);
  });

  it("rejects what the firmware rejects", () => {
    expect(isValidRequestId(999)).toBe(false);
    expect(isValidRequestId(-1)).toBe(false);
    expect(isValidRequestId(1.5)).toBe(false);
    expect(isValidRequestId("7")).toBe(false);
  });

  it("wraps at the limit", () => {
    expect(nextRequestId(0)).toBe(1);
    expect(nextRequestId(RPC_ID_LIMIT - 1)).toBe(0);
  });
});

describe("encoding in the vendor wire shape", () => {
  it("emits {method, params, id} with no jsonrpc member", () => {
    expect(encodeRequest(1, "device.status")).toBe(
      '{"method":"device.status","params":null,"id":1}',
    );
    expect(encodeRequest(2, "ping", { a: 1 })).toBe(
      '{"method":"ping","params":{"a":1},"id":2}',
    );
  });

  it("escapes non-ASCII so the wire text is pure ASCII", () => {
    expect(escapeNonAscii("héllo")).toBe("h\\u00e9llo");
    expect(escapeNonAscii("𝄞")).toBe("\\ud834\\udd1e");
    const encoded = encodeRequest(3, "echo", { text: "café 🚀" });
    expect(encoded).toBe(
      '{"method":"echo","params":{"text":"caf\\u00e9 \\ud83d\\ude80"},"id":3}',
    );
    expect(JSON.parse(encoded)).toEqual({
      method: "echo",
      params: { text: "café 🚀" },
      id: 3,
    });
  });

  it("throws on an id the firmware would reject", () => {
    expect(() => encodeRequest(RPC_ID_LIMIT, "m")).toThrow(RangeError);
  });

  it("encodes a notification without an id", () => {
    expect(encodeNotification("log", ["x"])).toBe(
      '{"method":"log","params":["x"]}',
    );
  });
});

describe("parsing (skip-and-report on malformed input)", () => {
  it("classifies a request", () => {
    expect(parseMessage('{"method":"m","params":null,"id":3}')).toMatchObject({
      ok: true,
      message: { kind: "request", id: 3, method: "m" },
    });
  });

  it("classifies a notification, long and compact keys alike", () => {
    expect(
      parseMessage('{"method":"v.oai.hid","params":{"key":"AG00","act":1}}'),
    ).toMatchObject({
      ok: true,
      message: { kind: "notification", method: "v.oai.hid" },
    });
    expect(
      parseMessage('{"m":"v.oai.hid","p":{"key":"AG00","act":1}}'),
    ).toMatchObject({
      ok: true,
      message: {
        kind: "notification",
        method: "v.oai.hid",
        params: { key: "AG00", act: 1 },
      },
    });
  });

  it("classifies a response, result or error, including id 0", () => {
    expect(parseMessage('{"id":3,"result":{}}')).toMatchObject({
      ok: true,
      message: { kind: "response", id: 3 },
    });
    expect(
      parseMessage('{"id":0,"error":{"code":1,"message":"x"}}'),
    ).toMatchObject({
      ok: true,
      message: { kind: "response", id: 0 },
    });
    expect(parseMessage('{"i":7,"result":"ok"}')).toMatchObject({
      ok: true,
      message: { kind: "response", id: 7 },
    });
  });

  it("tolerates an extra jsonrpc member", () => {
    expect(
      parseMessage('{"jsonrpc":"2.0","id":1,"method":"device.status"}'),
    ).toMatchObject({ ok: true, message: { kind: "request", id: 1 } });
  });

  it("reports invalid JSON without throwing", () => {
    expect(parseMessage("not json")).toEqual({
      ok: false,
      reason: "invalid-json",
      raw: "not json",
    });
  });

  it("reports a response whose error member is not an error object", () => {
    for (const raw of [
      '{"id":1,"error":"boom"}',
      '{"id":1,"error":{"code":"x","message":"m"}}',
      '{"id":1,"error":{"code":1}}',
    ]) {
      expect(parseMessage(raw)).toMatchObject({
        ok: false,
        reason: "invalid-message",
      });
    }
  });

  it("reports structurally invalid messages", () => {
    for (const raw of [
      '"str"',
      "[1]",
      "{}",
      '{"id":"s","method":"m"}',
      '{"id":1}',
      '{"params":{}}',
    ]) {
      expect(parseMessage(raw)).toMatchObject({
        ok: false,
        reason: "invalid-message",
      });
    }
  });
});

describe("encoding responses (the device-to-host direction)", () => {
  it("encodes a result as {result, id}", () => {
    expect(encodeResponse(7, { result: true })).toBe('{"result":true,"id":7}');
  });

  it("encodes an error as {error, id}", () => {
    expect(
      encodeResponse(7, {
        error: { code: -32601, message: "method not found" },
      }),
    ).toBe('{"error":{"code":-32601,"message":"method not found"},"id":7}');
  });

  it("escapes non-ASCII, like the request encoder", () => {
    expect(encodeResponse(1, { result: "ok ✓" })).toBe(
      '{"result":"ok \\u2713","id":1}',
    );
  });

  it("throws on an id outside the firmware range", () => {
    expect(() => encodeResponse(RPC_ID_LIMIT, { result: true })).toThrow(
      RangeError,
    );
  });

  it("round-trips through parseMessage with the raw text attached", () => {
    const raw = encodeResponse(3, { result: true });
    const parsed = parseMessage(raw);
    expect(parsed).toEqual({
      ok: true,
      message: { kind: "response", id: 3, result: true, error: undefined },
      raw,
    });
  });
});
