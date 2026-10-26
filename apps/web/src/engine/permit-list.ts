// The rows the Permits list shows (A-03 T054): the columns `listRoofingPermitsSql()` selects from
// contract/v1 `v_roofing_permit`, validated with the contract's own row schema (a `pick` of
// `RoofingPermitRow`, so a type drift fails loudly instead of rendering wrong values). A displayed
// value that is null must carry a `missing` entry for its field (contract Provenance); a row
// without one is rejected here, so the page never has to invent a reason.
import { COLUMN_ENUMS, RoofingPermitRow, type Missing } from "@countylens/contract";
import type { Row } from "@countylens/query-core";
import { PermitRowsError } from "./errors";

export type StatusClass = (typeof COLUMN_ENUMS.status_class)[number];
export type ContractorResolution = (typeof COLUMN_ENUMS.contractor_resolution)[number];

export interface PermitListRow {
  readonly permit_number: string | null;
  readonly improvement_status: string | null;
  readonly status_class: StatusClass | null;
  /** YYYY-MM-DD. */
  readonly issue_date: string | null;
  /** YYYY-MM-DD; null with a `missing` entry (not_closed, source_missing, needs_review). */
  readonly final_date: string | null;
  /** YYYY-MM-DD. */
  readonly permit_close_date: string | null;
  /** Days from issue to as_of for open and stalled permits; null when finished or implausible. */
  readonly open_days: number | null;
  readonly contractor_resolution: ContractorResolution;
  /** The contractor name as printed on the permit (not verified against any registry). */
  readonly contractor_name_as_printed: string | null;
  /** A BBB search URL built from the printed name; never fetched. */
  readonly bbb_url: string | null;
  readonly cid: string;
  readonly source_url: string | null;
  /** ISO 8601 UTC (manifest `sources[].captured_at`). */
  readonly captured_at: string;
  readonly table: string;
  readonly table_cid: string;
  readonly run_id: string;
  readonly manifest_cid: string;
  readonly as_of: string;
  readonly missing: readonly Missing[];
}

/** The displayed columns whose null must be explained by a `missing` entry. */
export const NULLABLE_DISPLAYED_FIELDS = [
  "permit_number",
  "improvement_status",
  "status_class",
  "issue_date",
  "source_url",
] as const;

const schema = RoofingPermitRow.pick({
  permit_number: true,
  improvement_status: true,
  status_class: true,
  issue_date: true,
  final_date: true,
  permit_close_date: true,
  open_days: true,
  contractor_resolution: true,
  contractor_name_as_printed: true,
  bbb_url: true,
  cid: true,
  source_url: true,
  captured_at: true,
  table: true,
  table_cid: true,
  run_id: true,
  manifest_cid: true,
  as_of: true,
  missing: true,
});

/** Validates engine rows against contract/v1; throws PermitRowsError whose `detail` names the first bad row and field. */
export function parsePermitRows(rows: readonly Row[]): PermitListRow[] {
  return rows.map((row, index) => {
    const parsed = schema.safeParse(row);
    if (!parsed.success) {
      throw new PermitRowsError(
        `Permit row ${index} does not match contract/v1 v_roofing_permit: ${parsed.error.message}`,
      );
    }
    const permit = parsed.data as unknown as PermitListRow;
    for (const field of NULLABLE_DISPLAYED_FIELDS) {
      if (permit[field] === null && !permit.missing.some((m) => m.field === field)) {
        throw new PermitRowsError(
          `Permit row ${index} (${permit.cid}): ${field} is null without a missing reason`,
        );
      }
    }
    return permit;
  });
}
