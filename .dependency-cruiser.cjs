/**
 * Enforces the two module-boundary rules from CLAUDE.md ("Stack and
 * conventions"). Biome's noRestrictedImports blocks named modules only;
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
      name: "simulator-no-ui",
      comment:
        "src/simulator must not import src/ui — keeps headless mode real.",
      severity: "error",
      from: { path: "^src/simulator" },
      to: { path: "^src/ui" },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.json" },
  },
};
