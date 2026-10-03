# Big-bang gaps

*Written 2026-10-03.*

Verified means the source states the claim. Uncertain means no source
states the live result. Issues 5, 6, and 10 are outside this list.

## Physical keypad

`SimulatedDevice` is the only `DeviceTransport`. The USB ids below come
from `research/virtual-device-options.md`. No code handles unplug or
replug. The repository has no udev rule. Issue 9 names
`src/ui/server.ts` for a partial send. The comment is now in
`src/device/host.ts`.

- **Verified.** Confirm that the six agent keys match the simulator
  colors.
- **Verified.** Open the keypad at vendor id `0x303A`, product id
  `0x8360`, and usage page `0xFF00`.
- **Verified.** Unplug the keypad and plug it back in.
- **Uncertain.** See whether the next lighting message works after a
  send fails mid-message.
- **Verified.** Confirm that Linux opens the keypad without root.
- **Uncertain.** The breath timing on the keypad is unread.
- **Uncertain.** The snake shape on the ring is unread.
- **Uncertain.** The LED count on the keypad is unread.

## Interactive terminal

Issue 7 needs a person at a terminal. The first session loads the
capture settings, the capture probe, and the glancepad mod:

```sh
claude --settings scripts/capture-hooks.settings.json --plugin-dir scripts/mod-probe --plugin-dir scripts/glancepad-mod
```

The hook log is `/tmp/glancepad-hooks.jsonl`. The mod log is
`/tmp/glancepad-mod-events.jsonl`. Remove prompt text before you store
either log. The session reducer already has an `awaiting-response`
event.

- **Uncertain.** Claude Code was not installed in the mod run, so
  `claude --plugin-dir scripts/glancepad-mod` is not yet observed.
- **Verified.** Press Esc while a turn works, and keep the mod log.
- **Verified.** A headless SIGINT ends in `turn.complete` with reason
  `aborted` and no `Stop`
  (`research/claude-code-mods-as-state-source.md`).
- **Uncertain.** No interactive log shows whether Esc does the same.
- **Verified.** Approve one `Bash` command and record the amber time.
- **Uncertain.** No measurement shows how long amber lasts after
  approval.
- **Verified.** A headless refusal ends in `turn.complete` with reason
  `answer` (`research/claude-code-mods-as-state-source.md`).
- **Verified.** Deny one `Bash` command in the permission dialog.
- **Uncertain.** No capture shows the turn end, or the reason, for
  that denial.
- **Verified.** Ask for `AskUserQuestion`, then answer the dialog.
- **Uncertain.** No interactive log shows the events for that question
  or its answer.
- **Verified.** In a second session, point one HTTP hook at
  `http://127.0.0.1:4199/events`.
- **Uncertain.** No capture shows whether each event then prints a
  hook error.
- **Verified.** That result is the open question in issue 6.
