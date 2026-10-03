#!/usr/bin/env bash
# Read-only check that this run's simulator is the one to drive.

set -euo pipefail

RUN_FILE=${GLANCEPAD_RUN_FILE:-/tmp/glancepad-verify-run.json}
if [[ ! -f "$RUN_FILE" ]]; then
  echo "bad run file missing at ${RUN_FILE}" >&2
  exit 1
fi

eval "$(RUN_FILE="$RUN_FILE" node --input-type=module <<'NODE'
import { readFileSync } from "node:fs";
const run = JSON.parse(readFileSync(process.env.RUN_FILE, "utf8"));
const print = (key, value) => {
  const text = value == null ? "" : String(value).replaceAll("\n", " ");
  process.stdout.write(`export ${key}=${JSON.stringify(text)}\n`);
};
print("PID", run.pid);
print("PORT", run.port);
print("CWD", run.cwd);
print("GIT", run.git);
print("LISTENER", run.listenerPid);
NODE
)"

fail=0
ok() { echo "ok  $*"; }
bad() { echo "bad $*"; fail=1; }

if kill -0 "$PID" 2>/dev/null; then
  ok "recorded pid ${PID} is alive"
else
  bad "recorded pid ${PID} is not alive"
fi

is_ancestor() {
  local parent="$1"
  local current="$2"
  local guard=0
  while [[ -n "$current" && "$current" != "0" && "$current" != "1" ]]; do
    if [[ "$current" == "$parent" ]]; then
      return 0
    fi
    current=$(ps -o ppid= -p "$current" 2>/dev/null | tr -d " " || true)
    guard=$((guard + 1))
    if [[ "$guard" -gt 40 ]]; then
      return 1
    fi
  done
  [[ "$current" == "$parent" ]]
}

LIVE=$(lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t 2>/dev/null | head -n 1 || true)
if [[ -z "$LIVE" ]]; then
  bad "nothing listens on 127.0.0.1:${PORT}"
else
  if is_ancestor "$PID" "$LIVE"; then
    ok "port ${PORT} is owned by pid ${LIVE}, under recorded pid ${PID}"
  else
    bad "port ${PORT} is owned by pid ${LIVE}, not recorded pid ${PID}"
  fi
fi

TARGET=${LIVE:-$LISTENER}
if [[ -n "$TARGET" ]] && kill -0 "$TARGET" 2>/dev/null; then
  ARGS=$(ps -p "$TARGET" -o args= || true)
  case "$ARGS" in
    *src/ui/main.ts*)
      ok "listener command contains src/ui/main.ts"
      ;;
    *)
      bad "listener command does not contain src/ui/main.ts"
      ;;
  esac
  if [[ -L "/proc/${TARGET}/cwd" ]]; then
    PROC_CWD=$(readlink "/proc/${TARGET}/cwd")
  else
    PROC_CWD=$(lsof -a -p "$TARGET" -d cwd -Fn 2>/dev/null | sed -n "s/^n//p" | head -n 1)
  fi
  if [[ "$PROC_CWD" == "$CWD" ]]; then
    ok "listener cwd is ${CWD}"
  else
    bad "listener cwd is ${PROC_CWD}, launch cwd is ${CWD}"
  fi
fi

PAGE=$(mktemp)
trap 'rm -f "$PAGE"' EXIT
if curl -sf "http://127.0.0.1:${PORT}/" -o "$PAGE"; then
  if grep -q "<title>glancepad simulator</title>" "$PAGE"; then
    ok "page title is glancepad simulator"
  else
    bad "page title is not glancepad simulator"
  fi
  if cmp -s "$PAGE" "$CWD/src/ui/index.html"; then
    ok "served page matches ${CWD}/src/ui/index.html"
  else
    bad "served page does not match ${CWD}/src/ui/index.html"
  fi
else
  bad "GET / failed on port ${PORT}"
fi

STATE=$(mktemp)
trap 'rm -f "$PAGE" "$STATE"' EXIT
if curl -sf "http://127.0.0.1:${PORT}/state" -o "$STATE"; then
  if STATE_PATH="$STATE" node --input-type=module -e 'import {readFileSync} from "node:fs"; const s = JSON.parse(readFileSync(process.env.STATE_PATH, "utf8")); if (!s.slots?.AG00 || !s.ambient || !s.keys || !Array.isArray(s.driver?.slots)) process.exit(1);'; then
    ok "GET /state has slots.AG00, ambient, keys, and driver.slots"
  else
    bad "GET /state is missing the simulator shape"
  fi
else
  bad "GET /state failed on port ${PORT}"
fi

HEAD=$(git -C "$CWD" rev-parse HEAD)
if [[ "$HEAD" == "$GIT" ]]; then
  ok "git HEAD ${HEAD} matches the launch SHA"
else
  bad "git HEAD ${HEAD} does not match launch SHA ${GIT}"
fi

exit "$fail"
