# Codex Micro — Research Findings

*Researched 2026-08-08 via web sources and inspection of the installed ChatGPT
desktop app (Microsoft Store package `OpenAI.Codex` v26.803.5235.0).*

*See also: [codex-micro-state-machines.md](codex-micro-state-machines.md)
for a detailed reverse-engineering of every state machine in the
integration.*

## What it is

**Codex Micro** is OpenAI's first consumer hardware product, announced
**July 15, 2026** — a **$230 mechanical macro keypad** for controlling Codex
AI coding agents, built in collaboration with **Work Louder** and based on
their Creator Micro 2 (which also receives official support). It works
exclusively with the **ChatGPT desktop app** (macOS + Windows) and connects
via **USB-C or Bluetooth** (3 channels).

The core idea: agentic coding means agents work autonomously, then wait for
human input. The Micro closes that gap "with a glance" — you monitor and
steer up to six agents without leaving your keyboard or opening the ChatGPT
window.

## Hardware

| Component | Description |
|---|---|
| **6 Agent Keys** | Frosted, RGB-lit. Each follows one chat/task and shows its status by color: white = idle, blue = thinking/working, green = complete, amber = needs input, red = error, off = unassigned |
| **6 Command Keys** | Customizable. Defaults: Fast-mode toggle, approve/decline requests, fork chat, microphone (push-to-talk), send message |
| **Analog stick** | 4 mappable directions (defaults: Plan mode, app history navigation, sidebar toggle, scrolling); can also trigger Codex Skills |
| **Rotary dial (knob)** | Adjusts **reasoning effort** or scrolls the conversation; press/turn gestures are separately mappable |

Available with clicky or silent switches. Up to 6 operation layers via Work
Louder's Input software. Sold through OpenAI Supply Co and Work Louder.

## How the integration works (from app internals)

The ChatGPT desktop app is an Electron app. The entire Codex Micro
integration is inspectable in its `app.asar` and unpacked native modules.

### Device SDK: `@worklouder/device-kit-oai`

A Node package using **`node-hid` + `@serialport`** natively, speaking
**JSON-RPC** to the device. Hotplug detection is handled by a native
`hid-topology-watcher.node` module. Firmware updates go through a
`WLDeviceProgrammer` (firmware id `CMicroV2Firmware`).

The typed API (`RPCApiOAI`):

| Method / channel | Purpose |
|---|---|
| `onHidReceived(cb)` — channel `v.oai.hid` | Key events, payload `{key: string, act?: number, agent?: number}` |
| `onJoystickMove(cb)` — channel `v.oai.rad` | Joystick position, payload `{angle: 0–1, distance: 0–1}` (polar, not X/Y) |
| `sendThreadsLighting(threads[])` | Per-Agent-Key LED state: `{id, color?, brightness?, effect?, speed?, syncKeysLighting?, syncAmbientLighting?}` |
| `sendLightingConfig({ambient, keys})` | Two lighting zones: outer ambient ring + under-key backlight |
| `getFirmwareVersion()`, `getDeviceStatus()` | Status queries |

Lighting effects supported by firmware: `off, solid, snake, rainbow, breath,
gradient, shallowBreath`.

Notable: the joystick reports polar `{angle, distance}` normalized 0–1 —
designed for radial menus / gesture selection rather than cursor movement.

### App-side architecture (renderer chunks)

Modules: `codex-micro-bridge`, `codex-micro-slot-signals`,
`codex-micro-commands`, `codex-micro-settings`, `codex-micro-joystick-hud`,
`codex-micro-onboarding-*`, `codex-micro-mini-games`.

**Agent Key slots** are identified `AG00`–`AG05`. Each slot derives a status
from local or remote thread state:

```
off | idle | unread | working | awaiting-approval | awaiting-response | error
```

Derivation (from `slot-signals`): `error` status → `error`; pending approval
chip → `awaiting-approval`; pending response chip → `awaiting-response`;
loading → `working`; unread → `unread`; else `idle`. Remote tasks map
`pending`/`in_progress` → `working`, `failed` → `error`.

**Agent-key sources** — what the six keys follow:

- `pinned` — first six pinned chats/projects
- `recent` — six most recently updated chats
- `priority` — attention-ranked (by attention state + recency)
- `custom` — manual per-key assignment of a thread, a command, or a skill

Slot state pushed to the device also carries `pulsing`, `selected`,
`voiceState`, `brightness`, `inactivityTimeoutMs` (auto-dim: 1 min / 3 min /
1 hour), and a `snakingAmbientStatus` flag.

**Key press semantics** distinguished by the bridge: `short-press`,
`long-press`, `push-to-talk-press`/`-release`, `encoder-press`,
`encoder-release`, plus states like `latched`, `suppressing-presses`,
`waiting-for-second-press`.

### Keycaps are physical identities

Swappable keycaps have baked-in IDs the app recognizes and maps to default
actions:

```
APPR REJ FAST YOLO MRG PR DRAFT DIFF GIT BRANCH/BRCH FORK TERM BUG NEW DEL
NAV SPLIT FOLD UPL TIME PLAY PAINT PARTY MAGIC YEET MIC MIC1 OAI CODEX LAB
MIND- SETUP EMPT1–EMPT5
```

Assignable actions found in settings include: Approve, Reject, Merge PR,
Create PR / Create draft PR, Create branch, Commit or push, Toggle terminal,
Toggle review, Toggle Fast mode, New chat, Archive chat, Pin/unpin chat,
Copy chat as Markdown, Continue in new chat, Open side chat, Send message,
Push to talk / Start a Voice Chat, Increase/Decrease reasoning effort,
conversation scrolling, composer navigation, open feedback/plugins/settings,
external URL keycaps, and arbitrary shortcuts or skills.

### Easter egg

The device ships **mini-games** playable via the joystick: snake, asteroids,
and brick-breaker (`codex-micro-mini-games` chunk).

## Key takeaways for this project

1. **The device is "dumb but expressive"** — all intelligence lives in the
   desktop app. The Micro streams HID/joystick events up and receives
   lighting RPCs down. Any host app could drive it by speaking the same
   JSON-RPC-over-HID/serial protocol.
2. **The six-slot status dashboard is the core design idea.** LEDs are an
   ambient display of agent states, not decoration. A Claude Code TUI
   equivalent maps naturally: six panes/slots with the same status state
   machine (`idle / working / awaiting-approval / awaiting-response /
   unread / error`) and the same source modes (pinned / recent / priority /
   custom).
3. **Interaction vocabulary worth replicating:** short/long press, push-to-
   talk latch, a "reasoning effort" dial, and a radial (angle/distance)
   gesture selector for skills.

## Sources

- [OpenAI docs — Codex Micro](https://learn.chatgpt.com/docs/features/codex-micro)
- [TechCrunch — Amid hardware legal battle, OpenAI releases a $230 keyboard for Codex](https://techcrunch.com/2026/07/15/amid-hardware-legal-battle-openai-releases-a-230-keyboard-for-codex/)
- [New Atlas — OpenAI releases its first hardware, the Codex Micro 'keyboard'](https://newatlas.com/computers/openai-codex-micro-keyboard/)
- [gHacks — OpenAI Launches Codex Micro, a $230 Mechanical Keypad for AI Coding](https://www.ghacks.net/2026/07/18/openai-launches-codex-micro-a-230-mechanical-keypad-for-ai-coding/)
- [TechRadar — What is the Codex Micro?](https://www.techradar.com/ai-platforms-assistants/openai/what-is-the-codex-micro-openais-first-hardware-gadget-explained)
- [TechTimes — Codex Micro Ships Today: Agent Keys Only Work With ChatGPT Desktop](https://www.techtimes.com/articles/320670/20260716/openai-codex-micro-ships-today-agent-keys-only-work-chatgpt-desktop.htm)
- Local inspection: `C:\Program Files\WindowsApps\OpenAI.Codex_26.803.5235.0_x64__2p2nqsd0c76g0\app\resources\` (`app.asar`, `app.asar.unpacked\node_modules\@worklouder\device-kit-oai`)
