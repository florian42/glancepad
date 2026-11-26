# Claude Code session signals for key lighting

*Researched 2026-09-30 against Claude Code 2.1.285. Source: the hooks
reference, <https://code.claude.com/docs/en/hooks.md>, fetched the same
day. Line numbers below refer to that fetch and will drift. The event
table is documented behavior. An interactive session on Claude Code
2.1.332 was captured on 2026-11-26. See "Observed in an interactive
session" for what that capture confirms and what it changes.*

Roadmap priority 1 needs one slot status per Claude Code session (see
[codex-micro-state-machines.md](codex-micro-state-machines.md) §3). Claude
Code does not expose session state. It exposes hook **events**. So
glancepad must keep its own state per `session_id` and update it on each
event. This note maps events to statuses and names the gaps.

## Only amber and green need a clear signal

The device shows `awaiting-approval` and `awaiting-response` in the same
amber, `0xFF6D00`
([virtual-device-options.md](virtual-device-options.md), colour table).
A wrong choice between those two costs nothing. A wrong choice between
amber and `unread` green does cost something: the user reads "done" when
Claude waits, or the reverse.

## Map each event to a status

Every hook payload carries `session_id`, `transcript_path`, `cwd`, and
`hook_event_name` (hooks.md, "Common input fields").

| Event | Status after the event | Evidence |
|---|---|---|
| `SessionStart` | `idle`, and the session enters the list | `source` is `startup`, `resume`, `clear`, `compact`, or `fork` |
| `UserPromptSubmit` | `working`, and `unread` clears | fires when the user submits a prompt |
| `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `SubagentStart`, `SubagentStop` | `working` | activity inside a turn |
| `PreToolUse` with `tool_name` `AskUserQuestion` | `awaiting-response` | hooks.md:1846, "Claude calls `AskUserQuestion`. The `PreToolUse` hook fires." |
| `PermissionRequest` | `awaiting-approval` | hooks.md:1882, "Runs when Claude Code is about to ask you for permission to use a tool" |
| `Stop` | `unread` | hooks.md:2533, "Runs when the main Claude Code agent has finished responding" |
| `StopFailure` | `error` | hooks.md:2635, "Runs instead of Stop when the turn ends due to an API error" |
| `SessionEnd` | the session leaves the list, so its slot shows `off` | `reason` is `clear`, `resume`, `logout`, `prompt_input_exit`, or `other` |

Every event also updates the session's last-activity time. The `recent`
slot order sorts on that time.

Ignore `Notification`. Its `permission_prompt` type fires only "after the
prompt has waited about six seconds" (hooks.md:1885), and in a terminal
"you only see them when you appear to be away from the terminal"
(hooks.md:2284). `PermissionRequest` gives the same signal at once and
every time.

## Gaps that the events leave open

1. **Esc leaves a session blue.** `Stop` "does not run if the stoppage
   occurred due to a user interrupt" (hooks.md:2533). No other event marks
   an interrupt. The session stays `working` until the next prompt.
   **Observed, and open for hooks.** No hook fired after Esc. The
   optional mod closes this gap.
2. **An approved tool stays amber until it finishes.** No event fires when
   the user answers a permission prompt. After an approval, the next
   event is `PostToolUse`, which fires only when the tool completes. A
   long `Bash` command therefore shows amber for its whole run.
   **Observed, and open.** Amber lasted 6.2 seconds after the approval
   of a 6 second command. No source closes this gap.
3. **A denial may leave the session amber.** `PermissionDenied` fires in
   auto mode only. It "doesn't run when you manually deny a permission
   dialog". If a manual denial ends the turn the same way Esc does, no
   event follows at all. **Observed, and open for hooks.** A manual
   denial ends the turn, and no hook fires after `PermissionRequest`.
   The optional mod closes this gap.
4. **A question in plain text shows green.** `Stop` carries
   `last_assistant_message`, the text of the final reply. No field says
   whether Claude asked a question or finished. Parsing the text for a
   question mark is a guess, so glancepad does not do it. Questions asked
   with `AskUserQuestion` do show amber, per the table above.
5. **Nothing marks a session as read.** ChatGPT clears `unread` when you
   look at the thread. Claude Code sends no focus or view event. Decision
   for now: `unread` stays until the next prompt, the session ends, or
   the user taps the agent key (roadmap priority 3). The tap is
   implemented: see [session-window-handle.md](session-window-handle.md).
6. **A crashed session never sends `SessionEnd`.** Its slot would stay lit
   forever. Liveness needs a check outside the hooks. Candidates are the
   parent process ID of the hook command, and the modification time of
   `transcript_path`. Neither is tested.

Gaps 1 and 3 have one possible fix. `transcript_path` points at the
session transcript, and an interrupt may leave a marker there. The docs
warn that the transcript "is written asynchronously and may lag the
in-memory conversation", and its format is undocumented. Capture first,
then decide.

A Claude Code mod sees interrupts directly. See
[claude-code-mods-as-state-source.md](claude-code-mods-as-state-source.md).

## Deliver events with a command hook

`scripts/glancepad.settings.json` registers one command hook per event.
The command pipes the event JSON to `curl`, which posts it to
`http://127.0.0.1:4180/events`. The command ends in `|| true`, and
`curl` has a 2 second limit.

A `type: "http"` hook needs no process, but it is not usable. The docs
call a connection failure a "non-blocking error, execution continues"
(hooks.md:904). That is true, and incomplete. **Observed on 2.1.332:
each event prints a failure notice in the transcript when nothing
listens on the port.** The capture aimed the hooks at closed port 4199:

| Event | Notice in the transcript |
|---|---|
| `UserPromptSubmit` | `UserPromptSubmit hook failed`, then `connect ECONNREFUSED 127.0.0.1:4199` |
| `PreToolUse`, `PostToolUse` | `PreToolUse:Bash hook failed` and `PostToolUse:Bash hook failed`, each with the same second line |
| `Stop` | `Ran 1 stop hook`, `Stop hook failed`, and a `stop hook problem` line above the prompt |
| `SessionEnd` | `SessionEnd hook [http://127.0.0.1:4199/events] failed: connect ECONNREFUSED 127.0.0.1:4199`, printed after exit |

The same session with the command hook, and nothing on port 4180,
printed no notice (observed, one prompt, one approved `Bash` call, and
`/exit`).

The hook is synchronous, not `async: true`. A synchronous hook holds
Claude until the command returns, so events arrive in firing order.
That order is an inference, not a documented guarantee. The cost is one
`curl` process per event. The command returns in about 10 ms when the
port is closed (measured with the shell, outside Claude Code). The
latency inside a tool call is not measured.

## Observed in an interactive session

One session ran on 2026-11-26 with Claude Code 2.1.332, Haiku 4.5, and
permission mode `default`. An agent drove it through a pseudo-terminal
and recorded the time of each key. The session loaded
`scripts/capture-hooks.settings.json` and `scripts/mod-probe`. The mod
side of each row is in
[claude-code-mods-as-state-source.md](claude-code-mods-as-state-source.md).

| Action | Hook events, in order | Status that hooks alone give |
|---|---|---|
| Plain prompt | `UserPromptSubmit`, `Stop` | `unread`. Correct. |
| Esc while the answer streams | `UserPromptSubmit`, then nothing | `working` until the next prompt. Gap 1. |
| `Bash`, approved in the dialog | `UserPromptSubmit`, `PreToolUse`, `PermissionRequest` (+0.1 s), `Notification` `permission_prompt` (+6.0 s), `PostToolUse`, `Stop` | Amber from the request to `PostToolUse`. Gap 2. |
| `Bash`, denied with "No" | `UserPromptSubmit`, `PreToolUse`, `PermissionRequest`, then nothing | Amber until the next prompt. Gap 3. |
| `Bash`, Esc at the dialog | The same as a denial | Amber until the next prompt. Gap 3. |
| `Bash`, approved, then Esc while it ran | `UserPromptSubmit`, `PreToolUse`, `PermissionRequest`, then nothing | Amber until the next prompt. Gaps 1 and 2 together. |
| `AskUserQuestion`, answered | `UserPromptSubmit`, `PreToolUse`, `PermissionRequest` with `tool_name` `AskUserQuestion` (+0.1 s), `Notification` (+6.0 s), `PostToolUse` at the answer, `Stop` | Amber, then `working`, then `unread`. Correct. |
| `/exit` | `SessionEnd` with `reason` `prompt_input_exit` | `off`. Correct. |

What this settles:

- **Gap 2, measured.** The approved command was `sleep 6 && touch
  approved.txt`. `PermissionRequest` fired at 0.0 s. The approval key
  went in at 8.4 s. `PostToolUse` fired at 14.5 s. Amber therefore
  lasted 6.2 seconds after the approval, which is the run time of the
  command. No event marks the approval.
- **A denial sends no `PostToolUseFailure`, no `PermissionDenied`, and
  no `Stop`.** The screen shows "Interrupted". With hooks alone, the key
  stays amber.
- **`AskUserQuestion` fires `PermissionRequest` too.** The session goes
  `awaiting-response`, then `awaiting-approval`. Both are amber, so
  the order does not matter.
- **A `SubagentStop` can arrive after `Stop`.** It came 3 to 6 seconds
  after two of the `Stop` events, with an empty `agent_type` and no
  `SubagentStart`. The cause is not known. The reducer ignores activity
  outside a turn, so the key stays green.

Not observed: `StopFailure`, `PermissionDenied`, a compact, a resume,
and a real subagent.

## Capture real payloads

`scripts/capture-hooks.mjs` appends every event it receives to a JSONL
file. `scripts/capture-hooks.settings.json` registers it for every event
in the table, plus `Notification`, `PermissionDenied`, `PreCompact`, and
`PostCompact`. The settings load only for the session that asks for them:

```sh
claude --settings scripts/capture-hooks.settings.json
jq -c '[.at, .payload.hook_event_name, .payload.tool_name // .payload.notification_type // .payload.source // .payload.reason // ""]' /tmp/glancepad-hooks.jsonl
```

The hook command reads `${CLAUDE_PROJECT_DIR}`, so start the session in
this repository, or replace that variable with an absolute path.

This script ran on 2026-11-26. It settles gaps 1, 2, and 3:

1. Send a prompt and let it finish. Expect `UserPromptSubmit`, then `Stop`.
2. Send a prompt, then press Esc while it works.
3. Ask for a `Bash` command, and approve it.
4. Ask for a `Bash` command, and deny it.
5. Ask Claude to use `AskUserQuestion`, and answer it.
6. Exit with `/exit`.
