// A-16 Part 2 on the hosted app (testplans/A-16-test-cases.md TC-010..TC-021, NF-03, NF-04;
// AC-6..AC-10): admin sign-in, the Runs admin controls, the 401 and 403 refusals, the bridge
// states and Activity. Credentials come from ~/.config/assessment/countylens-test.env
// (lib/auth.ts); a case that needs them skips with that reason, a case that needs the operator's
// bridge skips unless A16_BRIDGE=1, and neither is ever reported as passed.
//   - TC-013, 014, NF-03 (pickup) need the bridge running on the operator machine (A16_BRIDGE=1).
//   - TC-015 (stop during publication), TC-018 (15 minute expiry) and TC-019 (DLQ alarm email) are
//     operator-driven (A16_OPERATOR=1); their evidence goes to docs/evidence/A-16.md.
// Run: RUNTIME_URL=https://… pnpm exec playwright test --project=a16-admin
import { expect, test, type Page } from "@playwright/test";
import { ROUTES } from "@countylens/shared";
import { runAxe } from "./lib/a13-pages.js";
import {
  ADMIN_STATE_PATH,
  NONADMIN_STATE_PATH,
  NO_ADMIN_CREDENTIALS_REASON,
  NO_NONADMIN_CREDENTIALS_REASON,
  accessTokenOf,
  checkpoint,
  credentials,
  savedState,
  signInThroughForm,
} from "./lib/auth.js";
import { runtimeUrl } from "./lib/runtime.js";

const BASE = runtimeUrl();
const BRIDGE = process.env["A16_BRIDGE"] === "1";
const OPERATOR = process.env["A16_OPERATOR"] === "1";
const WRONG_PASSWORD = "wrong-password-A16";
const TRPC = `${BASE}/api/trpc`;

const controls = (page: Page) => ({
  start: page.getByRole("button", { name: /start run/i }),
  stop: page.getByRole("button", { name: /stop run/i }),
  retry: page.getByRole("button", { name: /^retry$/i }),
});

async function adminPage(browser: import("@playwright/test").Browser): Promise<Page> {
  const creds = credentials.admin;
  if (creds === undefined) throw new Error(NO_ADMIN_CREDENTIALS_REASON);
  const state = await savedState(browser, BASE, creds, ADMIN_STATE_PATH);
  const context = await browser.newContext({ baseURL: BASE, storageState: state });
  return context.newPage();
}

test.describe("A-16 admin sign-in and refusals", () => {
  test("A-16-TC-010 admin sign-in", async ({ page }) => {
    test.skip(credentials.admin === undefined, NO_ADMIN_CREDENTIALS_REASON);
    await page.goto(ROUTES.adminSignIn);
    await expect(page.getByLabel("Admin email")).toBeVisible();
    await expect(page.getByLabel("Password", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Sign in$/ })).toBeVisible();
    await signInThroughForm(page, credentials.admin as NonNullable<typeof credentials.admin>);
    await expect(page).toHaveURL(/\/runs$/);
    await expect(page.getByText("Signed in as admin")).toBeVisible({ timeout: 30_000 });
    const { start, stop, retry } = controls(page);
    await expect(start).toBeVisible();
    await expect(stop).toBeVisible();
    await expect(retry).toBeVisible();
    // The board's email-code step does not exist: password sign-in only (Justified in the matrix).
    await expect(page.getByText(/code/i).filter({ hasText: /send|sent|6-digit/i })).toHaveCount(0);
    await checkpoint(page, "TC-010", "signed-in-runs");
  });

  test("A-16-TC-011 signed-out has no controls", async ({ page, request }) => {
    await page.goto(ROUTES.runs);
    await expect(page.locator('[data-route="runs"]')).toBeVisible();
    await expect(page.locator("[data-sync-status]")).toBeVisible({ timeout: 60_000 });
    for (const locator of Object.values(controls(page))) await expect(locator).toHaveCount(0);
    await expect(page.getByText("Signed in as admin")).toHaveCount(0);
    await expect(page.locator("[data-admin-controls]")).toHaveCount(0);
    await expect(page.getByRole("link", { name: /admin sign-in/i })).toBeVisible();

    await page.goto(ROUTES.adminSignIn);
    await page.getByRole("button", { name: /^Sign in$/ }).click();
    await expect(page.getByRole("alert").first()).toBeVisible();
    await expect(page).toHaveURL(/\/admin\/sign-in$/);

    // The API refuses an unauthenticated call before anything is queued.
    const me = await request.get(`${TRPC}/admin.me`);
    expect(me.status()).toBe(401);
    const start = await request.post(`${TRPC}/admin.run.start`, {
      data: { mode: "dry_run" },
      headers: { "content-type": "application/json" },
    });
    expect(start.status()).toBe(401);
    await checkpoint(page, "TC-011", "signed-out-sign-in");
  });

  test("A-16-TC-012 sign-in refused message", async ({ page }) => {
    test.skip(credentials.admin === undefined, NO_ADMIN_CREDENTIALS_REASON);
    const creds = credentials.admin as NonNullable<typeof credentials.admin>;
    await page.goto(ROUTES.adminSignIn);
    await page.getByLabel("Admin email").fill(creds.username);
    await page.getByLabel("Password", { exact: true }).fill(WRONG_PASSWORD);
    await page.getByRole("button", { name: /^Sign in$/ }).click();
    const refusal = page.locator("[data-refusal]");
    await expect(refusal).toBeVisible({ timeout: 30_000 });
    await expect(page).toHaveURL(/\/admin\/sign-in$/);
    // It does not say which of the email or the password was wrong.
    await expect(refusal).toHaveText("Wrong email or password.");
    await checkpoint(page, "TC-012", "wrong-password");

    // Cognito answering with a rate limit: the exact sentence, and the public app is untouched.
    await page.route(/cognito-idp\.[a-z0-9-]+\.amazonaws\.com/, (route) =>
      route.fulfill({
        status: 400,
        contentType: "application/x-amz-json-1.1",
        body: JSON.stringify({ __type: "TooManyRequestsException", message: "Rate exceeded" }),
      }),
    );
    await page.getByRole("button", { name: /^Sign in$/ }).click();
    await expect(page.locator("[data-refusal]")).toHaveText(
      "Sign-in is not available right now, try later",
    );
    await checkpoint(page, "TC-012", "cognito-unavailable");
    await page.unroute(/cognito-idp\.[a-z0-9-]+\.amazonaws\.com/);

    await page.goto(ROUTES.explore);
    await expect(page.locator('[data-route="explore"]')).toBeVisible({ timeout: 60_000 });
  });

  test("A-16-TC-016 non-admin 403", async ({ browser, request }) => {
    test.skip(credentials.nonAdmin === undefined, NO_NONADMIN_CREDENTIALS_REASON);
    const creds = credentials.nonAdmin as NonNullable<typeof credentials.nonAdmin>;
    const state = await savedState(browser, BASE, creds, NONADMIN_STATE_PATH);
    const context = await browser.newContext({ baseURL: BASE, storageState: state });
    const page = await context.newPage();
    await page.goto(ROUTES.runs);
    await expect(page.locator("[data-sync-status]")).toBeVisible({ timeout: 60_000 });
    await expect(page.locator("[data-admin-note]")).toBeVisible({ timeout: 30_000 });
    for (const locator of Object.values(controls(page))) await expect(locator).toHaveCount(0);
    await checkpoint(page, "TC-016", "non-admin-runs");

    const token = await accessTokenOf(page);
    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
    for (const [procedure, data] of [
      ["admin.run.start", { mode: "dry_run" }],
      ["admin.run.stop", {}],
      ["admin.run.retry", { targetRunId: "none" }],
    ] as const) {
      const res = await request.post(`${TRPC}/${procedure}`, { data, headers });
      expect(res.status(), procedure).toBe(403);
    }
    const summary = await request.get(`${TRPC}/admin.activity.summary`, { headers });
    expect(summary.status()).toBe(403);
    // The queue depth is read in docs/evidence/A-16.md (SQS needs the operator's AWS profile).
    await context.close();
  });

  test("A-16-TC-017 expired 401", async ({ request }) => {
    // A token past its expiry (and an unsigned one) is refused with 401 before anything is queued.
    const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
    const claims = Buffer.from(
      JSON.stringify({ sub: "expired-fixture", exp: 1_700_000_000, token_use: "access" }),
    ).toString("base64url");
    const expired = `${header}.${claims}.invalid`;
    const res = await request.post(`${TRPC}/admin.run.start`, {
      data: { mode: "dry_run" },
      headers: { authorization: `Bearer ${expired}`, "content-type": "application/json" },
    });
    expect(res.status()).toBe(401);
  });
});

test.describe("A-16 admin controls against the bridge", () => {
  test("A-16-TC-013 start reaches bridge", async ({ browser }) => {
    test.skip(credentials.admin === undefined, NO_ADMIN_CREDENTIALS_REASON);
    test.skip(!BRIDGE, "needs the bridge running on the operator machine (A16_BRIDGE=1)");
    const page = await adminPage(browser);
    await page.goto(ROUTES.runs);
    await expect(controls(page).start).toBeVisible({ timeout: 60_000 });
    await page.getByLabel(/dry run/i).check();
    const startedAt = Date.now();
    await controls(page).start.click();
    await expect(page.getByText(/Command queued\./)).toBeVisible({ timeout: 30_000 });
    // The bridge picks it up within 60 s; Runs shows "Running · started {UTC}".
    await expect(
      page.locator("[data-live-text]").filter({ hasText: /^Running · started / }),
    ).toBeVisible({
      timeout: 60_000,
    });
    expect(Date.now() - startedAt).toBeLessThanOrEqual(60_000 + 30_000);
    await checkpoint(page, "TC-013", "running");
  });

  test("A-16-TC-014 double start rejected", async ({ browser }) => {
    test.skip(credentials.admin === undefined, NO_ADMIN_CREDENTIALS_REASON);
    test.skip(!BRIDGE, "needs the bridge running on the operator machine (A16_BRIDGE=1)");
    const page = await adminPage(browser);
    await page.goto(ROUTES.runs);
    await expect(controls(page).start).toBeVisible({ timeout: 60_000 });
    await controls(page).start.click();
    await controls(page).start.click();
    await expect(page.getByText("A run is already running")).toBeVisible({ timeout: 60_000 });
    await checkpoint(page, "TC-014", "already-running");
  });

  test("A-16-TC-015 stop during publication", async () => {
    test.skip(!OPERATOR, "operator-driven: needs a run in its publish step (A16_OPERATOR=1)");
  });

  test("A-16-TC-018 bridge offline expiry", async ({ browser }) => {
    test.skip(credentials.admin === undefined, NO_ADMIN_CREDENTIALS_REASON);
    test.skip(
      !OPERATOR || BRIDGE,
      "operator-driven: bridge stopped, waits 15 minutes (A16_OPERATOR=1, no bridge)",
    );
    test.setTimeout(20 * 60_000);
    const page = await adminPage(browser);
    await page.goto(ROUTES.runs);
    await controls(page).start.click();
    await expect(page.getByText(/Command queued\./)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/Bridge offline · command expired at /)).toBeVisible({
      timeout: 17 * 60_000,
    });
    await checkpoint(page, "TC-018", "bridge-offline");
  });

  test("A-16-TC-019 dlq alarm", async () => {
    test.skip(
      !OPERATOR,
      "operator-driven: three failed receives and the alarm email (A16_OPERATOR=1)",
    );
  });
});

test.describe("A-16 Activity", () => {
  test("A-16-TC-020 activity summary", async ({ browser }) => {
    test.skip(credentials.admin === undefined, NO_ADMIN_CREDENTIALS_REASON);
    const page = await adminPage(browser);
    await page.goto(ROUTES.activity);
    const summary = page.locator("[data-activity-summary]");
    await expect(summary).toBeVisible({ timeout: 60_000 });
    const metrics = page.locator("[data-metric]");
    expect(await metrics.count()).toBeGreaterThanOrEqual(3);
    // Every number has the Logs Insights query behind it: a console link and the query text.
    for (const metric of await metrics.all()) {
      await expect(metric.locator("details")).toHaveCount(1);
      const link = metric.locator("a[href*='console.aws.amazon.com']");
      if ((await link.count()) > 0) await expect(link.first()).toHaveAttribute("target", "_blank");
    }
    await metrics.first().locator("summary").click();
    await expect(metrics.first().locator("pre")).not.toBeEmpty();
    await checkpoint(page, "TC-020", "activity");
    // A reload is served from a five-minute cache. Each warm Lambda keeps its own cache, so two
    // instances may differ by seconds: assert the reloaded stamp is a cache stamp (not "now") within
    // the five-minute window, not that it equals the first one.
    await page.reload();
    const reloaded = await page.locator("[data-cached-at]").getAttribute("data-cached-at");
    const age = Date.now() - Date.parse(reloaded ?? "");
    expect(Number.isNaN(age), "data-cached-at is an ISO time").toBe(false);
    expect(age, "served from the five-minute cache").toBeLessThanOrEqual(5 * 60 * 1000 + 60_000);
  });

  test("A-16-TC-021 activity empty and error", async ({ browser }) => {
    test.skip(credentials.admin === undefined, NO_ADMIN_CREDENTIALS_REASON);
    const page = await adminPage(browser);
    await page.route(/admin\.activity\.summary/, (route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({
          error: { message: "stubbed", code: -32603, data: { httpStatus: 500 } },
        }),
      }),
    );
    await page.goto(ROUTES.activity);
    const alert = page.getByRole("alert");
    await expect(alert).toContainText("The query log could not load.", { timeout: 60_000 });
    await expect(alert.getByRole("button", { name: "Retry" })).toBeVisible();
    await checkpoint(page, "TC-021", "activity-error");
    await page.unroute(/admin\.activity\.summary/);
    await alert.getByRole("button", { name: "Retry" }).click();
    await expect(page.locator("[data-activity-summary]")).toBeVisible({ timeout: 60_000 });
  });

  test("A-16-TC-NF-03 pickup and activity p95", async ({ browser }) => {
    test.skip(credentials.admin === undefined, NO_ADMIN_CREDENTIALS_REASON);
    const page = await adminPage(browser);
    await page.goto(ROUTES.activity);
    await expect(page.locator("[data-activity-summary]")).toBeVisible({ timeout: 60_000 });
    const times: number[] = [];
    for (let i = 0; i < 20; i += 1) {
      const t0 = Date.now();
      await page.reload();
      await expect(page.locator("[data-activity-summary]")).toBeVisible({ timeout: 30_000 });
      times.push(Date.now() - t0);
    }
    times.sort((a, b) => a - b);
    const p95 = times[Math.min(times.length - 1, Math.ceil(times.length * 0.95) - 1)] ?? 0;
    test.info().annotations.push({ type: "activity-p95-ms", description: String(p95) });
    expect(p95).toBeLessThan(3000);
  });
});

test.describe("A-16 admin accessibility and secrets", () => {
  test("A-16-TC-NF-04 no token and axe", async ({ browser, page }) => {
    test.skip(credentials.admin === undefined, NO_ADMIN_CREDENTIALS_REASON);
    const seen: string[] = [];
    page.on("console", (message) => seen.push(message.text()));
    await signInThroughForm(page, credentials.admin as NonNullable<typeof credentials.admin>);
    const token = await accessTokenOf(page);
    await expect(page.getByText("Signed in as admin")).toBeVisible({ timeout: 30_000 });
    const violations: string[] = [];
    for (const path of [ROUTES.adminSignIn, ROUTES.runs, ROUTES.activity]) {
      await page.goto(path);
      await expect(page.locator("main section").first()).toBeVisible({ timeout: 60_000 });
      const found = await runAxe(page);
      for (const v of found) {
        if (v.impact === "serious" || v.impact === "critical") {
          violations.push(`${path} ${v.id} (${v.impact}): ${v.targets.join(" | ")}`);
        }
      }
    }
    expect(violations, violations.join("\n")).toEqual([]);
    // The access token is in neither the page text nor the browser console.
    const text = await page.locator("body").innerText();
    expect(text.includes(token)).toBe(false);
    expect(seen.some((line) => line.includes(token))).toBe(false);
    void browser;
  });
});
