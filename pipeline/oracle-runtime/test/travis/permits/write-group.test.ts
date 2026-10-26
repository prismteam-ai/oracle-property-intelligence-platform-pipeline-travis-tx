// A-11 T031: travis/permits/write-group.ts reshapes stored Query DB rows into
// transformAustinPropertyImprovement's real input (never a new shape) and writes plain files.
// Small fixture only (3 parcels, not the 2,381,226-row full roll -- that is the next task).
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildSeedRow } from "../../../travis/pilot/build-seed.js";
import {
  AUSTIN_DATASET_URL,
  type ProfileApi,
} from "../../../travis/transforms/austin-property-improvement.js";
import { slimPayload } from "../../../travis/tcad/fields.js";
import { planCountyGroup } from "../../../travis/tcad/write-group.js";
import { parseTcadRecord } from "../../../travis/transforms/shared-seed.js";
import {
  captureOf,
  planPropertyImprovementGroup,
  recordAndSeedOf,
  writePropertyImprovementGroupFiles,
  type ParcelDbRow,
  type PermitDbRow,
} from "../../../travis/permits/write-group.js";
import { tcadRecord } from "../../fixtures/tcad-records.js";

const CIDS = {
  seed: "bafkreibhurphpjdq33ysit57jtzmdldgngepsdbsw4vm7esawth2ezgaxu",
  county: "bafkreia6tjziby3upxmidymud5iusd32urrztslgrudkwysc7ydmxoekuq",
  propertyImprovement: "bafkreicyzywzwhmguojpi2otgrwsyi37le3u4lnavljbxu76cnrudxaxfu",
};
const SHA = "e".repeat(64);

/** Same stub shape as test/transforms/austin-property-improvement.test.ts: the transform's
 *  classification is out of scope here, only the DB → input reshaping is under test. */
const STUB: ProfileApi = {
  PROFILE: { name: "travis-austin", version: "1.0.0", sha256: SHA },
  classifyPermit: (row) => ({
    roofing: row.permittype === "BP" ? "roofing" : "not_roofing",
    reason: row.permittype === "BP" ? "include" : "trade_permit",
    improvement_type: row.permittype === "BP" ? "Roofing" : null,
    improvement_action: row.permittype === "BP" ? "Replacement" : null,
    sha256: SHA,
  }),
  classifyStatus: (word) => {
    const table: Record<
      string,
      {
        class: "open" | "stalled" | "closed" | "exclude" | "needs_review";
        improvement_status: string | null;
      }
    > = {
      Active: { class: "open", improvement_status: "Permitted" },
      Final: { class: "closed", improvement_status: "Completed" },
      VOID: { class: "exclude", improvement_status: null },
    };
    return {
      ...(table[word ?? ""] ?? { class: "needs_review", improvement_status: null }),
      sha256: SHA,
    };
  },
};

function parcelRow(pID: number, geoId: string): ParcelDbRow {
  return {
    request_identifier: String(pID),
    geo_id: geoId,
    payload_redacted: slimPayload(tcadRecord({ pID, geoID: geoId }), false),
    // the fixture's own export point, assembled as a GIS centroid (0201_gis.sql columns)
    property_structure_built_year: 1985,
    export_point_lat: 30.2545186553,
    export_point_lon: -97.7620645363,
    export_point_kind: "real",
    latitude: 30.2545186553,
    longitude: -97.7620645363,
    coordinate_source: "gis_centroid",
  };
}

function permitRow(
  pID: number,
  permitNumber: string,
  over: Partial<PermitDbRow["payload"]> = {},
): PermitDbRow {
  return {
    request_identifier: String(pID),
    permit_number: permitNumber,
    content_sha256: SHA,
    captured_at: "2026-10-21T22:32:10.129Z",
    payload: {
      permit_number: permitNumber,
      permittype: "BP",
      work_class: "Remodel",
      status_current: "Active",
      description: "REROOF SFR",
      issue_date: "2026-09-02T00:00:00.000",
      completed_date: null,
      // the link match already happened upstream (0301_permits.sql); this field is carried
      // through unread by the transform, so a fixed value is fine across every parcel here
      tcad_id: "0100030105",
      ...over,
    },
  };
}

describe("recordAndSeedOf", () => {
  it("rebuilds the TcadRecord and seed row from parcels.payload_redacted", () => {
    const { record, seed } = recordAndSeedOf(parcelRow(100008, "0100030105"));
    expect(String(record.pID)).toBe("100008");
    expect(seed.parcel_id).toBe("100008");
  });

  it("overrides geometry from the assembled coordinate, as the County group does", () => {
    const moved = {
      ...parcelRow(100008, "0100030105"),
      latitude: 30.3,
      longitude: -97.8,
    };
    expect(recordAndSeedOf(moved).record.geometry).toBe("[30.3, -97.8]");
    const none = {
      ...parcelRow(100008, "0100030105"),
      latitude: null,
      longitude: null,
      coordinate_source: "none" as const,
    };
    const out = recordAndSeedOf(none);
    expect(out.record.geometry).toBeNull();
    expect(out.seed.latitude).toBe("");
    // a permit point is never written as geometry (County rule CT-8)
    const permitPoint = {
      ...parcelRow(100008, "0100030105"),
      coordinate_source: "permit_point" as const,
    };
    expect(recordAndSeedOf(permitPoint).record.geometry).toBeNull();
  });

  it("A11-10(c): a parcel whose coordinates were never assembled keeps its real export point, as the County writer does", () => {
    const unassembled = {
      ...parcelRow(100008, "0100030105"),
      latitude: null,
      longitude: null,
      coordinate_source: null,
    };
    // County rule when the GIS migration is not applied: no coordinate is passed, so a real
    // TCAD export point stands in (rule unassembled_pilot_export_point).
    expect(recordAndSeedOf(unassembled).record.geometry).toBe("[30.2545186553, -97.7620645363]");
    // An assembled parcel with no usable coordinate (source "none") stays empty: the County
    // writer passes source none, never the export point.
    const assembledNone = { ...unassembled, coordinate_source: "none" as const };
    expect(recordAndSeedOf(assembledNone).record.geometry).toBeNull();
    // An export point of unknown kind never becomes geometry in either state.
    const unknownKind = { ...unassembled, export_point_kind: null };
    expect(recordAndSeedOf(unknownKind).record.geometry).toBeNull();
  });

  it("carries the recorded year built into property.json, not the profile year", () => {
    const row = { ...parcelRow(100008, "0100030105"), property_structure_built_year: 1962 };
    expect(recordAndSeedOf(row).yearBuilt).toBe(1962);
    const plan = planPropertyImprovementGroup(
      [{ parcel: row, permits: [permitRow(100008, "2026-100001 BP")] }],
      CIDS,
      STUB,
    );
    const property = JSON.parse(plan.groups[0]?.files["property.json"] as string);
    expect(property.property_structure_built_year).toBe(1962);
    expect(property.property_legal_description_text).toBe("LOT 1 BLK A TEST ADDN 100008");
  });

  it("throws when the stored pID does not match the DB key (data-integrity guard)", () => {
    const row = parcelRow(100008, "0100030105");
    row.request_identifier = "999999";
    expect(() => recordAndSeedOf(row)).toThrow(/prints pID 100008/);
  });

  it("refuses a copy stored before the shared-files fix (no legal description / valuations)", () => {
    const row = parcelRow(100008, "0100030105");
    const old = { ...(row.payload_redacted as Record<string, unknown>) };
    delete old.propertyLegalDescription;
    delete old.valuations;
    row.payload_redacted = old;
    expect(() => recordAndSeedOf(row)).toThrow(/backfill-payload-redacted/);
  });
});

describe("captureOf", () => {
  it("rebuilds the per-permit GET receipt from the stored raw payload, never re-requesting it", () => {
    const capture = captureOf(permitRow(100008, "2026-100001 BP"));
    expect(capture.receipt).toMatchObject({
      url: AUSTIN_DATASET_URL,
      method: "GET",
      multiValueQueryString: { permit_number: ["2026-100001 BP"] },
      sha256: SHA,
    });
    expect(capture.row.permit_number).toBe("2026-100001 BP");
  });

  it("throws when the stored payload's permit_number disagrees with the DB key", () => {
    const row = permitRow(100008, "2026-100001 BP");
    row.payload.permit_number = "2026-999999 BP";
    expect(() => captureOf(row)).toThrow(/prints permit_number/);
  });
});

describe("planPropertyImprovementGroup", () => {
  it("emits a group per parcel with at least one emittable permit", () => {
    const plan = planPropertyImprovementGroup(
      [
        { parcel: parcelRow(100008, "0100030105"), permits: [permitRow(100008, "2026-100001 BP")] },
        {
          parcel: parcelRow(100009, "0100030106"),
          permits: [
            permitRow(100009, "2026-100002 BP", {
              status_current: "Final",
              completed_date: "2026-09-10T00:00:00.000",
            }),
          ],
        },
      ],
      CIDS,
      STUB,
    );
    expect(plan.groups).toHaveLength(2);
    expect(plan.empty).toEqual([]);
    const pi1 = JSON.parse(plan.groups[0]?.files["property_improvement_1.json"] as string);
    expect(pi1).toMatchObject({ permit_number: "2026-100001 BP", improvement_type: "Roofing" });
    expect(plan.groups[0]?.counts.emitted).toBe(1);
  });

  it("leaves a parcel out of the group (and names it `empty`) when every permit is excluded", () => {
    const plan = planPropertyImprovementGroup(
      [
        {
          parcel: parcelRow(100010, "0100030107"),
          permits: [permitRow(100010, "2019-000001 BP", { status_current: "VOID" })],
        },
      ],
      CIDS,
      STUB,
    );
    expect(plan.groups).toEqual([]);
    expect(plan.empty).toEqual(["100010"]);
  });

  it("sorts multiple permits of one parcel by permit_number before numbering them", () => {
    const plan = planPropertyImprovementGroup(
      [
        {
          parcel: parcelRow(100011, "0100030108"),
          permits: [permitRow(100011, "2026-200002 BP"), permitRow(100011, "2026-100001 BP")],
        },
      ],
      CIDS,
      STUB,
    );
    const files = plan.groups[0]?.files ?? {};
    expect(JSON.parse(files["property_improvement_1.json"] as string)).toMatchObject({
      permit_number: "2026-100001 BP",
    });
    expect(JSON.parse(files["property_improvement_2.json"] as string)).toMatchObject({
      permit_number: "2026-200002 BP",
    });
  });
});

describe("printed contractor company (ERR-66, PO decision 2026-10-25)", () => {
  function planOne(over: Record<string, string | null>, n = "2026-100001 BP") {
    const plan = planPropertyImprovementGroup(
      [{ parcel: parcelRow(100008, "0100030105"), permits: [permitRow(100008, n, over)] }],
      CIDS,
      STUB,
    );
    return plan.groups[0]?.files ?? {};
  }
  const read = (files: Record<string, string>, name: string) =>
    JSON.parse(files[name] as string) as Record<string, unknown>;

  it("writes company.name as printed (markers stripped), provenance of the permit, no registry id", () => {
    const files = planOne({
      contractor_company_name: " Done Right Roofing**MAIN** ",
      contractor_phone: "5125550100",
      contractor_city: "Round Rock",
      contractor_address1: "1 Main St",
      contractor_full_name: "Pat Person",
    });
    expect(read(files, "company_1.json")).toEqual({
      source_http_request: {
        method: "GET",
        url: AUSTIN_DATASET_URL,
        multiValueQueryString: { permit_number: ["2026-100001 BP"] },
      },
      request_identifier: "2026-100001 BP",
      name: "Done Right Roofing",
      sunbiz_document_number: null,
    });
    expect(read(files, "relationship_property_improvement_has_contractor_1.json")).toEqual({
      from: { "/": "./property_improvement_1.json" },
      to: { "/": "./company_1.json" },
    });
    const root = read(files, `${CIDS.propertyImprovement}.json`) as {
      relationships: Record<string, unknown[]>;
    };
    expect(root.relationships.property_improvement_has_contractor).toEqual([
      { "/": "./relationship_property_improvement_has_contractor_1.json" },
    ]);
    // no phone, address, city, person or BBB text anywhere; no person/license files
    const all = Object.values(files).join("\n");
    expect(all).not.toMatch(/5125550100|Main St|Round Rock|Pat Person|bbb/i);
    expect(Object.keys(files).some((f) => /^(person|license)/.test(f))).toBe(false);
  });

  it("writes no contractor when neither a company nor a person is printed (placeholders count as none)", () => {
    for (const name of ["N/A", "OWNER", "SELF", "", "   ", null]) {
      const files = planOne({ contractor_company_name: name, contractor_full_name: name });
      expect(Object.keys(files).some((f) => /company|contractor/.test(f))).toBe(false);
      const root = read(files, `${CIDS.propertyImprovement}.json`) as {
        relationships: Record<string, unknown>;
      };
      expect(root.relationships).not.toHaveProperty("property_improvement_has_contractor");
    }
  });

  it("publishes a person-only contractor as company.name as printed (ERR-72, PO 2026-10-26)", () => {
    for (const name of ["N/A", "OWNER", "", null]) {
      const plan = planPropertyImprovementGroup(
        [
          {
            parcel: parcelRow(100008, "0100030105"),
            permits: [
              permitRow(100008, "2026-100001 BP", {
                contractor_company_name: name,
                contractor_full_name: "  Pat   Person ",
                contractor_phone: "5125550100",
              }),
            ],
          },
        ],
        CIDS,
        STUB,
      );
      const files = plan.groups[0]?.files ?? {};
      expect(read(files, "company_1.json")).toEqual({
        source_http_request: {
          method: "GET",
          url: AUSTIN_DATASET_URL,
          multiValueQueryString: { permit_number: ["2026-100001 BP"] },
        },
        request_identifier: "2026-100001 BP",
        name: "Pat Person",
        sunbiz_document_number: null,
      });
      expect(Object.keys(files).some((f) => /^person/.test(f))).toBe(false);
      expect(Object.values(files).join("\n")).not.toMatch(/5125550100/);
      expect(plan.groups[0]?.counts.contractor_companies_printed).toBe(1);
      expect(plan.groups[0]?.counts.contractor_persons_printed).toBe(1);
    }
  });

  it("keeps the printed company when both a company and a person are printed", () => {
    const plan = planPropertyImprovementGroup(
      [
        {
          parcel: parcelRow(100008, "0100030105"),
          permits: [
            permitRow(100008, "2026-100001 BP", {
              contractor_company_name: "Alpha Roofing",
              contractor_full_name: "Pat Person",
            }),
          ],
        },
      ],
      CIDS,
      STUB,
    );
    const files = plan.groups[0]?.files ?? {};
    expect(read(files, "company_1.json").name).toBe("Alpha Roofing");
    expect(plan.groups[0]?.counts.contractor_persons_printed).toBe(0);
  });

  it("numbers one company per emitted permit, in permit order", () => {
    const plan = planPropertyImprovementGroup(
      [
        {
          parcel: parcelRow(100008, "0100030105"),
          permits: [
            permitRow(100008, "2026-200002 BP", { contractor_company_name: "Beta Roofing" }),
            permitRow(100008, "2026-100001 BP", { contractor_company_name: "Alpha Roofing" }),
          ],
        },
      ],
      CIDS,
      STUB,
    );
    const files = plan.groups[0]?.files ?? {};
    expect(read(files, "company_1.json").name).toBe("Alpha Roofing");
    expect(read(files, "company_2.json").name).toBe("Beta Roofing");
    expect(plan.groups[0]?.counts.contractor_companies_printed).toBe(2);
  });
});

describe("writePropertyImprovementGroupFiles", () => {
  it("writes each group's files as plain files under <dir>/<pID>/data/<file>, no zip", () => {
    const plan = planPropertyImprovementGroup(
      [{ parcel: parcelRow(100008, "0100030105"), permits: [permitRow(100008, "2026-100001 BP")] }],
      CIDS,
      STUB,
    );
    const dir = mkdtempSync(join(tmpdir(), "pi-write-group-"));
    const written = writePropertyImprovementGroupFiles(dir, plan.groups);
    expect(written.length).toBeGreaterThan(0);
    expect(readdirSync(join(dir, "100008"))).toEqual(["data"]);
    const dataFiles = readdirSync(join(dir, "100008", "data")).sort();
    expect(dataFiles).toContain("property_improvement_1.json");
    expect(dataFiles).toContain("property.json");
    const pi = JSON.parse(
      readFileSync(join(dir, "100008", "data", "property_improvement_1.json"), "utf8"),
    );
    expect(pi.permit_number).toBe("2026-100001 BP");
  });
});

// Run 1 defect: the stored slim payload lost the legal description and valuations, so the
// shared files (and the property CID) differed between the County and Property Improvement groups.
const reverseKeys = (v: unknown): unknown =>
  Array.isArray(v)
    ? v.map(reverseKeys)
    : typeof v === "object" && v !== null
      ? Object.fromEntries(
          Object.entries(v)
            .reverse()
            .map(([k, x]) => [k, reverseKeys(x)]),
        )
      : v;

describe("shared files: County path vs stored-payload path", () => {
  it("are byte-identical for a record with an unmapped state code and one improvement", () => {
    const full = {
      ...tcadRecord({ pID: 100027, geoID: "0100030127", stateCd: "XX", yearBuilt: 0 }),
      valuations: [
        {
          pYear: 2026,
          marketValue: 500000,
          details: {
            "cost-local": {
              improvements: [
                {
                  pImprovementID: 1,
                  imprvType: "R",
                  stateCd: "A1",
                  actualYearBuilt: 1948,
                  effYearBuilt: 1990,
                  comment: "dropped",
                  details: [{ imprvDetailType: "1ST", area: 1200, value: 1 }],
                },
              ],
            },
          },
        },
      ],
    };
    const coordinate = { latitude: 30.25, longitude: -97.76, source: "gis_centroid" as const };
    const county = planCountyGroup(
      [
        {
          pID: "100027",
          geoId: "0100030127",
          propType: "R",
          record: full,
          yearBuilt: 1948,
          exportPoint: { lat: 30.2545186553, lon: -97.7620645363, kind: "real" },
          coordinate,
        },
      ],
      CIDS,
    ).groups[0]?.files as Record<string, string>;
    const parcel: ParcelDbRow = {
      ...parcelRow(100027, "0100030127"),
      // jsonb does not keep key order (it sorts keys): stored with every object's keys reversed
      payload_redacted: reverseKeys(slimPayload(full, false)),
      property_structure_built_year: 1948,
      latitude: coordinate.latitude,
      longitude: coordinate.longitude,
    };
    const permits = planPropertyImprovementGroup(
      [{ parcel, permits: [permitRow(100027, "2026-100001 BP")] }],
      CIDS,
      STUB,
    ).groups[0]?.files as Record<string, string>;
    for (const name of [
      "address.json",
      "parcel.json",
      "address_has_parcel.json",
      `${CIDS.seed}.json`,
      "property.json",
    ]) {
      expect(permits[name], name).toBe(county[name]);
    }
    expect(JSON.parse(county["property.json"] as string)).toMatchObject({
      property_type: "Building",
      property_structure_built_year: 1948,
      property_legal_description_text: "LOT 1 BLK A TEST ADDN 100027",
    });
  });
});

// sanity: recordAndSeedOf + buildSeedRow agree on the same parcel (no divergent shaping)
describe("cross-check against buildSeedRow directly", () => {
  it("produces the same seed row buildSeedRow would for the same record", () => {
    const record = parseTcadRecord(tcadRecord({ pID: 100012, geoID: "0100030109" }));
    const direct = buildSeedRow(record, "0100030109");
    const { seed } = recordAndSeedOf(parcelRow(100012, "0100030109"));
    expect(seed).toEqual(direct);
  });
});
