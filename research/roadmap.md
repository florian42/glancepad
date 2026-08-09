# Project goal & feature priorities

Replicate the Codex Micro ↔ ChatGPT desktop behavior for **Claude Code**,
driving the same Work Louder hardware.

Priorities (agreed 2026-08-08):

1. **Device lighting** — mirror ChatGPT's slot status machine
   (`off / idle / unread / working / awaiting-approval /
   awaiting-response / error`) fed by Claude Code session state
   (see [codex-micro-state-machines.md](codex-micro-state-machines.md) §3,
   §10 and [codex-micro-agent-key-assignment.md](codex-micro-agent-key-assignment.md)).
2. **Microphone key** — hold-to-talk / double-tap-to-latch machine
   (state-machines §5, 350 ms windows).
3. **Agent keys** — single tap opens the associated Claude Code session
   (ChatGPT's tap machine, state-machines §4, with `singleTapAgentKeys`
   behavior as our default).

Slot assignment: we target the **`recent`** source mode (ChatGPT's
default) — sessions ordered by last activity, de-duplicated, first six on
the keys, no slot stickiness; rely on lighting-payload diffing to keep
the device calm (see codex-micro-agent-key-assignment.md).

Key protocol facts: JSON-RPC over HID/serial via
`@worklouder/device-kit-oai` (`sendThreadsLighting`,
`sendLightingConfig`, notifications `v.oai.hid` + `v.oai.rad`);
type definitions in `research/reference/` (local only, not in git).
