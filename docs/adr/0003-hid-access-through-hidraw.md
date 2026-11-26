# We reach the keypad through `/dev/hidraw`, with no native module

The physical keypad needs a HID access path. We open the Linux
`/dev/hidraw` node of the keypad with `node:fs`, and we find that node
through sysfs. We add no dependency. ADR-0001 names a `node-hid`
handle; this decision replaces that detail and keeps the seam.

## Considered options

`node-hid` is the usual choice. It works on Linux, macOS, and Windows,
and it finds a device by usage page on each of them. It is also a
native module. It would be the first one in this repository: it brings
prebuilt binaries or a compiler toolchain, an install script that pnpm
blocks until someone approves it, and a `libudev` requirement at run
time on Linux. It would also put a native handle behind the transport,
which a test cannot fake without the module installed.

Direct file I/O needs nothing. The kernel gives each HID interface a
character device. A `write` of 64 bytes sends one report, and a `read`
returns one report, each with the report id in byte 0. That is exactly
the report layout of `docs/protocol.md` §2. sysfs gives the vendor id,
the product id, and the raw report descriptor of each node to any
user, so discovery needs no native code either. The cost is plain: it
works on Linux only.

We chose direct file I/O. The one keypad we can test is on Linux, and
an access path that nobody can test on macOS or Windows is a guess. The
OS access sits behind a two-method interface (`HidBackend` in
`src/device/hidtransport.ts`), so a `node-hid` backend for other
systems can come later without a change to the transport.

## Consequences

- Hardware mode works on Linux only. `pnpm keypad` says so on another
  system.
- The node is `root`-only by default. `udev/70-glancepad.rules` gives
  the logged-in user access.
- Node has no readiness event for a character device. A blocking read
  holds a thread of the libuv pool, and the process then cannot exit;
  we saw `process.exit()` hang on that. The transport therefore opens
  the node with `O_NONBLOCK` and polls it every 10 ms. A key event
  arrives at most 10 ms late, and an idle process makes 100 cheap
  system calls each second.
- The kernel gives no unplug event to a plain file. The transport
  learns of an unplug from a failed read or write, and it looks for
  the keypad again one time each second.
- The tests use a fake backend, a temporary sysfs tree, and a FIFO.
  No test needs a keypad.
