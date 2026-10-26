// A-03 Runs page cases: TC-010…TC-014, TC-031 and TC-061 (FR-002, FR-005, FR-009, FR-010,
// FR-013; plan § "Atlas element map" → Runs page; G6 matrix § 7). Every expected text is
// imported from @countylens/shared, never retyped; every count and CID comes from the manifest
// the `run` fixture fetched by the CID the page itself shows (TC-061: nothing is hard-coded).
//
// DOM contract these cases read (G-C3 builds it; aligned with apps/web/src/routes/Runs.tsx and
// apps/web/test/runs.test.tsx; these hooks are the only ones the tests use):
// - `section[data-route="runs"]` is the page; the run card is the `article` whose level-2
//   heading is `manifest.runId`; it holds no button other than the CID copy buttons (FR-013).
// - Every instant renders either as the manifest's own ISO text followed by ` UTC`
//   (`Started {startedAt} UTC`, `collected {captured_at} UTC`) or as a `<time datetime="{ISO}">`
//   with a `UTC` suffix; the test compares instants, never a reformatted string.
// - A CID display is `[data-cid="{cid}"][title="{cid}"]` whose own visible text is
//   `{first 4}…{last 4}` (U+2026); its copy button (accessible name `Copy … CID`, e.g.
//   `Copy manifest CID`) is in the same parent element and puts the full CID on the clipboard.
// - The card's provenance line names the index origin as the text `/runs/index.json`.
// - The publication state (PUBLICATION_STATE_TEXT), each coverage label, count and derivation
//   text, each data-group name and each banner text is its own text element; every icon glyph
//   is `aria-hidden="true"`.
// - Sources: a list with accessible name `Sources` (`aria-label` or `aria-labelledby` a
//   heading), one `listitem` per manifest source in manifest order, each with
//   SOURCE_LABELS[name] (the TCAD item also shows its `name`), `{records} records` (plain or
//   en-US grouped digits), its `captured_at` instant (see above) and a link whose href is
//   `source.url`.
// - Coverage rows: `[data-coverage="{key}"]` with COVERAGE_LABELS[key], the grouped count and
//   DERIVATION_LABELS[derivation] as visible text (not a tooltip).
// - Data groups: a list with accessible name `Data groups`, one `listitem` per `directory`
//   artifact with the group name and `[data-cid="{directory.cid}"]`.
// - Error banner: `role="alert"` holding RUN_INDEX_TEXTS.unreadable / .empty; while it shows there
//   is no run card (`article`), no `[data-cid]` and no `[aria-busy="true"]` region.
// - Shell: `h1` "CountyLens"; a navigation link with accessible name `Runs` (since A-13 the
//   destinations are Explore, Runs, Coverage, Data, More, with no "Permits" link); the
//   `/permits` route stays and `section[data-route="permits"]` is the Permits page.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Locator, Page } from "@playwright/test";
import {
  RUNS_INDEX_SCHEMA,
  isCidV1,
  type CoverageCount,
  type RunManifestV1,
} from "@countylens/contract";
import {
  COVERAGE_LABELS,
  DERIVATION_LABELS,
  PERMITS_TEXTS,
  PUBLICATION_STATE_TEXT,
  RUN_INDEX_TEXTS,
  sourceLabel,
  type CoverageLabelKey,
} from "@countylens/shared";
import { expect, test } from "./lib/fixtures.js";
import { checkpoint } from "./lib/evidence.js";
import { artifactsOf, groupOfDirectory, resolveDataGroups } from "./lib/manifest.js";
import { evidenceTargetForBranch } from "./lib/evidence-target.js";
import { PERMITS_LOAD_WAIT_MS } from "./lib/perf.js";
import { permitsTotal, rowsOnPageOf, waitForPermitRows } from "./lib/permits-pages.js";
import { fetchBuildInfo, repoRoot, requireCidCopyHost, runtimeUrl } from "./lib/runtime.js";

/** P0-4: this phrase never appears on the page (checked case-insensitively, stricter than the grep gate). */
const ATLAS_CLAIM = "published to atlas";

const PERMIT_ROW = "table tbody tr";

/** The Atlas § 3 middle truncation: first 4 characters, U+2026, last 4. */
function truncateCid(cid: string): string {
  return `${cid.slice(0, 4)}…${cid.slice(-4)}`;
}

/** The text a user sees: text nodes outside `aria-hidden="true"` subtrees, whitespace-normalized. */
function visibleText(locator: Locator): Promise<string> {
  return locator.evaluate((element) => {
    const walk = (node: Node): string => {
      if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
      if (!(node instanceof Element) || node.getAttribute("aria-hidden") === "true") return "";
      return Array.from(node.childNodes).map(walk).join("");
    };
    return walk(element).replace(/\s+/g, " ").trim();
  });
}

/** The run card: the `article` titled (level-2 heading) with the manifest's runId. */
function runCard(page: Page, runId: string): Locator {
  return page
    .getByRole("article")
    .filter({ has: page.getByRole("heading", { level: 2, name: runId, exact: true }) });
}

function coverageRow(page: Page, key: CoverageLabelKey): Locator {
  return page.locator(`[data-coverage="${key}"]`);
}

/** The manifest's coverage entry for `key`; a missing key is a manifest gap, never a 0. */
function coverageCount(manifest: RunManifestV1, key: CoverageLabelKey): CoverageCount {
  const entry = manifest.coverage[key];
  if (!entry) throw new Error(`manifest coverage has no "${key}" entry`);
  return entry;
}

/** `{records} records`, plain or with en-US digit grouping (tabular-nums body text). */
function recordsTexts(records: number): string[] {
  return [`${records} records`, `${records.toLocaleString("en-US")} records`];
}

/**
 * Asserts `scope` renders the instant `iso` in UTC: as the ISO text followed by ` UTC` (the
 * manifest's own value, or its `toISOString()` form), or as a `<time datetime>` equal to that
 * instant with a UTC suffix.
 */
async function expectUtcTime(scope: Locator, iso: string, label: string): Promise<void> {
  const text = await visibleText(scope);
  const isoForms = new Set([iso, new Date(Date.parse(iso)).toISOString()]);
  if ([...isoForms].some((form) => text.includes(`${form} UTC`))) return;
  const matches = await scope.locator("time[datetime]").evaluateAll((elements, expected) => {
    const instant = Date.parse(expected);
    return elements
      .map((element) => ({
        datetime: element.getAttribute("datetime") ?? "",
        text: element.textContent ?? "",
        parentText: element.parentElement?.textContent ?? "",
      }))
      .filter((time) => Date.parse(time.datetime) === instant);
  }, iso);
  expect(
    matches.length,
    `${label}: "${iso} UTC" as text, or one <time datetime> equal to that instant (got "${text}")`,
  ).toBe(1);
  const [time] = matches;
  expect(
    /\bUTC\b/.test(time?.text ?? "") || /\bUTC\b/.test(time?.parentText ?? ""),
    `${label}: rendered in UTC with a "UTC" suffix`,
  ).toBe(true);
}

/** The CID display for `cid` inside `scope`: attributes, truncated text and the copy button. */
async function expectCidDisplay(scope: Locator, cid: string, label: string): Promise<Locator> {
  const element = scope.locator(`[data-cid="${cid}"]`);
  await expect(element, `${label}: one element carries data-cid`).toHaveCount(1);
  await expect(element, `${label}: title holds the full CID`).toHaveAttribute("title", cid);
  expect(isCidV1(cid), `${label}: CIDv1`).toBe(true);
  expect(await visibleText(element), `${label}: visible text is middle-truncated`).toBe(
    truncateCid(cid),
  );
  return element;
}

test.describe("A-03 Runs page (FR-002, FR-009)", () => {
  test.describe.configure({ timeout: 5 * 60_000 });

  test.describe("A-03-TC-010 Runs page shows the run (happy path, demo D-2)", () => {
    test("@scenario:A-03-TC-010", async ({ page, run }, testInfo) => {
      const copyHost = requireCidCopyHost();
      const { manifest, manifestCid, runId } = run;
      const origin = new URL(runtimeUrl());
      const responses: { url: string; status: number }[] = [];
      page.on("response", (response) => {
        responses.push({ url: response.url(), status: response.status() });
      });

      // Step 1: the page loads, public, no sign-in.
      await page.goto("/runs");
      await expect(page.locator('[data-route="runs"]')).toBeVisible();
      await expect(page.locator('input[type="password"]')).toHaveCount(0);
      await expect(page.getByText(/sign in/i)).toHaveCount(0);
      await checkpoint(page, "010", "1-page-public");

      // Step 3: the run card shows the run ID.
      const card = runCard(page, runId);
      await expect(card, "the run card for the manifest's runId").toBeVisible({ timeout: 60_000 });
      await expect(card.getByText(runId, { exact: true }).first()).toBeVisible();
      await checkpoint(page, "010", "3-run-card");

      // Step 4: start and finish equal the manifest, in UTC.
      await expectUtcTime(card, manifest.startedAt, "startedAt");
      await expectUtcTime(card, manifest.finishedAt, "finishedAt");
      await checkpoint(page, "010", "4-utc-times");

      // Step 2: the index (same origin) and the manifest (by CID from the copy) loaded with 200.
      await testInfo.attach("responses.json", {
        body: JSON.stringify(responses, null, 2),
        contentType: "application/json",
      });
      const index = responses.find((response) => {
        const url = new URL(response.url);
        return url.host === origin.host && url.pathname === "/runs/index.json";
      });
      expect(index?.status, "GET /runs/index.json from this site").toBe(200);
      const manifestResponse = responses.find((response) => {
        const url = new URL(response.url);
        return url.hostname === copyHost && url.pathname === `/${manifestCid}`;
      });
      expect(manifestResponse?.status, `GET https://${copyHost}/${manifestCid}`).toBe(200);
      expect(await visibleText(card), "provenance line names the index origin").toContain(
        "/runs/index.json",
      );

      // Step 5: data-cid, truncated text, and the clipboard after the copy button.
      expect(manifestCid.startsWith("b"), "manifest CID is base32 CIDv1").toBe(true);
      const cidElement = await expectCidDisplay(card, manifestCid, "manifest CID");
      await cidElement.locator("..").getByRole("button", { name: /copy/i }).click();
      const clipboard = await page.evaluate(() => navigator.clipboard.readText());
      expect(clipboard, "the copy button copies the full CID").toBe(manifestCid);
      await checkpoint(page, "010", "5-cid-copied");

      // Step 6: the publication state, verbatim, and no Atlas claim anywhere.
      await expect(page.getByText(PUBLICATION_STATE_TEXT, { exact: true })).toBeVisible();
      const pageText = await page.locator("body").innerText();
      expect(pageText.toLowerCase(), "P0-4: no Atlas registration claim").not.toContain(
        ATLAS_CLAIM,
      );
      await checkpoint(page, "010", "6-publication-state");

      // Expected result: no run controls (the only buttons copy CIDs).
      const buttonNames = await card
        .getByRole("button")
        .evaluateAll((buttons) =>
          buttons.map((button) =>
            (button.getAttribute("aria-label") ?? button.textContent ?? "").trim(),
          ),
        );
      expect(buttonNames.length, "the CID copy buttons exist").toBeGreaterThan(0);
      expect(
        buttonNames.filter((name) => !/^copy /i.test(name)),
        "no button on the card besides the CID copy buttons",
      ).toEqual([]);
      await checkpoint(page, "010", "expected-no-run-controls", { fullPage: true });
    });
  });

  test.describe("A-03-TC-011 Runs lists both sources with their records, Austin first", () => {
    test("@scenario:A-03-TC-011", async ({ page, run }) => {
      const { manifest, runId } = run;
      await page.goto("/runs");
      await expect(runCard(page, runId)).toBeVisible({ timeout: 60_000 });

      // Step 5: one item per manifest source, in manifest order.
      const items = page.getByRole("list", { name: "Sources" }).getByRole("listitem");
      await expect(items, "one list item per manifest source").toHaveCount(manifest.sources.length);
      // Austin and TCAD at least; Run 3 adds austin-address-points (ADR-0004) after them.
      expect(
        manifest.sources.length,
        "Austin and TCAD, plus any later source",
      ).toBeGreaterThanOrEqual(2);

      for (const [position, source] of manifest.sources.entries()) {
        const item = items.nth(position);
        const label = sourceLabel(source.name);
        const text = await visibleText(item);
        expect(text, `source ${position + 1} is ${source.name}`).toContain(label);
        expect(
          recordsTexts(source.records).some((candidate) => text.includes(candidate)),
          `source ${position + 1}: shows ${source.records} records (got "${text}")`,
        ).toBe(true);
        await expectUtcTime(item, source.captured_at, `${source.name} captured_at`);
        const hrefs = await item
          .locator("a[href]")
          .evaluateAll((anchors) => anchors.map((anchor) => (anchor as HTMLAnchorElement).href));
        expect(hrefs, `${source.name}: its URL as a link`).toContain(new URL(source.url).href);
      }
      await items.first().scrollIntoViewIfNeeded();
      await checkpoint(page, "011", "5-sources-in-manifest-order");

      // Steps 3–4: Austin first, then the TCAD export with its id.
      const [austin, tcad] = manifest.sources;
      expect(austin?.name).toBe("austin-3syk-w9eu");
      expect(tcad?.name).toBe("tcad-2026-certified-json");
      expect(await visibleText(items.nth(1)), "the TCAD item shows its source id").toContain(
        "tcad-2026-certified-json",
      );
      await checkpoint(page, "011", "3-4-austin-first-tcad-id");
    });
  });

  test.describe("A-03-TC-012 Published count = permits_emitted on Runs and Permits (edge)", () => {
    test("@scenario:A-03-TC-012", async ({ page, run }) => {
      const { manifest, runId } = run;
      const published = coverageCount(manifest, "permits_emitted");

      // Steps 1–3: the coverage row labelled "Permits published" shows the manifest count.
      await page.goto("/runs");
      await expect(runCard(page, runId)).toBeVisible({ timeout: 60_000 });
      const row = coverageRow(page, "permits_emitted");
      await expect(row).toHaveCount(1);
      await expect(row.getByText(COVERAGE_LABELS.permits_emitted, { exact: true })).toBeVisible();
      await expect(
        row.getByText(published.count.toLocaleString("en-US"), { exact: true }),
      ).toBeVisible();
      expect(published.derivation, "permits_emitted is counted from published rows").toBe(
        "published_rows",
      );
      await expect(row.getByText(DERIVATION_LABELS.published_rows, { exact: true })).toBeVisible();
      await row.scrollIntoViewIfNeeded();
      await checkpoint(page, "012", "1-3-permits-published-row");

      // Different label, different element from any source `records` line.
      const sources = page.getByRole("list", { name: "Sources" });
      await expect(sources.locator("[data-coverage]")).toHaveCount(0);
      await expect(sources.getByText(COVERAGE_LABELS.permits_emitted)).toHaveCount(0);

      // Step 4: the Permits list reports exactly that many permits (its range line total) and
      // shows page 1 of them: min(page size, count) rows, no placeholders. Opened in the same
      // page. Root cause of the earlier CI stalls here: one page of every row built ~950,000 DOM
      // elements and froze the runner's browser; the list is paged now (A-11, 2026-10-25).
      await page.goto("/permits");
      if (published.count === 0) {
        await expect(page.getByText(PERMITS_TEXTS.empty, { exact: true })).toBeVisible({
          timeout: PERMITS_LOAD_WAIT_MS,
        });
        await expect(page.locator(PERMIT_ROW)).toHaveCount(0);
        await checkpoint(page, "012", "4-permits-empty");
        return;
      }
      await waitForPermitRows(page);
      expect(await permitsTotal(page), "the Permits page total equals the published count").toBe(
        published.count,
      );
      await expect(page.locator(PERMIT_ROW), "rows on page 1").toHaveCount(
        rowsOnPageOf(published.count, 0),
      );
      await checkpoint(page, "012", "4-permits-row-count");
    });
  });

  test.describe("A-03-TC-013 Run publishes the county and property_improvement groups", () => {
    test("@scenario:A-03-TC-013", async ({ page, run }) => {
      const { manifest, runId } = run;
      const directories = artifactsOf(manifest, "directory");
      // Full-county adaptation 2026-10-24 (A-11 Run 2): a group is published as several export
      // batches (Run 2: 10 county + 5 property_improvement), so groups are resolved from the
      // manifest's batch structure (lib/manifest.ts), not from the pilot's `tables/<group>` names.
      const groups = resolveDataGroups(manifest);
      const groupOf = (directory: (typeof directories)[number]): string =>
        groupOfDirectory(groups, directory) ?? `unresolved:${directory.name}`;
      expect([...new Set(directories.map(groupOf))].sort()).toEqual([
        "county",
        "property_improvement",
      ]);

      await page.goto("/runs");
      await expect(runCard(page, runId)).toBeVisible({ timeout: 60_000 });
      const items = page.getByRole("list", { name: "Data groups" }).getByRole("listitem");
      await expect(items, "one item per data group, no other group").toHaveCount(
        directories.length,
      );
      for (const directory of directories) {
        const group = groupOf(directory);
        const item = items.filter({ has: page.locator(`[data-cid="${directory.cid}"]`) });
        await expect(item, `${group}: one item carries its tables CID`).toHaveCount(1);
        await expect(item.getByText(group, { exact: true })).toBeVisible();
        await expectCidDisplay(item, directory.cid, `${group} tables CID`);
      }
      await items.first().scrollIntoViewIfNeeded();
      await checkpoint(page, "013", "data-groups");
    });
  });

  test.describe("A-03-TC-014 Run index missing, invalid or empty → explicit error state", () => {
    test("@scenario:A-03-TC-014", async ({ page }) => {
      const isIndex = (url: URL): boolean => url.pathname === "/runs/index.json";
      const json = (body: string): { status: number; contentType: string; body: string } => ({
        status: 200,
        contentType: "application/json",
        body,
      });
      // The empty case is a schema-valid index with `runs: []`; a bare `{"runs":[]}` has no
      // `schema` field and is a schema mismatch under the frozen contract (→ unreadable).
      const cases = [
        { label: "404", fulfill: { status: 404 }, expected: RUN_INDEX_TEXTS.unreadable },
        { label: "not-json", fulfill: json("{not json"), expected: RUN_INDEX_TEXTS.unreadable },
        {
          label: "schema-mismatch",
          fulfill: json('{"foo":1}'),
          expected: RUN_INDEX_TEXTS.unreadable,
        },
        {
          label: "empty",
          fulfill: json(JSON.stringify({ schema: RUNS_INDEX_SCHEMA, runs: [] })),
          expected: RUN_INDEX_TEXTS.empty,
        },
      ];

      for (const { label, fulfill, expected } of cases) {
        await page.route(isIndex, (route) => route.fulfill(fulfill));
        await page.goto("/runs");
        const alert = page.getByRole("alert");
        await expect(
          alert.getByText(expected, { exact: true }),
          `${label}: banner text`,
        ).toBeVisible({ timeout: 60_000 });
        await expect(page.getByRole("article"), `${label}: no run card`).toHaveCount(0);
        await expect(page.locator("[data-cid]"), `${label}: no CID`).toHaveCount(0);
        await expect(page.locator('[aria-busy="true"]'), `${label}: no skeleton`).toHaveCount(0);
        await checkpoint(page, "014", `${label}-error-banner`);

        // Step 4: the app bar and the navigation keep working. A-13 replaced the "Permits"
        // destination (Explore, Runs, Coverage, Data, More), so the check uses the Runs link,
        // which every shell version has, then opens the kept /permits route directly.
        await expect(page.getByRole("heading", { name: "CountyLens" })).toBeVisible();
        const nav = page.getByRole("navigation").first();
        await expect(nav.getByRole("link", { name: "Runs", exact: true })).toBeVisible();
        await nav.getByRole("link", { name: "Runs", exact: true }).click();
        await expect(page).toHaveURL(/\/runs$/);
        await expect(page.locator('[data-route="runs"]')).toBeVisible();
        await page.unroute(isIndex);
        await page.goto("/permits");
        await expect(page).toHaveURL(/\/permits$/);
        await expect(page.locator('[data-route="permits"]')).toBeVisible();
        await checkpoint(page, "014", `${label}-4-navigation-works`);
      }
    });
  });

  test.describe("A-03-TC-031 Runs shows permits_no_tcad_geoid with its label (missing data)", () => {
    test("@scenario:A-03-TC-031", async ({ page, run }) => {
      const { manifest, runId } = run;
      const noTcad = coverageCount(manifest, "permits_no_tcad_geoid");
      const published = coverageCount(manifest, "permits_emitted");

      await page.goto("/runs");
      await expect(runCard(page, runId)).toBeVisible({ timeout: 60_000 });

      // Steps 2–3: the labelled line with the manifest count (a true 0 renders as "0").
      const row = coverageRow(page, "permits_no_tcad_geoid");
      await expect(row).toHaveCount(1);
      await expect(
        row.getByText(COVERAGE_LABELS.permits_no_tcad_geoid, { exact: true }),
      ).toBeVisible();
      await expect(
        row.getByText(noTcad.count.toLocaleString("en-US"), { exact: true }),
      ).toBeVisible();
      await row.scrollIntoViewIfNeeded();
      await checkpoint(page, "031", "2-3-no-tcad-geoid-count");

      // Step 4: the derivation helper text is visible (not a tooltip) and verbatim (AD-28).
      expect(noTcad.derivation, "permits_no_tcad_geoid comes from the internal match").toBe(
        "aggregate_match",
      );
      await expect(row.getByText(DERIVATION_LABELS.aggregate_match, { exact: true })).toBeVisible();
      await expect(
        row.getByText(DERIVATION_LABELS[noTcad.derivation], { exact: true }),
      ).toBeVisible();
      expect(published.derivation).toBe("published_rows");
      await expect(
        coverageRow(page, "permits_emitted").getByText(DERIVATION_LABELS.published_rows, {
          exact: true,
        }),
      ).toBeVisible();
      await checkpoint(page, "031", "4-derivation-helper-text");
    });
  });

  // A-16 PO rule 2026-10-26: a run list with only run + date is a dropdown (RunSelect). The Run
  // picker lists every indexed run newest first; choosing the oldest sets `?run=` and the run card
  // shows that run; choosing the latest drops the parameter again.
  test.describe("A-16 Runs: the Run dropdown switches the shown run", () => {
    test("run dropdown drives ?run= and the run card", async ({ page }) => {
      const index = (await (await page.request.get("/runs/index.json")).json()) as {
        runs: { runId: string; finishedAt: string }[];
      };
      const byFinish = [...index.runs].sort(
        (a, b) => Date.parse(a.finishedAt) - Date.parse(b.finishedAt),
      );
      const oldest = byFinish[0];
      const latest = byFinish[byFinish.length - 1];
      test.skip(oldest === undefined || latest === undefined || byFinish.length < 2, "one run");
      if (oldest === undefined || latest === undefined) return;

      await page.goto("/runs");
      const picker = page.getByRole("combobox", { name: "Run", exact: true });
      await expect(picker).toBeVisible({ timeout: 60_000 });
      await expect(runCard(page, latest.runId)).toBeVisible({ timeout: 60_000 });
      const ids = await picker
        .locator("option")
        .evaluateAll((options) => options.map((o) => o.getAttribute("data-run-id")));
      expect(ids, "every run, newest first").toEqual(byFinish.map((r) => r.runId).reverse());
      await expect(picker).toHaveValue(latest.runId);
      expect(await picker.locator("option").first().textContent()).toMatch(
        /^Run \d+(\.\d+)? · [A-Z][a-z]{2} \d{1,2}, \d{4} · latest$/,
      );

      await picker.selectOption(oldest.runId);
      await expect(page).toHaveURL(new RegExp(`[?&]run=${oldest.runId}`));
      await expect(runCard(page, oldest.runId)).toBeVisible({ timeout: 60_000 });
      await expect(picker).toHaveValue(oldest.runId);

      await picker.selectOption(latest.runId);
      await expect(page).not.toHaveURL(/[?&]run=/);
      await expect(runCard(page, latest.runId)).toBeVisible({ timeout: 60_000 });
    });
  });

  test.describe("A-03-TC-061 Evidence names the hosted URL used (edge)", () => {
    test("@scenario:A-03-TC-061", async () => {
      const testInfo = test.info();
      // Step 1: the deployed build, and the evidence file of the story it was built from
      // (research R11): NNN-slug → docs/evidence/A-{NN}.md; any other branch is skipped.
      const build = await fetchBuildInfo();
      const url = runtimeUrl();
      const target = evidenceTargetForBranch(build.branch);
      test.skip(target.kind === "skip", target.kind === "skip" ? target.reason : "");
      if (target.kind !== "story") return;
      const EVIDENCE_PATH = target.path;

      // Step 2: the evidence names that URL and that SHA (full, or a prefix of at least 7).
      const path = resolve(repoRoot, EVIDENCE_PATH);
      expect(
        existsSync(path),
        `${EVIDENCE_PATH} is missing: write it with the hosted RUNTIME_URL (${url}) and the deployed build SHA from ${url}/build.json (${build.sha}, full or a 7+ hex prefix)`,
      ).toBe(true);
      const evidence = readFileSync(path, "utf8");
      await testInfo.attach("evidence-head.md", {
        body: evidence.slice(0, 4000),
        contentType: "text/markdown",
      });
      // The file is A-03's own record. On A-03's branch it must name that branch's URL verbatim.
      // On a later story's branch it still names A-03's URL, so there it must name an Amplify
      // runtime URL, and (below) a commit that is an ancestor of the deployed build.
      const onA03Branch = url.includes("003-walking-skeleton");
      if (onA03Branch) {
        expect(
          evidence,
          `${EVIDENCE_PATH} must contain the hosted RUNTIME_URL verbatim: ${url}`,
        ).toContain(url);
      } else {
        expect(
          evidence,
          `${EVIDENCE_PATH} must name an Amplify runtime URL (this branch's URL is ${url})`,
        ).toMatch(/https:\/\/[a-z0-9-]+\.[a-z0-9]+\.amplifyapp\.com/);
      }
      const shaTokens = evidence.match(/\b[0-9a-f]{7,40}\b/g) ?? [];
      // A commit cannot contain its own hash, so recording the measured build is itself a later
      // commit. Accept the deployed SHA, or an ancestor of it from which only docs/, specs/, tests/ and .github/
      // changed: the evidence then still describes exactly the code that is deployed.
      const describesDeployedCode = (token: string): boolean => {
        if (build.sha.startsWith(token)) return true;
        const git = (args: string[]): number =>
          spawnSync("git", args, { cwd: repoRoot, stdio: "ignore" }).status ?? 1;
        return (
          git(["merge-base", "--is-ancestor", token, build.sha]) === 0 &&
          git([
            "diff",
            "--quiet",
            token,
            build.sha,
            "--",
            ".",
            ":!docs",
            ":!specs",
            ":!tests",
            ":!.github",
          ]) === 0
        );
      };
      // On a later story's branch the deployed code has moved on, so the recorded A-03 commit
      // only has to be an ancestor of the deployed build (A-03's code is part of it).
      const isAncestorOfDeployed = (token: string): boolean =>
        build.sha.startsWith(token) ||
        (spawnSync("git", ["merge-base", "--is-ancestor", token, build.sha], {
          cwd: repoRoot,
          stdio: "ignore",
        }).status ?? 1) === 0;
      expect(
        shaTokens.some(onA03Branch ? describesDeployedCode : isAncestorOfDeployed),
        `${EVIDENCE_PATH} must name the deployed build SHA from ${url}/build.json: ${build.sha} (full, or a lowercase hex prefix of at least 7 characters), or an ancestor of it with no code change since (only docs/, specs/, tests/ and .github/ may differ)`,
      ).toBe(true);
    });
  });
});
