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
