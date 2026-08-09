# Device capture format

A file format for recording real device traffic, so one hardware
session can clear the unverified items in
[protocol-conformance.md](protocol-conformance.md). No capture exists
yet, because no keypad is attached to this machine.

## Format

One capture is one [JSON Lines](https://jsonlines.org/) file, extension
`.capture.jsonl`. The first line is a header object. Every other line
is one event object.

### Header line

```json
{"format":"glancepad-capture","version":1,"startedAt":"2026-08-09T12:00:00.000Z","transport":"hid","device":{"vendorId":12346,"productId":33632,"firmware":"unknown"},"note":"free text"}
```

- `transport` is `"hid"` or `"serial"`.
- `vendorId` and `productId` identify the Codex Micro: `12346` =
  `0x303A`, `33632` = `0x8360`. Source:
  `research/virtual-device-options.md` §4, "USB identity".
- `firmware` holds the `sys.version` reply when known.

### Event lines

```json
{"t":12.345,"dir":"out","report":"06022f7b226d6574686f64223a226465766963652e737461747573222c…"}
{"t":12.401,"dir":"in","report":"06023a…"}
```

- `t` — seconds since `startedAt`, fractional.
- `dir` — `"out"` (host to device) or `"in"` (device to host).
- `report` — the complete raw report as lowercase hex, all 64 bytes,
  exactly as written to or read from the HID handle. For a serial
  capture, record the raw bytes of one read or write instead; serial
  data has no fixed report size.

The capture records raw bytes only, because raw bytes are the ground
truth. A replay tool derives channels, messages, and their boundaries
when it runs `src/protocol/` over the events. That replay is exactly
the comparison that verifies the implementation.

## How a verification session uses it

1. Record a capture while the ChatGPT app drives the real keypad. A
   capture without out-reports still verifies decoding.
2. Run the in-reports through our decoder. The decoder must accept
   every in-report ([protocol.md](protocol.md) §2). The line split
   must yield the debug lines (§4). The JSON accumulation must
   complete each RPC message, and each message must parse (§5). Real
   traffic carries no `jsonrpc` member.
3. Re-encode the decoded out-messages with `encodeFrames` and compare
   the bytes with the captured out-reports. Remember the asymmetry
   (§3): out-messages are bare, with no trailing newline. A difference
   falsifies our encoder, including the zero padding, conformance
   item 6.
4. Flip the verified items to `wire` in the conformance checklist, and
   commit the capture file next to it.
