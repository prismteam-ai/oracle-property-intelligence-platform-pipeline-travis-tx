// A-16 (PO audit item 8): a permit that prints no contractor has no contractor edge, and the gap
// is `source_missing` ("Contractor not printed on permit"), not `contractor_unresolved` (nothing
// failed to match). derive.ts now says so for indexes built from here on; this read-side remap
// gives the same answer for an index built before (Run 3) and for the one reason views.sql
// hard-codes (`bbb_rating`), without changing VIEWS_SQL (that would change viewsSha256 and make
// every per-run index stale).
//
// The remap is exact: in v_roofing_permit, `contractor_unresolved` on these fields comes only from
// zero edges (one edge carries the company CID and name; several give `needs_review`). It runs only
// when the row itself shows no printed name and no company.

/** The permit fields whose gap means "no contractor printed" when the permit has no edge. */
export const NO_CONTRACTOR_FIELDS: ReadonlySet<string> = new Set([
  "contractor_name_as_printed",
  "contractor_company_cid",
  "bbb_rating",
]);

/** True when the permit row printed no contractor (no name and no company). */
export function noContractorPrinted(name: unknown, companyCid: unknown): boolean {
  return (name === null || name === undefined) && (companyCid === null || companyCid === undefined);
}

/** One reason, corrected for a permit with no printed contractor. */
export function contractorGapReason(field: string, reason: string, noContractor: boolean): string {
  return noContractor && reason === "contractor_unresolved" && NO_CONTRACTOR_FIELDS.has(field)
    ? "source_missing"
    : reason;
}

/** `bbb_status_reason` for a permit with no printed contractor: nothing to look up. */
export function bbbReasonFor(reason: unknown, noContractor: boolean): unknown {
  return noContractor && reason === "contractor_unresolved" ? "source_missing" : reason;
}

/** A v_roofing_permit row (any engine row with its columns) with the gap reasons corrected. */
export function withContractorGaps<T extends Record<string, unknown>>(row: T): T {
  const none = noContractorPrinted(row.contractor_name_as_printed, row.contractor_company_cid);
  if (!none) return row;
  const missing = Array.isArray(row.missing)
    ? (row.missing as unknown[]).map((m) => {
        if (typeof m !== "object" || m === null) return m;
        const { field, reason } = m as { field?: unknown; reason?: unknown };
        return typeof field === "string" && typeof reason === "string"
          ? { ...(m as object), field, reason: contractorGapReason(field, reason, true) }
          : m;
      })
    : row.missing;
  return { ...row, missing, bbb_status_reason: bbbReasonFor(row.bbb_status_reason, true) };
}
