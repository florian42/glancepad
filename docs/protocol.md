# Codex Micro wire protocol — specification

This document specifies the wire protocol in our own words. It is the
source for the byte vectors in `src/protocol/vectors.json` and for the
tests. Every fact here comes from reading vendor code, not from a wire.
The verification status of each constant lives in
[protocol-conformance.md](protocol-conformance.md).

## 1. Scope

This specification covers the HID report layout, fragmentation and
reassembly, the JSON-RPC layer, and the protocol constants: status
colors, key identifiers, and lighting effects. It does not cover device
discovery or the transport implementations.

## 2. HID report layout

Each HID report is exactly **64 bytes**:

| Byte | Name | Value |
|---|---|---|
| 0 | report id | always `6` |
| 1 | channel | `1` = debug, `2` = RPC |
| 2 | length | payload bytes in this report, `0`–`61` |
| 3 … 3+length−1 | payload | UTF-8 bytes, a fragment of a message |
| 3+length … 63 | padding | `0` |

Reports carry no sequence number, no total length, and no continuation
flag; fragments are ordered only by arrival. The vendor host writes
zero padding (`Buffer.alloc`), and a receiver must ignore bytes after
`3 + length`.

The host transmits on channel 2 only. Channel 1 carries device log
lines toward the host; no vendor code path sends on it.

A report with a report id other than `6`, a length greater than `61`, or
a size other than 64 bytes is malformed. A decoder must not throw on
malformed input. It reports a decode error and continues.

## 3. Messages and fragmentation

To send text, encode it as UTF-8 and split the bytes into fragments of
at most **61 bytes**, in order. Each fragment becomes one report on the
sender's channel. The split operates on bytes, so a multi-byte UTF-8
character may span two reports.

The two directions terminate messages differently:

- **Host to device**: an RPC message is sent bare, with **no trailing
  newline**. The vendor host frames exactly the JSON text and nothing
  more. (In practice the text is also pure ASCII — see §5.)
- **Device to host**: each message is one line, terminated by `\n`. The
  host receiver only delivers text after a line terminator arrives, so
  this direction must terminate. This is inferred from the host's
  receive code; firmware source is not available.

Text whose encoded form is 61 bytes or fewer fits in one report. A
62-byte text produces two reports: 61 bytes, then 1 byte.

## 4. Reassembly

The receiver keeps one byte buffer **per channel**. For each report it
appends the payload bytes to that channel's buffer. It then splits the
buffer on the pattern `\r?\n`: every complete line is delivered, and the
bytes after the last line terminator stay in the buffer. Channels never
share a buffer, so debug and RPC traffic reassemble independently and
never interleave.

The receiver accepts `\r\n` as a terminator; the sender emits only `\n`.
Buffered bytes are decoded as UTF-8 only when a complete line is
delivered, so split multi-byte characters reassemble correctly.

## 5. RPC layer

Traffic on the RPC channel (2) is **JSON-RPC-like**: single JSON
objects, but **without a `"jsonrpc": "2.0"` member**. Lines on the
debug channel (1) are free-form log text and are not parsed as JSON.

**Requests (host to device).** The wire shape is
`{"method": M, "params": P, "id": N}` in that member order. `params` is
always present — `null` when the call has no parameters. After JSON
serialization, every non-ASCII character is escaped as `\uXXXX` (one
escape per UTF-16 code unit), so the outgoing wire text is pure ASCII.

**Receiving.** Message boundaries come from JSON completeness, above
the line split of §4: when nothing is pending, text before the first
`{` in a line is discarded and a line without `{` is ignored; lines
then accumulate until the collected text parses as JSON. A receiver
accepts the compact key aliases `m` (method), `p` (params), and `i`
(id). A message with a `method` and no id is a notification; with both,
a request; with an id and a `result` or `error` member, a response.

Rules and constants:

- Request ids are integers in **`[0, 999)`**. The firmware rejects ids
  outside this range. The vendor host draws random ids from the range;
  any in-range scheme is valid.
- A request times out after **10 000 ms**.
- The vendor host waits **50 ms** between queued sends, to avoid
  overwhelming the device.
- The device sends notifications on two methods: `v.oai.hid` for key
  events and `v.oai.rad` for the joystick.
- Transport error identifiers: `ALREADY_CONNECTED`, `TIMEOUT`,
  `WRITE_FAILED`, `DEVICE_DISCONNECTED`.

**Compatibility note.** The vendor host decodes each report's payload
as UTF-8 on arrival, fragment by fragment, so a multi-byte character
split across two reports would corrupt there. Its ASCII escaping makes
that unreachable for its own traffic. Our receiver buffers raw bytes
per channel and decodes complete lines, which handles both ASCII and
raw UTF-8 correctly — a strict superset.

Key event payloads carry `{key, act}`. `act` is `0` = release, `1` =
press, `2` = tick. Joystick payloads carry `{angle, distance}`, polar,
both normalized 0–1.

## 6. Key identifiers

| Group | Identifiers |
|---|---|
| Agent keys | `AG00` … `AG05` |
| Command keys | `ACT06` … `ACT12`, plus the merged id `ACT10_ACT11` |
| Encoder rotation | `ENC_CW`, `ENC_CC`, always with `act === 2` |
| Encoder press | key id starts with `ENC`; `act` `1` = press, `0` = release |

## 7. Status colors

Packed RGB integers (`0xRRGGBB`):

| Status | Hex |
|---|---|
| `working` | `0x304FFE` |
| `unread` | `0x00FF4C` |
| `idle` | `0xFFFFFF` |
| `awaiting-approval` | `0xFF6D00` |
| `awaiting-response` | `0xFF6D00` |
| `error` | `0xFF0033` |
| `off` | `0x000000` |

## 8. Lighting effects

| Value | Effect |
|---|---|
| 0 | `off` |
| 1 | `solid` |
| 2 | `snake` |
| 3 | `rainbow` |
| 4 | `breath` |
| 5 | `gradient` |
| 6 | `shallowBreath` |

`brightness` and `speed` are normalized 0–1. Two zones exist: `ambient`
and `keys`. Per-agent-key lighting travels as a separate thread-lighting
array.

## 9. Serial transport

Over a serial port the transport is plain UTF-8 text at **115 200
baud**. There is no report framing; the HID layout in §2 does not
apply. Outgoing RPC messages are written raw, with no terminator —
the same bare escaped JSON as §5. Incoming RPC bytes feed the JSON
accumulation of §5 directly. Only the legacy `#rpc#…#` traffic is
line-framed: sent with `\r\n`, received through a `\n` delimiter
parser.

## 10. Test vectors

The committed vectors in `test/vectors.json` frame these messages by
the rules in §2–§3. Vector bytes are written as hex. The vectors were
derived from this document, checked byte-for-byte against the vendor's
own framing function executed locally, and confirmed by an independent
cold re-derivation from the vendor bundle (see
[protocol-conformance.md](protocol-conformance.md)).

`terminated` vectors frame `message + "\n"` (the line direction, §3);
the bare vector frames the message text exactly (the host-to-device
RPC direction). The message payloads exercise framing only — the first
three carry a `jsonrpc` member that real traffic omits (§5), which the
framing layer neither knows nor cares about.

| Vector | Channel | Terminated | Message |
|---|---|---|---|
| `rpc-sub-frame` | 2 | yes | `{"jsonrpc":"2.0","id":1,"method":"device.status"}` — 49 chars, +`\n` = 50 bytes, one report |
| `rpc-exact-frame` | 2 | yes | `{"jsonrpc":"2.0","id":42,"method":"mmmmmmmmmmmmmmmmmmmmmmm"}` — 60 chars, +`\n` = 61 bytes, exactly one full report |
| `rpc-multi-frame` | 2 | yes | the 294-char `sendThreadsLighting` request in the vectors file, +`\n` = 295 bytes, five reports (61+61+61+61+51) |
| `debug-line` | 1 | yes | `boot ok` — +`\n` = 8 bytes, one report |
| `rpc-request-bare` | 2 | no | `{"method":"device.status","params":null,"id":1}` — 47 bytes, no terminator, one report; the true host-to-device shape |
