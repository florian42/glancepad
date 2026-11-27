# macOS support: HID access, session focus, hooks, and Raycast dictation

Date: 2026-11-26, written on Arch Linux without a Mac. Updated
2026-11-27 after a run on macOS 26.5 (Apple silicon), Node 24.22.2,
Ghostty, Claude Desktop, and Raycast, with the keypad connected over
**Bluetooth LE**. USB on macOS is not tested. Issue #17 holds the raw
output of each step.

Each claim has a mark: **verified on macOS** (we ran it on the Mac, or
the user saw it), **verified** (on the Linux machine),
**documented** (a vendor page or the library source says it), or
**uncertain**.

## Results on macOS, 2026-11-27

All eight steps of the checklist in section 5 passed, after two
fixes. **Verified on macOS:**

- `node-hid` 3.4.0 loads its prebuilt binary (hidapi 0.15.0). Over
  Bluetooth, `devices(0x303a, 0x8360)` gives **five** entries with
  **one** path (`DevSrvsID:…`): usage pages and usages 1/6 (keyboard),
  12/1, 1/2, 1/1, and 65280/1. Linux over USB gave three interfaces.
- The first open failed: `hid_open_path: failed to open IOHIDDevice
  from mach entry: (0xE00002E2) (iokit/common) not permitted`. After
  the user granted Input Monitoring to Ghostty, the open worked
  without a restart of Ghostty. We did not record if macOS showed a
  dialog.
- Input reports are 64 bytes with byte 0 equal to 6. No keyboard
  report reached the transport. A key press arrived as
  `{"m":"v.oai.hid","p":{"k":"AG00","act":1}}`.
- Writes work: `v.oai.thstatus` and `v.oai.rgbcfg` returned
  `{"ok":1}`, and six keys showed six colors.
- Session state lit the agent keys. A tap on a Claude Desktop key
  opened the session. A tap on a terminal key brought Ghostty to the
  front, but with the window that was in front last.
- A switch-off of the keypad gave `keypad disconnected (read failed:
  could not read data from device: hid_read_timeout: device
  disconnected), looking for it`, then `keypad connected`, and the
  lighting returned.
- The microphone key started and stopped Raycast Dictation through
  `scripts/macos-hotkey.js`. See section 4.

The two fixes:

- The focus walk skipped no process. Claude Desktop runs `claude` from
  a bundle of its own
  (`…/Application Support/Claude/claude-code/<version>/…/claude.app/Contents/MacOS/claude`),
  so the fallback opened that bundle. The walk now starts at the
  parent of the session process.
- `osascript` through System Events cannot drive Raycast. See
  section 4.

## 1. Keypad transport

The decision is in `docs/adr/0004-macos-hid-access-through-node-hid.md`.
The library is `node-hid` 3.4.0 with hidapi 0.15.0. We read the files
of the installed package (`node_modules/node-hid/`), which are the
files of the
[node-hid repository](https://github.com/node-hid/node-hid) and of the
[hidapi repository](https://github.com/libusb/hidapi).

- **Verified:** the package contains prebuilt binaries for
  `darwin-arm64` and `darwin-x64` (`prebuilds/`).
- **Verified on Linux:** with the install script blocked by pnpm, the
  library loads its prebuilt binary. `getHidapiVersion()` printed
  `0.15.0`.
- **Verified on Linux, with the keypad attached:** `devices(0x303a,
  0x8360)` gave three entries with usage pages 1, 12, and 65280. Our
  backend opened the entry with 65280, and the transport delivered
  input reports of 64 bytes with byte 0 equal to 6. This run used the
  hidraw driver of the library. **Verified on macOS (Bluetooth):**
  IOKit gives the same layout.
- **Documented (source):** on macOS a write with a report id that is
  not 0 gives all bytes to `IOHIDDeviceSetReport`
  (`hidapi/mac/hid.c`, `set_report`). The README says that the first
  byte of `write()` is the report id.
- **Documented (source):** on macOS a read returns the bytes of the
  input report callback without a change (`hid_report_callback`).
  `hidapi/hidapi/hidapi.h` says for `hid_read` that the first byte is
  the report number when the device uses numbered reports.
  **Verified on macOS (Bluetooth):** a real report has a length of 64
  and byte 0 equal to 6.
- **Documented (source):** `readTimeout(0)` returns an empty array at
  once when no report waits (`hid_read_timeout`, the branch for 0
  milliseconds; `src/HID.cc`, `readTimeout`).
- **Documented (source):** after an unplug, a read throws ("device
  disconnected") and a write throws.
- **Documented (source):** the library opens a device in the seize
  mode by default on macOS (`hid_init` calls
  `hid_darwin_set_open_exclusive(1)`). The option `nonExclusive: true`
  opens it shared. We use that option.
- **Documented (source, read by a research agent):** the Apple HID
  driver source asks for the Input Monitoring permission only for a
  keyboard, a mouse, or a trackpad service
  ([IOHIDFamily](https://github.com/apple-oss-distributions/IOHIDFamily),
  `IOHIDDevice.cpp`, `kIOHIDRequiresTCCAuthorizationKey`). The node-hid
  README says the same in other words: the system protects keyboards
  and mice. **Verified on macOS (Bluetooth): this applies to the
  keypad.** macOS does not show the vendor interface as its own
  device. The one device has a keyboard usage, so the open needs
  Input Monitoring. **Uncertain:** USB.

## 2. Session focus

`src/focus/macos.ts` uses two commands that are part of macOS.

- A Claude Desktop session: `open claude://claude.ai/epitaxy/local_<uuid>`.
  **Verified on Linux:** the app opens a session from this link
  (`research/claude-desktop-sessions.md`). **Verified on macOS:** the
  macOS app accepts the same link, and `open` brings it to the front.
  `open` does that for a link by default; the option `-g` prevents it
  (`man open`).
- A terminal session: `ps -ww -o ppid=,comm= -p <pid>` for each
  ancestor, until the executable is in a `<name>.app/Contents/`
  directory. `open -a <bundle>`
  then activates that application. **Verified on macOS:** `ps -o comm=`
  prints the full path of an application executable
  (`/Applications/Ghostty.app/Contents/MacOS/ghostty`). For `claude`
  and the shell it prints a short name (`claude`, `-/bin/zsh`), which
  is not in a bundle. The chain was `claude` → `-/bin/zsh` →
  `/usr/bin/login` → Ghostty.
- **Verified on macOS:** a Claude Desktop session runs `claude` from a
  bundle of its own, with the parent `/Applications/Claude.app/Contents/Helpers/disclaimer`
  and then `/Applications/Claude.app/Contents/MacOS/Claude`. The walk
  therefore skips the session process itself.

Neither command needs a privacy permission. An AppleScript that
selects a window or a tab needs the Automation permission for each
terminal application, and each terminal has a different script
dictionary. We did not build that.

Not resolved:

- The focus goes to the application, not to a window. A terminal with
  two windows shows the window that was in front last.
- A tab or a split is not selected.
- tmux and screen: the server process has `launchd` as its parent, so
  the walk finds no application.
- A session over SSH has no local application.

## 3. Hooks

**Verified by reading:** `scripts/glancepad.settings.json` uses
`curl`, `$PPID`, and `${NAME:-}` only. macOS contains `curl`, and its
`/bin/sh` knows both expansions. `scripts/install-hooks.mjs` uses
`os.homedir()` and `path.join()`, and no Linux path. We changed
neither file. **Verified on macOS:** `$PPID` of a shell that `claude`
starts is the `claude` process, and a Claude Desktop session has
`CLAUDE_CODE_HOST_SESSION_ID=local_<uuid>` in its environment
(`ps -E`). A running session also picked up the hooks without a
restart.

The configuration file follows the XDG rule on macOS also:
`~/.config/glancepad/config.json`.

## 4. Raycast dictation

A research agent read the Raycast pages on 2026-11-26. We did not use
Raycast.

- **Documented:** Raycast has a feature with the name "Dictation". It
  is for Raycast Pro. Raycast needs the Microphone and Accessibility
  permissions for it.
  [Dictation manual](https://manual.raycast.com/ai/dictation)
- **Documented:** the trigger is a global hotkey that the user sets.
  The manual gives no default. One hotkey has two modes: a tap starts
  and a second tap accepts the text; a hold records until the release.
- **Documented:** Raycast runs a command from a link of the form
  `raycast://extensions/<owner>/<extension>/<command>`, and it asks
  for a confirmation.
  [Deeplinks](https://developers.raycast.com/information/lifecycle/deeplinks)
  **Verified on macOS:** "Copy Deeplink" on the Dictation command
  gives `raycast://extensions/raycast/dictation/dictate`. The first
  `open` of it asks for a confirmation ("always allow" exists). It
  starts Dictation. A second run does not stop it, so the link cannot
  be the stop command.
- **Documented:** the Raycast Hyper Key sends Ctrl+Option+Cmd, and
  Shift also with the option "Include Shift".
  [Hyper Key manual](https://manual.raycast.com/hyper-key)

So glancepad must send the hotkey. **Verified on macOS: Raycast
ignores a hotkey that System Events sends.** With Dictation on
Hyper+Space, the line below neither started nor stopped it, although
`osascript` exited with 0:

```sh
osascript -e 'tell application "System Events" to key code 49 using {command down, control down, option down, shift down}'
```

Before the Accessibility grant, the same line failed with
`System Events got an error: osascript is not allowed to send
keystrokes. (1002)`, and macOS asked if "a program running within
Ghostty" may use AppleScript.

**Verified on macOS:** Raycast accepts a key event that is posted at
the HID event tap (`CGEventPost(kCGHIDEventTap, …)`), which
`scripts/macos-hotkey.js` does through JXA. One tap starts Dictation,
and the next tap stops it and inserts the text. The first version
posted only Space with the modifier flags. That left the four
modifiers held at the HID level, and the next Space that the user
typed opened Dictation again. The script now posts a key-down and a
key-up for each modifier also.

```sh
osascript -l JavaScript scripts/macos-hotkey.js 49 cmd ctrl opt shift
```

- A tap at the press starts Dictation, and a tap at the release
  accepts the text. This is the tap mode of Raycast, not the hold
  mode. If one tap is lost, the two sides disagree until the next tap.
- **Documented:** a script that sends keys needs the Accessibility
  permission
  ([Apple: Mac Automation Scripting Guide](https://developer.apple.com/library/archive/documentation/LanguagesUtilities/Conceptual/MacAutomationScriptingGuide/AutomatetheUserInterface.html)),
  and the control of System Events needs the Automation permission
  ([Apple: Mac User Guide](https://support.apple.com/guide/mac-help/mchl07817563/mac)).
  **Verified on macOS:** Ghostty needed both, and Input Monitoring
  for the keypad. We did not measure the delay that `osascript` adds.

The nearest alternative with a start command and a stop command is
Superwhisper. **Documented:** it has the links
`superwhisper://record/start` and `superwhisper://record/stop`
([Superwhisper documentation](https://superwhisper.com/docs/modes/switching-modes)).
The commands are then `open -g superwhisper://record/start` and
`open -g superwhisper://record/stop`. Not tested.

## 5. Checklist for the Mac

This is the checklist as the 2026-11-27 run used it. Step 7 now uses
`scripts/macos-hotkey.js` instead of the System Events line.

1. `git pull && pnpm install`. Report the last five lines, and the
   output of `node -v` and `sw_vers -productVersion`.
2. Attach the keypad. Run the line below and report its output. We
   expect one entry with `65280`.

   ```sh
   node -e 'const h=require("node-hid");console.log(h.getHidapiVersion(),h.devices(0x303a,0x8360).map(d=>[d.path,d.usagePage,d.usage,d.interface]))'
   ```

3. `PROBE_HEX=1 pnpm keypad:probe listen 5`, and press one key in
   these 5 seconds. Report each `status` line and the first two
   `<- raw` lines. We expect `<- raw 64 06…`. Report each permission
   dialog that macOS shows.
4. `pnpm keypad:probe colors`. Report the `<- ch2` lines, and say if
   the six keys show six colors.
5. `pnpm hooks:install`, then `pnpm keypad`. Start one new session in
   a terminal and one in Claude Desktop. Report the output of
   `pnpm sim:state`, and say which keys light.
6. In the terminal of that session, run `ps -ww -o ppid=,comm= -p $$` and
   report the output. Then put a different application in front and
   press the agent key of each session. Report which application came
   to the front, and each `focus failed` line in the log of `pnpm keypad`.
7. Set the Raycast Dictation hotkey to Hyper+D. Run the `osascript`
   line of section 4 in the terminal. Report each permission dialog,
   and say if Dictation started. Then write the configuration file,
   start `pnpm keypad` again, hold the microphone key, speak, and
   release. Report what happened, and each `command failed` line.
8. Unplug the keypad, wait 5 seconds, and attach it again. Report the
   `keypad` lines in the log, and say if the lighting returned.
