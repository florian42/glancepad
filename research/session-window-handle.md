# The handle from a session to its window

Issue 12 needs to bring a Claude Code session to the front. This note
records what a session can report about its window, and how glancepad
turns that into a focus command. All experiments ran on 2026-11-26, on
Arch Linux with Hyprland 0.57.2 (Lua configuration), kitty, ghostty,
and Claude Code 2.1.332.

## Result

A `SessionStart` command hook sends `$PPID` in the `x-glancepad-pid`
request header. That number is the process id of the `claude` process.
On a tap, glancepad reads the parent chain of that process from
`/proc`, and takes the first process id that owns a Hyprland window.
The hook sends nothing else. The request body stays the hook payload,
and the adapter in `src/sessions/hooks.ts` reads the same fields as
before.

## What a `SessionStart` command hook sees

Verified. A probe hook wrote its environment and its parent chain to a
file. The session ran as `kitty --detach ... claude --settings ...`.

| Item | Value in the probe |
|---|---|
| Payload keys | `cwd`, `hook_event_name`, `model`, `scratchpad_dir`, `session_id`, `source`, `transcript_path` |
| `$PPID` of the hook shell | the `claude` process |
| Parent of `claude` | the `kitty` process. A shell sits between them when the user starts `claude` from a prompt. |
| `KITTY_WINDOW_ID` | `1`. This is the id of the kitty window inside kitty. It is not a compositor id. |
| `KITTY_PID` | the `kitty` process id |
| `HYPRLAND_INSTANCE_SIGNATURE` | set, inherited from the terminal |
| `WINDOWID`, `TMUX_PANE`, `KITTY_LISTEN_ON` | not set |
| `tty` | `not a tty`. The hook has no terminal on its standard input. |

The payload has no terminal name and no window id. This confirms the
risk that issue 12 names: an HTTP hook cannot identify the window. So
`SessionStart` stays a command hook. The other events can stay HTTP
hooks.

## From a process id to a window

Verified. `hyprctl clients -j` lists each window with an `address` and
a `pid`. The `pid` of the probe window was equal to the `kitty` process
id from the parent chain. A ghostty window that was started from a
command line had its own process, and its `pid` matched in the same
way.

The focus command depends on the configuration language of Hyprland:

| Configuration | Command | Status |
|---|---|---|
| Lua | `hyprctl dispatch 'hl.dsp.focus({ window = "address:0x…" })'` | verified, the focus moved |
| hyprlang | `hyprctl dispatch focuswindow address:0x…` | fails on this machine with a Lua parse error. Not verified on a hyprlang configuration. |

glancepad sends the Lua form first. It sends the hyprlang form when the
first form does not print `ok`.

`hyprctl` exit codes are not a reliable signal. Verified: the Lua form
with an unknown address prints `warning: … window not found` and exits
with 0. glancepad accepts only the text `ok`.

Not verified: a focus on a window on a different workspace. In both
end-to-end runs the two windows were on one workspace.

## Limits

- **One process with two windows.** A process id cannot tell two
  windows of one process apart. kitty can open more OS windows in one
  process, and ghostty can do the same. glancepad then takes the first
  window in the client list. This case is not tested. A fix for kitty
  can use `KITTY_WINDOW_ID` with kitty remote control.
- **Tabs and splits.** The focus goes to the terminal window. It does
  not select the tab or the split that holds the session. Not tested.
- **tmux.** The parent chain of a session inside tmux ends at the tmux
  server, not at a terminal. glancepad will find no window. `tmux` is
  not installed on the test machine, so this is an inference.
- **Sessions without the header.** A session that reports through the
  mod only, or through HTTP hooks only, has no process id. A tap marks
  it as read and logs one line. It moves no focus.
- **Process id reuse.** glancepad drops the process id when the session
  ends. A crashed session keeps its entry, and its process id can
  belong to a different process later.
- **Other window systems.** Only Hyprland has an implementation. The
  seam is `WindowFocuser` in `src/focus/focuser.ts`.
- **The physical keypad.** The end-to-end check used the simulator. No
  test ran on the keypad.

## Challenge to the plan

The plan was a process id chain "captured by a command hook". The hook
captures one process id, and glancepad reads the chain at tap time.
This keeps the hook to one `curl` call with no JSON tool, and the chain
is the same at both times because a process keeps its parent while the
parent lives.

The plan also named `hyprctl dispatch focuswindow`. That form does not
work on a Lua configuration, see the table above.
