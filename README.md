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
[`src/protocol/`](src/protocol/), and a human-usable simulator exists —
see below.

The device protocol has been worked out by reading and is recorded in
[`research/`](research/), but **nothing has been tested against hardware**.
Every device-facing claim is marked as verified-by-reading or unverified.

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
you set:

```sh
GLANCEPAD_TALK_START='<command>' GLANCEPAD_TALK_STOP='<command>' pnpm sim
```

The commands run with `sh -c`, one at a time, in order. A command that
runs longer than 5 seconds is stopped. A command that fails writes one
line to the log and the server continues. The output of a command is
not logged. With no command set, the key does nothing. The simulator
page shows the machine state and the result of the last action.

**Why a command, and not Claude Code voice input directly.** Claude
Code 2.1.332 starts dictation from a key in the focused terminal only
(default `Space`, action `voice:pushToTalk`). Its documentation gives
no flag, hook, socket, or other interface that starts dictation from a
second process. Sources:
[voice dictation](https://code.claude.com/docs/en/voice-dictation),
[keybindings](https://code.claude.com/docs/en/keybindings). A command
also lets you use a different dictation tool.

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

## Optional Claude Code mod

The mod targets Claude Code 2.1.287. That build's mod API is early
access and can change without notice.

The mod posts two events to `http://127.0.0.1:4180/events`. It posts
`turn-ended` with outcome `interrupted`. It posts a heartbeat every
5 seconds. It does not post the events a settings hook already sends.

A failed post stays silent. glancepad can be down.

Load the mod from a checkout:

```sh
claude --plugin-dir scripts/glancepad-mod
```

A watched session leaves the keys when no event and no heartbeat
arrive for 15 seconds. A hooks-only session stays until it ends.
Settings hooks post to the same `/events` path. The snippet is
[`scripts/glancepad.settings.json`](scripts/glancepad.settings.json).
An unknown body is ignored. The server does not log the body.

## Bring a session to the front

A press on an agent key brings the terminal window of that session to
the front. It also marks the session as read: an `unread` key goes to
`idle`. A press on an empty key does nothing.

Setup:

1. Use Hyprland. No other window system has an implementation yet.
2. Load [`scripts/glancepad.settings.json`](scripts/glancepad.settings.json)
   in each session. Its `SessionStart` hook must stay a command hook. It
   sends the process id of the session in the `x-glancepad-pid` header.
   It sends no prompt text.
3. Start `pnpm sim`. It finds `hyprctl` on the `PATH`.

```sh
claude --settings scripts/glancepad.settings.json
```

glancepad finds the window from the process id at the time of the
press. A session that sent no process id is marked as read, and its
window stays where it is. A failed focus writes one line to the log.

The focus goes to the terminal window. It does not select a tab or a
split. One terminal process with two windows is not resolved. tmux is
not supported. See
[`research/session-window-handle.md`](research/session-window-handle.md).

## What is here

| Path | Contents |
|---|---|
| [`research/roadmap.md`](research/roadmap.md) | The goal, and the feature order |
| [`research/virtual-device-options.md`](research/virtual-device-options.md) | Why we build our own simulator, and the recovered wire protocol |
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
