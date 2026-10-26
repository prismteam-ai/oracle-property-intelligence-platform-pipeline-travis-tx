// A-13 Part 1 explorer cases (T032; testplans/A-13-test-cases.md § 7–8): Runs, Compare, Coverage,
// Data · Manifest, Explore · Filters and the Property drawer. One test per case, titled
// exactly `@scenario:A-13-TC-{nnn}`, steps as written in the test plan. Every expected value is
// read at run time from the `oracle` fixture (runs/index.json + the latest manifest by CID from
// Pinata), or the explore.search response; the only fixed numbers are the
// dated Pflugerville references (2026-10-19, re-measured at run time). Fixed strings come from
// @countylens/shared; the two the package does not export yet are in lib/a13-ui.ts. Faults are
// injected with page.route() in this browser only. The DOM contract is in lib/a13-ui.ts.
import type { Locator, Page, Route } from "@playwright/test";
import {
  DERIVATION_LABELS,
  EXPLORE_TEXTS,
  MISSING_REASON_LABELS,
  ROUTES,
  RUNS_TEXTS,
  missingLabel,
} from "@countylens/shared";
import {
  EXPLORE_SEARCH,
  checkpoint,
  demoArea,
  expect,
  gazetteerPlace,
  intOf,
  isDuckdbWasm,
  nextSearch,
  noteBranch,
  ready,
  recordRequests,
  settled,
  ensureFiltersOpen,
  setControl,
  test,
  type A13Oracle,
} from "./lib/a13-fixtures.js";
import {
  CONTRACTOR_STATES,
  COVERAGE_KIND_ABSENT_TEXT,
  KIND_IDS,
  ExploreSearchResult,
  SEL,
  chipYears,
  expectedBbbText,
  expectedContractorText,
  exploreUrl,
  fallbackText,
  isBlankCell,
  looksLikeStack,
  openYears,
  placeSuggestion,
  scenario,
  templatePattern,
  trpcData,
  type ExploreRowShape,
} from "./lib/a13-ui.js";
import { fetchAllManifests } from "./lib/a13.js";
import { harnessConfig, requireCidCopyHost } from "./lib/runtime.js";

const FILEBASE = (): string => harnessConfig().FILEBASE_GATEWAY_HOST;
const PINATA = (): string => harnessConfig().PINATA_GATEWAY_HOST;
const ORBITOR = (): string => harnessConfig().ORBITOR_GATEWAY_HOST;
const EXPLORE = ROUTES.explore;
/** The wide area of TC-026 (downtown Austin, 25 mi) so today's run returns rows. */
const WIDE = { at: "30.2672,-97.7431", r: 25 } as const;

// ---------------------------------------------------------------------------------------
// Shared assertions
// ---------------------------------------------------------------------------------------

/** An instant is shown as the ISO text + " UTC" or as `<time datetime>` equal to it (A-03 rule). */
async function expectInstant(container: Locator, iso: string): Promise<void> {
  const text = await container.innerText();
  if (text.includes(iso) && /UTC|Z/.test(text)) return;
  const stamps = await container
    .locator("time[datetime]")
    .evaluateAll((els) => els.map((el) => el.getAttribute("datetime") ?? ""));
  expect(
    stamps.some((s) => Date.parse(s) === Date.parse(iso)),
    `instant ${iso} shown (time[datetime] values: ${stamps.join(", ")})`,
  ).toBe(true);
  expect(text).toMatch(/UTC/);
}

function artifactCids(M: A13Oracle["M"]): Set<string> {
  const cids = new Set<string>();
  for (const a of M.artifacts) {
    cids.add(a.cid);
    if (a.carCid) cids.add(a.carCid);
  }
  return cids;
}

/** Browser responses whose URL names `cid`, by host. */
function responseHosts(page: Page, cid: string): Set<string> {
  const hosts = new Set<string>();
  page.on("response", (r) => {
    if (r.url().includes(cid) && r.ok()) hosts.add(new URL(r.url()).host);
  });
  return hosts;
}

/** The fallback chip shows exactly when Filebase served a read of `cid` (FR-016). */
async function expectFallbackChip(page: Page, hosts: Set<string>): Promise<void> {
  const chip = page.getByText(fallbackText(FILEBASE()), { exact: true });
  if (hosts.has(FILEBASE())) await expect(chip.first()).toBeVisible();
  else await expect(chip).toHaveCount(0);
}

/** Row fields of TC-026 with provenance, checked against the explore.search row. */
async function expectRowFields(
  row: Locator,
  data: ExploreRowShape | undefined,
  oracle: A13Oracle,
): Promise<void> {
  // A-16 (Task B listing): a result card keeps basis and lat/lon behind "Expand details".
  const expand = row.getByRole("button", { name: "Expand details" });
  if ((await expand.count()) > 0) await expand.click();
  for (const field of [
    "address",
    "roof_age_years",
    "roof_age_basis",
    "roof_age_confidence",
    "distance",
    "lat_lon",
  ]) {
    const cell = row.locator(SEL.field(field)).first();
    await expect(cell, `row cell ${field}`).toBeVisible();
    expect(isBlankCell(await cell.innerText()), `cell ${field} is not blank`).toBe(false);
  }
  if (data !== undefined) {
    if (data.address === null) {
      await expect(row.locator(SEL.field("address")).first()).toHaveText(
        EXPLORE_TEXTS.addressNotInExport,
      );
    }
    await expect(row.locator(SEL.field("distance")).first()).toContainText(data.bearing);
    await expect(row.locator(SEL.field("distance")).first()).toContainText("mi");
  }
  const provenance = row.locator(SEL.provenance).first();
  await expect(provenance).toContainText(oracle.M.runId);
  const tableCid = await provenance.locator(SEL.cid).first().getAttribute("data-cid");
  expect(
    tableCid !== null && artifactCids(oracle.M).has(tableCid),
    `table CID ${tableCid} in M`,
  ).toBe(true);
}

/** The derivation group a coverage row sits in (its label is said once per group). */
const derivationGroup = (row: Locator): Locator =>
  row.locator("xpath=ancestor::*[@data-derivation][1]");

/** The kind card a coverage row belongs to. */
const kindCardOf = (row: Locator): Locator => row.locator("xpath=ancestor::*[@data-kind][1]");

/**
 * A "Published vs each source's own total" row: the source_total key when M has one, else the
 * records read (sources[].records); published rows are a coverage key of M, or "—".
 */
async function expectSourceRow(
  row: Locator,
  s: A13Oracle["M"]["sources"][number],
  M: A13Oracle["M"],
): Promise<void> {
  await expect(row).toHaveCount(1);
  await expect(row).toContainText(s.name);
  const total = M.coverage[`source_total:${s.name}`];
  if (total === undefined) {
    await expect(row.locator("[data-records]")).toHaveAttribute("data-records", String(s.records));
  } else {
    expect(intOf(await row.locator(SEL.count).first().innerText())).toBe(total.count);
  }
  const published = row.locator("[data-published]");
  if ((await published.count()) === 0) {
    await expect(row).toContainText("—");
    return;
  }
  const key = (await published.getAttribute("data-published-key")) ?? "";
  expect(M.coverage[key], `published key ${key} in M.coverage`).toBeDefined();
  await expect(published).toHaveAttribute("data-published", String(M.coverage[key]?.count));
}

/** The table chip of the kind a coverage row belongs to names a table whose CID is in M. */
async function expectKindTable(row: Locator, M: A13Oracle["M"]): Promise<void> {
  const kindCard = row.locator("xpath=ancestor::*[@data-kind][1]");
  const chip = kindCard.locator(SEL.table).first();
  // AC-2: a kind shows the published table it comes from, or says in words that it has none
  // (contractor states are the run's internal match, not a published table).
  if ((await kindCard.locator(SEL.table).count()) === 0) {
    await expect(kindCard, "no table chip: the reason in words").toContainText(
      /no published table for this kind/i,
    );
    return;
  }
  await expect(chip, "the kind's table chip").toBeVisible();
  const table = (await chip.getAttribute("data-table")) ?? "";
  const cid = await chip.locator(SEL.cid).first().getAttribute("data-cid");
  expect(cid !== null && artifactCids(M).has(cid), `table ${table} CID ${cid} in M`).toBe(true);
  expect(
    // `{group}/{table}`: a pilot part is `tables/<group>/<table>/…`, a full-county part
    // `…/tables/<bNN>/<table>/…`, so match the table folder (its CID is checked above).
    M.artifacts.some(
      (a) => a.kind === "table" && a.name.split("/").at(-2) === table.split("/").at(-1),
    ),
    `table ${table} in M`,
  ).toBe(true);
}

const byCid = (result: ExploreSearchResult): Map<string, ExploreRowShape> =>
  new Map(result.rows.map((r) => [r.property_cid, r]));

/** Places the cursor in the Place box, types `text` and returns the listbox options. */
async function typePlace(page: Page, text: string): Promise<Locator> {
  await ensureFiltersOpen(page);
  const box = page.getByRole("combobox", { name: "Place" });
  await box.fill(text);
  return page.getByRole("option");
}

/** Opens Explore and waits for the first search. */
async function openExplore(page: Page, url: string): Promise<ExploreSearchResult> {
  const result = await nextSearch(page, () => page.goto(url));
  await ready(page, "explore");
  return result;
}

/**
 * Every explore.search response the page receives, with the request it answered (ERR-48). The
 * page shows the answer to its LAST request; picking "the first response after an action" can
 * take an earlier request's answer (in-flight on a slow runner), whose close matches differ.
 */
function trackSearches(page: Page): {
  readonly request: Record<string, unknown>;
  readonly result: ExploreSearchResult;
}[] {
  const seen: { request: Record<string, unknown>; result: ExploreSearchResult }[] = [];
  page.on("response", (response) => {
    if (!EXPLORE_SEARCH.test(response.url()) || response.request().method() === "OPTIONS") return;
    void (async () => {
      try {
        const url = new URL(response.url());
        const raw = url.searchParams.get("input");
        const body: unknown = raw === null ? response.request().postDataJSON() : JSON.parse(raw);
        const first = (body as Record<string, unknown> | null)?.["0"] ?? body;
        const request = ((first as { json?: unknown } | null)?.json ?? first) as Record<
          string,
          unknown
        >;
        seen.push({ request, result: ExploreSearchResult.parse(trpcData(await response.json())) });
      } catch {
        // an aborted or unparsable response is not an answer
      }
    })();
  });
  return seen;
}

async function expectHeader(
  page: Page,
  n: number,
  r: number,
  place: string,
  roof: number,
): Promise<void> {
  await expect(page.locator(SEL.header)).toHaveText(EXPLORE_TEXTS.header(n, r, place, roof));
}

// ---------------------------------------------------------------------------------------
// Demo lines D-2 … D-9
// ---------------------------------------------------------------------------------------

test.describe("A-13 explorer · demo lines", () => {
  test(scenario("002"), async ({ page, oracle }) => {
    const { M } = oracle;
    noteBranch(oracle);
    const hosts = responseHosts(page, oracle.manifestCid);
    // 1. Open /runs → progress bar, then the latest run card.
    await page.goto(ROUTES.runs);
    const section = await ready(page, "runs");
    const card = section.locator("article").filter({
      has: page.getByRole("heading", { level: 2, name: M.runId }),
    });
    await expect(card).toBeVisible();
    await checkpoint(page, "002", 1);
    // 2. runId, startedAt and finishedAt in UTC.
    await expectInstant(card, M.startedAt);
    await expectInstant(card, M.finishedAt);
    // 3. One row per source with name, records, captured_at and watermark.
    for (const s of M.sources) {
      const row = section.locator(SEL.source(s.name));
      await expect(row).toHaveCount(1);
      await expect(row).toContainText(s.name);
      const grouped = s.records.toLocaleString("en-US");
      await expect(row).toContainText(new RegExp(`(^|\\D)(${s.records}|${grouped}) records`));
      await expectInstant(row, s.captured_at);
      if (s.watermark !== null) await expect(row).toContainText(s.watermark);
    }
    await checkpoint(page, "002", 3);
    // 4. Per-source deltas (TC-010 covers the first-run case).
    for (const s of M.sources) {
      const row = section.locator(SEL.source(s.name));
      if (M.previousManifestCid === null) {
        await expect(row.getByText(RUNS_TEXTS.firstRun, { exact: true })).toBeVisible();
      } else {
        await expect(row.locator(SEL.delta("added"))).toHaveText(s.added.toLocaleString("en-US"));
        await expect(row.locator(SEL.delta("changed"))).toHaveText(
          s.changed.toLocaleString("en-US"),
        );
        await expect(row.locator(SEL.delta("removed"))).toHaveText(
          s.removed.toLocaleString("en-US"),
        );
      }
    }
    // 5. Limitations and the Next sync line.
    await expect(page.getByRole("list", { name: "Limitations" })).toBeVisible();
    await expect(page.getByText(RUNS_TEXTS.nextSync, { exact: true })).toBeVisible();
    // 6. The fallback chip shows exactly when Filebase served a read.
    await expectFallbackChip(page, hosts);
    await checkpoint(page, "002", 6, { fullPage: true });
  });

  test(scenario("003"), async ({ page, oracle }) => {
    const { M } = oracle;
    noteBranch(oracle);
    // 1. Open Coverage.
    await page.goto(ROUTES.coverage);
    const section = await ready(page, "coverage");
    await checkpoint(page, "003", 1);
    // 2. Rows for every record kind (contractor by its five states).
    for (const kind of KIND_IDS) await expect(section.locator(SEL.kind(kind))).toHaveCount(1);
    // Read the rendered text (innerText): textContent fuses adjacent blocks ("unresolved" + the
    // next row's "contractor" becomes "unresolvedcontractor"), which no reader sees.
    const contractorText = await section.locator(SEL.kind("contractor")).innerText();
    for (const state of CONTRACTOR_STATES) {
      expect(contractorText, `contractor state ${state}`).toMatch(
        new RegExp(`\\b${state}\\b`, "i"),
      );
    }
    // 3. Each row with a coverage key: count, derivation label, collection time, table + CID.
    const rows = section.locator(SEL.coverageKey);
    const keys = await rows.evaluateAll((els) =>
      els.map((el) => el.getAttribute("data-coverage-key") ?? ""),
    );
    for (const key of keys) {
      const entry = M.coverage[key];
      expect(entry, `coverage key ${key} is in M.coverage`).toBeDefined();
      if (entry === undefined) continue;
      const row = section.locator(`[data-coverage-key="${key}"]`).first();
      expect(intOf(await row.locator(SEL.count).first().innerText())).toBe(entry.count);
      // PO 2026-10-26: the derivation label heads its group of rows and the collection time is
      // the kind's one source line, so neither repeats on every row.
      await expect(
        derivationGroup(row).getByText(DERIVATION_LABELS[entry.derivation], { exact: true }),
      ).toBeVisible();
      await expect(kindCardOf(row).locator("time[datetime]").first()).toBeAttached();
      await expectKindTable(row, M);
    }
    await checkpoint(page, "003", 3, { fullPage: true });
    // 4. Each source: its own total (a source_total key, else the records read at capture) and
    // its published rows from the manifest.
    for (const s of M.sources)
      await expectSourceRow(section.locator(SEL.denominator(s.name)), s, M);
    // 5. Each record kind's own card says its denominator (T046, FR-002): the manifest value, or
    // the reason; never blank. Every card carries the in-card line.
    const cards = section.locator("[data-kind]:not([data-kind='other'])");
    const cardCount = await cards.count();
    expect(cardCount, "record kind cards").toBeGreaterThanOrEqual(5);
    for (let i = 0; i < cardCount; i++) {
      const line = cards.nth(i).locator("[data-kind-denominator]");
      await expect(line, `kind card ${i} denominator line`).toHaveCount(1);
      expect(
        (await line.innerText()).trim().length,
        `kind card ${i} denominator text`,
      ).toBeGreaterThan(0);
    }
    await checkpoint(page, "003", 4, { fullPage: true });
  });

  test(scenario("005"), async ({ page, oracle }) => {
    const { M } = oracle;
    const hosts = responseHosts(page, oracle.manifestCid);
    // 1. Open Data · Manifest.
    await page.goto(ROUTES.dataManifest);
    const section = await ready(page, "data-manifest");
    // 2. Run chain first, latest → oldest, each with Verify and Copy CID.
    const chain = section.locator(SEL.chainEntry);
    // The chain follows previousManifestCid from the latest run (an index entry that no manifest
    // links to, such as the pilot slice run, is not part of it).
    const byCid = new Map(
      (await fetchAllManifests(oracle.index)).map((m) => [m.manifestCid, m.manifest]),
    );
    const expectedChain: string[] = [];
    for (let cid: string | null = oracle.manifestCid; cid !== null;) {
      expectedChain.push(cid);
      cid = byCid.get(cid)?.previousManifestCid ?? null;
    }
    await expect(chain).toHaveCount(expectedChain.length);
    for (const [i, cid] of expectedChain.entries()) {
      const entry = chain.nth(i);
      await expect(entry).toHaveAttribute("data-cid", cid);
      await expect(entry.getByRole("link", { name: "Verify", exact: true })).toBeVisible();
      await expect(
        entry.getByRole("button", { name: "Copy CID", exact: true }).first(),
      ).toBeVisible();
    }
    if (M.previousManifestCid === null) await expect(chain.first()).toContainText("previous: none");
    await checkpoint(page, "005", 2);
    // 3–4. One row per artifact, every field equal to M.
    const expectRows = async (): Promise<void> => {
      await expect(section.locator(SEL.artifactRows)).toHaveCount(M.artifacts.length);
      for (const a of M.artifacts) {
        const row = section.locator(SEL.artifactTable).locator(SEL.artifactRow(a.name));
        await expect(row).toHaveCount(1);
        await expect(row.locator(`[data-cid="${a.cid}"]`).first()).toBeAttached();
        await expect(row.locator("[data-codec]")).toHaveText(a.codec);
        await expect(row.locator("[data-size]")).toHaveAttribute("data-size", String(a.size));
        await expect(row.locator("[data-sha256]")).toHaveAttribute("data-sha256", a.sha256);
        if (a.carCid) await expect(row.locator(`[data-car-cid="${a.carCid}"]`)).toBeAttached();
      }
      expect(await section.innerText()).not.toMatch(/ipns/i);
    };
    await expectRows();
    await checkpoint(page, "005", 4, { fullPage: true });
    // 5. Fallback chip exactly when Filebase served the read.
    await expectFallbackChip(page, hosts);
    // 6. Reload with the CID copy aborted → the same rows with the fallback chip.
    const gateways = new Set([FILEBASE(), PINATA(), ORBITOR(), new URL(page.url()).host]);
    await page.route(
      (url) => url.href.includes(oracle.manifestCid) && !gateways.has(url.host),
      (route: Route) => route.abort("failed"),
    );
    await page.reload();
    await ready(page, "data-manifest");
    await expectRows();
    await expect(page.getByText(fallbackText(FILEBASE()), { exact: true }).first()).toBeVisible();
    await checkpoint(page, "005", 6, { fullPage: true });
  });

  test(scenario("007"), async ({ page, oracle }) => {
    noteBranch(oracle);
    // Compare speaks run numbers: the numbered runs (no pilot slice), Run N = numbered[N-1].
    // Compare's URL speaks positions among the numbered runs; labels use the run-ID number.
    const { numbered, position: n } = oracle;
    if (numbered.length >= 2) {
      const prev = numbered[n - 2];
      const last = numbered[n - 1];
      if (prev === undefined || last === undefined) throw new Error("run index out of order");
      // 1. Compare n-1 with n.
      await page.goto(`${ROUTES.runsCompare}?a=${n - 1}&b=${n}`);
      const section = await ready(page, "runs-compare");
      // 2. Two distinct manifest CIDs equal to the index entries.
      const cols = section.locator(SEL.compareRun);
      await expect(cols).toHaveCount(2);
      await expect(cols.nth(0)).toHaveAttribute("data-cid", prev.manifestCid);
      await expect(cols.nth(1)).toHaveAttribute("data-cid", last.manifestCid);
      expect(prev.manifestCid).not.toBe(last.manifestCid);
      // 3. previousManifestCid as a link to run n-1.
      await expect(
        section.locator(`a[data-previous-cid="${oracle.M.previousManifestCid ?? ""}"]`),
      ).toBeVisible();
      // Each column links its own previous run; read run n's column (since Run 3, run n-1 has one too).
      await expect(cols.nth(1).locator(`a[data-previous-cid]`)).toHaveAttribute(
        "href",
        new RegExp(prev.manifestCid),
      );
      expect(oracle.M.previousManifestCid).toBe(prev.manifestCid);
      // 4. The resolve pill.
      await expect(page.getByText(RUNS_TEXTS.oldManifestResolves, { exact: true })).toBeVisible({
        timeout: 90_000,
      });
      // 5. CAR link per run and the summed sizes.
      await expect(cols.nth(0).locator(SEL.carLink)).toHaveCount(1);
      await expect(cols.nth(1).locator(SEL.carLink)).toHaveCount(1);
      const sum = oracle.M.artifacts.reduce((t, a) => t + a.size, 0);
      await expect(cols.nth(1).locator(SEL.totalSize)).toHaveAttribute(
        "data-total-size",
        String(sum),
      );
      await checkpoint(page, "007", 5, { fullPage: true });
      return;
    }
    // Today (single run): the TC-014 branch.
    await page.goto(ROUTES.runsCompare);
    await settled(page, "runs-compare");
    await expect(page.getByText(RUNS_TEXTS.firstRun, { exact: true })).toBeVisible();
    await checkpoint(page, "007", "today");
    for (const host of [PINATA(), ORBITOR(), FILEBASE()]) {
      const res = await fetch(`https://${host}/ipfs/${oracle.manifestCid}`, {
        signal: AbortSignal.timeout(60_000),
      });
      expect(res.status, `${host} resolves the manifest CID`).toBe(200);
    }
  });

  test(scenario("008"), async ({ page, oracle }) => {
    noteBranch(oracle);
    const place = gazetteerPlace("Pflugerville");
    const searches = trackSearches(page);
    // 1. Open Explore.
    await page.goto(EXPLORE);
    await settled(page, "explore");
    // 2–3. Type and select the gazetteer suggestion.
    const options = await typePlace(page, "Pflugerville");
    const suggestion = options.filter({ hasText: placeSuggestion(place) });
    await expect(suggestion).toHaveCount(1);
    await checkpoint(page, "008", 2);
    await suggestion.click();
    // 4. Radius 5 mi, roof ≥ 15 yrs. Earlier changes start searches of their own, so the result
    // under test is the LAST answer to the final request (radius 5, roof 15, first page), the one
    // the page shows (ERR-48), not the first response after the last control change.
    await setControl(page.getByLabel("Radius", { exact: true }), "5");
    await setControl(page.getByLabel("Roof age", { exact: true }), "15");
    const answerOf = (): ExploreSearchResult | undefined =>
      searches
        .filter((s) => s.request["radius_mi"] === 5 && s.request["roof"] === 15)
        .filter((s) => s.request["page"] === undefined || s.request["page"] === 0)
        .at(-1)?.result;
    await expect.poll(answerOf, { timeout: 30_000 }).toBeDefined();
    // 5. Header (its count belongs to the same final request).
    await expect(page.locator(SEL.header)).toContainText("roof ≥ 15");
    await page.waitForLoadState("networkidle");
    const result = answerOf();
    if (result === undefined) throw new Error("no explore.search answer for radius 5, roof 15");
    const n = result.total_within_r;
    await expectHeader(page, n, 5, place.name, 15);
    // 6. Engine line and the server's total.
    await expect(page.locator(SEL.engineLine)).toContainText(EXPLORE_TEXTS.engineServer);
    await checkpoint(page, "008", 6);
    // 7. Two ways: server and list (the browser SQL cross-check was removed with the SQL tab,
    // PO decision 2026-10-26).
    const rows = page.locator(SEL.resultRow);
    if (n <= result.rows.length) await expect(rows).toHaveCount(n);
    else test.info().annotations.push({ type: "paged", description: `${n} rows > first page` });
    // 8. Each row's fields (TC-026).
    const data = byCid(result);
    for (const row of await rows.all()) {
      const cid = (await row.getAttribute("data-property-cid")) ?? "";
      await expectRowFields(row, data.get(cid), oracle);
    }
    if (n === 0) {
      await expect(
        page.getByText(EXPLORE_TEXTS.zeroResults(5, result.close_matches.length), { exact: true }),
      ).toBeVisible();
    }
    await checkpoint(page, "008", 8, { fullPage: true });
  });

  test(scenario("009"), async ({ page, oracle }) => {
    noteBranch(oracle);
    const area = demoArea();
    // 1. Open the demo area.
    await openExplore(
      page,
      exploreUrl(EXPLORE, { place: area.place.name.toLowerCase(), r: area.radiusMi, roof: 15 }),
    );
    // 2. Open or stalled, Open ≥ 5 years.
    await setControl(page.getByLabel("Open or stalled", { exact: true }), true);
    await setControl(page.getByLabel("Open ≥", { exact: true }), "5");
    // 3. Sort Open longest.
    const result = await nextSearch(page, () =>
      setControl(page.getByLabel("Sort", { exact: true }), "Open longest"),
    );
    await checkpoint(page, "009", 3);
    // 4. Stalled chips, contractor name and BBB line.
    const chips = page.locator(SEL.permitChip);
    for (const chip of await chips.all()) {
      const text = (await chip.innerText()).trim();
      const x = chipYears(text);
      expect(x, `chip "${text}"`).not.toBeNull();
      if (x === null) continue;
      expect([EXPLORE_TEXTS.stalledNoCarrier(x), EXPLORE_TEXTS.openNoCarrier(x)]).toContain(text);
    }
    for (const r of result.rows) {
      if (r.contractor === null) continue;
      await expect(
        page
          .locator(`${SEL.resultRow}[data-property-cid="${r.property_cid}"]`)
          .locator(SEL.field("contractor_name")),
      ).toHaveText(expectedContractorText(r));
    }
    // 5. The open-permit section.
    const open = result.rows.filter((r) => r.permit?.status_class === "open");
    const allShown = result.total_within_r <= result.rows.length;
    if (open.length === 0 && result.total_within_r > 0 && allShown) {
      // PO 2026-10-26: an open permit includes stalled ones; every match is stalled here.
      await expect(
        page.getByText(EXPLORE_TEXTS.allStalled(result.total_within_r), { exact: true }),
      ).toBeVisible();
    } else if (result.total_within_r === 0) {
      await expect(page.getByText(EXPLORE_TEXTS.noOpenPermits, { exact: true })).toBeVisible();
    }
    // 6. Counts equal the evidence file (A-11) / the API total otherwise. Run 3
    // (travis-full-run3-20261025) publishes open days, so permits open ≥ 5 years now exist
    // (176 near this point, 548 county-wide on 2026-10-26): the page must agree with
    // explore.search, not with a fixed 0.
    const stalled = result.rows.filter((r) => r.permit?.status_class === "stalled").length;
    if (oracle.branch === "a11" && area.recorded !== null) {
      expect({ stalled, open: open.length }).toEqual(area.recorded);
    } else {
      expect(intOf(await page.locator(SEL.header).innerText()), "header = API total").toBe(
        result.total_within_r,
      );
      await expect(page.locator(SEL.resultRow)).toHaveCount(
        Math.min(result.total_within_r, result.rows.length),
      );
      if (result.total_within_r > 0 && open.length === 0 && allShown) {
        await expect(
          page.getByText(EXPLORE_TEXTS.allStalled(result.total_within_r), { exact: true }),
        ).toBeVisible();
      } else if (result.total_within_r === 0) {
        await expect(page.getByText(EXPLORE_TEXTS.noOpenPermits, { exact: true })).toBeVisible();
      }
    }
    await checkpoint(page, "009", 6, { fullPage: true });
  });
});

// ---------------------------------------------------------------------------------------
// Part 1 · Runs and Compare
// ---------------------------------------------------------------------------------------

test.describe("A-13 explorer · runs and compare", () => {
  test(scenario("010"), async ({ page, oracle }) => {
    const { M } = oracle;
    await page.goto(ROUTES.runs);
    const section = await ready(page, "runs");
    for (const s of M.sources) {
      const row = section.locator(SEL.source(s.name));
      if (M.previousManifestCid !== null) {
        await expect(row.locator(SEL.delta("added"))).toHaveText(s.added.toLocaleString("en-US"));
        await expect(row.locator(SEL.delta("changed"))).toHaveText(
          s.changed.toLocaleString("en-US"),
        );
        await expect(row.locator(SEL.delta("removed"))).toHaveText(
          s.removed.toLocaleString("en-US"),
        );
      } else {
        await expect(row.getByText(RUNS_TEXTS.firstRun, { exact: true })).toBeVisible();
        await expect(row.locator(SEL.delta("added"))).toHaveCount(0);
      }
    }
    await checkpoint(page, "010", 3);
  });

  test(scenario("011"), async ({ page, oracle }) => {
    const { M } = oracle;
    await page.goto(ROUTES.runs);
    await ready(page, "runs");
    const list = page.getByRole("list", { name: "Limitations" });
    await expect(list).toBeVisible();
    const expected = [...M.limitations, ...M.sources.flatMap((s) => s.limitations)];
    // The first three show; the rest sit behind "Show all N limitations". Long hex runs are cut
    // on screen, so each item keeps its full note in data-text: exactly M's notes, in order.
    const more = page.getByText(`Show all ${expected.length} limitations`, { exact: true });
    if (expected.length > 3) await more.click();
    const card = list.locator("xpath=..");
    const shown = await card
      .locator("li[data-text]")
      .evaluateAll((els) => els.map((e) => e.getAttribute("data-text") ?? ""));
    expect(shown, "every limitation of M, in manifest order").toEqual(expected);
    await expect(card.locator("li[data-text]").last()).toBeVisible();
    await expect(page.getByText(RUNS_TEXTS.nextSync, { exact: true })).toBeVisible();
    await checkpoint(page, "011", 3);
  });

  test(scenario("012"), async ({ page }) => {
    const unavailable = templatePattern(RUNS_TEXTS.indexUnavailable, 1);
    const faults: [string, (route: Route) => Promise<void>][] = [
      ["abort", (route) => route.abort("failed")],
      [
        "invalid-json",
        (route) =>
          route.fulfill({ status: 200, contentType: "application/json", body: '{"runs":' }),
      ],
    ];
    for (const [name, fault] of faults) {
      // 1. Route the run index to the fault.
      await page.unroute("**/runs/index.json*");
      await page.route("**/runs/index.json*", fault);
      // 2–3. Runs, then the Hub: the explicit error, no run card, count, CID or chip.
      for (const path of [ROUTES.runs, ROUTES.hub]) {
        await page.goto(path);
        const alert = page.locator(SEL.alert).filter({ hasText: unavailable });
        await expect(alert).toBeVisible({ timeout: 30_000 });
        const reason =
          unavailable.exec((await alert.innerText()).split("\n")[0]?.trim() ?? "")?.[1] ?? "";
        expect(reason.trim(), "non-empty reason").not.toBe("");
        await expect(page.locator('a[href$="/runs/index.json"]').first()).toBeVisible();
        await expect(page.locator(SEL.cid)).toHaveCount(0);
        // No run card and no run chip. (Not every <article>: the Hub's own cards and the Coming
        // soon entries are articles that stay in the error state.)
        await expect(page.locator("#run-title")).toHaveCount(0);
        await expect(page.getByText(/^Run \d+(\.\d+)? · /)).toHaveCount(0);
        expect(looksLikeStack(await page.locator("body").innerText())).toBe(false);
        await checkpoint(page, "012", `${name}-${path === "/" ? "hub" : "runs"}`);
      }
    }
  });

  test(scenario("013"), async ({ page, oracle }) => {
    const cid = oracle.manifestCid;
    const unavailable = templatePattern((c, r) => RUNS_TEXTS.manifestUnavailable(c, r), 2);
    // 1. Every request naming the manifest CID → 503.
    await page.route(
      (url) => url.href.includes(cid),
      (route) => route.fulfill({ status: 503, body: "Service Unavailable" }),
    );
    // 2–3. Runs and Coverage.
    for (const [path, route] of [
      [ROUTES.runs, "runs"],
      [ROUTES.coverage, "coverage"],
    ] as const) {
      await page.goto(path);
      await settled(page, route);
      const alert = page.locator(SEL.alert).filter({ hasText: unavailable });
      await expect(alert).toBeVisible({ timeout: 60_000 });
      const m = unavailable.exec((await alert.innerText()).split("\n")[0]?.trim() ?? "");
      expect(m?.[1]).toBe(cid);
      expect((m?.[2] ?? "").trim()).not.toBe("");
      await expect(alert.locator(`[data-cid="${cid}"]`)).toBeAttached();
      await expect(page.locator(SEL.coverageKey)).toHaveCount(0);
      await expect(page.locator(SEL.runsCoverage)).toHaveCount(0);
      await checkpoint(page, "013", route);
    }
  });

  test(scenario("014"), async ({ page, oracle }) => {
    // Run 1, the first numbered run (the pilot slice has no number, so Compare cannot name it).
    const first = oracle.numbered[0];
    if (first === undefined) throw new Error("runs/index.json lists no numbered runs");
    // 1. Serve the index with only Run 1 (a real entry).
    await page.route("**/runs/index.json*", async (route) => {
      const res = await route.fetch();
      const body = (await res.json()) as { runs: unknown[] };
      const only = body.runs.filter((r) => (r as { runId?: string }).runId === first.runId);
      await route.fulfill({ response: res, json: { ...body, runs: only } });
    });
    // 2–3. Compare a=1&b=2 explains why and links to that run.
    await page.goto(`${ROUTES.runsCompare}?a=1&b=2`);
    const section = await settled(page, "runs-compare");
    await expect(page.getByText(RUNS_TEXTS.firstRun, { exact: true })).toBeVisible();
    const link = section.locator(`a[href*="${first.manifestCid}"], a[href*="${first.runId}"]`);
    await expect(link.first()).toBeVisible();
    await expect(section.locator(SEL.compareRun)).toHaveCount(0);
    await expect(section.locator("table")).toHaveCount(0);
    await checkpoint(page, "014", 3);
    // 4. Runs shows the single run.
    await page.goto(ROUTES.runs);
    await ready(page, "runs");
    await expect(page.getByRole("heading", { level: 2, name: first.runId })).toBeVisible();
    await checkpoint(page, "014", 4);
  });

  test(scenario("015"), async ({ page, oracle }) => {
    noteBranch(oracle);
    test.skip(oracle.numbered.length < 2, "1 numbered run published");
    const { position: n } = oracle;
    const old = oracle.numbered[n - 2]?.manifestCid ?? "";
    const net = recordRequests(page);
    // 1. orbitor (an independent gateway, AM-10) answers 504 for the old manifest.
    await page.route(`https://${ORBITOR()}/ipfs/${old}*`, (route) =>
      route.fulfill({ status: 504, headers: { "access-control-allow-origin": "*" }, body: "" }),
    );
    // 2–3. Pill absent, the orbitor check shows its failure (or the retry text).
    await page.goto(`${ROUTES.runsCompare}?a=${n - 1}&b=${n}`);
    await ready(page, "runs-compare");
    const check = page.locator(SEL.resolveCheck("orbitor"));
    await expect(check).toHaveAttribute("data-check", /fail|retry|error/, { timeout: 60_000 });
    await expect(page.getByText(RUNS_TEXTS.oldManifestResolves, { exact: true })).toHaveCount(0);
    await checkpoint(page, "015", 3);
    // 4. Remove the route; re-check → the pill.
    await page.unroute(`https://${ORBITOR()}/ipfs/${old}*`);
    await page.getByRole("button", { name: "Re-check" }).click();
    await expect(page.getByText(RUNS_TEXTS.oldManifestResolves, { exact: true })).toBeVisible({
      timeout: 90_000,
    });
    const hosts = new Set(
      net.requests.filter((r) => r.url.href.includes(old)).map((r) => r.url.host),
    );
    // The app reads manifests through the CID copy; only the gateway checks go to the gateways.
    for (const host of hosts) {
      if (host === requireCidCopyHost()) continue;
      expect([PINATA(), ORBITOR(), FILEBASE()]).toContain(host);
    }
    await checkpoint(page, "015", 4);
  });
});

// ---------------------------------------------------------------------------------------
// Part 1 · Coverage
// ---------------------------------------------------------------------------------------

test.describe("A-13 explorer · coverage", () => {
  test(scenario("016"), async ({ page, oracle }) => {
    const { M } = oracle;
    // 1–3. Every displayed count has a key; number and label equal M.
    await page.goto(ROUTES.coverage);
    const section = await ready(page, "coverage");
    const orphanCounts = await section
      .locator(SEL.count)
      .evaluateAll(
        (els) =>
          els.filter((el) => el.closest("[data-coverage-key],[data-denominator]") === null).length,
      );
    expect(orphanCounts, "counts without a coverage key").toBe(0);
    const shown = new Map<string, number>();
    for (const row of await section.locator(SEL.coverageKey).all()) {
      const key = (await row.getAttribute("data-coverage-key")) ?? "";
      const entry = M.coverage[key];
      expect(entry, `key ${key} in M.coverage`).toBeDefined();
      if (entry === undefined) continue;
      const count = intOf(await row.locator(SEL.count).first().innerText());
      expect(count, key).toBe(entry.count);
      await expect(
        derivationGroup(row).getByText(DERIVATION_LABELS[entry.derivation], { exact: true }),
      ).toBeVisible();
      // 4. The table chip's CID is in M.artifacts.
      await expectKindTable(row, M);
      shown.set(key, count);
    }
    await checkpoint(page, "016", 3, { fullPage: true });
    // 5. Any count on both pages is identical.
    await page.goto(ROUTES.runs);
    const runs = await ready(page, "runs");
    for (const row of await runs.locator(SEL.runsCoverage).all()) {
      const key = (await row.getAttribute("data-coverage")) ?? "";
      const onCoverage = shown.get(key);
      if (onCoverage === undefined) continue;
      expect(intOf(await row.innerText()), `Runs vs Coverage for ${key}`).toBe(onCoverage);
    }
    await checkpoint(page, "016", 5);
  });

  test(scenario("017"), async ({ page, oracle }) => {
    const { M } = oracle;
    await page.goto(ROUTES.coverage);
    const section = await ready(page, "coverage");
    // 2. Kinds without a coverage key show the reason in words.
    for (const kind of KIND_IDS) {
      const row = section.locator(SEL.kind(kind));
      const keys = await row
        .locator(SEL.coverageKey)
        .evaluateAll((els) => els.map((el) => el.getAttribute("data-coverage-key") ?? ""));
      if (keys.filter((k) => k in M.coverage).length === 0) {
        await expect(row).toContainText(COVERAGE_KIND_ABSENT_TEXT);
        await expect(row.locator(SEL.count)).toHaveCount(0);
      }
    }
    // 3. Sources without source_total show the records read, never a typed total.
    for (const s of M.sources) {
      if (M.coverage[`source_total:${s.name}`] !== undefined) continue;
      const row = section.locator(SEL.denominator(s.name));
      await expectSourceRow(row, s, M);
      await expect(row.locator(SEL.count)).toHaveCount(0);
    }
    await checkpoint(page, "017", 3, { fullPage: true });
  });
});

// ---------------------------------------------------------------------------------------
// Part 1 · Explore · Filters and Property
// ---------------------------------------------------------------------------------------

test.describe("A-13 explorer · filters and property", () => {
  test(scenario("025"), async ({ page }) => {
    const place = gazetteerPlace("Pflugerville");
    // 1–3. Type "Pflug"; the gazetteer suggestion.
    await page.goto(EXPLORE);
    await settled(page, "explore");
    const options = await typePlace(page, "Pflug");
    const suggestion = options.filter({ hasText: placeSuggestion(place) });
    await expect(suggestion).toHaveCount(1);
    await expect(suggestion).toHaveText(placeSuggestion(place));
    await checkpoint(page, "025", 3);
    // 4–5. Select it: URL and area block.
    await nextSearch(page, () => suggestion.click());
    const url = new URL(page.url());
    const placeParam = url.searchParams.get("place");
    const at = url.searchParams.get("at");
    expect(
      (placeParam !== null &&
        [place.geoid, place.name.toLowerCase()].includes(placeParam.toLowerCase())) ||
        at === `${place.lat},${place.lon}`,
      `URL names Pflugerville (${url.search})`,
    ).toBe(true);
    await expect(page.locator(SEL.page("explore"))).toContainText(place.name);
    await checkpoint(page, "025", 5);
  });

  test(scenario("026"), async ({ page, oracle }) => {
    // 1. The wide area.
    const result = await openExplore(page, exploreUrl(EXPLORE, { ...WIDE, roof: 0, view: "list" }));
    const rows = page.locator(SEL.resultRow);
    await expect(rows).toHaveCount(result.rows.length);
    expect(result.rows.length, "today's run returns rows in the wide area").toBeGreaterThan(0);
    // A-16 (PO 2026-10-26): 20 rows a page; the line under them names the whole total.
    expect(result.rows.length).toBeLessThanOrEqual(20);
    await expect(page.locator("[data-showing]")).toHaveText(
      `Showing 1–${result.rows.length.toLocaleString("en-US")} of ${result.total_within_r.toLocaleString("en-US")}`,
    );
    // 2–3. Every row's cells and provenance (the current page).
    const data = byCid(result);
    for (const row of await rows.all()) {
      const cid = (await row.getAttribute("data-property-cid")) ?? "";
      expect(data.has(cid), `row ${cid} is a search row`).toBe(true);
      await expectRowFields(row, data.get(cid), oracle);
    }
    await checkpoint(page, "026", 3, { fullPage: true });
  });

  test(scenario("027"), async ({ page }) => {
    // The PO's demo area (D-11: Austin city, where 5 mi → 3 mi really changes the count), not
    // Pflugerville, where both counts are 0 on the one-month slice.
    const area = demoArea();
    const place = area.place;
    // 1. Open and set the window marker.
    await openExplore(
      page,
      exploreUrl(EXPLORE, { place: place.name.toLowerCase(), r: area.radiusMi, roof: 15 }),
    );
    await page.evaluate(() => {
      (window as unknown as { __tcMarker: number }).__tcMarker = 1;
    });
    // 2. {n5}.
    const n5 = intOf(await page.locator(SEL.header).innerText());
    await checkpoint(page, "027", 2);
    // 3. Radius 5 → 3.
    const t0 = Date.now();
    const result = await nextSearch(page, () =>
      setControl(page.getByLabel("Radius", { exact: true }), "3"),
    );
    // 4. Within 3 s, no reload.
    await expectHeader(page, result.total_within_r, 3, place.name, 15);
    expect(Date.now() - t0, "header updated within 3 s").toBeLessThan(3_000);
    expect(new URL(page.url()).searchParams.get("r")).toBe("3");
    expect(
      await page.evaluate(() => (window as unknown as { __tcMarker?: number }).__tcMarker),
    ).toBe(1);
    expect(await page.evaluate(() => performance.getEntriesByType("navigation").length)).toBe(1);
    const n3 = result.total_within_r;
    expect(n3).toBeLessThanOrEqual(n5);
    if (n3 <= result.rows.length) await expect(page.locator(SEL.resultRow)).toHaveCount(n3);
    await checkpoint(page, "027", 4);
  });

  test(scenario("028"), async ({ page }) => {
    const point = { lat: 30.447765, lon: -97.602116 };
    // Precondition: explore.search total 0 for the filter; halve r until it is (contract minimum
    // 0.25 mi). The server total replaces the removed browser SQL count (PO decision 2026-10-26).
    // 1. Open the zero-result search.
    let r = 0.5;
    let result: ExploreSearchResult;
    for (;;) {
      result = await openExplore(
        page,
        exploreUrl(EXPLORE, { at: `${point.lat},${point.lon}`, r, roof: 15 }),
      );
      const n = result.total_within_r;
      if (n === 0) break;
      test.skip(r / 2 < 0.25, `no zero-result radius ≥ 0.25 mi at this point (n=${n} at r=${r})`);
      r /= 2;
    }
    test.info().annotations.push({ type: "radius", description: String(r) });
    // 2. The zero-results line with {k} from the response.
    const k = result.close_matches.length;
    await expect(page.getByText(EXPLORE_TEXTS.zeroResults(r, k), { exact: true })).toBeVisible();
    await expect(page.locator(SEL.resultRow)).toHaveCount(0);
    // 3. Close matches: ≤ 10, "+{m} mi", 0 < m ≤ r (distance ≤ 2r), nearest first, provenance.
    const matches = page.locator(SEL.closeMatch);
    await expect(matches).toHaveCount(k);
    expect(k).toBeLessThanOrEqual(10);
    let last = 0;
    for (const match of await matches.all()) {
      const miles = Number(await match.locator(SEL.milesOutside).getAttribute("data-value"));
      await expect(match.locator(SEL.milesOutside)).toHaveText(EXPLORE_TEXTS.milesOutside(miles));
      expect(miles).toBeGreaterThan(0);
      expect(miles).toBeLessThanOrEqual(r);
      expect(miles).toBeGreaterThanOrEqual(last);
      last = miles;
      await expect(match.locator(SEL.provenance)).toBeVisible();
    }
    await checkpoint(page, "028", 3);
  });

  test(scenario("029"), async ({ page }) => {
    const state = {
      place: "pflugerville",
      r: 5,
      roof: 15,
      permit: "open_stalled",
      openYrs: 5,
      tenure: 10,
      ooa: 1,
      sort: "open_desc",
      mode: "filters",
      view: "list",
    } as const;
    const expectControls = async (): Promise<void> => {
      await expect(page.getByLabel("Radius", { exact: true })).toHaveValue(String(state.r));
      await expect(page.getByLabel("Roof age", { exact: true })).toHaveValue(String(state.roof));
      await expect(page.getByLabel("Open or stalled", { exact: true })).toBeChecked();
      await expect(page.getByLabel("Open ≥", { exact: true })).toHaveValue(String(state.openYrs));
      await expect(page.getByLabel("Tenure", { exact: true })).toHaveValue(String(state.tenure));
      await expect(page.getByLabel("Out-of-area owner", { exact: true })).toBeChecked();
      await expect(page.getByLabel("Sort", { exact: true })).toHaveValue(state.sort);
      await expect(page.locator(SEL.page("explore"))).toContainText(
        gazetteerPlace("Pflugerville").name,
      );
    };
    // 1–2. Every control shows its URL value.
    await openExplore(page, exploreUrl(EXPLORE, state));
    await expectControls();
    await checkpoint(page, "029", 2);
    // 3. Reload → the same state.
    await nextSearch(page, () => page.reload());
    await expectControls();
    // 4. view=map → the List view, no map, marker or tile request.
    const net = recordRequests(page);
    await openExplore(page, exploreUrl(EXPLORE, { ...state, view: "map" }));
    await expect(page.locator(SEL.page("explore"))).toHaveAttribute("data-view", "list");
    await expect(page.locator("[data-map], .maplibregl-map, .leaflet-container")).toHaveCount(0);
    const tiles = net.requests.filter((r) =>
      /\/\d+\/\d+\/\d+\.(png|jpg|webp|pbf|mvt)(\?|$)|tile/i.test(r.url.pathname),
    );
    expect(tiles.map((t) => t.url.href)).toEqual([]);
    await checkpoint(page, "029", 4);
  });

  test(scenario("030"), async ({ page, oracle }) => {
    // 1. The TC-026 URL.
    const result = await openExplore(page, exploreUrl(EXPLORE, { ...WIDE, roof: 0, view: "list" }));
    const first = page.locator(SEL.resultRow).first();
    const cid = (await first.getAttribute("data-property-cid")) ?? "";
    const data = byCid(result).get(cid);
    // 2. Click → drawer, URL gains sel=.
    await first.click();
    const drawer = page.getByRole("dialog");
    await expect(drawer).toBeVisible();
    await expect.poll(() => new URL(page.url()).searchParams.get("sel")).not.toBeNull();
    // 3. Fields with provenance and missing reasons.
    await expect(drawer).toHaveAttribute("data-property-cid", cid);
    await expectRowFields(drawer, data, oracle);
    await checkpoint(page, "030", 3);
    // 4. Reload → the same property.
    await page.reload();
    await expect(page.getByRole("dialog")).toHaveAttribute("data-property-cid", cid, {
      timeout: 60_000,
    });
    await checkpoint(page, "030", 4);
  });

  test(scenario("031"), async ({ page, oracle }) => {
    noteBranch(oracle);
    // 1. County-wide open or stalled ≥ 5 yrs, longest first.
    const result = await openExplore(
      page,
      exploreUrl(EXPLORE, { ...WIDE, permit: "open_stalled", openYrs: 5, sort: "open_desc" }),
    );
    const chips = page.locator(SEL.permitChip);
    if (result.rows.length === 0) {
      // Today: no permit ≥ 5 years open → the TC-035 message.
      expect(oracle.M.coverage.permits_emitted_stalled?.count ?? 0).toBe(0);
      await expect(chips).toHaveCount(0);
      await expect(page.getByText(EXPLORE_TEXTS.noOpenPermits, { exact: true })).toBeVisible();
      await checkpoint(page, "031", "today");
      return;
    }
    // 2–3. Chip texts and non-increasing {x} = open_days / 365.25.
    let previous = Number.POSITIVE_INFINITY;
    for (const chip of await chips.all()) {
      const text = (await chip.innerText()).trim();
      const x = chipYears(text);
      expect(x, `chip "${text}"`).not.toBeNull();
      if (x === null) continue;
      expect([EXPLORE_TEXTS.stalledNoCarrier(x), EXPLORE_TEXTS.openNoCarrier(x)]).toContain(text);
      expect(x).toBe(openYears(Number(await chip.getAttribute("data-open-days"))));
      expect(x).toBeLessThanOrEqual(previous);
      previous = x;
    }
    await checkpoint(page, "031", 3, { fullPage: true });
  });

  test(scenario("032"), async ({ page }) => {
    // 1. Wide area, any permit.
    const result = await openExplore(page, exploreUrl(EXPLORE, { ...WIDE, permit: "any" }));
    const withPermit = result.rows.find((r) => r.permit !== null);
    test.skip(withPermit === undefined, "not present in this run: no permit row in the wide area");
    if (withPermit === undefined) return;
    // 2. Open the first permit row's drawer.
    await page.locator(`${SEL.resultRow}[data-property-cid="${withPermit.property_cid}"]`).click();
    const drawer = page.getByRole("dialog");
    await expect(drawer).toBeVisible();
    // 3. Contractor name (no carrier) and the resolution badge.
    await expect(drawer.locator(SEL.field("contractor_name"))).toHaveText(
      expectedContractorText(withPermit),
    );
    await expect(drawer.locator(SEL.contractorBadge)).toHaveAttribute(
      "data-contractor-resolution",
      withPermit.contractor?.resolution ?? "unresolved",
    );
    // 4. The BBB line: a rating or the exact reason.
    const bbb = drawer.locator(SEL.field("bbb"));
    const expected = expectedBbbText(withPermit.bbb_status, withPermit.bbb_status_reason);
    if (expected === null) expect(isBlankCell(await bbb.innerText())).toBe(false);
    else await expect(bbb).toHaveText(expected);
    if (withPermit.bbb_status === "not_checked") {
      expect((withPermit.bbb_status_reason ?? "").trim(), "non-empty bbb_status_reason").not.toBe(
        "",
      );
    }
    await expect(drawer).not.toContainText(/licen[cs]e/i);
    await checkpoint(page, "032", 4);
  });

  test(scenario("033"), async ({ page }) => {
    // 1. TC-026 URL with every optional column on.
    const result = await openExplore(page, exploreUrl(EXPLORE, { ...WIDE, roof: 0, view: "list" }));
    const columns = page.getByRole("button", { name: "Columns" });
    if ((await columns.count()) > 0) {
      await columns.click();
      for (const box of await page
        .getByRole("menuitemcheckbox")
        .or(page.getByRole("checkbox"))
        .all()) {
        if (!(await box.isChecked())) await box.click();
      }
      await page.keyboard.press("Escape");
    }
    // 2–3. Each missing state's exact text; states with no row are recorded.
    const seen = new Set<string>();
    for (const data of result.rows) {
      const row = page.locator(`${SEL.resultRow}[data-property-cid="${data.property_cid}"]`);
      if (data.roof_age_basis === "unknown" || data.roof_age_basis === null) {
        await expect(row).toContainText(EXPLORE_TEXTS.roofUnknown);
        seen.add("roof_basis_unknown");
      }
      if (data.contractor !== null) {
        await expect(row.locator(SEL.field("contractor_name"))).toHaveText(
          expectedContractorText(data),
        );
        seen.add("contractor_not_printed");
      }
      const bbb = expectedBbbText(data.bbb_status, data.bbb_status_reason);
      if (bbb !== null) {
        await expect(row.locator(SEL.field("bbb"))).toHaveText(bbb);
        seen.add(`bbb_${data.bbb_status ?? ""}`);
      }
      if (data.tenure_years === null) {
        await expect(row.locator(SEL.field("tenure_years"))).toHaveText(
          EXPLORE_TEXTS.tenureUnknown,
        );
        seen.add("tenure_unknown");
      }
      if (data.owner_area_class === null || data.owner_area_class === "unknown") {
        // Contract v1.2 rows say why (e.g. zip_not_zcta); otherwise the generic text.
        const reason = data.missing.find((m) => m.field === "owner_area_class")?.reason;
        await expect(row.locator(SEL.field("owner_area_class"))).toHaveText(
          reason !== undefined && reason in MISSING_REASON_LABELS
            ? missingLabel("owner_area_class", reason as Parameters<typeof missingLabel>[1])
            : EXPLORE_TEXTS.ownerAreaUnknown,
        );
        seen.add("owner_area_unknown");
      }
    }
    for (const state of [
      "roof_basis_unknown",
      "contractor_not_printed",
      "bbb_blocked",
      "bbb_not_checked",
      "bbb_not_found",
      "tenure_unknown",
      "owner_area_unknown",
    ]) {
      if (!seen.has(state)) {
        test.info().annotations.push({ type: "not present in this run", description: state });
      }
    }
    // 4. Scan every result cell.
    for (const cell of await page.locator(SEL.resultRow).locator("[data-field]").all()) {
      expect(
        isBlankCell(await cell.innerText()),
        `cell ${await cell.getAttribute("data-field")}`,
      ).toBe(false);
    }
    await checkpoint(page, "033", 4, { fullPage: true });
  });

  test(scenario("034"), async ({ page, request }) => {
    // 1. The ADR at the deployed sha is the no-carrier list; the page must not invent values.
    const build = (await (await request.get("/build.json")).json()) as { sha?: string };
    test.info().annotations.push({ type: "build-sha", description: build.sha ?? "unknown" });
    // 2. TC-031 URL with permit=any; one row's drawer.
    const result = await openExplore(
      page,
      exploreUrl(EXPLORE, { ...WIDE, permit: "any", openYrs: 5, sort: "open_desc" }),
    );
    const row = result.rows.find((r) => r.permit !== null) ?? result.rows[0];
    test.skip(row === undefined, "not present in this run: no row in the wide area");
    if (row === undefined) return;
    await page.locator(`${SEL.resultRow}[data-property-cid="${row.property_cid}"]`).click();
    const drawer = page.getByRole("dialog");
    await expect(drawer).toBeVisible();
    // 3. The no-carrier field shows the exact text; the contractor its printed name or why not
    // (A-16 data audit #1: the name has a carrier and Run 3 publishes it).
    if (row.permit !== null) {
      await expect(drawer.locator(SEL.field("status_raw"))).toHaveText(EXPLORE_TEXTS.noCarrier);
    }
    if (row.contractor !== null) {
      await expect(drawer.locator(SEL.field("contractor_name"))).toHaveText(
        expectedContractorText(row),
      );
    }
    for (const el of await drawer.locator('[data-reason="no_lexicon_carrier"]').all()) {
      await expect(el).toHaveText(EXPLORE_TEXTS.noCarrier);
    }
    await expect(drawer.locator(SEL.field("status_raw"))).not.toContainText(
      /Expired|Final|Active|Suspended/,
    );
    await checkpoint(page, "034", 3);
  });

  test(scenario("035"), async ({ page }) => {
    // 1. Open permits ≥ 5 years in Pflugerville 5 mi.
    const result = await openExplore(
      page,
      exploreUrl(EXPLORE, { place: "pflugerville", r: 5, permit: "open", openYrs: 5 }),
    );
    // 2. (The browser SQL cross-check was removed with the SQL tab, PO decision 2026-10-26.)
    // 3. The exact message, no blank table (dated reference 2026-10-19: 0 open).
    expect(result.total_within_r).toBe(0);
    await expect(page.getByText(EXPLORE_TEXTS.noOpenPermits, { exact: true })).toBeVisible();
    await expect(page.locator(SEL.resultRow)).toHaveCount(0);
    await expect(page.locator(`${SEL.page("explore")} table tbody tr`)).toHaveCount(0);
    await checkpoint(page, "035", 3);
  });

  test(scenario("036"), async ({ page }) => {
    // 1–2. Explore, preset ooa78753 → tenure > 10 and out-of-area on.
    await openExplore(page, EXPLORE);
    const result = await nextSearch(page, () =>
      page.getByRole("button", { name: "ooa78753" }).click(),
    );
    await expect(page.getByLabel("Tenure", { exact: true })).toHaveValue("10");
    await expect(page.getByLabel("Out-of-area owner", { exact: true })).toBeChecked();
    // 3. One definition line under each filter.
    for (const f of ["tenure", "ooa"] as const) {
      const def = page.locator(SEL.filterDefinition(f));
      await expect(def).toHaveCount(1);
      expect((await def.innerText()).trim().split("\n")).toHaveLength(1);
    }
    await checkpoint(page, "036", 3);
    // 4. Each row: tenure_years with tenure_basis and owner_area_class (or reasons); none ≤ 10.
    for (const data of result.rows) {
      const row = page.locator(`${SEL.resultRow}[data-property-cid="${data.property_cid}"]`);
      for (const field of ["tenure_years", "tenure_basis", "owner_area_class"]) {
        expect(isBlankCell(await row.locator(SEL.field(field)).innerText()), field).toBe(false);
      }
      expect(data.tenure_years ?? 0).toBeGreaterThan(10);
      if (data.owner_area_class === null || data.owner_area_class === "unknown") {
        // Contract v1.2 rows say why (e.g. zip_not_zcta); otherwise the generic text.
        const reason = data.missing.find((m) => m.field === "owner_area_class")?.reason;
        await expect(row.locator(SEL.field("owner_area_class"))).toHaveText(
          reason !== undefined && reason in MISSING_REASON_LABELS
            ? missingLabel("owner_area_class", reason as Parameters<typeof missingLabel>[1])
            : EXPLORE_TEXTS.ownerAreaUnknown,
        );
      }
    }
    await checkpoint(page, "036", 4, { fullPage: true });
  });

  test(scenario("037"), async ({ page }) => {
    // 1. The TC-036 state.
    await openExplore(page, EXPLORE);
    const result = await nextSearch(page, () =>
      page.getByRole("button", { name: "ooa78753" }).click(),
    );
    // 2. "tenure unknown: {n}".
    await expect(page.locator(SEL.tenureUnknown)).toHaveText(
      EXPLORE_TEXTS.tenureUnknownCount(result.tenure_unknown),
    );
    await checkpoint(page, "037", 2);
    // 3. No row with an unknown tenure is listed (the browser SQL count of tenure_years IS NULL
    // was removed with the SQL tab, PO decision 2026-10-26).
    expect(Number.isInteger(result.tenure_unknown)).toBe(true);
    expect(result.rows.filter((r) => r.tenure_years === null)).toEqual([]);
    await checkpoint(page, "037", 3);
  });
});

// ---------------------------------------------------------------------------------------
// Part 1 · the Filters engine
// ---------------------------------------------------------------------------------------

test.describe("A-13 explorer · Filters engine", () => {
  test(scenario("043"), async ({ page, oracle }) => {
    // 1. Filters search; record requests.
    const net = recordRequests(page);
    const result = await openExplore(
      page,
      exploreUrl(EXPLORE, { place: "pflugerville", r: 5, roof: 15 }),
    );
    // 2. Engine line.
    await expect(page.locator(SEL.engineLine)).toContainText(EXPLORE_TEXTS.engineServer);
    // 3. One explore.search per search, engine server, as_of = M; no DuckDB-WASM.
    await page.waitForLoadState("networkidle");
    expect(
      net.requests.filter((r) => EXPLORE_SEARCH.test(r.url.href) && r.method !== "OPTIONS"),
    ).toHaveLength(1);
    expect(result.engine).toBe("server");
    expect(result.as_of.manifestCid).toBe(oracle.manifestCid);
    expect(net.requests.filter((r) => isDuckdbWasm(r.url)).map((r) => r.url.href)).toEqual([]);
    await checkpoint(page, "043", 3);
    // 4. (Switching to the SQL tab was removed with the tab, PO decision 2026-10-26.)
  });
});
