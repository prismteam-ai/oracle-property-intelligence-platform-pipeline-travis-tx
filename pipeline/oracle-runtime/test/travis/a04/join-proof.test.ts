// A-04 T028 (A-04-TC-004, P0-5, oracle disagreement #15): the seeded 1,000-row geoID → pID
// join proof re-scans the export independently, plus the 1,000-row reverse proof (R pIDs from
// the export must each have a Query DB row with an identical request_identifier). Synthetic
// test input: an invented export and a fake Query DB.
import { describe, expect, it } from "vitest";
import { a04Record, writeExportZip } from "../../fixtures/a04/tcad/export.js";
import {
  JOIN_PROOF_SIZE,
  mulberry32,
  runJoinProof,
  sampleExportRPids,
} from "../../../travis/tcad/join-proof.js";
import { streamExportRecords } from "../../../travis/tcad/export-stream.js";

function exportZip() {
  const recs = [
    a04Record({ pID: 221829, geoID: "0223120506" }),
    a04Record({ pID: 300001, geoID: "0300000001" }),
    a04Record({ pID: 300002, geoID: "0300000002" }),
    a04Record({ pID: 300003, geoID: "0300000002" }), // shared geoID → ambiguous_geoid
    a04Record({ pID: 300004, geoID: "", propType: "P" }),
  ];
  return writeExportZip(recs);
}

const qdb = (rows: Array<[string, string]>) => ({
  resolveGeoIds: async (ids: readonly string[]) => {
    const m = new Map<string, string[]>();
    for (const id of ids)
      m.set(
        id,
        rows.filter(([g]) => g === id).map(([, p]) => p),
      );
    return m;
  },
  parcelIdsExist: async (ids: readonly string[]) =>
    new Set(ids.filter((id) => rows.some(([, p]) => p === id))),
});

describe("A-04-TC-004 join proof both ways", () => {
  it("A-04-TC-004 matched / no_tcad_geoid / ambiguous_geoid with 0 disagreements; reverse identical; seed recorded", async () => {
    const zip = exportZip();
    const rows: Array<[string, string]> = [
      ["0223120506", "221829"],
      ["0300000001", "300001"],
      ["0300000002", "300002"],
      ["0300000002", "300003"],
    ];
    const out = await runJoinProof({
      seed: 42,
      size: 1000,
      sampleAustinTcadIds: async () => ["0223120506", "0300000001", "0300000002", "0208011301"],
      ...qdb(rows),
      zipPath: zip,
      zipSha256: "0".repeat(64),
      exportRecords: () => streamExportRecords(zip),
    });
    expect(JOIN_PROOF_SIZE).toBe(1000);
    expect(out).toMatchObject({
      seed: 42,
      matched: 2,
      no_tcad_geoid: 1,
      ambiguous_geoid: 1,
      disagreements: 0,
      reverse_checked: 4,
      reverse_disagreements: 0,
      pass: true,
    });
  });

  it("A-04-TC-004 a Query DB link the export does not hold is a disagreement; a padded key fails the reverse proof", async () => {
    const zip = exportZip();
    const rows: Array<[string, string]> = [
      ["0223120506", "221830"],
      ["0300000001", "0300001"],
      ["0300000002", "300002"],
      ["0300000002", "300003"],
    ];
    const out = await runJoinProof({
      seed: 7,
      size: 1000,
      sampleAustinTcadIds: async () => ["0223120506"],
      ...qdb(rows),
      zipPath: zip,
      zipSha256: "0".repeat(64),
      exportRecords: () => streamExportRecords(zip),
    });
    expect(out.disagreements).toBe(1);
    expect(out.reverse_disagreements).toBeGreaterThan(0);
    expect(out.pass).toBe(false);
  });

  it("the reverse sample is seeded and R only", async () => {
    const zip = exportZip();
    const a = await sampleExportRPids(streamExportRecords(zip), 9, 2);
    const b = await sampleExportRPids(streamExportRecords(zip), 9, 2);
    expect(a).toEqual(b);
    expect(a).toHaveLength(2);
    expect(a).not.toContain("300004");
    expect(mulberry32(1)()).toBe(mulberry32(1)());
  });
});
