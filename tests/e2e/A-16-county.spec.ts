// A-16 Part 3 on the full county (testplans/A-16-test-cases.md TC-034 to TC-037; AC-13, FR-012,
// NFR-003): Explore search, the agent and the MCP server answer on the latest full-county run
// (Run 3, 441,961 properties) from its per-run Explore index, and every row they cite comes from
// that run's published CIDs.
//   - TC-034: the four README Explore searches (the A-13 TC-041 radius + roof and open-permit
//     searches, plus tenure and out-of-area owner) on the demo area of
//     docs/evidence/A-13-open-permits.md (Austin, 5 mi). One search opens in the browser
//     (rows with provenance, no 5xx); then each search is timed 20 times against the same
//     `explore.search` the page calls (one untimed warm-up first), p95 < 3 s.
//   - TC-035: the two README agent prompts (D-10, D-11; lib/a14.ts GOLDEN.G1/G2, word for word)
//     on the Explore · AI tab. REAL BEDROCK CALLS: two asks, 7 s apart. This project is not in
//     the CI e2e matrix (like a14-agent), so CI never makes these calls.
//   - TC-036: one MCP `tools/call search_properties` with the TC-034 (a) arguments. Needs
//     MCP_URL and MCP_TOKEN in the environment (the A-14 MCP spec's variables); skips with that
//     reason when either is unset. The token is never written to a file, title or log.
//   - TC-037: every `table_cid` an `explore.search` row cites on the latest run is a table
//     artifact of that run's public manifest (fetched by CID and hash-checked, lib/runtime.ts),
//     and every row names that manifest and run. LIMIT: the index header (its source CIDs and the
//     raw permit count, A14-7) lives in private S3 and is not served, so "no CID missing from the
//     index" and the header count cannot be checked from outside; property record CIDs sit inside
//     the run's CARs, which this case does not download.
// Evidence: screenshots via lib/auth.ts checkpoint (docs/evidence/img/A-16-TC-*.png); timings and
// response summaries are attached to the Playwright report only.
// Run: RUNTIME_URL=https://… [CID_COPY_HOST=…] [MCP_URL=… MCP_TOKEN=…] \
//      pnpm exec playwright test --project=a16-county
import { expect, test, type APIRequestContext, type Response } from "@playwright/test";
import { AI_TEXTS, ROUTES } from "@countylens/shared";
import { demoArea, nextSearch } from "./lib/a13-fixtures.js";
import { ExploreSearchResult, SEL, exploreUrl, trpcData } from "./lib/a13-ui.js";
import { GOLDEN } from "./lib/a14.js";
import { checkpoint } from "./lib/auth.js";
import { LIMITS, TIMED_RUNS, summarize } from "./lib/perf.js";
import {
  fetchManifest,
  fetchRunsIndex,
  isLoopbackHost,
  latestRun,
  runtimeUrl,
  type RunsIndexEntry,
} from "./lib/runtime.js";

const BASE = runtimeUrl();
const TRPC = `${BASE}/api/trpc`;
const AREA = demoArea();
const PLACE = AREA.place.name.toLowerCase();
const RADIUS = AREA.radiusMi;
/** The explore.search route throttle is 3 requests a second: start calls at most 2.5 a second. */
const MIN_CALL_GAP_MS = 400;
const ASK_GAP_MS = 7_000;

/** The four README searches (Explore filters → explore.search input, contracts/explore-search.md). */
const SEARCHES = {
  "a radius + roof": { roof: 15 },
  "b open permits": { permit: "open_or_stalled", openYrs: 5, sort: "open_desc" },
  "c tenure": { tenure: 10 },
  "d out-of-area owner": { tenure: 10, ooa: true },
} as const satisfies Record<string, Record<string, unknown>>;
type SearchName = keyof typeof SEARCHES;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

let latestCache: RunsIndexEntry | undefined;
async function latest(): Promise<RunsIndexEntry> {
  latestCache ??= latestRun(await fetchRunsIndex());
  return latestCache;
}

interface Searched {
  readonly status: number;
  readonly ms: number;
  readonly body: unknown;
  readonly result: ExploreSearchResult | null;
}

let lastCallAt = 0;
async function search(
  request: APIRequestContext,
  manifestCid: string,
  name: SearchName,
  extra: Record<string, unknown> = {},
): Promise<Searched> {
  const wait = lastCallAt + MIN_CALL_GAP_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  const input = {
    manifestCid,
    area: { place: PLACE },
    radius_mi: RADIUS,
    ...SEARCHES[name],
    ...extra,
  };
  lastCallAt = Date.now();
  const started = Date.now();
  const response = await request.get(
    `${TRPC}/explore.search?input=${encodeURIComponent(JSON.stringify(input))}`,
    { timeout: 30_000 },
  );
  const ms = Date.now() - started;
  const body: unknown = await response.json().catch(() => null);
  let result: ExploreSearchResult | null = null;
  if (response.status() === 200) result = ExploreSearchResult.parse(trpcData(body));
  return { status: response.status(), ms, body, result };
}

/** Every value of `key` anywhere in `value` (rows, permits, close matches). */
function valuesOf(value: unknown, key: string, out: string[] = []): string[] {
  if (Array.isArray(value)) for (const v of value) valuesOf(v, key, out);
  else if (isObj(value)) {
    for (const [k, v] of Object.entries(value)) {
      if (k === key && typeof v === "string") out.push(v);
      else valuesOf(v, key, out);
    }
  }
  return out;
}

const attachJson = (name: string, value: unknown): Promise<void> =>
  test.info().attach(name, {
    body: `${JSON.stringify(value, null, 2)}\n`,
    contentType: "application/json",
  });

test.describe("A-16 full county: Explore, agent, MCP", () => {
  test("A-16-TC-034 explore README searches p95", async ({ page, request }) => {
    test.setTimeout(15 * 60_000);
    const run = await latest();

    // 1–2. Search (a) in the browser: rows with count and provenance; no 5xx, no ~29 s call.
    const failures: string[] = [];
    page.on("response", (r: Response) => {
      if (r.url().includes("/api/") && r.status() >= 500) failures.push(`${r.status()} ${r.url()}`);
    });
    const shown = await nextSearch(
      page,
      () => page.goto(exploreUrl(ROUTES.explore, { place: PLACE, r: RADIUS, roof: 15 })),
      60_000,
    );
    expect(shown.as_of.manifestCid, "the page searches the latest run").toBe(run.manifestCid);
    expect(shown.total_within_r).toBeGreaterThan(0);
    await expect(page.locator(SEL.header)).toBeVisible();
    const firstRow = page.locator(SEL.resultRow).first();
    await expect(firstRow).toBeVisible();
    await expect(firstRow.locator(SEL.provenance)).toContainText(run.runId);
    await checkpoint(page, "TC-034", "full-county-radius-roof");

    // 3–4. Each search: one untimed warm-up, then TIMED_RUNS (20) timed calls.
    const report: Record<string, object> = {};
    for (const name of Object.keys(SEARCHES) as SearchName[]) {
      const warm = await search(request, run.manifestCid, name);
      expect(warm.status, `${name} warm-up`).toBe(200);
      const timings: number[] = [];
      let last: Searched = warm;
      for (let i = 0; i < TIMED_RUNS; i += 1) {
        last = await search(request, run.manifestCid, name);
        if (last.status !== 200) failures.push(`${name} run ${String(i + 1)}: HTTP ${last.status}`);
        timings.push(last.ms);
      }
      const result = last.result;
      expect(result, `${name}: a parsed result`).not.toBeNull();
      if (result === null) continue;
      expect(result.as_of.manifestCid).toBe(run.manifestCid);
      // Provenance on every row.
      for (const row of result.rows) {
        expect(row.provenance.run_id, `${name} row run_id`).toBe(run.runId);
        expect(row.provenance.table_cid, `${name} row table_cid`).toBeTruthy();
      }
      const ownerArea = isObj(result) ? (result as Obj)["owner_area"] : undefined;
      if (name === "d out-of-area owner" && ownerArea !== undefined) {
        // The owner mailing gap is stated, never filtered to an empty "none".
        expect(ownerArea).toMatchObject({ status: "not_published" });
        expect(result.rows).toEqual([]);
      }
      report[name] = {
        ...summarize(timings),
        total_within_r: result.total_within_r,
        rows: result.rows.length,
        owner_area: ownerArea ?? null,
      };
    }
    await attachJson("A-16-TC-034-timings.json", {
      runId: run.runId,
      manifestCid: run.manifestCid,
      area: `${AREA.place.name} ${String(RADIUS)} mi`,
      limitP95Ms: LIMITS.queryP95Ms,
      searches: report,
    });
    test.info().annotations.push({
      type: "p95",
      description: Object.entries(report)
        .map(([n, r]) => `${n}: ${String((r as { p95Ms: number }).p95Ms)} ms`)
        .join("; "),
    });

    // 5. No 5xx and no call near the 29 s API limit.
    expect(failures, "HTTP 5xx or failed calls").toEqual([]);
    for (const [name, r] of Object.entries(report)) {
      const s = r as { p95Ms: number; maxMs: number };
      expect(s.p95Ms, `${name} p95`).toBeLessThan(LIMITS.queryP95Ms);
      expect(s.maxMs, `${name} slowest call`).toBeLessThan(25_000);
    }
  });

  test("A-16-TC-035 agent README prompts", async ({ page }) => {
    test.setTimeout(4 * 60_000);
    const run = await latest();
    const panel = page.locator('[data-panel="ai"]');
    await page.goto(ROUTES.explore);
    await page.getByRole("tab", { name: "AI" }).click();
    await expect(panel).toHaveAttribute("data-ai-state", "idle", { timeout: 60_000 });

    const ask = async (
      prompt: string,
    ): Promise<{ status: number; ms: number; state: string; data: Obj }> => {
      const answered = page.waitForResponse(
        (r) => r.url().includes("/api/agent/ask") && r.request().method() === "POST",
        { timeout: AI_TEXTS.clientStopMs + 10_000 },
      );
      const started = Date.now();
      await page.locator("#ai-question").fill(prompt);
      await page.getByRole("button", { name: "Ask", exact: true }).click();
      const response = await answered;
      const ms = Date.now() - started;
      await expect(panel).not.toHaveAttribute("data-ai-state", /^(idle|working)$/, {
        timeout: AI_TEXTS.clientStopMs + 10_000,
      });
      const state = (await panel.getAttribute("data-ai-state")) ?? "";
      const data = trpcData(await response.json());
      if (!isObj(data)) throw new Error(`agent.ask returned no object (HTTP ${response.status()})`);
      return { status: response.status(), ms, state, data };
    };

    const checkMatches = (label: string, matches: unknown[]): void => {
      for (const match of matches) {
        expect(isObj(match), `${label} match is an object`).toBe(true);
        const m = match as Obj;
        expect(m["property_cid"] ?? m["permit_cid"], `${label} cited CID`).toBeTruthy();
        expect(m["table_cid"], `${label} table_cid`).toBeTruthy();
        expect(m["captured_at"], `${label} captured_at`).toBeTruthy();
        expect(m["run_id"], `${label} run_id`).toBe(run.runId);
        expect(m["manifest_cid"], `${label} manifest_cid`).toBe(run.manifestCid);
      }
    };

    // 3. Prompt 1 (D-10).
    const first = await ask(GOLDEN.G1);
    const firstMatches = Array.isArray(first.data["matches"]) ? first.data["matches"] : [];
    test.info().annotations.push({
      type: "D-10",
      description: `${first.state}, outcome ${String(first.data["outcome"])}, ${String(firstMatches.length)} cited rows, ${String(first.ms)} ms`,
    });
    expect(first.status).toBe(200);
    expect(first.data["outcome"]).toBe("answered");
    expect(first.state).toBe("answered");
    expect(first.ms).toBeLessThan(AI_TEXTS.clientStopMs);
    expect(firstMatches.length, "D-10 cites rows").toBeGreaterThan(0);
    checkMatches("D-10", firstMatches);
    expect(String(first.data["how"] ?? "").trim(), "D-10 states how it read the question").not.toBe(
      "",
    );
    await expect(panel.locator("[data-answer]")).toBeVisible();
    await checkpoint(page, "TC-035", "d10-answered");

    // 4. Prompt 2 (D-11), same page: "that area" is carried over.
    await page.waitForTimeout(ASK_GAP_MS);
    const second = await ask(GOLDEN.G2);
    const secondMatches = Array.isArray(second.data["matches"]) ? second.data["matches"] : [];
    test.info().annotations.push({
      type: "D-11",
      description: `${second.state}, outcome ${String(second.data["outcome"])}, ${String(secondMatches.length)} cited rows, empty_outcome ${JSON.stringify(second.data["empty_outcome"] ?? null)}, ${String(second.ms)} ms`,
    });
    expect(second.status).toBe(200);
    expect(second.data["outcome"]).toBe("answered");
    expect(["answered", "no_results"]).toContain(second.state);
    expect(second.ms).toBeLessThan(AI_TEXTS.clientStopMs);
    if (secondMatches.length === 0) {
      // No permit in scope: the answer says why (structured empty outcome), nothing invented.
      expect(second.data["empty_outcome"], "D-11 empty answer names its reason").toBeTruthy();
    } else {
      checkMatches("D-11", secondMatches);
    }
    await expect(panel.locator("[data-answer]")).toBeVisible();
    await checkpoint(page, "TC-035", "d11-answered");
    await attachJson("A-16-TC-035-asks.json", [
      { prompt: GOLDEN.G1, status: first.status, ms: first.ms, state: first.state, ...first.data },
      {
        prompt: GOLDEN.G2,
        status: second.status,
        ms: second.ms,
        state: second.state,
        ...second.data,
      },
    ]);
  });

  test("A-16-TC-036 mcp search_properties full county", async ({ request }) => {
    const rawUrl = (process.env.MCP_URL ?? "").trim();
    const token = process.env.MCP_TOKEN ?? "";
    test.skip(
      rawUrl === "" || token === "",
      "MCP_URL and MCP_TOKEN must be set in the environment (the hosted MCP endpoint and its bearer token)",
    );
    const url = new URL(rawUrl);
    expect(isLoopbackHost(url.hostname), "MCP_URL is hosted, not localhost").toBe(false);
    const base = rawUrl.replace(/\/+$/, "");
    const endpoint = base.endsWith("/mcp") ? base : `${base}/mcp`;
    const run = await latest();
    const LIMIT = 50;
    const args = {
      area: { place: AREA.place.name },
      radius_mi: RADIUS,
      roof_age_years_min: 15,
      limit: LIMIT,
      manifest_cid: run.manifestCid,
    };

    // 1. tools/call with the bearer token from env: HTTP 200 inside the 15 s Lambda limit.
    const started = Date.now();
    const response = await request.post(endpoint, {
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${token}`,
      },
      data: {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "search_properties", arguments: args },
      },
      timeout: 30_000,
    });
    const ms = Date.now() - started;
    const text = await response.text();
    expect(text, "the token is never echoed").not.toContain(token);
    const json: unknown = JSON.parse(text);
    await attachJson("A-16-TC-036-search-properties.json", {
      request: { method: "tools/call", name: "search_properties", arguments: args },
      status: response.status(),
      ms,
      body: json,
    });
    expect(response.status()).toBe(200);
    expect(ms).toBeLessThan(15_000);
    const result = isObj(json) && isObj(json["result"]) ? json["result"] : null;
    expect(result?.["isError"], "tool result is not an error").not.toBe(true);
    const payload = isObj(result?.["structuredContent"]) ? result["structuredContent"] : null;
    const rows = Array.isArray(payload?.["rows"])
      ? (payload["rows"] as unknown[]).filter(isObj)
      : [];
    expect(rows.length, "rows on the full county").toBeGreaterThan(0);

    // 3. Full provenance on every row.
    for (const row of rows) {
      for (const field of ["run_id", "manifest_cid", "table_cid", "source_url", "captured_at"]) {
        expect(row, `row lacks ${field}`).toHaveProperty(field);
      }
      expect(row["manifest_cid"]).toBe(run.manifestCid);
      expect(row["run_id"]).toBe(run.runId);
    }

    // 2. Same property_cid set and total as Explore search (a) with the same limit and sort.
    const explore = await search(request, run.manifestCid, "a radius + roof", { limit: LIMIT });
    expect(explore.status).toBe(200);
    const exploreCids = (explore.result?.rows ?? []).map((r) => r.property_cid).sort();
    const mcpCids = rows.map((r) => String(r["property_cid"])).sort();
    expect(mcpCids).toEqual(exploreCids);
    expect(payload?.["total"]).toBe(explore.result?.total_within_r);
    test.info().annotations.push({
      type: "mcp",
      description: `${String(rows.length)} rows of ${String(payload?.["total"])} in ${String(ms)} ms`,
    });
  });

  test("A-16-TC-037 index records published CIDs only", async ({ request }) => {
    test.setTimeout(5 * 60_000);
    const run = await latest();
    const { manifest, via } = await fetchManifest(run.manifestCid);
    expect(manifest.runId).toBe(run.runId);
    const tables = new Map(
      manifest.artifacts.filter((a) => a.kind === "table").map((a) => [a.cid, a.name] as const),
    );
    expect(tables.size, "the manifest lists table artifacts").toBeGreaterThan(0);

    // Property rows (a) and permit rows (b): the two kinds of table an index row is built from.
    const cited = new Map<string, string>();
    for (const name of ["a radius + roof", "b open permits"] as const) {
      const got = await search(request, run.manifestCid, name, { limit: 200 });
      expect(got.status, name).toBe(200);
      const result = got.result;
      if (result === null) continue;
      expect(result.rows.length + result.close_matches.length, `${name} has rows`).toBeGreaterThan(
        0,
      );
      for (const cid of valuesOf(result, "manifest_cid")) expect(cid).toBe(run.manifestCid);
      for (const id of valuesOf(result, "run_id")) expect(id).toBe(run.runId);
      for (const row of [...result.rows, ...result.close_matches.map((c) => c.row)]) {
        // Nested table CIDs (the permit's own provenance) are checked for publication only; the
        // row's provenance.table names the table of provenance.table_cid.
        for (const cid of valuesOf(row, "table_cid")) if (!cited.has(cid)) cited.set(cid, "");
        const table = row.provenance["table"];
        if (row.provenance.table_cid !== null && typeof table === "string") {
          cited.set(row.provenance.table_cid, table);
        }
      }
    }
    expect(cited.size, "rows cite table CIDs").toBeGreaterThan(0);
    const notPublished = [...cited.keys()].filter((cid) => !tables.has(cid));
    expect(notPublished, "table CIDs not in the run's public manifest").toEqual([]);
    // The cited table's manifest path names the table the row says it came from.
    for (const [cid, table] of cited) {
      if (table !== "") expect(tables.get(cid), cid).toContain(`/${table}/`);
    }
    await attachJson("A-16-TC-037-cited-tables.json", {
      runId: run.runId,
      manifestCid: run.manifestCid,
      manifestVia: via,
      manifestTables: tables.size,
      cited: Object.fromEntries([...cited].map(([cid, t]) => [cid, tables.get(cid) ?? t])),
    });
    test.info().annotations.push({
      type: "limit",
      description:
        "index header (source CIDs, raw permit count) is private; checked: cited table CIDs ⊂ public manifest",
    });
  });
});
