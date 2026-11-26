// Starts glancepad. `pnpm sim` runs the simulator alone. `pnpm keypad`
// (`--device hid`) also drives a physical keypad, and the page then
// mirrors it. Headless is the same process with no browser connected;
// `pnpm sim:state` prints the LED state.

import { HidTransport } from "../device/hidtransport.js";
import {
  createHyprlandFocuser,
  createMacFocuser,
  readHostSessionId,
} from "../focus/index.js";
import { SimulatedDevice } from "../simulator/index.js";
import { configPath, loadConfig, mergeTalkCommands } from "./config.js";
import { keypadAccessFor } from "./keypadbackend.js";
import { DEFAULT_PORT } from "./port.js";
import { startSimulatorServer } from "./server.js";
import { talkCommandsFromEnv } from "./talkaction.js";

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
  const access = await keypadAccessFor(process.platform);
  if (access === undefined) {
    console.error("hardware mode needs Linux or macOS (docs/adr/0004)");
    process.exit(2);
  }
  hardware = new HidTransport(access.backend);
  hardware.onStatus((status) => {
    if (status.kind === "connected") console.log("keypad connected");
    if (status.kind === "disconnected")
      console.log(`keypad disconnected (${status.reason}), looking for it`);
    if (status.kind === "open-failed")
      console.error(
        `keypad found, but the open failed: ${status.reason}. ` +
          access.openHint,
      );
  });
}

const port = Number(process.env.GLANCEPAD_PORT ?? DEFAULT_PORT);
const device = new SimulatedDevice();
const configFile = configPath(process.env);
const config = loadConfig(configFile);
const talkCommands = mergeTalkCommands(
  config.talk,
  talkCommandsFromEnv(process.env),
);
const server = await startSimulatorServer(device, {
  port,
  talkCommands,
  // Hyprland on Linux (issue 12). On macOS, `ps` and `open`.
  focuser:
    process.platform === "darwin"
      ? createMacFocuser()
      : createHyprlandFocuser(),
  // A Claude Desktop session keeps its app session id in its record.
  hostSessionOf: (pid) => readHostSessionId(pid),
  ...(hardware === undefined ? {} : { hardware }),
});

console.log(
  hardware === undefined
    ? "device: simulator"
    : "device: physical keypad, mirrored by the simulator page",
);
console.log(`config file         ${configFile}`);
console.log(
  `microphone key      start: ${talkCommands.start === undefined ? "no command" : "set"}, ` +
    `stop: ${talkCommands.stop === undefined ? "no command" : "set"}`,
);
console.log(`glancepad simulator  http://localhost:${server.port}/`);
console.log(`LED state and driver http://localhost:${server.port}/state`);
