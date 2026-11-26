// Starts the simulator: `pnpm sim`. Headless is the same process with
// no browser connected; `pnpm sim:state` prints the LED state.

import { createHyprlandFocuser } from "../focus/index.js";
import { SimulatedDevice } from "../simulator/index.js";
import { DEFAULT_PORT } from "./port.js";
import { startSimulatorServer } from "./server.js";

const port = Number(process.env.GLANCEPAD_PORT ?? DEFAULT_PORT);
const device = new SimulatedDevice();
const server = await startSimulatorServer(device, {
  port,
  // The first supported window system is Hyprland (issue 12).
  focuser: createHyprlandFocuser(),
});

console.log(`glancepad simulator  http://localhost:${server.port}/`);
console.log(`LED state and driver http://localhost:${server.port}/state`);
