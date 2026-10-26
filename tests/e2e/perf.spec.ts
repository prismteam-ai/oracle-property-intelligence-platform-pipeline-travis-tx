// A-03 browser read-path timings on the hosted Permits page (T061; AC-4, FR-004, NFR-001).
//
// The page exposes no debug hook. Its engine emits User Timing entries (apps/web/src/engine/
// timing.ts) that carry names and times only: the measure `countylens:duckdb:init` (between the
// marks `countylens:duckdb:init:start` / `…:end`), the listing `countylens:query:list` and the
// page's own COUNT `countylens:query:count`. The specs read them with
// `performance.getEntriesByType('measure')` after each load.
//
// Very small samples on the hosted CI (PO 2026-10-25; lib/perf.ts FIRST_LOAD_SAMPLES and
// QUERY_SAMPLE_RUNS): each full-county load takes 45-90 s, so 20 + 21 loads never fit the
// 60-minute 'isolated' job. The nearest-rank p95 of a 5-run sample is its slowest run.
// - TC-NF-01: FIRST_LOAD_SAMPLES (2) cold first loads (a fresh browser context each, so nothing is cached), each
//   timed from navigation start to the first rendered permit row and the range line (the page
//   is paged, 200 rows at a time), with the `Loading permits`
//   progress bar seen in between; every load ≤ LIMITS.firstLoadMs (60 s at full-county scale; 8 s on the pilot). The DuckDB init measure of each load is
//   recorded beside it.
// - TC-NF-02: in one context, one untimed warm-up load, then QUERY_SAMPLE_RUNS (5) reloads (the
//   page re-runs its COUNT and listing on each); the `countylens:query:count` and
//   `countylens:query:list` measures of each reload are the timings; each p95 < 3,000 ms. Every reload must end `ready`
//   (the page itself fails when its COUNT or row count differs from the manifest) and show
//   `permits_emitted` rows.
// Timings are attached as JSON for docs/evidence/A-03.md and docs/decisions/0001-read-path.md.
import type { Page } from "@playwright/test";
import { checkpoint } from "./lib/evidence.js";
import { expect, test } from "./lib/fixtures.js";
import {
  FIRST_LOAD_SAMPLES,
  LIMITS,
  QUERY_SAMPLE_RUNS,
  SELECTORS,
  permitsEmitted as permitsEmittedOf,
  summarize,
} from "./lib/perf.js";
import { PAGE_SIZE } from "./lib/permits-pages.js";
import { runtimeUrl } from "./lib/runtime.js";

/** The User Timing names the Permits engine emits (apps/web/src/engine/timing.ts). */
const MEASURES = {
  init: "countylens:duckdb:init",
  list: "countylens:query:list",
  count: "countylens:query:count",
} as const;
type MeasureName = (typeof MEASURES)[keyof typeof MEASURES];

const COLD_LOADS = FIRST_LOAD_SAMPLES;

interface FirstLoadProbe {
  progressAt: number | null;
  firstRowAt: number | null;
}

declare global {
  interface Window {
    __nf01?: FirstLoadProbe;
  }
}

/** Durations (ms) of this document's measures with the given names, waiting until each exists. */
async function readMeasures(
  page: Page,
  names: readonly MeasureName[],
): Promise<Record<MeasureName, number>> {
  await page.waitForFunction(
    (wanted) => {
      const have = new Set(performance.getEntriesByType("measure").map((m) => m.name));
      return wanted.every((n) => have.has(n));
    },
    names,
    { timeout: 30_000 },
  );
  const entries = await page.evaluate(() =>
    performance.getEntriesByType("measure").map((m) => ({ name: m.name, duration: m.duration })),
  );
  const out = {} as Record<MeasureName, number>;
  for (const name of names) {
    // The last entry of that name: a retry in the same document measures again.
    const last = entries.filter((e) => e.name === name).at(-1);
    out[name] = Math.round((last?.duration ?? Number.NaN) * 10) / 10;
  }
  return out;
}

test.describe("A-03-TC-NF-01 browser first load ≤ 60 s (full county, 2 cold loads) with a progress bar", () => {
  test.describe.configure({ timeout: 10 * 60_000 });

  test("@scenario:A-03-TC-NF-01", async ({ browser, run }, testInfo) => {
    const permitsEmitted = permitsEmittedOf(run.manifest);
    expect(permitsEmitted, "the run publishes permits (rows to time)").toBeGreaterThan(0);

    const loads: (FirstLoadProbe & { load: number; duckdbInitMs: number })[] = [];
    for (let load = 1; load <= COLD_LOADS; load += 1) {
      const context = await browser.newContext({ colorScheme: "light" });
      try {
        // Times are milliseconds since navigation start (performance.timeOrigin of the document).
        await context.addInitScript(
          ({ progress, row, range }) => {
            const probe: FirstLoadProbe = { progressAt: null, firstRowAt: null };
            window.__nf01 = probe;
            const check = (): void => {
              if (probe.progressAt === null && document.querySelector(progress)) {
                probe.progressAt = performance.now();
              }
              if (
                probe.firstRowAt === null &&
                document.querySelector(row) &&
                document.querySelector(range)
              ) {
                probe.firstRowAt = performance.now();
                observer.disconnect();
              }
            };
            const observer = new MutationObserver(check);
            observer.observe(document, { childList: true, subtree: true, attributes: true });
          },
          {
            progress: SELECTORS.permitsProgress,
            row: SELECTORS.permitRow,
            range: SELECTORS.permitsRange,
          },
        );
        const page = await context.newPage();
        await page.goto(`${runtimeUrl()}/permits`, { waitUntil: "commit" });
        await page
          .locator(SELECTORS.permitRow)
          .first()
          .waitFor({ state: "visible", timeout: LIMITS.firstLoadMs + 30_000 });
        await page
          .locator(SELECTORS.permitsRange)
          .waitFor({ state: "visible", timeout: LIMITS.firstLoadMs + 30_000 });
        if (load === 1) await checkpoint(page, "NF-01", "load-1-first-row");
        const probe = await page.evaluate(() => window.__nf01 ?? null);
        expect(probe, `load ${load}: the first-load probe ran`).not.toBeNull();
        const measured = await readMeasures(page, [MEASURES.init]);
        loads.push({
          load,
          progressAt: probe?.progressAt ?? null,
          firstRowAt: probe?.firstRowAt ?? null,
          duckdbInitMs: measured[MEASURES.init],
        });
      } finally {
        await context.close();
      }
    }

    const timings = loads.map((l) => Math.round(l.firstRowAt ?? Number.POSITIVE_INFINITY));
    const firstLoad = summarize(timings);
    const duckdbInit = summarize(loads.map((l) => l.duckdbInitMs));
    await testInfo.attach("tc-nf-01-first-loads.json", {
      body: JSON.stringify(
        { url: `${runtimeUrl()}/permits`, loads, timingsMs: timings, firstLoad, duckdbInit },
        null,
        2,
      ),
      contentType: "application/json",
    });
    for (const l of loads) {
      expect
        .soft(l.progressAt, `load ${l.load}: progress bar "Loading permits" shown`)
        .not.toBeNull();
      expect.soft(l.firstRowAt, `load ${l.load}: a permit row rendered`).not.toBeNull();
      if (l.progressAt !== null && l.firstRowAt !== null) {
        expect
          .soft(l.progressAt, `load ${l.load}: progress bar before the first row`)
          .toBeLessThan(l.firstRowAt);
      }
      expect
        .soft(l.duckdbInitMs, `load ${l.load}: ${MEASURES.init} measured`)
        .toBeGreaterThanOrEqual(0);
      expect
        .soft(
          Math.round(l.firstRowAt ?? Number.POSITIVE_INFINITY),
          `load ${l.load}: first load ≤ ${LIMITS.firstLoadMs} ms`,
        )
        .toBeLessThanOrEqual(LIMITS.firstLoadMs);
    }
    expect(loads).toHaveLength(COLD_LOADS);
  });
});

test.describe("A-03-TC-NF-02 COUNT and listing p95 < 3 s in the browser (5 timed reloads)", () => {
  test.describe.configure({ timeout: 10 * 60_000 });

  test("@scenario:A-03-TC-NF-02", async ({ browser, run }, testInfo) => {
    const permitsEmitted = permitsEmittedOf(run.manifest);
    const context = await browser.newContext({ colorScheme: "light" });
    const runs: { run: number; countMs: number; listMs: number; rows: number; total: number }[] =
      [];
    let warmup: Record<MeasureName, number> | undefined;
    try {
      const page = await context.newPage();
      /** One page load: wait for `ready`, then read the two query measures of this document. */
      const loadOnce = async (
        navigate: () => Promise<unknown>,
      ): Promise<{ measured: Record<MeasureName, number>; rows: number; total: number }> => {
        await navigate();
        await page.locator(SELECTORS.permitsReady).waitFor({ state: "visible", timeout: 60_000 });
        const measured = await readMeasures(page, [MEASURES.count, MEASURES.list]);
        const total = await page
          .locator(SELECTORS.permitsRange)
          .evaluate((element) => Number(element.getAttribute("data-total")));
        return { measured, rows: await page.locator(SELECTORS.permitRow).count(), total };
      };

      // Untimed warm-up: the first load fills the HTTP cache (WASM, worker, parts).
      warmup = (
        await loadOnce(() =>
          page.goto(`${runtimeUrl()}/permits`, { waitUntil: "domcontentloaded" }),
        )
      ).measured;
      for (let i = 1; i <= QUERY_SAMPLE_RUNS; i += 1) {
        const { measured, rows, total } = await loadOnce(() =>
          page.reload({ waitUntil: "domcontentloaded" }),
        );
        runs.push({
          run: i,
          countMs: measured[MEASURES.count],
          listMs: measured[MEASURES.list],
          rows,
          total,
        });
      }
      await checkpoint(page, "NF-02", `after-${QUERY_SAMPLE_RUNS}-reloads-listing`);
    } finally {
      await context.close();
    }

    const count = summarize(runs.map((r) => r.countMs));
    const list = summarize(runs.map((r) => r.listMs));
    await testInfo.attach("tc-nf-02-timings.json", {
      body: JSON.stringify(
        {
          url: `${runtimeUrl()}/permits`,
          manifestCid: run.manifestCid,
          source: "performance.getEntriesByType('measure')",
          measures: { count: MEASURES.count, list: MEASURES.list },
          warmupMs: warmup,
          runs,
          count,
          list,
        },
        null,
        2,
      ),
      contentType: "application/json",
    });

    expect(count.n).toBe(QUERY_SAMPLE_RUNS);
    expect(list.n).toBe(QUERY_SAMPLE_RUNS);
    for (const r of runs) {
      expect
        .soft(r.total, `run ${r.run}: the listing's total is permits_emitted`)
        .toBe(permitsEmitted);
      expect
        .soft(r.rows, `run ${r.run}: page 1 shows min(${PAGE_SIZE}, permits_emitted) rows`)
        .toBe(Math.min(PAGE_SIZE, permitsEmitted));
    }
    expect.soft(count.p95Ms, `COUNT p95 < ${LIMITS.queryP95Ms} ms`).toBeLessThan(LIMITS.queryP95Ms);
    expect(list.p95Ms, `listing p95 < ${LIMITS.queryP95Ms} ms`).toBeLessThan(LIMITS.queryP95Ms);
  });
});
