import { defineConfig } from "vitest/config";

// Unit tests for the local services (A-04 T007). Offline: a real fetch is a bug. Query DB
// integration cases run only when QDB_TEST_URL is set, each in a throwaway schema.
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    exclude: ["node_modules/**", "data/**"],
    environment: "node",
    setupFiles: ["test/setup-no-network.ts"],
  },
});
