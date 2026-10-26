// A-04 G-TCAD: TCAD backbone (T020 stream + key inventory, T022 fields, T024 export point,
// T026 reconciliation, T027 County group). Synthetic test input only (test/fixtures/a04/tcad).
import { describe, expect, it } from "vitest";
import { a04Record, writeExportZip } from "../../fixtures/a04/tcad/export.js";
import { streamExportRecords, sha256Text } from "../../../travis/tcad/export-stream.js";
import {
  createKeyInventory,
  parseExportRecord,
  UnknownKeyError,
} from "../../../travis/tcad/key-inventory.js";
import {
  DUPLICATE_MIN_GEOIDS,
  TRAVIS_BBOX,
  exportPointKind,
  parseExportPoint,
} from "../../../travis/tcad/export-point.js";

const collect = async <T>(it: AsyncIterable<T>): Promise<T[]> => {
  const out: T[] = [];
  for await (const x of it) out.push(x);
  return out;
};

describe("T020 export stream and key inventory", () => {
  it("streams every record once with its exact text, ordinal and sha256", async () => {
    const zip = writeExportZip([
      a04Record({ pID: 101, geoID: "0100000001" }),
      a04Record({ pID: 102, geoID: "0100000002" }),
    ]);
    const records = await collect(streamExportRecords(zip));
    expect(records.map((r) => r.ordinal)).toEqual([0, 1]);
    for (const r of records) {
      expect(r.sha256).toBe(sha256Text(r.text));
      expect(JSON.parse(r.text)).toHaveProperty("pID");
    }
  });

  it("returns the {key: count} inventory over one pass", async () => {
    const zip = writeExportZip([
      a04Record({ pID: 101, geoID: "0100000001" }),
      a04Record({ pID: 102, geoID: "0100000002" }),
    ]);
    const inv = createKeyInventory();
    for await (const r of streamExportRecords(zip)) parseExportRecord(JSON.parse(r.text), inv);
    const counts = inv.counts();
    expect(counts.pID).toBe(2);
    expect(counts["owners[].name"]).toBe(2);
    expect(counts["sales[].saleDt"]).toBe(2);
    expect(inv.sha256()).toMatch(/^[a-f0-9]{64}$/);
  });

  it.each([
    [
      "top-level",
      (r: Record<string, unknown>) => (r.ownerConfidentialFlag = 1),
      "ownerConfidentialFlag",
    ],
    [
      "owners[]",
      (r: Record<string, unknown>) =>
        (((r.owners as Record<string, unknown>[])[0] as Record<string, unknown>).privacyFlag = "Y"),
      "owners[].privacyFlag",
    ],
    [
      "sales[]",
      (r: Record<string, unknown>) =>
        (((r.sales as Record<string, unknown>[])[0] as Record<string, unknown>).secretCode = "X"),
      "sales[].secretCode",
    ],
  ])("an unknown %s key fails the run naming the key", (_where, mutate, key) => {
    const record = a04Record({ pID: 103, geoID: "0100000003" });
    mutate(record);
    let error: unknown;
    try {
      parseExportRecord(record, createKeyInventory());
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(UnknownKeyError);
    expect((error as UnknownKeyError).key).toBe(key);
    expect((error as Error).message).toContain(key);
  });
});

describe("T024 export-point definition", () => {
  it("a real point inside the Travis box is real", () => {
    expect(exportPointKind("[30.2545186553, -97.7620645363]")).toBe("real");
    expect(parseExportPoint("[30.2545186553, -97.7620645363]")).toEqual({
      lat: 30.2545186553,
      lon: -97.7620645363,
    });
  });

  it.each(["[0, 0]", "", "[null, null]", "[abc, -97.7]", null, undefined, "30.25,-97.76"])(
    "%j is a placeholder",
    (g) => {
      expect(exportPointKind(g)).toBe("placeholder");
    },
  );

  it("a point outside the gazetteer's Travis box is outside_county", () => {
    expect(exportPointKind("[32.7767, -96.797]")).toBe("outside_county");
    expect(TRAVIS_BBOX.minLat).toBeLessThan(30.03);
    expect(TRAVIS_BBOX.maxLon).toBeGreaterThan(-97.37);
  });

  it("the same point on more than N distinct geoIDs is duplicate (N recorded)", () => {
    const g = "[30.3, -97.7]";
    expect(DUPLICATE_MIN_GEOIDS).toBeGreaterThan(1);
    expect(exportPointKind(g, { geoIdsAtPoint: () => DUPLICATE_MIN_GEOIDS })).toBe("real");
    expect(exportPointKind(g, { geoIdsAtPoint: () => DUPLICATE_MIN_GEOIDS + 1 })).toBe("duplicate");
  });
});

// ---------- T022 fields, year built, account class ----------
import { mapParcel, InvalidRecordError } from "../../../travis/tcad/fields.js";
import { redactRecord } from "../../../travis/tcad/redact.js";
import {
  A02_PILOT_MAPPING,
  propertyTypeOf,
  propertyFields,
  parseTcadRecord,
  STATE_CODES,
} from "../../../travis/transforms/shared-seed.js";

const MAP_CTX = {
  jobId: "travis-a04-pilot-202610220100",
  asOf: "2026-10-22",
  exportSha256: "6f7a758568fd03fa200e996d2756559eb53e13241238a004cbadac09ff4c2346",
  capturedAt: "2026-10-19T21:33:41.241Z",
};
const mapOne = (raw: Record<string, unknown>, ordinal = 0) =>
  mapParcel(redactRecord(raw), { ...MAP_CTX, ordinal, recordSha256: "a".repeat(64) });

describe("T022 fields", () => {
  it("A-04-TC-007 several improvements → one parcels row, every improvement a property_structures row", () => {
    const m = mapOne(
      a04Record({
        pID: 3001,
        geoID: "0300000001",
        yearBuilt: 0,
        improvements: [
          { stateCd: "A1", livingArea: 1100, actualYearBuilt: 1962 },
          { stateCd: "A1", livingArea: 2400, actualYearBuilt: 1984, effectiveYearBuilt: 2010 },
          { stateCd: "F1", livingArea: 400, actualYearBuilt: 1990 },
        ],
      }),
    );
    expect(m.parcel.request_identifier).toBe("3001");
    expect(m.structures).toHaveLength(3);
    expect(m.structures.map((s) => s.ordinal)).toEqual([0, 1, 2]);
    expect(m.parcel).toMatchObject({
      property_structure_built_year: 1984,
      year_built_rule: "largest_main_improvement",
    });
  });

  it("A-04-TC-008 two accounts with one situs → two rows, no merge", () => {
    const a = mapOne(
      a04Record({ pID: 4001, geoID: "0400000001", streetNum: "500", streetName: "SHARED" }),
      0,
    );
    const b = mapOne(
      a04Record({ pID: 4002, geoID: "0400000002", streetNum: "500", streetName: "SHARED" }),
      1,
    );
    expect(a.parcel.request_identifier).not.toBe(b.parcel.request_identifier);
    expect(JSON.stringify(a.parcel.situs_address)).toBe(JSON.stringify(b.parcel.situs_address));
  });

  it("key = String(pID) exactly; geoID kept as a string with its leading zeros", () => {
    const m = mapOne(a04Record({ pID: 221829, geoID: "0223120506" }));
    expect(m.parcel.request_identifier).toBe("221829");
    expect(m.parcel.geo_id).toBe("0223120506");
    expect(m.geoids).toEqual([
      { geo_id: "0223120506", request_identifier: "221829", prop_type: "R" },
    ]);
    const p = mapOne(a04Record({ pID: 5, geoID: "", propType: "P" }));
    expect(p.parcel.geo_id).toBeNull();
    expect(p.geoids).toEqual([]);
  });

  it.each(["R", "P", "MH", "MN"])("prop_type %s loads; county_emit only for R", (t) => {
    const m = mapOne(a04Record({ pID: 6, geoID: "06", propType: t }));
    expect(m.parcel.prop_type).toBe(t);
    expect(m.parcel.county_emit).toBe(t === "R");
  });

  it("an unknown prop_type is an invalid record", () => {
    expect(() => mapOne(a04Record({ pID: 7, geoID: "07", propType: "X" }))).toThrow(
      InvalidRecordError,
    );
  });

  it("STATE_CODES maps only cited codes: A4 is not assumed condo; unmapped → null + enum_lacks_value", () => {
    expect(propertyTypeOf("A4").property_type).not.toBe("Condominium");
    expect(propertyTypeOf("ZZ9")).toEqual({
      property_type: null,
      property_usage_type: null,
      missing_reason: "enum_lacks_value",
    });
    for (const entry of Object.values(STATE_CODES)) expect(entry.source).toBe(A02_PILOT_MAPPING);
    expect(Object.keys(STATE_CODES)).toHaveLength(11);
    // a non-emitted class (P) with an unmapped code stays null with its reason
    const m = mapOne(a04Record({ pID: 8, geoID: "08", stateCd: "ZZ9", propType: "P" }));
    expect(m.parcel).toMatchObject({
      property_type: null,
      property_type_missing_reason: "enum_lacks_value",
      property_type_rule: null,
      property_type_note: null,
    });
  });

  it("an R account with an unmapped state code validates: improvement_fallback from the record's own improvements only", () => {
    const withImprv = mapOne(
      a04Record({
        pID: 9,
        geoID: "09",
        stateCd: "F5",
        improvements: [{ stateCd: "F5", livingArea: 900, actualYearBuilt: 1990 }],
      }),
    );
    expect(withImprv.parcel).toMatchObject({
      property_type: "Building",
      property_usage_type: null,
      property_type_missing_reason: null,
      property_type_rule: "improvement_fallback",
    });
    expect(withImprv.parcel.property_type_note).toContain("F5");
    expect(withImprv.parcel.property_type_note).toContain("1 improvement");
    const bare = mapOne(a04Record({ pID: 10, geoID: "10", stateCd: "E1" }));
    expect(bare.parcel).toMatchObject({
      property_type: "LandParcel",
      property_type_rule: "improvement_fallback",
      property_type_missing_reason: null,
    });
    expect(bare.parcel.property_type_note).toContain("no improvement");
    // never a residential or condominium guess
    for (const p of [withImprv.parcel.property_type, bare.parcel.property_type])
      expect(["SingleFamily", "Condominium", "Townhouse", "MultipleFamily"]).not.toContain(p);
  });

  it("a mapped code keeps its table value and rule state_code_table", () => {
    const m = mapOne(a04Record({ pID: 11, geoID: "11", stateCd: "A1" }));
    expect(m.parcel).toMatchObject({
      property_type: "SingleFamily",
      property_type_rule: "state_code_table",
    });
    expect(m.parcel.property_type_note).toBeNull();
    expect(propertyTypeOf("A4").property_type).toBe("Townhouse"); // A4 unchanged (unverified)
  });

  it("propertyFields (the County/shared-seed writer) gives every R account a lexicon property_type", () => {
    const rec = parseTcadRecord({
      ...a04Record({ pID: 12, geoID: "12", stateCd: "F5", improvements: [] }),
    });
    expect(propertyFields(rec)).toMatchObject({
      property_type: "LandParcel",
      property_type_rule: "improvement_fallback",
    });
    const rec2 = parseTcadRecord({
      ...a04Record({
        pID: 13,
        geoID: "13",
        stateCd: "E1",
        improvements: [{ stateCd: "E1", livingArea: 100, actualYearBuilt: 2000 }],
      }),
    });
    expect(propertyFields(rec2).property_type).toBe("Building");
    const mh = parseTcadRecord({
      ...a04Record({ pID: 14, geoID: "14", stateCd: "M1", propType: "MH" }),
    });
    expect(propertyFields(mh).property_type).toBeNull();
  });
});

// ---------- T026 TcadBackbone: supplemental refused, reconciliation, fan-out, replay ----------
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync as writeFile } from "node:fs";
import { dirname, join as joinPath } from "node:path";
import { verifyExport } from "../../../travis/tcad/export-verify.js";
import {
  runTcadBackbone,
  type BackboneDeps,
  type BackboneInput,
  type TrackOp,
  type ChunkOutcome,
} from "../../../travis/tcad/workflow.js";
import { runTcadChunk } from "../../../travis/tcad/chunk.js";
import { readChunkFile } from "../../../travis/tcad/process.js";
import { reconcile } from "../../../travis/tcad/reconcile.js";

const fileSha = (p: string): string => createHash("sha256").update(readFileSync(p)).digest("hex");

function backbone(
  records: Record<string, unknown>[],
  opts: {
    chunkSize?: number;
    window?: number;
    seedPids?: string[];
    onChunk?: (n: number) => void;
    failChunk?: number;
  } = {},
) {
  const zip = writeExportZip(records);
  const ops: TrackOp[] = [];
  const parcels: Array<Record<string, unknown>> = [];
  const recon: Array<{ class: string }> = [];
  const journal = new Map<string, unknown>();
  const dispatched: number[] = [];
  let inFlight = 0;
  let peak = 0;
  const input: BackboneInput = {
    jobId: "travis-a04-202610220400",
    mode: opts.seedPids ? "pilot" : "full",
    asOf: "2026-10-22",
    exportPath: zip,
    receipt: {
      url: "https://traviscad.org/x.zip",
      sha256: fileSha(zip),
      captured_at: "2026-10-19T21:33:41.241Z",
    },
    runDir: joinPath(dirname(zip), "runs/travis-a04-202610220400"),
    chunkSize: opts.chunkSize ?? 2,
    window: opts.window ?? 2,
    ...(opts.seedPids ? { seedPids: opts.seedPids } : {}),
  };
  let fail = opts.failChunk;
  const merge = async (op: TrackOp & { artifactPath?: string }) => {
    ops.push(op);
    if (op.kind === "chunk" && op.artifactPath) {
      const c = readChunkFile(op.artifactPath);
      parcels.push(...c.rows.map((r) => r.parcel as unknown as Record<string, unknown>));
      recon.push(...c.reconciliation);
    }
    return { rowsWritten: 0 };
  };
  const deps: BackboneDeps = {
    step: async (name, fn) => {
      if (journal.has(name)) return journal.get(name) as never;
      const v = await fn();
      journal.set(name, v);
      return v;
    },
    merge,
    verify: (p, s) => verifyExport(p, s),
    waitForHuman: async () => {
      throw new Error("must not wait");
    },
    download: async () => {
      throw new Error("must not download");
    },
    runChunk: async (spec) => {
      const key = `child-${spec.n}`;
      if (journal.has(key)) return journal.get(key) as ChunkOutcome;
      dispatched.push(spec.n);
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      try {
        await new Promise((r) => setTimeout(r, 2));
        if (fail === spec.n) {
          fail = undefined;
          throw new Error(`synthetic crash in chunk ${spec.n}`);
        }
        opts.onChunk?.(spec.n);
        const out = await runTcadChunk(spec, { merge });
        journal.set(key, out);
        return out;
      } finally {
        inFlight -= 1;
      }
    },
    listInputs: () =>
      readdirSync(dirname(zip))
        .filter((n) => n.endsWith(".zip"))
        .map((n) => joinPath(dirname(zip), n)),
    records: (p) => streamExportRecords(p),
    now: () => new Date("2026-10-22T04:00:00Z"),
  };
  return { zip, input, deps, ops, parcels, recon, dispatched, peak: () => peak };
}

const five = () => [1, 2, 3, 4, 5].map((i) => a04Record({ pID: 7000 + i, geoID: `070000000${i}` }));

describe("T026 TcadBackbone", () => {
  it("A-04-TC-009 a supplemental export put in the input dir mid-run is refused, not mixed in", async () => {
    const b = backbone(five(), {
      onChunk: (n) => {
        if (n === 0)
          writeExportZip(
            [a04Record({ pID: 9999, geoID: "0999999999" })],
            "2026_20Certified_20JSON_20SUPP_201_2008012026.zip",
            dirname(b.zip),
          );
      },
    });
    const out = await runTcadBackbone(b.input, b.deps);
    expect(out.status).toBe("complete");
    expect(out.refused_inputs).toEqual([
      {
        file: "2026_20Certified_20JSON_20SUPP_201_2008012026.zip",
        reason: "supplemental_export_not_mixed",
      },
    ]);
    expect(b.parcels.map((p) => p.request_identifier).sort()).toEqual([
      "7001",
      "7002",
      "7003",
      "7004",
      "7005",
    ]);
    expect(new Set(b.parcels.map((p) => p.export_sha256))).toEqual(
      new Set([b.input.receipt.sha256]),
    );
  });

  it("reconciliation: seed = loaded + dead + invalid + transform_failure; dead kept in dead.json; confidential not subtracted", async () => {
    const recs: Record<string, unknown>[] = [
      ...five(),
      a04Record({ pID: 7006, geoID: "0700000006", propType: "X" }),
      a04Record({ pID: 7007, geoID: "0700000007", confidentialCode: "Q" }),
    ];
    const b = backbone(recs, { chunkSize: 3 });
    // one record whose text is not JSON (cut from the export layout): dead
    const { buildZip } = await import("../../fixtures/synthetic-zip.js");
    const text = JSON.stringify(recs, null, 1).replace('"pID": 7003,', '"pID": 7003,, ');
    writeFile(
      b.zip,
      buildZip([{ name: "Travis-protaxExport-20260719.json", data: Buffer.from(text) }]),
    );
    b.input.receipt.sha256 = fileSha(b.zip);
    const out = await runTcadBackbone(b.input, b.deps);
    expect(out.reconciliation).toMatchObject({
      n: 7,
      loaded: 5,
      dead: 1,
      invalid: 1,
      transform_failure: 0,
      difference: 2,
      unexplained: 0,
    });
    expect(out.summary.redacted).toBe(1);
    const dead = JSON.parse(readFileSync(joinPath(b.input.runDir, "dead.json"), "utf8")) as Array<{
      ordinal: number;
    }>;
    expect(dead.map((d) => d.ordinal)).toEqual([2]);
    expect(b.recon).toHaveLength(7);
    expect(b.ops.filter((o) => o.kind === "limitations")).toHaveLength(1);
    expect(
      b.ops.filter((o) => o.kind === "run").map((o) => (o as { status: string }).status),
    ).toEqual(["running", "complete"]);
    expect(() => reconcile(8, [out.summary])).toThrow(/does not reconcile/);
  });

  it("fans out TcadChunk children of chunkSize records within the backpressure window", async () => {
    const recs = Array.from({ length: 9 }, (_, i) =>
      a04Record({ pID: 7100 + i, geoID: `071000000${i}` }),
    );
    const b = backbone(recs, { chunkSize: 2, window: 2 });
    const out = await runTcadBackbone(b.input, b.deps);
    expect(out.chunks).toBe(5);
    expect(b.dispatched).toEqual([0, 1, 2, 3, 4]);
    expect(b.peak()).toBeLessThanOrEqual(2);
    for (const f of readdirSync(joinPath(b.input.runDir, "chunks")))
      expect(f).not.toMatch(/ndjson\.gz$/);
  });

  it("journal replay re-runs only the unfinished chunk", async () => {
    const recs = Array.from({ length: 6 }, (_, i) =>
      a04Record({ pID: 7200 + i, geoID: `072000000${i}` }),
    );
    const b = backbone(recs, { chunkSize: 2, window: 1, failChunk: 1 });
    await expect(runTcadBackbone(b.input, b.deps)).rejects.toThrow(/synthetic crash in chunk 1/);
    expect(b.dispatched).toEqual([0, 1]);
    b.dispatched.length = 0;
    const out = await runTcadBackbone(b.input, b.deps);
    expect(b.dispatched).toEqual([1, 2]);
    expect(out.reconciliation.loaded).toBe(6);
    expect(existsSync(joinPath(b.input.runDir, "dead.json"))).toBe(true);
  });
});

// ---------- T027 County group (write-group) ----------
import { mkdtempSync as mkTmp } from "node:fs";
import { tmpdir as osTmp } from "node:os";
import { listZipEntries, openZipEntry } from "../../../travis/lib/zip-entry.js";
import {
  COUNTY_FIELD_MAP,
  assertCoverage,
  coverageReport,
  planCountyGroup,
  writeCountyZips,
  type GroupInput,
} from "../../../travis/tcad/write-group.js";

const GROUP_CIDS = {
  seed: "bafkreibhurphpjdq33ysit57jtzmdldgngepsdbsw4vm7esawth2ezgaxu",
  county: "bafkreia6tjziby3upxmidymud5iusd32urrztslgrudkwysc7ydmxoekuq",
  propertyImprovement: "bafkreicyzywzwhmguojpi2otgrwsyi37le3u4lnavljbxu76cnrudxaxfu",
};

function groupInput(
  raw: Record<string, unknown>,
  coordinate?: GroupInput["coordinate"],
): GroupInput {
  const m = mapOne(raw);
  const red = redactRecord(raw);
  return {
    pID: m.parcel.request_identifier,
    geoId: m.parcel.geo_id,
    propType: m.parcel.prop_type,
    record: red.record,
    yearBuilt: m.parcel.property_structure_built_year,
    exportPoint:
      m.parcel.export_point_lat === null || m.parcel.export_point_lon === null
        ? null
        : {
            lat: m.parcel.export_point_lat,
            lon: m.parcel.export_point_lon,
            kind: m.parcel.export_point_kind,
          },
    ...(coordinate ? { coordinate } : {}),
  };
}

const unzipText = async (path: string): Promise<Record<string, string>> => {
  const out: Record<string, string> = {};
  for (const e of listZipEntries(path)) {
    const chunks: Buffer[] = [];
    for await (const c of openZipEntry(path, e)) chunks.push(c as Buffer);
    out[e.name] = Buffer.concat(chunks).toString("utf8");
  }
  return out;
};

describe("T027 County group", () => {
  const inputs = (): GroupInput[] => [
    groupInput(
      a04Record({
        pID: 8001,
        geoID: "0800000001",
        firstName: "Zz",
        lastName: "Synthetic",
        improvements: [{ stateCd: "A1", livingArea: 1500, actualYearBuilt: 1990 }],
      }),
      { latitude: 30.31, longitude: -97.71, source: "gis_centroid" },
    ),
    groupInput(a04Record({ pID: 8002, geoID: "0800000002" }), {
      latitude: 30.32,
      longitude: -97.72,
      source: "permit_point",
    }),
    groupInput(a04Record({ pID: 8003, geoID: "0800000003" }), {
      latitude: null,
      longitude: null,
      source: "none",
    }),
    groupInput(
      a04Record({
        pID: 8004,
        geoID: "0800000004",
        ownerName: "ZZCONFIDENTIALSENTINEL",
        firstName: "Zz",
        lastName: "ZZCONFIDENTIALSENTINEL",
        confidentialCode: "Q",
      }),
    ),
    groupInput(a04Record({ pID: 8005, geoID: "", propType: "P" })),
    groupInput(a04Record({ pID: 8006, geoID: "0800000006", propType: "MH" })),
    groupInput(a04Record({ pID: 8007, geoID: "0800000007", propType: "MN" })),
  ];

  it("A-04-TC-002 R only, one <pID>.zip each, geometry only for gis_centroid, never a permit point; no redacted owner field", async () => {
    const plan = planCountyGroup(inputs(), GROUP_CIDS);
    expect(plan.groups.map((g) => g.pID)).toEqual(["8001", "8002", "8003", "8004"]);
    expect(plan.out_of_scope).toEqual([
      { pID: "8005", prop_type: "P" },
      { pID: "8006", prop_type: "MH" },
      { pID: "8007", prop_type: "MN" },
    ]);
    const dir = mkTmp(joinPath(osTmp(), "a04-group-"));
    const paths = writeCountyZips(dir, plan.groups);
    expect(readdirSync(dir).sort()).toEqual(["8001.zip", "8002.zip", "8003.zip", "8004.zip"]);
    const files = await Promise.all(paths.map(unzipText));
    expect(Object.keys(files[0] ?? {})).toContain("data/geometry.json");
    expect(files[0]?.["data/geometry.json"]).toContain('"latitude": 30.31');
    expect(Object.keys(files[1] ?? {})).not.toContain("data/geometry.json");
    expect(JSON.stringify(files[1])).not.toContain("30.32");
    expect(Object.keys(files[2] ?? {})).not.toContain("data/geometry.json");
    expect(plan.groups.map((g) => g.geometry_rule)).toEqual([
      "gis_centroid",
      "none",
      "none",
      "unassembled_pilot_export_point",
    ]);
    const redacted = files[3] ?? {};
    expect(
      Object.keys(redacted).filter((n) => /\/(person|company|mailing_address)_/.test(n)),
    ).toEqual([]);
    expect(JSON.stringify(redacted)).not.toContain("ZZCONFIDENTIALSENTINEL");
  });

  it("A-04-TC-002 the transform coverage report lists every mapped field with extracted: true", () => {
    const plan = planCountyGroup(inputs(), GROUP_CIDS);
    const rows = coverageReport(plan.groups);
    expect(rows.map((r) => r.field)).toEqual([
      "owner_name",
      "mailing_address",
      "situs",
      "year_built",
      "improvements",
      "sale_date",
      "geometry",
    ]);
    for (const r of rows) expect(r).toMatchObject({ extracted: true });
    expect(() => assertCoverage(rows)).not.toThrow();
  });

  it("A-04-TC-002 a field removed from a copy of the map fails naming that field", () => {
    const plan = planCountyGroup(inputs(), GROUP_CIDS);
    const { sale_date: _gone, ...copy } = COUNTY_FIELD_MAP;
    expect(() => coverageReport(plan.groups, copy as typeof COUNTY_FIELD_MAP)).toThrow(/sale_date/);
    const none = coverageReport(plan.groups.filter((g) => g.pID === "8003"));
    expect(() => assertCoverage(none)).toThrow(/geometry/);
  });
});
