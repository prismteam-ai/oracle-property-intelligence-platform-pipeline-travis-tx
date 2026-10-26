// T064 (A-02, FR-008): cut contract/v1/sample.parquet from the bound pilot views and write
// contract/v1/columns.json and README.md. Reads only the pilot export-tables output and the
// committed pilot manifest (never the Query DB, never raw captures).
// Usage: PILOT_DIR=pipeline/data/pilot/travis-pilot-20261020 pnpm --filter @countylens/query-core cut-sample
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { bindManifest } from "../src/bind-manifest.js";
import { sampleSql } from "../src/sample.js";
import { renderColumnsJson, renderReadme } from "./contract-docs.js";
import { openDuckDb } from "./duckdb-engine.js";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const PILOT = resolve(ROOT, process.env.PILOT_DIR ?? "pipeline/data/pilot/travis-pilot-20261020");
const OUT = join(ROOT, "contract/v1");

const db = await openDuckDb();
try {
  const bound = await bindManifest(
    readFileSync(join(OUT, "pilot-manifest.json")),
    join(PILOT, "tables"),
    db,
  );
  const sample = join(OUT, "sample.parquet");
  await db.run(`COPY (${sampleSql()}) TO '${sample}' (FORMAT parquet)`);

  const [summary] = await db.all(`SELECT
      count(*)::INTEGER AS rows,
      count(*) FILTER (WHERE status_class = 'stalled')::INTEGER AS stalled,
      count(*) FILTER (WHERE roof_age_years IS NOT NULL)::INTEGER AS with_roof_age,
      count(*) FILTER (WHERE source_url IS NULL OR captured_at IS NULL OR "table" IS NULL
        OR table_cid IS NULL OR run_id IS NULL OR manifest_cid IS NULL)::INTEGER AS null_prov
    FROM '${sample}'`);
  const [run] = await db.all("SELECT tables_root_cids FROM v_run");

  writeFileSync(join(OUT, "columns.json"), renderColumnsJson());
  writeFileSync(
    join(OUT, "README.md"),
    renderReadme({
      rows: Number(summary?.rows),
      stalled: Number(summary?.stalled),
      withRoofAge: Number(summary?.with_roof_age),
      nullProvenance: Number(summary?.null_prov),
      runId: bound.runId,
      manifestCid: bound.manifestCid,
      asOf: bound.asOf,
      tablesRoots: run?.tables_root_cids as { data_group: string; cid: string }[],
    }),
  );
  console.log(JSON.stringify({ sample, ...summary, manifest_cid: bound.manifestCid }));
} finally {
  db.close();
}
