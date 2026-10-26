// A-04 T045: the `coordinates` (and `gis`) report sections (contracts/report.md). Read-only:
// counts, digests, URLs and timestamps only. `--job` is the TCAD job; the parcels of that job
// give coverage and the gap by reason (the Query DB SQL is QDB_COVERAGE_SQL for the job); the
// latest assembly and GIS import come from the Loader `gis` watermarks (`coords_assembly`,
// `tcad_gis`), and their job ids are listed in `source_jobs`.
//
// report.ts loads one `section` export per file, so `section` is `coordinates`; the GIS run
// summary is also carried inside it as `coordinates.gis` and exported as `gisSection` /
// `sections` for a loader that reads several sections from one file.
import type postgres from "postgres";
import { gapPercent } from "../../../oracle-runtime/travis/discovery/probes/arcgis.js";
import { throughputRow, type ThroughputRow } from "../../../oracle-runtime/travis/backbone/source-limits.js";
import { QDB_COVERAGE_SQL } from "../../../oracle-runtime/travis/gis/coverage-report.js";
import { GIS_SOURCE_KEY, gisBlockedLimitation } from "../../../oracle-runtime/travis/gis/import.js";
import type { ReportSection } from "../report.js";

/** D-4 anchors: 0223120506 → pID 221829 (positive); 0208011301 is not on the roll (negative). */
export const ANCHOR_GEO_IDS = ["0223120506", "0208011301"] as const;

export interface Anchor {
  geo_id: string;
  request_identifier: string | null;
  on_roll: boolean;
  coordinate_source: string | null;
}

export interface GisRunReads {
  job_id: string;
  artifact_run_id: string;
  status: "complete" | "blocked";
  pages: number;
  source_count: number | null;
  duration_s: number | null;
  features_per_s: number | null;
  started_at: string | null;
  finished_at: string | null;
  concurrency: number | null;
  layer_last_edit_date: string | null;
  blocked_at: string | null;
}

export interface CoordinateReads {
  coverage: {
    denominator_r: number;
    with_point_r: number;
    coverage_r: number;
    non_land_account: number;
    roll_count: number;
  };
  bySource: Record<string, number>;
  byRule: Record<string, number>;
  gapByReason: Record<string, number>;
  anchors: Anchor[];
  assembly: null | {
    job_id: string;
    stats: {
      multi_feature: { pids: number; extra_features: number; rule: string };
      condo_building_point: { accounts: number; buildings: number; rule: string };
      /** Rank 4 outcomes (ADR 0004); absent in watermarks written before Run 3. */
      address_point?: Record<string, number | string>;
      gis_features_without_roll_account: number;
      permit_far_from_gis: number;
      interior_point: number;
      /** PROP_ID = pID join proof (assemble-coordinates.ts); absent in older watermarks. */
      join_proof?: Record<string, number>;
    };
  };
  gis: GisRunReads | null;
}

export function buildGisSection(gis: GisRunReads | null) {
  if (gis === null) {
    return {
      artifact_run_id: null,
      pages: 0,
      duration_s: null,
      features_per_s: null,
      layer_last_edit_date: null,
      complete: false,
      limitation: "gis: no runner artifact imported",
      throughput: null,
      source_jobs: [],
    };
  }
  const complete = gis.status === "complete";
  let throughput: ThroughputRow | null = null;
  if (complete && gis.started_at !== null && gis.finished_at !== null && gis.source_count !== null) {
    throughput = throughputRow({
      source: "travis-county-gis",
      pages: gis.pages,
      rows: gis.source_count,
      startedAt: gis.started_at,
      finishedAt: gis.finished_at,
      concurrency: gis.concurrency ?? 2,
    });
  }
  return {
    artifact_run_id: gis.artifact_run_id,
    pages: gis.pages,
    duration_s: gis.duration_s,
    features_per_s: gis.features_per_s,
    layer_last_edit_date: gis.layer_last_edit_date,
    complete,
    limitation: complete ? null : gisBlockedLimitation(gis.blocked_at ?? "unknown"),
    throughput,
    source_jobs: [gis.job_id],
  };
}

const ZERO_STATS = {
  multi_feature: { pids: 0, extra_features: 0, rule: "largest_area" },
  condo_building_point: { accounts: 0, buildings: 0, rule: "condo_building_point" },
  gis_features_without_roll_account: 0,
  permit_far_from_gis: 0,
  interior_point: 0,
};

export function buildCoordinatesSection(r: CoordinateReads) {
  const stats = r.assembly?.stats ?? ZERO_STATS;
  const gisCount = r.gis?.source_count ?? null;
  return {
    denominator_r: r.coverage.denominator_r,
    with_point_r: r.coverage.with_point_r,
    coverage_r: r.coverage.coverage_r,
    non_land_account: r.coverage.non_land_account,
    by_source: { gis_centroid: 0, address_point: 0, permit_point: 0, none: 0, ...r.bySource },
    by_rule: r.byRule,
    gap_by_reason: r.gapByReason,
    condo_building_point: stats.condo_building_point,
    address_point: (stats as { address_point?: unknown }).address_point ?? null,
    multi_feature: stats.multi_feature,
    gis_features_without_roll_account: stats.gis_features_without_roll_account,
    permit_far_from_gis: stats.permit_far_from_gis,
    interior_point: stats.interior_point,
    join_proof: (stats as { join_proof?: Record<string, number> }).join_proof ?? null,
    gis_feature_count: gisCount,
    roll_count: r.coverage.roll_count,
    gis_minus_roll: gisCount === null ? null : gisCount - r.coverage.roll_count,
    gap_pct: gisCount === null ? "unknown" : gapPercent(r.coverage.roll_count, gisCount),
    anchors: r.anchors,
    gis: buildGisSection(r.gis),
    source_jobs: [r.gis?.job_id, r.assembly?.job_id].filter((j): j is string => j !== undefined),
  };
}

const counted = (rows: Array<{ k: string | null; n: number }>): Record<string, number> =>
  Object.fromEntries(rows.filter((x) => x.k !== null).map((x) => [x.k as string, Number(x.n)]));

export async function postgresCoordinateReads(sql: postgres.Sql, jobId: string): Promise<CoordinateReads> {
  const [cov] = await sql.unsafe<Array<{ coverage_r: number | null }>>(
    `${QDB_COVERAGE_SQL.replace(" FROM parcels", " AS coverage_r FROM parcels")} AND job_id = $1`,
    [jobId],
  );
  const [c] = await sql<Array<{ denominator_r: number; with_point_r: number; non_land_account: number; roll_count: number }>>`
    SELECT count(*) FILTER (WHERE prop_type = 'R')::int AS denominator_r,
           count(*) FILTER (WHERE prop_type = 'R' AND latitude IS NOT NULL)::int AS with_point_r,
           count(*) FILTER (WHERE coordinate_reason = 'non_land_account')::int AS non_land_account,
           count(*)::int AS roll_count
    FROM parcels WHERE job_id = ${jobId}`;
  const bySource = await sql<Array<{ k: string | null; n: number }>>`
    SELECT coordinate_source AS k, count(*)::int AS n FROM parcels WHERE job_id = ${jobId} GROUP BY 1`;
  const byRule = await sql<Array<{ k: string | null; n: number }>>`
    SELECT coordinate_rule AS k, count(*)::int AS n FROM parcels WHERE job_id = ${jobId} GROUP BY 1`;
  const byReason = await sql<Array<{ k: string | null; n: number }>>`
    SELECT coordinate_reason AS k, count(*)::int AS n FROM parcels WHERE job_id = ${jobId} GROUP BY 1`;
  const anchors: Anchor[] = [];
  for (const geo of ANCHOR_GEO_IDS) {
    const [a] = await sql<Array<{ request_identifier: string; coordinate_source: string | null }>>`
      SELECT request_identifier, coordinate_source FROM parcels
      WHERE job_id = ${jobId} AND geo_id = ${geo} AND prop_type = 'R'
      ORDER BY request_identifier LIMIT 1`;
    anchors.push({
      geo_id: geo,
      request_identifier: a?.request_identifier ?? null,
      on_roll: a !== undefined,
      coordinate_source: a?.coordinate_source ?? null,
    });
  }
  const marks = await sql<Array<{ source_key: string; value: Record<string, unknown> }>>`
    SELECT source_key, value FROM watermarks WHERE track = 'gis' AND source_key IN (${GIS_SOURCE_KEY}, 'coords_assembly')`;
  const mark = (k: string) => marks.find((m) => m.source_key === k)?.value;
  const g = mark(GIS_SOURCE_KEY);
  const asm = mark("coords_assembly") as CoordinateReads["assembly"] | undefined;
  return {
    coverage: {
      denominator_r: c?.denominator_r ?? 0,
      with_point_r: c?.with_point_r ?? 0,
      coverage_r: Number(cov?.coverage_r ?? 0),
      non_land_account: c?.non_land_account ?? 0,
      roll_count: c?.roll_count ?? 0,
    },
    bySource: counted(bySource),
    byRule: counted(byRule),
    gapByReason: counted(byReason),
    anchors,
    assembly: asm ?? null,
    gis: g === undefined ? null : (g as unknown as GisRunReads),
  };
}

export const section: ReportSection = {
  key: "coordinates",
  build: async (sql, jobId) => buildCoordinatesSection(await postgresCoordinateReads(sql, jobId)),
};

export const gisSection: ReportSection = {
  key: "gis",
  build: async (sql, jobId) => buildGisSection((await postgresCoordinateReads(sql, jobId)).gis),
};

export const sections: readonly ReportSection[] = [section, gisSection];
