// A-13 performance cases (T033; testplans/A-13-test-cases.md § 8): TC-041 (5 timed runs per Filters
// search on the hosted site since 2026-10-25, 20 for the operator benchmark; see A-16 gap 1, p95 < 3 s,
// input change → updated header, engine = server per FR-006a) and TC-082 (initial JS ≤ 300 KB
// gzipped excluding DuckDB). TC-041 "Wait for A-11": today it runs on the single published run and
// is recorded as provisional. TC-040 (first DuckDB-WASM load of the Explore SQL tab) was removed
// with the SQL tab (PO decision 2026-10-26). Timings are written to
// docs/evidence/A-13-TC-{nnn}-timings.json and attached to the report. Nearest-rank percentiles
// (lib/perf.ts).
import type { Page } from "@playwright/test";
import { ROUTES } from "@countylens/shared";
import {
  EXPLORE_SEARCH,
  checkpoint,
  evidenceJson,
  expect,
  isDuckdbWasm,
  nextSearch,
  noteBranch,
  ready,
  setControl,
  test,
} from "./lib/a13-fixtures.js";
import { SEL, exploreUrl, scenario, trpcData } from "./lib/a13-ui.js";
import {
  PER_RUN_TIMEOUT_MS,
  radiusHeaderPattern,
  runFailureMessage,
  searchRadii,
  seriesBudgetMs,
} from "./lib/a13-perf-runs.js";
import { LIMITS, QUERY_SAMPLE_RUNS, summarize } from "./lib/perf.js";

const EXPLORE = ROUTES.explore;
/** The radius in the URL the TC-041 series open at (that search is cached by the page). */
const URL_RADIUS = 5;
/** The untimed warm-up radius: outside the timed list (3..8 mi except 5), so no run repeats it. */
const WARM_UP_RADIUS = 2.75;
/** NFR-002: initial JS ≤ 300 KB gzipped (transferred). */
const JS_BUDGET_BYTES = 317_440;

test.describe("A-13 perf", { tag: "@a13-perf" }, () => {
  test.describe.configure({ mode: "serial" });

  /**
   * One timed search: input change -> header names the new radius, bounded by PER_RUN_TIMEOUT_MS. The
   * radius is one the page has not searched yet (see a13-perf-runs.ts), so each run is a real
   * explore.search; the header text of the new radius is the "updated header".
   */
  async function timedRadius(
    page: Page,
    r: number,
    label: string,
    run: number,
  ): Promise<{ ms: number; queryDurationMs: number | null }> {
    const radius = page.getByLabel("Radius", { exact: true });
    const header = page.locator(SEL.header);
    const response = page
      .waitForResponse(
        (res) => EXPLORE_SEARCH.test(res.url()) && res.request().method() !== "OPTIONS",
        { timeout: PER_RUN_TIMEOUT_MS },
      )
      .catch(() => null);
    const t0 = Date.now();
    try {
      await setControl(radius, String(r));
      await expect(header).toContainText(radiusHeaderPattern(r), { timeout: PER_RUN_TIMEOUT_MS });
    } catch (error) {
      const cause = error instanceof Error ? (error.message.split("\n")[0] ?? "") : String(error);
      throw new Error(runFailureMessage(label, run, QUERY_SAMPLE_RUNS, r, cause), { cause: error });
    }
    const ms = Date.now() - t0;
    const answered = await response;
    let queryDurationMs: number | null = null;
    if (answered !== null) {
      const data = trpcData(await answered.json().catch(() => null)) as {
        queryDurationMs?: number;
      } | null;
      queryDurationMs = data?.queryDurationMs ?? null;
    }
    return { ms, queryDurationMs };
  }

  async function series(
    page: Page,
    url: string,
    label: string,
    timings: { ms: number[]; radii: number[]; query: (number | null)[] },
  ): Promise<void> {
    // 1. Open once; wait for the first header (the URL radius is already cached by the page).
    await nextSearch(page, () => page.goto(url));
    await ready(page, "explore");
    await expect(page.locator(SEL.header)).toBeVisible();
    // 2. One untimed warm-up at a radius outside the timed list, then QUERY_SAMPLE_RUNS (5) timed runs, each at a new radius (20 in the operator benchmark).
    await timedRadius(page, WARM_UP_RADIUS, label, 0);
    for (const [i, r] of searchRadii(QUERY_SAMPLE_RUNS, URL_RADIUS).entries()) {
      const run = await timedRadius(page, r, label, i + 1);
      timings.ms.push(run.ms);
      timings.radii.push(r);
      timings.query.push(run.queryDurationMs);
    }
  }

  test(scenario("041"), async ({ page, oracle }) => {
    // Two series of 1 warm-up + 5 runs (hosted sample, PO 2026-10-25), each run capped at PER_RUN_TIMEOUT_MS: the budget is the cap
    // times the run count (the 300 s default is a few runs short of that worst case); typical use ~2 min.
    test.setTimeout(seriesBudgetMs(2, QUERY_SAMPLE_RUNS));
    noteBranch(oracle, "provisional until A-11");
    const radiusRoof = {
      ms: [] as number[],
      radii: [] as number[],
      query: [] as (number | null)[],
    };
    const openPermit = {
      ms: [] as number[],
      radii: [] as number[],
      query: [] as (number | null)[],
    };
    let failure: string | null = null;
    try {
      await series(
        page,
        exploreUrl(EXPLORE, { place: "pflugerville", r: URL_RADIUS, roof: 15 }),
        "radius + roof",
        radiusRoof,
      );
      await checkpoint(page, "041", "radius-roof");
      // 3. The open-permit search.
      await series(
        page,
        exploreUrl(EXPLORE, {
          place: "pflugerville",
          r: URL_RADIUS,
          permit: "open_stalled",
          openYrs: 5,
          sort: "open_desc",
        }),
        "open-permit",
        openPermit,
      );
      await checkpoint(page, "041", "open-permit");
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
      throw error;
    } finally {
      // 4. All timings, also of a failed run (the failure names the run and radius).
      const part = (t: typeof radiusRoof): object =>
        t.ms.length === 0
          ? { n: 0, timingsMs: [], radiiMi: [], queryDurationMs: [] }
          : { ...summarize(t.ms), radiiMi: t.radii, queryDurationMs: t.query };
      await evidenceJson("A-13-TC-041-timings.json", {
        case: "A-13-TC-041",
        provisional: oracle.branch === "today",
        runId: oracle.M.runId,
        limitP95Ms: LIMITS.queryP95Ms,
        perRunTimeoutMs: PER_RUN_TIMEOUT_MS,
        failure,
        radiusRoof: part(radiusRoof),
        openPermit: part(openPermit),
      });
    }
    // 5. p50 and p95 per search.
    expect(radiusRoof.ms, "radius + roof runs").toHaveLength(QUERY_SAMPLE_RUNS);
    expect(openPermit.ms, "open-permit runs").toHaveLength(QUERY_SAMPLE_RUNS);
    expect(summarize(radiusRoof.ms).p95Ms, "radius + roof p95").toBeLessThan(LIMITS.queryP95Ms);
    expect(summarize(openPermit.ms).p95Ms, "open-permit p95").toBeLessThan(LIMITS.queryP95Ms);
  });

  test(scenario("082"), async ({ browser }) => {
    const totals: Record<string, number> = {};
    for (const path of [ROUTES.hub, EXPLORE]) {
      // 1. A private window; record scripts until load.
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.goto(path, { waitUntil: "load" });
      await page.waitForLoadState("networkidle");
      // 2. Sum transferred JS bytes, excluding DuckDB-WASM files and workers.
      const entries = await page.evaluate(() =>
        performance
          .getEntriesByType("resource")
          .map((e) => e as PerformanceResourceTiming)
          .map((e) => ({ name: e.name, type: e.initiatorType, bytes: e.encodedBodySize })),
      );
      const js = entries.filter(
        (e) =>
          (/\.m?js(\?|$)/.test(new URL(e.name).pathname) || e.type === "script") &&
          !isDuckdbWasm(new URL(e.name)),
      );
      totals[path] = js.reduce((t, e) => t + e.bytes, 0);
      await checkpoint(page, "082", path === ROUTES.hub ? "hub" : "explore");
      await context.close();
    }
    test.info().annotations.push({ type: "js-bytes", description: JSON.stringify(totals) });
    for (const [path, bytes] of Object.entries(totals)) {
      expect(bytes, `initial JS on ${path}`).toBeLessThanOrEqual(JS_BUDGET_BYTES);
    }
  });
});
