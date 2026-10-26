// A-04 T022: one (already redacted) TCAD export record → its Query DB rows (data-model.md
// § 0101): `parcels`, `parcel_geoids` and `property_structures`. Key = String(pID) exactly as
// printed (P0-5); geoID kept as a string with its leading zeros. Columns carry the frozen
// v_property names where one exists, so the Query DB and v_property counts compare 1:1.
// The stored payload is `payload_redacted`: a slim projection of the redacted record (no
// owner names on a redacted account, never a mailing street, a sale price or a party name)
// plus `record_sha256` of the original bytes (oracle disagreement #11, plan CT-3).
import { z } from "zod";
import { GAZETTEER_SHA256 } from "../../../../packages/query-core/src/sql.generated.js";
import {
  PROPERTY_TYPE_RULES_VERSION,
  TCAD_EXPORT_REQUEST,
  propertyTypeFor,
  type PropertyTypeRule,
} from "../transforms/shared-seed.js";
import { ENTITY_NAME } from "../transforms/tcad-county.js";
import { countyEmit, isPropType, type PropType } from "./account-class.js";
import { exportPointKind, parseExportPoint, type ExportPointKind } from "./export-point.js";
import { ownerAreaOf, type OwnerAreaFields } from "./owner-area.js";
import { OWNER_REDACTION_RULE, slimValuations, type Redaction } from "./redact.js";
import { tenureOf, type TenureFields } from "./tenure.js";
import { improvementsOf, yearBuiltOf, type YearBuiltFields } from "./year-built.js";

export class InvalidRecordError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidRecordError";
  }
}

export interface MapContext {
  jobId: string;
  /** Run as-of date (finishedAt), never now() inside a derivation. */
  asOf: string;
  exportSha256: string;
  /** captured_at of the export receipt (A-01). */
  capturedAt: string;
  ordinal: number;
  /** SHA-256 of the record's original bytes. */
  recordSha256: string;
}

export interface SitusAddress {
  text: string | null;
  street_number: string | null;
  street_prefix: string | null;
  street_name: string | null;
  street_suffix: string | null;
  street_secondary: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
}

export type OwnerKind = "person" | "company" | "mixed" | "unparsed";
export type OwnerMissingReason =
  "owner_confidential" | "no_dated_sale" | "no_owner_record" | "owner_unparsed";

export interface ParcelRow extends OwnerAreaFields, TenureFields, YearBuiltFields {
  request_identifier: string;
  job_id: string;
  geo_id: string | null;
  prop_type: PropType;
  state_cd: string | null;
  property_type: string | null;
  property_usage_type: string | null;
  property_type_missing_reason: "enum_lacks_value" | null;
  property_type_rule: PropertyTypeRule | null;
  property_type_note: string | null;
  /** Version of the property_type rule set that chose property_type (shared-seed.ts). */
  property_type_rules_version: string;
  situs_address: SitusAddress | null;
  owner_name: string | null;
  owner_kind: OwnerKind | null;
  owner_missing_reason: OwnerMissingReason | null;
  owner_redacted: boolean;
  owner_redaction_rule: typeof OWNER_REDACTION_RULE | null;
  owner_mailing_postal_code: string | null;
  owner_mailing_country: string | null;
  export_point_lat: number | null;
  export_point_lon: number | null;
  export_point_kind: ExportPointKind;
  county_emit: boolean;
  source_url: string;
  captured_at: string;
  export_sha256: string;
  record_ordinal: number;
  record_sha256: string;
  payload_redacted: Record<string, unknown>;
}

export interface GeoIdRow {
  geo_id: string;
  request_identifier: string;
  prop_type: PropType;
}

export interface StructureRow {
  request_identifier: string;
  ordinal: number;
  imprv_type: string | null;
  is_main_residential: boolean;
  living_area: number | null;
  actual_year_built: number | null;
  effective_year_built: number | null;
}

export interface MappedRecord {
  parcel: ParcelRow;
  geoids: GeoIdRow[];
  structures: StructureRow[];
}

/** The fields mapping needs; anything else in the record is left alone (strict keys: key-inventory.ts). */
const Shape = z
  .object({
    pID: z.union([z.number().int().positive(), z.string().regex(/^[1-9][0-9]*$/)]),
    propType: z.string(),
    geometry: z.string().nullable().optional(),
    propertyIdentification: z
      .array(z.object({ geoID: z.string().nullable().optional() }).loose())
      .nullable()
      .optional(),
    propertyProfile: z
      .array(z.object({ stateCd: z.string().nullable().optional() }).loose())
      .nullable()
      .optional(),
    situses: z.array(z.record(z.string(), z.unknown())).nullable().optional(),
    owners: z.array(z.record(z.string(), z.unknown())).nullable().optional(),
    sales: z.array(z.record(z.string(), z.unknown())).nullable().optional(),
    deeds: z.array(z.record(z.string(), z.unknown())).nullable().optional(),
  })
  .loose();

const text = (v: unknown): string | null => {
  if (typeof v !== "string" && typeof v !== "number") return null;
  const t = String(v).trim();
  return t === "" ? null : t;
};

function situsOf(situses: ReadonlyArray<Record<string, unknown>>): SitusAddress | null {
  const s = situses.find((x) => x.primarySitus === 1 || x.primarySitus === true) ?? situses[0];
  if (s === undefined) return null;
  const part = {
    street_number: text(s.streetNum),
    street_prefix: text(s.streetPrefix),
    street_name: text(s.streetName),
    street_suffix: text(s.streetSuffix),
    street_secondary: text(s.streetSecondary),
    city: text(s.city),
    state: text(s.state),
    zip: text(s.zip),
  };
  const street = [
    part.street_number,
    part.street_prefix,
    part.street_name,
    part.street_suffix,
    part.street_secondary,
  ]
    .filter((x) => x !== null)
    .join(" ");
  const stateZip = [part.state, part.zip].filter((x) => x !== null).join(" ");
  const line = [street, part.city ?? "", stateZip].filter((x) => x !== "").join(", ");
  return { text: street === "" ? null : line, ...part };
}

function ownerKindOf(owner: Record<string, unknown>): "person" | "company" | null {
  if (text(owner.firstName) !== null && text(owner.lastName) !== null) return "person";
  const name = text(owner.name);
  if (name !== null && ENTITY_NAME.test(name)) return "company";
  return null;
}

/** Owner columns. A redacted account reads only its reason; nothing is copied from owners[]. */
function ownerColumns(owners: ReadonlyArray<Record<string, unknown>>, redacted: boolean) {
  if (redacted) {
    return {
      owner_name: null,
      owner_kind: null,
      owner_missing_reason: "owner_confidential" as const,
      owner_mailing_postal_code: null,
      owner_mailing_country: null,
    };
  }
  const names = owners.map((o) => text(o.name)).filter((n): n is string => n !== null);
  const kinds = new Set(owners.map(ownerKindOf).filter((k) => k !== null));
  const first = owners[0];
  const kind: OwnerKind | null =
    owners.length === 0
      ? null
      : kinds.size === 0
        ? "unparsed"
        : kinds.size === 2
          ? "mixed"
          : ([...kinds][0] as OwnerKind);
  return {
    owner_name: names.length === 0 ? null : names.join("; "),
    owner_kind: kind,
    owner_missing_reason:
      names.length > 0
        ? null
        : owners.length === 0
          ? ("no_owner_record" as const)
          : ("owner_unparsed" as const),
    owner_mailing_postal_code: first === undefined ? null : text(first.addrZip),
    owner_mailing_country: first === undefined ? null : text(first.addrCountry),
  };
}

const SITUS_KEEP = [
  "primarySitus",
  "streetNum",
  "streetPrefix",
  "streetName",
  "streetSuffix",
  "streetSecondary",
  "city",
  "state",
  "zip",
];
const OWNER_KEEP = [
  "name",
  "firstName",
  "lastName",
  "ownerPct",
  "addrCity",
  "addrState",
  "addrZip",
  "addrCountry",
  "addrInternational",
];
const SALE_KEEP = [
  "saleID",
  "deedID",
  "saleDt",
  "saleType",
  "confidentialCode",
  "confidentialSale",
];

const pick = (o: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> =>
  Object.fromEntries(keys.filter((k) => k in o).map((k) => [k, o[k]]));

/**
 * The slim stored payload: the source fields the mapping and the shared files read
 * (shared-seed.ts `buildSharedFiles`: legal description, improvement count), never a mailing
 * street, a price or a party. `propertyLegalDescription` keeps only `legalDescription` (the
 * lot/block text, no owner); `valuations` is redact.ts's `slimValuations` (improvement
 * identifiers, types, state codes, years and floor areas; no value or price).
 */
export function slimPayload(
  record: Record<string, unknown>,
  redacted: boolean,
): Record<string, unknown> {
  const arr = (v: unknown): Record<string, unknown>[] =>
    Array.isArray(v)
      ? v.filter((x): x is Record<string, unknown> => typeof x === "object" && x !== null)
      : [];
  return {
    pID: record.pID,
    propType: record.propType,
    geometry: record.geometry ?? null,
    propertyIdentification: arr(record.propertyIdentification).map((p) => pick(p, ["geoID"])),
    propertyLegalDescription: arr(record.propertyLegalDescription).map((p) =>
      pick(p, ["legalDescription"]),
    ),
    propertyProfile: arr(record.propertyProfile)
      .slice(0, 1)
      .map((p) => pick(p, ["stateCd", "imprvActualYearBuilt"])),
    situses: arr(record.situses).map((s) => pick(s, SITUS_KEEP)),
    owners: redacted ? [] : arr(record.owners).map((o) => pick(o, OWNER_KEEP)),
    sales: arr(record.sales).map((s) => pick(s, SALE_KEEP)),
    valuations: slimValuations(record.valuations),
  };
}

export function mapParcel(redaction: Redaction, ctx: MapContext): MappedRecord {
  const parsed = Shape.safeParse(redaction.record);
  if (!parsed.success) {
    throw new InvalidRecordError(
      `record ${ctx.ordinal}: ${parsed.error.issues[0]?.path.join(".") ?? ""} ${parsed.error.issues[0]?.message ?? ""}`,
    );
  }
  const r = parsed.data;
  if (!isPropType(r.propType))
    throw new InvalidRecordError(
      `record ${ctx.ordinal}: propType ${r.propType} is not R, P, MH or MN`,
    );
  const pID = String(r.pID);
  const geoIds = [
    ...new Set(
      (r.propertyIdentification ?? [])
        .map((p) => text(p.geoID))
        .filter((g): g is string => g !== null),
    ),
  ];
  const stateCd = text(r.propertyProfile?.[0]?.stateCd);
  const owners = r.owners ?? [];
  const firstOwner = owners[0];
  const area = ownerAreaOf({
    redacted: redaction.redacted,
    addrZip: firstOwner?.addrZip,
    addrCountry: firstOwner?.addrCountry,
    addrInternational: firstOwner?.addrInternational,
  });
  const point = parseExportPoint(r.geometry);
  const improvements = improvementsOf(redaction.record);
  const type = propertyTypeFor(stateCd ?? "", {
    emitted: countyEmit(r.propType),
    improvementCount: improvements.length,
  });
  const structures = improvements.map((imp, ordinal) => ({
    request_identifier: pID,
    ordinal,
    imprv_type: imp.imprvType,
    is_main_residential: imp.isMainResidential,
    living_area: imp.livingArea,
    actual_year_built: imp.actualYearBuilt,
    effective_year_built: imp.effectiveYearBuilt,
  }));
  const parcel: ParcelRow = {
    request_identifier: pID,
    job_id: ctx.jobId,
    geo_id: geoIds[0] ?? null,
    prop_type: r.propType,
    state_cd: stateCd,
    property_type: type.property_type,
    property_usage_type: type.property_usage_type,
    property_type_missing_reason: type.missing_reason,
    property_type_rule: type.rule,
    property_type_note: type.note,
    property_type_rules_version: PROPERTY_TYPE_RULES_VERSION,
    situs_address: situsOf(r.situses ?? []),
    ...ownerColumns(owners, redaction.redacted),
    owner_redacted: redaction.redacted,
    owner_redaction_rule: redaction.redacted ? OWNER_REDACTION_RULE : null,
    ...area,
    area_list_sha256: GAZETTEER_SHA256,
    ...yearBuiltOf(redaction.record, ctx.asOf),
    ...tenureOf(r.sales ?? [], ctx.asOf, r.deeds ?? []),
    export_point_lat: point?.lat ?? null,
    export_point_lon: point?.lon ?? null,
    // `duplicate` needs the whole export; the Loader's finalize step sets it (track tcad).
    export_point_kind: exportPointKind(r.geometry),
    county_emit: countyEmit(r.propType),
    source_url: TCAD_EXPORT_REQUEST.url,
    captured_at: ctx.capturedAt,
    export_sha256: ctx.exportSha256,
    record_ordinal: ctx.ordinal,
    record_sha256: ctx.recordSha256,
    payload_redacted: slimPayload(redaction.record, redaction.redacted),
  };
  return {
    parcel,
    geoids: geoIds.map((geo_id) => ({
      geo_id,
      request_identifier: pID,
      prop_type: r.propType as PropType,
    })),
    structures,
  };
}
