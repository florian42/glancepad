# On macOS we reach the keypad through `node-hid`

ADR-0003 chose `/dev/hidraw` and deferred macOS. macOS has no device
file for a HID interface. The only access path is IOKit, and Node
cannot call IOKit without native code. On macOS we therefore use
`node-hid` 3.4.0, which contains hidapi 0.15.0. Linux keeps the
`/dev/hidraw` path of ADR-0003, and it never loads the native module.

**Update 2026-11-27:** this path ran on macOS 26.5 with the keypad
over Bluetooth LE (issue #17). Reads and writes work as the source
predicted. The permission prediction below was wrong for Bluetooth:
see "Permission". USB on macOS is not tested.
`research/macos-support.md` holds the evidence.

## Considered options

A helper process in Swift or C would keep native code out of the Node
process. It needs a compiler on the user's machine, a second build,
and a protocol between the two processes. That is more to build and
more to test without a Mac.

`node-usb` is also a native module. It works below the HID layer, and
on macOS the system HID driver holds the interface.

`node-hid` puts the prebuilt binaries for macOS (arm64 and x64) in its
npm package. It finds an interface by usage page, and its licence is
MIT or X11. Its cost is the cost that ADR-0003 names: it is the first
native module here, and it has an install script.

We chose `node-hid`, with these limits on its cost:

- pnpm does not run the install script (`node-hid: false` in
  `pnpm-workspace.yaml`). The script only checks the prebuilt binary,
  and compiles when none fits. The library finds the prebuilt binary
  itself when it loads. We saw this work on Linux.
- `src/device/nodehid.ts` does not import the library. It declares
  the four functions that it calls, and it receives the library as an
  argument. Only `src/ui/keypadbackend.ts` imports `node-hid`, with a
  lazy `import()` in the macOS branch.
- The tests give the backend a fake library. No test loads the native
  module, and no test needs macOS.

## What the source says about macOS

- **Report ids.** A write takes the report id in byte 0. For an id
  that is not 0, hidapi gives all bytes, the id included, to IOKit
  (`set_report` in `hidapi/mac/hid.c`). A read returns the report as
  IOKit delivers it, and `hidapi.h` says that byte 0 is the report
  number for a device with numbered reports. So both directions use
  the 64-byte layout of `docs/protocol.md` §2, the same as hidraw.
- **Reads.** hidapi collects input reports on its own thread.
  `readTimeout(0)` returns an empty array at once when none waits. The
  transport polls it every 10 ms, as it polls hidraw.
- **Sharing.** The library seizes a device by default on macOS. We
  open with `nonExclusive: true`, as the Linux path does not seize
  either.
- **Permission.** The Apple HID source asks for the Input Monitoring
  permission only for a keyboard, a mouse, or a trackpad service. We
  expected no permission, because the vendor interface (usage page
  `0xFF00`) is none of them. **That was wrong over Bluetooth.** There
  macOS shows one device with five usages, the keyboard usage among
  them, and the open fails with `0xE00002E2` (`not permitted`) until
  the terminal has Input Monitoring.

## Consequences

- Hardware mode works on Linux, and on macOS over Bluetooth. Windows has
  no access path. `node-hid` supports Windows, so the same backend can
  serve it later.
- `pnpm install` downloads `node-hid` on Linux also (5.5 MB). Linux
  does not load it.
- An unplug shows as a failed read or write, as on Linux. The
  transport then asks the library for the device list one time each
  second.
- macOS needs the Input Monitoring permission for the terminal that
  runs glancepad, at least over Bluetooth.
