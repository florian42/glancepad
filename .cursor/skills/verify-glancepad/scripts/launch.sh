#!/usr/bin/env bash
# Starts pnpm sim in its own process and writes the run file.

set -euo pipefail

ROOT=$(cd "$(dirname "$0")" && pwd)
while [[ "$ROOT" != "/" && ! -f "$ROOT/package.json" ]]; do
  ROOT=$(dirname "$ROOT")
done
if [[ ! -f "$ROOT/package.json" ]]; then
  echo "launch: package.json not found" >&2
  exit 1
fi

RUN_FILE=${GLANCEPAD_RUN_FILE:-/tmp/glancepad-verify-run.json}
PORT=${GLANCEPAD_PORT:-4180}
EVIDENCE=${GLANCEPAD_EVIDENCE:-/tmp/glancepad-verify/$(date -u +%Y%m%dT%H%M%SZ)}

mkdir -p "$EVIDENCE"

listener_pids() {
  lsof -nP -iTCP:"$1" -sTCP:LISTEN -t 2>/dev/null || true
}

if [[ -n "$(listener_pids "$PORT")" ]]; then
  echo "launch: port ${PORT} is already in use." >&2
  echo "launch: set GLANCEPAD_PORT to a free port and run launch again." >&2
  exit 1
fi

GIT=$(git -C "$ROOT" rev-parse HEAD)
LOG="$EVIDENCE/sim.log"
: >"$LOG"

cd "$ROOT"
nohup pnpm sim >"$LOG" 2>&1 &
PID=$!

export EVIDENCE PORT PID GIT LOG RUN_FILE ROOT
node --input-type=module <<'NODE'
import { writeFileSync } from "node:fs";
const run = {
  pid: Number(process.env.PID),
  port: Number(process.env.PORT),
  cwd: process.env.ROOT,
  git: process.env.GIT,
  evidence: process.env.EVIDENCE,
  log: process.env.LOG,
  listenerPid: null,
};
const text = `${JSON.stringify(run, null, 2)}\n`;
writeFileSync(process.env.RUN_FILE, text);
writeFileSync(`${process.env.EVIDENCE}/run.json`, text);
NODE

ready=0
for _ in $(seq 1 100); do
  if grep -q "glancepad simulator  http://localhost:${PORT}/" "$LOG"; then
    ready=1
    break
  fi
  if ! kill -0 "$PID" 2>/dev/null; then
    echo "launch: pnpm sim exited before it was ready." >&2
    cat "$LOG" >&2
    rm -f "$RUN_FILE"
    exit 1
  fi
  sleep 0.2
done

if [[ "$ready" != "1" ]]; then
  echo "launch: timed out waiting for the ready line." >&2
  cat "$LOG" >&2
  "$(dirname "$0")/cleanup.sh" || true
  exit 1
fi

LISTENER=$(listener_pids "$PORT" | head -n 1)
if [[ -z "$LISTENER" ]]; then
  echo "launch: ready line printed, but nothing listens on port ${PORT}." >&2
  "$(dirname "$0")/cleanup.sh" || true
  exit 1
fi

export LISTENER
node --input-type=module <<'NODE'
import { readFileSync, writeFileSync } from "node:fs";
const run = JSON.parse(readFileSync(process.env.RUN_FILE, "utf8"));
run.listenerPid = Number(process.env.LISTENER);
const text = `${JSON.stringify(run, null, 2)}\n`;
writeFileSync(process.env.RUN_FILE, text);
writeFileSync(`${process.env.EVIDENCE}/run.json`, text);
NODE

echo "evidence: ${EVIDENCE}"
echo "port: ${PORT}"
echo "pid: ${PID}"
echo "listener: ${LISTENER}"
echo "ready: glancepad simulator  http://localhost:${PORT}/"
