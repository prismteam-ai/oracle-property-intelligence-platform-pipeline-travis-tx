// Shared Playwright fixtures. `run` performs step 0 of every published-data case once per
// worker: open `{RUNTIME_URL}/runs`, read the manifest CID and runId from the run card's
// `data-cid`, fetch the manifest by CID and validate it. Specs import `test` and `expect`
// from here instead of `@playwright/test`.
import { test as base, expect } from "@playwright/test";
import { readPublishedRun, type PublishedRun } from "./runtime.js";

type WorkerFixtures = { run: PublishedRun };

export const test = base.extend<Record<never, never>, WorkerFixtures>({
  run: [
    async ({ browser }, use) => {
      const page = await browser.newPage({ colorScheme: "light" });
      try {
        const run = await readPublishedRun(page);
        await use(run);
      } finally {
        await page.close();
      }
    },
    { scope: "worker" },
  ],
});

export { expect };
