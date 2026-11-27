# glancepad

Ambient status lighting and shortcuts for coding agents, on a Work Louder
macro keypad.

Six keys, one agent session each. A key's color tells you what that session
is doing — running, waiting for your approval, finished with something you
have not read, or failed. You steer several agents at a glance, without
switching windows.

> **Independent and unofficial.** glancepad is not affiliated with,
> endorsed by, or sponsored by OpenAI, Work Louder, or Anthropic. It
> contains no code from any of them. Product names are used only to say
> what the project works with. See [NOTICE](NOTICE).

## Status

Early. The wire protocol is implemented and tested in
[`src/protocol/`](src/protocol/), a human-usable simulator exists, and
hardware mode drives a physical keypad on Linux.

We tested hardware mode with one keypad on 2026-11-26. The keypad
opened without root, the six agent keys showed the session colors, key
and encoder events arrived, and the lighting returned after an unplug
and a replug. [`docs/protocol.md`](docs/protocol.md) §11 records what
the keypad sent, and what is still unread: the LED count, the exact
breath period, and the snake shape.

macOS has a hardware mode that **nobody tested on a Mac**
([ADR-0004](docs/adr/0004-macos-hid-access-through-node-hid.md)). See
"macOS". Windows has no hardware mode.

## Set up for Claude Desktop

This is the main setup. It is for sessions in the Code tab of the
Claude Desktop app, on Linux with Hyprland. Terminal sessions use the
same setup.

```sh
pnpm install
pnpm hooks:install   # adds the glancepad hooks to ~/.claude/settings.json
pnpm keypad          # or `pnpm sim` without a keypad
```

`pnpm hooks:install` keeps your other settings and your other hooks.
It writes a copy of the old file to
`~/.claude/settings.json.glancepad-backup`. `pnpm hooks:remove` removes
the hooks again. A session reads the settings at its start, so start a
new session after the installation. For the keypad, install the udev
rule one time: see "Run with a physical keypad".

| Feature | Claude Desktop session | Terminal session |
|---|---|---|
| Key lighting | Works. The user settings file is the only file that applies to all sessions | Works |
| Agent key opens the session | Works. glancepad opens the session link and focuses the app window | Works. glancepad focuses the terminal window |
| Microphone key | **No dictation.** The Linux desktop app has no voice input | Possible with `/voice`. See "Push-to-talk" |

Do not put the hooks in `.claude/settings.local.json` of a worktree.
The app reads project and local settings from the main checkout, and a
session in a worktree ignores the file in the worktree. The evidence
for this section is in
[`research/claude-desktop-sessions.md`](research/claude-desktop-sessions.md).

## Run the simulator

```sh
pnpm install
pnpm sim         # serves the on-screen keypad on http://localhost:4180/
pnpm sim:state   # prints the six keys, both zones, and the driver as JSON
```

The page shows the six agent keys, the ambient ring, the keys backlight,
and a frame log of every 64-byte report in both directions. Keys are
clickable; press and release emit real `v.oai.hid` notifications through
the same framing code hardware mode will use. Headless is the same
process with no browser connected.

## Push-to-talk

The microphone key (`ACT10_ACT11`, keycap `MIC`) is a push-to-talk key.
The key id comes from reading. No keypad confirmed it.

| Gesture | Result |
|---|---|
| Hold the key for 350 ms or longer | `talk-start` on press, `talk-stop` on release |
| Tap the key one time | `talk-start` on press, `talk-stop` 350 ms after the press |
| Tap the key two times in 350 ms | `talk-start`, then the recording stays on (latch) |
| Press the key while latched | `talk-stop`. The key ignores presses for the next 350 ms |

glancepad does not record audio. Each action runs a shell command that
you set in the configuration file:

```json
{
  "talk": {
    "start": "<command>",
    "stop": "<command>"
  }
}
```

The file is `$XDG_CONFIG_HOME/glancepad/config.json`. When
`XDG_CONFIG_HOME` is not set, the file is
`~/.config/glancepad/config.json`. glancepad reads the file at its
start and prints the path. A file that is not valid writes one line to
the log, and glancepad starts with no commands.

To invoke a system-wide shortcut, set the command that sends the
shortcut, or set the command that the shortcut runs. Use the same
command for `start` and `stop` when the shortcut is a toggle.

An environment variable replaces the same command from the file:

```sh
GLANCEPAD_TALK_START='<command>' GLANCEPAD_TALK_STOP='<command>' pnpm sim
```

The commands run with `sh -c`, one at a time, in order. A command that
runs longer than 5 seconds is stopped. A command that fails writes one
line to the log and the server continues. The output of a command is
not logged. With no command set, the key does nothing. The simulator
page shows the machine state and the result of the last action.

**Claude Desktop on Linux has no dictation to start.** The vendor
documentation says that voice input is not available in the Linux
desktop app
([Claude Desktop on Linux](https://code.claude.com/docs/en/desktop-linux),
read on 2026-11-26). The system-wide dictation shortcut is for macOS
only, and no `claude://` link starts dictation. Thus no command can
start dictation in a Claude Desktop session on Linux. The nearest
alternatives are a Claude Code session in a terminal (the example
below), or a system dictation tool that types into the focused window
and that has a start command and a stop command.

**Why a command, and not Claude Code voice input directly.** Claude
Code 2.1.332 starts dictation from a key in the focused terminal only
(default `Space`, action `voice:pushToTalk`). Its documentation gives
no flag, hook, socket, or other interface that starts dictation from a
second process. Sources:
[voice dictation](https://code.claude.com/docs/en/voice-dictation),
[keybindings](https://code.claude.com/docs/en/keybindings). A command
also lets you use a different dictation tool.

### Example: system-wide dictation with voxtype

This example is **tested** on 2026-11-26 with a physical keypad, on
Arch Linux with Hyprland, voxtype 1.3.1, and `wtype`. The owner held
the microphone key, spoke, and the text appeared in the focused
window. It works in Claude Desktop, because the text goes to the
window that has the focus.

[voxtype](https://voxtype.io) is a separate project. It records while
its daemon is told to, transcribes on the machine, and types the text.

1. Install `wtype` and voxtype, download a model, and install the
   user service:

   ```sh
   sudo pacman -S --needed wtype
   paru -S voxtype-bin
   voxtype setup --download
   voxtype setup systemd
   ```

2. Switch off the hotkey of voxtype in `~/.config/voxtype/config.toml`.
   The keypad is then the only trigger, and voxtype does not need the
   `input` group:

   ```toml
   [hotkey]
   enabled = false
   ```

3. Set the two commands in the glancepad configuration file, then
   restart glancepad:

   ```json
   {
     "talk": {
       "start": "voxtype record start",
       "stop": "voxtype record stop"
     }
   }
   ```

Each command only signals the daemon, so it returns at once. A single
short tap records for 350 ms, which is too short for speech. Not
tested: the double-tap latch with voxtype.

### Example: Claude Code dictation on Hyprland

This example is **not tested**. It needs a microphone and a terminal
that has the focus, and the session that wrote it had neither.

1. In Claude Code, run `/voice tap`. In tap mode, one key press starts
   the recording and the next key press stops it and sends the prompt.
   Hold mode is not expected to work here: it detects a hold from key
   repeat, and one injected key press has no repeat.
2. Bind `voice:pushToTalk` to a modifier chord in
   `~/.claude/keybindings.json`, for example `meta+k`. A chord starts
   the recording on the first key press.
3. Let both commands send that chord to the terminal window.
   `hyprctl dispatch sendshortcut` is part of Hyprland, so no other
   tool is necessary:

   ```sh
   export GLANCEPAD_TALK_START='hyprctl dispatch sendshortcut "ALT, K, class:^(kitty)$"'
   export GLANCEPAD_TALK_STOP="$GLANCEPAD_TALK_START"
   pnpm sim
   ```

The window rule selects one kitty window. Change it when you use
ghostty or more than one terminal. Because the stop key sends the
prompt, a single short tap of the microphone key sends after 350 ms.

## Run with a physical keypad (Linux)

For macOS, see "macOS".

The keypad's device node is `root`-only by default. Install the udev
rule one time:

```sh
sudo install -m 0644 udev/70-glancepad.rules /etc/udev/rules.d/
sudo udevadm control --reload
sudo udevadm trigger --subsystem-match=hidraw
```

`getfacl /dev/hidraw*` then shows your user on the keypad's nodes.
Unplug the keypad and plug it in again if it does not.

```sh
pnpm keypad         # the simulator page, and the keypad beside it
pnpm keypad:probe   # prints what the keypad sends; see the script
```

`pnpm keypad` is `pnpm sim` with `--device hid`. The session feed
lights the keypad, and the page mirrors what the host sent. The process
starts without a keypad and looks for one each second. After an unplug
and a replug it sends the lighting again. The keypad can take some
seconds to appear; one plug-in took 40 seconds.

glancepad sends lighting requests only. It never writes firmware.

## macOS

We tested each step below on macOS 26.5 with a Codex Micro keypad
connected over **Bluetooth**, on 2026-11-27 (issue #17). **USB on
macOS is not tested.** The evidence is in
[`research/macos-support.md`](research/macos-support.md).

1. Install Node 22 or later and pnpm, then run `pnpm install`. No
   compiler is necessary: the keypad library `node-hid` contains a
   binary for macOS.
2. Install the hooks: `pnpm hooks:install`. Start a new session after
   that.
3. Grant **Input Monitoring** to the terminal application that runs
   glancepad (System Settings → Privacy & Security → Input Monitoring).
   Over Bluetooth, macOS shows the keypad as one device that also has
   a keyboard usage, so it refuses the open without this permission.
   Over USB the vendor interface may be a device of its own; we did
   not test that. The error
   is `failed to open IOHIDDevice from mach entry: (0xE00002E2)
   (iokit/common) not permitted`. We did not have to restart the
   terminal after the grant.
4. Connect the keypad and run `pnpm keypad`. No udev rule and no `sudo`
   are necessary. Quit other applications that drive the keypad: two
   hosts would both set the lighting.
5. Press an agent key. For a Claude Desktop session, glancepad opens
   the session link with `open`. For a terminal session, glancepad
   brings the terminal application to the front. It does not select a
   window, a tab, or a split: the window that was in front last comes
   up. It does not find a session in tmux.
6. Set the microphone key. See the Raycast example below.

### Example: Raycast Dictation on the microphone key

[Raycast Dictation](https://manual.raycast.com/ai/dictation) starts
from a hotkey that you set. Raycast ignores a hotkey that `osascript`
sends through System Events. It accepts a hotkey that
`scripts/macos-hotkey.js` posts at the HID level, and one tap of it
starts or stops Dictation.

1. In Raycast, set the hotkey of Dictation, for example Hyper+Space.
   Hyper is Cmd+Ctrl+Option+Shift when the option "Include Shift" of
   the Raycast Hyper Key is on.
2. Write `~/.config/glancepad/config.json`. Replace `<glancepad>` with
   the path of this repository:

   ```json
   {
     "talk": {
       "start": "osascript -l JavaScript <glancepad>/scripts/macos-hotkey.js 49 cmd ctrl opt shift",
       "stop": "osascript -l JavaScript <glancepad>/scripts/macos-hotkey.js 49 cmd ctrl opt shift"
     }
   }
   ```

   Key code 49 is the Space key. Each command sends one tap of the
   hotkey. The tap at the press starts Dictation, and the tap at the
   release accepts the text.
3. Grant **Accessibility** to the terminal application that runs
   glancepad. Raycast itself needs the Microphone and Accessibility
   permissions.
4. Start `pnpm keypad` again, hold the microphone key, speak, and
   release it.

If one tap is lost, Dictation and the key disagree: press the hotkey
yourself to stop Dictation. The Raycast link
`raycast://extensions/raycast/dictation/dictate` (from "Copy Deeplink")
starts Dictation, but a second run does not stop it, so it cannot be
the stop command.

## Optional Claude Code mod

The mod was last checked on Claude Code 2.1.332. The mod API is early
access and can change without notice.

The mod posts two events to `http://127.0.0.1:4180/events`. It posts
`turn-ended` with outcome `interrupted` when you press Esc or deny a
permission dialog. It posts a heartbeat every 5 seconds. It does not
post the events a settings hook already sends.

A failed post stays silent. glancepad can be down.

Load the mod from a checkout:

```sh
claude --plugin-dir scripts/glancepad-mod
```

A watched session leaves the keys when no event and no heartbeat
arrive for 15 seconds. A hooks-only session stays until it ends.
Settings hooks post to the same `/events` path. The snippet is
[`scripts/glancepad.settings.json`](scripts/glancepad.settings.json).
Its hooks call `curl`, and they stay silent when glancepad is down.
An unknown body is ignored. The server does not log the body.

## Bring a session to the front

A press on an agent key brings the session of that key to the front.
It also marks the session as read: an `unread` key goes to `idle`. A
press on an empty key does nothing.

Setup:

1. Use Hyprland on Linux, or macOS: see "macOS". No other window
   system has an implementation.
2. Install the hooks with `pnpm hooks:install`, or load
   [`scripts/glancepad.settings.json`](scripts/glancepad.settings.json)
   in one session with `claude --settings scripts/glancepad.settings.json`.
   The hooks must stay command hooks. They send the process id of the
   session in the `x-glancepad-pid` header. A Claude Desktop session
   sends its app session id also, in the `x-glancepad-host-session`
   header. The hooks send no prompt text.
3. Start `pnpm keypad` or `pnpm sim`. It finds `hyprctl` and `xdg-open`
   on the `PATH`.

Each session selects its path by what it reported:

- **A Claude Desktop session** reported an app session id
  (`local_<uuid>`). glancepad opens
  `claude://claude.ai/epitaxy/local_<uuid>` with `xdg-open`, and the
  app selects that session. glancepad then focuses the app window,
  because the link does not bring the window to the front on Hyprland.
  When the header is absent, glancepad reads the id from the session
  record `~/.claude/sessions/<pid>.json`.
- **A terminal session** reported a process id only. glancepad finds
  the terminal window from the process id at the time of the press.

A session that sent no process id is marked as read, and its window
stays where it is. A failed focus writes one line to the log.

Limits for a Claude Desktop session: a session in a pop-out window is
not tested. The link and the record file are not documented by the
vendor, and they can change with an app update.

Limits for a terminal session: the focus goes to the terminal window.
It does not select a tab or a split. One terminal process with two
windows is not resolved. tmux is not supported. See
[`research/session-window-handle.md`](research/session-window-handle.md)
and
[`research/claude-desktop-sessions.md`](research/claude-desktop-sessions.md).

## What is here

| Path | Contents |
|---|---|
| [`research/roadmap.md`](research/roadmap.md) | The goal, and the feature order |
| [`research/virtual-device-options.md`](research/virtual-device-options.md) | Why we build our own simulator, and the recovered wire protocol |
| [`research/claude-desktop-sessions.md`](research/claude-desktop-sessions.md) | What a Claude Desktop session sends, and how glancepad opens it |
| [`research/macos-support.md`](research/macos-support.md) | The macOS evidence, the open points, and the checklist for a Mac |
| [`research/codex-micro-state-machines.md`](research/codex-micro-state-machines.md) | The behavior we replicate, with its timing constants |
| [`research/codex-micro-agent-key-assignment.md`](research/codex-micro-agent-key-assignment.md) | How sessions are assigned to keys |
| [`docs/adr/`](docs/adr/) | Architectural decisions and their reasoning |
| [`CLAUDE.md`](CLAUDE.md) | Working agreement, stack, and conventions |

## How it will work

The keypad is expressive but not clever. It streams key and joystick
events up, and it receives lighting commands down, over JSON-RPC carried in
64-byte HID reports. All of the intelligence sits in the host.

The first milestone is a simulator, because no keypad is needed to build
one — see the open issues.

## Licence

[Apache-2.0](LICENSE). Third-party attribution is in [NOTICE](NOTICE).
