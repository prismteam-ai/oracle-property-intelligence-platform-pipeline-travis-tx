// T047: the one builder for the files both data groups carry (oracle § A.2, R11): the Seed
// data group (address.json, parcel.json, address_has_parcel.json, its root) and
// property.json. The County and Property Improvement transforms both call
// buildSharedFiles(), so these files are byte-identical in both archives and `hash` derives
// the same property CID from the same seed root.
//
// TCAD fields read here (2026 certified JSON, keys as printed): pID, propType, geometry
// ("[lat, lon]"), propertyIdentification[].geoID, situses[] (primarySitus), propertyProfile[]
// (stateCd, imprvActualYearBuilt), propertyLegalDescription[].legalDescription.
import { z } from "zod";
import { improvementsOf } from "../tcad/year-built.js";

/** The bulk export GET every TCAD entity comes from (A-01 sources catalog). Headers: none. */
export const TCAD_EXPORT_REQUEST = {
  method: "GET",
  url: "https://traviscad.org/wp-content/largefiles/2026%20Certified%20JSON%20SUPP%200%2007182026.zip",
} as const;

export const COUNTY_NAME = "Travis";

const Nullable = <T extends z.ZodType>(s: T) => s.nullable().optional();

export const TcadRecord = z
  .object({
    pID: z.union([z.number().int(), z.string().min(1)]),
    propType: z.string(),
    geometry: Nullable(z.string()),
    propertyIdentification: z.array(z.object({ geoID: z.string().nullable() }).loose()).default([]),
    propertyLegalDescription: z
      .array(z.object({ legalDescription: Nullable(z.string()) }).loose())
      .default([]),
    propertyProfile: z
      .array(
        z
          .object({ stateCd: Nullable(z.string()), imprvActualYearBuilt: Nullable(z.number()) })
          .loose(),
      )
      .default([]),
    situses: z
      .array(
        z
          .object({
            primarySitus: Nullable(z.number()),
            streetNum: Nullable(z.string()),
            streetPrefix: Nullable(z.string()),
            streetName: Nullable(z.string()),
            streetSuffix: Nullable(z.string()),
            streetSecondary: Nullable(z.string()),
            city: Nullable(z.string()),
            state: Nullable(z.string()),
            zip: Nullable(z.string()),
          })
          .loose(),
      )
      .default([]),
    owners: z
      .array(
        z
          .object({
            name: Nullable(z.string()),
            firstName: Nullable(z.string()),
            lastName: Nullable(z.string()),
            addrDeliveryLine: Nullable(z.string()),
            addrCity: Nullable(z.string()),
            addrZip: Nullable(z.string()),
            addrState: Nullable(z.string()),
            addrCountry: Nullable(z.string()),
            confidentialCode: Nullable(z.string()),
          })
          .loose(),
      )
      .default([]),
    sales: z
      .array(
        z
          .object({
            saleID: Nullable(z.number()),
            saleDt: Nullable(z.string()),
            confidentialCode: Nullable(z.string()),
          })
          .loose(),
      )
      .default([]),
    // A-11 ERR-71: the dated transfer deeds (deedType, deedDt) feed sales_history with sales[].
    deeds: z.array(z.record(z.string(), z.unknown())).nullable().optional(),
  })
  .loose();
export type TcadRecord = z.infer<typeof TcadRecord>;

export function parseTcadRecord(value: unknown): TcadRecord {
  return TcadRecord.parse(value);
}

/** pID exactly as printed (P0-5). */
export function pidOf(record: TcadRecord): string {
  return String(record.pID);
}

/** The `[lat, lon]` point TCAD prints, or null. */
export function pointOf(record: TcadRecord): { latitude: number; longitude: number } | null {
  if (!record.geometry) return null;
  const m = /^\[\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\]$/.exec(record.geometry.trim());
  if (!m) return null;
  const latitude = Number(m[1]);
  const longitude = Number(m[2]);
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return { latitude, longitude };
}

/** The primary situs as printed: "<num> <prefix> <name> <suffix> <secondary>, <city>, TX <zip>". */
export function situsOf(record: TcadRecord): string | null {
  const s = record.situses.find((x) => x.primarySitus === 1) ?? record.situses[0];
  if (!s) return null;
  const street = [s.streetNum, s.streetPrefix, s.streetName, s.streetSuffix, s.streetSecondary]
    .map((p) => (p ?? "").trim())
    .filter((p) => p !== "")
    .join(" ");
  const stateZip = [s.state, s.zip]
    .map((p) => (p ?? "").trim())
    .filter((p) => p !== "")
    .join(" ");
  const parts = [street, (s.city ?? "").trim(), stateZip].filter((p) => p !== "");
  return street === "" ? null : parts.join(", ");
}

/** Where every STATE_CODES entry comes from (no official table cited yet). */
export const A02_PILOT_MAPPING =
  "A-02 pilot mapping (shared-seed.ts), no official code table cited";

/**
 * TCAD state codes (propertyProfile[].stateCd) → lexicon property_type / property_usage_type.
 * A-04 (oracle disagreement #8): this map is the A-02 pilot mapping, kept unchanged, and is
 * extended only with a cited official PTD/TCAD code table. None is on disk: the TCAD Export
 * Layout (Legacy 8.0.33) names the code file APPRAISAL_STATE_CODE.TXT but it is not part of
 * the JSON export, so no code is added. A4 is NOT read as a condominium here (DEC-A-01's
 * condo reading is unverified; the coordinate condo rule uses the shared geoID instead). Any
 * other code → property_type null with reason `enum_lacks_value`.
 */
export const STATE_CODES: Readonly<
  Record<string, { property_type: string; property_usage_type: string | null; source: string }>
> = Object.freeze(
  Object.fromEntries(
    (
      [
        ["A1", "SingleFamily", "Residential"],
        ["A2", "MobileHome", "Residential"],
        ["A3", "Condominium", "Residential"],
        ["A4", "Townhouse", "Residential"],
        ["B1", "MultipleFamily", "Residential"],
        ["B2", "Duplex", "Residential"],
        ["B3", "3Units", "Residential"],
        ["B4", "4Units", "Residential"],
        ["C1", "VacantLand", null],
        ["F1", "Building", "Commercial"],
        ["F2", "Building", "Industrial"],
      ] as const
    ).map(([code, property_type, property_usage_type]) => [
      code,
      { property_type, property_usage_type, source: A02_PILOT_MAPPING },
    ]),
  ),
);

/** The mapped type of a state code, or null + enum_lacks_value. */
export function propertyTypeOf(code: string): {
  property_type: string | null;
  property_usage_type: string | null;
  missing_reason: "enum_lacks_value" | null;
} {
  const m = STATE_CODES[code.trim()];
  return m
    ? {
        property_type: m.property_type,
        property_usage_type: m.property_usage_type,
        missing_reason: null,
      }
    : { property_type: null, property_usage_type: null, missing_reason: "enum_lacks_value" };
}

export type PropertyTypeRule = "state_code_table" | "improvement_fallback";

/**
 * Version of the property_type rule set (STATE_CODES + the fallback below). Stored on every
 * parcels row (property_type_rules_version) so a published type can be tied to the rules that
 * chose it; bump it with any change to STATE_CODES or the fallback.
 */
export const PROPERTY_TYPE_RULES_VERSION = "property_type_rules@2026-10-22";

/**
 * The two lexicon property_type values the fallback may use. `Building` when the record prints
 * an improvement. `LandParcel` (neutral, in the live property_type enum, not deprecated) when
 * it prints none: it claims no vacancy (roofing permits sit on parcels the roll shows without
 * an improvement) and no residential or condominium use.
 */
export const FALLBACK_WITH_IMPROVEMENT = "Building";
export const FALLBACK_WITHOUT_IMPROVEMENT = "LandParcel";

export interface PropertyTypeChoice {
  property_type: string | null;
  property_usage_type: string | null;
  missing_reason: "enum_lacks_value" | null;
  rule: PropertyTypeRule | null;
  note: string | null;
}

/**
 * The property_type of one account (A-04 pilot fix). The lexicon requires a string for every
 * emitted property (county_emit = R). Order: (a) STATE_CODES (rule state_code_table); (b) for
 * an emitted account whose code has no table entry, a generic fallback from the record's own
 * facts only: `Building` when it prints at least one improvement, else `LandParcel`
 * (rule improvement_fallback, note says which code and which fact). The fallback never asserts
 * a residential or condominium type and sets no property_usage_type. A non-emitted account
 * (P, MH, MN) with an unmapped code stays null + enum_lacks_value. No official code table is
 * on disk (APPRAISAL_STATE_CODE.TXT is not in the JSON export), so no code was added.
 */
export function propertyTypeFor(
  code: string,
  opts: { emitted: boolean; improvementCount: number },
): PropertyTypeChoice {
  const c = code.trim();
  const m = STATE_CODES[c];
  if (m)
    return {
      property_type: m.property_type,
      property_usage_type: m.property_usage_type,
      missing_reason: null,
      rule: "state_code_table",
      note: null,
    };
  if (!opts.emitted)
    return {
      property_type: null,
      property_usage_type: null,
      missing_reason: "enum_lacks_value",
      rule: null,
      note: null,
    };
  const has = opts.improvementCount > 0;
  const shown = c === "" ? "(empty)" : c;
  return {
    property_type: has ? FALLBACK_WITH_IMPROVEMENT : FALLBACK_WITHOUT_IMPROVEMENT,
    property_usage_type: null,
    missing_reason: null,
    rule: "improvement_fallback",
    note: has
      ? `state code ${shown} has no table entry; the record prints ${opts.improvementCount} improvement(s), so the generic type ${FALLBACK_WITH_IMPROVEMENT} is used (no residential or condominium claim)`
      : `state code ${shown} has no table entry; the record prints no improvement, so the generic type ${FALLBACK_WITHOUT_IMPROVEMENT} is used`,
  };
}

export interface PropertyFields {
  parcel_identifier: string;
  property_type: string | null;
  property_usage_type: string | null;
  property_type_rule: PropertyTypeRule | null;
  property_type_note: string | null;
  property_structure_built_year: number | null;
  property_legal_description_text: string | null;
  /** Unmapped source codes (kept out of the record, reported in the findings). */
  warnings: string[];
}

/**
 * `yearBuilt` (A-04): the year from the recorded year-built rule (travis/tcad/year-built.ts);
 * when absent, the A-02 reading of propertyProfile[0].imprvActualYearBuilt is used.
 */
export function propertyFields(record: TcadRecord, yearBuilt?: number | null): PropertyFields {
  const profile = record.propertyProfile[0];
  const code = (profile?.stateCd ?? "").trim();
  const type = propertyTypeFor(code, {
    emitted: record.propType === "R",
    improvementCount: improvementsOf(record as Record<string, unknown>).length,
  });
  const warnings = STATE_CODES[code] ? [] : [`unmapped_state_code:${code || "(empty)"}`];
  const year = yearBuilt !== undefined ? yearBuilt : (profile?.imprvActualYearBuilt ?? null);
  const legal = (record.propertyLegalDescription[0]?.legalDescription ?? "").trim();
  return {
    parcel_identifier: pidOf(record),
    property_type: type.property_type,
    property_usage_type: type.property_usage_type,
    property_type_rule: type.rule,
    property_type_note: type.note,
    property_structure_built_year:
      year !== null && Number.isInteger(year) && year >= 1000 && year <= 9999 ? year : null,
    property_legal_description_text: legal === "" ? null : legal,
    warnings,
  };
}

/** One seed row per parcel (county-seed-data contract; written by travis/pilot/build-seed.ts). */
export interface SeedRow {
  parcel_id: string;
  source_identifier: string;
  situs_address: string;
  geo_id: string;
  county: string;
  latitude: string;
  longitude: string;
  method: string;
  url: string;
}

export function jsonFile(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export const link = (name: string): { "/": string } => ({ "/": `./${name}` });

export interface SharedFilesInput {
  record: TcadRecord;
  seed: SeedRow;
  /** Seed data-group schema CID from the live lexicon manifest. */
  seedCid: string;
  /** A-04: year built by the recorded rule (see propertyFields). */
  yearBuilt?: number | null;
}

/** The seed files and property.json, as file name → exact text. */
export function buildSharedFiles(input: SharedFilesInput): Record<string, string> {
  const { record, seed } = input;
  const pID = pidOf(record);
  if (seed.parcel_id !== pID) throw new Error(`seed row ${seed.parcel_id} is not TCAD pID ${pID}`);
  const request = { ...TCAD_EXPORT_REQUEST };
  const point = pointOf(record);
  const fields = propertyFields(record, input.yearBuilt);
  const property: Record<string, unknown> = {
    source_http_request: request,
    request_identifier: pID,
    parcel_identifier: fields.parcel_identifier,
    property_type: fields.property_type,
    property_structure_built_year: fields.property_structure_built_year,
    property_legal_description_text: fields.property_legal_description_text,
  };
  if (fields.property_usage_type !== null)
    property.property_usage_type = fields.property_usage_type;
  return {
    // No county_name: the live address.county_name enum has no "Travis" (optional field;
    // lexicon gap recorded in ADR-0002). The seed CSV keeps the county.
    "address.json": jsonFile({
      source_http_request: request,
      request_identifier: pID,
      unnormalized_address: seed.situs_address === "" ? null : seed.situs_address,
      latitude: point?.latitude ?? null,
      longitude: point?.longitude ?? null,
    }),
    "parcel.json": jsonFile({
      source_http_request: request,
      request_identifier: pID,
      parcel_identifier: pID,
    }),
    "address_has_parcel.json": jsonFile({ from: link("address.json"), to: link("parcel.json") }),
    [`${input.seedCid}.json`]: jsonFile({
      label: "Seed",
      relationships: { address_has_parcel: link("address_has_parcel.json") },
    }),
    "property.json": jsonFile(property),
  };
}
