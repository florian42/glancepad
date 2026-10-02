# Claude Code mods as a session-state source

*Researched 2026-10-02 against Claude Code 2.1.287. Sources: the blog
post <https://claude.dev/blog/getting-started-with-claude-code-mods/>
(read through a summarizing fetch, so treat it as secondary), and the API
declaration file that Claude Code 2.1.287 writes for mod authors
(`claude-code.d.ts`, about 20 000 lines, generated locally by the
`plugin-authoring` skill). The declaration file is the primary source.
Its header says "EARLY ACCESS: this surface may change between releases
without notice." Line numbers are omitted because the file is regenerated
per build. Search it for the quoted name.*

[claude-code-session-signals.md](claude-code-session-signals.md) maps
the settings-hook events to slot statuses and lists six gaps. This note
asks one question: does a mod close any of those gaps?

## What a mod is

A mod is a plugin with a hooks module. The module exports
`register(on, options)`. Each `on(event, matcher?, hook)` call adds a
hook of the shape `($, e, next)`. The hook sees the event `e`, and calls
`next(e)` to let Claude Code continue. `$` is the only way out of the
module: it has no Node and no DOM. A mod installs like any plugin: from a
marketplace, with `claude --plugin-dir`, or with `CLAUDE_CODE_PLUGIN_DIRS`.

A mod sees every settings-hook event too, as `classic.<Event>` with the
same stdin payload (search `ClassicEventName`). So a mod can do anything a
settings hook can do here, plus the events below.

## Gap by gap

| Gap in the signals note | Mod event or API | Status |
|---|---|---|
| 1. Esc leaves a session blue | `turn.complete` carries `reason: 'answer' \| 'aborted' \| 'refusal' \| 'error'` and `isAborted` (search `TurnCompleteReason`) | **Closed.** Observed for SIGINT (below). Esc not yet observed. |
| 2. An approved tool stays amber | `tool.check` resolves the verdict `allow`, `ask`, or `deny` before the dialog. The dialog "is drawn by the engine alone" (search `RenderComponent`). No event marks the user's answer. | **Open.** A verdict of `ask` does not predict amber: in auto mode a classifier settles it with no dialog (observed below). `classic.PermissionRequest` is the amber signal. The end of amber is still `tool.call` returning. |
| 3. A manual denial may stay amber | If the denial ends the turn, `turn.complete` fires with some `reason`. Which one is not documented. | **Probably closed.** Needs a capture. |
| 4. A plain-text question shows green | `turn.complete` carries `answer`, the same text that `Stop` gives. | **Open.** Same as hooks. |
| 5. Nothing marks a session as read | `ui.focus` exists, but it moves focus between mod-drawn elements. It is not terminal focus. | **Open.** |
| 6. A crashed session never ends | `$.clock.every` runs a timer for the life of the module. A heartbeat over `$.http.fetch` lets glancepad expire a silent session. | **Closable** with a heartbeat. A settings hook cannot do this. |

## Delivery from a mod

`$.http.fetch(url, { method, body, socketPath })` goes "through the host"
to any http or https URL, or over a Unix socket (search `http: {`). So a
mod can post to the same `/hooks` endpoint that issue #5 plans for HTTP
hooks. A Unix socket avoids a TCP port. Order inside one mod is under our
control: the mod can await each post before it calls `next`, or it can
queue posts in sequence without blocking Claude.

A failed `fetch` rejects inside our own hook. The mod catches it, so
"glancepad is not running" can stay silent. The signals note leaves that
question open for HTTP hooks.

## Costs

- **API churn.** The surface is early access. Settings hooks are
  documented and stable.
- **Install friction.** A user installs a plugin. A settings hook is a
  few lines of JSON.
- **Coverage.** A mod runs only where function hooks load. Untested: the
  desktop app, the IDE extensions, and `claude -p` (the reference says
  `-p` "always loads fresh").
- **Licence.** None for us. We write our own module. The declaration file
  is Anthropic's and stays out of the repository, like the vendor
  material.

## Recommendation (opinion)

Keep the ingest seam independent of the source. Settings hooks and a mod
both deliver one normalized session event to one pure reducer. Ship
settings hooks first, because they are stable and cheap. Add a mod as an
optional upgrade for gaps 1 and 6, and maybe 3. The mod then sends only
the events that hooks cannot give (the interrupt and a heartbeat). It
does not re-send `classic.*`, so a user who installs both does not feed
the reducer twice.

## Observed behaviour

A probe mod, `glancepad-probe`, records `session.start`, `session.end`,
`turn.start`, `turn.complete`, `tool.check`, `tool.call` (before and
after `next`), and five `classic.*` events into
`/tmp/glancepad-mod-events.jsonl`. It lives in
[`scripts/mod-probe/`](../scripts/mod-probe/). Load it with
`claude --plugin-dir scripts/mod-probe`. On 2026-10-02 it ran in three headless sessions:
`claude -p --plugin-dir <probe> --model claude-haiku-4-5-20251001`,
Claude Code 2.1.287. The event order below is observed.

| Run | Events, in order |
|---|---|
| Allowed `Bash(echo:*)` | `session.start`, `turn.start`, `tool.call:before`, `tool.check` (`allow`), `tool.call:after`, `classic.Stop`, `turn.complete` (`answer`), `session.end` (`other`) |
| `Bash` with no allow rule | `session.start`, `turn.start`, `tool.call:before`, `tool.check` (`ask`), `classic.PermissionRequest`, `tool.call:after` (`isError`), `classic.Stop`, `turn.complete` (`answer`), `session.end` (`other`) |
| `sleep 30`, then SIGINT to the process | `session.start`, `turn.start`, `tool.call:before`, `tool.call:after` (`isError`), `turn.complete` (`aborted`, `isAborted: true`), `session.end` (`other`). **No `classic.Stop`.** |

What this settles:

- **An interrupt is visible to a mod.** The SIGINT run ended with
  `turn.complete` `aborted` and no `Stop`. That is gap 1's exact case. A
  settings hook sees nothing there. Esc in an interactive terminal is
  still unobserved, but the type contract names it as the same
  `aborted` reason.
- **`tool.call` brackets the permission decision.** The `before` record
  comes *before* `tool.check`. So "the hook entered `tool.call`" does not
  mean "the user approved". Gap 2 stays open for mods too.
- **`classic.PermissionRequest` fires headless.** With no one to ask,
  the call failed and the turn went on to an answer. A manual denial in a
  terminal may behave differently (gap 3). That needs an interactive
  capture.
- **`classic.Stop` fires before `turn.complete`.** A source that reads
  both must not count one turn end twice.

A second capture came from one interactive session in auto mode, with
hot reloading on (180 records, 2026-10-02):

- **`tool.check` answered `ask` for 35 `Bash` and 11 `Edit` calls, but
  no dialog appeared and no `classic.PermissionRequest` fired.** The
  auto-mode classifier settled every ask. So `ask` alone must not light
  amber. `PermissionRequest` is the signal that a person is asked.
- **A subagent's turn end reaches the parent's mod.** `turn.complete`
  fired with an `agentId` when a background subagent finished. A mod
  adapter must drop every event with an `agentId`, or a finished
  subagent marks the main session `unread`.
- **Subagent tool calls reach it too.** The parent's `tool.call` and
  `tool.check` hooks saw the subagents' calls. For lighting that is
  harmless, because they mean the session works.

Not explained: the SIGINT run has no `tool.check` record, although the
allow rule matched. The probe writes its whole log on each event, so a
lost write is possible. Treat the absence as unconfirmed.
