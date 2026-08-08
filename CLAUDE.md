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
- `research/reference/` — extracted `@worklouder/device-kit-oai` device
  protocol type definitions (JSON-RPC over HID/serial)

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
