// The pure protocol module. Imports nothing outside src/protocol and
// performs no I/O — enforced by `pnpm lint:deps` (ADR-0001).

export * from "./constants.js";
export * from "./framing.js";
export * from "./jsonrpc.js";
export * from "./lighting.js";
export * from "./reassembly.js";
export * from "./rpcaccumulator.js";
