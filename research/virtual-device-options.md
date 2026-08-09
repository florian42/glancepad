# Developing without a Codex Micro — simulator and virtual-device options

*Researched 2026-08-09. Primary sources: the `app.asar` of the installed
ChatGPT desktop app (`OpenAI.Codex` v26.803.5235.0, Microsoft Store
package), the bundled `@worklouder/device-kit-oai` and
`@worklouder/wl-device-kit`, the public npm registry, the QMK firmware
repository, Microsoft driver documentation, and the Linux kernel HID
documentation.*

*Companion to [codex-micro-state-machines.md](codex-micro-state-machines.md),
[codex-micro-agent-key-assignment.md](codex-micro-agent-key-assignment.md),
and the type definitions in `research/reference/` (local only, not in
git).*

---

## Verdict

**No vendor simulator exists.** Work Louder ships no simulator, no mock
device, and no fake transport in either `@worklouder/device-kit-oai` or
`@worklouder/wl-device-kit`. I read the complete file list of both
packages out of the ChatGPT `app.asar`; neither contains a file that
matches `mock`, `fake`, `simulat`, `virtual`, `emulat`, or `stub`. The
ChatGPT desktop app ships no simulator either, and no debug flag, feature
flag, or environment variable that fakes a connected keypad. **We must
build our own.** The good news is that the cheap path is very cheap. The
transport interface `WLDeviceComm` has only 10 methods, and OpenAI's own
`CodexMicroService` accepts injected `findDevices`, `createComm`, and
`createApi` functions — a seam built for exactly this. A human-operable
GUI simulator that plugs in at that seam needs no drivers, no signing, and
no USB. I also recovered the complete wire protocol (USB VID/PID, the
64-byte HID frame layout, and the status colors), so an OS-level virtual
device stays possible later if we ever need it.

---

## 1. Vendor simulator or mock in the device kit

**Verified — no mock ships.** I parsed the `app.asar` header (5752 files),
then listed every path under `node_modules/@worklouder/`. That is 835
files. The mock-shaped files are these, and every one is a transitive
dependency of `serialport`, not Work Louder code:

| Path | What it is |
|---|---|
| `device-kit-oai/node_modules/@serialport/binding-mock/` | The `serialport` project's own in-memory binding |
| `device-kit-oai/node_modules/serialport/dist/serialport-mock.js` | `SerialPortMock`, shipped by `serialport` itself |
| `device-kit-oai/node_modules/esptool-js/lib/stubFlasher.js` | ESP32 flash stub, unrelated to simulation |

`wl-device-kit`'s own `dist/` tree holds 57 files. None of them is a fake
transport. Its README documents a "Testing" section with two lines only —
`yarn wasm-build` and `yarn test` (Vitest). The README never mentions a
simulator, a mock device, or a dev mode.

`@serialport/binding-mock` is real and usable, but it does not help much
here. The Codex Micro connects over HID, not serial (see §4), and
`WLDeviceCommImpl` calls `node-hid` directly. It exposes no hook to swap
the binding.

### The seam that does exist: `WLDeviceComm`

The vendor's transport is an injectable interface of ten methods. They
cover four concerns only: connection events, notify-handler registration
and removal, connect and disconnect with a liveness check, and request
sending with an abort and a queue reset. Two of the ten exist for a
legacy RPC path we do not need.

The RPC class takes that transport as a constructor argument, and it
offers a second entry point that reuses an existing RPC client. A fake
transport therefore drops in without patching anything.

**We do not copy that interface.** Ours needs four members, because we
own both sides and we carry no legacy path:

```ts
interface DeviceTransport {
  send(report: Uint8Array): Promise<void>;   // exactly one 64-byte report
  onReport(cb: (report: Uint8Array) => void): () => void;
  close(): Promise<void>;
  readonly connected: boolean;
}
```

### OpenAI already uses that seam

**Verified.** The app's own device service (`service-CJETEjOt.js`, class
`CodexMicroService`) takes every hardware dependency from an options
object, and each one falls back to a real default. Six dependencies are
injectable this way:

| Injected dependency | Default |
|---|---|
| Device discovery | the real discovery function |
| HID topology watching | the native watcher |
| Transport creation | a real HID transport |
| RPC client creation | the real RPC class |
| Timer scheduling | `setTimeout` |
| Timer cancellation | `clearTimeout` |

The timers are injectable too, which lets a test drive the clock instead
of waiting for it. This is strong evidence that OpenAI runs the service
against fakes internally. Those fakes do not ship in the app bundle.
I infer they live in the closed Codex source tree.

---

## 2. Are the packages public?

**Verified — both packages are absent from the public npm registry.**

| Check | Result |
|---|---|
| `https://registry.npmjs.org/@worklouder%2Fdevice-kit-oai` | HTTP 404 |
| `https://registry.npmjs.org/@worklouder%2Fwl-device-kit` | HTTP 404 |
| `@worklouder` scope on npmjs.com | Search page returns HTTP 403 to automated fetches; no package under the scope appeared in any search result |

The `wl-device-kit` README states the distribution channel directly:

> This is a private package hosted on
> [GitHub Packages](https://github.com/worklouder/wl-device-kit/packages).
> Authenticate with a GitHub personal access token that has `read:packages`
> scope.

Its header carries an explicit proprietary notice:

> Copyright (C) 2023 Work Louder Inc. - All Rights Reserved.
> Unauthorized copying of this file, via any medium is strictly prohibited.
> Proprietary and confidential.

**License: proprietary, all rights reserved.** We cannot depend on these
packages, and we must not vendor them. Our implementation must speak the
protocol directly.

The [`worklouder` GitHub organization](https://github.com/orgs/worklouder/repositories)
publishes 9 public repositories. Every one is a firmware **release**
repository (binaries only) or an app release repository:

| Repository | Contents |
|---|---|
| `cm-v2-fw-releases` | Creator Micro V2 firmware releases |
| `knob-fw-releases`, `nomad-e-fw-releases`, `nomad-e-v2-fw-releases`, `xyz-wb-r2-fw-releases` | Other firmware releases |
| `input-releases`, `input-releases-internal` | The "Input" desktop app |
| `input-linux` | Community port of Input to Linux (JavaScript) |
| `node-hid` | A fork of the well-known `node-hid` library |

No firmware **source** is public. `wl-device-kit` itself is private, and
`https://github.com/worklouder/wl-device-kit` is not in the public list.

`input-linux` is a community port of the Input app and is worth a later
look. It may reveal protocol details independently. I did not read it.

---

## 3. ChatGPT desktop app — simulation or debug mode

**Verified — no simulator, no mock mode, and no debug flag for the device.**

I extracted the main-process bundles (`main-*.js` 2.5 MB, `src-Cz*.js`
1.4 MB, `window-all-closed-*.js` 4.3 MB, `core-*.js`, `service-*.js`) and
searched them. The patterns and the results:

| Pattern searched | Result |
|---|---|
| `mockDevice`, `fakeDevice`, `virtualDevice`, `simulatedDevice`, `deviceSimulator`, `simulateDevice`, `useMockDevice` | No match |
| `codexMicro*(debug\|dev\|mock\|fake\|sim\|test\|preview\|override)` and the reverse order | No match |
| `simulat`, `emulat` | Matches only in unrelated code: Chrome DevTools `Emulation.*` commands for the in-app browser, POSIX signal descriptions, and a `simulate-usage-limit-approaching-for-debug` command that concerns billing, not the keypad |
| `CODEX_MICRO_*` | Only user settings keys, listed below |
| Filenames matching `mock\|fake\|simulat\|stub\|virtual\|emulat\|dummy` across all 5752 archive entries | Only the `serialport` and `esptool-js` files from §1 |

The `CODEX_MICRO_*` constants are ordinary settings keys:
`codex-micro-agent-source`, `codex-micro-layout`,
`codex-micro-single-tap-agent-keys`, `codex-micro-lighting-brightness`,
and `codex-micro-lighting-auto-off`. None of them fakes a device.

### The app does draw an on-screen keypad — but it is a mirror, not a simulator

The renderer chunk `codex-micro-keyboard-surface-BKJyhHt6.js` (30 KB)
renders an on-screen picture of the keypad in Settings. It draws each
keycap with a `backgroundColor` derived from the slot status, and it
accepts an `isPressed` prop that highlights the key you physically press.

It is **not** a simulator, for two reasons:

1. The click handler assigns work to a key. Its accessible label reads
   "Assign a chat, shortcut, keycap, or skill to agent key {position}".
   Clicking never emits a `v.oai.hid` event.
2. The colors come from the app's own status model, not from the device.
   The surface would show the same picture with no keypad attached.

That said, it is a useful **visual reference** for our own simulator. It
proves the intended appearance, and the shipped CSS gives us a working
software rendering of the snake effect (see §6).

### The onboarding animation is a demo script, not a visual ground truth

`codex-micro-onboarding-animation-FJvdRbJJ.js` holds the 12-second demo
cycle referenced in [state-machines §10](codex-micro-state-machines.md).
The literal constants, **verified**:

| Constant | Value | Meaning |
|---|---|---|
| Cycle length | 12 000 ms | Full loop |
| Tick | 100 ms | `setInterval` period |
| Slot stagger | 800 ms | Offset per agent key |
| Keycap stagger | 700 ms | Offset per command keycap |
| Phase boundaries | 3480, 7440, 11 520 ms | Midpoints of `[.25,.33]`, `[.58,.66]`, `[.92,1]` × 12 000 |

Each of the six slots walks a fixed three-status list:

| Slot | Status sequence | Keycap sequence |
|---|---|---|
| AG00 | `working → awaiting-approval → error` | FAST, PLAY, BUG |
| AG01 | `unread → working → idle` | APPR, SPLIT, SETUP |
| AG02 | `awaiting-approval → idle → working` | REJ, NEW, CODEX |
| AG03 | `idle → error → unread` | SPLIT, BUG, FAST |
| AG04 | `working → unread → awaiting-response` | MIC, NEW, PLAY |
| AG05 | `awaiting-response → working → idle` | CODEX, APPR, SETUP |

This gives us a **ready-made demo script** for a simulator. It does not
give us colors or effects on its own — it emits statuses, which then flow
through the same status-to-lighting pipeline as real work. The colors and
effects come from the code in §4 and §6 instead, and those are exact.

---

## 4. Wire protocol facts recovered

This section answers the project's standing open question about the
discovery filter. The earlier search failed because the constant is not
named `vendorId`. It is named `WL_VID`.

### USB identity — verified

| Fact | Value | Source |
|---|---|---|
| Vendor ID (all Work Louder devices) | `12346` = **`0x303A`** (Espressif) | `wl_const.d.ts`, `wl-device-kit/dist/index.js` |
| Codex Micro Product ID | `33632` = **`0x8360`** | `DEVICE_REGISTRY`, and `service-CJETEjOt.js` |
| Creator Micro V2 Product IDs | `33431` = `0x8297`, `33432` = `0x8298` | same |
| HID usage page filter | `65280` = **`0xFF00`** (vendor-defined) | `filterWLDevices`, and `service-*.js` |
| Manufacturer strings | `"Work Louder"`, `"Work_Louder"` | `WL_MANUFACTURER` |
| USB-versus-Bluetooth test | `(bcdDevice & 3) === 0` means wired USB | `filterWLDevices` |

The full `DEVICE_REGISTRY` also lists Nomad E (`4097`, `33428`, `33429`),
Nomad E V2 (`33648`, `33649`), Knob (`33430`, `33507`), Knob F1 (`33686`,
`33687`), and XYZ (`33606`).

The ChatGPT app does **not** call `WLDeviceDiscovery.findWLDevices()`. It
runs its own discovery, which accepts only the three PIDs above:

- On Linux it calls `node-hid`'s `devicesAsync(0x303A, pid)` per PID.
- On Windows and macOS it calls `findCodexMicroInterfaces()` in a native
  addon, `hid-topology-watcher.node`, that ships inside the app.
- Both paths then filter on `usagePage === 0xFF00` and sort wired devices
  first.

### HID frame layout — verified

`WLDeviceCommImpl.sendDataHID` writes fixed **64-byte** reports:

| Byte | Value |
|---|---|
| 0 | `6` — report ID |
| 1 | channel: `1` = debug, `2` = RPC |
| 2 | payload length in this frame, at most **61** |
| 3 … 3+len | UTF-8 payload fragment |

Incoming reports use the same layout (`parseHIDReport` reads byte 1 as the
channel and byte 2 as the length). The receiver appends fragments per
channel, splits on `\r?\n`, and parses each complete line as JSON-RPC 2.0.

Over serial the transport is plain text at **115200 baud**, framed by a
`DelimiterParser` on `\n`.

Other protocol constants, verified:

| Constant | Value |
|---|---|
| RPC request timeout | 10 000 ms |
| JSON-RPC call id range | `[0, 999)` — the firmware rejects larger ids |
| Maximum base64 chars per `fs.*` chunk | 4096 |
| Notification channels | `v.oai.hid` (keys), `v.oai.rad` (joystick) |
| Error codes | `ALREADY_CONNECTED`, `TIMEOUT`, `WRITE_FAILED`, `DEVICE_DISCONNECTED` |

### Status colors — verified, and cross-checked twice

The app maps a slot status to a packed RGB integer in `src-Cz_uUmVl.js`.
The device service calls the same function for both the per-slot lighting
and the ambient ring:

| Status | Decimal | Hex | Colour |
|---|---|---|---|
| `working` | 3166206 | `0x304FFE` | blue |
| `unread` | 65356 | `0x00FF4C` | green |
| `idle` | 16777215 | `0xFFFFFF` | white |
| `awaiting-approval` | 16739584 | `0xFF6D00` | amber |
| `awaiting-response` | 16739584 | `0xFF6D00` | amber |
| `error` | 16711731 | `0xFF0033` | red |
| `off` | 0 | `0x000000` | off |

Cross-check: the shipped stylesheet `codex-micro-bridge-D8kdrccf.css`
hard-codes `#304ffe` for the composer highlight and `#00ff4c` for the
selected state. Those match `working` and `unread` exactly.

Voice-state colors, from the same service:

| Voice state | Effect | Color |
|---|---|---|
| `idle` | no override | — |
| `recording` | snake, speed 0.4 | `3050327` = `0x2E8B57` (sea green) |
| `processing` | snake, speed 0.4 | `16777215` = `0xFFFFFF` |
| `completed` | solid | `16777215` = `0xFFFFFF` |

### Key identifiers — verified

| Group | Identifiers |
|---|---|
| Agent keys | `AG00` … `AG05`, matched by `/^AG0([0-5])$/` |
| Command keys | `ACT06` … `ACT12`, plus the merged slot id `ACT10_ACT11` |
| Encoder rotation | `ENC_CW`, `ENC_CC`, always with `act === 2` (a tick) |
| Encoder press | key starts with `ENC`, `act === 1` press, `act === 0` release |
| Keycap identities | `FAST APPR REJ SPLIT MIC MIC1 CODEX BUG OAI TERM DWN DEL NEW NAV MAGIC DIFF PLAY GIT BRCH BRANCH MRG PR PAINT LAB PARTY TIME MIND+ MIND- EMPT1…EMPT5 SETUP FOLD UPL APPS YOLO YEET` |

`act` therefore carries three values: `0` = release, `1` = press, `2` =
tick. The joystick arrives separately on `v.oai.rad` as `{angle,
distance}`, polar and normalized 0–1.

---

## 5. QMK and VIA — a dead end for this generation

**Verified — the Codex Micro is not a QMK device.**

The QMK repository does hold Work Louder boards, under
[`keyboards/work_louder/`](https://github.com/qmk/qmk_firmware/tree/master/keyboards/work_louder):
`loop`, `micro`, `nano`, `numpad`, and `work_board`. But
[`work_louder/micro/keyboard.json`](https://github.com/qmk/qmk_firmware/blob/master/keyboards/work_louder/micro/keyboard.json)
describes the **first-generation** Creator Micro:

| Field | Value |
|---|---|
| Vendor ID | `0x574C` ("WL") |
| Product ID | `0xE6E3` |
| Processor | `atmega32u4` |
| Bootloader | `atmel-dfu` |

That vendor ID is not `0x303A`, and that processor is not an ESP32. The
current generation is ESP32-based: the vendor ID is Espressif's, the
device kit flashes firmware with `esptool-js`, and the bootloader appears
as a serial port with an Espressif manufacturer string. No `codex_micro`
or `creator_micro_v2` directory exists in QMK.

Consequences:

- **A QMK build cannot emulate this device.** The firmware is not QMK, and
  the protocol is not QMK `raw_hid`. It is a Work Louder JSON-RPC layer
  over a vendor HID interface with the 3-byte header in §4.
- The VIA angle does not apply either. Work Louder configures the current
  devices through their own "Input" app, not through VIA.
- Work Louder publishes no SDK and no developer documentation. Their
  public repositories carry release binaries only (§2).

*Uncertain:* I did not check the VIA keyboard repository directly. Given
that the QMK repository has no entry for these boards and the boards are
ESP32, I judge a VIA entry very unlikely, but I did not verify it.

---

## 6. Building a human-usable simulator

The requirement is an on-screen device, like the Android emulator or the
iOS Simulator. A human must see the LEDs and click the keys. Two shapes
can deliver that. They differ in cost by roughly two orders of magnitude.

### Option A — GUI simulator at the library level

Write our own `WLDeviceComm` (10 methods, §1), and pair it with a window
that draws the keypad. The fake transport does three things:

1. It answers `sendJsonRpcRequest` for `sendLightingConfig`,
   `sendThreadsLighting`, `device.status`, and `sys.version`. It parses
   the JSON we send and updates the on-screen LED model.
2. It calls the registered `v.oai.hid` and `v.oai.rad` notify handlers
   when the human clicks a key or drags the joystick.
3. It emits `ConnectionEvent`s on demand, so we can test connect,
   disconnect, and error paths by clicking a button.

The window can be a local web page (a WebSocket or an Electron renderer),
a TUI, or a native window. A web page is the natural choice, because the
LED effects are animations and CSS renders them well.

**Cost:** days, not weeks. No driver, no signing, no USB, no admin rights.
It runs on every developer machine and in CI.

**What it can never verify:**

- The real 64-byte HID framing and the 61-byte fragmentation, including
  the multi-frame reassembly of long lighting payloads.
- Real discovery: the `0x303A` / `0x8360` / usage-page `0xFF00` filter,
  and the native HID topology watcher.
- The connection and reconnection machine against real hardware —
  `WLDeviceError` timing, `WRITE_FAILED` versus `DEVICE_DISCONNECTED`,
  and the reconnect backoff `[1 s, 2 s, 5 s, 10 s]`.
- USB-to-Bluetooth transport handoff, and the topology settle retries
  `[250 ms, 1 s, 3 s]`.
- Firmware timing: how fast the device really accepts lighting writes,
  and whether our diffing keeps it calm.
- Whether the firmware renders an effect the way we imagine it (see the
  fidelity section below).

We can narrow the first gap cheaply. Make the fake transport accept the
**already-framed 64-byte reports** instead of the JSON string. Then our
own comm layer runs its real framing code, and only the `node-hid` call
is replaced. That covers framing and reassembly, and leaves only
discovery, the OS transport, and the physical device untested.

### Option B — OS-level virtual HID or serial device

A virtual device looks like real hardware to any host, including the
ChatGPT app itself. The cost on Windows is high.

| Path | Status | Cost |
|---|---|---|
| `vhidmini2` from [microsoft/Windows-driver-samples](https://github.com/microsoft/Windows-driver-samples/tree/main/hid/vhidmini2) | A UMDF 2 HID minidriver sample. It is the documented way to create a virtual HID device on Windows. | Build with the WDK; write a HID report descriptor; then sign and install a driver package |
| Windows driver signing | [Microsoft's driver-signing documentation](https://learn.microsoft.com/en-us/windows-hardware/drivers/install/driver-signing) states that from Windows 10 and Server 2016, the Hardware Dev Center must sign kernel-mode drivers, and the process needs an **EV certificate**. | An EV certificate costs money and needs organization validation |
| Test signing as a workaround | `bcdedit /set testsigning on` fails while Secure Boot is on. Community reports on com0com show the error "The value is protected by Secure Boot policy and cannot be modified or deleted". | Disabling Secure Boot on a developer machine is a real cost |
| [com0com](https://sourceforge.net/projects/com0com/) virtual serial ports | The 2017 "signed" build uses an old SHA-1 certificate that Windows 11 rejects with Code 52. Later signed builds claim to install cleanly; I did not test any of them. | Only helps the serial transport, which the Codex Micro does not use for normal operation |
| [ViGEmBus](https://github.com/nefarius/vigembus) and [HidHide](https://github.com/nefarius/HidHide) | Both are production-signed and open source. ViGEmBus emulates **game controllers** (XUSB and DS4), not arbitrary vendor HID. HidHide **hides** devices; it does not create them. | Neither fits a vendor-defined `0xFF00` device |
| **Linux `/dev/uhid`** | [The kernel documents](https://docs.kernel.org/hid/uhid.html) a character device that lets a user-space program register a virtual HID device with a **custom report descriptor** — `UHID_CREATE2`, `UHID_INPUT2`, `UHID_OUTPUT`. **No custom kernel driver, and no signing.** | A Linux VM or WSL-with-a-real-kernel; a few hundred lines of user-space code |

The Linux `uhid` path is by far the cheapest OS-level option. It also
matches the app's own Linux discovery path, which uses plain `node-hid`
`devicesAsync(vid, pid)` on hidraw. On Windows there is no equivalent
unsigned, user-space route.

### Which one gives a human a working loop soonest

**Option A, by a wide margin.** A developer can be clicking AG02 and
watching it breathe within a day or two. Option B needs an EV certificate
or a disabled Secure Boot before anybody sees a single LED.

I recommend Option A now, and Option B later and only on Linux, as an
end-to-end conformance rig.

---

## Rendering the LED state faithfully

The effects are **firmware animations**. The device kit sends parameters,
not frames. A simulator must reproduce the animation in software.

### What is specified

The effect enum has seven values. The vendor's own comments describe each
one in a single sentence; this table paraphrases them:

| Value | Effect | Behavior |
|---|---|---|
| 0 | `off` | The LEDs are off |
| 1 | `solid` | One static color |
| 2 | `snake` | One lit band moves around the zone, and the rest stays dark |
| 3 | `rainbow` | The hue cycles continuously |
| 4 | `breath` | The brightness fades in and out |
| 5 | `gradient` | The color changes smoothly from one end of the zone to the other |
| 6 | `shallowBreath` | The same fade, but the floor is 0.5 rather than 0 |

`brightness` and `speed` are normalized 0–1. `color` is a packed RGB
integer. Two zones exist: `ambient` (the outer ring) and `keys` (the
backlight), each an `OAILightingSide`. Per-slot lighting is a separate
`ThreadLighting[]` array.

**The good news: the OpenAI integration uses only four of the seven
effects.** I read the two functions in `service-CJETEjOt.js` that build
every payload the device ever receives. The complete rules, verified:

Per agent key (`sendThreadsLighting`):

| Condition | Effect | Speed | Color | Brightness |
|---|---|---|---|---|
| status `off` | `off` | 0 | 0 | 0 |
| `selected` or `pulsing` | `breath` | **0.4** | status color | model brightness |
| otherwise | `solid` | 0 | status color | model brightness |

`syncKeysLighting` and `syncAmbientLighting` are always `false`.

Ambient ring and keys backlight (`sendLightingConfig`):

| Condition | Ambient | Keys |
|---|---|---|
| `snakingAmbientStatus` set | `snake`, speed **0.4**, status color | `off` |
| Voice `recording` / `processing` | `snake`, speed **0.4**, voice color | see below |
| Voice `completed` | `solid`, white | see below |
| Selected slot is `working` | `snake`, speed **0.4**, status color | see below |
| Selected slot exists and selection lighting is visible | `solid`, status color | see below |
| No selected slot, or its status is `off` | `off` | `off` |

The keys zone is `solid` at the ambient color while selection lighting is
visible, and `off` otherwise. Selection lighting lasts **4000 ms** after
a slot becomes selected.

So a first simulator needs only `off`, `solid`, `snake`, and `breath`.
`rainbow`, `gradient`, and `shallowBreath` can render approximately, or
not at all, until something needs them.

### What we must guess

| Unknown | Why it matters |
|---|---|
| **LED count and geometry per zone.** How many LEDs form the ambient ring? Is the per-key LED a single pixel? | `snake` and `gradient` both spread along the zone's pixels. Without a pixel count, the movement looks wrong. |
| **The `speed` curve.** `speed = 0.4` is the only value the app ever sends. What period does 0.4 produce in milliseconds? | The animation will look faster or slower than the real device. |
| **The `breath` curve.** Sine, triangle, or gamma-corrected? What is the floor brightness? | `shallowBreath` is documented as floor 0.5, which implies `breath` has a lower floor — probably 0. That is an inference, not a fact. |
| **Snake segment width and direction.** | Purely cosmetic, but it affects whether a human recognizes the state at a glance. |
| **The `magic` parameter.** The app always sends `0`. Its meaning is undocumented. | Unknown, and currently unused. |
| **Gamma and the LED's real color response.** `0x304FFE` on a frosted keycap does not look like `#304ffe` on a monitor. | Only affects visual realism, not correctness. |

**Useful reference for the snake.** The shipped stylesheet
`codex-micro-bridge-D8kdrccf.css` renders an on-screen snake as a rotating
conic gradient. The segment spans roughly 115° of the circle: it fades in
near 235°, reaches full color at 300°, brightens toward white at 316°, and
fades out by 350°. One full rotation takes **1.8 s** in the highlight
state and **2.8 s** in the selected state.

That is OpenAI's *screen* rendering, not the firmware's. It is a good
default for our simulator and a bad citation for firmware behavior. Mark
it as a design reference.

**Verdict on fidelity:** the state model is fully specified and we can
match it exactly. The pixel-level appearance is not specified, and we must
guess. That is acceptable, because the simulator's job is to let a human
recognize state and press keys — not to be photometrically correct.

---

## Recommendation

Build a **GUI simulator at the library level**, in three layers.

**1. Define our own transport interface and implement two of them.**
Model it on `WLDeviceComm`, but write it ourselves — the Work Louder
package is proprietary and we cannot depend on it (§2). Give it the same
four-member shape from §1. Ship a real HID implementation and a simulator
implementation.

**2. Put the seam below the framing, not above it.** Have the simulator
accept 64-byte report buffers, not JSON strings. Our real framing code
then runs in both modes. Only the `node-hid` handle differs. This buys
back most of what a library-level fake usually cannot test.

**3. Draw the device in a local web page.** The page needs:

| Element | Behaviour |
|---|---|
| Six agent keys `AG00`–`AG05` | Show color, brightness, and animated effect from the last `sendThreadsLighting` |
| Ambient ring | Show the `ambient` zone from `sendLightingConfig` |
| Keys backlight | Show the `keys` zone |
| Six command keys `ACT06`–`ACT12` | Clickable, with the keycap legends from §4 |
| Mouse down and up on any key | Emit `v.oai.hid` with `act: 1` then `act: 0`. Hold works naturally, which exercises the 350 ms and 500 ms machines by hand |
| Joystick pad | Drag emits `v.oai.rad` with polar `angle` and `distance` 0–1; release emits `{angle: 0, distance: 0}` |
| Encoder | Two buttons emit `ENC_CW` / `ENC_CC` with `act: 2`; a third sends press and release |
| Connection controls | Buttons for connect, disconnect, transport error, and USB↔Bluetooth handoff |
| Demo button | Replay the 12-second onboarding script from §3 |
| Frame log | Show every 64-byte report as decoded JSON-RPC, so a human can see what we sent |

Use CSS animations for the effects, seeded by the parameters in the
payload. Start with the four effects the integration actually uses.

**Trade-off, stated plainly.** This simulator proves our state machines,
our lighting diffing, our timing windows, and our UI. It does not prove
that a real Codex Micro accepts our frames. That gap closes only against
hardware, or against a Linux `uhid` device later.

**Do not start with a Windows virtual HID driver.** It costs an EV
certificate or a disabled Secure Boot, and it delivers the same human
experience much later.

---

## What stays unverified

| Claim | Status | How to verify later |
|---|---|---|
| No simulator exists in any **other** version of the device kit | Uncertain. I read the version bundled in ChatGPT v26.803.5235.0 only. | Ask Work Louder for `read:packages` access to `@worklouder/wl-device-kit`, then read the published tarballs |
| Work Louder publishes no SDK documentation | Uncertain. I found no developer docs on their site or GitHub. I did not fetch every page of worklouder.cc. | Read [worklouder.cc](https://worklouder.cc/) and their feedback site; ask support directly |
| The Codex Micro / Creator Micro V2 have no VIA entry | Uncertain. Inferred from the absent QMK entry and the ESP32 platform. | Search the `the-via/keyboards` repository for VID `0x303A` |
| The `input-linux` community port reveals nothing new | **Not checked.** | Read [worklouder/input-linux](https://github.com/worklouder/input-linux); it may document the protocol independently |
| Every protocol constant in §4 | **Verified by reading code**, but never observed on the wire | Attach a Codex Micro; log the 64-byte reports; compare |
| LED count, snake geometry, breath curve, `speed`-to-period mapping | **Unknown.** Not in any source I read. | Attach a Codex Micro; send each effect at several speeds; record video |
| The `magic` lighting parameter | **Unknown.** Always `0` in the app. | Attach hardware; sweep the value; observe |
| com0com installs cleanly on current Windows 11 | Uncertain. Sources disagree, and the newest claims are undated marketing copy on `com0com.com`. | Install it on a test machine, if the serial path ever matters |
| Whether OpenAI's internal test fakes exist | Inferred from the injectable ports in `CodexMicroService`. The fakes are not in the shipped bundle. | Not verifiable from outside |
| Nothing here was tested against hardware | **No keypad is attached to this machine.** Every device-facing claim comes from reading code. | Attach a Codex Micro or a Creator Micro V2 |

---

## What this means for the project

1. **We are free of the vendor, and we must be.** `@worklouder/*` is
   proprietary and unavailable. We write our own transport and our own
   RPC client. The protocol in §4 is complete enough to do that.
2. **The transport seam is the whole answer.** Design our device layer
   around a small, injectable transport interface from day one. The
   simulator, the tests, and the real device then share one code path.
3. **Put the seam below the framing.** That single decision decides how
   much a hardware-free loop can actually prove.
4. **Ship the on-screen keypad early.** It is the development loop. It is
   also the fastest way to see whether our lighting rules read well to a
   human.
5. **Keep a hardware-verification list.** Everything in the table above
   with status "Unknown" needs a keypad. Record it, and clear it in one
   session when hardware arrives.
6. **Do not spend money on Windows drivers yet.** If we ever want a real
   OS-level device, do it on Linux with `/dev/uhid` first.
