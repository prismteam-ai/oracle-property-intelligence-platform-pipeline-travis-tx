// Provenance on every view row (mew § B.1, data-model.md § Provenance).
import { z } from "zod";
import { CidV1, IsoDateTime } from "./cid.js";

/** Closed list (mew B.7 plus oracle's zip_not_zcta, D-4c; enum_lacks_value, owner_unparsed and
 *  owner_confidential added by D-9). Adding is additive; renaming needs v2. */
export const MISSING_REASONS = [
  "no_lexicon_carrier",
  "not_in_export",
  "source_missing",
  "no_coordinates",
  "no_roof_date",
  "basis_unmatched",
  "no_dated_sale",
  "no_owner_record",
  "no_mailing_address",
  "zip_not_zcta",
  "not_open",
  "not_closed",
  "contractor_unresolved",
  "bbb_blocked",
  "bbb_not_found",
  "needs_review",
  "first_run",
  "out_of_scope",
  /** The lexicon carrier exists but its enum has no value for the source word (e.g. Expired). */
  "enum_lacks_value",
  /** A dated sale exists but no owner name could be parsed into a person or company. */
  "owner_unparsed",
  /** The owner is withheld because a TCAD confidentiality flag is set (P0-15). */
  "owner_confidential",
  /** A permit with no City status and no completion date whose property has a later finished
   *  roofing permit: classed closed, superseded by that permit (PO 2026-10-26). */
  "superseded_by_later_permit",
] as const;

export const MissingReason = z.enum(MISSING_REASONS);
export type MissingReason = z.infer<typeof MissingReason>;

export const Missing = z.object({ field: z.string().min(1), reason: MissingReason }).strict();
export type Missing = z.infer<typeof Missing>;

export const Provenance = z
  .object({
    cid: CidV1,
    /** From the record's source_http_request; null only with a `not_in_export` entry. */
    source_url: z.string().min(1).nullable(),
    /** From manifest sources[].captured_at (no per-row carrier). */
    captured_at: IsoDateTime,
    table: z.string().min(1),
    table_cid: CidV1,
    run_id: z.string().min(1),
    manifest_cid: CidV1,
    /** Manifest finishedAt, never now(). */
    as_of: IsoDateTime,
    missing: z.array(Missing),
  })
  .strict();
export type Provenance = z.infer<typeof Provenance>;
