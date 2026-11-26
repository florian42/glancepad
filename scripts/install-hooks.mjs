#!/usr/bin/env node
// Merges the glancepad hooks into a Claude Code settings file.
//
//   node scripts/install-hooks.mjs            install into the user settings
//   node scripts/install-hooks.mjs --remove   remove the glancepad hooks
//   node scripts/install-hooks.mjs <file>     use a different settings file
//
// The user settings file applies to terminal sessions and to Claude
// Desktop sessions. A session reads it at its start.
// The script keeps all other settings and all other hooks. It writes
// a copy of the old file to <file>.glancepad-backup first.

import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Each glancepad hook command sends this header.
const MARKER = "x-glancepad-pid";

const args = process.argv.slice(2);
const remove = args.includes("--remove");
const target =
  args.find((arg) => !arg.startsWith("--")) ??
  join(
    process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude"),
    "settings.json",
  );
const source = join(
  dirname(fileURLToPath(import.meta.url)),
  "glancepad.settings.json",
);

const ours = JSON.parse(readFileSync(source, "utf8")).hooks;
const settings = existsSync(target)
  ? JSON.parse(readFileSync(target, "utf8"))
  : {};
if (existsSync(target)) copyFileSync(target, `${target}.glancepad-backup`);

const isOurs = (group) =>
  (group.hooks ?? []).some((hook) =>
    String(hook.command ?? "").includes(MARKER),
  );

const hooks = { ...(settings.hooks ?? {}) };
// Remove the old glancepad entries first, so a second run adds nothing twice.
for (const event of Object.keys(hooks)) {
  hooks[event] = hooks[event].filter((group) => !isOurs(group));
  if (hooks[event].length === 0) delete hooks[event];
}
if (!remove) {
  for (const [event, groups] of Object.entries(ours)) {
    hooks[event] = [...(hooks[event] ?? []), ...groups];
  }
}
if (Object.keys(hooks).length === 0) delete settings.hooks;
else settings.hooks = hooks;

writeFileSync(target, `${JSON.stringify(settings, null, 2)}\n`);
console.log(
  `${remove ? "removed the glancepad hooks from" : "installed the glancepad hooks into"} ${target}`,
);
console.log(
  "Sessions read the file at their start. Start a new session to see the effect.",
);
