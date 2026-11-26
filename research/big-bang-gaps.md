# Big-bang gaps

*Written 2026-10-03.*

Verified means the source states the claim. Uncertain means no source
states the live result. Issues 5, 6, and 10 are outside this list.
The interactive section was updated on 2026-11-26.

## Physical keypad

*Answered 2026-11-26 with one keypad on Linux. The evidence is in
`docs/protocol.md` §11.*

`HidTransport` (`src/device/hidtransport.ts`) now drives the keypad.
`pnpm keypad` starts hardware mode. `udev/70-glancepad.rules` is the
udev rule.

- **Verified by a person.** The six agent keys showed the colors that
  the host sent, after a second look. The first answer was "wrong or
  missing colors" with no detail.
- **Verified.** The transport opened the keypad at vendor id `0x303A`,
  product id `0x8360`, and usage page `0xFF00`.
- **Verified.** After an unplug and a replug, the transport opened the
  keypad again and sent the lighting again. The keypad answered `ok`,
  and a person saw the scene return.
- **Verified.** Linux opened the keypad without root, with the udev
  rule installed.
- **Verified.** The keypad answers `{"result":{"ok":1},"id":N,"method":M}`
  to a lighting request.
- **Verified.** After a message that stops mid-way, the keypad drops
  the part after 5.0 seconds of silence. The next message then works.
  A message that arrives earlier is lost.
- **Uncertain.** No real write has failed mid-message. The host rule
  (5.5 seconds of silence, then both lighting calls) rests on the
  measurement above and on tests with a fake keypad.
- **Uncertain.** What the keypad shows after a replug with no host is
  unread. One report of a person and our log disagree.
- **Uncertain.** The breath period is not measured. A person saw one
  breath take 2 seconds or more at speed 0.4.
- **Uncertain.** The snake shape is not described. A person saw a blue
  segment move around the ring.
- **Uncertain.** The LED count is unread. The keypad answers `ok` to
  each slot id, so no reply tells the count.

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
