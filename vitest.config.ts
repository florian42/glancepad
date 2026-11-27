import { defineConfig } from "vitest/config";

// Run the tests of this checkout only. Without this, vitest also finds
// the copies in `.claude/worktrees/`, which session worktrees leave.
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
  },
});
