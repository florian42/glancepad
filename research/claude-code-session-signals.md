# Claude Code session signals for key lighting

*Researched 2026-09-30 against Claude Code 2.1.285. Source: the hooks
reference, <https://code.claude.com/docs/en/hooks.md>, fetched the same
day. Line numbers below refer to that fetch and will drift. No live
session was captured yet. Every row is documented behavior, not observed
behavior, until the probe in "Capture real payloads" runs.*

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
2. **An approved tool stays amber until it finishes.** No event fires when
   the user answers a permission prompt. After an approval, the next
   event is `PostToolUse`, which fires only when the tool completes. A
   long `Bash` command therefore shows amber for its whole run.
3. **A denial may leave the session amber.** `PermissionDenied` fires in
   auto mode only. It "doesn't run when you manually deny a permission
   dialog". If a manual denial ends the turn the same way Esc does, no
   event follows at all. This is unverified.
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

## Deliver events with an HTTP hook

A `type: "http"` hook posts the event JSON to a URL, so glancepad needs no
hook script. A connection failure is a "non-blocking error, execution
continues" (hooks.md:904). A synchronous hook holds Claude until the POST
returns, so events should arrive in firing order. The state machine
depends on that order. This is an inference, not a documented guarantee.

The alternative is a command hook with `async: true`. It never blocks
Claude, but each event starts a separate process, and nothing guarantees
that those processes deliver in order.

Two facts are still open. First, does a connection failure print a
`hook error` notice in the transcript when glancepad is not running? A
notice on every event would make the HTTP hook unusable. Second, how much
latency does a synchronous local POST add to each tool call?

## Capture real payloads

`scripts/capture-hooks.mjs` appends every event it receives to a JSONL
file. `scripts/capture-hooks.settings.json` registers it for every event
in the table, plus `Notification`, `PermissionDenied`, `PreCompact`, and
`PostCompact`. The settings load only for the session that asks for them:

```sh
claude --settings scripts/capture-hooks.settings.json
jq -c '[.at, .payload.hook_event_name, .payload.tool_name // .payload.notification_type // .payload.source // .payload.reason // ""]' /tmp/glancepad-hooks.jsonl
```

Run this script in one interactive session. It settles gaps 1, 2, and 3:

1. Send a prompt and let it finish. Expect `UserPromptSubmit`, then `Stop`.
2. Send a prompt, then press Esc while it works.
3. Ask for a `Bash` command, and approve it.
4. Ask for a `Bash` command, and deny it.
5. Ask Claude to use `AskUserQuestion`, and answer it.
6. Exit with `/exit`.
