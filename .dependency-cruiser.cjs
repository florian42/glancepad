/**
 * Enforces the two module-boundary rules from CLAUDE.md ("Stack and
 * conventions"), and the host-on-transport rule from issue #8. Biome's noRestrictedImports blocks named modules only;
 * it cannot express "imports nothing outside its own directory", so
 * dependency-cruiser is the documented fallback.
 */
module.exports = {
  forbidden: [
    {
      name: "protocol-is-pure",
      comment:
        "src/protocol must import nothing outside src/protocol — no packages, no node builtins, no other src modules (ADR-0001).",
      severity: "error",
      from: { path: "^src/protocol" },
      to: { pathNot: "^src/protocol" },
    },
    {
      name: "sessions-is-pure",
      comment:
        "src/sessions may import only src/sessions and src/protocol — no packages, no node builtins, no other src modules.",
      severity: "error",
      from: { path: "^src/sessions" },
      to: { pathNot: "^src/(sessions|protocol)" },
    },
    {
      name: "talk-is-pure",
      comment:
        "src/talk (the push-to-talk machine) must import nothing outside src/talk — no packages, no node builtins, no other src modules.",
      severity: "error",
      from: { path: "^src/talk" },
      to: { pathNot: "^src/talk" },
    },
    {
      name: "simulator-no-ui",
      comment:
        "src/simulator must not import src/ui — keeps headless mode real.",
      severity: "error",
      from: { path: "^src/simulator" },
      to: { path: "^src/ui" },
    },
    {
      name: "device-transport-only",
      comment:
        "src/device (the transport seam and the host) must not import src/simulator or src/ui — the host drives any DeviceTransport, so real hardware can replace the simulator (issue #8).",
      severity: "error",
      from: { path: "^src/device" },
      to: { path: "^src/(simulator|ui)" },
    },
    {
      name: "focus-below-the-server",
      comment:
        "src/focus (tap handling and window focus) may import only src/focus, src/sessions, src/protocol, and node builtins. It must work with any key source (issue #12).",
      severity: "error",
      from: { path: "^src/focus" },
      to: {
        pathNot: "^(src/(focus|sessions|protocol)|node:)",
        dependencyTypesNot: ["core"],
      },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.json" },
  },
};
