# Device capture format

A file format for recording real device traffic, so one hardware
session can clear the unverified items in
[protocol-conformance.md](protocol-conformance.md). No capture exists
yet; no keypad has been attached.

## Format

One capture is one [JSON Lines](https://jsonlines.org/) file, extension
`.capture.jsonl`. The first line is a header object. Every other line is
one event object.

### Header line

```json
{"format":"glancepad-capture","version":1,"startedAt":"2026-08-09T12:00:00.000Z","transport":"hid","device":{"vendorId":12346,"productId":33632,"firmware":"unknown"},"note":"free text"}
```

- `transport` is `"hid"` or `"serial"`.
- `firmware` holds the `sys.version` reply when known.

### Event lines

```json
{"t":12.345,"dir":"out","report":"06023201227b226a736f6e727063223a22322e30222c…"}
{"t":12.401,"dir":"in","report":"06023a…"}
```

- `t` — seconds since `startedAt`, fractional.
- `dir` — `"out"` (host to device) or `"in"` (device to host).
- `report` — the complete raw report as lowercase hex, all 64 bytes,
  exactly as written to or read from the HID handle. For a serial
  capture, the raw bytes of one read or write instead; reports have no
  fixed size there.

Raw bytes are the ground truth, so the capture records nothing decoded.
A replay tool derives channels, lines, and JSON-RPC messages by running
`src/protocol/` over the events — which is exactly the comparison that
verifies the implementation.

## How a verification session uses it

1. Record a capture while the ChatGPT app drives the real keypad
   (out-reports may be absent then; an in-only capture still verifies
   decoding).
2. Run the capture through our decoder. Every in-report must decode, and
   every reassembled RPC line must parse as JSON-RPC 2.0.
3. Re-encode the decoded out-messages and compare bytes with the
   captured out-reports. Differences falsify our encoder — including the
   padding choice, conformance item 6.
4. Flip the verified items to `wire` in the conformance checklist, and
   commit the capture file next to it.
