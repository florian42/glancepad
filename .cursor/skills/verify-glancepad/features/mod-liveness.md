# Mod interrupt and heartbeat

The optional mod posts to the same `/events` path. A heartbeat marks the session as watched. An interrupt ends a turn as idle.

## Sub-features

- A heartbeat for a new id lights `AG00` idle, color `#ffffff`.
- A heartbeat for a known id keeps the current status.
- `turn-ended` with `outcome` `interrupted` sets a working key to idle.
- A watched session leaves the keys after 15 seconds without an event.
- A session that never heartbeats stays until `SessionEnd`.

## How to get to it (user POV)

The mod is loaded with `claude --plugin-dir scripts/glancepad-mod`. It posts every 5 seconds to `http://127.0.0.1:4180/events`. It posts an interrupt when a turn is aborted. You can post those same bodies with `curl` while the simulator is running. The page source becomes `source: sessions`.

## Driving it with the simulator page

Put the key into a turn first. Then post the interrupt. Then post a heartbeat.

```sh
curl -sS -o /dev/null -w "%{http_code}" -X POST -H "content-type: application/json" \
  --data '{"hook_event_name":"UserPromptSubmit","session_id":"verify-1"}' \
  "http://127.0.0.1:${GLANCEPAD_PORT}/events"
```

Expect `slots.AG00.color` `#304ffe` and status `working`.

```sh
curl -sS -D "$GLANCEPAD_EVIDENCE/action.headers" -o "$GLANCEPAD_EVIDENCE/action.body" \
  -X POST -H "content-type: application/json" \
  --data '{"source":"mod","kind":"turn-ended","sessionId":"verify-1","outcome":"interrupted"}' \
  "http://127.0.0.1:${GLANCEPAD_PORT}/events"
export GLANCEPAD_PORT
pnpm sim:state > "$GLANCEPAD_EVIDENCE/state.json"
```

Write `action.json` for the interrupt post. Expect status 204. Expect `slots.AG00` effect `solid`, color `#ffffff`, brightness `1`, and speed `0`. Expect `driver.slots[0].status` `idle`.

`[data-key=AG00]` has class `fx-solid`. The zone color is `rgb(255 255 255)`. `#source-line` reads `source: sessions`.

```sh
node .cursor/skills/verify-glancepad/scripts/screenshot.mjs \
  --url "http://127.0.0.1:${GLANCEPAD_PORT}/" \
  --out "$GLANCEPAD_EVIDENCE/page.png" \
  --report "$GLANCEPAD_EVIDENCE/page.txt" \
  --until 'document.querySelector("#source-line")?.textContent === "source: sessions" && document.querySelector("[data-key=AG00]")?.classList.contains("fx-solid")'
```

Post the heartbeat after the interrupt.

```sh
curl -sS -o /dev/null -X POST -H "content-type: application/json" \
  --data '{"source":"mod","kind":"heartbeat","sessionId":"verify-1"}' \
  "http://127.0.0.1:${GLANCEPAD_PORT}/events"
```

The color stays `#ffffff`. Wait 15 seconds with no further post. The liveness check runs every 1 second. The key then goes off. `slots.AG00.effect` becomes `off` and the color becomes `#000000`.

## Gotchas

`outcome` other than `interrupted` does not change the key. An interrupt after `Stop` does not change an unread key. The server answers 204 when it ignores the body. A heartbeat does not emit a new lighting frame when the color stays the same. Silence is 15 seconds, not the 5 second heartbeat gap. One missed heartbeat keeps the key. A hooks-only session has no heartbeat, so silence does not remove it.
