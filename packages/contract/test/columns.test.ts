// T008: the frozen column lists (data-model.md § Views = mew § B.2–B.6 with the D-4 adjustments).
import { describe, expect, it } from "vitest";
import {
  ALIASES,
  COLUMN_ENUMS,
  PROVENANCE_COLUMNS,
  SAMPLE_COLUMNS,
  SAMPLE_PROPERTY_PREFIX,
  SampleRow,
  UNCARRIED,
  VIEWS,
  columnNames,
  rowSchema,
  type ViewName,
} from "../src/index.js";

const PROVENANCE = [
  "cid",
  "source_url",
  "captured_at",
  "table",
  "table_cid",
  "run_id",
  "manifest_cid",
  "as_of",
  "missing",
];

const EXPECTED: Record<ViewName, string[]> = {
  v_property: [
    "property_cid",
    "request_identifier",
    "parcel_identifier",
    "property_type",
    "property_usage_type",
    "property_structure_built_year",
    "latitude",
    "longitude",
    "coordinate_source",
    "roof_date",
    "roof_age_years",
    "roof_age_basis",
    "roof_age_confidence",
    "last_ownership_transfer_date",
    "tenure_years",
    "tenure_basis",
    "is_long_tenure",
    "owner_kind",
    "owner_name",
    "owner_area_class",
    "owner_is_out_of_area",
    "area_list_sha256",
    // v1.2 (additive, Run 3.1, ERR-74)
    "unnormalized_address",
    "owner_mailing_postal_code",
    "owner_mailing_state_code",
    ...PROVENANCE,
  ],
  v_roofing_permit: [
    "permit_cid",
    "property_cid",
    "jurisdiction",
    "permit_number",
    "request_identifier",
    "improvement_type",
    "improvement_action",
    "improvement_status",
    "status_class",
    "is_open",
    "issue_date",
    "final_date",
    "permit_close_date",
    "final_inspection_date",
    "open_days",
    "contractor_resolution",
    "contractor_company_cid",
    "contractor_name_as_printed",
    "bbb_status",
    "bbb_status_reason",
    "bbb_rating",
    "bbb_url",
    "profile_version",
    "profile_sha256",
    ...PROVENANCE,
  ],
  v_contractor: [
    "contractor_company_cid",
    "name",
    "contractor_resolution",
    "identity_source",
    "bbb_status",
    "bbb_status_reason",
    "permit_count",
    "roofing_permit_count",
    ...PROVENANCE,
  ],
  v_run: [
    "run_id",
    "county_fips",
    "started_at",
    "finished_at",
    "manifest_cid",
    "previous_manifest_cid",
    "tables_root_cids",
    "sources",
    "coverage",
    "profile_version",
    "profile_sha256",
    "area_list_sha256",
    "limitations",
    "missing",
  ],
};

describe("columns", () => {
  it("has exactly the four views", () => {
    expect(Object.keys(VIEWS).sort()).toEqual([
      "v_contractor",
      "v_property",
      "v_roofing_permit",
      "v_run",
    ]);
  });

  for (const view of Object.keys(EXPECTED) as ViewName[]) {
    it(`${view} has exactly the frozen columns, in order`, () => {
      expect(columnNames(view)).toEqual(EXPECTED[view]);
    });
  }

  it("the provenance block is mew B.1 in order", () => {
    expect(PROVENANCE_COLUMNS.map((c) => c.name)).toEqual(PROVENANCE);
  });

  it("ALIASES holds exactly issue_date and final_date (mew C.2)", () => {
    expect(ALIASES).toEqual({
      issue_date: "property_improvement.permit_issue_date",
      final_date: "property_improvement.completion_date",
    });
  });

  it("has no v1 column for an uncarried field (D-4c)", () => {
    const all = Object.values(VIEWS).flatMap((cols) => cols.map((c) => c.name));
    // v1.1 (ERR-66) made bbb_rating and bbb_url columns of v_roofing_permit, and
    // contractor_name_raw became contractor_name_as_printed; the rest still have no carrier.
    for (const banned of [
      "status_raw",
      "expiry_date",
      "contractor_name_raw",
      "description",
      "work_class_raw",
    ]) {
      expect(all).not.toContain(banned);
    }
  });

  it("v1.2 publishes the situs line and the owner mailing ZIP/state; the situs city and ZIP stay gaps (ERR-74)", () => {
    const names = columnNames("v_property");
    for (const f of [
      "unnormalized_address",
      "owner_mailing_postal_code",
      "owner_mailing_state_code",
    ])
      expect(names).toContain(f);
    for (const f of ["city_name", "postal_code"]) expect(names).not.toContain(f);
    expect(UNCARRIED.v_property.map((u) => [u.field, u.reason])).toEqual([
      ["city_name", "source_missing"],
      ["postal_code", "source_missing"],
    ]);
    const area = VIEWS.v_property.find((c) => c.name === "owner_is_out_of_area");
    expect(area?.missingReason).toBe("not_in_export");
  });

  it("the permit no-carrier fields are listed with no_lexicon_carrier (D-4c)", () => {
    expect(UNCARRIED.v_roofing_permit.map((u) => u.field)).toEqual([
      "status_raw",
      "expiry_date",
      "description",
      "work_class_raw",
    ]);
    for (const u of Object.values(UNCARRIED).flat()) {
      expect(u.fallback.length, u.field).toBeGreaterThan(0);
      expect(u.carrier.length, u.field).toBeGreaterThan(0);
    }
    for (const [view, fields] of Object.entries(UNCARRIED)) {
      const names = VIEWS[view as keyof typeof VIEWS].map((c) => c.name);
      for (const u of fields) expect(names, `${view}.${u.field}`).not.toContain(u.field);
    }
  });

  it("the sample row is a permit row plus its property's columns, property provenance prefixed", () => {
    const names = SAMPLE_COLUMNS.map((c) => c.name);
    // the property's request_identifier keeps the plain name; the permit's is not sampled
    const permitCols = columnNames("v_roofing_permit").filter((n) => n !== "request_identifier");
    expect(names.slice(0, permitCols.length)).toEqual(permitCols);
    expect(names).toContain("roof_age_years");
    expect(names).toContain(`${SAMPLE_PROPERTY_PREFIX}source_url`);
    expect(names).toContain(`${SAMPLE_PROPERTY_PREFIX}missing`);
    expect(new Set(names).size).toBe(names.length);
    expect(SampleRow).toBeDefined();
  });

  it("every CID column ends in _cid and is typed as a CID", () => {
    for (const cols of Object.values(VIEWS)) {
      for (const c of cols) {
        if (c.kind === "cid")
          expect(c.name.endsWith("_cid") || c.name === "cid", c.name).toBe(true);
        if (c.name.endsWith("_cid") || c.name === "cid") expect(c.kind, c.name).toBe("cid");
      }
    }
  });

  it("every column has a type, a meaning and a source", () => {
    for (const cols of Object.values(VIEWS)) {
      for (const c of cols) {
        expect(c.type.length, c.name).toBeGreaterThan(0);
        expect(c.meaning.length, c.name).toBeGreaterThan(0);
        expect(c.source.length, c.name).toBeGreaterThan(0);
      }
    }
  });

  it("enums are exactly the frozen sets", () => {
    expect(COLUMN_ENUMS).toEqual({
      roof_age_basis: ["permit", "new_construction", "built_year", "unknown"],
      roof_age_confidence: ["high", "medium", "low", "none"],
      bbb_status: ["rated", "not_found", "blocked", "not_checked"],
      status_class: ["open", "stalled", "closed"],
      owner_area_class: ["in_county", "regional", "out_of_area", "unknown"],
      coordinate_source: ["gis_centroid", "address_point", "permit_point", "none"],
      tenure_basis: ["sale_date", "deed_date", "unknown"],
      contractor_resolution: ["resolved", "unresolved"],
      owner_kind: ["person", "company", "unknown"],
    });
  });
});

describe("row schemas (generated from columns.ts)", () => {
  const RAW = "bafkreibhurphpjdq33ysit57jtzmdldgngepsdbsw4vm7esawth2ezgaxu";
  const DAG = "baguqeerasords4njcts6vs7qvdjfcvgnume4hqohf65zsfguprqphs3icwea";
  const provenance = {
    cid: DAG,
    source_url:
      "https://data.austintexas.gov/resource/3syk-w9eu.json?permit_number=2026-034767%20BP",
    captured_at: "2026-10-20T22:10:00.000Z",
    table: "property_improvement",
    table_cid: RAW,
    run_id: "travis-pilot-20261020",
    manifest_cid: RAW,
    as_of: "2026-10-20T23:00:00.000Z",
    missing: [
      { field: "improvement_status", reason: "enum_lacks_value" },
      { field: "status_raw", reason: "no_lexicon_carrier" },
    ],
  };
  const permit = {
    permit_cid: DAG,
    property_cid: DAG,
    jurisdiction: "austin",
    permit_number: "2026-034767 BP",
    request_identifier: "2026-034767 BP",
    improvement_type: "Roofing",
    improvement_action: "Replacement",
    improvement_status: null,
    status_class: "stalled",
    is_open: false,
    issue_date: "2026-03-10",
    final_date: null,
    permit_close_date: null,
    final_inspection_date: null,
    open_days: 224,
    contractor_resolution: "unresolved",
    contractor_company_cid: null,
    contractor_name_as_printed: null,
    bbb_status: "not_checked",
    bbb_status_reason: "contractor_unresolved",
    bbb_rating: null,
    bbb_url: null,
    profile_version: "travis-austin@1.0.0",
    profile_sha256: "b".repeat(64),
    ...provenance,
  };

  it("parses a stalled permit row", () => {
    expect(rowSchema("v_roofing_permit").parse(permit)).toEqual(permit);
  });

  it("rejects an enum outside its set, a missing column and an extra column", () => {
    const s = rowSchema("v_roofing_permit");
    expect(s.safeParse({ ...permit, status_class: "expired" }).success).toBe(false);
    const { open_days: _drop, ...noOpenDays } = permit;
    expect(s.safeParse(noOpenDays).success).toBe(false);
    expect(s.safeParse({ ...permit, description: "REROOF" }).success).toBe(false);
  });

  it("rejects null in a never-null column and a v0 CID", () => {
    const s = rowSchema("v_roofing_permit");
    expect(s.safeParse({ ...permit, permit_cid: null }).success).toBe(false);
    expect(s.safeParse({ ...permit, run_id: null }).success).toBe(false);
    expect(
      s.safeParse({ ...permit, property_cid: "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG" })
        .success,
    ).toBe(false);
  });

  it("rejects a date column that is not YYYY-MM-DD", () => {
    expect(
      rowSchema("v_roofing_permit").safeParse({ ...permit, issue_date: "03/10/2026" }).success,
    ).toBe(false);
  });

  it("an Expired permit's null improvement_status is enum_lacks_value, not no_lexicon_carrier (D-9)", () => {
    const col = VIEWS.v_roofing_permit.find((c) => c.name === "improvement_status");
    expect(col?.missingReason).toBe("enum_lacks_value");
    const uncarried = UNCARRIED.v_roofing_permit.filter((u) =>
      ["status_raw", "expiry_date"].includes(u.field),
    );
    expect(uncarried.map((u) => u.reason)).toEqual(["no_lexicon_carrier", "no_lexicon_carrier"]);
  });

  it("status_class is nullable with reason needs_review, never silently empty (code-review #1)", () => {
    const col = VIEWS.v_roofing_permit.find((c) => c.name === "status_class");
    expect(col).toMatchObject({ nullable: true, missingReason: "needs_review" });
    const s = rowSchema("v_roofing_permit");
    expect(s.safeParse({ ...permit, status_class: null }).success).toBe(true);
  });

  it("area_list_sha256 comes only from the manifest (no gazetteer fallback)", () => {
    for (const view of ["v_property", "v_run"] as const) {
      const col = VIEWS[view].find((c) => c.name === "area_list_sha256");
      expect(col?.source).toBe("manifest profiles[] (travis-places)");
    }
  });

  it("v_run carries the standard missing list; previous_manifest_cid is null only as first_run (T069)", () => {
    const missing = VIEWS.v_run.find((c) => c.name === "missing");
    expect(missing).toMatchObject({ kind: "missing", nullable: false });
    expect(missing?.type).toBe(PROVENANCE_COLUMNS.find((c) => c.name === "missing")?.type);
    const prev = VIEWS.v_run.find((c) => c.name === "previous_manifest_cid");
    expect(prev).toMatchObject({ nullable: true, missingReason: "first_run" });
    // Every other v_run column is never null, so it needs no reason.
    for (const c of VIEWS.v_run.filter((x) => x.name !== "previous_manifest_cid")) {
      expect(c.nullable, c.name).toBe(false);
      expect(c.missingReason, c.name).toBeNull();
    }
    const schema = rowSchema("v_run").shape.missing;
    expect(
      schema?.safeParse([{ field: "previous_manifest_cid", reason: "first_run" }]).success,
    ).toBe(true);
    expect(schema?.safeParse([{ field: "previous_manifest_cid", reason: "nope" }]).success).toBe(
      false,
    );
  });

  it("v_run.limitations is the manifest's top-level limitations[] as VARCHAR[] (T070)", () => {
    const col = VIEWS.v_run.find((c) => c.name === "limitations");
    expect(col).toMatchObject({
      kind: "list",
      type: "VARCHAR[]",
      nullable: false,
      source: "manifest limitations[]",
      missingReason: null,
    });
    const schema = rowSchema("v_run").shape.limitations;
    expect(schema?.safeParse(["pilot: local, unpublished"]).success).toBe(true);
    expect(schema?.safeParse([]).success).toBe(true);
    expect(schema?.safeParse([{ name: "x" }]).success).toBe(false);
    expect(schema?.safeParse(null).success).toBe(false);
  });

  it("owner_name is missing for no_owner_record first (the other owner reasons are per row; no_dated_sale is a tenure reason only)", () => {
    const col = VIEWS.v_property.find((c) => c.name === "owner_name");
    expect(col?.missingReason).toBe("no_owner_record");
  });

  it("builds a schema for every view", () => {
    for (const view of Object.keys(VIEWS) as ViewName[]) {
      expect(rowSchema(view)).toBeDefined();
    }
  });
});
