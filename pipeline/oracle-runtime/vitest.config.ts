import { defineConfig } from "vitest/config";

// Unit tests only. The acceptance suite (test/acceptance/, T055) reads the live catalog and
// evidence and runs with `npm run test:acceptance` (vitest.acceptance.config.ts).
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    exclude: ["test/acceptance/**", "node_modules/**"],
    environment: "node",
    // A real fetch in a unit test is a bug: it is replaced by one that always rejects.
    setupFiles: ["test/setup-no-network.ts"],
  },
});
