// A-14 hosted MCP cases (testplans/A-14-test-cases.md § 8, tagged @mcp): Playwright `request`
// tests against the hosted Streamable HTTP endpoint (`POST {MCP_URL}/mcp`), one test per case,
// titled `@scenario:A-14-TC-{nnn}`. MCP_URL = the MCP stack output McpApiUrl
// (throws for a localhost value). The bearer token comes from process.env.MCP_TOKEN only: tests
// that need it skip with a clear message when it is unset; the no-token and wrong-token 401 cases
// and the Origin case run without it. The token is never written to a file, a title or a log:
// the evidence files under docs/evidence/mcp/ hold the JSON-RPC request, status, timing and body
// only, never headers.
//
// Pinned run: every data call passes manifest_cid = the small run (14 properties, 35 reroof
// permits) because full-county runs time out on the server.
//
// Workers: this file is meant for at most 2 workers (the config uses 1). The timing case (20
// sequential calls) and the 429 burst case sit last, each alone, in one serial describe.
// No model is called by this file.
//
// Run: MCP_URL=<McpApiUrl stack output> MCP_TOKEN=... \
//      RUNTIME_URL=https://014-agent-and-mcp.d2lx0utip89u18.amplifyapp.com \
//      pnpm --filter @countylens/e2e exec playwright test --project=a14-mcp --workers=1
import type { APIRequestContext } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  SMALL_RUN_MANIFEST_CID,
  mcpUrl,
  percentile,
  saveMcpEvidence,
  scenario14,
} from "./lib/a14.js";
import { fetchManifest, repoRoot } from "./lib/runtime.js";

const MCP = mcpUrl();
const ENDPOINT = `${MCP}/mcp`;
const TOKEN = (): string => process.env.MCP_TOKEN ?? "";
const NEEDS_TOKEN = "MCP_TOKEN is not set in the environment; this case needs the bearer token";
const SIX_TOOLS = [
  "search_properties",
  "list_permits",
  "get_property",
  "get_coverage",
  "list_runs",
  "get_schema",
] as const;
const PIN = { manifest_cid: SMALL_RUN_MANIFEST_CID } as const;
/** The demo area (docs/evidence/A-13-open-permits.md): Austin city, 5 mi. */
const AUSTIN = { place: "Austin" } as const;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

interface Reply {
  readonly status: number;
  readonly ms: number;
  readonly text: string;
  readonly json: unknown;
}

let nextId = 1;

/** One JSON-RPC call to the hosted endpoint. `token: null` sends no Authorization header. */
async function rpc(
  request: APIRequestContext,
  method: string,
  params: unknown,
  options: { token?: string | null; origin?: string } = {},
): Promise<Reply> {
  const token = options.token === undefined ? TOKEN() : options.token;
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
  };
  if (token !== null && token !== "") headers["authorization"] = `Bearer ${token}`;
  if (options.origin !== undefined) headers["origin"] = options.origin;
  const started = Date.now();
  const response = await request.post(ENDPOINT, {
    headers,
    data: { jsonrpc: "2.0", id: nextId++, method, ...(params === undefined ? {} : { params }) },
    timeout: 60_000,
  });
  const ms = Date.now() - started;
  const text = await response.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    // An event-stream or empty body: kept as text.
  }
  return { status: response.status(), ms, text, json };
}

const callTool = (
  request: APIRequestContext,
  name: string,
  args: unknown,
  options: { token?: string | null } = {},
): Promise<Reply> => rpc(request, "tools/call", { name, arguments: args }, options);

/** The tool result's structured payload (`result.structuredContent`), or null. */
function structured(reply: Reply): Obj | null {
  if (!isObj(reply.json) || !isObj(reply.json["result"])) return null;
  const content = reply.json["result"]["structuredContent"];
  return isObj(content) ? content : null;
}

const rowsOf = (payload: Obj | null): Obj[] =>
  Array.isArray(payload?.["rows"]) ? (payload["rows"] as unknown[]).filter(isObj) : [];

/** Saves the request, status, timing and body (no headers, so no token) for one case. */
function evidence(tc: string, label: string, method: string, params: unknown, reply: Reply): void {
  saveMcpEvidence(`A-14-TC-${tc}-${label}.json`, {
    request: { method, params },
    status: reply.status,
    ms: reply.ms,
    body: reply.json ?? reply.text,
  });
}

/** A tool call rejected before any query ran: a JSON-RPC error, an `isError` result or HTTP 4xx. */
function rejected(reply: Reply): boolean {
  if (reply.status >= 400 && reply.status < 500) return true;
  if (!isObj(reply.json)) return false;
  if (isObj(reply.json["error"])) return true;
  return isObj(reply.json["result"]) && reply.json["result"]["isError"] === true;
}

// ---------------------------------------------------------------------------------------
// Security cases that need no token
// ---------------------------------------------------------------------------------------

test(`${scenario14("022")} no bearer token returns 401, nothing runs`, async ({ request }) => {
  const reply = await callTool(request, "get_schema", {}, { token: null });
  evidence("022", "no-token", "tools/call", { name: "get_schema", arguments: {} }, reply);
  expect(reply.status).toBe(401);
  expect(reply.json).toEqual({ error: "unauthorized" });
  expect(structured(reply)).toBeNull();
  // The (possibly present) real token is never echoed back.
  if (TOKEN() !== "") expect(reply.text).not.toContain(TOKEN());
});

test(`${scenario14("023")} wrong bearer token returns 401, nothing runs`, async ({ request }) => {
  const reply = await callTool(
    request,
    "get_schema",
    {},
    { token: "wrong-token-value-not-from-env" },
  );
  evidence("023", "wrong-token", "tools/call", { name: "get_schema", arguments: {} }, reply);
  expect(reply.status).toBe(401);
  expect(reply.json).toEqual({ error: "unauthorized" });
  expect(structured(reply)).toBeNull();
  if (TOKEN() !== "") expect(reply.text).not.toContain(TOKEN());
});

test(`${scenario14("027")} disallowed browser Origin is rejected`, async ({ request }) => {
  // The Origin check runs before the token check: any request carrying an Origin header is
  // refused (403 origin_not_allowed), so no token is needed to prove it. The Help page's own
  // "Try a tool" through the server-side proxy is TC-027b in A-14.spec.ts.
  const reply = await rpc(request, "tools/list", undefined, {
    token: null,
    origin: "https://not-allowed.example.com",
  });
  evidence("027", "disallowed-origin", "tools/list", null, reply);
  expect(reply.status).toBe(403);
  expect(reply.json).toEqual({ error: "origin_not_allowed" });
  const withToken = TOKEN();
  if (withToken !== "") {
    const again = await rpc(request, "tools/list", undefined, {
      origin: "https://not-allowed.example.com",
    });
    expect(again.status).toBe(403);
    expect(again.text).not.toContain(withToken);
  }
});

// ---------------------------------------------------------------------------------------
// Data tools (token needed), pinned to the small run
// ---------------------------------------------------------------------------------------

test.describe("A-14 MCP data tools", () => {
  test.beforeEach(() => {
    test.skip(TOKEN() === "", NEEDS_TOKEN);
  });

  test(`${scenario14("014")} tools/list returns exactly six tools in under 500 ms`, async ({
    request,
  }) => {
    // One untimed warm-up call first, so a cold Lambda start is not counted as the latency.
    const warm = await rpc(request, "tools/list", undefined);
    expect(warm.status).toBe(200);
    const reply = await rpc(request, "tools/list", undefined);
    evidence("014", "tools-list", "tools/list", null, reply);
    expect(reply.status).toBe(200);
    expect(reply.ms).toBeLessThan(500);
    const tools =
      isObj(reply.json) &&
      isObj(reply.json["result"]) &&
      Array.isArray(reply.json["result"]["tools"])
        ? (reply.json["result"]["tools"] as unknown[]).filter(isObj)
        : [];
    expect(tools.map((t) => t["name"]).sort()).toEqual([...SIX_TOOLS].sort());
    const search = tools.find((t) => t["name"] === "search_properties");
    const schema = JSON.stringify(search?.["inputSchema"]);
    // AD-07 column names and a JSON Schema derived from the Zod input.
    expect(schema).toContain("roof_age_years_min");
    expect(schema).toContain("status_class");
    for (const tool of tools) {
      expect(isObj(tool["inputSchema"]) && tool["inputSchema"]["type"] === "object").toBe(true);
    }
    const permits = tools.find((t) => t["name"] === "list_permits");
    expect(JSON.stringify(permits?.["inputSchema"])).toContain("status_class");
    const get = tools.find((t) => t["name"] === "get_property");
    expect(JSON.stringify(get?.["inputSchema"])).toContain("property_cid");
  });

  test(`${scenario14("015")} agent, search_properties and Explore agree on property_cid (AC-8)`, async ({
    request,
  }) => {
    // Depends on the agent's G1 rows recorded by the live golden run (docs/evidence/A-14-golden-results.json:
    // the G1 response's matches[], each with its property_cid). Without that file there is nothing to compare to.
    const file = resolve(repoRoot, "docs", "evidence", "A-14-golden-results.json");
    test.skip(
      !existsSync(file),
      "depends-on: docs/evidence/A-14-golden-results.json (the agent's G1 rows) does not exist yet; run the golden queries first",
    );
    const golden = JSON.parse(readFileSync(file, "utf8")) as {
      cases?: Array<{ id: string; response?: { matches?: Array<{ property_cid?: string }> } }>;
    };
    const g1 = (golden.cases ?? (golden as unknown as Array<{ id: string }>)) as Array<{
      id: string;
      response?: { matches?: Array<{ property_cid?: string }> };
    }>;
    const g1case = g1.find((c) => c.id === "G1");
    test.skip(g1case === undefined, "depends-on: the golden results have no G1 case");
    const agentCids = new Set(
      (g1case?.response?.matches ?? [])
        .map((m) => String(m.property_cid))
        .filter((c) => c !== "undefined"),
    );
    const args = {
      area: { place: "Pflugerville" },
      radius_mi: 5,
      roof_age_years_min: 15,
      limit: 1000,
      ...PIN,
    };
    const reply = await callTool(request, "search_properties", args);
    evidence(
      "015",
      "search-properties-g1",
      "tools/call",
      { name: "search_properties", arguments: args },
      reply,
    );
    expect(reply.status).toBe(200);
    const rows = rowsOf(structured(reply));
    const mcpCids = new Set(rows.map((r) => String(r["property_cid"])));
    // Set equality, not overlap. The Explore leg (?place=pflugerville&r=5&roof=15) reads the same
    // query-core function; its rows are compared in the evidence file by hand.
    expect([...mcpCids].sort()).toEqual([...agentCids].sort());
    // On the small pinned run both sets are empty, so equality is true but vacuous: say so in the report.
    test.info().annotations.push({
      type: "vacuous",
      description: agentCids.size === 0 ? "both sets empty on the pinned small run" : "non-empty",
    });
    for (const row of rows) {
      for (const field of ["source_url", "captured_at", "table_cid", "run_id", "manifest_cid"]) {
        expect(row, `row lacks ${field}`).toHaveProperty(field);
      }
    }
  });

  test(`${scenario14("016")} list_permits open and stalled reroofs sorted by open duration`, async ({
    request,
  }) => {
    const args = {
      area: AUSTIN,
      radius_mi: 25,
      status_class: "open_or_stalled",
      limit: 1000,
      ...PIN,
    };
    const reply = await callTool(request, "list_permits", args);
    evidence(
      "016",
      "open-or-stalled",
      "tools/call",
      { name: "list_permits", arguments: args },
      reply,
    );
    expect(reply.status).toBe(200);
    const payload = structured(reply);
    expect(payload).not.toBeNull();
    const rows = rowsOf(payload);
    const days = rows.map((r) => r["open_days"]).filter((d): d is number => typeof d === "number");
    for (let i = 1; i < days.length; i += 1) {
      expect(days[i - 1] as number).toBeGreaterThanOrEqual(days[i] as number);
    }
    for (const row of rows) {
      for (const field of [
        "permit_number",
        "status_class",
        "table_cid",
        "run_id",
        "manifest_cid",
      ]) {
        expect(row, `row lacks ${field}`).toHaveProperty(field);
      }
    }
    const stalled = rows.filter((r) => r["status_class"] === "stalled");
    for (const row of stalled) {
      // status_raw is the source's own word when a carrier exists, else absent or null.
      if (row["status_raw"] !== null && row["status_raw"] !== undefined) {
        expect(row["status_raw"]).toBe("Expired");
      }
    }
    test.info().annotations.push({
      type: "stalled-rows",
      description: `${stalled.length} stalled of ${rows.length} rows on the pinned small run (0 expected there)`,
    });
  });

  test(`${scenario14("017")} stalled permit without a status_raw carrier shows stalled alone`, async ({
    request,
  }) => {
    const args = { status_class: "stalled", limit: 1000, ...PIN };
    const reply = await callTool(request, "list_permits", args);
    evidence("017", "stalled", "tools/call", { name: "list_permits", arguments: args }, reply);
    expect(reply.status).toBe(200);
    const bare = rowsOf(structured(reply)).filter(
      (r) =>
        r["status_class"] === "stalled" &&
        (r["status_raw"] === null || r["status_raw"] === undefined),
    );
    test.skip(
      bare.length === 0,
      "no stalled permit without a status_raw carrier on the pinned small run (the plan's precondition is not met)",
    );
    for (const row of bare) expect(row["status_raw"] ?? null).toBeNull();
  });

  test(`${scenario14("018")} get_coverage equals the manifest coverage section`, async ({
    request,
  }) => {
    const args = { ...PIN };
    const reply = await callTool(request, "get_coverage", args);
    evidence("018", "get-coverage", "tools/call", { name: "get_coverage", arguments: args }, reply);
    expect(reply.status).toBe(200);
    const payload = structured(reply);
    expect(payload).not.toBeNull();
    const manifest = await fetchManifest(SMALL_RUN_MANIFEST_CID);
    const published = (manifest.manifest as unknown as Obj)["coverage"];
    test.skip(published === undefined, "the manifest has no coverage section");
    expect(payload?.["coverage"]).toEqual(published);
  });

  test(`${scenario14("019")} row cap: at most 1000 rows, truncated and total are honest`, async ({
    request,
  }) => {
    const args = { status_class: "stalled", limit: 1000, ...PIN };
    const reply = await callTool(request, "list_permits", args);
    evidence("019", "cap", "tools/call", { name: "list_permits", arguments: args }, reply);
    expect(reply.status).toBe(200);
    const payload = structured(reply);
    const rows = rowsOf(payload);
    expect(rows.length).toBeLessThanOrEqual(1000);
    const total = payload?.["total"];
    expect(typeof total).toBe("number");
    expect(payload?.["truncated"]).toBe((total as number) > rows.length);
    if ((total as number) <= 1000) {
      // The small run has fewer than 1000 stalled permits: only the invariant is checked here.
      // The 2,213-row county-wide case needs the full run (GAP-A11), which times out the server.
      test.info().annotations.push({
        type: "not-reproducible",
        description: `total=${String(total)} on the pinned small run; truncated:true needs more than 1000 rows`,
      });
    }
  });

  test(`${scenario14("024")} unknown permit number returns not_found, no fabricated row`, async ({
    request,
  }) => {
    const args = { permit_number: "0000-000000 XX", ...PIN };
    const reply = await callTool(request, "list_permits", args);
    evidence(
      "024",
      "unknown-permit",
      "tools/call",
      { name: "list_permits", arguments: args },
      reply,
    );
    expect(reply.status).toBe(200);
    const payload = structured(reply);
    expect(rowsOf(payload)).toHaveLength(0);
    expect(payload?.["empty_reason"]).toBe("not_found");
  });

  test(`${scenario14("025")} non-Travis ZIP 99999 returns out_of_scope`, async ({ request }) => {
    const args = { area: { place: "99999" }, radius_mi: 5, ...PIN };
    const reply = await callTool(request, "search_properties", args);
    evidence(
      "025",
      "zip-99999",
      "tools/call",
      { name: "search_properties", arguments: args },
      reply,
    );
    expect(reply.status).toBe(200);
    const payload = structured(reply);
    expect(rowsOf(payload)).toHaveLength(0);
    expect(payload?.["empty_reason"]).toBe("out_of_scope");
  });

  test(`${scenario14("026")} free-form SQL argument is rejected and no SQL tool exists`, async ({
    request,
  }) => {
    const args = {
      area: { place: "Pflugerville; DROP TABLE property; --" },
      radius_mi: 5,
      sql: "SELECT * FROM property",
      ...PIN,
    };
    const reply = await callTool(request, "search_properties", args);
    evidence(
      "026",
      "sql-argument",
      "tools/call",
      { name: "search_properties", arguments: args },
      reply,
    );
    // Zod (.strict()) refuses the unknown `sql` key before any query: a typed error, never rows.
    expect(rejected(reply)).toBe(true);
    expect(rowsOf(structured(reply))).toHaveLength(0);
    const list = await rpc(request, "tools/list", undefined);
    const names =
      isObj(list.json) && isObj(list.json["result"]) && Array.isArray(list.json["result"]["tools"])
        ? (list.json["result"]["tools"] as unknown[]).filter(isObj).map((t) => String(t["name"]))
        : [];
    expect(names).toHaveLength(6);
    expect(names.filter((n) => /^(query|sql|execute|run_sql)/i.test(n))).toEqual([]);
  });
});

test(`${scenario14("029")} donphan answers a Lakeway ownership question through MCP only`, async () => {
  test.skip(
    true,
    "kit-agent case, not a Playwright case: donphan is configured with the hosted MCP URL and token only, and its transcript is saved to docs/evidence/A-14-mcp.md",
  );
});

// ---------------------------------------------------------------------------------------
// Timing and rate limit: last, each alone (serial), sequential so the first cannot trip the
// route throttle (5 rps, burst 10) that the second tests on purpose.
// ---------------------------------------------------------------------------------------

test.describe("A-14 MCP timing and rate limit (run alone, last)", () => {
  test.describe.configure({ mode: "serial" });
  test.beforeEach(() => {
    test.skip(TOKEN() === "", NEEDS_TOKEN);
  });

  test(`${scenario14("NF-02")} tools/call p95 under 3 s over 20 calls`, async ({ request }) => {
    // One call every 300 ms (about 3 rps, under the 5 rps limit), alternating a lightweight tool
    // with a data tool on the pinned small run.
    const timings: { tool: string; status: number; ms: number }[] = [];
    for (let i = 0; i < 20; i += 1) {
      const search = i % 2 === 1;
      const reply = search
        ? await callTool(request, "search_properties", {
            area: AUSTIN,
            radius_mi: 5,
            limit: 5,
            ...PIN,
          })
        : await callTool(request, "get_schema", {});
      timings.push({
        tool: search ? "search_properties" : "get_schema",
        status: reply.status,
        ms: reply.ms,
      });
      await new Promise((resolveWait) => setTimeout(resolveWait, 300));
    }
    const ms = timings.map((t) => t.ms);
    const p95 = percentile(ms, 95);
    saveMcpEvidence("A-14-TC-NF-02-timings.json", {
      calls: timings,
      p50_ms: percentile(ms, 50),
      p95_ms: p95,
      max_ms: Math.max(...ms),
    });
    for (const t of timings) expect(t.status).toBe(200);
    expect(p95).toBeLessThan(3_000);
  });

  test(`${scenario14("021")} burst above the limit answers 429, then recovers`, async ({
    request,
  }) => {
    // 40 concurrent get_schema calls: the route allows 5 rps with a burst of 10, so the excess is
    // rejected at the gateway with 429 before it reaches the Lambda; a call after 2 s succeeds.
    // (A burst of only 15 spread over ~1.5 s fits inside the bucket and hits the account's Lambda
    // concurrency cap instead, which API Gateway reports as 503: that is recorded, not accepted.)
    await new Promise((resolveWait) => setTimeout(resolveWait, 3_000));
    const replies = await Promise.all(
      Array.from({ length: 40 }, () => callTool(request, "get_schema", {})),
    );
    const statuses = replies.map((r) => r.status);
    saveMcpEvidence("A-14-TC-021-burst.json", { statuses, ms: replies.map((r) => r.ms) });
    for (const status of statuses) expect([200, 429]).toContain(status);
    expect(statuses.filter((s) => s === 429).length).toBeGreaterThanOrEqual(5);
    expect(statuses.filter((s) => s === 200).length).toBeGreaterThan(0);
    await new Promise((resolveWait) => setTimeout(resolveWait, 2_000));
    const after = await callTool(request, "get_schema", {});
    expect(after.status).toBe(200);
  });
});
