// Starts the simulator: `pnpm sim`. Headless is the same process with
// no browser connected; `pnpm sim:state` prints the LED state.

import { SimulatedDevice } from "../simulator/index.js";
import { DEFAULT_PORT } from "./port.js";
import { startSimulatorServer } from "./server.js";

const port = Number(process.env.GLANCEPAD_PORT ?? DEFAULT_PORT);
const device = new SimulatedDevice();
const server = await startSimulatorServer(device, { port });

console.log(`glancepad simulator  http://localhost:${server.port}/`);
console.log(`LED state and driver http://localhost:${server.port}/state`);
