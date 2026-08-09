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

Early. No code yet — the repository holds research and a specification.

The device protocol has been worked out by reading and is recorded in
[`research/`](research/), but **nothing has been tested against hardware**.
Every device-facing claim is marked as verified-by-reading or unverified.

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
