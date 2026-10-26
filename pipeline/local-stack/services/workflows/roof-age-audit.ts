// A-07 T058 (Track D, contracts/estimator.md § Sequence step 1): `RoofAgeAudit`, the read-only
// Restate service behind `backbone roof-age:audit`. Dry run only — never writes
// `roof_age_estimates` (migration 0406); that is T059/T060, gated on D-21's human approval.
//
// For each of `limit` real TCAD properties (ordered by request_identifier, offset-paged),
// reads: the TCAD built year (parcels), every linked Austin permit's status_class/reroof_match/
// issue_date (property_improvements), and each 'closed' permit's raw completed_date from
// permit_source_rows' captured payload (the internal Query DB table has no completed_date
// column of its own — only the raw capture does). Runs the vendored estimator (via
// oracle-runtime's travis/roof-age/run.ts wrapper, never reimplemented) and, independently,
// this file's own small view-side derivation (query-core's roofAgeBasis/Confidence/Years,
// T051's harness) over the SAME real facts, then diffs the two per property.
//
// Known gap, honestly surfaced rather than guessed: Postgres's `property_improvements` does
// not persist `improvement_action` (New vs Replacement), so this view-side derivation can never
// set `newMatch = true` from this table; a real `new_construction` basis therefore always shows
// as a view/estimator basis mismatch here, not a `new_construction` agreement. Each affected row
// carries `viewSideCaveat: "no_improvement_action_column"` in the report.
import type * as Restate from "@restatedev/restate-sdk";
import type postgres from "postgres";
import { z } from "zod";
import { estimateOne, type RoofAgeRunRecord, simpleBasisOf } from "../../../oracle-runtime/travis/roof-age/run.js";
import { compareRoofAgeDerivations, type RoofAgeComparisonRowResult } from "../../../../packages/query-core/roof-age-comparison.js";
import { terminalDateAccepted } from "../../../../packages/query-core/src/derive.js";
import { lazyQueryDb, QueryDbConfigError } from "../loader.js";

export const ROOF_AGE_AUDIT = "RoofAgeAudit";

export const AuditRequest = z.object({
  limit: z.number().int().positive(),
  offset: z.number().int().nonnegative().default(0),
  asOfDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
export type AuditRequest = z.infer<typeof AuditRequest>;

export interface PropertyRow {
  request_identifier: string;
  property_structure_built_year: number | null;
}

export interface PermitRow {
  permit_number: string;
  source: string;
  status_class: "open" | "stalled" | "closed" | "exclude" | "needs_review";
  reroof_match: boolean | null;
  issue_date: string | null;
}

export interface AuditRow {
  tcadId: string;
  builtYear: number | null;
  estimator: {
    basis: string;
    confidence: string;
    roofAgeYears: number | null;
    builtYearReason: string | null;
  };
  viewSide: { basis: string; confidence: string; roofAgeYears: number | null };
  agree: boolean;
  mismatchFields: string[];
  viewSideCaveat: "no_improvement_action_column" | null;
}

export interface AuditResult {
  asOfDate: string;
  limit: number;
  offset: number;
  total: number;
  agreeCount: number;
  agreeAll25: boolean;
  rows: AuditRow[];
}

export async function candidateTcadIds(
  sql: postgres.TransactionSql | postgres.Sql,
  limit: number,
  offset: number,
): Promise<PropertyRow[]> {
  // Deliberately favors properties with a real closed+roofing permit (not just any permit), so
  // the audit exercises the permit-anchored branch, not only the built-year fallback.
  return sql<PropertyRow[]>`
    SELECT DISTINCT p.request_identifier, p.property_structure_built_year
    FROM parcels p
    WHERE EXISTS (
      SELECT 1 FROM property_improvements pi
      WHERE pi.request_identifier = p.request_identifier AND pi.tombstoned = false
        AND pi.status_class = 'closed' AND pi.reroof_match = true
    )
    ORDER BY p.request_identifier
    LIMIT ${limit} OFFSET ${offset}`;
}

export async function permitsFor(sql: postgres.Sql, tcadId: string): Promise<PermitRow[]> {
  return sql<PermitRow[]>`
    SELECT permit_number, source, status_class, reroof_match, issue_date::text AS issue_date
    FROM property_improvements
    WHERE request_identifier = ${tcadId} AND tombstoned = false
    ORDER BY permit_number`;
}

/** Only the one field this audit needs from the raw capture — never the full payload (no
 *  contractor name, applicant or address reaches this report). */
export async function completedDateFor(sql: postgres.Sql, source: string, permitNumber: string): Promise<string | null> {
  const [row] = await sql<{ completed_date: string | null }[]>`
    SELECT payload ->> 'completed_date' AS completed_date
    FROM permit_source_rows
    WHERE source = ${source} AND permit_number = ${permitNumber}
    ORDER BY row_index DESC
    LIMIT 1`;
  const raw = row?.completed_date ?? null;
  if (raw === null) return null;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(raw);
  return m ? (m[1] as string) : null;
}

export function roofing(reroofMatch: boolean | null): "roofing" | "not_roofing" | "needs_review" {
  return reroofMatch === true ? "roofing" : reroofMatch === false ? "not_roofing" : "needs_review";
}

export async function auditOne(sql: postgres.Sql, property: PropertyRow, asOfDate: string): Promise<AuditRow> {
  const permits = await permitsFor(sql, property.request_identifier);
  const withCompletion = await Promise.all(
    permits.map(async (p) => ({
      ...p,
      completed_date: p.status_class === "closed" ? await completedDateFor(sql, p.source, p.permit_number) : null,
    })),
  );

  const record: RoofAgeRunRecord = {
    pID: property.request_identifier,
    finishedAt: `${asOfDate}T00:00:00.000Z`,
    builtYear: property.property_structure_built_year,
    permits: withCompletion.map((p) => ({
      permit_number: p.permit_number,
      status_class: p.status_class,
      roofing: roofing(p.reroof_match),
      issue_date: p.issue_date,
      completed_date: p.completed_date,
    })),
  };
  const estimated = estimateOne(record);

  // The view side's own, independent derivation over the same real facts (not read from the
  // estimator's output): the latest closed+roofing permit's completion date that passes the
  // SAME chronology gate the real `v_property` view's `terminal` CTE applies via
  // `terminal_date_accepted` (packages/query-core/views.sql, backed by derive.ts's
  // `terminalDateAccepted` — not reimplemented here, reused) — present, not after as_of, not
  // before the permit's own issue date — else the built-year fallback, the same precedence
  // order `roofAgeBasis` expects. Without this gate a chronologically-impossible completion
  // date (e.g. completed before the permit was even issued) would wrongly look like a valid
  // anchor to this harness, even though the real view already excludes it upstream.
  const closedRoofing = withCompletion
    .filter(
      (p) =>
        p.status_class === "closed" &&
        p.reroof_match === true &&
        terminalDateAccepted(p.completed_date, p.issue_date, asOfDate),
    )
    .sort((a, b) => (b.completed_date ?? "").localeCompare(a.completed_date ?? ""));
  const latestCompletion = closedRoofing[0]?.completed_date ?? null;
  const roofDateView = latestCompletion ?? (property.property_structure_built_year !== null ? String(property.property_structure_built_year) : null);
  const replacementMatch = latestCompletion !== null && roofDateView === latestCompletion;

  const comparison = compareRoofAgeDerivations([
    {
      tcadId: property.request_identifier,
      asOf: asOfDate,
      roofDate: roofDateView,
      replacementMatch,
      newMatch: false, // property_improvements carries no improvement_action (see header note)
      builtYear: property.property_structure_built_year,
      estimator: {
        basis: simpleBasisOf(estimated),
        confidence: estimated.estimate.confidence,
        roofAgeYears: estimated.estimate.estimatedAgeYears,
      },
    },
  ]).rows[0] as RoofAgeComparisonRowResult;

  // The known, accepted gap is specific: property_improvements carries no improvement_action,
  // so newMatch is always forced false above, and the view side can never derive
  // new_construction. Any OTHER disagreement (e.g. a chronology or built-year mismatch) is a
  // real divergence the D-21 reviewer must see as such, not as this known, dismissible gap.
  const isKnownGap = !comparison.agree && simpleBasisOf(estimated) === "new_construction";

  return {
    tcadId: property.request_identifier,
    builtYear: property.property_structure_built_year,
    estimator: {
      basis: simpleBasisOf(estimated),
      confidence: estimated.estimate.confidence,
      roofAgeYears: estimated.estimate.estimatedAgeYears,
      builtYearReason: estimated.builtYearReason,
    },
    viewSide: comparison.viewSide,
    agree: comparison.agree,
    mismatchFields: comparison.mismatchFields,
    viewSideCaveat: isKnownGap ? "no_improvement_action_column" : null,
  };
}

export async function runAudit(sql: postgres.Sql, req: AuditRequest): Promise<AuditResult> {
  const properties = await candidateTcadIds(sql, req.limit, req.offset);
  const rows = await Promise.all(properties.map((p) => auditOne(sql, p, req.asOfDate)));
  const agreeCount = rows.filter((r) => r.agree).length;
  return {
    asOfDate: req.asOfDate,
    limit: req.limit,
    offset: req.offset,
    total: rows.length,
    agreeCount,
    agreeAll25: rows.length === 25 && agreeCount === 25,
    rows,
  };
}

export interface RoofAgeAuditDeps {
  sql: () => postgres.Sql;
}

function connect(deps: RoofAgeAuditDeps, restate: typeof Restate): postgres.Sql {
  try {
    return deps.sql();
  } catch (error) {
    if (error instanceof QueryDbConfigError) throw new restate.TerminalError(error.message);
    throw error;
  }
}

export function createRoofAgeAudit(restate: typeof Restate, deps: RoofAgeAuditDeps) {
  return restate.service({
    name: ROOF_AGE_AUDIT,
    handlers: {
      run: async (ctx: Restate.Context, req: unknown): Promise<AuditResult> => {
        const parsed = AuditRequest.safeParse(req);
        if (!parsed.success) throw new restate.TerminalError("RoofAgeAudit.run: {limit, offset, asOfDate} required");
        const sql = connect(deps, restate);
        return ctx.run("roof-age-audit", () => runAudit(sql, parsed.data));
      },
    },
  });
}

/** Auto-loaded by app.ts's `loadWorkflows` (every `services/workflows/*.ts` exporting this). */
export function createService(restate: typeof Restate) {
  return createRoofAgeAudit(restate, { sql: lazyQueryDb() });
}
