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
pnpm sim:state   # prints the six keys and both zones as JSON
```

The page shows the six agent keys, the ambient ring, the keys backlight,
and a frame log of every 64-byte report in both directions. Keys are
clickable; press and release emit real `v.oai.hid` notifications through
the same framing code hardware mode will use. Headless is the same
process with no browser connected.

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
