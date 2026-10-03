#!/usr/bin/env bash
# Stops the simulator recorded in the run file. Leaves evidence in place.

set -euo pipefail

RUN_FILE=${GLANCEPAD_RUN_FILE:-/tmp/glancepad-verify-run.json}
if [[ ! -f "$RUN_FILE" ]]; then
  echo "cleanup: no run file at ${RUN_FILE}"
  exit 0
fi

eval "$(RUN_FILE="$RUN_FILE" node --input-type=module <<'NODE'
import { readFileSync } from "node:fs";
const run = JSON.parse(readFileSync(process.env.RUN_FILE, "utf8"));
const print = (key, value) => {
  const text = value == null ? "" : String(value);
  process.stdout.write(`export ${key}=${JSON.stringify(text)}\n`);
};
print("PID", run.pid);
print("PORT", run.port);
print("CWD", run.cwd);
print("LISTENER", run.listenerPid);
print("EVIDENCE", run.evidence);
NODE
)"

collect_tree() {
  local parent="$1"
  local child
  echo "$parent"
  local children
  children=$(ps -eo pid=,ppid= | awk -v p="$parent" '$2 == p { print $1 }')
  for child in $children; do
    collect_tree "$child"
  done
}

cmdline() {
  ps -p "$1" -o args= 2>/dev/null || true
}

cwd_of() {
  if [[ -L "/proc/$1/cwd" ]]; then
    readlink "/proc/$1/cwd"
  else
    lsof -a -p "$1" -d cwd -Fn 2>/dev/null | sed -n "s/^n//p" | head -n 1
  fi
}

kill_pid() {
  local pid="$1"
  if ! kill -0 "$pid" 2>/dev/null; then
    return 0
  fi
  kill -TERM "$pid" 2>/dev/null || true
}

PIDS=()
if [[ -n "$PID" ]] && kill -0 "$PID" 2>/dev/null; then
  ROOT_CMD=$(cmdline "$PID")
  case "$ROOT_CMD" in
    *pnpm\ sim*|*src/ui/main.ts*)
      while IFS= read -r pid; do
        [[ -n "$pid" ]] && PIDS+=("$pid")
      done < <(collect_tree "$PID")
      ;;
    *)
      echo "cleanup: recorded pid ${PID} is not pnpm sim. It was left alive."
      ;;
  esac
fi

if [[ -n "${LISTENER:-}" ]] && kill -0 "$LISTENER" 2>/dev/null; then
  LISTENER_CMD=$(cmdline "$LISTENER")
  LISTENER_CWD=$(cwd_of "$LISTENER")
  case "$LISTENER_CMD" in
    *src/ui/main.ts*)
      if [[ "$LISTENER_CWD" == "$CWD" ]]; then
        known=0
        for pid in "${PIDS[@]}"; do
          if [[ "$pid" == "$LISTENER" ]]; then
            known=1
          fi
        done
        if [[ "$known" == "0" ]]; then
          PIDS+=("$LISTENER")
        fi
      else
        echo "cleanup: listener ${LISTENER} cwd does not match this run. It was left alive."
      fi
      ;;
  esac
fi

if [[ "${#PIDS[@]}" -eq 0 ]]; then
  echo "cleanup: recorded processes are already stopped"
else
  for ((i = ${#PIDS[@]} - 1; i >= 0; i--)); do
    kill_pid "${PIDS[$i]}"
  done
  for _ in $(seq 1 25); do
    alive=0
    for pid in "${PIDS[@]}"; do
      if kill -0 "$pid" 2>/dev/null; then
        alive=1
      fi
    done
    if [[ "$alive" == "0" ]]; then
      break
    fi
    sleep 0.2
  done
  for pid in "${PIDS[@]}"; do
    if kill -0 "$pid" 2>/dev/null; then
      kill -KILL "$pid" 2>/dev/null || true
    fi
  done
  echo "cleanup: stopped pids ${PIDS[*]}"
fi

sleep 0.2
LIVE=$(lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t 2>/dev/null | head -n 1 || true)
if [[ -n "$LIVE" ]]; then
  echo "cleanup: port ${PORT} is still owned by pid ${LIVE}."
  echo "cleanup: that pid was not started by this run, so it was left alive."
else
  echo "cleanup: port ${PORT} is free"
fi

rm -f "$RUN_FILE"
echo "cleanup: evidence left at ${EVIDENCE}"
