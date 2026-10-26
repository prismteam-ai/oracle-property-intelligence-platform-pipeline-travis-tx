// Infra tests synthesize all five stacks per test file; on a shared CI runner one synth can take
// longer than Vitest's 5 s default (A-03 CI run 39616530023: web.test.ts timed out at 5,000 ms).
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "infra",
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
