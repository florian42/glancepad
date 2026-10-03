# Selection window

Selecting a lit agent key shows selection lighting for 4000 ms. This path works while the source is still `panel`.

## Sub-features

- The selected key breathes in its status color.
- A selected working key makes `#ring` snake at speed `0.4`.
- The command-key backlight is solid while `driver.selectionVisible` is true.
- After 4000 ms the backlight goes off. The text reads `Selection lighting off.`
- A selected working key keeps the snake on the ring after the window.
- The selected flag stays true after the window.

## How to get to it (user POV)

Open `http://127.0.0.1:4180/` before any `/events` post. `#source-line` reads `source: panel`. In the Driver section, choose a status in `select[data-slot="0"]`. Then check `input[type="radio"][data-slot="0"]`. `#selection-lighting` reads `Selection lighting on, 4000 ms.`

## Driving it with the simulator page

Use a pointer on the two controls. Set the status first. Then select the slot.

1. Set `select[data-slot="0"]` to `working`.
2. Check `input[type="radio"][data-slot="0"]`.
3. Read the page and the state while the window is open.
4. Wait 4000 ms.
5. Read the page and the state again.

While the window is open, expect `driver.selectionVisible` true. Expect `driver.slots[0]` status `working` and `selected` true. Expect `slots.AG00.effect` `breath` and color `#304ffe`. Expect `ambient.effect` `snake` and `ambient.speed` `0.4`. Expect `keys.effect` `solid` and `keys.color` `#304ffe`.

`#ring` has class `fx-snake`. `[data-key=AG00]` has class `fx-breath`. `[data-key=ACT06]` has class `fx-solid`.

```sh
node .cursor/skills/verify-glancepad/scripts/screenshot.mjs \
  --url "http://127.0.0.1:${GLANCEPAD_PORT}/" \
  --out "$GLANCEPAD_EVIDENCE/page.png" \
  --report "$GLANCEPAD_EVIDENCE/page.txt" \
  --until 'document.querySelector("#selection-lighting")?.textContent === "Selection lighting on, 4000 ms." && document.querySelector("#ring")?.classList.contains("fx-snake") && document.querySelector("[data-key=AG00]")?.classList.contains("fx-breath")'
```

The screenshot helper only observes the page. Set the select and the radio in the browser before you run it. Save `state.json` from `pnpm sim:state` during the same 4000 ms window.

After 4000 ms, expect `driver.selectionVisible` false and `keys.effect` `off`. Expect `ambient.effect` `snake`. Expect `slots.AG00.effect` `breath`. Expect `driver.slots[0].selected` true. `#selection-lighting` reads `Selection lighting off.`

## Gotchas

A selected `off` slot does not light the ring. Set a status other than `off` first. `input[type="radio"][data-slot="-1"]` clears the selection. After the first `/events` post, these radios are disabled. Restart the simulator to drive this feature again. The keys backlight follows the 4000 ms window. The ring snake does not.
