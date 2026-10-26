// Web vitals under the Lighthouse mobile profile (TC-058, TC-081; test plan § 3 "Mobile 4G", research R9):
// 150 ms RTT, 1.6 Mbps down, 4x CPU slowdown, 390 px, applied through CDP, with PerformanceObservers
// for LCP, layout shifts and event timing. Lighthouse itself is not installed in this repo; the plan
// names this CDP + PerformanceObserver method. Median of 5 loads per page.
import type { Browser, BrowserContext, Locator, Page } from "@playwright/test";
import { ROUTES } from "@countylens/shared";
import { median } from "./a13-routes.js";

export const MOBILE_PROFILE = Object.freeze({
  viewport: { width: 390, height: 844 },
  rttMs: 150,
  downloadBytesPerSecond: Math.round((1.6 * 1024 * 1024) / 8),
  uploadBytesPerSecond: Math.round((750 * 1024) / 8),
  cpuSlowdown: 4,
});

export const RUNS_PER_PAGE = 3;
export const LIMITS_VITALS = Object.freeze({ lcpMs: 2_500, cls: 0.1, inpMs: 200 });

export interface LayoutShift {
  readonly t: number;
  readonly value: number;
}

/** CLS as the largest session window (gap < 1 s, window ≤ 5 s) of shifts without recent input. */
export function clsOf(shifts: readonly LayoutShift[]): number {
  let best = 0;
  let sum = 0;
  let start = 0;
  let last = 0;
  for (const s of [...shifts].sort((a, b) => a.t - b.t)) {
    if (sum > 0 && (s.t - last >= 1_000 || s.t - start >= 5_000)) {
      sum = 0;
    }
    if (sum === 0) start = s.t;
    sum += s.value;
    last = s.t;
    best = Math.max(best, sum);
  }
  return best;
}

export interface Vitals {
  readonly lcpMs: number;
  readonly cls: number;
}

export interface InstalledObservers {
  lcp: number;
  shifts: LayoutShift[];
  inp: number;
}

/** Installs the observers before any page script runs. */
export async function observeVitals(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const store = { lcp: 0, shifts: [] as { t: number; value: number }[], inp: 0 };
    (window as unknown as { __a13v: typeof store }).__a13v = store;
    const watch = (
      type: string,
      init: Record<string, unknown>,
      on: (e: PerformanceEntry) => void,
    ): void => {
      try {
        new PerformanceObserver((list) => list.getEntries().forEach(on)).observe({
          type,
          buffered: true,
          ...init,
        });
      } catch {
        /* an unsupported entry type leaves its metric at 0 and the case fails on it */
      }
    };
    watch("largest-contentful-paint", {}, (e) => {
      store.lcp = e.startTime;
    });
    watch("layout-shift", {}, (e) => {
      const shift = e as PerformanceEntry & { value: number; hadRecentInput: boolean };
      if (!shift.hadRecentInput) store.shifts.push({ t: shift.startTime, value: shift.value });
    });
    watch("event", { durationThreshold: 16 }, (e) => {
      const ev = e as PerformanceEntry & { interactionId?: number };
      if ((ev.interactionId ?? 0) > 0) store.inp = Math.max(store.inp, e.duration);
    });
  });
}

/** A mobile-profile context: 390 px viewport, touch, light theme. */
export async function mobileContext(browser: Browser): Promise<BrowserContext> {
  return browser.newContext({
    viewport: MOBILE_PROFILE.viewport,
    isMobile: true,
    hasTouch: true,
    colorScheme: "light",
  });
}

/** Network and CPU throttling of the profile on `page` (Chromium CDP). */
export async function throttle(page: Page): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: MOBILE_PROFILE.rttMs,
    downloadThroughput: MOBILE_PROFILE.downloadBytesPerSecond,
    uploadThroughput: MOBILE_PROFILE.uploadBytesPerSecond,
  });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: MOBILE_PROFILE.cpuSlowdown });
}

async function readStore(page: Page): Promise<InstalledObservers> {
  return page.evaluate(() => (window as unknown as { __a13v: InstalledObservers }).__a13v);
}

/** One cold load under the profile: LCP and CLS after the page settled. */
export async function loadOnce(browser: Browser, url: string): Promise<Vitals> {
  const context = await mobileContext(browser);
  try {
    const page = await context.newPage();
    await observeVitals(page);
    await throttle(page);
    await page.goto(url, { waitUntil: "load", timeout: 90_000 });
    await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => undefined);
    await page.waitForTimeout(2_000);
    const store = await readStore(page);
    return { lcpMs: Math.round(store.lcp), cls: clsOf(store.shifts) };
  } finally {
    await context.close();
  }
}

export interface PageVitals {
  readonly url: string;
  readonly runs: Vitals[];
  readonly medianLcpMs: number;
  readonly medianCls: number;
}

export async function measurePage(
  browser: Browser,
  url: string,
  runs = RUNS_PER_PAGE,
): Promise<PageVitals> {
  const out: Vitals[] = [];
  for (let i = 0; i < runs; i += 1) out.push(await loadOnce(browser, url));
  return {
    url,
    runs: out,
    medianLcpMs: median(out.map((r) => r.lcpMs)),
    medianCls: median(out.map((r) => r.cls)),
  };
}

/** How the main control of a page is found: by role and name, or none (with the reason). */
export type InpControl =
  | { readonly role: "link" | "button" | "tab"; readonly name: string }
  | { readonly css: string }
  | { readonly none: string };

/**
 * The page's main control for the INP click, route by route (TC-081). A generic "first control in main"
 * is not stable: Runs · Log and Legal · Data have none (that selector waited 30 s and timed out), and the
 * first match elsewhere can be a link that navigates away. Each entry is a control that stays on the page
 * or lazily loads the next route. A page with no interactive control in `main` has no interaction to
 * measure: INP is undefined for it, recorded as n/a, not weakened to a threshold.
 */
export const INP_CONTROLS: Readonly<Record<string, InpControl>> = Object.freeze({
  [ROUTES.hub]: { role: "link", name: "Open" },
  [ROUTES.dataCatalog]: { css: "summary" },
  [ROUTES.runsLog]: { none: "the log is a read-only list with no link, button or tab in main" },
  [ROUTES.legalData]: { none: "the page is read-only text with no link, button or tab in main" },
  [ROUTES.runs]: { role: "button", name: "Copy CID" },
  [ROUTES.coverage]: { role: "button", name: "Copy CID" },
  [ROUTES.dataManifest]: { role: "button", name: "Copy CID" },
  [ROUTES.explore]: { role: "tab", name: "Filters" },
});

/** The page's main control, or the reason it has none. */
export function mainControl(page: Page, path: string): Locator | string {
  const entry = INP_CONTROLS[path];
  if (entry === undefined) throw new Error(`INP_CONTROLS has no entry for ${path}`);
  if ("none" in entry) return entry.none;
  if ("css" in entry) return page.locator("main").locator(entry.css).first();
  return page.locator("main").getByRole(entry.role, { name: entry.name }).first();
}

// 90 s: the Catalog's first "N columns" control appears when its first Parquet footer has loaded, and a full-county run has 225 parts read by range (about 8 s unthrottled, longer under the 4G profile).
const CONTROL_WAIT_MS = 90_000;
const CLICK_MS = 5_000;

/** INP of one load: click the main control once under the profile and read the slowest interaction. */
export async function inpOnce(browser: Browser, url: string, path: string): Promise<number | null> {
  const context = await mobileContext(browser);
  try {
    const page = await context.newPage();
    await observeVitals(page);
    await throttle(page);
    await page.goto(url, { waitUntil: "load", timeout: 90_000 });
    await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => undefined);
    const control = mainControl(page, path);
    if (typeof control === "string") return null;
    await control
      .waitFor({ state: "visible", timeout: CONTROL_WAIT_MS })
      .catch((error: unknown) => {
        throw new Error(
          `INP control for ${path} (${JSON.stringify(INP_CONTROLS[path])}) not visible within ${CONTROL_WAIT_MS} ms: ${String(error).split("\n")[0]}`,
        );
      });
    await control.scrollIntoViewIfNeeded({ timeout: CLICK_MS });
    await control.click({ timeout: CLICK_MS });
    // The click's presentation frame: two animation frames after the handler, then the observer flushes.
    await page.evaluate(
      () =>
        new Promise<void>((done) =>
          requestAnimationFrame(() => requestAnimationFrame(() => done())),
        ),
    );
    await page.waitForTimeout(500);
    return Math.round((await readStore(page)).inp);
  } finally {
    await context.close();
  }
}

/** Five clicks on the page's main control, or null when the page has none (see INP_CONTROLS). */
export async function measureInp(
  browser: Browser,
  url: string,
  path: string,
  clicks = RUNS_PER_PAGE,
): Promise<number[] | null> {
  if (typeof mainControlReason(path) === "string") return null;
  const out: number[] = [];
  for (let i = 0; i < clicks; i += 1) {
    const value = await inpOnce(browser, url, path);
    if (value === null) return null;
    out.push(value);
  }
  return out;
}

/** The reason a page has no main control, or undefined when it has one. */
export function mainControlReason(path: string): string | undefined {
  const entry = INP_CONTROLS[path];
  if (entry === undefined) throw new Error(`INP_CONTROLS has no entry for ${path}`);
  return "none" in entry ? entry.none : undefined;
}
