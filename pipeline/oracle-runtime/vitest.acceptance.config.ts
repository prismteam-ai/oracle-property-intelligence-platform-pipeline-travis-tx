import { defineConfig } from "vitest/config";

// T055 acceptance suite: one test per A-01 test case, shelling out to the case's commands
// against the committed catalog and evidence. Cases run one after another (they share the
// validator report file) and may call sources or nested test runs, so timeouts are long.
export default defineConfig({
  test: {
    include: ["test/acceptance/**/*.test.ts"],
    environment: "node",
    fileParallelism: false,
    testTimeout: 15 * 60 * 1000,
  },
});
