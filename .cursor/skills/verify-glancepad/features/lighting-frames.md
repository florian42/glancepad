# Lighting frames

A lighting change shows up in the frame log. A repeat of the same lighting does not. Neighboring host reports are at least 50 ms apart.

## Sub-features

- A new slot status adds at least two `→ device` rows. The decoded text contains `v.oai.thstatus`.
- Setting that same status again adds no `→ device` row.
- The gap between two neighboring `→ device` rows is at least 50 ms.

## How to get to it (user POV)

Open `http://127.0.0.1:4180/` while the source is `panel`. In the Driver section, set `select` for `AG00` to `working`. The Frame log section grows. Set `working` again. The log does not grow.

## Driving it with the simulator page

Count the `frame:` lines in `page.txt` whose direction is `→ device`. That count is the host-report count.

```sh
node .cursor/skills/verify-glancepad/scripts/screenshot.mjs \
  --url "http://127.0.0.1:${GLANCEPAD_PORT}/" \
  --out "$GLANCEPAD_EVIDENCE/page.png" \
  --report "$GLANCEPAD_EVIDENCE/page.txt" \
  --act '(() => { const select = document.querySelectorAll("select")[0]; select.value = "working"; select.dispatchEvent(new Event("change", { bubbles: true })); })()' \
  --until 'document.querySelector("[data-key=AG00]")?.classList.contains("fx-solid") && document.querySelectorAll("#log .dir-in").length >= 2'
```

Save `state.json` from `pnpm sim:state`. Expect `slots.AG00` effect `solid`, color `#304ffe`, brightness `1`, and speed `0`. Expect at least two `→ device` rows. Parse each `frame:` time as `HH:MM:SS.mmm`. Each later `→ device` time is at least 50 ms after the previous one.

Run the helper again with the same `--act`. Pass the host-report count from the first `page.txt` as `N` in `--until`.

```sh
node .cursor/skills/verify-glancepad/scripts/screenshot.mjs \
  --url "http://127.0.0.1:${GLANCEPAD_PORT}/" \
  --out "$GLANCEPAD_EVIDENCE/page-repeat.png" \
  --report "$GLANCEPAD_EVIDENCE/page-repeat.txt" \
  --act '(() => { const select = document.querySelectorAll("select")[0]; select.value = "working"; select.dispatchEvent(new Event("change", { bubbles: true })); })()' \
  --until 'document.querySelectorAll("#log .dir-in").length === N'
```

`page-repeat.txt` has the same number of `→ device` rows. `pnpm sim:state` still shows `AG00` solid `#304ffe`.

## Gotchas

The wait lives in `paceSend` in `src/device/host.ts`. The constant is `SEND_COOLDOWN_MS` in `src/protocol/constants.ts`. The first report of a process has no wait before it. The skip of an unchanged payload lives in `pushLighting` in `src/device/host.ts`. A `device →` row is a key press. Do not count it as a host report. After the first `/events` post, the status menu is disabled, so this path stays on `source: panel`.
