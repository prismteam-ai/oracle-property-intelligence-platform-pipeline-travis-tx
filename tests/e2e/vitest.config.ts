// Unit tests of the harness itself (the RUNTIME_URL guard, TC-060). Playwright specs are
// `*.spec.ts` and are never collected here; `pnpm --filter @countylens/e2e test` runs only
// the `lib/**/*.test.ts` files, so `turbo run test` stays green without a hosted runtime.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "e2e-harness",
    include: ["lib/**/*.test.ts"],
    environment: "node",
  },
});
