// A-11 Run 3: reads the result of one incremental Austin permits job from the Query DB
// (read-only SELECTs, nothing is written) and writes the facts the run manifest needs, plus the
// list of pIDs whose Property Improvement folders must be rebuilt.
//
// Two phases around the link step (`backbone permits --link`), because the link re-runs over
// every permit and would otherwise hide where a changed permit used to be linked:
//
//   pre-link  after the incremental merge, BEFORE --link: writes <out>/pre-link-pids.json, the
//             pIDs (request_identifier) the job's added, changed and tombstoned permits are
//             linked to right now (a changed permit that moves to another parcel must rebuild
//             the old parcel's folder too).
//   final     after --link: writes <out>/austin-facts.json, <out>/austin-receipt.json and
//             <out>/affected-pids.txt (the union of the pre-link and the post-link pIDs).
//
// Usage (from pipeline/local-stack; DATABASE_URL in .env or the environment, never printed):
//   npx tsx scripts/incremental-facts.ts pre-link --job <jobId> --out <dir>
//   npx tsx scripts/incremental-facts.ts final --job <jobId> --out <dir> \
//        --base-manifest <runs/<run>/manifest.json>
//
// Counts, by content digest (never by :updated_at):
//   added      permits first stored by this job            (previous_content_sha256 IS NULL)
//   changed    permits whose stored digest this job moved   (previous_content_sha256 set)
//   removed    source_removed tombstones this job wrote
//   unchanged  rows the job read minus added minus changed
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type postgres from "postgres";
import {
  parseAustinFacts,
  type AustinIncrementalFacts,
} from "../../publish/src/incremental/austin-facts.js";

const SOURCE = "austin-3syk-w9eu";
const JOB_RE = /^travis-a04-[a-z0-9-]+$/;

interface WatermarkValue {
  maxUpdatedAt: string | null;
  endTotal: number | null;
  rows: number;
  mode: string;
  jobId: string;
  finishedAt: string;
  watermarkCheck: string;
  restamp: { detected: boolean } | null;
}

export interface JobCounts {
  added: number;
  changed: number;
  removed: number;
}

/** pIDs are Travis County request identifiers: digits, no leading zero. */
const isPid = (s: unknown): s is string => typeof s === "string" && /^[1-9][0-9]*$/.test(s);

export async function readWatermark(sql: postgres.Sql): Promise<WatermarkValue> {
  const rows = await sql<{ value: WatermarkValue }[]>`
    SELECT value FROM watermarks WHERE track = 'permits' AND source_key = ${SOURCE}`;
  const v = rows[0]?.value;
  if (v === undefined) throw new Error("no Austin permits watermark in the Query DB");
  return v;
}

export async function jobCounts(sql: postgres.Sql, job: string): Promise<JobCounts> {
  const [pi] = await sql<{ added: string; changed: string }[]>`
    SELECT count(*) FILTER (WHERE previous_content_sha256 IS NULL) AS added,
           count(*) FILTER (WHERE previous_content_sha256 IS NOT NULL) AS changed
    FROM property_improvements
    WHERE issuing_jurisdiction = 'austin' AND updated_in_job = ${job}`;
  const [tomb] = await sql<{ n: string }[]>`
    SELECT count(*) AS n FROM source_tombstones WHERE source_key = ${SOURCE} AND job_id = ${job}`;
  return {
    added: Number(pi?.added ?? 0),
    changed: Number(pi?.changed ?? 0),
    removed: Number(tomb?.n ?? 0),
  };
}

/** pIDs the job's added, changed and tombstoned permits are linked to at this moment. */
export async function jobPids(sql: postgres.Sql, job: string): Promise<string[]> {
  const rows = await sql<{ request_identifier: string }[]>`
    SELECT DISTINCT request_identifier FROM property_improvements
    WHERE issuing_jurisdiction = 'austin' AND request_identifier IS NOT NULL
      AND (updated_in_job = ${job}
           OR permit_number IN (SELECT permit_number FROM source_tombstones
                                WHERE source_key = ${SOURCE} AND job_id = ${job}))`;
  return rows.map((r) => r.request_identifier).filter(isPid);
}

export async function permitLinkTotals(sql: postgres.Sql) {
  const [r] = await sql<
    {
      linked: string;
      no_tcad_geoid: string;
      no_tcad_id: string;
      ambiguous_geoid: string;
      address_unmatched: string;
      ambiguous_address: string;
      unclassified: string;
    }[]
  >`
    SELECT count(*) FILTER (WHERE request_identifier IS NOT NULL) AS linked,
           count(*) FILTER (WHERE unmatched_reason = 'no_tcad_geoid') AS no_tcad_geoid,
           count(*) FILTER (WHERE unmatched_reason = 'no_tcad_id') AS no_tcad_id,
           count(*) FILTER (WHERE unmatched_reason = 'ambiguous_geoid') AS ambiguous_geoid,
           count(*) FILTER (WHERE unmatched_reason = 'address_unmatched') AS address_unmatched,
           count(*) FILTER (WHERE unmatched_reason = 'ambiguous_address') AS ambiguous_address,
           count(*) FILTER (WHERE request_identifier IS NULL AND unmatched_reason IS NULL) AS unclassified
    FROM property_improvements
    WHERE issuing_jurisdiction = 'austin' AND NOT tombstoned`;
  if (r === undefined) throw new Error("no permit rows");
  if (Number(r.unclassified) > 0)
    throw new Error(
      `${r.unclassified} live permits have neither a link nor an unmatched reason: run "backbone permits --link" first`,
    );
  return {
    linkedPermits: Number(r.linked),
    permits_no_tcad_geoid: Number(r.no_tcad_geoid),
    permits_no_tcad_id: Number(r.no_tcad_id),
    permits_ambiguous_geoid: Number(r.ambiguous_geoid),
    permits_address_unmatched: Number(r.address_unmatched),
    permits_ambiguous_address: Number(r.ambiguous_address),
  };
}

export function buildFacts(args: {
  job: string;
  base: { watermark: string | null; records: number };
  wm: WatermarkValue;
  counts: JobCounts;
  permitLink: AustinIncrementalFacts["permitLink"];
}): AustinIncrementalFacts {
  const { job, base, wm, counts } = args;
  if (wm.jobId !== job)
    throw new Error(`the Austin watermark was last written by ${wm.jobId}, not by ${job}`);
  if (wm.maxUpdatedAt === null || wm.endTotal === null)
    throw new Error("the watermark carries no maxUpdatedAt or endTotal");
  if (wm.mode === "pilot") throw new Error("a pilot job never advances the watermark");
  if (wm.watermarkCheck === "fail") throw new Error("the watermark count check failed");
  if (base.watermark === null) throw new Error("the base manifest has no Austin watermark");
  const fullPass = wm.restamp?.detected === true;
  return parseAustinFacts({
    schema: "oracle-travis-austin-incremental-facts.v1",
    jobId: job,
    watermarkUsed: base.watermark,
    watermarkNew: wm.maxUpdatedAt,
    recordsRead: wm.rows,
    totalAfter: wm.endTotal,
    totalBefore: base.records,
    capturedAt: wm.finishedAt,
    mode: fullPass ? "full_pass" : "window",
    restampDetected: fullPass,
    delta: { added: counts.added, changed: counts.changed, removed: counts.removed },
    unchanged: Math.max(0, wm.rows - counts.added - counts.changed),
    removalDetection: fullPass ? "keyset_diff" : "not_checked",
    permitLink: args.permitLink,
  });
}

function arg(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i < 0 ? undefined : argv[i + 1];
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const phase = argv[0];
  const job = arg(argv, "job");
  const out = arg(argv, "out");
  if ((phase !== "pre-link" && phase !== "final") || job === undefined || out === undefined)
    throw new Error("usage: incremental-facts.ts pre-link|final --job <jobId> --out <dir> [--base-manifest <file>]");
  if (!JOB_RE.test(job)) throw new Error(`bad job id ${job}`);
  const here = dirname(fileURLToPath(import.meta.url));
  const { config } = await import("dotenv");
  config({ path: join(here, "../.env"), quiet: true });
  const url = process.env["DATABASE_URL"];
  if (url === undefined || url.trim() === "") throw new Error("DATABASE_URL is not set");
  const { default: pg } = await import("postgres");
  const sql = pg(url, { max: 2, onnotice: () => {} });
  try {
    mkdirSync(out, { recursive: true });
    if (phase === "pre-link") {
      const pids = await jobPids(sql, job);
      writeFileSync(join(out, "pre-link-pids.json"), `${JSON.stringify({ job, pids }, null, 2)}\n`);
      console.log(`[facts] pre-link: ${pids.length} pIDs touched by ${job}`);
      return;
    }
    const baseFile = arg(argv, "base-manifest");
    if (baseFile === undefined) throw new Error("final needs --base-manifest");
    const baseManifest = JSON.parse(readFileSync(resolve(baseFile), "utf8")) as {
      sources: { name: string; watermark: string | null; records: number }[];
    };
    const base = baseManifest.sources.find((s) => s.name === SOURCE);
    if (base === undefined) throw new Error(`the base manifest has no ${SOURCE} source`);
    const pre = JSON.parse(readFileSync(join(out, "pre-link-pids.json"), "utf8")) as {
      job: string;
      pids: string[];
    };
    if (pre.job !== job) throw new Error("pre-link-pids.json belongs to another job");
    const [wm, counts, permitLink, post] = await Promise.all([
      readWatermark(sql),
      jobCounts(sql, job),
      permitLinkTotals(sql),
      jobPids(sql, job),
    ]);
    const facts = buildFacts({ job, base, wm, counts, permitLink });
    writeFileSync(join(out, "austin-facts.json"), `${JSON.stringify(facts, null, 2)}\n`);
    writeFileSync(
      join(out, "austin-receipt.json"),
      `${JSON.stringify({ captured_at: facts.capturedAt, records: facts.totalAfter }, null, 2)}\n`,
    );
    const pids = [...new Set([...pre.pids, ...post])].sort(
      (a, b) => a.length - b.length || a.localeCompare(b),
    );
    writeFileSync(join(out, "affected-pids.txt"), pids.length === 0 ? "" : `${pids.join("\n")}\n`);
    console.log(
      `[facts] ${job}: read ${facts.recordsRead}, added ${facts.delta.added}, changed ${facts.delta.changed}, removed ${facts.delta.removed}, unchanged ${facts.unchanged}; watermark ${facts.watermarkUsed} -> ${facts.watermarkNew}; ${pids.length} affected pIDs (pre-link ${pre.pids.length}, post-link ${post.length})`,
    );
  } finally {
    await sql.end();
  }
}

if (process.argv[1] !== undefined && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch((e: unknown) => {
    console.error(`[facts] FAILED: ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
  });
}
