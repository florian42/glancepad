# The transport seam sits below the HID framing

We must develop without a Codex Micro, so a fake transport stands in for
the device. We put that seam **below** the framing: the transport deals in
already-framed 64-byte reports, not in JSON-RPC strings. Our real framing,
fragmentation, and reassembly code therefore runs in simulator mode and in
hardware mode alike, and only the device handle differs. (ADR-0003
later chose `/dev/hidraw` file I/O for that handle, not `node-hid`.)

## Considered options

A seam at the JSON-RPC level is simpler and shows a lit key sooner. It
also leaves the framing code — the 61-byte payload cap, the multi-frame
reassembly on `\n`, the per-channel buffers — completely untested until
hardware arrives. That is the code most likely to be wrong and least
likely to be noticed wrong, so we accepted the slower start.

## Consequences

The framing must exist before the simulator shows anything, which delays
the first visible LED by about a day. In exchange, a hardware-free test
run exercises the real byte path. What the seam still cannot prove:
device discovery, the OS transport, transport handoff, reconnect timing,
and whether the firmware renders an effect the way we imagine it.
