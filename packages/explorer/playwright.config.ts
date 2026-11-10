import { defineConfig, devices } from "@playwright/test";

const DEPLOYED_EXPLORER = "https://travis-oracle-explorer.curiousily.workers.dev";

export default defineConfig({
  testDir: "e2e",
  timeout: 180_000,
  expect: { timeout: 120_000 },
  reporter: [["list"]],
  use: {
    baseURL: process.env.EXPLORER_URL ?? DEPLOYED_EXPLORER,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
