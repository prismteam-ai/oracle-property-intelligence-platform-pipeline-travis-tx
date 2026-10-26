// Vitest (node) for the shared tRPC client (A-03 T009): link composition only, no network.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "api-client",
    environment: "node",
    include: ["test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
    },
  },
});
