// T020 (A-14): this package has exactly one Vitest driver, golden.test.ts, which guards its own
// AGENT_URL / RUNTIME_URL requirement internally (never asserts against localhost; see
// golden.test.ts's header comment and constitution I). No Playwright specs live here.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "agent-golden",
    include: ["*.test.ts"],
    environment: "node",
  },
});
