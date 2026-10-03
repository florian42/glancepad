---
name: verify-glancepad
description: Verify the glancepad simulator. Use when you start pnpm sim, check key lighting from a session event, check the selection window, or check a mod interrupt or heartbeat.
---

# verify-glancepad

Verify glancepad on the running simulator. Run every step below from the repository root. Read one feature file before you drive that feature.

`pnpm sim:state` prints one JSON object. `slots` maps `AG00` through `AG05` to a zone. A zone is `effect`, `color`, `brightness`, and `speed`. `ambient` and `keys` are zones. `driver.slots` has six rows. Each row is `status`, `selected`, and `pulsing`. `driver.selectionVisible` is true during the selection window. `driver.brightness` is a number from 0 to 1.

## Launch

Set `GLANCEPAD_EVIDENCE` to the directory that must keep the proof. When the variable is unset, launch creates a directory under `/tmp/glancepad-verify/`.

```sh
export GLANCEPAD_EVIDENCE=/tmp/glancepad-verify/proof
.cursor/skills/verify-glancepad/scripts/launch.sh
```

The script runs `pnpm sim`. The server listens on `127.0.0.1`. The port is `GLANCEPAD_PORT`, or `4180` when that variable is unset.

The simulator is ready when the log prints this line. The number is `4180` unless `GLANCEPAD_PORT` is set.

```text
glancepad simulator  http://localhost:4180/
```

`GET /state` then returns JSON. On the page, `#conn` reads `connected`.

Launch writes `/tmp/glancepad-verify-run.json` and copies it to `$GLANCEPAD_EVIDENCE/run.json`. The file holds `pid`, `listenerPid`, `port`, `cwd`, `git`, `evidence`, and `log`.

Run the cleanup script after a failed launch. That frees the port for the next attempt.

Launch is done when the script prints `ready:` and both run files exist.

## Doctor

Doctor only reads the run. It checks these facts.

- The recorded pid is alive.
- The process on the port is that pid, or a child of it.
- The listener command contains `src/ui/main.ts`.
- The listener working directory is the launch directory.
- The served page matches `src/ui/index.html` in that directory.
- `GET /state` has `slots.AG00`, `ambient`, `keys`, and `driver.slots`.
- The git SHA matches the SHA recorded at launch.

```sh
.cursor/skills/verify-glancepad/scripts/doctor.sh | tee "$GLANCEPAD_EVIDENCE/doctor.txt"
```

Every result line starts with `ok`. Doctor is done when the script exits 0. Launch again after a commit. A new commit changes the recorded SHA.

## Drive

Open `http://127.0.0.1:4180/`. Wait until `#conn` reads `connected`. Read [features/README.md](features/README.md). Follow one feature file.

Post a session event with `curl` to `http://127.0.0.1:4180/events`. Read the lighting with the state command. Export the port launch printed. Use `4180` when launch used the default.

```sh
export GLANCEPAD_PORT=4180
pnpm sim:state
```

The page and the state JSON show whether the event changed a key. Drive is done when those both match the feature file.

## Evidence

Write the proof in `$GLANCEPAD_EVIDENCE`. Save the action and the state that followed it.

- `action.json` holds the method, the URL, the body, and the HTTP status.
- `state.json` is the `pnpm sim:state` output after that action.
- `page.png` is a screenshot taken after the page matches.
- `page.txt` is the selector text from that same moment.
- `doctor.txt` is the doctor output.
- `sim.log` and `run.json` are written by launch.

Take the screenshot with the helper. Put the feature file's `--until` expression in the command.

```sh
node .cursor/skills/verify-glancepad/scripts/screenshot.mjs \
  --url "http://127.0.0.1:${GLANCEPAD_PORT}/" \
  --out "$GLANCEPAD_EVIDENCE/page.png" \
  --report "$GLANCEPAD_EVIDENCE/page.txt" \
  --until 'document.querySelector("#source-line")?.textContent === "source: sessions" && document.querySelector("[data-key=AG00]")?.classList.contains("fx-solid")'
```

That `--until` expression is the session-lighting check. Each feature file has the expression for its own page.

The helper uses Chrome. Set `CHROME_PATH` when `google-chrome` is not on `PATH`. Evidence is done when `action.json`, `state.json`, and `page.png` are in the evidence directory.

## Cleanup

Cleanup stops the recorded pid and the children of that pid. It also stops the recorded listener when that process is still `src/ui/main.ts` in this checkout. It deletes `/tmp/glancepad-verify-run.json`. It leaves the evidence directory in place.

```sh
.cursor/skills/verify-glancepad/scripts/cleanup.sh
```

Cleanup is done when it prints that the port is free and the evidence files still exist.

## Helpers

The scripts live in `.cursor/skills/verify-glancepad/scripts/`. Run them from the repository root.

```sh
.cursor/skills/verify-glancepad/scripts/launch.sh
.cursor/skills/verify-glancepad/scripts/doctor.sh
node .cursor/skills/verify-glancepad/scripts/screenshot.mjs --url "http://127.0.0.1:${GLANCEPAD_PORT}/" --out "$GLANCEPAD_EVIDENCE/page.png" --report "$GLANCEPAD_EVIDENCE/page.txt"
.cursor/skills/verify-glancepad/scripts/cleanup.sh
```
