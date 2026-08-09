// Protocol constants. Source and verification status for every value:
// docs/protocol-conformance.md. Values without a consumer yet (colors,
// keys, effects, timings) are still exported on purpose: the issue
// scopes them to this module, and the conformance table audits them
// here as executable documentation.

export const REPORT_SIZE = 64;
export const REPORT_ID = 6;
export const MAX_FRAGMENT = 61;
export const PAYLOAD_OFFSET = 3;

export const CHANNEL_DEBUG = 1;
export const CHANNEL_RPC = 2;
export type Channel = typeof CHANNEL_DEBUG | typeof CHANNEL_RPC;

export const RPC_TIMEOUT_MS = 10_000;
// Valid request ids are integers in [0, RPC_ID_LIMIT).
export const RPC_ID_LIMIT = 999;
// The vendor host waits this long between queued sends.
export const SEND_COOLDOWN_MS = 50;

export const NOTIFY_KEYS = "v.oai.hid";
export const NOTIFY_JOYSTICK = "v.oai.rad";

export const SERIAL_BAUD = 115_200;

export const TRANSPORT_ERRORS = [
  "ALREADY_CONNECTED",
  "TIMEOUT",
  "WRITE_FAILED",
  "DEVICE_DISCONNECTED",
] as const;
export type TransportError = (typeof TRANSPORT_ERRORS)[number];

export const STATUS_COLORS = {
  working: 0x304ffe,
  unread: 0x00ff4c,
  idle: 0xffffff,
  "awaiting-approval": 0xff6d00,
  "awaiting-response": 0xff6d00,
  error: 0xff0033,
  off: 0x000000,
} as const;
export type SlotStatus = keyof typeof STATUS_COLORS;

export const LIGHTING_EFFECTS = {
  off: 0,
  solid: 1,
  snake: 2,
  rainbow: 3,
  breath: 4,
  gradient: 5,
  shallowBreath: 6,
} as const;
export type LightingEffect = keyof typeof LIGHTING_EFFECTS;

export const KEY_ACTS = { release: 0, press: 1, tick: 2 } as const;
export type KeyAct = (typeof KEY_ACTS)[keyof typeof KEY_ACTS];

export const AGENT_KEYS = [
  "AG00",
  "AG01",
  "AG02",
  "AG03",
  "AG04",
  "AG05",
] as const;
export type AgentKey = (typeof AGENT_KEYS)[number];

export const COMMAND_KEYS = [
  "ACT06",
  "ACT07",
  "ACT08",
  "ACT09",
  "ACT10",
  "ACT11",
  "ACT12",
  "ACT10_ACT11",
] as const;
export type CommandKey = (typeof COMMAND_KEYS)[number];

// Encoder rotation always arrives with act === 2 (tick).
export const ENCODER_CW = "ENC_CW";
export const ENCODER_CCW = "ENC_CC";
