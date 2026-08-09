# Protocol conformance checklist

Every protocol constant, paired with the place in the vendor bundle it
came from, so a human can audit the set. Bundle paths are internal to
the `app.asar` of the ChatGPT desktop app (`OpenAI.Codex`
v26.803.5235.0). `WL` = `node_modules/@worklouder/device-kit-oai/`
`node_modules/@worklouder/wl-device-kit/dist/index.js`, the wl-device-kit
bundle; class `WLDeviceCommImpl` (transport) and `WLRPCClient` (codec).
`SVC` = the app's `service-CJETEjOt.js`. `OAI` = `device-kit-oai/dist/`.

**Status values, weakest to strongest.**

- `choice` — our own decision, not a vendor fact.
- `inferred` — implied by vendor receive code; no writer exists to read.
- `read` — verified by reading the bundle, and independently confirmed
  on 2026-08-09 by a cold re-derivation: a second agent with a fresh
  context derived the framing from the bundle without seeing our
  implementation or research notes, and the two derivations agree.
- `oracle` — `read`, and additionally the vendor's own framing function
  was executed locally against our test messages; its output matched
  our committed vectors byte for byte.

**No constant is wire-verified: no keypad has been attached.** The
capture format in [capture-format.md](capture-format.md) exists so one
hardware session can clear this column.

## Framing

| # | Constant | Value | Source | Status |
|---|---|---|---|---|
| 1 | Report size | 64 bytes | `WL` `sendDataHID`, `Buffer.alloc(64)` | oracle |
| 2 | Report id (byte 0) | `6` | same, `data[0] = 6` | oracle |
| 3 | Channel byte (byte 1) | `1` debug, `2` RPC | `WL` `CHANNEL_DEBUG`/`CHANNEL_RPC`; `parseHIDReport` | oracle |
| 4 | Length byte (byte 2) | payload length, max 61 | `WL` `sendDataHID` (`MAX_CHUNK_SIZE = 61`); `parseHIDReport` | oracle |
| 5 | Payload offset | byte 3 | same | oracle |
| 6 | Padding | `0`, from `Buffer.alloc`; receiver ignores bytes past the length | `WL` `sendDataHID` | oracle |
| 7 | No sequence/continuation header | fragments ordered by arrival only | `WL` `sendDataHID` loop | read |
| 8 | Host transmits on channel 2 only | debug is receive-only | `WL` `sendDataHID` hardcodes `CHANNEL_RPC` | read |
| 9 | Host→device terminator | **none** — bare JSON text | `WL` `sendRpcCall` → `sendData` → `sendDataHID`, no append | oracle |
| 10 | Device→host terminator | `\n` per message | `WL` `parseHIDdata` delivers only after `\r?\n` | inferred |
| 11 | Line split (receive) | `\r?\n`, per channel | `WL` `parseHIDdata` | read |
| 12 | Per-channel reassembly | independent string buffers | same, `this.buffers[channel]` | read |

## RPC layer

| # | Constant | Value | Source | Status |
|---|---|---|---|---|
| 13 | Request wire shape | `{method, params, id}`, in that order; **no `jsonrpc` member**; `params` is `null` when absent | `WL` `createJsonRpcRequest` | read |
| 14 | Non-ASCII escaping | `\uXXXX` per UTF-16 code unit; wire text is ASCII | `WL` `escapeUnicode` | read |
| 15 | Compact key aliases | `m` method, `p` params, `i` id, accepted on receive | `WL` `parseRpcData`, `handleNotifyMessage` | read |
| 16 | Message boundary (receive) | JSON completeness: discard before first `{`, accumulate lines until `JSON.parse` succeeds | `WL` `parseRpcData` | read |
| 17 | Request id range | integers `[0, 999)`; firmware rejects others | `WL` `createRpcId` comment; `randomInt(0, 999)` | read |
| 18 | Id scheme | vendor host draws random ids; any in-range scheme valid; ours is sequential wrap | same | choice |
| 19 | Request timeout | 10 000 ms | `WL` `_sendJsonRpcRequest`, `_sendLegacyRpcRequest` | read |
| 20 | Send cooldown | 50 ms between queued sends | `WL` `enqueue`/`process` | read |
| 21 | Notification: keys | `v.oai.hid` | `OAI` `notify_keys.d.ts` | read |
| 22 | Notification: joystick | `v.oai.rad` | same | read |
| 23 | Error identifiers | `ALREADY_CONNECTED`, `TIMEOUT`, `WRITE_FAILED`, `DEVICE_DISCONNECTED` | `WL` `WLDeviceError` codes | read |

## Serial transport

| # | Constant | Value | Source | Status |
|---|---|---|---|---|
| 24 | Baud rate | 115 200 | `WL` `connectWithSerial` | read |
| 25 | Outgoing RPC over serial | raw text, no framing, no terminator | `WL` `sendDataSerial` | read |
| 26 | Legacy `#rpc#…#` framing | sent with `\r\n`; received via `\n` delimiter parser | `WL` `_sendLegacyRpcRequest`, `parseSerialData` | read |

## Identifiers, colors, effects

| # | Constant | Value | Source | Status |
|---|---|---|---|---|
| 27 | `act` values | `0` release, `1` press, `2` tick | `OAI` `hid_key.d.ts`; `SVC` | read |
| 28 | Agent keys | `AG00`–`AG05` | `SVC`, `/^AG0([0-5])$/` | read |
| 29 | Command keys | `ACT06`–`ACT12`, merged `ACT10_ACT11` | `SVC` | read |
| 30 | Encoder rotation | `ENC_CW`, `ENC_CC`, `act === 2` | `SVC` | read |
| 31 | Color `working` | `0x304FFE` | `src-Cz_uUmVl.js` status→color map | read |
| 32 | Color `unread` | `0x00FF4C` | same | read |
| 33 | Color `idle` | `0xFFFFFF` | same | read |
| 34 | Color `awaiting-approval` | `0xFF6D00` | same | read |
| 35 | Color `awaiting-response` | `0xFF6D00` | same | read |
| 36 | Color `error` | `0xFF0033` | same | read |
| 37 | Color `off` | `0x000000` | same | read |
| 38 | Effect enum | 0 off, 1 solid, 2 snake, 3 rainbow, 4 breath, 5 gradient, 6 shallowBreath | `OAI` `oai_lighting_effect.d.ts` | read |

Items 27–38 were established by the earlier bundle reading
(`research/virtual-device-options.md` §4); the cold re-derivation
covered framing and the RPC layer, not these.

## Divergences from the vendor host, deliberate

- **Receive decoding.** The vendor host decodes each fragment as UTF-8
  on arrival, so a multi-byte character split across reports would
  corrupt there; its ASCII escaping makes that unreachable for its own
  traffic. Our receiver buffers raw bytes per channel and decodes only
  complete lines — a strict superset (docs/protocol.md §5).
- **Malformed input.** On a packet parse error the vendor host clears
  both channel buffers. Ours reports a structured decode error and
  keeps the buffers.
- **Id generation.** Random there, sequential wrap here (item 18).

## Known limits of this evidence

- The device-side reassembly of host→device messages lives in firmware
  that no one has read. That the firmware needs no terminator (item 9)
  is proven only for what the vendor host sends.
- Whether the OS HID layer transmits the leading report-id byte
  verbatim is a `node-hid` native-layer question, outside the bundle.
- Wire verification needs a keypad. Record a capture per
  [capture-format.md](capture-format.md), replay it through
  `src/protocol/`, and flip verified items to `wire`.
