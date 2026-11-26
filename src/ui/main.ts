// Starts glancepad. `pnpm sim` runs the simulator alone. `pnpm keypad`
// (`--device hid`) also drives a physical keypad, and the page then
// mirrors it. Headless is the same process with no browser connected;
// `pnpm sim:state` prints the LED state.

import { linuxKeypadBackend } from "../device/hidraw.js";
import { HidTransport } from "../device/hidtransport.js";
import { createHyprlandFocuser } from "../focus/index.js";
import { SimulatedDevice } from "../simulator/index.js";
import { DEFAULT_PORT } from "./port.js";
import { startSimulatorServer } from "./server.js";

const flag = process.argv.indexOf("--device");
const deviceKind =
  (flag === -1 ? undefined : process.argv[flag + 1]) ??
  process.env.GLANCEPAD_DEVICE ??
  "sim";
if (deviceKind !== "sim" && deviceKind !== "hid") {
  console.error(`unknown device "${deviceKind}": use "sim" or "hid"`);
  process.exit(2);
}

let hardware: HidTransport | undefined;
if (deviceKind === "hid") {
  if (process.platform !== "linux") {
    console.error("hardware mode needs Linux (docs/adr/0003)");
    process.exit(2);
  }
  hardware = new HidTransport(linuxKeypadBackend());
  hardware.onStatus((status) => {
    if (status.kind === "connected") console.log("keypad connected");
    if (status.kind === "disconnected")
      console.log(`keypad disconnected (${status.reason}), looking for it`);
    if (status.kind === "open-failed")
      console.error(
        `keypad found, but the open failed: ${status.reason}. ` +
          "Install udev/70-glancepad.rules (see README).",
      );
  });
}

const port = Number(process.env.GLANCEPAD_PORT ?? DEFAULT_PORT);
const device = new SimulatedDevice();
const server = await startSimulatorServer(device, {
  port,
  // The first supported window system is Hyprland (issue 12).
  focuser: createHyprlandFocuser(),
  ...(hardware === undefined ? {} : { hardware }),
});

console.log(
  hardware === undefined
    ? "device: simulator"
    : "device: physical keypad, mirrored by the simulator page",
);
console.log(`glancepad simulator  http://localhost:${server.port}/`);
console.log(`LED state and driver http://localhost:${server.port}/state`);
