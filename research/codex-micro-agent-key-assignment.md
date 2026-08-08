# Codex Micro — How ChatGPT Assigns Threads to Agent Keys

*Reverse-engineered 2026-08-08 from `codex-micro-slot-signals`,
`app-initial` (attention/priority atoms), and `src-*` (settings defaults)
of ChatGPT desktop v26.803.5235.0. Companion to
[codex-micro-state-machines.md](codex-micro-state-machines.md).*

## The agent-source setting

Setting `codex-micro-agent-source`, values
`pinned | recent | priority | custom` — **default `recent`**. The six
slots `AG00…AG05` are filled from the chosen source, always `slice(0, 6)`,
slot order = source order (AG00 gets the first entry).

## Source: `recent` (default)

1. Take the sidebar's unpinned thread keys, pinned thread keys, and
   pinned-project thread keys; concatenate and de-duplicate.
2. Sort by per-thread `updatedAt` (most recent first).
3. First six → AG00…AG05.

Nothing pins a thread to a key: **assignments reshuffle whenever recency
order changes** (a new message moves that chat toward AG00). Only the
serialized-payload diff prevents redundant lighting pushes; there is no
hysteresis or slot stickiness.

## Source: `pinned`

Pinned chats and pinned project groups, flattened in the user's pin order
(respecting the manual pinned ordering / `pinnedSortMode`), project groups
contributing their thread lists inline; first six. Stable as long as pins
don't change — this is the "I choose my six agents" mode without per-key
assignment.

## Source: `priority`

Threads are ranked by an **attention state** computed per thread, then by
recency:

```
rank: waiting (0)  >  unread (1)  >  active (2)  >  idle (3)
sort: rank ascending, then recencyAt descending
take: first six
```

### Attention-state derivation (per thread)

```
LOCAL thread:
  no runtime yet (pending worktree entry):
      needsAttention          → waiting
      phase is active-ish     → active
      else                    → idle
  runtime exists, conversation live:
      pending chip (approval OR response) → waiting
      unread flag                          → unread
      status === "loading"                 → active
      else                                 → idle
  runtime exists, conversation not live:
      unread flag                          → unread
      threadRuntimeStatus === "active"     → active
      else                                 → idle

REMOTE (cloud) task:
      unread flag                          → unread
      turn_status pending | in_progress    → active
      else                                 → idle
```

An adjuster applies when mixing with the sidebar's unread set:
`state === "waiting" || !hasUnread ? state : "unread"` — i.e. any
non-waiting thread with unread messages is promoted to `unread` rank.

Net effect: keys fill with *"needs my decision"* first (approvals,
questions), then *"has news I haven't seen"*, then *"currently running"*,
then recent idle chats. Within each class, most recent first. Like
`recent`, this reshuffles live as states change.

## Source: `custom`

Persisted assignment map (`codex-micro-custom-agent-assignments`):

```ts
{ AG00: Entry|null, ..., AG05: Entry|null }
Entry = { hostId, threadKey, title }          // a conversation
      | { type: "command", commandId }        // an action key
      | { type: "skill", skillName, skillPath }
      | { type: "keycap", keycapId }          // act like a physical keycap
```

Rules found in code:

- **One slot per thread**: assigning a thread that already sits on another
  key nulls the old key first (dedup by `threadKey` + `hostId`).
- **Assign-by-press flow**: pressing an *empty* agent key while in custom
  mode stores a pending marker `{agentKeyId, clientThreadId}` for the
  current conversation; once the conversation has a server id, the pending
  marker resolves into a full `{hostId, threadKey, title}` assignment
  (and is discarded if it no longer matches). So "press an unlit key to
  pin the current chat there".
- Action entries light `idle` (steady white) and show the command/skill
  name as the slot title; they never participate in tap-to-navigate and
  fire on every press (no double-tap arming, see state-machines §4).
- Threads assigned in custom mode that are missing from the thread list
  are still displayed with their stored title (so a key keeps its label
  even before the thread loads).
- On every agent-key tap in custom mode, if the tapped thread matches the
  key's stored assignment, the app re-applies the assignment's stored
  `hostId` for that thread — custom entries remember *which host* (e.g.
  local machine) a conversation belongs to and route the open
  accordingly.

## Slot payload assembly (all sources)

For each of the six keys: resolve the thread, compute status via the slot
status machine (state-machines §3), mark `selected` if it is the currently
open thread, and suppress `unread` → `idle` when that thread is selected
in a focused window. Unassigned keys are
`{threadKey: null, status: "off"}`.

## Default hardware layout (for completeness)

| Control | Default |
|---|---|
| ACT06 | keycap `FAST` (Toggle Fast mode) |
| ACT07 | keycap `APPR` (Approve) |
| ACT08 | keycap `REJ` (Reject) |
| ACT09 | keycap `SPLIT` |
| ACT10 | keycap `MIC1`; merged mode `ACT10_ACT11` = `MIC` (push-to-talk) |
| ACT11 | keycap `EMPT1` (empty; only active with `separateMicrophoneKeys`) |
| ACT12 | keycap `CODEX` |
| Stick up / right / down / left | `composer.togglePlanMode` / `navigateForward` / `toggleSidebar` / `navigateBack` |
| Encoder mode | `composer-navigation` (custom mappings all null) |
| Voice button mode | `push-to-talk` |

## Mapping notes for the Claude Code replica

- The four sources translate directly: `recent` = recently active Claude
  Code sessions; `priority` = rank by (awaiting-permission >
  unread-result > running > idle) then recency; `custom` = user-pinned
  session-per-key with the same one-slot-per-session dedup.
- Claude Code equivalents of the attention inputs: "waiting" ≈ permission
  prompt / AskUserQuestion pending; "active" ≈ agent turn in progress;
  "unread" ≈ session finished a turn the user hasn't viewed since.
- Expect and embrace the reshuffling behavior in recent/priority modes —
  ChatGPT ships no slot stickiness; the LED diff layer is what keeps the
  device calm.
