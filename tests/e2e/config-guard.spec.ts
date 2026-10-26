// A-03-TC-060: Playwright config refuses localhost (FR-010, hosted-runtime rule). The case
// spawns the real `playwright test --list` with the loopback values and with RUNTIME_URL
// unset, and asserts the exact fixed texts, a non-zero exit and that nothing was listed.
import { createRequire } from "node:module";
import { expect, test } from "@playwright/test";
import { RUNTIME_URL_UNSET_TEXT, runtimeUrlLocalhostText } from "./lib/runtime-url.js";
import { e2eRoot } from "./lib/runtime.js";
import { childEnv, run, type RunResult } from "./lib/spawn.js";

const require = createRequire(import.meta.url);
const playwrightCli = require.resolve("@playwright/test/cli");

/** `playwright test --list` in this package with RUNTIME_URL set to `value` (or removed). */
function listTests(value: string | undefined): Promise<RunResult> {
  return run(
    process.execPath,
    [playwrightCli, "test", "--list", "--config", "playwright.config.ts", "--reporter=list"],
    { cwd: e2eRoot, env: childEnv({ RUNTIME_URL: value }), timeoutMs: 180_000 },
  );
}

const CASES: { label: string; value: string | undefined; expected: string }[] = [
  {
    label: "localhost",
    value: "http://localhost:3000",
    expected: runtimeUrlLocalhostText("http://localhost:3000"),
  },
  {
    label: "127.0.0.1",
    value: "http://127.0.0.1:3000",
    expected: runtimeUrlLocalhostText("http://127.0.0.1:3000"),
  },
  {
    label: "[::1]",
    value: "http://[::1]:3000",
    expected: runtimeUrlLocalhostText("http://[::1]:3000"),
  },
  { label: "unset", value: undefined, expected: RUNTIME_URL_UNSET_TEXT },
];

test.describe("A-03-TC-060 Playwright config refuses localhost", () => {
  test.describe.configure({ timeout: 10 * 60_000 });

  test("@scenario:A-03-TC-060", async () => {
    const testInfo = test.info();
    for (const { label, value, expected } of CASES) {
      const result = await listTests(value);
      await testInfo.attach(`playwright-list-${label}.log`, {
        body: `$ RUNTIME_URL=${value ?? "<unset>"} ${result.command}\nexit ${result.code}\n\n${result.output}`,
        contentType: "text/plain",
      });
      expect(result.code, `${label}: --list must exit non-zero`).not.toBe(0);
      expect(result.output, `${label}: the exact fixed text`).toContain(expected);
      expect(result.output, `${label}: no test may be listed`).not.toMatch(
        /Total: \d+ tests? in \d+ files?/,
      );
      expect(result.output, `${label}: no test may be listed`).not.toContain("Listing tests:");
      expect(result.output, `${label}: no test may run`).not.toMatch(/Running \d+ tests?/);
    }
  });
});
