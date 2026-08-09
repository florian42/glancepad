import { describe, expect, it } from "vitest";
import {
  feedRpcLine,
  initialRpcAccumulator,
  type RpcAccumulator,
} from "../src/protocol/index.js";

function feedLines(lines: string[]) {
  let state: RpcAccumulator = initialRpcAccumulator;
  const results = [];
  for (const line of lines) {
    const [next, result] = feedRpcLine(state, line);
    state = next;
    if (result) results.push(result);
  }
  return { state, results };
}

describe("RPC message boundaries (docs/protocol.md §5)", () => {
  it("emits a complete message from one line", () => {
    const { results } = feedLines(['{"method":"m","params":null,"id":1}']);
    expect(results).toMatchObject([{ ok: true, message: { kind: "request" } }]);
  });

  it("discards text before the first brace", () => {
    const { results } = feedLines(['[RPC] noise {"id":1,"result":"ok"}']);
    expect(results).toMatchObject([
      { ok: true, message: { kind: "response", id: 1, result: "ok" } },
    ]);
  });

  it("ignores a line with no brace while nothing is pending", () => {
    const { state, results } = feedLines(["boot ok"]);
    expect(results).toEqual([]);
    expect(state.pending).toBe("");
  });

  it("accumulates a JSON object split across lines", () => {
    const { state, results } = feedLines(['{"id":1,', '"result":"ok"}']);
    expect(results).toMatchObject([
      { ok: true, message: { kind: "response", id: 1, result: "ok" } },
    ]);
    expect(state.pending).toBe("");
  });

  it("keeps incomplete JSON pending", () => {
    const { state, results } = feedLines(['{"id":1,"result":']);
    expect(results).toEqual([]);
    expect(state.pending).toBe('{"id":1,"result":');
  });

  it("reports a complete but structurally invalid message and resets", () => {
    const { state, results } = feedLines(['{"params":{}}']);
    expect(results).toMatchObject([{ ok: false, reason: "invalid-message" }]);
    expect(state.pending).toBe("");
  });
});
