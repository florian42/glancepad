// Prints the running simulator's LED state and driver as JSON:
// `pnpm sim:state`. This queries the live process, so the dump
// reflects every lighting call the simulator has received so far,
// plus the slot status and the selection-lighting flag.

import { DEFAULT_PORT } from "./port.js";

const port = Number(process.env.GLANCEPAD_PORT ?? DEFAULT_PORT);

try {
  const response = await fetch(`http://127.0.0.1:${port}/state`);
  console.log(JSON.stringify(await response.json(), null, 2));
} catch {
  console.error(
    `No simulator answers on port ${port}. Start one with: pnpm sim`,
  );
  process.exitCode = 1;
}
