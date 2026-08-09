// The simulator core: the LED model and the simulated device. This
// module must not import src/ui — that rule keeps headless mode real,
// and `pnpm lint:deps` enforces it.

export * from "./ledmodel.js";
export * from "./simulateddevice.js";
