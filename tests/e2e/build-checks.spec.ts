// Build-time cases run at the deployed SHA (A-03 T024; G6 matrix § 7). Step 0 opens
// `{RUNTIME_URL}/build.json` and asserts the local HEAD equals the deployed `sha`; each case
// then spawns the Vitest suite the matrix names and asserts it ran and passed. An empty match
// (no test selected) is a failure, never a pass.
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { fetchBuildInfo, localHeadSha, repoRoot, type BuildInfo } from "./lib/runtime.js";
import { runVitest, type VitestRun, type VitestRunOptions } from "./lib/spawn.js";

type SuiteOptions = Omit<VitestRunOptions, "outputFile">;

async function expectSuitePassed(label: string, options: SuiteOptions): Promise<VitestRun> {
  const testInfo = test.info();
  const outcome = await runVitest({
    ...options,
    outputFile: testInfo.outputPath(`${label}.vitest.json`),
  });
  const { result, report } = outcome;
  await testInfo.attach(`${label}.log`, {
    body: `$ ${result.command}\n(cwd ${options.cwd})\nexit ${result.code} after ${result.durationMs} ms\n\n${result.output}`,
    contentType: "text/plain",
  });
  expect(
    result.code,
    `${result.command} exited ${result.code}\n${result.output.slice(-3000)}`,
  ).toBe(0);
  expect(report, "Vitest wrote no JSON report").toBeDefined();
  expect(report?.success, "the suite reports success").toBe(true);
  expect(report?.numFailedTests, "no failed test").toBe(0);
  expect(report?.numPassedTests, "at least one test ran and passed").toBeGreaterThan(0);
  return outcome;
}

/** Passed tests whose full name carries the exact case ID (e.g. `A-03-TC-001`). */
function passedFor(outcome: VitestRun, id: string): number {
  return outcome.passedNames.filter((name) => name.includes(id)).length;
}

test.describe("A-03 build-time cases at the deployed SHA", () => {
  test.describe.configure({ mode: "serial", timeout: 15 * 60_000 });

  let build: BuildInfo;

  test.beforeAll(async () => {
    // Step 0 of every build-time case: the checkout under test is the deployed commit.
    build = await fetchBuildInfo();
    const head = localHeadSha();
    expect(
      head,
      `local HEAD ${head} must equal the deployed sha ${build.sha} (run: git checkout ${build.sha})`,
    ).toBe(build.sha);
  });

  test.beforeEach(async () => {
    await test.info().attach("build.json", {
      body: JSON.stringify(build, null, 2),
      contentType: "application/json",
    });
  });

  test.describe("A-03-TC-001 Publication steps run in the fixed order", () => {
    test("@scenario:A-03-TC-001", async () => {
      const outcome = await expectSuitePassed("tc-001", {
        runner: "pnpm",
        cwd: resolve(repoRoot, "pipeline/publish"),
        files: ["test/publish-order.test.ts"],
        nameFilter: "A-03-TC-001",
      });
      // Matched by the case ID in the test name, never by a word in it.
      expect(passedFor(outcome, "A-03-TC-001")).toBeGreaterThanOrEqual(1);
    });
  });

  test.describe("A-03-TC-002 Skipping or reordering a step fails the run", () => {
    test("@scenario:A-03-TC-002", async () => {
      const outcome = await expectSuitePassed("tc-002", {
        runner: "pnpm",
        cwd: resolve(repoRoot, "pipeline/publish"),
        files: ["test/publish-order.test.ts"],
        nameFilter: "A-03-TC-002",
      });
      // The reordered plan (upload before export-tables) and the skipped step are refused by
      // name (PlanOrderError), a failing step stops the run, and no switch skips a step (P0-2).
      expect(passedFor(outcome, "A-03-TC-002")).toBeGreaterThanOrEqual(1);
    });
  });

  test.describe("A-03-TC-006 Capture stops on the first 403 or challenge", () => {
    test("@scenario:A-03-TC-006", async () => {
      await expectSuitePassed("tc-006", {
        runner: "npx",
        cwd: resolve(repoRoot, "pipeline/oracle-runtime"),
        files: ["test/travis/socrata-adapter.test.ts"],
        nameFilter: "A-03-TC-006",
      });
    });
  });

  test.describe("A-03-TC-027 Label map covers every reason in missingReasons", () => {
    test("@scenario:A-03-TC-027", async () => {
      await expectSuitePassed("tc-027", {
        runner: "pnpm",
        cwd: resolve(repoRoot, "packages/shared"),
        files: ["test/missing-labels.test.ts", "test/labels-extra.test.ts"],
        nameFilter: "A-03-TC-027",
      });
    });
  });

  test.describe("A-03-TC-029 Empty state only for a true manifest 0; count mismatch otherwise", () => {
    test("@scenario:A-03-TC-029", async () => {
      await expectSuitePassed("tc-029", {
        runner: "pnpm",
        cwd: resolve(repoRoot, "apps/web"),
        files: ["test/permits-state.test.ts"],
        nameFilter: "A-03-TC-029",
      });
    });
  });

  test.describe("A-03-TC-052 CDK assertions: retention, DLQ alarms, SNS email, budget, tracing", () => {
    test("@scenario:A-03-TC-052", async () => {
      await expectSuitePassed("tc-052", {
        runner: "pnpm",
        cwd: resolve(repoRoot, "infra"),
        files: ["test/stacks.test.ts"],
      });
    });
  });

  test.describe("A-03-TC-053 No reserved concurrency; stage throttle 10 rps / burst 20", () => {
    test("@scenario:A-03-TC-053", async () => {
      await expectSuitePassed("tc-053", {
        runner: "pnpm",
        cwd: resolve(repoRoot, "infra"),
        files: ["test/api.test.ts"],
      });
    });
  });
});
