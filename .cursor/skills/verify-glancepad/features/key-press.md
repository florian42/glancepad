# Key press

A press on a keypad button emits a device-to-host frame. The frame log shows it. Lighting does not change.

## Sub-features

- Pointer down sends act `1` for that key.
- Pointer up sends act `0`.
- The frame log row uses the class `dir-out`.
- The decoded text contains `v.oai.hid` and the key id.
- Agent keys are `AG00` through `AG05`.
- Command keys are `ACT06`, `ACT07`, `ACT08`, `ACT09`, `ACT10_ACT11`, and `ACT12`.

## How to get to it (user POV)

Open `http://127.0.0.1:4180/`. Wait until `#conn` reads `connected`. Press a key on the keypad. The Frame log section grows by one row for the press and one row for the release.

## Driving it with the simulator page

Use a real pointer. Dispatch `pointerdown` on `button.key[data-key="AG00"]`, then `pointerup` on `window`. A DOM `click()` does not send the key.

The new `#log li` contains `v.oai.hid`, `"key":"AG00"`, and `"act":1`. The direction text is `device →`. The report header starts with `id 6 ch 2`.

`pnpm sim:state` stays on the lighting you had before the press. With no session event, `slots.AG00.effect` stays `off` and `driver.slots[0].status` stays `off`.

```sh
node .cursor/skills/verify-glancepad/scripts/screenshot.mjs \
  --url "http://127.0.0.1:${GLANCEPAD_PORT}/" \
  --out "$GLANCEPAD_EVIDENCE/page.png" \
  --report "$GLANCEPAD_EVIDENCE/page.txt" \
  --until 'document.querySelector("#conn")?.textContent === "connected" && [...document.querySelectorAll("#log li")].some((row) => row.textContent.includes("v.oai.hid") && row.textContent.includes("AG00"))'
```

Press the key in the browser before the `--until` check can pass. Save the press as `action.json` with the selector and the act. Save `state.json` from `pnpm sim:state` after the release.

## Gotchas

The page listens for `pointerdown` and `pointerup`. It does not listen for `click`. A blur of the window releases every held key. The command key `ACT10_ACT11` is the wide MIC key. `ACT10` and `ACT11` are not separate buttons on the page.
