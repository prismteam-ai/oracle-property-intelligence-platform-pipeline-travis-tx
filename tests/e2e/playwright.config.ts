// Hosted Playwright harness (A-03 T023, constitution I: localhost is never evidence).
//
// - Every spec runs against RUNTIME_URL only. Loading this file throws exactly
//   `RUNTIME_URL must be a hosted URL, not localhost: {value}` for a loopback URL and exactly
//   `RUNTIME_URL is not set; set it to the hosted URL` when it is unset (TC-060, lib/runtime-url.ts).
// - One test per G6 test case, titled `@scenario:A-03-TC-nnn`, in the spec file the G6
//   coverage matrix names; `npx playwright test -g "A-03-TC-nnn"` runs one case.
// - Cases that use an AWS profile (lib/aws.ts) also carry `@needs-aws` in their title. Under
//   CI without AWS credentials they are excluded with `grepInvert` and a stderr notice, never
//   reported as passed (lib/needs-aws.ts). Everywhere else they run.
// - Config keys the specs read from the environment: CID_COPY_HOST (required by the specs that
//   read the copy directly), FILEBASE_GATEWAY_HOST, PINATA_GATEWAY_HOST, READPATH_PRIVATE_PREFIX
//   (lib/runtime.ts). The AWS region comes from the profile configuration, never a literal.
import { defineConfig, devices } from "@playwright/test";
import { NEEDS_AWS_EXCLUDED_NOTICE, NEEDS_AWS_PATTERN, needsAwsExcluded } from "./lib/needs-aws.js";
import { runtimeUrl } from "./lib/runtime-url.js";

const baseURL = runtimeUrl();

// Specs that must run alone: perf timings would be skewed by concurrent pages, and the public
// gateways rate-limit per client IP (a burst answers 429 without CORS headers). CI runs projects
// `permits`, `manifest`, `site` and `isolated` as four jobs on separate runners; a plain local
// run runs all four with one worker.
const ISOLATED = [
  "perf.spec.ts",
  "lambda-fallback.perf.spec.ts",
  "fallback.spec.ts",
  "verify-manifest.spec.ts",
  // A-13: the Verify downloads, the first-load timings and the web vitals (public-gateway rate
  // limits and timings must not share a machine with other pages).
  "A-13-verify.spec.ts",
  "A-13-perf.spec.ts",
  "A-13-vitals.spec.ts",
];
// The full-county Permits cases (each loads the whole page) form their own CI job.
const PERMITS = "permits.spec.ts";
// The manifest cases download every published CAR (~2.8 GB for Run 2); a page case run after
// them in the same worker stalled (A-03-TC-012), so they form their own CI job too.
const MANIFEST = "manifest.spec.ts";
// A-13's long spec files each get their own CI job, so they run side by side instead of one after
// the other on the `site` runner (about 40 min in one worker; each is 10-13 min alone).
const A13_SHARDS = {
  "a13-explorer": "A-13-explorer.spec.ts",
  "a13-pages": "A-13-pages.spec.ts",
  "a13-scan": "A-13-scan.spec.ts",
} as const;
// A-14: the Explore · AI tab (real agent asks, 7 s apart, shared Bedrock budget) and the hosted
// MCP endpoint (timing and 429 burst) each run alone, in their own project.
const A14_SHARDS = {
  "a14-agent": "A-14.spec.ts",
  "a14-mcp": "A-14-mcp.spec.ts",
  // Stubbed-response responsive checks (smeargle): no real model or MCP call.
  "a14-responsive": "A-14-responsive.spec.ts",
} as const;
// A-16: the admin cases sign in against Cognito and some need the operator's bridge; the Cost and
// Limits cases read the docs. Each runs alone in its own project; a case without credentials (or
// without the bridge) skips with a stated reason and is never reported as passed. `a16-county`
// times Explore on the full county, asks the agent for real (two Bedrock calls) and calls the MCP
// endpoint (skips without MCP_URL/MCP_TOKEN); `a16-closure` checks the closure docs and the parked
// tests (no browser page). Like the a14 projects, none of these is in the CI e2e matrix.
const A16_SHARDS = {
  "a16-admin": "A-16-admin.spec.ts",
  "a16-cost": "A-16-cost.spec.ts",
  "a16-county": "A-16-county.spec.ts",
  "a16-closure": "A-16-closure.spec.ts",
} as const;
// One report and output folder per CI phase, so the second invocation never clears the first.
const phase = process.env.PW_PHASE ?? "all";

const excludeNeedsAws = needsAwsExcluded();
if (excludeNeedsAws && process.env.TEST_WORKER_INDEX === undefined) {
  process.stderr.write(`${NEEDS_AWS_EXCLUDED_NOTICE}\n`);
}

export default defineConfig({
  testDir: ".",
  testMatch: /.*\.spec\.ts$/,
  testIgnore: ["**/node_modules/**", "**/test-results/**", "**/playwright-report/**"],
  outputDir: `test-results/${phase}`,
  ...(excludeNeedsAws ? { grepInvert: NEEDS_AWS_PATTERN } : {}),
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [
    ["list"],
    ["html", { outputFolder: `playwright-report/${phase}`, open: "never" }],
    ["json", { outputFile: `test-results/${phase}/results.json` }],
  ],
  use: {
    baseURL,
    colorScheme: "light",
    // No DOM snapshots: on the full-county Permits page (~15,000 rows) recording them starved the
    // page and A-03-TC-012 never rendered rows; with snapshots off it passes (A-11). Network,
    // screenshots and sources are still in the trace.
    trace: { mode: "retain-on-failure", snapshots: false, screenshots: true, sources: true },
    screenshot: "only-on-failure",
    video: "off",
    permissions: ["clipboard-read", "clipboard-write"],
  },
  // CI runs each project as its own job on its own runner (ci.yml e2e-hosted matrix).
  projects: [
    {
      name: "permits",
      testMatch: `**/${PERMITS}`,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "manifest",
      testMatch: `**/${MANIFEST}`,
      use: { ...devices["Desktop Chrome"] },
    },
    ...Object.entries(A13_SHARDS).map(([name, file]) => ({
      name,
      testMatch: `**/${file}`,
      use: { ...devices["Desktop Chrome"] },
    })),
    ...Object.entries(A14_SHARDS).map(([name, file]) => ({
      name,
      testMatch: `**/${file}`,
      use: { ...devices["Desktop Chrome"] },
    })),
    ...Object.entries(A16_SHARDS).map(([name, file]) => ({
      name,
      testMatch: `**/${file}`,
      use: { ...devices["Desktop Chrome"] },
    })),
    {
      name: "site",
      testIgnore: [
        ...ISOLATED,
        PERMITS,
        MANIFEST,
        ...Object.values(A13_SHARDS),
        ...Object.values(A14_SHARDS),
        ...Object.values(A16_SHARDS),
      ].map((f) => `**/${f}`),
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "isolated",
      testMatch: ISOLATED.map((f) => `**/${f}`),
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
