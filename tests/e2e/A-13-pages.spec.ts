// A-13 Part 2 page cases (T043; testplans/A-13-test-cases.md § 8): TC-001 (Hub, D-1), TC-042 (Help · MCP),
// TC-050 … TC-057 (Hub config, Catalog, Legal, Runs · Log), TC-060 … TC-070 (each Coming soon item),
// TC-071 (other county), TC-072 (390: filter sheet, More sheet, 48 px), TC-080 (every route at 390 / 768 /
// 1440, Atlas tokens), TC-085 (harness refuses localhost) and TC-086 (every route loads, reloads and links).
// One test per case, titled `@scenario:A-13-TC-nnn`; expected values come from the `oracle` fixture and the
// app's own route and Coming soon files at run time; fixed strings come from @countylens/shared; faults are
// injected with page.route() in this browser only. The DOM hooks these cases read are listed in
// lib/a13-pages.ts. "Waits for A-11" cases assert what the case says for the runs published today and record
// the branch (noteBranch).
import { createRequire } from "node:module";
import type { Locator, Page, Route } from "@playwright/test";
import {
  MCP_TRY_TEXTS,
  PAGE_TEXTS,
  ROUTES,
  comingSoonPath,
  sourceLabel,
  verifyPath,
} from "@countylens/shared";
import { cidTokens, fetchManifestFromPinata, pinataManifestUrl } from "./lib/a13.js";
import {
  checkpoint,
  ensureFiltersOpen,
  expect,
  isDuckdbWasm,
  noteBranch,
  recordRequests,
  test,
  type A13Oracle,
  PARKED_GAPS,
  parkGap,
  parkedRoute,
} from "./lib/a13-fixtures.js";
import {
  inSiteHrefs,
  openMore,
  openSettled,
  pageHeading,
  routeSettled,
  skeletonFacts,
  watchConsole,
} from "./lib/a13-pages.js";
import { comingSoonItems, routeTargets, type ComingSoonItemFacts } from "./lib/a13-routes.js";
import { SEL, exploreUrl, scenario, templatePattern } from "./lib/a13-ui.js";
import { AUDITED_PROPERTIES, atlasTokenAudit, smallTapTargets } from "./lib/atlas-tokens.js";
import { RUNTIME_URL_UNSET_TEXT, runtimeUrlLocalhostText } from "./lib/runtime-url.js";
import { e2eRoot, fetchBuildInfo } from "./lib/runtime.js";
import { resolveDataGroups } from "./lib/manifest.js";
import { childEnv, run } from "./lib/spawn.js";

const EXPLORE = ROUTES.explore;
/** A wide area (downtown Austin, 25 mi) so the published run returns property rows (TC-030). */
const WIDE = { at: "30.2672,-97.7431", r: 25, roof: 0, view: "list" } as const;
const TAP_MIN_PX = 48;
const WIDTHS = [390, 768, 1440] as const;

const fulfillJson = (route: Route, body: unknown, status = 200): Promise<void> =>
  route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

// ---------------------------------------------------------------------------------------
// Hub
// ---------------------------------------------------------------------------------------

const card = (page: Page, which: "countylens" | "crm"): Locator =>
  page.locator("article").filter({
    has: page.getByRole("heading", {
      name: which === "crm" ? "Roofing CRM" : "CountyLens",
      exact: true,
    }),
  });
const action = (scope: Locator, name: string): Locator =>
  scope
    .getByRole("link", { name, exact: true })
    .or(scope.getByRole("button", { name, exact: true }));
const crmAction = (page: Page): Locator => card(page, "crm").locator("button, a").first();

async function routeSiteLinks(page: Page, links: Record<string, string>): Promise<void> {
  await page.route("**/site-links.json*", (route) => fulfillJson(route, links));
}

async function expectCrmNotDeployed(page: Page): Promise<void> {
  await expect(card(page, "crm")).toContainText(PAGE_TEXTS.comingSoonNotDeployed);
  const control = crmAction(page);
  await expect(control).toBeVisible();
  const disabled =
    (await control.getAttribute("disabled")) !== null ||
    (await control.getAttribute("aria-disabled")) === "true";
  expect(disabled, "CRM button is disabled").toBe(true);
  expect(await control.getAttribute("href"), "CRM button has no href").toBeNull();
}

test.describe("A-13 pages · Hub", { tag: "@a13-pages" }, () => {
  test(scenario("001"), async ({ page, oracle }) => {
    // 1. Open / → Hub renders.
    await page.goto(ROUTES.hub);
    await routeSettled(page);
    await checkpoint(page, "001", 1);
    // 2. The CountyLens card shows "Open" and "What can I ask?".
    const county = card(page, "countylens");
    await expect(action(county, "Open")).toBeVisible();
    await expect(action(county, "What can I ask?")).toBeVisible();
    // 3. The Roofing CRM card: "Coming soon · Not deployed yet", disabled button, no href.
    await expectCrmNotDeployed(page);
    // 4. The chip: "Run {n} · {YYYY-MM-DD HH:mm} UTC" from runs/index.json.
    const chipText = PAGE_TEXTS.hubChip(`Run ${oracle.n}`, oracle.latest.finishedAt);
    const chip = page.getByText(chipText, { exact: true });
    await expect(chip).toBeVisible();
    await checkpoint(page, "001", 4);
    // No number on the Hub other than the chip's.
    const text = await page.locator("main").innerText();
    expect(text.replace(await chip.innerText(), ""), "no number besides the chip").not.toMatch(
      /\d/,
    );
    // 5. Click "Open" → /tx/travis/explore.
    await action(county, "Open").click();
    await expect.poll(() => new URL(page.url()).pathname).toBe(EXPLORE);
    await checkpoint(page, "001", 5);
  });

  test(scenario("050"), async ({ page }) => {
    // 1. build.json sha.
    const before = await fetchBuildInfo();
    // 2. site-links.json today (""), or an https URL once Task B is live.
    const links = (await (await page.request.get("/site-links.json")).json()) as {
      crmUrl?: unknown;
    };
    expect(typeof links.crmUrl, "crmUrl is a string").toBe("string");
    expect(links.crmUrl, "crmUrl is empty or https").toMatch(/^(|https:\/\/.+)$/);
    test
      .info()
      .annotations.push({ type: "crmUrl-today", description: JSON.stringify(links.crmUrl) });
    // 3 + 4. Route a valid https crmUrl; open the Hub.
    const live = "https://crm.example.invalid/";
    await routeSiteLinks(page, { crmUrl: live, demoVideoUrl: "", prUrl: "" });
    await page.goto(ROUTES.hub);
    await routeSettled(page);
    // 5. The CRM card is enabled and links to it, without "Coming soon · Not deployed yet".
    const control = crmAction(page);
    await expect(control).toHaveAttribute("href", live);
    expect(await control.getAttribute("aria-disabled")).not.toBe("true");
    await expect(card(page, "crm")).not.toContainText(PAGE_TEXTS.comingSoonNotDeployed);
    await checkpoint(page, "050", 5);
    // 6. http (not https) → stays "Coming soon · Not deployed yet", button disabled.
    await page.unroute("**/site-links.json*");
    await routeSiteLinks(page, {
      crmUrl: "http://crm.example.invalid/",
      demoVideoUrl: "",
      prUrl: "",
    });
    await page.goto(ROUTES.hub);
    await routeSettled(page);
    await expectCrmNotDeployed(page);
    await checkpoint(page, "050", 6);
    // 7. The build sha is unchanged.
    expect((await fetchBuildInfo()).sha).toBe(before.sha);
  });

  test(scenario("051"), async ({ page }) => {
    const none = async (): Promise<void> => {
      for (const name of ["Watch demo", "PR"]) {
        await expect(page.getByRole("link", { name, exact: true }), `${name} hidden`).toHaveCount(
          0,
        );
      }
    };
    const noDeadLinks = async (): Promise<void> => {
      const hrefs = await page
        .locator("main a")
        .evaluateAll((as) => as.map((a) => a.getAttribute("href")));
      for (const href of hrefs)
        expect(href, "no dead or placeholder link").toMatch(/^(?!#$)(?!\s*$).+/);
    };
    // 1. Open / ; 2. absent while demoVideoUrl and prUrl are "" in /site-links.json.
    const configured = (await (await page.request.get("/site-links.json")).json()) as {
      demoVideoUrl?: string;
      prUrl?: string;
    };
    await page.goto(ROUTES.hub);
    await routeSettled(page);
    if ((configured.demoVideoUrl ?? "") === "" && (configured.prUrl ?? "") === "") await none();
    await noDeadLinks();
    await checkpoint(page, "051", 2);
    // ... and present with the configured https URLs when set (routed).
    const demo = "https://video.example.invalid/demo";
    const pr = "https://github.example.invalid/pr/1";
    await page.unroute("**/site-links.json*").catch(() => undefined);
    await routeSiteLinks(page, { crmUrl: "", demoVideoUrl: demo, prUrl: pr });
    await page.goto(ROUTES.hub);
    await routeSettled(page);
    await expect(page.getByRole("link", { name: "Watch demo", exact: true })).toHaveAttribute(
      "href",
      demo,
    );
    await expect(page.getByRole("link", { name: "PR", exact: true })).toHaveAttribute("href", pr);
    await noDeadLinks();
    await checkpoint(page, "051", 3);
    // An invalid URL is hidden, not a placeholder.
    await page.unroute("**/site-links.json*");
    await routeSiteLinks(page, {
      crmUrl: "",
      demoVideoUrl: "javascript:alert(1)",
      prUrl: "http://x.invalid/",
    });
    await page.goto(ROUTES.hub);
    await routeSettled(page);
    await none();
  });

  test(scenario("052"), async ({ page }) => {
    // 1. Open / ; record requests until network idle.
    const net = recordRequests(page);
    await page.goto(ROUTES.hub);
    await routeSettled(page);
    await page.waitForLoadState("networkidle");
    await checkpoint(page, "052", 1);
    const urls = net.requests.map((r) => r.url);
    expect(urls.filter(isDuckdbWasm).map(String), "no DuckDB-WASM or worker request").toEqual([]);
    expect(urls.filter((u) => /duckdb/i.test(u.href)).map(String), "no DuckDB file at all").toEqual(
      [],
    );
    expect(
      urls.filter((u) => /\.parquet(\?|$)/i.test(u.pathname)).map(String),
      "no Parquet request",
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------
// Help · MCP
// ---------------------------------------------------------------------------------------

test.describe("A-13 pages · Help MCP", { tag: "@a13-pages" }, () => {
  test(scenario("042"), async ({ page }) => {
    // 1. Open /help/mcp.
    await page.goto(ROUTES.helpMcp);
    const section = await routeSettled(page);
    await checkpoint(page, "042", 1);
    // 2. Six tools with schemas; Desktop, Code and Inspector snippets with the bearer header.
    await expect(section.locator("[data-tool]")).toHaveCount(6);
    const text = await section.innerText();
    for (const client of ["Desktop", "Code", "Inspector"])
      expect(text, `${client} snippet`).toContain(client);
    expect(text).toContain("Authorization: Bearer <token>");
    // Each tool shows either its input schema ([data-schema]) or, until the MCP server exists
    // (story A-14), the explicit pending line ([data-schema-pending]): never nothing.
    for (const tool of await section.locator("[data-tool]").all()) {
      await expect(
        tool.locator("[data-schema], [data-schema-pending]").first(),
        "tool schema or its pending reason",
      ).toBeVisible();
    }
    // At least search_properties shows a real schema now.
    await expect(section.locator("[data-schema]").first(), "one real schema").toBeVisible();
    // 3. Click "Try a tool" → since A-14 (T034) it runs the read-only tool through the server
    // proxy: the status line must show the running text and then a real outcome (rows, an empty
    // reason or an honest error), never a sample. A-14-TC-027b covers the proxy in detail.
    await section.getByRole("button", { name: /^Try /i }).first().click();
    const status = section.getByRole("status");
    await expect(status, "a status line appears for the tool call").toBeVisible();
    await expect(status, "a real outcome, not the running text").not.toHaveText(
      MCP_TRY_TEXTS.running,
      { timeout: 40_000 },
    );
    await checkpoint(page, "042", 3);
  });
});

// ---------------------------------------------------------------------------------------
// Catalog, Legal, Runs · Log
// ---------------------------------------------------------------------------------------

type Manifest = A13Oracle["M"];

/** The catalog row key of a table part: `tables/{group}/{table}`, the group resolved from its export batch (a pilot run's `tables/{group}` or a full run's `…/tables/bNN`). */
function tableKeyOf(groups: ReadonlyMap<string, string>, name: string): string | null {
  const segs = name.split("/");
  const group = groups.get(segs.slice(0, -2).join("/"));
  const table = segs.at(-2);
  return group !== undefined && table !== undefined ? `tables/${group}/${table}` : null;
}

/** `tables/{group}/{table}` names of the published tables of `M` (a table may have several part files, in several batches). */
function tableNames(M: Manifest): string[] {
  const groups = resolveDataGroups(M);
  const names = new Set<string>();
  for (const a of M.artifacts) {
    if (a.kind !== "table") continue;
    const key = tableKeyOf(groups, a.name);
    if (key !== null) names.add(key);
  }
  return [...names].sort();
}

const partsOf = (M: Manifest, table: string): Manifest["artifacts"] => {
  const groups = resolveDataGroups(M);
  return M.artifacts.filter((a) => a.kind === "table" && tableKeyOf(groups, a.name) === table);
};

/** Columns of one table from a tables-export.json body, tolerating `tables` as an array or a record. */
function exportColumns(json: unknown, table: string): { name: string; type: string }[] | null {
  const short = table.split("/").at(-1);
  const root = json as { tables?: unknown };
  const list: unknown[] = Array.isArray(root.tables)
    ? root.tables
    : root.tables !== null && typeof root.tables === "object"
      ? Object.entries(root.tables as Record<string, unknown>).map(([k, v]) => ({
          name: k,
          ...(v as object),
        }))
      : [];
  for (const entry of list as {
    name?: string;
    table?: string;
    columns?: { name: string; type: string }[];
  }[]) {
    const name = entry.name ?? entry.table ?? "";
    if (name === table || name === short) return entry.columns ?? null;
  }
  return null;
}

test.describe("A-13 pages · Catalog, Legal, Runs log", { tag: "@a13-pages" }, () => {
  test(scenario("053"), async ({ page, oracle }) => {
    parkGap(PARKED_GAPS.catalogFooters);
    noteBranch(oracle);
    const { M } = oracle;
    // 1. Open /data/catalog.
    await page.goto(ROUTES.dataCatalog);
    const section = await routeSettled(page);
    await checkpoint(page, "053", 1);
    // 2. One row per published table of M.artifacts, with its CID and size.
    const tables = tableNames(M);
    expect(tables.length, "the manifest lists tables").toBeGreaterThan(0);
    const rows = section.locator("[data-catalog-row]");
    await expect(rows).toHaveCount(tables.length);
    for (const table of tables) {
      const row = section.locator(`[data-catalog-row="${table}"]`);
      await expect(row, table).toHaveCount(1);
      const parts = partsOf(M, table);
      const cids = await row
        .locator("a[data-cid]")
        .evaluateAll((as) => as.map((a) => a.getAttribute("data-cid")));
      expect(new Set(cids), `${table}: one CID link per part`).toEqual(
        new Set(parts.map((p) => p.cid)),
      );
      await expect(row.locator("[data-size]"), `${table}: summed size`).toHaveAttribute(
        "data-value",
        String(parts.reduce((t, p) => t + p.size, 0)),
      );
    }
    // 3. Columns: from tables-export.json when M lists it, else the Parquet schema and the notice.
    const exportArtifact = M.artifacts.find((a) => /(^|\/)tables-export\.json$/.test(a.name));
    if (oracle.branch === "a11" && exportArtifact !== undefined) {
      const json = (await (
        await page.request.get(pinataManifestUrl(exportArtifact.cid))
      ).json()) as unknown;
      await expect(section.locator("[data-export-notice]")).toHaveCount(0);
      for (const table of tables) {
        const expected = exportColumns(json, table);
        expect(expected, `${table} in tables-export.json`).not.toBeNull();
        const shown = await section
          .locator(`[data-catalog-row="${table}"] [data-column]`)
          .evaluateAll((els) =>
            els.map((e) => ({
              name: e.getAttribute("data-name") ?? "",
              type: e.getAttribute("data-type") ?? "",
            })),
          );
        expect(shown, `${table}: columns`).toEqual(expected);
      }
    } else {
      // Batched table directories (…/tables/b01) are a table export too: no notice then.
      const batched = M.artifacts.some(
        (a) => a.kind === "directory" && /(^|\/)tables\/b\d+$/.test(a.name),
      );
      if (batched) await expect(section.locator("[data-export-notice]")).toHaveCount(0);
      else
        await expect(section.locator("[data-export-notice]")).toHaveText(
          PAGE_TEXTS.tableExportMissing,
        );
      for (const table of tables) {
        // Each table fills in as ITS Parquet footer arrives (progressive render, ERR-41): wait for
        // the "reading the Parquet footer…" note of this row to clear before counting columns. A
        // footer that really fails still fails here (the row then shows a reason, not columns).
        await expect(
          section.locator(`[data-catalog-row="${table}"] [data-footer-status="pending"]`),
          `${table}: footer still pending`,
        ).toHaveCount(0, { timeout: 60_000 });
        const cols = section.locator(`[data-catalog-row="${table}"] [data-column]`);
        expect(await cols.count(), `${table}: columns from the Parquet schema`).toBeGreaterThan(0);
        for (const col of await cols.all()) {
          expect((await col.getAttribute("data-name")) ?? "").not.toBe("");
          expect((await col.getAttribute("data-type")) ?? "").not.toBe("");
        }
      }
    }
    // 4. "rows in the published file" is a count; published_rows sits beside it where a coverage key maps.
    for (const row of await rows.all()) {
      expect(await row.locator("[data-rows]").getAttribute("data-value")).toMatch(/^\d+$/);
    }
    for (const el of await section.locator("[data-published-rows]").all()) {
      const key = (await el.getAttribute("data-coverage-key")) ?? "";
      expect(M.coverage[key], `coverage key ${key} in M`).toBeDefined();
      expect(await el.getAttribute("data-value")).toBe(String(M.coverage[key]?.count));
    }
    await checkpoint(page, "053", 4);
    // 5. Click a CID → /data/verify/{cid}.
    const first = section.locator("[data-catalog-row] a[data-cid]").first();
    const cid = (await first.getAttribute("data-cid")) ?? "";
    await first.click();
    await expect.poll(() => new URL(page.url()).pathname).toBe(verifyPath(cid));
    await checkpoint(page, "053", 5);
  });

  test(scenario("054"), async ({ page, oracle }) => {
    // 1. tables-export.json and every table artifact (any host) answer 503.
    const tableCids = tableNames(oracle.M).flatMap((t) => partsOf(oracle.M, t).map((p) => p.cid));
    await page.route("**/tables-export.json*", (route) =>
      fulfillJson(route, { error: "unavailable" }, 503),
    );
    await page.route(
      (url) => tableCids.some((cid) => url.pathname.includes(cid)),
      (route) => route.fulfill({ status: 503, body: "unavailable" }),
    );
    // 2. Open /data/catalog.
    await page.goto(ROUTES.dataCatalog);
    const section = await routeSettled(page);
    const pattern = templatePattern(PAGE_TEXTS.catalogUnavailable, 1);
    const line = section.getByText(pattern).first();
    await expect(line).toBeVisible({ timeout: 60_000 });
    const reason = pattern.exec((await line.innerText()).trim())?.[1] ?? "";
    expect(reason.trim(), "a reason naming what failed").not.toBe("");
    await expect(section.getByRole("link", { name: /manifest/i }).first()).toHaveAttribute(
      "href",
      ROUTES.dataManifest,
    );
    await expect(section.locator("[data-catalog-row]")).toHaveCount(0);
    await checkpoint(page, "054", 2);
  });

  test(scenario("055"), async ({ page }) => {
    // 1. Open /legal/data.
    await page.goto(ROUTES.legalData);
    const section = await routeSettled(page);
    await checkpoint(page, "055", 1);
    // 2. Eight sources, each with a terms or licence link (the Austin address points added
    // 2026-10-26: a manifest source since Run 3).
    const sources = section.locator("[data-source]");
    await expect(sources).toHaveCount(8);
    const text = await section.innerText();
    for (const name of [
      "TCAD",
      "Travis County GIS",
      "3syk-w9eu",
      "LOCATION_address_points",
      "9cir-efmm",
      "BBB",
      "Overture",
      "Gazetteer",
    ]) {
      expect(text, `source ${name}`).toContain(name);
    }
    for (const src of await sources.all()) {
      const href = (await src.locator('a[href^="https://"]').first().getAttribute("href")) ?? "";
      expect(href, "terms or licence link").toMatch(/^https:\/\/.+/);
    }
    // 3. The four access rules.
    const rules = section.getByRole("list", { name: "Access rules" }).getByRole("listitem");
    await expect(rules).toHaveCount(4);
    const ruleText = (await rules.allInnerTexts()).join("\n");
    for (const rule of [/public sources only/i, /403/, /CAPTCHA/i, /Query DB/i]) {
      expect(ruleText, `rule ${String(rule)}`).toMatch(rule);
    }
    await checkpoint(page, "055", 3);
  });

  test(scenario("056"), async ({ page }) => {
    for (const [step, path] of [
      [1, ROUTES.legalPrivacy],
      [2, ROUTES.legalTerms],
    ] as const) {
      // 1. Open the page, recording requests.
      const net = recordRequests(page);
      await page.goto(path);
      const section = await routeSettled(page);
      await page.waitForLoadState("networkidle");
      // 2. A heading, static text, a link to /legal/data and no data request.
      await expect(pageHeading(page)).toBeVisible();
      expect((await section.innerText()).trim().length, "static text").toBeGreaterThan(100);
      await expect(section.locator(`a[href="${ROUTES.legalData}"]`).first()).toBeVisible();
      const hit = net.requests
        .map((r) => r.url)
        .filter(
          (u) =>
            /\.parquet(\?|$)/i.test(u.pathname) ||
            /\/ipfs\//.test(u.pathname) ||
            /manifest|runs\/index/i.test(u.pathname),
        );
      expect(hit.map(String), "no Parquet or manifest fetch").toEqual([]);
      expect(cidTokens(await section.innerText()), "no CID from data").toEqual([]);
      await expect(section.locator("[data-cid]")).toHaveCount(0);
      await checkpoint(page, "056", step);
    }
  });

  test(scenario("057"), async ({ page, oracle }) => {
    test.setTimeout(240_000);
    noteBranch(oracle);
    // 2. Expected events from every manifest the index lists.
    interface Ev {
      runId: string;
      kind: string;
      at: number;
      source: string;
    }
    const expected: Ev[] = [];
    const limitations = new Map<string, string[]>();
    const sourceLabels: string[] = [];
    // A capture an earlier run already holds (same source, same time) was carried over: it is that
    // run's event, not this one's (label review 2026-10-26).
    const seen = new Set<string>();
    const loaded = [];
    for (const entry of oracle.runs) {
      loaded.push(
        entry.manifestCid === oracle.manifestCid
          ? { manifest: oracle.M, bytes: oracle.manifestBytes }
          : await fetchManifestFromPinata(entry.manifestCid),
      );
    }
    loaded.sort((x, y) => Date.parse(x.manifest.startedAt) - Date.parse(y.manifest.startedAt));
    for (const fetched of loaded) {
      const m = fetched.manifest;
      expected.push({ runId: m.runId, kind: "started", at: Date.parse(m.startedAt), source: "" });
      for (const s of m.sources) {
        const capture = `${s.name}|${s.captured_at}`;
        if (!seen.has(capture)) {
          expected.push({
            runId: m.runId,
            kind: "captured",
            at: Date.parse(s.captured_at),
            source: "",
          });
        }
        sourceLabels.push(sourceLabel(s.name));
      }
      for (const s of m.sources) seen.add(`${s.name}|${s.captured_at}`);
      expected.push({ runId: m.runId, kind: "finished", at: Date.parse(m.finishedAt), source: "" });
      limitations.set(m.runId, m.limitations);
      const raw = JSON.parse(new TextDecoder().decode(fetched.bytes)) as {
        events?: { at?: string; kind?: string }[];
      };
      for (const e of raw.events ?? []) {
        expected.push({ runId: m.runId, kind: "event", at: Date.parse(e.at ?? ""), source: "" });
      }
    }
    // 1. Open /runs/log.
    await page.goto(ROUTES.runsLog);
    const section = await routeSettled(page);
    const items = section.locator("[data-event]");
    await expect(items.first()).toBeVisible({ timeout: 60_000 });
    await checkpoint(page, "057", 1);
    // 3. Exactly these events, newest first (the board's default order), each with its run ID.
    const shown: Ev[] = await items.evaluateAll((els) =>
      els.map((e) => ({
        runId: e.getAttribute("data-run-id") ?? "",
        kind: e.getAttribute("data-event") ?? "",
        at: Date.parse(e.getAttribute("data-time") ?? ""),
        source: "",
      })),
    );
    const key = (e: Ev): string => `${e.runId}|${e.kind}|${e.at}|${e.source}`;
    expect(shown.map(key).sort(), "the page lists exactly the expected events").toEqual(
      expected.map(key).sort(),
    );
    expect(
      shown.map((e) => e.at),
      "newest first",
    ).toEqual([...shown.map((e) => e.at)].sort((a, b) => b - a));
    const shownText = (await items.allInnerTexts()).join("\n");
    for (const label of sourceLabels) expect(shownText, `capture of ${label}`).toContain(label);
    for (const [runId, list] of limitations) {
      const finish = section.locator(`[data-event="finished"][data-run-id="${runId}"]`);
      for (const text of list) await expect(finish, `limitation of ${runId}`).toContainText(text);
    }
    await checkpoint(page, "057", 3);
  });
});

// ---------------------------------------------------------------------------------------
// Coming soon (TC-060 … TC-070), other county (TC-071), 390 (TC-072)
// ---------------------------------------------------------------------------------------

const ONE_SENTENCE = /^[^.!?]+[.!?]$/;

/** The in-context entry point of each item: its start URL and the steps that reach the control. */
const ENTRY: Record<
  string,
  { url: (o: A13Oracle) => string; prep?: (page: Page) => Promise<void> }
> = {
  // PO 2026-10-26: Explore no longer lists these four; they are reached from the More sheet's
  // "Planned" list (and their /soon/{item} routes).
  "builder-mode": { url: () => EXPLORE, prep: openMoreSheet },
  "other-counties": { url: () => EXPLORE, prep: openMoreSheet },
  "street-view": { url: () => exploreUrl(EXPLORE, WIDE), prep: openFirstProperty },
  "saved-searches": { url: () => EXPLORE, prep: openMoreSheet },
  "similar-properties": { url: () => exploreUrl(EXPLORE, WIDE), prep: openFirstProperty },
  // PO 2026-10-26: the Runs page's empty Timeline card is gone; both are in the Planned list.
  "pipeline-diagram": { url: () => EXPLORE, prep: openMoreSheet },
  "area-matrix": { url: () => EXPLORE, prep: openMoreSheet },
  "timeline-scrubber": { url: () => EXPLORE, prep: openMoreSheet },
  "gateway-race": { url: (o) => verifyPath(o.manifestCid) },
};

async function openMoreSheet(page: Page): Promise<void> {
  await openMore(page);
}

async function openFirstProperty(page: Page): Promise<void> {
  const row = page.locator(SEL.resultRow).first();
  await expect(row, "a result row to open the drawer from").toBeVisible({ timeout: 60_000 });
  await row.click();
  await expect(page.getByRole("dialog")).toBeVisible();
}

/** Steps 3 to 5 of TC-060 … TC-070 for the item shown on the current page. */
async function expectComingSoonItem(page: Page, item: ComingSoonItemFacts): Promise<void> {
  const panel = page.locator(`[data-coming-soon-item="${item.id}"]`).first();
  await expect(panel).toBeVisible();
  // 3. The label and exactly one sentence.
  await expect(panel).toContainText(PAGE_TEXTS.comingSoon);
  const sentence = panel.locator("[data-coming-soon-sentence]");
  await expect(sentence).toHaveText(item.sentence);
  expect(item.sentence, "exactly one sentence").toMatch(ONE_SENTENCE);
  // 4. The skeleton is static: aria-hidden, no text, no animation, no busy or progress role.
  const f = await skeletonFacts(panel);
  expect(f.ariaHidden, "skeleton aria-hidden").toBe("true");
  expect(f.textNodes, "no text nodes in the skeleton").toBe(0);
  expect(f.animations, "no running animation").toBe(0);
  expect(f.animated, "animation-name none on every block").toEqual([]);
  expect(f.busy + f.progress, "no aria-busy or progressbar").toBe(0);
  await expect(panel.locator('[role="progressbar"], [aria-busy="true"]')).toHaveCount(0);
  // 5. No digit, CID, table, row or list of data items.
  expect(f.digits, "no digit in the skeleton").toBe(false);
  expect(f.cidShaped, "no CID in the skeleton").toBe(false);
  expect(f.dataStructures, "no table, row or list").toBe(0);
}

test.describe("A-13 pages · Coming soon", { tag: "@a13-pages" }, () => {
  const items = comingSoonItems();
  const itemFor = (id: string): ComingSoonItemFacts => {
    const found = items.find((i) => i.id === id);
    if (found === undefined) throw new Error(`coming-soon.ts has no item ${id}`);
    return found;
  };
  const CASES: readonly [string, string][] = [
    ["060", "builder-mode"],
    ["061", "other-counties"],
    ["062", "street-view"],
    ["064", "saved-searches"],
    ["065", "similar-properties"],
    ["067", "pipeline-diagram"],
    ["068", "area-matrix"],
    ["069", "timeline-scrubber"],
    ["070", "gateway-race"],
  ];

  for (const [tc, id] of CASES) {
    test(scenario(tc), async ({ page, oracle }) => {
      const item = itemFor(id);
      const entry = ENTRY[id];
      if (entry === undefined) throw new Error(`no entry point defined for Coming soon item ${id}`);
      // 1. Open the entry point at 1440. 2. Open or select the item.
      await page.goto(entry.url(oracle));
      await routeSettled(page);
      await entry.prep?.(page);
      await page.locator(`[data-coming-soon-entry="${id}"]`).first().click();
      await expectComingSoonItem(page, item);
      await checkpoint(page, tc, "entry");
      // The direct route /soon/{item} shows the same item.
      await page.goto(comingSoonPath(id));
      await routeSettled(page);
      await expectComingSoonItem(page, item);
      await checkpoint(page, tc, "route");
    });
  }

  test(scenario("063"), async ({ page, oracle }) => {
    const item = itemFor("ai-user-sign-in");
    expect(item.linked, "AI-user sign-in is not linked").toBe(false);
    // Not linked: no link to it on any route, in the shell or the More sheet.
    const hrefs = new Set<string>();
    for (const path of [
      ROUTES.hub,
      ROUTES.runs,
      EXPLORE,
      ROUTES.helpMcp,
      verifyPath(oracle.manifestCid),
    ]) {
      await page.goto(path);
      await routeSettled(page);
      const sheet = await openMore(page);
      const entry = sheet.getByText(item.title, { exact: true });
      await expect(entry).toBeVisible();
      await expect(sheet.getByRole("link", { name: new RegExp(item.title, "i") })).toHaveCount(0);
      await expect(sheet.locator(`a[href*="${item.id}"]`)).toHaveCount(0);
      for (const h of await inSiteHrefs(page)) hrefs.add(h);
    }
    expect(
      // The admin sign-in entry (A-16 AC-6, /admin/sign-in) is not the AI-user sign-in.
      [...hrefs].filter((h) => /ai-user|sign-?in/i.test(h) && !h.startsWith("/admin/")),
      "no link to AI-user sign-in",
    ).toEqual([]);
    await checkpoint(page, "063", 1);
  });

  test(scenario("071"), async ({ page }) => {
    const message = page.locator("[data-county-message]");
    // 1. Open Explore. 2. Open the picker; select Harris County.
    await page.goto(EXPLORE);
    await routeSettled(page);
    const picker = page.locator("[data-county-picker]").first();
    if ((await picker.evaluate((el) => el.tagName.toLowerCase())) === "select") {
      // Playwright matches a <select> option label exactly; the page labels it "Harris County, TX".
      await picker.selectOption({ label: "Harris County, TX" });
    } else {
      await picker.click();
      await page.getByRole("option", { name: /Harris County/ }).click();
    }
    await expect(message).toHaveText(PAGE_TEXTS.travisOnly);
    expect(new URL(page.url()).pathname, "the active county stays Travis").toBe(EXPLORE);
    await checkpoint(page, "071", 2);
    // 3. Open /tx/harris/explore directly.
    await page.goto("/tx/harris/explore");
    await routeSettled(page);
    await expect(message).toHaveText(PAGE_TEXTS.travisOnly);
    await expect(page.locator(`main a[href="${EXPLORE}"]`).first()).toBeVisible();
    await expect(page.locator("[data-cid], [data-result-row]")).toHaveCount(0);
    expect(cidTokens(await page.locator("main").innerText()), "no CID").toEqual([]);
    await checkpoint(page, "071", 3);
  });

  test(scenario("072"), async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      colorScheme: "light",
    });
    const page = await context.newPage();
    try {
      const noOverflow = async (label: string): Promise<void> => {
        const o = await page.evaluate(() => ({
          s: document.documentElement.scrollWidth,
          w: window.innerWidth,
        }));
        expect.soft(o.s, `${label}: no horizontal scroll`).toBeLessThanOrEqual(o.w);
        expect
          .soft(
            await page.evaluate(smallTapTargets, TAP_MIN_PX),
            `${label}: targets ≥ ${TAP_MIN_PX} px`,
          )
          .toEqual([]);
      };
      // 1. Open Explore at 390 x 844.
      await page.goto(EXPLORE);
      await routeSettled(page);
      // 2. The filters are behind a "Filters" button that opens a sheet.
      const toggle = page.getByRole("button", { name: "Filters", exact: true });
      await expect(toggle).toBeVisible();
      await expect(page.getByRole("combobox", { name: "Place" })).toBeHidden();
      await ensureFiltersOpen(page);
      await expect(page.getByRole("combobox", { name: "Place" })).toBeVisible();
      await noOverflow("filter sheet");
      await checkpoint(page, "072", 2);
      // 3. The More sheet lists the Coming soon items.
      const sheet = await openMore(page);
      for (const item of comingSoonItems()) {
        const row = sheet.getByText(item.title, { exact: true });
        await expect(row, item.title).toBeVisible();
        await expect(row.locator("xpath=..")).toContainText(PAGE_TEXTS.comingSoon);
      }
      // 4. Every target ≥ 48 x 48 px; no horizontal scroll.
      await noOverflow("More sheet");
      await checkpoint(page, "072", 3);
    } finally {
      await context.close();
    }
  });
});

// ---------------------------------------------------------------------------------------
// Cross-cutting: responsive, harness, smoke
// ---------------------------------------------------------------------------------------

test.describe("A-13 pages · cross-cutting", { tag: "@a13-pages" }, () => {
  test(scenario("080"), async ({ browser, oracle }) => {
    test.setTimeout(30 * 60_000);
    const report: Record<string, unknown> = {};
    for (const target of routeTargets(oracle.manifestCid)) {
      if (parkedRoute(target.key)) continue;
      for (const width of WIDTHS) {
        const label = `${target.key} @ ${width}`;
        await test.step(label, async () => {
          // 1. Open the route at the width in a private window.
          const context = await browser.newContext({
            viewport: { width, height: width === 1440 ? 900 : width === 768 ? 1024 : 844 },
            colorScheme: "light",
          });
          try {
            const page = await context.newPage();
            await openSettled(page, target.path);
            await page.evaluate(() => document.fonts.ready.then(() => undefined));
            // 2. No horizontal scroll; at 390, targets ≥ 48 px.
            const o = await page.evaluate(() => ({
              s: document.documentElement.scrollWidth,
              w: window.innerWidth,
            }));
            expect.soft(o.s, `${label}: no horizontal scroll`).toBeLessThanOrEqual(o.w);
            const small = width === 390 ? await page.evaluate(smallTapTargets, TAP_MIN_PX) : [];
            expect.soft(small, `${label}: targets ≥ ${TAP_MIN_PX} px`).toEqual([]);
            // 3. Computed values only from Atlas tokens (the smeargle method, A-03-TC-NF-03).
            const audit = await page.evaluate(atlasTokenAudit, [...AUDITED_PROPERTIES]);
            expect.soft(audit.tokens, `${label}: tokens found`).toBeGreaterThan(0);
            expect.soft(audit.violations, `${label}: values outside the Atlas tokens`).toEqual([]);
            // 4. A screenshot per route and width.
            await checkpoint(page, "080", `${target.key}-${width}`, { fullPage: true });
            report[label] = {
              overflow: o,
              smallTargets: small,
              violations: audit.violations.length,
            };
          } finally {
            await context.close();
          }
        });
      }
    }
    await test.info().attach("A-13-TC-080.json", {
      body: JSON.stringify(report, null, 2),
      contentType: "application/json",
    });
  });

  test(scenario("085"), async () => {
    test.setTimeout(10 * 60_000);
    const cli = createRequire(import.meta.url).resolve("@playwright/test/cli");
    // 1. The deployed build, then the guard with each loopback value and with RUNTIME_URL unset.
    const build = await fetchBuildInfo();
    test.info().annotations.push({ type: "build-sha", description: build.sha });
    const cases: [string, string | undefined, string][] = [
      ["localhost", "http://localhost:3000", runtimeUrlLocalhostText("http://localhost:3000")],
      ["127.0.0.1", "http://127.0.0.1:3000", runtimeUrlLocalhostText("http://127.0.0.1:3000")],
      ["unset", undefined, RUNTIME_URL_UNSET_TEXT],
    ];
    for (const [label, value, expected] of cases) {
      const result = await run(
        process.execPath,
        [
          cli,
          "test",
          "-g",
          "A-13",
          "--list",
          "--config",
          "playwright.config.ts",
          "--reporter=list",
        ],
        { cwd: e2eRoot, env: childEnv({ RUNTIME_URL: value }), timeoutMs: 180_000 },
      );
      await test.info().attach(`a13-list-${label}.log`, {
        body: `$ RUNTIME_URL=${value ?? "<unset>"} ${result.command}\nexit ${result.code}\n\n${result.output}`,
        contentType: "text/plain",
      });
      expect(result.code, `${label}: exits non-zero`).not.toBe(0);
      expect(result.output, `${label}: the exact fixed text`).toContain(expected);
      expect(result.output, `${label}: no test is listed`).not.toMatch(
        /Total: \d+ tests? in \d+ files?/,
      );
    }
  });

  test(scenario("086"), async ({ page, oracle, request }) => {
    test.setTimeout(20 * 60_000);
    const targets = routeTargets(oracle.manifestCid);
    const visited = new Set(targets.map((t) => t.path.split("?")[0]));
    const hrefs = new Set<string>();
    const console_ = watchConsole(page);
    for (const target of targets) {
      // 1. Open: HTTP 200, the page heading, no console error.
      const response = await page.goto(target.path);
      expect(response?.status(), `${target.path}: HTTP status`).toBe(200);
      await routeSettled(page);
      await expect(pageHeading(page), `${target.path}: heading`).toBeVisible();
      for (const h of await inSiteHrefs(page)) hrefs.add(h);
      // 3. Reload keeps the route.
      await page.reload();
      await routeSettled(page);
      await expect(pageHeading(page), `${target.path}: heading after reload`).toBeVisible();
      expect(
        `${new URL(page.url()).pathname}${new URL(page.url()).search}`,
        "reload keeps the route",
      ).toBe(target.path);
    }
    // The More sheet links (every page and Coming soon item).
    await page.goto(ROUTES.hub);
    await routeSettled(page);
    await openMore(page);
    for (const h of await inSiteHrefs(page)) hrefs.add(h);
    expect(console_.errors, "no console error on any route").toEqual([]);
    await checkpoint(page, "086", 1);
    // 4. Crawl every in-site link: none returns 404; no link to AI-user sign-in.
    const broken: string[] = [];
    for (const href of hrefs) {
      if (visited.has(href.split("?")[0])) continue;
      const res = await request.get(href);
      if (res.status() >= 400) broken.push(`${href} → ${res.status()}`);
    }
    expect(broken, "no broken in-site link").toEqual([]);
    expect(
      // The admin sign-in entry (A-16 AC-6, /admin/sign-in) is not the AI-user sign-in.
      [...hrefs].filter((h) => /ai-user|sign-?in/i.test(h) && !h.startsWith("/admin/")),
      "no link to AI-user sign-in",
    ).toEqual([]);
    test.info().annotations.push({ type: "links-crawled", description: String(hrefs.size) });
  });
});
