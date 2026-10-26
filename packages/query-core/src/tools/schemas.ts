// T013 (A-14, data-model.md, agent-design.md § 2): the six tool input schemas, shared by the
// agent, the MCP server and (in a later story) the explore router, plus the common RunRef /
// AreaInput / ResultEnvelope / EmptyReason shapes. Every object schema is `.strict()` (P0-13): an
// unknown key is a Zod error, not a silently-dropped argument. No string field here accepts
// free-form text that reaches SQL unparameterised: `permit_number` is a closed regex matching the
// printed format exactly, `request_identifier` is digits only, and every other string filter is
// an enum or the gazetteer's own query string (resolved through `gazetteer.lookup`, never
// concatenated into SQL). `AreaInput`'s lat/lon bounds are the global range on purpose (AC-11): a
// point outside Travis County is a valid *input*, resolved to `out_of_scope` by the function, not
// rejected here as a validation error.
import { z } from "zod";
import { CidV1 } from "@countylens/contract";

export const RunRef = z.object({ manifest_cid: CidV1.optional() }).strict();
export type RunRef = z.infer<typeof RunRef>;

export const AreaInput = z.union([
  z.object({ place: z.string().trim().min(1).max(100) }).strict(),
  z.object({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180) }).strict(),
]);
export type AreaInput = z.infer<typeof AreaInput>;

export const EMPTY_REASONS = [
  "out_of_scope",
  "not_found",
  "no_match",
  "field_not_published",
  // A-16: the filtered field is published in the run but unknown for the rows searched.
  "field_unknown",
  "run_not_found",
] as const;
export const EmptyReason = z.enum(EMPTY_REASONS);
export type EmptyReason = z.infer<typeof EmptyReason>;

/** `searchProperties`'s `status_class` has no `closed` (a property's open-permit state); permits
 *  (`listPermits`) can also ask for closed ones. */
export const PROPERTY_STATUS_CLASSES = ["open_or_stalled", "open", "stalled"] as const;
export const PERMIT_STATUS_CLASSES = ["open_or_stalled", "open", "stalled", "closed"] as const;

const PERMIT_NUMBER = /^\d{4}-\d{6} [A-Z]{2}$/;
const REQUEST_IDENTIFIER = /^\d{1,10}$/;

export const SearchPropertiesInput = RunRef.extend({
  area: AreaInput,
  radius_mi: z.number().min(0.25).max(25),
  /** Whole years, roof_age_years >= this value (unknown ages are excluded, as on the Explore page, and counted in unknown_excluded). */
  roof_age_years_min: z.number().int().min(0).max(120).optional(),
  /** Owner tenure STRICTLY MORE than this many whole years (tenure_years > N, as Explore's "Tenure > years"); unknown tenures are excluded and counted in unknown_excluded. */
  tenure_years_min: z.number().int().min(1).max(100).optional(),
  owner_is_out_of_area: z.literal(true).optional(),
  status_class: z.enum(PROPERTY_STATUS_CLASSES).optional(),
  /** Needs status_class; filters to properties with such a permit open at least this many years. */
  open_years_min: z.number().min(0).max(60).optional(),
  sort: z.enum(["nearest", "open_desc", "roof_desc"]).default("nearest"),
  limit: z.number().int().min(1).max(1000).default(50),
}).strict();
export type SearchPropertiesInput = z.infer<typeof SearchPropertiesInput>;

export const ListPermitsInput = RunRef.extend({
  /** Omitted = county-wide (AC-10). */
  area: AreaInput.optional(),
  radius_mi: z.number().min(0.25).max(25).optional(),
  permit_number: z.string().trim().regex(PERMIT_NUMBER).optional(),
  status_class: z.enum(PERMIT_STATUS_CLASSES).optional(),
  open_years_min: z.number().min(0).max(60).optional(),
  sort: z.enum(["open_desc", "nearest", "issue_desc"]).default("open_desc"),
  limit: z.number().int().min(1).max(1000).default(50),
})
  .strict()
  .refine((v) => v.area === undefined || v.radius_mi !== undefined, {
    message: "radius_mi is required when area is given",
    path: ["radius_mi"],
  });
export type ListPermitsInput = z.infer<typeof ListPermitsInput>;

export const GetPropertyInput = RunRef.extend({
  property_cid: CidV1.optional(),
  /** TCAD pID exactly as printed (P0-5). */
  request_identifier: z.string().trim().regex(REQUEST_IDENTIFIER).optional(),
})
  .strict()
  .refine((v) => (v.property_cid !== undefined) !== (v.request_identifier !== undefined), {
    message: "exactly one of property_cid or request_identifier is required",
    path: ["property_cid"],
  });
export type GetPropertyInput = z.infer<typeof GetPropertyInput>;

export const GetCoverageInput = RunRef;
export type GetCoverageInput = z.infer<typeof GetCoverageInput>;

export const ListRunsInput = z
  .object({ limit: z.number().int().min(1).max(100).default(20) })
  .strict();
export type ListRunsInput = z.infer<typeof ListRunsInput>;

export const SCHEMA_VIEWS = ["v_property", "v_roofing_permit", "v_contractor", "v_run"] as const;
export const GetSchemaInput = z.object({ view: z.enum(SCHEMA_VIEWS).optional() }).strict();
export type GetSchemaInput = z.infer<typeof GetSchemaInput>;

export interface SourceStamp {
  url: string;
  file_date: string;
  sha256: string;
}

export interface AreaEcho {
  label: string;
  point: { lat: number; lon: number };
  kind: "place" | "zcta" | "point";
  id?: string;
  partial_in_travis: boolean;
  source: SourceStamp;
  gazetteer: { version: string; sha256: string };
}

export interface RunEcho {
  run_id: string;
  manifest_cid: string;
  as_of: string;
}

/** Shared by every query-core tool function (data-model.md § ResultEnvelope). Not a Zod schema:
 *  `Row` varies per function, and every field here is server-built, never user input. */
export interface ResultEnvelope<Row> {
  rows: Row[];
  /** rows.length. */
  returned: number;
  /** The true count from the summary/count statement, never rows.length. */
  total: number;
  /** total > returned. */
  truncated: boolean;
  /** Non-null iff returned === 0. */
  empty_reason: EmptyReason | null;
  /** What the answer could not test, never "none found". Keys:
   *  - a property filter field (roof_age_years, tenure_years, owner_is_out_of_area; search_properties):
   *    the in-radius rows with that field unknown, counted REGARDLESS of the other filters, so it is an
   *    upper bound of what the filter hid, not the number lost to it alone.
   *  - `property_link` (list_permits, area search only): roofing permits in the run, within the permit
   *    filters that do not depend on the property (status_class, open_years_min), with NO matching
   *    property row, so they cannot be placed in the radius at all.
   *  - `coordinates` (list_permits, area search only): permits whose matching property has a null
   *    latitude or longitude, so they could not be tested against the radius.
   *  The two list_permits keys are present only when their count is above zero. */
  unknown_excluded: Record<string, number>;
  area?: AreaEcho;
  run: RunEcho;
  /** The exact thresholds after defaults, for the "How I read this" chips. */
  applied: Record<string, unknown>;
}
