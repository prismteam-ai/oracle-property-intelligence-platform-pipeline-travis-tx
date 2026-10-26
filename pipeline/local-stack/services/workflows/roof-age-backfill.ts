// A-07 T059/T060 (Track D, contracts/estimator.md § Sequence steps 2-3): `RoofAgeBackfill`,
// behind `backbone roof-age:backfill --as-of-date ... --report <path> [--limit N --offset M]
// [--apply]`. A plain read-write Restate service, not a Loader track: the full-roll scope is
// hundreds of thousands of rows processed in many small batches (keyset-paginated), and holding
// that open as ONE Postgres transaction (the Loader's `merge()` contract) for the whole run would
// be a long-lock antipattern; each batch commits its own small, content-aware UPSERT instead
// (same "write only when the value actually changed" idea as `comptroller_registry`'s loader
// track, just batched rather than one `unnest`).
//
// Always invokes the unmodified vendored kit estimator (via oracle-runtime's `estimateOne`,
// T050) per property — never reimplements its logic, even at full-roll scale. To keep full-roll
// scale tractable without one ruinous N+1 query per property (query-db-loading-matching: no
// one-shot unbatched scan of the permit tables, per this project's own incident history), each
// batch fetches its own slice's permits and completed dates in ONE extra join query, not one
// query per property.
import type * as Restate from "@restatedev/restate-sdk";
import type postgres from "postgres";
import { z } from "zod";
import {
  estimateOne,
  simpleBasisOf,
  type RoofAgeRunRecord,
  type RoofAgeRunRow,
} from "../../../oracle-runtime/travis/roof-age/run.js";
import type { TravisRoofPermit } from "../../../oracle-runtime/travis/roof-age/travis-roof-age-profile.js";
import { lazyQueryDb, QueryDbConfigError } from "../loader.js";

export const ROOF_AGE_BACKFILL = "RoofAgeBackfill";

export const BackfillRequest = z.object({
  jobId: z.string().regex(/^travis-a07-[a-z0-9-]+$/),
  asOfDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  limit: z.number().int().positive().optional(),
  offset: z.number().int().nonnegative().default(0),
  apply: z.boolean().default(false),
});
export type BackfillRequest = z.infer<typeof BackfillRequest>;

export interface ParcelRow {
  request_identifier: string;
  property_structure_built_year: number | null;
  source_url: string;
  captured_at: string;
  export_sha256: string;
}

export interface PermitRow {
  request_identifier: string;
  permit_number: string;
  source: string;
  status_class: "open" | "stalled" | "closed" | "exclude" | "needs_review";
  reroof_match: boolean | null;
  issue_date: string | null;
  source_url: string;
  captured_at: string;
  content_sha256: string;
  completed_date: string | null;
}

const BATCH_SIZE = 2_000;

/** The 25-property subset (same ordered filter as `RoofAgeAudit`, so `--limit 25 --offset 0`
 *  selects the same 25 properties the audit already reviewed). */
export async function subsetParcels(sql: postgres.Sql, limit: number, offset: number): Promise<ParcelRow[]> {
  return sql<ParcelRow[]>`
    SELECT DISTINCT p.request_identifier, p.property_structure_built_year,
           p.source_url, p.captured_at::text AS captured_at, p.export_sha256
    FROM parcels p
    WHERE EXISTS (
      SELECT 1 FROM property_improvements pi
      WHERE pi.request_identifier = p.request_identifier AND pi.tombstoned = false
        AND pi.status_class = 'closed' AND pi.reroof_match = true
    )
    ORDER BY p.request_identifier
    LIMIT ${limit} OFFSET ${offset}`;
}

/** Keyset page over every parcel, ordered by request_identifier. */
export async function fullPage(sql: postgres.Sql, after: string | null, size: number): Promise<ParcelRow[]> {
  if (after === null) {
    return sql<ParcelRow[]>`
      SELECT request_identifier, property_structure_built_year,
             source_url, captured_at::text AS captured_at, export_sha256
      FROM parcels ORDER BY request_identifier LIMIT ${size}`;
  }
  return sql<ParcelRow[]>`
    SELECT request_identifier, property_structure_built_year,
           source_url, captured_at::text AS captured_at, export_sha256
    FROM parcels WHERE request_identifier > ${after} ORDER BY request_identifier LIMIT ${size}`;
}

/** Every permit for one batch's TCAD ids — one query per batch, never per property. The real
 *  `completed_date` (only meaningful for closed+roofing permits) is filled separately by
 *  `attachCompletedDates`, so callers always run both. */
export async function permitsForBatch(sql: postgres.Sql, tcadIds: readonly string[]): Promise<PermitRow[]> {
  if (tcadIds.length === 0) return [];
  return sql<PermitRow[]>`
    SELECT pi.request_identifier, pi.permit_number, pi.source, pi.status_class, pi.reroof_match,
           pi.issue_date::text AS issue_date, pi.source_url,
           pi.captured_at::text AS captured_at, pi.content_sha256,
           NULL::text AS completed_date
    FROM property_improvements pi
    WHERE pi.request_identifier = ANY(${tcadIds}) AND pi.tombstoned = false`;
}

export function isoDay(value: string | null): string | null {
  if (value === null) return null;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(value);
  return m ? (m[1] as string) : null;
}

export function roofing(reroofMatch: boolean | null): "roofing" | "not_roofing" | "needs_review" {
  return reroofMatch === true ? "roofing" : reroofMatch === false ? "not_roofing" : "needs_review";
}

export interface CoverageTotals {
  byBasis: Record<string, number>;
  byConfidence: Record<string, number>;
  total: number;
}

function emptyCoverage(): CoverageTotals {
  return { byBasis: {}, byConfidence: {}, total: 0 };
}

function addToCoverage(coverage: CoverageTotals, estimated: RoofAgeRunRow): void {
  const basis = simpleBasisOf(estimated);
  const confidence = estimated.estimate.confidence;
  coverage.byBasis[basis] = (coverage.byBasis[basis] ?? 0) + 1;
  coverage.byConfidence[confidence] = (coverage.byConfidence[confidence] ?? 0) + 1;
  coverage.total += 1;
}

export interface BackfillResult {
  jobId: string;
  asOfDate: string;
  scope: "subset" | "full";
  limit: number | null;
  offset: number;
  apply: boolean;
  rowsWritten: number;
  coverage: CoverageTotals;
}

export async function writeBatch(
  sql: postgres.Sql,
  jobId: string,
  asOfDate: string,
  rows: Array<{ tcadId: string; estimated: RoofAgeRunRow; sourceRecords: unknown[] }>,
): Promise<number> {
  if (rows.length === 0) return 0;
  const batch = rows.map((r) => ({
    tcad_id: r.tcadId,
    job_id: jobId,
    roof_age_basis: simpleBasisOf(r.estimated),
    roof_age_confidence: r.estimated.estimate.confidence,
    roof_age_years: r.estimated.estimate.estimatedAgeYears,
    as_of_date: asOfDate,
    source_records: JSON.stringify(r.sourceRecords),
    profile_version: r.estimated.profile.version,
    profile_sha256: r.estimated.profile.sha256,
  }));
  const written = await sql<{ tcad_id: string }[]>`
    INSERT INTO roof_age_estimates ${sql(
      batch,
      "tcad_id",
      "job_id",
      "roof_age_basis",
      "roof_age_confidence",
      "roof_age_years",
      "as_of_date",
      "source_records",
      "profile_version",
      "profile_sha256",
    )}
    ON CONFLICT (tcad_id) DO UPDATE SET
      job_id = excluded.job_id, roof_age_basis = excluded.roof_age_basis,
      roof_age_confidence = excluded.roof_age_confidence, roof_age_years = excluded.roof_age_years,
      as_of_date = excluded.as_of_date, source_records = excluded.source_records,
      profile_version = excluded.profile_version, profile_sha256 = excluded.profile_sha256
    WHERE roof_age_estimates.roof_age_basis IS DISTINCT FROM excluded.roof_age_basis
       OR roof_age_estimates.roof_age_confidence IS DISTINCT FROM excluded.roof_age_confidence
       OR roof_age_estimates.roof_age_years IS DISTINCT FROM excluded.roof_age_years
       OR roof_age_estimates.as_of_date IS DISTINCT FROM excluded.as_of_date
    RETURNING roof_age_estimates.tcad_id`;
  return written.length;
}

export async function estimateBatch(
  parcelBatch: ParcelRow[],
  permits: PermitRow[],
  asOfDate: string,
): Promise<Array<{ tcadId: string; estimated: RoofAgeRunRow; sourceRecords: unknown[] }>> {
  const permitsByTcad = new Map<string, PermitRow[]>();
  for (const p of permits) {
    const list = permitsByTcad.get(p.request_identifier);
    if (list === undefined) permitsByTcad.set(p.request_identifier, [p]);
    else list.push(p);
  }
  return parcelBatch.map((parcel) => {
    const own = permitsByTcad.get(parcel.request_identifier) ?? [];
    const travisPermits: TravisRoofPermit[] = own.map((p) => ({
      permit_number: p.permit_number,
      status_class: p.status_class,
      roofing: roofing(p.reroof_match),
      issue_date: isoDay(p.issue_date),
      completed_date: p.completed_date,
    }));
    const record: RoofAgeRunRecord = {
      pID: parcel.request_identifier,
      finishedAt: `${asOfDate}T00:00:00.000Z`,
      builtYear: parcel.property_structure_built_year,
      permits: travisPermits,
    };
    const estimated = estimateOne(record);
    const sourceRecords = [
      {
        type: "tcad",
        requestIdentifier: parcel.request_identifier,
        url: parcel.source_url,
        capturedAt: parcel.captured_at,
        digest: parcel.export_sha256,
      },
      ...own.map((p) => ({
        type: "permit",
        permitNumber: p.permit_number,
        url: p.source_url,
        capturedAt: p.captured_at,
        digest: p.content_sha256,
      })),
    ];
    return { tcadId: parcel.request_identifier, estimated, sourceRecords };
  });
}

export async function runBackfill(sql: postgres.Sql, req: BackfillRequest): Promise<BackfillResult> {
  const coverage = emptyCoverage();
  let rowsWritten = 0;

  if (req.limit !== undefined) {
    const parcelBatch = await subsetParcels(sql, req.limit, req.offset);
    const permits = await permitsForBatch(sql, parcelBatch.map((p) => p.request_identifier));
    const withDates = await attachCompletedDates(sql, permits);
    const estimates = await estimateBatch(parcelBatch, withDates, req.asOfDate);
    for (const e of estimates) addToCoverage(coverage, e.estimated);
    if (req.apply) rowsWritten += await writeBatch(sql, req.jobId, req.asOfDate, estimates);
    return {
      jobId: req.jobId,
      asOfDate: req.asOfDate,
      scope: "subset",
      limit: req.limit,
      offset: req.offset,
      apply: req.apply,
      rowsWritten,
      coverage,
    };
  }

  let after: string | null = null;
  for (;;) {
    const parcelBatch = await fullPage(sql, after, BATCH_SIZE);
    if (parcelBatch.length === 0) break;
    const permits = await permitsForBatch(sql, parcelBatch.map((p) => p.request_identifier));
    const withDates = await attachCompletedDates(sql, permits);
    const estimates = await estimateBatch(parcelBatch, withDates, req.asOfDate);
    for (const e of estimates) addToCoverage(coverage, e.estimated);
    if (req.apply) rowsWritten += await writeBatch(sql, req.jobId, req.asOfDate, estimates);
    after = parcelBatch[parcelBatch.length - 1]?.request_identifier ?? after;
    if (parcelBatch.length < BATCH_SIZE) break;
  }
  return {
    jobId: req.jobId,
    asOfDate: req.asOfDate,
    scope: "full",
    limit: null,
    offset: 0,
    apply: req.apply,
    rowsWritten,
    coverage,
  };
}

/** Fills `completed_date` on every closed+roofing permit from the raw capture, in one query. */
export async function attachCompletedDates(sql: postgres.Sql, permits: PermitRow[]): Promise<PermitRow[]> {
  const closedRoofing = permits.filter((r) => r.status_class === "closed" && r.reroof_match === true);
  if (closedRoofing.length === 0) return permits;
  const sources = closedRoofing.map((r) => r.source);
  const numbers = closedRoofing.map((r) => r.permit_number);
  const dateRows = await sql<{ source: string; permit_number: string; completed_date: string | null }[]>`
    SELECT source, permit_number, payload ->> 'completed_date' AS completed_date
    FROM permit_source_rows
    WHERE (source, permit_number) IN (SELECT * FROM UNNEST(${sources}::text[], ${numbers}::text[]))`;
  const byKey = new Map(dateRows.map((d) => [`${d.source}:${d.permit_number}`, isoDay(d.completed_date)]));
  return permits.map((p) => ({ ...p, completed_date: byKey.get(`${p.source}:${p.permit_number}`) ?? null }));
}

export interface RoofAgeBackfillDeps {
  sql: () => postgres.Sql;
}

function connect(deps: RoofAgeBackfillDeps, restate: typeof Restate): postgres.Sql {
  try {
    return deps.sql();
  } catch (error) {
    if (error instanceof QueryDbConfigError) throw new restate.TerminalError(error.message);
    throw error;
  }
}

export function createRoofAgeBackfill(restate: typeof Restate, deps: RoofAgeBackfillDeps) {
  return restate.service({
    name: ROOF_AGE_BACKFILL,
    handlers: {
      run: async (ctx: Restate.Context, req: unknown): Promise<BackfillResult> => {
        const parsed = BackfillRequest.safeParse(req);
        if (!parsed.success) throw new restate.TerminalError("RoofAgeBackfill.run: invalid request");
        const sql = connect(deps, restate);
        return ctx.run(
          `roof-age-backfill-${parsed.data.jobId}`,
          () => runBackfill(sql, parsed.data),
          { maxRetryAttempts: 1 },
        );
      },
    },
    options: { inactivityTimeout: { minutes: 30 }, abortTimeout: { minutes: 60 } },
  });
}

/** Auto-loaded by app.ts's `loadWorkflows` (every `services/workflows/*.ts` exporting this). */
export function createService(restate: typeof Restate) {
  return createRoofAgeBackfill(restate, { sql: lazyQueryDb() });
}
