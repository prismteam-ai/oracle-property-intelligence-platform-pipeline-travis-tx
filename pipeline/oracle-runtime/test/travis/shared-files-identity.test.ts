// A-11 production fix, unit 1b: independent proof that the County and Property Improvement
// groups carry byte-identical shared files (shared-seed.ts `buildSharedFiles`: address.json,
// parcel.json, address_has_parcel.json, the seed root, property.json) for the same property.
// Identical bytes give an identical property CID, which is how the query views join permits to
// county properties; in the published Run 1 they differed, so zero permits joined.
//
// Each case builds one real TCAD account two ways:
//   County path: exactly local-stack tcad-backbone.ts `writeGroupWith` (processRecord, then a
//     GroupInput from the loaded parcel row plus the assembled coordinate, then planCountyGroup).
//   Permits path: the Query DB round trip (the stored parcels row, with payload_redacted
//     re-serialized in Postgres jsonb key order), then planPropertyImprovementGroup with one real
//     stored roofing permit.
// Every file name both groups carry is compared byte for byte, so a divergence in a file nobody
// has listed yet still fails. Records are real (fixtures/shared-files-identity/travis-records.json,
// party-free projection documented there); no network.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as travisAustin from "../../../../profiles/travis-austin@1.0.0/index.js";
import { profileApi, type TravisAustinProfileModule } from "../../travis/pilot/profile-api.js";
import {
  planPropertyImprovementGroup,
  type ParcelDbRow,
  type PermitDbRow,
} from "../../travis/permits/write-group.js";
import { sha256Text, type ExportRecordText } from "../../travis/tcad/export-stream.js";
import { createKeyInventory } from "../../travis/tcad/key-inventory.js";
import { processRecord, type LoadedRecord } from "../../travis/tcad/process.js";
import { planCountyGroup, type GroupInput } from "../../travis/tcad/write-group.js";
import type { AustinRow } from "../../travis/transforms/austin-property-improvement.js";

/** Same CIDs every transform test uses (test/transforms/*.test.ts). */
const CIDS = {
  seed: "bafkreibhurphpjdq33ysit57jtzmdldgngepsdbsw4vm7esawth2ezgaxu",
  county: "bafkreia6tjziby3upxmidymud5iusd32urrztslgrudkwysc7ydmxoekuq",
  propertyImprovement: "bafkreicyzywzwhmguojpi2otgrwsyi37le3u4lnavljbxu76cnrudxaxfu",
};
const SHARED = [
  "address.json",
  "parcel.json",
  "address_has_parcel.json",
  `${CIDS.seed}.json`,
  "property.json",
].sort();

const PROFILE = profileApi(travisAustin as unknown as TravisAustinProfileModule);

type CoordinateSource = "gis_centroid" | "permit_point" | "none";
interface FixtureRecord {
  case: string;
  pID: string;
  record_ordinal: number;
  record_sha256: string;
  confidential_basis: string[];
  coordinate: {
    latitude: number | null;
    longitude: number | null;
    source: CoordinateSource;
    rule: string | null;
  };
  record: Record<string, unknown>;
}
interface Fixture {
  source: { zip_sha256: string; captured_at: string };
  run: { job_id: string; as_of: string };
  records: FixtureRecord[];
  permit: {
    permit_number: string;
    request_identifier: string;
    content_sha256: string;
    captured_at: string;
    payload: AustinRow;
  };
}

const FIXTURE = JSON.parse(
  readFileSync(
    new URL("../fixtures/shared-files-identity/travis-records.json", import.meta.url),
    "utf8",
  ),
) as Fixture;

/** The run context writeGroupWith passes processRecord (job, as_of, export receipt). */
const CTX = {
  jobId: FIXTURE.run.job_id,
  asOf: FIXTURE.run.as_of,
  exportSha256: FIXTURE.source.zip_sha256,
  capturedAt: FIXTURE.source.captured_at,
};

/** The real stored row of permit 2003-012717 BP (owned by pID 100027), reused for each case. */
const PERMIT: PermitDbRow = {
  request_identifier: FIXTURE.permit.request_identifier,
  permit_number: FIXTURE.permit.permit_number,
  payload: FIXTURE.permit.payload,
  content_sha256: FIXTURE.permit.content_sha256,
  captured_at: FIXTURE.permit.captured_at,
};

/** Postgres jsonb object key order: shorter keys first, then bytewise. Arrays keep order. */
function jsonbOrder(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(jsonbOrder);
  if (typeof value !== "object" || value === null) return value;
  const keys = Object.keys(value).sort((a, b) => {
    const ab = Buffer.from(a, "utf8");
    const bb = Buffer.from(b, "utf8");
    return ab.length !== bb.length ? ab.length - bb.length : Buffer.compare(ab, bb);
  });
  return Object.fromEntries(
    keys.map((k) => [k, jsonbOrder((value as Record<string, unknown>)[k])]),
  );
}

/** A value as the Query DB hands it back: JSON text round trip in jsonb key order. */
const fromJsonb = (value: unknown): unknown =>
  JSON.parse(JSON.stringify(jsonbOrder(JSON.parse(JSON.stringify(value)))));

/** County path: tcad-backbone.ts writeGroupWith, for one record, with assembled coordinates. */
function countyPath(f: FixtureRecord): {
  loaded: LoadedRecord;
  redacted: boolean;
  files: Record<string, string>;
  geometryRule: string;
} {
  const text = JSON.stringify(f.record);
  const rec: ExportRecordText = {
    ordinal: f.record_ordinal,
    text,
    sha256: sha256Text(text),
    bytes: Buffer.byteLength(text),
  };
  const out = processRecord(rec, CTX, createKeyInventory());
  const l = out.loaded;
  if (l === undefined) throw new Error(`pID ${f.pID}: not loaded (${out.recon.class})`);
  const input: GroupInput = {
    pID: l.parcel.request_identifier,
    geoId: l.parcel.geo_id,
    propType: l.parcel.prop_type,
    record: l.record,
    yearBuilt: l.parcel.property_structure_built_year,
    exportPoint:
      l.parcel.export_point_lat === null || l.parcel.export_point_lon === null
        ? null
        : {
            lat: l.parcel.export_point_lat,
            lon: l.parcel.export_point_lon,
            kind: l.parcel.export_point_kind,
          },
    coordinate: {
      latitude: f.coordinate.latitude,
      longitude: f.coordinate.longitude,
      source: f.coordinate.source,
    },
  };
  const plan = planCountyGroup([input], CIDS);
  const g = plan.groups[0];
  if (g === undefined) throw new Error(`pID ${f.pID}: no County group`);
  return { loaded: l, redacted: out.redacted, files: g.files, geometryRule: g.geometry_rule };
}

/** The parcels row as the Query DB stores and returns it (0101_tcad.sql + 0201_gis.sql). */
function storedParcelRow(l: LoadedRecord, f: FixtureRecord): ParcelDbRow {
  return {
    request_identifier: l.parcel.request_identifier,
    geo_id: l.parcel.geo_id,
    payload_redacted: fromJsonb(l.parcel.payload_redacted),
    property_structure_built_year: l.parcel.property_structure_built_year,
    export_point_lat: l.parcel.export_point_lat,
    export_point_lon: l.parcel.export_point_lon,
    export_point_kind: l.parcel.export_point_kind,
    latitude: f.coordinate.latitude,
    longitude: f.coordinate.longitude,
    coordinate_source: f.coordinate.source,
  };
}

/** Permits path: the stored row through planPropertyImprovementGroup with one roofing permit. */
function permitsPath(parcel: ParcelDbRow): Record<string, string> {
  const plan = planPropertyImprovementGroup([{ parcel, permits: [PERMIT] }], CIDS, PROFILE);
  expect(plan.empty, "the roofing permit must be emitted").toEqual([]);
  const g = plan.groups[0];
  if (g === undefined) throw new Error(`pID ${parcel.request_identifier}: no PI group`);
  return g.files;
}

/** Per differing file: the top-level JSON keys whose values differ (readable red output). */
function divergence(
  county: Record<string, string>,
  permits: Record<string, string>,
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  const common = Object.keys(county).filter((n) => n in permits);
  for (const name of common) {
    const a = county[name] as string;
    const b = permits[name] as string;
    if (a === b) continue;
    let keys: string[];
    try {
      const ja = JSON.parse(a) as Record<string, unknown>;
      const jb = JSON.parse(b) as Record<string, unknown>;
      keys = [...new Set([...Object.keys(ja), ...Object.keys(jb)])].filter(
        (k) => JSON.stringify(ja[k]) !== JSON.stringify(jb[k]),
      );
      if (keys.length === 0) keys = ["(key order or whitespace)"];
    } catch {
      keys = ["(not JSON)"];
    }
    out[name] = keys.map((k) => {
      const show = (t: string): string => {
        try {
          return JSON.stringify((JSON.parse(t) as Record<string, unknown>)[k]) ?? "absent";
        } catch {
          return "?";
        }
      };
      return k.startsWith("(") ? k : `${k}: county=${show(a)} permits=${show(b)}`;
    });
  }
  return out;
}

/** The fact each case exists to exercise, checked on the County side (guards the fixture). */
const PREMISE: Record<string, (c: ReturnType<typeof countyPath>) => void> = {
  "100018": (c) => {
    expect(c.redacted).toBe(true);
    expect(c.loaded.parcel.owner_redacted).toBe(true);
  },
  "100027": (c) => {
    expect(c.files["property.json"]).toMatch(/"property_legal_description_text": "LOT 8-9 BLK 18/);
  },
  "124104": (c) => {
    expect(c.loaded.parcel.year_built_rule).toBe("largest_main_improvement");
    expect(c.loaded.parcel.property_structure_built_year).not.toBeNull();
  },
  "100022": (c) => {
    expect(c.loaded.parcel.property_type_rule).toBe("improvement_fallback");
    expect(c.loaded.parcel.property_type).toBe("Building");
  },
  "100247": (c) => {
    expect(c.loaded.parcel.property_type_rule).toBe("improvement_fallback");
    expect(c.loaded.parcel.property_type).toBe("LandParcel");
  },
  "100123": (c) => {
    expect(c.geometryRule).toBe("gis_centroid");
  },
  "128168": (c) => {
    expect(c.geometryRule).toBe("none");
    expect(c.files["address.json"]).toMatch(/"latitude": null/);
  },
  "115195": (c) => {
    expect(c.geometryRule).toBe("none");
    expect(c.files["address.json"]).toMatch(/"latitude": null/);
  },
};

describe("shared files are byte-identical in the County and Property Improvement groups", () => {
  it("the fixture holds one real record per case", () => {
    expect(FIXTURE.records.map((r) => r.pID).sort()).toEqual(Object.keys(PREMISE).sort());
    expect(PERMIT.payload.permit_number).toBe(PERMIT.permit_number);
  });

  it("jsonb key order differs from insertion order but carries the same value", () => {
    const f = FIXTURE.records.find((r) => r.pID === "100027") as FixtureRecord;
    const stored = countyPath(f).loaded.parcel.payload_redacted;
    const back = fromJsonb(stored);
    expect(back).toEqual(stored);
    expect(JSON.stringify(back)).not.toBe(JSON.stringify(stored));
  });

  it.each(FIXTURE.records.map((r) => [`${r.case} (pID ${r.pID})`, r] as const))(
    "%s",
    (_title, f) => {
      const county = countyPath(f);
      PREMISE[f.pID]?.(county);
      const parcel = storedParcelRow(county.loaded, f);
      const permits = permitsPath(parcel);

      const sharedOf = (files: Record<string, string>): string[] =>
        Object.keys(files)
          .filter((n) => SHARED.includes(n))
          .sort();
      expect(sharedOf(county.files), "County group carries every shared file").toEqual(SHARED);
      expect(sharedOf(permits), "PI group carries every shared file").toEqual(SHARED);

      // Every file both groups carry (the shared five, and any added later) must match exactly.
      expect(divergence(county.files, permits)).toEqual({});
      for (const name of Object.keys(county.files).filter((n) => n in permits)) {
        expect(permits[name], name).toBe(county.files[name]);
      }

      // Key order of the stored jsonb must not matter: insertion order gives the same bytes.
      const inOrder = permitsPath({
        ...parcel,
        payload_redacted: JSON.parse(JSON.stringify(county.loaded.parcel.payload_redacted)),
      });
      for (const name of SHARED) expect(inOrder[name], name).toBe(permits[name]);
    },
  );
});
