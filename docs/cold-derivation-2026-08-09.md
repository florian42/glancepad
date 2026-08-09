# Cold re-derivation record — 2026-08-09

This document preserves the independent derivation that issue #1
required. A second agent started with a fresh context. It received the
vendor bundle location and four message strings, and nothing else. It
did not see our implementation, our specification, or our research
notes. It derived the framing algorithm from the bundle and wrote these
byte vectors from that derivation. We then compared the two
derivations.

## Outcome

The two derivations agree on the complete framing algorithm and on
every constant: the 64-byte report, report id `6`, the channel byte,
the length byte, payload at byte 3, zero padding, the 61-byte fragment
limit, the absence of sequence headers, the `\r?\n` receive split with
per-channel buffers, the `{method, params, id}` request shape without a
`jsonrpc` member, the `[0, 999)` id range, the 10 000 ms timeout, the
50 ms send cooldown, the `\uXXXX` escaping, and the bare host-to-device
send. The derivation also confirmed two asymmetries independently: the
host appends no terminator, and only the receive path proves the
device-to-host `\n`.

## The vectors it wrote

The agent framed the given strings exactly as the vendor sender does:
bare, with no terminator. Our committed vectors in `test/vectors.json`
frame the same strings as terminated lines, and add one bare vector.
The algorithms are identical; the two sets differ only by that input
choice. Each line below is one full 64-byte report in hex.

**Message A** — `{"jsonrpc":"2.0","id":1,"method":"device.status"}`:

```
0602317b226a736f6e727063223a22322e30222c226964223a312c226d6574686f64223a226465766963652e737461747573227d000000000000000000000000
```

**Message B** — `{"jsonrpc":"2.0","id":42,"method":"mmmmmmmmmmmmmmmmmmmmmmm"}`:

```
06023c7b226a736f6e727063223a22322e30222c226964223a34322c226d6574686f64223a226d6d6d6d6d6d6d6d6d6d6d6d6d6d6d6d6d6d6d6d6d6d6d227d00
```

**Message C** — the 294-char `sendThreadsLighting` request from
`test/vectors.json`, five reports:

```
06023d7b226a736f6e727063223a22322e30222c226964223a372c226d6574686f64223a2273656e64546872656164734c69676874696e67222c22706172616d
06023d73223a7b2274687265616473223a5b7b22636f6c6f72223a333136363230362c226272696768746e657373223a312c22656666656374223a312c227370
06023d656564223a302c2273796e634b6579734c69676874696e67223a66616c73652c2273796e63416d6269656e744c69676874696e67223a66616c73657d2c
06023d7b22636f6c6f72223a36353335362c226272696768746e657373223a302e352c22656666656374223a342c227370656564223a302e342c2273796e634b
0602326579734c69676874696e67223a66616c73652c2273796e63416d6269656e744c69676874696e67223a66616c73657d5d7d7d0000000000000000000000
```

**Message D** — the debug line `boot ok`, with the `\n` the agent
inferred from the receive path. This report equals our `debug-line`
vector byte for byte:

```
060108626f6f74206f6b0a0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
```

## Limits the agent stated

- The vendor client sends `{method, params, id}`, so the given A–C
  strings are not what the real app serializes. The agent framed them
  verbatim, as instructed.
- No code path in the app writes on the debug channel. The `\n` in
  message D comes from the receive code, not from a writer.
- The bundle does not show how the firmware finds the end of a bare
  host message. That is firmware behavior, and no one has read it.

These limits match items 9, 10, and the "Known limits" section of
[protocol-conformance.md](protocol-conformance.md).
