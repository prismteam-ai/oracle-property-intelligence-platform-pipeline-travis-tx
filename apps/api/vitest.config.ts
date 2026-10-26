// Vitest (node) for the API package (A-03 T006/T008). Handler, router and engine tests run
// against in-test fixtures; nothing here reaches S3, DuckDB files or the network.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "api",
    environment: "node",
    include: ["test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
    },
  },
});
