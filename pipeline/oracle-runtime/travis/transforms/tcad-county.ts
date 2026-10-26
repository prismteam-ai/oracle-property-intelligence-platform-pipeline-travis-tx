// T048: the County data group for one TCAD property (build-county-transform custom-code
// mode, reference/output-contract.md). Writes `<pID>/data/`:
//   seed files + property.json (shared-seed.ts, byte-identical with the PI group)
//   geometry.json        ← TCAD `geometry` point        (property_has_parcel → parcel_has_geometry)
//   structure.json       ← roof_date only from a TCAD-sourced estimator anchor (the built year);
//                          a permit-anchored roof date is never written here (oracle F1): it is
//                          derived in the view from the published Austin permit rows
//                          (Roofing + Replacement, closed → completion_date / permit_close_date)
//   sales_history_N.json ← dated transfers, oldest first, one per day (ownership_transfer_date
//                          only): sales[] with a saleDt plus the allow-listed transfer deeds in
//                          deeds[] (tcad/tenure.ts transferEventsOf, ADR 0003). A deed row says
//                          so in source_http_request.multiValueQueryString.transfer_source.
//   person_N / company_N + mailing_address_N ← current owners[]; each is linked to the property
//                          (person_has_property / company_has_property) and, when the property has
//                          a dated sale, to the latest one. Names are read by owner-name.ts (A-11)
//   <County schema CID>.json
// Rules: every entity carries source_http_request (the bulk export GET, no headers) and
// request_identifier (pID as printed); relationships are only {from, to} relative links;
// nothing unlinked is written. Confidential owners (P0-15, oracle R14, oracle F2): when any
// owner or sale carries a confidentialCode, any sale has a truthy/non-zero confidentialSale
// (PO decision: a sale-level flag hides the whole owner), or the record carries any other
// confid* key the transform does not model (fail closed), no owner name and no mailing
// address is written; the suppression and its basis are counted for the manifest. Sale
// prices are never written (Texas is a non-disclosure state and the pilot publishes no price).
import {
  TCAD_EXPORT_REQUEST,
  buildSharedFiles,
  jsonFile,
  link,
  pidOf,
  pointOf,
  type SeedRow,
  type TcadRecord,
} from "./shared-seed.js";
import type { DataGroupCids } from "./lexicon-manifest.js";
import {
  ownerPersonsMode,
  parseOwner,
  type OwnerPersonsMode,
  type ParsedPerson,
} from "./owner-name.js";
import { transferEventsOf } from "../tcad/tenure.js";

export { ENTITY_NAME, PERSON_NAME } from "./owner-name.js";

/** structure properties the lexicon lists as non-optional; written null (no TCAD source in A-02). */
const STRUCTURE_NULL_FIELDS = [
  "architectural_style_type",
  "attachment_type",
  "ceiling_condition",
  "ceiling_height_average",
  "ceiling_insulation_type",
  "ceiling_structure_material",
  "ceiling_surface_material",
  "exterior_door_material",
  "exterior_wall_condition",
  "exterior_wall_insulation_type",
  "exterior_wall_material_primary",
  "exterior_wall_material_secondary",
  "flooring_condition",
  "flooring_material_primary",
  "flooring_material_secondary",
  "foundation_condition",
  "foundation_material",
  "foundation_type",
  "foundation_waterproofing",
  "gutters_condition",
  "gutters_material",
  "interior_door_material",
  "interior_wall_condition",
  "interior_wall_finish_primary",
  "interior_wall_finish_secondary",
  "interior_wall_structure_material",
  "interior_wall_surface_material_primary",
  "interior_wall_surface_material_secondary",
  "primary_framing_material",
  "roof_age_years",
  "roof_condition",
  "roof_covering_material",
  "roof_design_type",
  "roof_material_type",
  "roof_structure_material",
  "roof_underlayment_type",
  "secondary_framing_material",
  "structural_damage_indicators",
  "subfloor_material",
  "window_frame_material",
  "window_glazing_type",
  "window_operation_type",
  "window_screen_material",
] as const;

export interface RoofAgeEntry {
  pID: string;
  roof_date: string | null;
  /** The estimator anchor type; only property_built_year (a TCAD field) is written. */
  anchor: "property_built_year" | "permit_terminal_date" | null;
}

/** The confid* keys the transform reads; any other one fails closed. */
const MODELED_CONFIDENTIAL = new Set([
  "owners[].confidentialCode",
  "sales[].confidentialCode",
  "sales[].confidentialSale",
]);

/** Every key matching /^confid/i anywhere in the record, as a path with [] for array items. */
function confidentialKeys(value: unknown, path = ""): string[] {
  if (Array.isArray(value)) return value.flatMap((v) => confidentialKeys(v, `${path}[]`));
  if (value === null || typeof value !== "object") return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) => {
    const p = path === "" ? k : `${path}.${k}`;
    return [...(/^confid/i.test(k) ? [p] : []), ...confidentialKeys(v, p)];
  });
}

/** A confidentialSale flag is set unless it is absent, null, false, 0, "0" or blank. */
function flagSet(v: unknown): boolean {
  if (v === undefined || v === null || v === false || v === 0) return false;
  if (typeof v === "string") return v.trim() !== "" && v.trim() !== "0";
  return true;
}

export interface CountyTransformInput {
  record: TcadRecord;
  seed: SeedRow;
  cids: DataGroupCids;
  /** The property's row from the roof-age ledger (kit estimator), or null. */
  roofAge: RoofAgeEntry | null;
  /**
   * A-04: the year built by the recorded rule (travis/tcad/year-built.ts); when absent the
   * A-02 reading of propertyProfile[0].imprvActualYearBuilt is kept.
   */
  yearBuilt?: number | null;
  /**
   * The run's as_of date (YYYY-MM-DD): no sale or deed after it is written as a transfer.
   * Absent means no upper bound (unit tests of the shape only).
   */
  asOf?: string;
  /**
   * A-11 Run 3 (ADR 0004): the GET that returned the point when it did NOT come from the TCAD
   * export (the City of Austin address-point record). Stamped on geometry.json only; every other
   * entity keeps the TCAD export request.
   */
  geometrySourceUrl?: string | null;
  /**
   * Whether individuals' names are written (ERR-69; PO decision pending). Default: the
   * OWNER_PERSONS environment variable, itself defaulting to "publish". "omit" writes no person
   * and no person mailing address; the property then reads as owner_confidential (withheld).
   */
  ownerPersons?: OwnerPersonsMode;
}

export type OwnerOutcome =
  "person" | "company" | "mixed" | "unparsed" | "suppressed" | "no_dated_sale" | "none";

export interface CountyTransformCounts {
  owner: OwnerOutcome;
  confidential: boolean;
  confidential_basis: string[];
  /** Dated transfers written as sales_history rows (sales plus deeds). */
  sales_dated: number;
  /** Of sales_dated, the rows taken from a transfer deed (no sale on that day). */
  transfers_from_deeds: number;
  owners_unparsed: number;
  /** Owner entries whose second named party could not be read with certainty (first one kept). */
  owners_co_owner_skipped: number;
  persons_written: number;
  /** Individuals left out because ownerPersons is "omit". */
  persons_omitted: number;
  companies_written: number;
  /** Mailing addresses written in the `unnormalized_address` form (a component broke a pattern). */
  mailing_address_fallback: number;
  warnings: string[];
}

export interface CountyTransformOutput {
  pID: string;
  /** Directory relative to the group dir. */
  dir: string;
  files: Record<string, string>;
  counts: CountyTransformCounts;
}

const nonEmpty = (v: string | null | undefined): boolean =>
  typeof v === "string" && v.trim() !== "";

type Owner = TcadRecord["owners"][number];

// Lexicon `address` constraints for a mailing address (schema oneOf: structured | unnormalized):
//   city_name ^[A-Z\s\-']+$ · state_code ^[A-Z]{2}$ · postal_code ^\d{5}$ ·
//   plus_four_postal_code ^\d{4}$ · country_code any non-empty string · every field is
//   string|null with minLength 1; the structured form requires the street_*, unit, route,
//   township, range, section and block keys (null allowed); the unnormalized form requires
//   `unnormalized_address` and takes no street_* key.
const CITY_PATTERN = /^[A-Z\s\-']+$/;
const STATE_PATTERN = /^[A-Z]{2}$/;
const ZIP_PATTERN = /^(\d{5})(?:-?(\d{4}))?$/;

/** Upper-cased, accent-folded, trimmed, whitespace-collapsed (a deterministic city form). */
export function normalizeCity(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u2018\u2019\u02bc]/g, "'")
    .replace(/\./g, " ")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

const printed = (v: unknown): string =>
  typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "";

/**
 * The owner's mailing address. Each component is normalised first; when every component then
 * satisfies the lexicon, the structured form is written (unchanged for clean addresses).
 * When any component still violates its pattern, the address is written in the lexicon's
 * `unnormalized_address` form from the components as printed, so nothing is dropped or invented.
 */
function mailingAddress(
  owner: Owner,
  base: Record<string, unknown>,
): { address: Record<string, unknown>; fallback: boolean } | null {
  const rawCity = printed(owner.addrCity);
  const rawState = printed(owner.addrState);
  const rawZip = printed(owner.addrZip);
  if (rawCity === "" && rawState === "" && rawZip === "") return null;
  const city = rawCity === "" ? null : normalizeCity(rawCity);
  const state = rawState === "" ? null : rawState.toUpperCase();
  const zip = rawZip === "" ? null : ZIP_PATTERN.exec(rawZip);
  const country = printed(owner.addrCountry).toUpperCase();
  const valid =
    (city === null || CITY_PATTERN.test(city)) &&
    (state === null || STATE_PATTERN.test(state)) &&
    (rawZip === "" || zip !== null);
  if (!valid) {
    const unit = (owner as Record<string, unknown>).addrUnitDesignator;
    const text = [owner.addrDeliveryLine, unit, rawCity, rawState, rawZip, owner.addrCountry]
      .map(printed)
      .filter((part) => part !== "")
      .join(", ");
    return { address: { ...base, unnormalized_address: text }, fallback: true };
  }
  return {
    fallback: false,
    address: {
      ...base,
      street_number: null,
      street_pre_directional_text: null,
      street_name: null,
      street_suffix_type: null,
      street_post_directional_text: null,
      unit_identifier: null,
      city_name: city,
      state_code: state,
      postal_code: zip ? (zip[1] as string) : null,
      plus_four_postal_code: zip?.[2] ?? null,
      country_code: country === "" ? null : country,
      route_number: null,
      block: null,
      lot: null,
      section: null,
      township: null,
      range: null,
    },
  };
}

export function transformTcadCounty(input: CountyTransformInput): CountyTransformOutput {
  const { record } = input;
  const pID = pidOf(record);
  if (input.roofAge && input.roofAge.pID !== pID) {
    throw new Error(`roof-age ledger row ${input.roofAge.pID} is not property ${pID}`);
  }
  const base = { source_http_request: { ...TCAD_EXPORT_REQUEST }, request_identifier: pID };
  const files: Record<string, string> = {
    ...buildSharedFiles({
      record,
      seed: input.seed,
      seedCid: input.cids.seed,
      ...(input.yearBuilt !== undefined ? { yearBuilt: input.yearBuilt } : {}),
    }),
  };
  const rel: Record<string, { "/": string } | { "/": string }[]> = {};
  const many = (key: string, name: string): void => {
    const list = (rel[key] as { "/": string }[] | undefined) ?? [];
    list.push(link(name));
    rel[key] = list;
  };
  const relationship = (name: string, from: string, to: string): string => {
    files[name] = jsonFile({ from: link(from), to: link(to) });
    return name;
  };

  rel.property_has_address = link(
    relationship("relationship_property_has_address.json", "property.json", "address.json"),
  );
  many(
    "property_has_parcel",
    relationship("relationship_property_has_parcel.json", "property.json", "parcel.json"),
  );

  const point = pointOf(record);
  if (point) {
    files["geometry.json"] = jsonFile({
      ...base,
      ...(input.geometrySourceUrl
        ? { source_http_request: requestOf(input.geometrySourceUrl) }
        : {}),
      latitude: point.latitude,
      longitude: point.longitude,
      polygon: null,
    });
    many(
      "parcel_has_geometry",
      relationship("relationship_parcel_has_geometry.json", "parcel.json", "geometry.json"),
    );
  }

  const structure: Record<string, unknown> = { ...base };
  for (const field of STRUCTURE_NULL_FIELDS) structure[field] = null;
  // Only a TCAD-sourced anchor carries the TCAD request; a permit date is never stamped here.
  structure.roof_date =
    input.roofAge?.anchor === "property_built_year" ? input.roofAge.roof_date : null;
  files["structure.json"] = jsonFile(structure);
  rel.property_has_structure = link(
    relationship("relationship_property_has_structure.json", "property.json", "structure.json"),
  );

  const dated = transferEventsOf(record.sales, record.deeds ?? [], input.asOf ?? null);
  const deedBase = {
    ...base,
    source_http_request: {
      ...TCAD_EXPORT_REQUEST,
      multiValueQueryString: { transfer_source: ["deed"] },
    },
  };
  dated.forEach((s, i) => {
    const name = `sales_history_${i + 1}.json`;
    files[name] = jsonFile({
      ...(s.source === "deed" ? deedBase : base),
      ownership_transfer_date: s.date,
    });
    many(
      "property_has_sales_history",
      relationship(`relationship_property_has_sales_history_${i + 1}.json`, "property.json", name),
    );
  });

  const basis: string[] = [];
  if (record.owners.some((o) => nonEmpty(o.confidentialCode)))
    basis.push("owners[].confidentialCode");
  if (record.sales.some((s) => nonEmpty(s.confidentialCode)))
    basis.push("sales[].confidentialCode");
  if (record.sales.some((s) => flagSet((s as Record<string, unknown>).confidentialSale)))
    basis.push("sales[].confidentialSale");
  for (const key of [...new Set(confidentialKeys(record))].sort())
    if (!MODELED_CONFIDENTIAL.has(key)) basis.push(`unmodeled:${key}`);
  const confidential = basis.length > 0;

  let owner: OwnerOutcome = "none";
  let unparsed = 0;
  let skippedCoOwners = 0;
  let mailingFallback = 0;
  let personsWritten = 0;
  let personsOmitted = 0;
  const personsMode = input.ownerPersons ?? ownerPersonsMode();
  let companiesWritten = 0;
  if (confidential) owner = "suppressed";
  else if (record.owners.length > 0) {
    // The owners are written either way (A-11): every one is linked to the property, and to the
    // latest dated sale too when there is one. Without a dated sale the outcome stays
    // "no_dated_sale" so the receipts keep counting properties whose owner the sales view cannot reach.
    const latest = dated.length > 0 ? `sales_history_${dated.length}.json` : null;
    const kinds = new Set<"person" | "company">();
    let persons = 0;
    let companies = 0;
    let mailings = 0;
    const personFile = (p: ParsedPerson): string => {
      persons += 1;
      const entity = `person_${persons}.json`;
      files[entity] = jsonFile({
        ...base,
        first_name: p.first_name,
        last_name: p.last_name,
        middle_name: p.middle_name,
        prefix_name: null,
        suffix_name: p.suffix_name,
        birth_date: null,
        us_citizenship_status: null,
        veteran_status: null,
      });
      if (latest !== null) {
        many(
          "sales_history_has_person",
          relationship(`relationship_sales_history_has_person_${persons}.json`, latest, entity),
        );
      }
      many(
        "person_has_property",
        relationship(`relationship_person_has_property_${persons}.json`, entity, "property.json"),
      );
      kinds.add("person");
      return entity;
    };
    for (const o of record.owners) {
      const secondary = (o as Record<string, unknown>).nameSecondary;
      const parsed = parseOwner({
        name: o.name,
        nameSecondary: typeof secondary === "string" ? secondary : null,
        firstName: o.firstName,
        lastName: o.lastName,
      });
      const entities: string[] = [];
      if (parsed.kind === "people" && personsMode === "omit") {
        personsOmitted += parsed.people.length;
        continue;
      }
      if (parsed.kind === "people") {
        for (const p of parsed.people) entities.push(personFile(p));
        if (parsed.skippedCoOwner) skippedCoOwners += 1;
      } else if (parsed.kind === "company") {
        companies += 1;
        const entity = `company_${companies}.json`;
        files[entity] = jsonFile({ ...base, name: parsed.name, sunbiz_document_number: null });
        if (latest !== null) {
          many(
            "sales_history_has_company",
            relationship(
              `relationship_sales_history_has_company_${companies}.json`,
              latest,
              entity,
            ),
          );
        }
        many(
          "company_has_property",
          relationship(
            `relationship_company_has_property_${companies}.json`,
            entity,
            "property.json",
          ),
        );
        kinds.add("company");
        entities.push(entity);
      } else {
        unparsed += 1;
        continue;
      }
      // One mailing address per owner entity (a joint entry's people share the printed address).
      const mailing = mailingAddress(o, base);
      if (mailing) {
        for (const entity of entities) {
          if (mailing.fallback) mailingFallback += 1;
          const kind = entity.startsWith("person_") ? "person" : "company";
          mailings += 1;
          const n = mailings;
          const addr = `mailing_address_${n}.json`;
          files[addr] = jsonFile(mailing.address);
          many(
            `${kind}_has_mailing_address`,
            relationship(`relationship_${kind}_has_mailing_address_${n}.json`, entity, addr),
          );
        }
      }
    }
    personsWritten = persons;
    companiesWritten = companies;
    // Nothing written: withheld by policy (persons omitted, nothing unparsed) or unparsed. The
    // view reads owners through the property edges, so a property whose owners could not be
    // written is counted for what it is whether or not it has a dated sale.
    owner =
      kinds.size === 0
        ? personsOmitted > 0 && unparsed === 0
          ? "suppressed"
          : "unparsed"
        : dated.length === 0
          ? "no_dated_sale"
          : kinds.size === 2
            ? "mixed"
            : ([...kinds][0] as "person" | "company");
  }

  const ordered = Object.fromEntries(
    Object.keys(rel)
      .sort()
      .map((k) => [k, rel[k]]),
  );
  files[`${input.cids.county}.json`] = jsonFile({ label: "County", relationships: ordered });

  const warnings: string[] = [];
  if (!point) warnings.push("no_geometry_point");
  if (!input.roofAge) warnings.push("no_roof_age_ledger_row");
  return {
    pID,
    dir: `${pID}/data`,
    files,
    counts: {
      owner,
      confidential,
      confidential_basis: basis,
      sales_dated: dated.length,
      transfers_from_deeds: dated.filter((e) => e.source === "deed").length,
      owners_unparsed: unparsed,
      owners_co_owner_skipped: skippedCoOwners,
      persons_written: personsWritten,
      persons_omitted: personsOmitted,
      companies_written: companiesWritten,
      mailing_address_fallback: mailingFallback,
      warnings,
    },
  };
}

/**
 * A GET the lexicon accepts: `url` is the bare path (its pattern forbids `?` and `&`), the query
 * parameters go in `multiValueQueryString` (elephant-cli validate rejects a query in `url`).
 */
export function requestOf(full: string): {
  method: "GET";
  url: string;
  multiValueQueryString?: Record<string, string[]>;
} {
  const u = new URL(full);
  const params: Record<string, string[]> = {};
  for (const [k, v] of u.searchParams) (params[k] ??= []).push(v);
  return {
    method: "GET",
    url: `${u.origin}${u.pathname}`,
    ...(Object.keys(params).length > 0 ? { multiValueQueryString: params } : {}),
  };
}
