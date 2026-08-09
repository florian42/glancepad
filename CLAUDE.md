# codex-micro-claude-code-tui

Replicating the Codex Micro (OpenAI × Work Louder macro keypad) experience
for Claude Code: device lighting driven by Claude Code session state,
push-to-talk, and tap-to-open-session agent keys.

## Git workflow

Trunk-based development: commit directly to `main` and push to
`origin/main`. Do not open pull requests or create long-lived feature
branches. (When a session works in an isolated worktree, push its work
with `git push origin HEAD:main`.)

## Orientation

- `research/roadmap.md` — goal and feature priorities (lighting →
  push-to-talk → tap-to-open; slot assignment targets `recent` mode)
- `research/codex-micro-state-machines.md` — the ChatGPT behavior we
  replicate, with exact transitions and timing constants
- `research/codex-micro-agent-key-assignment.md` — how agent keys are
  assigned to threads
- `research/virtual-device-options.md` — why we build our own simulator,
  the recovered wire protocol, and the recommended seam
- `research/reference/` — extracted vendor type definitions. **Local only,
  git-ignored, never committed.** See "Third-party code" below.

## Working agreement

**Write in Simplified Technical English.** ASD-STE100 rules apply to
every reply and every document: active voice, one meaning per word,
simple tenses, one instruction per sentence. Keep procedural sentences to
20 words and descriptive sentences to 25. Keep the articles — write full
sentences, not telegraphic style. Code, paths, and tool output stay
verbatim.

**Be candid.** Say the shortest true thing. Challenge a weak assumption
instead of building on it, and mark each claim as verified (you ran it,
read it, or saw the device respond) or uncertain. Most of what this
project needs is reverse-engineered from a closed device — a guess in a
confident voice is the expensive failure here.

**Ground research in primary sources.** Prefer the device-kit type
definitions in `research/reference/`, vendor and Claude Code docs, and
observed device traffic over recollection. Link the evidence inline so
the next session can re-check it, and flag sources that are dated or
contradicted.

**Finish the whole ask.** Keep the original goal and constraints intact,
carry authorized work to the end, and verify the actual result before
reporting it done. Name whatever you could not verify — hardware behavior
with no keypad attached, for example.

**Decide, then ask.** Make routine calls yourself and state the
assumption you made. Ask when competing readings lead to materially
different work, when the action is risky, or when it needs approval.

**Use the skills; delegate sparingly.** Reach for a matching skill in
`.claude/skills/` before improvising a process. Spawn subagents for
genuinely independent work only, and synthesize their findings into your
own answer rather than relaying them.

**Keep changes small.** One concern per change. Reach for the concrete
implementation before the abstraction. Write tests that pin observable
behavior — HID frames sent, state transitions taken, timing constants
honored — and leave the implementation's shape untested.

**Validate in the real interface.** Substantial changes get a review
pass, and anything the user sees or the device does gets exercised for
real: run it against the keypad, or say plainly that you could not.

**Touch only what the task covers.** Leave unrelated work as you found
it. Firmware writes, publishing, and anything reaching a service outside
this machine need explicit authorization each time.

**Report signal.** Blockers, outcomes, and the evidence behind them.
Progress narration is not an outcome.

## Third-party code

**This repository will become public. It must contain no OpenAI or Work
Louder code.** `@worklouder/device-kit-oai` and `@worklouder/wl-device-kit`
are proprietary — "All Rights Reserved", private GitHub Packages feed, and
absent from public npm. We therefore speak the protocol ourselves.

The rules:

- Never commit vendor source, vendor type definitions, or files extracted
  from `app.asar`. `research/reference/` and `vendor-oracle/` stay
  git-ignored and local.
- Describe protocol facts in our own words, and cite where each fact
  lives. A byte layout is a fact. A copied file is not.
- Never add `@worklouder/*` as a dependency.
- Short quotations in research documents are acceptable. Wholesale copies
  are not.

**Enforcement — run this before every push.** Spawn a subagent with a
fresh context (do not fork the current one, because a fork inherits your
assumptions). Give it the diff you are about to push and one job: find
proprietary third-party content. Push only after it reports none. CI
repeats a blunt marker scan, but the subagent is the real gate.

## Agent skills

### Issue tracker

Issues live as GitHub issues in `florian42/codex-micro-claude-code-tui`,
driven by the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical triage roles, each label string equal to its name.
See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` and `docs/adr/` at the repo root.
See `docs/agents/domain.md`.
