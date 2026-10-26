// A-03 read-path spike: one-pass key-set capture of Austin issued permits (3syk-w9eu).
// Pattern copied from profiles/travis-austin@1.0.0/scripts/socrata.ts: one identified
// User-Agent, no app token, one request at a time, >= 1.1 s between request starts,
// <= 50,000 rows per page, a receipt per request, STOP on HTTP 403 / challenge (no retry),
// stop on any other non-2xx. Output is local only (gitignored), never published.
import { createHash } from "node:crypto";
import { writeFileSync, appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const DATASET = "https://data.austintexas.gov/resource/3syk-w9eu.json";
const UA =
  "countylens-spike/0.1 (PrismTeam CountyLens A-03 read-path spike; " +
  "+https://github.com/prismteam-ai/oracle-property-intelligence-platform-pipeline-travis-tx)";
const PAGE = 50_000;
const MIN_INTERVAL_MS = 1_100;
const OUT = process.argv[2];
if (!OUT) throw new Error("usage: capture.ts <outdir>");
mkdirSync(OUT, { recursive: true });
const receipts = join(OUT, "receipts.jsonl");

let last = 0;
async function get(params: Record<string, string>): Promise<Record<string, unknown>[]> {
  const wait = MIN_INTERVAL_MS - (Date.now() - last);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  last = Date.now();
  const u = new URL(DATASET);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  const captured_at = new Date().toISOString();
  const t0 = performance.now();
  const res = await fetch(u, {
    headers: { "user-agent": UA, accept: "application/json" },
    signal: AbortSignal.timeout(300_000),
    redirect: "error",
  });
  const body = await res.text();
  const ms = Math.round(performance.now() - t0);
  const blocked =
    res.status === 403 ||
    (res.headers.get("cf-mitigated") ?? "").toLowerCase() === "challenge" ||
    /^\s*</.test(body);
  const rec = {
    url: u.toString(), method: "GET", status: res.status, bytes: Buffer.byteLength(body),
    sha256: createHash("sha256").update(body).digest("hex"), captured_at, ms,
    user_agent: UA, app_token_used: false,
    outcome: blocked ? "blocked" : res.ok ? "ok" : "failed",
  };
  appendFileSync(receipts, JSON.stringify(rec) + "\n");
  if (blocked) { console.error(`STOP: blocked status=${res.status} ${u}`); process.exit(3); }
  if (!res.ok) { console.error(`STOP: HTTP ${res.status} ${u}`); process.exit(4); }
  return JSON.parse(body);
}

const started = new Date().toISOString();
const countRows = await get({ $select: "count(*) AS n" });
const expected = Number(countRows[0]?.n);
console.log(`count(*) = ${expected} at ${started}`);
let lastId: string | null = null;
let total = 0;
let page = 0;
for (;;) {
  const params: Record<string, string> = { $select: "*,:id", $order: ":id", $limit: String(PAGE) };
  if (lastId) params.$where = `:id > '${lastId}'`;
  const rows = await get(params);
  if (rows.length === 0) break;
  page += 1;
  writeFileSync(join(OUT, `page-${String(page).padStart(3, "0")}.json`), JSON.stringify(rows));
  total += rows.length;
  lastId = String(rows[rows.length - 1][":id"]);
  console.log(`${new Date().toISOString()} page ${page} rows ${rows.length} total ${total}`);
  if (rows.length < PAGE) break;
}
writeFileSync(join(OUT, "summary.json"), JSON.stringify({ started, finished: new Date().toISOString(), expected, total, pages: page }, null, 2));
console.log(`DONE total=${total} expected=${expected} pages=${page}`);
