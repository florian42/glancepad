# Session lighting

A settings-hook body posted to `/events` lights one agent key. The newest session is `AG00`.

## Sub-features

- `SessionStart` sets the key to idle, color `#ffffff`.
- `UserPromptSubmit` sets the key to working, color `#304ffe`.
- `PermissionRequest` sets the key to awaiting-approval, color `#ff6d00`.
- `PreToolUse` with `tool_name` `AskUserQuestion` sets awaiting-response. The color is also `#ff6d00`.
- `Stop` sets the key to unread, color `#00ff4c`.
- `StopFailure` sets the key to error, color `#ff0033`.
- `SessionEnd` removes the session and the key goes off, color `#000000`.
- The first accepted event sets the page source to `sessions`.

A lit key uses effect `solid`, brightness `1`, and speed `0`. Read `driver.slots[0].status` when two statuses share a color.

## How to get to it (user POV)

Start the simulator and open `http://127.0.0.1:4180/`. The Driver section starts at `source: panel`. A Claude Code settings hook posts to `http://127.0.0.1:4180/events`. The snippet in the repo is `scripts/glancepad.settings.json`. After the first event, the status menu and the selection radios lock.

## Driving it with the simulator page

Post one prompt event. Use a short session id and no prompt text.

```sh
curl -sS -D "$GLANCEPAD_EVIDENCE/action.headers" -o "$GLANCEPAD_EVIDENCE/action.body" \
  -X POST -H "content-type: application/json" \
  --data '{"hook_event_name":"UserPromptSubmit","session_id":"verify-1"}' \
  "http://127.0.0.1:${GLANCEPAD_PORT}/events"
export GLANCEPAD_PORT
pnpm sim:state > "$GLANCEPAD_EVIDENCE/state.json"
```

Write `action.json` with method `POST`, that URL, that body, and the status from `action.headers`.

Expect HTTP status 204 and an empty body. Expect `slots.AG00` to be effect `solid`, color `#304ffe`, brightness `1`, and speed `0`. Expect `driver.slots[0].status` to be `working`. Expect `selected` and `pulsing` to be false.

On the page, `#source-line` reads `source: sessions`. `[data-key=AG00]` has class `fx-solid`. `[data-session="0"]` reads `verify-1`. `select[data-slot="0"]` is disabled. The zone color is `rgb(48 79 254)`.

```sh
node .cursor/skills/verify-glancepad/scripts/screenshot.mjs \
  --url "http://127.0.0.1:${GLANCEPAD_PORT}/" \
  --out "$GLANCEPAD_EVIDENCE/page.png" \
  --report "$GLANCEPAD_EVIDENCE/page.txt" \
  --until 'document.querySelector("#source-line")?.textContent === "source: sessions" && document.querySelector("[data-key=AG00]")?.classList.contains("fx-solid") && getComputedStyle(document.querySelector("[data-key=AG00]")).getPropertyValue("--zone-color").trim() === "rgb(48 79 254)" && document.querySelectorAll("select")[0].disabled'
```

## Gotchas

The server answers 204 for an unknown body and for invalid JSON. Compare the state before and after the post. Drive this check from an off key. A key that is already working stays as it is. `publishSessions` in `src/ui/server.ts` skips that status. `SessionStart` with `source` `compact` keeps the current status. A later tool event after `Stop` does not turn the key blue again. `select[data-slot]` and the selection radios do nothing after the source is `sessions`. The brightness slider `#brightness` still changes brightness. Leave it at `1` during this check. `button.forget[data-forget="0"]` ends that session. A second session moves onto `AG00` and shifts the older session right.
