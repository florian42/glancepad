# Codex Micro wire protocol — specification

This document specifies the wire protocol in our own words. It is the
source for the byte vectors in `test/vectors.json` and for the tests.
Sections 2 to 10 come from reading vendor code. Section 11 records what
a physical keypad sent on 2026-11-26. Where the two differ, the text
says so, and section 11 wins. The verification status of each constant
lives in [protocol-conformance.md](protocol-conformance.md).

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

- **Host to device**: the host sends an RPC message bare, with **no
  trailing newline**. The vendor host frames exactly the JSON text and
  nothing more. (In practice the text is also pure ASCII — see §5.)
- **Device to host**: each message is one line, terminated by `\n`. The
  host receiver delivers text only after a line terminator arrives, so
  this direction must terminate. We infer this from the host's receive
  code. We cannot read the firmware. A keypad ends each line with
  `\r\n` (§11).

Text whose encoded form is 61 bytes or fewer fits in one report. A
62-byte text produces two reports: 61 bytes, then 1 byte.

## 4. Reassembly

The receiver keeps one byte buffer **per channel**. For each report it
appends the payload bytes to that channel's buffer. It then splits the
buffer on the pattern `\r?\n`. It delivers every complete line, and it
keeps the bytes after the last line terminator in the buffer. Channels
never share a buffer, so debug and RPC traffic reassemble independently
and never interleave.

The receiver accepts `\r\n` as a terminator; the sender emits only
`\n`. The receiver decodes buffered bytes as UTF-8 only when it
delivers a complete line, so split multi-byte characters reassemble
correctly.

## 5. RPC layer

Traffic on the RPC channel (2) is **JSON-RPC-like**: single JSON
objects, but **without a `"jsonrpc": "2.0"` member**. Lines on the
debug channel (1) are free-form log text and are not parsed as JSON.

**Requests (host to device).** The wire shape is
`{"method": M, "params": P, "id": N}` in that member order. `params` is
always present — `null` when the call has no parameters. After JSON
serialization, the sender escapes every non-ASCII character as `\uXXXX`
(one escape per UTF-16 code unit), so the outgoing wire text is pure
ASCII.

**Receiving.** Message boundaries come from JSON completeness, above
the line split of §4. When nothing is pending, the receiver discards
text before the first `{` in a line, and it ignores a line without
`{`. It then accumulates lines until the collected text parses as
JSON. A receiver accepts the compact key aliases `m` (method), `p`
(params), and `i` (id). A message with a `method` and no id is a
notification; with both, a request; with an id and a `result` or
`error` member, a response. A response's `error` member, when present,
is an object with a number `code` and a string `message`.

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
as UTF-8 on arrival, fragment by fragment. A multi-byte character
split across two reports would corrupt there. Its ASCII escaping makes
that unreachable for its own traffic. Our receiver buffers raw bytes
per channel and decodes complete lines, which handles both ASCII and
raw UTF-8 correctly — a strict superset.

The vendor type definitions name the key event payload `{key, act}`
and the joystick payload `{angle, distance}`. **A keypad sends other
names** (§11): `{k, act}` for a key event and `{a, d}` for the
joystick, in a message with the compact members `m` and `p`. `act` is
`0` = release, `1` = press, `2` = tick. The joystick values are polar,
both normalized 0–1.

## 6. Key identifiers

| Group | Identifiers |
|---|---|
| Agent keys | `AG00` … `AG05` |
| Command keys | `ACT06` … `ACT12`, plus the merged id `ACT10_ACT11` |
| Encoder rotation | `ENC_CW`, `ENC_CC`, always with `act === 2` |
| Encoder press | key id starts with `ENC`; `act` `1` = press, `0` = release. A keypad sends `ENC_CLK` (§11) |

A keypad never sent the merged id `ACT10_ACT11`. The microphone key
sends `ACT10` and `ACT11` as a pair (§11). The merged id is a host
concept.

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

### Lighting calls

Two request methods carry all lighting
([protocol-conformance.md](protocol-conformance.md) items 45–48):

- **`v.oai.thstatus`** — per-agent-key lighting. The params member is a
  bare array of entries `{id, c, b, e, s, sk, sa}`: slot id, packed RGB
  color, brightness, effect, speed, and the two sync flags as `0` or
  `1`. Only `id` is required. The vendor API documentation states that
  an omitted member leaves that aspect unchanged on the device; the
  firmware itself is unread (item 46).
- **`v.oai.rgbcfg`** — the two zones. The params member is
  `{ambient, keys}`, each zone `{e, b, s, m, c}`: effect, brightness,
  speed, magic, packed RGB color. The vendor host always sends `m: 0`;
  its meaning is unknown.

No vendor code shows what the firmware answers. A keypad answers
`{"result":{"ok":1},"id":N,"method":M}` (§11). Our simulator still
answers `{result: true, id}` on success and
`{error: {code, message}, id}` on failure. That shape was a choice made
before the keypad arrived (conformance item 51).

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
the rules in §2–§3. Vector bytes are written as hex. The vectors
derive from this document. We executed the vendor's own framing
function locally, and its output matched them byte for byte. An
independent cold re-derivation from the vendor bundle also agrees —
see [cold-derivation-2026-08-09.md](cold-derivation-2026-08-09.md)
and [protocol-conformance.md](protocol-conformance.md).

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

## 11. Observed on a keypad

One keypad, on Linux, on 2026-11-26. The firmware version is unread.
`scripts/keypad-probe.ts` repeats each observation. "Seen" below means
the line arrived on the wire. A statement about light needs a person,
and says so.

**USB identity.** Vendor id `0x303A`, product id `0x8360`, product
string "Codex Micro", manufacturer string "Work Louder". The keypad has
three HID interfaces. Interface 0 is a boot keyboard (usage page
`0x01`). Interface 1 is a consumer control (usage page `0x0C`).
Interface 2 carries this protocol: usage page `0xFF00`, report id `6`,
63 data bytes in each direction. With the id byte, a report is the 64
bytes of §2. The `hidraw` node number of interface 2 changes between
plug-ins.

**Enumeration can fail.** On one plug-in the kernel logged
`can't add hid device: -110` for interfaces 1 and 2, and a USB
disconnect. The keypad returned by itself about 40 seconds later with
all three interfaces. On other plug-ins, the interfaces bound in less
than one second.

**Replies.** The keypad answers each lighting request with one line:

    {"result":{"ok":1},"id":100,"method":"v.oai.thstatus"}

The reply repeats the request id and the method. It arrived 6 to 10 ms
after the last report of the request. The keypad answered `ok` to each
well-formed request we sent, also to `params: null`, to `params: {}`,
to slot ids `6` and `17`, and to an effect value of `99`. The reply
therefore does not tell the number of slots or of LEDs, and it does
not confirm that a value was applied.

**Notifications.** Seen, with the compact members `m` and `p`:

    {"m":"v.oai.hid","p":{"k":"AG00","act":1}}
    {"m":"v.oai.hid","p":{"k":"AG00","act":0}}
    {"m":"v.oai.hid","p":{"k":"ENC_CW","act":2}}
    {"m":"v.oai.hid","p":{"k":"ENC_CLK","act":1}}
    {"m":"v.oai.rad","p":{"a":0.161292,"d":0.02128}}

- Key ids seen: `AG00`–`AG05`, `ACT06`–`ACT12`, `ENC_CW`, `ENC_CC`,
  `ENC_CLK`.
- The microphone key sent `ACT10` and `ACT11`. The two press lines had
  one timestamp. The two release lines were 10 ms apart.
- One encoder detent sent one tick line. Five detents arrived 20 to
  30 ms apart.
- The joystick sends `v.oai.rad` at rest, about 3 lines each second on
  average and in bursts, with `d` between 0.02 and 0.07. A receiver must treat a small `d` as
  rest.
- Each line ends with `\r\n`. Each line seen fit in one report.
- No line arrived on the debug channel (1).

**A message that stays incomplete.** The keypad joins fragments until
the text is a complete JSON value. A pause of 3 seconds between two
reports of one message did no harm. When a message stays incomplete,
the keypad does one of two things:

- After 5.0 seconds with no further report, it drops the part and
  sends
  `{"error":{"code":400,"message":"JSON error - IncompleteInput"},"id":null,"method":"v.oai.thstatus"}`.
  The next message then works.
- When more reports arrive earlier, they join the part. The keypad
  sent no reply to the next complete message. On the first report of
  the message after that, it sent 12 error lines (`JSON error -
  InvalidInput`, `Missing method`, each with `"id":null`), and both
  messages were lost. The message after the errors worked.

An error reply carries `"id":null`, so a receiver cannot match it to a
request by id. The host's resync rule follows from this: after a send
that fails mid-message, it sends nothing for 5.5 seconds, and then it
sends both lighting calls in full (`src/device/host.ts`, and
`src/device/tee.ts` in hardware mode).

**Unplug and replug.** A read on the node failed with `EIO` when the
keypad left. Ten seconds later the transport opened the keypad again,
the host sent both lighting calls, and the keypad answered `ok` to
each. A person saw the scene return. What the keypad shows after a
replug with no host is uncertain: in an earlier run a person reported
the scene after a replug, and our log shows no host connection at that
time. The host therefore sends its lighting on each connection and
assumes nothing.

**Light, confirmed by a person.** With six `v.oai.thstatus` entries,
the agent keys `AG00` to `AG04` showed solid red, orange, green, blue,
and white, and `AG05` pulsed magenta (effect 4, speed 0.4). With
`v.oai.rgbcfg` and effect 2 (snake) on `ambient`, a blue segment moved
around the ring. One breath at speed 0.4 took 2 seconds or more; no
one measured it with a clock. The first answer of the same person to
the same scene was "wrong or missing colors", with no detail, and the
second was "all correct". The cause of the first answer is unknown.

**Still unread.** The LED count, the exact breath period, the shape
and length of the snake segment, the meaning of `m`, and what the
keypad does with a request id of 999 or more. No lighting request
reads a value back.
