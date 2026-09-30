#!/usr/bin/env node
// A Claude Code hook that appends every event it receives to a JSONL log.
// It records what a real session emits, so research/claude-code-session-signals.md
// can cite observed payloads instead of documentation alone.
//
// Use: claude --settings scripts/capture-hooks.settings.json
// Log: $GLANCEPAD_HOOK_LOG, default /tmp/glancepad-hooks.jsonl

import { appendFileSync } from "node:fs";

const log = process.env.GLANCEPAD_HOOK_LOG ?? "/tmp/glancepad-hooks.jsonl";

let input = "";
for await (const chunk of process.stdin) input += chunk;

appendFileSync(
  log,
  `${JSON.stringify({ at: new Date().toISOString(), payload: JSON.parse(input) })}\n`,
);
