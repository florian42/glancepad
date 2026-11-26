# Claude Desktop sessions: hooks, the session handle, and dictation

Date: 2026-11-26. Tracking issues: 11 (microphone key) and 12 (agent
key). Machine: Arch Linux, Hyprland on Wayland with a Lua
configuration, Claude Desktop 6.28899.2 (package `claude-desktop`),
which starts its own Claude Code 2.1.328. The terminal `claude` on the
same machine is 2.1.332.

Each claim has a mark: **verified** (we ran it or read it on this
machine), **documented** (the vendor documentation says it), or
**uncertain**.

## 1. Hooks in a Claude Desktop session

**Verified: the app starts one `claude` process for each session.**
The process chain of a session in the Code tab was: tool shell →
`claude` → a small helper of the app → `claude-desktop`. The
`claude-desktop` process owns the one Hyprland window, class
`com.anthropic.Claude`.

**Verified: the app passes `--setting-sources=user,project,local`.**
We read this from `/proc/<pid>/cmdline` of a session process. Thus the
user settings file `~/.claude/settings.json` applies to a Claude
Desktop session.

**Verified: the app passes `--project-config-root <main checkout>`
for a session in a git worktree.** With this flag, a
`.claude/settings.local.json` file in the worktree does not apply. The
experiment used the `claude` binary of the app, in a worktree, in
print mode, with a probe hook in the local settings of the worktree:

| Flags | Probe hook |
|---|---|
| `--setting-sources=user,project,local` | fired (`SessionStart`, `UserPromptSubmit`, `Stop`) |
| the same, plus `--project-config-root <main checkout>` | did not fire |
| the same, plus hooks in `--settings '<json>'` | fired |

A settings file that appears after the start of a session did not
apply to that session either.

**Verified: plugin hooks fire in a session that the app started.** The
transcript of such a session contains three `SessionStart` hook
records.

**Not verified: a hook from `~/.claude/settings.json` in a session
that the app started.** We did not change the user settings file. The
flag above and the print-mode runs make this very probable. The first
session after `pnpm hooks:install` confirms it.

**Consequence.** The user settings file is the correct place. It is
the only file that applies to all sessions, in all projects and all
worktrees. `pnpm hooks:install` (`scripts/install-hooks.mjs`) merges
the hooks into that file.

### Payload and environment

**Verified, from the print-mode runs with the binary of the app.**
The payload keys are the same as for a terminal session:

- `SessionStart`: `session_id`, `transcript_path`, `cwd`,
  `scratchpad_dir`, `hook_event_name`, `source`.
- `UserPromptSubmit` adds `prompt_id`, `permission_mode`, `prompt`.
- `Stop` adds `effort`, `stop_hook_active`, `last_assistant_message`,
  `background_tasks`, `session_crons`.

No payload key contains the app session id. `session_id` is the Claude
Code session id, a different value.

The hook process receives the environment of the `claude` process.
These variables were in the hook environment: `CLAUDECODE`,
`CLAUDE_CODE_ENTRYPOINT=claude-desktop`, `CLAUDE_CODE_SESSION_ID`,
`CLAUDE_PID`, `CLAUDE_PROJECT_DIR`, `CLAUDE_CODE_DESKTOP_APP_VERSION`.
`$PPID` of the hook was the `claude` process. `CLAUDE_PROJECT_DIR` was
the main checkout when `--project-config-root` was set.

## 2. The per-session handle

**Verified: the app session id is `local_<uuid>`, and three places
contain it.**

1. The environment of the session process:
   `CLAUDE_CODE_HOST_SESSION_ID=local_<uuid>`. We read it in a tool
   shell of a real session. We removed it for the print-mode runs, so
   a hook did not show it directly. A hook receives the same
   environment as a tool shell, so the hook sends
   `${CLAUDE_CODE_HOST_SESSION_ID:-}`. **Uncertain** until one real
   session confirms it; the second place covers a failure.
2. The session record `~/.claude/sessions/<pid>.json`, which each
   `claude` process writes. For a session of the app it has
   `"entrypoint": "claude-desktop"` and `"hostSessionId":
   "local_<uuid>"`, beside `sessionId` (the Claude Code session id)
   and `pid`. Seven records of live sessions had this layout.
3. The store of the app,
   `~/.config/Claude/claude-code-sessions/<account>/<organization>/local_<uuid>.json`,
   which has `sessionId` (the app id) and `cliSessionId`. glancepad
   does not read this file.

**Verified: the link `claude://claude.ai/epitaxy/local_<uuid>` selects
the session.** `xdg-open <link>` exited with 0 in less than 2 seconds,
and the window layout of the app then showed that session in the main
pane. The scheme handler is `claude-desktop %U`
(`xdg-mime query default x-scheme-handler/claude`). The link is not in
the vendor documentation; the app itself gives it for each session.

**Verified: the link does not focus the window on Hyprland.** With a
terminal window active on a different workspace, the link changed the
session, and `hyprctl activewindow -j` still showed the terminal.
`misc:focus_on_activate` is `false` here. A Hyprland focus is
necessary also.

**Verified: the old process path focuses the app window only.** The
parent chain of a session process ends at `claude-desktop`, which
Hyprland lists. This explains the hardware check of issue 12: the
focus call succeeded, wrote no failure line, and selected no session.

### Implementation

`WindowFocuser` in `src/focus/focuser.ts` has a second method,
`focusDesktopSession(hostSessionId, pid)`. The Hyprland
implementation opens the link, then focuses the window that it finds
from the process chain, or from the class `com.anthropic.Claude`.
`src/ui/server.ts` reads the `x-glancepad-host-session` header. When
the header is absent, it reads the session record of the reported
process (`readHostSessionId` in `src/focus/desktop.ts`). The id must
match `local_<uuid>` exactly, because it goes into a link.

### End-to-end check

`pnpm keypad` on port 4197, physical keypad connected. Two real
sessions of the app were reported: one through the hook command of
`scripts/glancepad.settings.json` run from a tool shell of that
session (header path), one with a process id only (record path). Key
events went through the WebSocket path of the simulator page.

| Step | `hyprctl activewindow -j` | Session in the main pane of the app |
|---|---|---|
| Focus a ghostty window, workspace 2 | `com.mitchellh.ghostty` | session P |
| Press `AG01` (header path, session S) | `com.anthropic.Claude`, workspace 6 | session S |
| Focus the ghostty window again | `com.mitchellh.ghostty` | session S |
| Press `AG00` (record path, session P) | `com.anthropic.Claude` | session P |
| Press `AG03` (empty key) | no change | no change |

The server wrote no `focus failed` line.

**Not verified:** a press on the physical agent keys; a session in a
pop-out window or a split view; a session whose process the app
stopped (the record file is then gone, and only a header that came
earlier can help); a window system other than Hyprland; the terminal
path after this change in a real terminal (unit tests only).

## 3. Dictation in Claude Desktop on Linux

**Documented: the Linux desktop app has no voice input.**
[Claude Desktop on Linux](https://code.claude.com/docs/en/desktop-linux),
read on 2026-11-26: "voice input isn't available in the Linux desktop
app." The same page supports Debian-based distributions only; this
machine runs an Arch package.

**Documented: the system-wide dictation shortcut is for macOS only.**
[Use Quick Entry with Claude Desktop on Mac](https://support.claude.com/en/articles/12626668-use-quick-entry-with-claude-desktop-on-mac)
describes a Caps Lock toggle, disabled by default.

**Documented: no deep link starts dictation.** The documented links
are `claude://code/new`
([Desktop](https://code.claude.com/docs/en/desktop)) and
`claude-cli://open`
([deep links](https://code.claude.com/docs/en/deep-links)). They have
no voice parameter.

**Uncertain: what the installed app contains.** Strings in the
installed app bundle show a preference for a dictation shortcut and a
hold-a-key dictation mode with a native key listener. We did not find
a setting for them on this machine, and we could not see whether the
account or the platform enables them. We did not test a key sent with
`hyprctl dispatch sendshortcut`, because no documented key exists to
send and the session had no microphone.

**Conclusion.** No second process can start dictation in a Claude
Desktop session on Linux by a documented way. The nearest alternatives:

1. A Claude Code session in a terminal, with `/voice tap` and a chord
   for `voice:pushToTalk`
   ([voice dictation](https://code.claude.com/docs/en/voice-dictation)).
   The README has the example. It is still not tested with a
   microphone.
2. A system dictation tool that types into the focused window, with a
   start command and a stop command in `GLANCEPAD_TALK_START` and
   `GLANCEPAD_TALK_STOP`. It then works in the composer of the app
   also. We tested no such tool.

**The owner can confirm one thing:** whether the composer of the Code
tab shows a microphone button on this machine. If it does, the
documentation is out of date, and the question opens again.
