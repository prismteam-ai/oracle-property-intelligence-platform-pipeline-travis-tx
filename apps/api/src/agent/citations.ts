// T019 (A-14, agent-design.md § 5 "Citation mapping"; data-model.md § "agent.ask contract" >
// `Match`): the per-request citation registry. Every row any tool returns this turn is
// registered once, keyed by the row's own record cid (v_property's `cid` for a property row,
// v_roofing_permit's `cid` — same value as its `permit_cid` — for a permit row; see
// packages/query-core/views.sql: both views alias their own record cid to a flat `cid` column),
// with a stable 1-based index `n` assigned in first-seen order. `matches()` builds `Match[]`
// only from each row's own provenance fields, copied verbatim — never from model text.
// `postCheck(answer)` strips any `[n]` outside `1..matches().length` and any unregistered
// CID-shaped token (`bafy…`/`bafk…`, 59 chars) from a candidate answer, counting each removal so
// ask.ts can log `ungrounded_citation`/`out_of_range_citation` metrics (agent-design.md § 4,
// gate G-grounded).
//
// Algorithm matches packages/query-core/test/agent-citations.test.ts's
// `referenceCitationRegistry()` exactly (register/matches/postCheck semantics): that file is the
// executable spec this module is built against, not imported from (it lives in query-core
// because it predates this file, T018a).
import type { Row } from "@countylens/query-core";

const CID_SHAPED = /\b(bafy[0-9a-z]{55}|bafk[0-9a-z]{55})\b/gi;
const CITATION_TOKEN = /\[(\d+)\]/g;

/** data-model.md's `Match`: every field copied verbatim from the row's own provenance, plus
 *  whichever row-type fields that row carries. `missing` defaults to `[]` when the row has none. */
export interface Match {
  n: number;
  property_cid?: string;
  permit_cid?: string;
  permit_number?: string;
  source_url: string | null;
  captured_at: string;
  table: string;
  table_cid: string;
  run_id: string;
  manifest_cid: string;
  as_of: string;
  roof_age_years?: number;
  roof_age_basis?: string;
  roof_age_confidence?: string;
  open_days?: number;
  status_class?: string;
  contractor_resolution?: string;
  /** A-16: the contractor name as printed on the permit (unverified) and its BBB search link. */
  contractor_name_as_printed?: string;
  bbb_url?: string;
  bbb_status?: string;
  bbb_status_reason?: string;
  missing: { field: string; reason: string }[];
}

/** A tool-result row, as returned by a packages/query-core tool function: must carry its own
 *  record `cid` (the registry key) plus whatever provenance/row fields that view exposes. */
export type CitationRow = Row & { cid: string };

export interface PostCheckResult {
  /** `answer` with every out-of-range `[n]` and unregistered CID-shaped token removed. */
  cleaned: string;
  /** Count of `[n]` tokens outside `1..matches().length` that were stripped. */
  outOfRangeCitations: number;
  /** Count of CID-shaped tokens not in the registry that were stripped. */
  ungroundedCids: number;
}

export interface CitationRegistry {
  /** Registers a row by its own `cid`, first-seen order. Re-registering the same `cid` is a
   *  no-op that returns its existing index (the first-registered row's fields are kept). */
  register(row: CitationRow): number;
  /** Every registered row as a `Match`, in `n` order (1-based; `matches()[i]` has `n === i+1`). */
  matches(): Match[];
  /** True when a row with this `cid` is already registered. */
  has(cid: string): boolean;
  /** Number of distinct rows registered so far. */
  size(): number;
  postCheck(answer: string): PostCheckResult;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function toMatch(n: number, row: CitationRow): Match {
  const missing = Array.isArray(row.missing) ? (row.missing as Match["missing"]) : [];
  const propertyCid = optionalString(row.property_cid);
  const permitCid = optionalString(row.permit_cid);
  const permitNumber = optionalString(row.permit_number);
  const roofAgeYears = optionalNumber(row.roof_age_years);
  const roofAgeBasis = optionalString(row.roof_age_basis);
  const roofAgeConfidence = optionalString(row.roof_age_confidence);
  const openDays = optionalNumber(row.open_days);
  const statusClass = optionalString(row.status_class);
  const contractorResolution = optionalString(row.contractor_resolution);
  const contractorName = optionalString(row.contractor_name_as_printed);
  const bbbUrl = optionalString(row.bbb_url);
  const bbbStatus = optionalString(row.bbb_status);
  const bbbStatusReason = optionalString(row.bbb_status_reason);
  return {
    n,
    ...(propertyCid !== undefined ? { property_cid: propertyCid } : {}),
    ...(permitCid !== undefined ? { permit_cid: permitCid } : {}),
    ...(permitNumber !== undefined ? { permit_number: permitNumber } : {}),
    source_url: optionalString(row.source_url) ?? null,
    captured_at: optionalString(row.captured_at) ?? "",
    table: optionalString(row.table) ?? "",
    table_cid: optionalString(row.table_cid) ?? "",
    run_id: optionalString(row.run_id) ?? "",
    manifest_cid: optionalString(row.manifest_cid) ?? "",
    as_of: optionalString(row.as_of) ?? "",
    ...(roofAgeYears !== undefined ? { roof_age_years: roofAgeYears } : {}),
    ...(roofAgeBasis !== undefined ? { roof_age_basis: roofAgeBasis } : {}),
    ...(roofAgeConfidence !== undefined ? { roof_age_confidence: roofAgeConfidence } : {}),
    ...(openDays !== undefined ? { open_days: openDays } : {}),
    ...(statusClass !== undefined ? { status_class: statusClass } : {}),
    ...(contractorResolution !== undefined ? { contractor_resolution: contractorResolution } : {}),
    ...(contractorName !== undefined ? { contractor_name_as_printed: contractorName } : {}),
    ...(bbbUrl !== undefined ? { bbb_url: bbbUrl } : {}),
    ...(bbbStatus !== undefined ? { bbb_status: bbbStatus } : {}),
    ...(bbbStatusReason !== undefined ? { bbb_status_reason: bbbStatusReason } : {}),
    missing,
  };
}

/** Builds a fresh, empty registry (one per `agent.ask` request — never shared across requests). */
export function createCitationRegistry(): CitationRegistry {
  const order: string[] = [];
  const rows = new Map<string, CitationRow>();

  return {
    register(row) {
      if (!rows.has(row.cid)) {
        rows.set(row.cid, row);
        order.push(row.cid);
      }
      return order.indexOf(row.cid) + 1;
    },

    has(cid) {
      return rows.has(cid);
    },

    size() {
      return order.length;
    },

    matches() {
      return order.map((cid, i) => {
        const row = rows.get(cid);
        if (row === undefined)
          throw new Error(`citation registry: ${cid} missing from its own order`);
        return toMatch(i + 1, row);
      });
    },

    postCheck(answer) {
      const maxN = order.length;
      const registeredCids = new Set(order);
      let outOfRangeCitations = 0;
      let ungroundedCids = 0;

      let cleaned = answer.replace(CITATION_TOKEN, (full, nStr: string) => {
        const n = Number(nStr);
        if (n < 1 || n > maxN) {
          outOfRangeCitations += 1;
          return "";
        }
        return full;
      });

      cleaned = cleaned.replace(CID_SHAPED, (full) => {
        if (!registeredCids.has(full)) {
          ungroundedCids += 1;
          return "";
        }
        return full;
      });

      return { cleaned, outOfRangeCitations, ungroundedCids };
    },
  };
}

// ---------------------------------------------------------------------------------------
// A-16 A14-5 (Task B's structured empty outcomes, roofing-crm composeAnswer.ts): an answer with no
// cited row says WHY, derived only from what the tools returned (their empty_reason, an error
// reason, the declareUnpublished tool), never from the question's wording.
// ---------------------------------------------------------------------------------------

export const EMPTY_OUTCOMES = [
  "empty_in_scope",
  "field_not_published",
  "field_unknown",
  "out_of_scope",
  "not_found",
  "run_not_found",
  "index_not_built",
  "index_stale",
] as const;
export type EmptyOutcome = (typeof EMPTY_OUTCOMES)[number];

/** Most specific first: a run that cannot be read beats a scope problem beats a field gap. */
const OUTCOME_PRIORITY: readonly EmptyOutcome[] = [
  "index_not_built",
  "index_stale",
  "run_not_found",
  "out_of_scope",
  "field_not_published",
  "field_unknown",
  "not_found",
  "empty_in_scope",
];

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * The structured outcome of a turn that cited nothing: `null` when any row matched or no search
 * ran at all. A search tool output (it carries `applied`) with `empty_reason` `no_match` (or none)
 * is `empty_in_scope`; `field_not_published`, `out_of_scope`, `not_found` and `run_not_found` pass
 * through; a tool output with `error: index_not_built | index_stale` names the index problem.
 */
export function emptyOutcomeOf(
  matchCount: number,
  toolOutputs: readonly Record<string, unknown>[],
): EmptyOutcome | null {
  if (matchCount > 0) return null;
  const seen = new Set<EmptyOutcome>();
  for (const output of toolOutputs) {
    const error = output.error;
    if (error === "index_not_built" || error === "index_stale") {
      seen.add(error);
      continue;
    }
    if (!isObject(output.applied)) continue;
    const reason = output.empty_reason;
    if (
      reason === "field_not_published" ||
      reason === "field_unknown" ||
      reason === "out_of_scope" ||
      reason === "not_found" ||
      reason === "run_not_found"
    )
      seen.add(reason);
    else seen.add("empty_in_scope");
  }
  return OUTCOME_PRIORITY.find((o) => seen.has(o)) ?? null;
}

/** The plain sentence each outcome adds when the answer cites nothing. */
export const EMPTY_OUTCOME_SENTENCES: Readonly<Record<EmptyOutcome, string>> = {
  empty_in_scope: "No records in this run match these filters in the searched area.",
  field_not_published:
    "No records can be returned: a field this search filters on is not published in this run.",
  field_unknown:
    "No records match: a field this search filters on is unknown for the records in the searched area (other records in this run have it).",
  out_of_scope: "That place is outside Travis County, which is the only county in this run.",
  not_found: "No record with that identifier is in this run.",
  run_not_found: "That run is not in the published runs list.",
  index_not_built: "The search index for this run is not built yet, so it cannot be searched.",
  index_stale: "The search index for this run is out of date, so it cannot be searched.",
};

/** Fields the agent declares it cannot answer, with the contract reason. A-16: BBB status IS
 *  published (blocked when a name is printed, else not_checked); BBB blocks automated lookups, so
 *  no rating exists and the reason is bbb_blocked, never no_lexicon_carrier.
 *  The contractor's printed name is published since contract v1.1 (`contractor_name_as_printed`,
 *  4,139 of 15,025 Run 3 permits), so it is no longer declared unpublished (ERR-78). */
export const UNPUBLISHED_FIELDS = {
  owner_is_out_of_area: "not_in_export",
  bbb_status: "bbb_blocked",
} as const;
export type UnpublishedField = keyof typeof UNPUBLISHED_FIELDS;

/** `missing[]` entries from structured tool results only: the `declareUnpublished` tool's
 *  `unpublished` list and an `owner_area: not_published` notice. An applied out-of-area filter is
 *  not a gap: contract v1.2 publishes the owner mailing ZIP it reads (label audit 2026-10-26). */
export function unpublishedFromTools(
  toolOutputs: readonly Record<string, unknown>[],
): { field: string; reason: string }[] {
  const out: { field: string; reason: string }[] = [];
  for (const output of toolOutputs) {
    if (Array.isArray(output.unpublished)) {
      for (const entry of output.unpublished as unknown[]) {
        if (isObject(entry) && typeof entry.field === "string" && typeof entry.reason === "string")
          out.push({ field: entry.field, reason: entry.reason });
      }
    }
    const ownerArea = output.owner_area;
    if (isObject(ownerArea) && ownerArea.status === "not_published")
      out.push({ field: "owner_is_out_of_area", reason: UNPUBLISHED_FIELDS.owner_is_out_of_area });
  }
  return out;
}

// ---------------------------------------------------------------------------------------
// A-16 final review: the answer is prose for people. One wording for the address gap (the
// product's "Address not in the published export", reason not_in_export) and plain labels, never
// raw field names, in every sentence the user reads.
// ---------------------------------------------------------------------------------------

export const ADDRESS_NOT_PUBLISHED_TEXT = "Address not in the published export";

/** Plain labels for the field names a tool result or the model may put in prose. */
export const FIELD_LABELS: Readonly<Record<string, string>> = {
  "contractor.name_as_printed": "contractor name",
  contractor_name_as_printed: "contractor name",
  contractor_company_cid: "contractor company",
  contractor_resolution: "contractor match",
  owner_is_out_of_area: "owner lives outside the area",
  owner_area_class: "owner area",
  year_built: "year built",
  property_structure_built_year: "year built",
  roof_age_years: "roof age",
  roof_age_basis: "roof age basis",
  tenure_years: "owner tenure",
  last_ownership_transfer_date: "last sale or deed date",
  owner_name: "owner name",
  bbb_status: "BBB status",
  bbb_status_reason: "BBB status reason",
  bbb_rating: "BBB rating",
  bbb_url: "BBB search link",
  open_days: "days open",
  open_years: "years open",
  status_class: "permit status",
  unnormalized_address: "address",
};

/** The plain label of a field name (dots and underscores to spaces when it has no label). */
export function fieldLabel(field: string): string {
  return FIELD_LABELS[field] ?? field.replaceAll(".", " ").replaceAll("_", " ");
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const RAW_FIELD_RE = new RegExp(
  `\`?\\b(${Object.keys(FIELD_LABELS)
    .sort((a, b) => b.length - a.length)
    .map(escapeRe)
    .join("|")})\\b\`?`,
  "g",
);

/** The answer with raw field names replaced by labels and the address wording unified. */
export function plainWording(answer: string): string {
  return answer
    .replace(RAW_FIELD_RE, (_m: string, field: string) => fieldLabel(field))
    .replace(/not included in the published tables/gi, "not in the published export");
}
