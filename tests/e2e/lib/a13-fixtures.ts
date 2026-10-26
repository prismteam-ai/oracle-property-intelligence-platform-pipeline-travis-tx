// Playwright fixtures and page helpers of the A-13 Part 1 specs (T032, T033). Step 0 of every case
// (test plan § 8): read `{RUNTIME_URL}/runs/index.json`, take the latest entry (greatest
// `finishedAt`) and fetch its manifest by CID from Pinata as the oracle `M` (lib/a13.ts). The
// `oracle` fixture does that once per worker; every expected value comes from it at run time.
// Checkpoint screenshots go to docs/evidence/img/A-13-TC-{nnn}-{step}.png.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { test as base, expect, type Locator, type Page, type Request } from "@playwright/test";
import type { RunManifestV1, RunsIndexV1 } from "@countylens/contract";
import {
  fetchA13RunsIndex,
  fetchManifestFromPinata,
  latestRunEntry,
  numberedRunsByFinishedAt,
  runNumber,
  runsByFinishedAt,
  type OracleManifest,
  type RunsIndexEntry,
} from "./a13.js";
import {
  ExploreSearchResult,
  SEL,
  a11Branch,
  a13EvidenceName,
  trpcData,
  type A13Route,
  type GazetteerPlace,
} from "./a13-ui.js";
import { EVIDENCE_IMG_DIR } from "./evidence.js";
import { repoRoot } from "./runtime.js";

export interface A13Oracle {
  readonly index: RunsIndexV1;
  /** Index entries in `finishedAt` order (oldest first). */
  readonly runs: readonly RunsIndexEntry[];
  /** The numbered runs (no pilot slice) in `finishedAt` order: Run N is entry N-1. */
  readonly numbered: readonly RunsIndexEntry[];
  readonly latest: RunsIndexEntry;
  /** Run {n} of the latest run (the numbered runs' 1-based `finishedAt` order). */
  readonly n: number | string;
  /** The latest run's 1-based position among the numbered runs (Compare's `?a=&b=`). */
  readonly position: number;
  readonly manifestCid: string;
  /** The latest manifest `M`, fetched by CID from Pinata and hash-checked. */
  readonly M: RunManifestV1;
  readonly manifestBytes: Uint8Array;
  /** "Waits for A-11" switch (test plan § 3). */
  readonly branch: "a11" | "today";
}

type WorkerFixtures = { oracle: A13Oracle };

export const test = base.extend<Record<never, never>, WorkerFixtures>({
  oracle: [
    // Playwright reads the fixture list from the destructuring pattern, so it must stay `{}`.
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      const index = await fetchA13RunsIndex();
      const latest = latestRunEntry(index);
      const n = runNumber(index, latest.runId);
      if (n === null) throw new Error(`the latest run ${latest.runId} is the pilot slice`);
      const fetched: OracleManifest = await fetchManifestFromPinata(latest.manifestCid);
      await use({
        index,
        runs: runsByFinishedAt(index),
        numbered: numberedRunsByFinishedAt(index),
        latest,
        n,
        position: numberedRunsByFinishedAt(index).findIndex((r) => r.runId === latest.runId) + 1,
        manifestCid: latest.manifestCid,
        M: fetched.manifest,
        manifestBytes: fetched.bytes,
        branch: a11Branch(index.runs.length, fetched.manifest),
      });
    },
    { scope: "worker" },
  ],
});

export { expect };

/** Records which branch of a "Waits for A-11" case ran (test plan § 3). */
export function noteBranch(oracle: A13Oracle, detail = ""): void {
  test.info().annotations.push({
    type: "a11-branch",
    description: `${oracle.branch} (runs=${oracle.runs.length})${detail === "" ? "" : ` · ${detail}`}`,
  });
}

/** Saves docs/evidence/img/A-13-TC-{nnn}-{step}.png and attaches it to the report. */
export async function checkpoint(
  page: Page,
  tc: string,
  step: string | number,
  options: { fullPage?: boolean } = {},
): Promise<string> {
  const name = a13EvidenceName(tc, step);
  mkdirSync(EVIDENCE_IMG_DIR, { recursive: true });
  const path = resolve(EVIDENCE_IMG_DIR, name);
  const body = await page.screenshot({ path, fullPage: options.fullPage ?? false });
  await test.info().attach(name, { body, contentType: "image/png" });
  return `docs/evidence/img/${name}`;
}

/** Writes a JSON evidence file under docs/evidence (timings of the perf cases) and attaches it. */
export async function evidenceJson(fileName: string, value: unknown): Promise<string> {
  const dir = resolve(repoRoot, "docs", "evidence");
  mkdirSync(dir, { recursive: true });
  const body = `${JSON.stringify(value, null, 2)}\n`;
  writeFileSync(resolve(dir, fileName), body);
  await test.info().attach(fileName, { body, contentType: "application/json" });
  return `docs/evidence/${fileName}`;
}

// ---------------------------------------------------------------------------------------
// Network recording
// ---------------------------------------------------------------------------------------

export interface Seen {
  readonly url: URL;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly resourceType: string;
  readonly at: number;
}

export interface NetLog {
  readonly requests: Seen[];
  since(mark: number): Seen[];
  mark(): number;
}

export function recordRequests(page: Page): NetLog {
  const requests: Seen[] = [];
  page.on("request", (req: Request) => {
    requests.push({
      url: new URL(req.url()),
      method: req.method(),
      headers: req.headers(),
      resourceType: req.resourceType(),
      at: Date.now(),
    });
  });
  return {
    requests,
    mark: () => requests.length,
    since: (mark) => requests.slice(mark),
  };
}

export const isDuckdbWasm = (u: URL): boolean =>
  /duckdb/i.test(u.pathname) && /\.(wasm|worker\.js|js)$/i.test(u.pathname);
export const isApiCall = (u: URL): boolean =>
  u.pathname.startsWith("/api/") || u.pathname.includes("/trpc/");
export const EXPLORE_SEARCH = /\/api\/trpc\/(?:[^?]*,)?explore\.search(?:[,?]|$)/;

// ---------------------------------------------------------------------------------------
// Page helpers
// ---------------------------------------------------------------------------------------

/** Waits until the route's section leaves `loading` (ready or error) and returns it. */
export async function settled(page: Page, route: A13Route, timeout = 60_000): Promise<Locator> {
  const section = page.locator(SEL.page(route));
  await expect(section).toBeVisible({ timeout });
  await expect(section).not.toHaveAttribute("data-state", "loading", { timeout });
  return section;
}

/** Waits for the page to be `ready`. */
export async function ready(page: Page, route: A13Route, timeout = 60_000): Promise<Locator> {
  const section = await settled(page, route, timeout);
  await expect(section).toHaveAttribute("data-state", "ready");
  return section;
}

/**
 * Below 840 px the filter sheet is collapsed behind a "Filters" button; press it once so the
 * controls can be reached. A no-op on desktop (button hidden) or when the sheet is open.
 */
export async function ensureFiltersOpen(page: Page): Promise<void> {
  const toggle = page.getByRole("button", { name: "Filters", exact: true });
  if ((await toggle.isVisible()) && (await toggle.getAttribute("aria-expanded")) === "false") {
    await toggle.click();
  }
}

/** Sets a labelled control: `<select>` by option value/label, checkbox on/off, else fill. */
export async function setControl(control: Locator, value: string | boolean): Promise<void> {
  await ensureFiltersOpen(control.page());
  const tag = await control.evaluate((el) => el.tagName.toLowerCase());
  const type = await control.getAttribute("type");
  if (
    typeof value === "boolean" ||
    type === "checkbox" ||
    (await control.getAttribute("role")) === "switch"
  ) {
    await control.setChecked(value === true || value === "true" || value === "1");
    return;
  }
  if (tag === "select") {
    await control.selectOption(value).catch(async () => control.selectOption({ label: value }));
    return;
  }
  await control.fill(value);
  await control.press("Enter").catch(() => undefined);
}

/** Integer in a text with optional en-US grouping. */
export function intOf(text: string): number {
  const m = /-?\d[\d,]*/.exec(text);
  if (m === null) throw new Error(`no integer in "${text}"`);
  return Number(m[0].replace(/,/g, ""));
}

// ---------------------------------------------------------------------------------------
// explore.search and the gazetteer
// ---------------------------------------------------------------------------------------

/** Runs `action` and returns the next parsed `explore.search` response. */
export async function nextSearch(
  page: Page,
  action: () => Promise<unknown>,
  timeout = 30_000,
): Promise<ExploreSearchResult> {
  const [response] = await Promise.all([
    page.waitForResponse(
      (r) => EXPLORE_SEARCH.test(r.url()) && r.request().method() !== "OPTIONS",
      {
        timeout,
      },
    ),
    action(),
  ]);
  expect(response.status(), `explore.search → HTTP ${response.status()}`).toBe(200);
  return ExploreSearchResult.parse(trpcData(await response.json()));
}

const PLACES_JSON = resolve(
  repoRoot,
  "packages",
  "query-core",
  "gazetteer",
  "travis-places@1.0.0",
  "places.json",
);

/** A place of travis-places@1.0.0 by Census name (committed gazetteer file, read at run time). */
export function gazetteerPlace(name: string): GazetteerPlace {
  const rows = JSON.parse(readFileSync(PLACES_JSON, "utf8")) as GazetteerPlace[];
  const row = rows.find((p) => p.name.toLowerCase() === name.toLowerCase());
  if (row === undefined) throw new Error(`travis-places@1.0.0 has no place named ${name}`);
  return row;
}

export interface DemoArea {
  readonly place: GazetteerPlace;
  readonly radiusMi: number;
  /** Counts the presenter recorded for the current run, when the evidence file has them. */
  readonly recorded: { readonly stalled: number; readonly open: number } | null;
  readonly fromEvidence: boolean;
}

const OPEN_PERMITS_EVIDENCE = resolve(repoRoot, "docs", "evidence", "A-13-open-permits.md");

/**
 * TC-009 test data: the area in docs/evidence/A-13-open-permits.md (`place: {name}`,
 * `radius: {r} mi`, `stalled: {n}`, `open: {n}` lines), else Pflugerville 5 mi.
 */
export function demoArea(): DemoArea {
  if (!existsSync(OPEN_PERMITS_EVIDENCE)) {
    return {
      place: gazetteerPlace("Pflugerville"),
      radiusMi: 5,
      recorded: null,
      fromEvidence: false,
    };
  }
  const text = readFileSync(OPEN_PERMITS_EVIDENCE, "utf8");
  const place = /^\s*[-*]?\s*place:\s*(.+?)\s*$/im.exec(text)?.[1] ?? "Pflugerville";
  const radius = Number(/^\s*[-*]?\s*radius:\s*([\d.]+)\s*mi/im.exec(text)?.[1] ?? "5");
  const stalled = /^\s*[-*]?\s*stalled:\s*(\d+)/im.exec(text)?.[1];
  const open = /^\s*[-*]?\s*open:\s*(\d+)/im.exec(text)?.[1];
  return {
    place: gazetteerPlace(place),
    radiusMi: radius,
    recorded:
      stalled === undefined || open === undefined
        ? null
        : { stalled: Number(stalled), open: Number(open) },
    fromEvidence: true,
  };
}

// ---------------------------------------------------------------------------------------
// Parked gaps (PO 2026-10-25, docs/decisions/DEC-A-13-explore-full-county.md)
// ---------------------------------------------------------------------------------------

/** The A-16 "Carried forward from A-13" items a case can be parked under. */
export const PARKED_GAPS = {
  /** Explore search returns HTTP 500 after ~29 s on the full county. */
  exploreSearch:
    "A-16 gap 1: Explore search does not run on the full county (HTTP 500 after ~29 s)",
  /** Run 3 has 255 table parts, 24 tables, 983 MB; the Catalog's footers do not all arrive in 2 min. */
  catalogFooters:
    "A-16 item 19: on Run 3 (255 parts, 983 MB) the Catalog's Parquet footers do not all arrive within the 2-minute test budget",
  /** Five manifest-driven pages exceed the 2.5 s LCP limit on the full county; Manifest CLS 0.132. */
  runsLogLcp:
    "A-16 exception (PO 2026-10-26): on Run 3 Catalog LCP 3.1 s and Manifest LCP 3.3 s (limit 2.5 s); CLS Runs 0.124, Coverage 0.115, Manifest 0.250 (limit 0.1)",
} as const;

/**
 * Skips the case and shows the reason in the report ("skipped"), never as passed. The case is
 * unparked by deleting this call when the A-16 item it names is closed.
 */
export function parkGap(reason: (typeof PARKED_GAPS)[keyof typeof PARKED_GAPS]): void {
  test.fixme(true, `Parked: ${reason}`);
}

/** Routes a multi-route case skips while their A-16 item is open (the other routes still run). */
const PARKED_ROUTES: Readonly<Record<string, (typeof PARKED_GAPS)[keyof typeof PARKED_GAPS]>> = {};

/**
 * True when the route is parked; the skip is recorded as a "parked" annotation in the report, so
 * it is visible and never counted as checked. Unpark by deleting the route from PARKED_ROUTES.
 */
export function parkedRoute(key: string): boolean {
  const reason = PARKED_ROUTES[key];
  if (reason === undefined) return false;
  test.info().annotations.push({ type: "parked", description: `${key}: ${reason}` });
  return true;
}
