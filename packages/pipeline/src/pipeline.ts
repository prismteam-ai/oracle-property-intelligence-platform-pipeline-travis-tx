import path from "node:path";
import type { OracleConfig } from "./core/config.js";
import { Db } from "./core/db.js";
import { log } from "./core/log.js";
import { compressRaw } from "./core/raw.js";
import {
  createRunContext,
  newRunId,
  type RunMode,
  type SourceAdapter,
  type SourceOutcome,
} from "./core/run.js";
import { migrate } from "./core/schema.js";
import { derive, type DeriveStats } from "./model/derive.js";
import { exportSnapshot, type ExportedTable } from "./model/export.js";
import { austinPermits } from "./sources/austin-permits.js";
import { censusBoundary } from "./sources/census-boundary.js";
import { censusPlaces } from "./sources/census-places.js";
import { bbbProfiles, tcadAppraisalRoll } from "./sources/egress-gated.js";
import { overturePlaces } from "./sources/overture-places.js";
import { stratmapParcels } from "./sources/stratmap-parcels.js";
import { txFranchise } from "./sources/tx-franchise.js";

export const ALL_SOURCES: SourceAdapter[] = [
  censusBoundary,
  censusPlaces,
  stratmapParcels,
  austinPermits,
  txFranchise,
  overturePlaces,
  tcadAppraisalRoll,
  bbbProfiles,
];

export type RunOptions = {
  mode: RunMode;
  sources?: string[];
  windowStart?: string;
  windowEnd?: string;
  asOf?: string;
  runId?: string;
};

export type RunSourceRecord = SourceOutcome & {
  sourceId: string;
  name: string;
  startedAt: string;
  finishedAt: string;
};

export type RunResult = {
  runId: string;
  status: "succeeded" | "partial" | "failed";
  exportDir: string;
  exported: ExportedTable[];
  derived: DeriveStats;
  sources: RunSourceRecord[];
};

export async function runPipeline(config: OracleConfig, opts: RunOptions): Promise<RunResult> {
  const runId = opts.runId ?? newRunId();
  const asOf = opts.asOf ?? new Date().toISOString().slice(0, 10);
  const db = await Db.open(config.dbPath);
  try {
    await migrate(db);
    const existing = await db.one(`SELECT run_id FROM runs WHERE run_id = ?`, [runId]);
    if (existing) throw new Error(`run ${runId} already exists; runs are immutable`);
    await db.all(`INSERT INTO runs VALUES (?, ?, 'running', now(), NULL, ?::DATE, ?::DATE, NULL)`, [
      runId,
      opts.mode,
      opts.windowStart ?? null,
      opts.windowEnd ?? null,
    ]);
    const ctx = createRunContext({
      runId,
      mode: opts.mode,
      windowStart: opts.windowStart,
      windowEnd: opts.windowEnd,
      config,
      db,
    });
    const selected = opts.sources?.length
      ? ALL_SOURCES.filter((s) => opts.sources?.includes(s.id))
      : ALL_SOURCES;
    const records: RunSourceRecord[] = [];
    let failed = 0;
    for (const source of selected) {
      const startedAt = new Date().toISOString();
      log.info("source_start", { runId, source: source.id });
      let outcome: SourceOutcome;
      const unmet = (source.dependsOn ?? []).filter((d) => {
        const r = records.find((x) => x.sourceId === d);
        return r ? r.status === "failed" || r.status === "skipped" : false;
      });
      try {
        if (unmet.length) {
          failed++;
          outcome = {
            status: "skipped",
            limitation: `Skipped because dependency failed: ${unmet.join(", ")}`,
          };
        } else outcome = await source.run(ctx);
        if (outcome.status === "ok" || outcome.status === "unchanged")
          await compressRaw(ctx, source.id);
      } catch (err) {
        failed++;
        log.error("source_failed", { runId, source: source.id, error: String(err) });
        outcome = { status: "failed", limitation: `Run failed: ${String(err).slice(0, 500)}` };
      }
      const finishedAt = new Date().toISOString();
      const c = outcome.counts;
      await db.all(
        `INSERT INTO run_sources VALUES (?, ?, ?, ?::TIMESTAMPTZ, ?::TIMESTAMPTZ, ?, ?, ?, ?, ?, ?, ?, ?::JSON)`,
        [
          runId,
          source.id,
          outcome.status,
          startedAt,
          finishedAt,
          c?.recordsSeen ?? 0,
          c?.inserted ?? 0,
          c?.updated ?? 0,
          c?.unchanged ?? 0,
          c?.deleted ?? 0,
          outcome.outOfScope ?? 0,
          outcome.limitation ?? null,
          JSON.stringify(outcome.detail ?? {}),
        ],
      );
      records.push({ ...outcome, sourceId: source.id, name: source.name, startedAt, finishedAt });
      log.info("source_done", { runId, source: source.id, status: outcome.status, counts: c });
    }

    try {
      const derived = await derive(db, { fips: config.fips, asOf });
      const status: RunResult["status"] =
        failed === 0 ? "succeeded" : failed === selected.length ? "failed" : "partial";
      await db.all(`UPDATE runs SET status = ?, finished_at = now() WHERE run_id = ?`, [
        status,
        runId,
      ]);

      const exportDir = path.join(config.dataDir, "exports", runId);
      const runSummary = await buildRunSummary(db, runId, config, derived, asOf);
      const coverage = await buildCoverage(db, config);
      const exported = await exportSnapshot(db, exportDir, { runSummary, coverage });
      log.info("run_done", { runId, status, exportDir });
      return { runId, status, exportDir, exported, derived, sources: records };
    } catch (err) {
      await db.all(
        `UPDATE runs SET status = 'failed', finished_at = now(), notes = ? WHERE run_id = ?`,
        [`derive/export failed: ${String(err).slice(0, 500)}`, runId],
      );
      throw err;
    }
  } finally {
    db.close();
  }
}

export async function buildRunSummary(
  db: Db,
  runId: string,
  config: OracleConfig,
  derived: DeriveStats,
  asOf: string,
) {
  const run = await db.one(`SELECT * FROM runs WHERE run_id = ?`, [runId]);
  const sources = await db.all(`SELECT * FROM run_sources WHERE run_id = ? ORDER BY started_at`, [
    runId,
  ]);
  const artifacts = await db.all(
    `SELECT source_id, url, bytes, sha256, http_status, fetched_at FROM raw_artifacts WHERE run_id = ? ORDER BY source_id, url`,
    [runId],
  );
  const history = await db.all(
    `SELECT run_id, mode, status, started_at, finished_at FROM runs ORDER BY started_at`,
  );
  return {
    county: config.county,
    state: config.state,
    fips: config.fips,
    asOf,
    roofAgeThresholdYears: config.roofAgeThresholdYears,
    run,
    sources,
    derived,
    rawArtifacts: artifacts,
    runHistory: history,
  };
}

export async function buildCoverage(db: Db, config: OracleConfig) {
  const counts = await db.one(`SELECT
    (SELECT count(*) FROM parcels WHERE NOT is_deleted) AS properties,
    (SELECT count(*) FROM parcels WHERE NOT is_deleted AND owner_name IS NOT NULL) AS properties_with_owner,
    (SELECT count(*) FROM parcels WHERE NOT is_deleted AND latitude IS NOT NULL) AS properties_with_coordinates,
    (SELECT count(*) FROM property_leads WHERE year_built IS NOT NULL) AS properties_with_year_built,
    (SELECT count(*) FROM property_leads WHERE last_deed_date IS NOT NULL) AS properties_with_deed_date,
    (SELECT count(*) FROM property_leads WHERE years_since_deed >= 10) AS properties_owned_10y_plus,
    (SELECT count(*) FROM property_roof WHERE roof_year IS NOT NULL) AS properties_with_roof_age,
    (SELECT count(*) FROM property_leads WHERE roof_age_years >= ${config.roofAgeThresholdYears}) AS properties_roof_age_at_least_threshold,
    (SELECT count(*) FROM permits WHERE NOT is_deleted) AS permits_ingested,
    (SELECT count(*) FROM permit_scope WHERE in_county) AS permits_in_county,
    (SELECT count(*) FROM roofing_permits) AS roofing_permits,
    (SELECT count(*) FROM roofing_permits WHERE is_open) AS open_roofing_permits,
    (SELECT count(*) FROM roofing_permits WHERE is_open AND open_days >= 365 * 5) AS open_roofing_permits_5y_plus,
    (SELECT count(*) FROM contractors) AS contractors,
    (SELECT count(*) FROM contractor_business_links) AS contractors_linked_business,
    (SELECT count(*) FROM contractor_bbb_links) AS contractors_with_bbb,
    (SELECT count(*) FROM businesses WHERE NOT is_deleted) AS businesses,
    (SELECT count(*) FROM places WHERE NOT is_deleted) AS places,
    (SELECT count(*) FROM bbb_profiles WHERE NOT is_deleted) AS bbb_profiles,
    (SELECT count(*) FROM property_leads WHERE owner_location_class = 'out_of_state') AS out_of_state_owners,
    (SELECT count(*) FROM property_leads WHERE owner_location_class = 'regional_texas') AS regional_texas_owners`);
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(counts ?? {})) out[k] = Number(v ?? 0);
  return out;
}
