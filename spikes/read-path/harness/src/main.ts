// Measurement page. Signed CloudFront URLs arrive in location.hash (never sent to the server).
// Times: firstLoadMs = navigation start -> DuckDB-WASM ready + schema read (DESCRIBE) of all parts.
import * as duckdb from "@duckdb/duckdb-wasm";
import mvpWasm from "@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url";
import mvpWorker from "@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url";
import ehWasm from "@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url";
import ehWorker from "@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url";

// Pflugerville city, Census 2024 gazetteer via packages/query-core/gazetteer/travis-places@1.0.0
const LAT = 30.447765, LON = -97.602116, R_M = 8046.72; // 5 statute miles
const DLAT = R_M / 111_320, DLON = DLAT / Math.cos((LAT * Math.PI) / 180);
const HAV = `2*6371008.8*asin(sqrt(pow(sin(radians(latitude-${LAT})/2),2)+cos(radians(${LAT}))*cos(radians(latitude))*pow(sin(radians(longitude-(${LON}))/2),2)))`;
const BBOX = `latitude BETWEEN ${LAT - DLAT} AND ${LAT + DLAT} AND longitude BETWEEN ${LON - DLON} AND ${LON + DLON}`;
export const QUERIES: Record<string, string> = {
  count: `SELECT count(*) AS n FROM t`,
  radius: `SELECT permit_number, permit_type_desc, issue_date, original_address1, latitude, longitude, ${HAV} AS d_m
           FROM t WHERE ${BBOX} AND ${HAV} < ${R_M} ORDER BY d_m LIMIT 500`,
  // Performance stand-in for roof_age_years over structure.roof_date: one date column + the radius.
  roofage: `SELECT count(*) AS n FROM t WHERE ${BBOX} AND ${HAV} < ${R_M}
            AND date_diff('year', TRY_CAST(substr(issue_date,1,10) AS DATE), DATE '2026-10-21') >= 15`,
};

type Result = Record<string, unknown>;
const out = document.getElementById("out")!;
const w = window as unknown as { __result?: Result; __error?: string; __run?: (k: string) => Promise<Result> };

async function main(): Promise<void> {
  const urls: string[] = JSON.parse(decodeURIComponent(location.hash.slice(1)));
  const bundle = await duckdb.selectBundle({
    mvp: { mainModule: mvpWasm, mainWorker: mvpWorker },
    eh: { mainModule: ehWasm, mainWorker: ehWorker },
  });
  const worker = new Worker(bundle.mainWorker!);
  const db = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), worker);
  await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
  // CloudFront answers HEAD+Range with 200 (not 206); without this DuckDB-WASM falls back to a full download.
  // With it, the size probe is GET Range: bytes=0-0 (206) + HEAD, and reads stay range reads.
  const fsParam = new URLSearchParams(location.search).get("fs");
  await db.open({ filesystem: fsParam ? JSON.parse(fsParam) : { allowFullHTTPReads: true, forceFullHTTPReads: false, reliableHeadRequests: false } });
  const tInst = performance.now();
  const conn = await db.connect();
  const pre = new URLSearchParams(location.search).get("pre");
  if (pre) await conn.query(pre);
  (w as any).__sql = async (s: string) => JSON.stringify((await conn.query(s)).toArray().map((r: any) => r.toJSON()), (_, v) => (typeof v === "bigint" ? Number(v) : v));
  const list = urls.map((u) => `'${u.replaceAll("'", "''")}'`).join(",");
  await conn.query(`CREATE VIEW t AS SELECT * FROM read_parquet([${list}])`);
  const schema = await conn.query(`DESCRIBE t`);
  const firstLoadMs = performance.now();
  const res: Result = { firstLoadMs, instantiateMs: tInst, columns: schema.numRows, bundle: bundle.mainModule.split("/").pop() };
  w.__run = async (k: string) => {
    const t0 = performance.now();
    const r = await conn.query(QUERIES[k]);
    const ms = performance.now() - t0;
    const first = r.numRows ? r.get(0)?.toJSON() : null;
    return { k, ms, rows: r.numRows, first: JSON.parse(JSON.stringify(first, (_, v) => (typeof v === "bigint" ? Number(v) : v))) };
  };
  w.__result = res;
  out.textContent = JSON.stringify(res);
}
main().catch((e: unknown) => { w.__error = String(e); out.textContent = "ERROR " + String(e); });
