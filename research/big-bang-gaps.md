# Big-bang gaps

*Written 2026-10-03.*

Verified means the source states the claim. Uncertain means no source
states the live result. Issues 5, 6, and 10 are outside this list.
The interactive section was updated on 2026-11-26.

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

**Closed on 2026-11-26.** Issue 7 did not need a person. An agent drove
an interactive `claude` 2.1.332 through a pseudo-terminal, with the
capture settings and the capture probe loaded. The observed rows are in
`research/claude-code-session-signals.md` and
`research/claude-code-mods-as-state-source.md`, each under "Observed in
an interactive session".

- **Closed.** The first glancepad mod did not load on 2.1.332, because
  it imported a file outside its folder. The fixed mod loads.
- **Closed.** Esc ends the turn with `turn.complete` `aborted` and no
  `Stop`, the same as SIGINT.
- **Closed.** Amber lasted 6.2 seconds after the approval of a 6 second
  `Bash` command. It ends at `PostToolUse`.
- **Closed.** A denial in the dialog ends the turn with `turn.complete`
  `answer`, and no hook fires. The mod now reports it.
- **Closed.** `AskUserQuestion` fires `PreToolUse`, then
  `PermissionRequest`, and `PostToolUse` at the answer.
- **Closed.** `/exit` fires `SessionEnd` with reason
  `prompt_input_exit`.
- **Closed.** An HTTP hook aimed at closed port 4199 prints a failure
  notice for each event. The settings snippet now uses command hooks.
- **Closed.** Liveness works: the key went off 15.4 seconds after
  `kill -9`.
- **Still open.** Amber after an approval has no early end. No hook and
  no mod event marks the approval.
- **Still open.** `StopFailure`, a `refusal` turn, a compact, and a
  resume are not observed.
- **Still open.** The mod is not observed in the desktop app or in an
  IDE extension.
