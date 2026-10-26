// Vitest (jsdom) for apps/web unit tests (A-03 T006/T007). Hosted behaviour is proved by
// Playwright against RUNTIME_URL (tests/e2e); these tests cover rendering and state only.
// The React plugin is listed here rather than imported from vite.config.ts so Vite's native
// config loader needs no extensionless import.
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    name: "web",
    environment: "jsdom",
    include: ["test/**/*.test.{ts,tsx}"],
    setupFiles: ["./test-setup.ts"],
    // See test-setup.ts: tests wait for lazy routes, jsdom layout and mocked fetches.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
    },
  },
});
