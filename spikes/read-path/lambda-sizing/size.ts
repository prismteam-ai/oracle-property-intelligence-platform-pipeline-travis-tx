// Lambda-fallback sizing (AC-4): @duckdb/node-api over the same signed CloudFront Parquet URLs.
// Runs N iterations of the three spike queries, each in a fresh in-memory DuckDB; records wall time
// and peak RSS. Usage: tsx size.ts <variant> <runs> <threads> <key1,key2,...>
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { DuckDBInstance } from "@duckdb/node-api";
import { getSignedUrl } from "@aws-sdk/cloudfront-signer";
const [variant, runsArg, threads, keysArg] = process.argv.slice(2);
const dom = process.env.CF_DOMAIN!;
const policy = JSON.stringify({ Statement: [{ Resource: `https://${dom}/cid/*`, Condition: { DateLessThan: { "AWS:EpochTime": Math.floor(Date.now() / 1000) + 6 * 3600 } } }] });
const s = getSignedUrl({ url: `https://${dom}/cid/*`, keyPairId: process.env.CF_KEY_PAIR_ID!, privateKey: readFileSync(process.env.CF_KEY_FILE!, "utf8"), policy });
const urls = keysArg.split(",").map((k) => (k.startsWith("/") ? k : `https://${dom}/${k}${s.slice(s.indexOf("?"))}`));
const LAT = 30.447765, LON = -97.602116, R_M = 8046.72, DLAT = R_M / 111_320, DLON = DLAT / Math.cos((LAT * Math.PI) / 180);
const HAV = `2*6371008.8*asin(sqrt(pow(sin(radians(latitude-${LAT})/2),2)+cos(radians(${LAT}))*cos(radians(latitude))*pow(sin(radians(longitude-(${LON}))/2),2)))`;
const BBOX = `latitude BETWEEN ${LAT - DLAT} AND ${LAT + DLAT} AND longitude BETWEEN ${LON - DLON} AND ${LON + DLON}`;
const Q: Record<string, string> = {
  count: `SELECT count(*) AS n FROM t`,
  radius: `SELECT permit_number, permit_type_desc, issue_date, original_address1, latitude, longitude, ${HAV} AS d_m FROM t WHERE ${BBOX} AND ${HAV} < ${R_M} ORDER BY d_m LIMIT 500`,
  roofage: `SELECT count(*) AS n FROM t WHERE ${BBOX} AND ${HAV} < ${R_M} AND date_diff('year', TRY_CAST(substr(issue_date,1,10) AS DATE), DATE '2026-10-21') >= 15`,
};
let peak = 0; const tick = setInterval(() => { peak = Math.max(peak, process.memoryUsage().rss); }, 20);
const rows: Record<string, number>[] = [];
for (let i = 0; i < Number(runsArg); i++) {
  const t0 = performance.now();
  const db = await DuckDBInstance.create(":memory:", { threads, memory_limit: "1GB" });
  const c = await db.connect();
  await c.run(`SET enable_http_metadata_cache=false; SET enable_external_file_cache=false`);
  await c.run(`CREATE VIEW t AS SELECT * FROM read_parquet([${urls.map((u) => `'${u}'`).join(",")}])`);
  const r: Record<string, number> = { coldInitMs: performance.now() - t0 };
  for (const k of Object.keys(Q)) { const q0 = performance.now(); const res = await c.runAndReadAll(Q[k]); r[k] = performance.now() - q0; r[k + "Rows"] = res.currentRowCount; }
  rows.push(r); c.closeSync(); db.closeSync();
  console.log(variant, i, Object.entries(r).map(([k, v]) => `${k}=${Math.round(v)}`).join(" "));
}
clearInterval(tick);
const pct = (a: number[], p: number) => { const x = [...a].sort((m, n) => m - n); return x[Math.ceil(p * x.length) - 1]; };
const summary = { variant, threads, runs: rows.length, peakRssMB: Math.round(peak / 2 ** 20), at: new Date().toISOString(),
  ...Object.fromEntries(["coldInitMs", ...Object.keys(Q)].map((k) => [k, { p50: pct(rows.map((r) => r[k]), 0.5), p95: pct(rows.map((r) => r[k]), 0.95) }])) };
mkdirSync("results", { recursive: true }); writeFileSync(`results/${variant}-t${threads}.json`, JSON.stringify({ summary, rows }, null, 2));
console.log(JSON.stringify(summary));
