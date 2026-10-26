// T035: find the pilot parcels in the TCAD export without loading it: stream the ZIP entry,
// split depth-1 records, prefilter on the raw `"geoID": "<id>"` text, parse only the hits,
// and resolve tcad_id → pID exactly as strings.
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  readSubset,
  resolveTcadIds,
  scanTcadSubset,
  writeSubset,
} from "../../travis/pilot/capture-tcad-subset.js";
import { buildZip } from "../fixtures/synthetic-zip.js";
import { tcadExportText, tcadRecord } from "../fixtures/tcad-records.js";

const ENTRY = "Travis-protaxExport-20260719.json";
const ZIP_SHA = "6f7a7585" + "0".repeat(52) + "2346";

function exportZip(): { zip: string; text: string } {
  const records = [
    tcadRecord({ pID: 100008, geoID: "0100030105" }), // matched (one R)
    tcadRecord({ pID: 100012, geoID: "0100030106" }), // matched: the P account below is not residential
    tcadRecord({ pID: 900001, geoID: "0100030106", propType: "P" }),
    tcadRecord({ pID: 200001, geoID: "0200000001" }), // ambiguous: two R records
    tcadRecord({ pID: 200002, geoID: "0200000001" }),
    tcadRecord({ pID: 300001, geoID: "100030107" }), // the wanted id has a leading zero: no match
    tcadRecord({ pID: 400001, geoID: "0400000001" }), // not wanted, never parsed
  ];
  const text = tcadExportText(records);
  const dir = mkdtempSync(join(tmpdir(), "tcad-"));
  const zip = join(dir, "2026 Certified JSON.zip");
  writeFileSync(
    zip,
    buildZip([
      { name: "Layout.pdf", data: Buffer.from("pdf") },
      { name: ENTRY, data: Buffer.from(text) },
    ]),
  );
  return { zip, text };
}

const WANTED = ["0100030105", "0100030106", "0200000001", "0100030107", "0999999999", null];
const now = () => new Date("2026-10-20T22:30:00.000Z");

describe("scanTcadSubset", () => {
  it("parses only the records whose geoID text matches a wanted id", async () => {
    const { zip } = exportZip();
    const result = await scanTcadSubset({ zipPath: zip, wanted: WANTED, zipSha256: ZIP_SHA, now });
    expect(result.receipt.scan.records_scanned).toBe(7);
    // 100008, 100012, 900001, 200001, 200002 — not 300001 (geoID 100030107) and not 400001.
    expect(result.receipt.scan.records_parsed).toBe(5);
    expect(result.hits.map((h) => h.pID).sort()).toEqual([
      "100008",
      "100012",
      "200001",
      "200002",
      "900001",
    ]);
  });

  it("resolves exactly one residential pID as matched, else no_tcad_geoid / ambiguous_geoid", async () => {
    const { zip } = exportZip();
    const result = await scanTcadSubset({ zipPath: zip, wanted: WANTED, zipSha256: ZIP_SHA, now });
    expect(result.resolution).toEqual([
      { tcad_id: "0100030105", status: "matched", pIDs: ["100008"] },
      { tcad_id: "0100030106", status: "matched", pIDs: ["100012"] },
      { tcad_id: "0200000001", status: "ambiguous_geoid", pIDs: ["200001", "200002"] },
      { tcad_id: "0100030107", status: "no_tcad_geoid", pIDs: [] },
      { tcad_id: "0999999999", status: "no_tcad_geoid", pIDs: [] },
      { tcad_id: null, status: "no_tcad_geoid", pIDs: [] },
    ]);
    expect(result.receipt.counts).toEqual({
      wanted: 6,
      matched: 2,
      no_tcad_geoid: 3,
      ambiguous_geoid: 1,
    });
  });

  it("keeps only matched records in the subset, with their ordinals and per-record sha256", async () => {
    const { zip, text } = exportZip();
    const result = await scanTcadSubset({ zipPath: zip, wanted: WANTED, zipSha256: ZIP_SHA, now });
    expect(result.records.map((r) => [r.pID, r.ordinal])).toEqual([
      ["100008", 0],
      ["100012", 1],
    ]);
    const first = at(result.records, 0);
    // The record text is the exact bytes of the array element in the export.
    expect(text.includes(first.text)).toBe(true);
    expect(first.sha256).toBe(createHash("sha256").update(first.text).digest("hex"));
    expect(JSON.parse(first.text)).toMatchObject({ pID: 100008 });
  });

  it("writes a receipt with the zip sha256, entry name, record ordinals and per-record sha256", async () => {
    const { zip } = exportZip();
    const result = await scanTcadSubset({ zipPath: zip, wanted: WANTED, zipSha256: ZIP_SHA, now });
    expect(result.receipt).toMatchObject({
      source: "tcad-2026-certified-json",
      zip_sha256: ZIP_SHA,
      entry_name: ENTRY,
      captured_at: "2026-10-20T22:30:00.000Z",
    });
    expect(result.receipt.records).toEqual(
      result.records.map((r) => ({
        pID: r.pID,
        geoID: r.geoID,
        ordinal: r.ordinal,
        bytes: r.bytes,
        sha256: r.sha256,
      })),
    );
    const out = mkdtempSync(join(tmpdir(), "subset-"));
    await writeSubset(out, result);
    const receipt = JSON.parse(readFileSync(join(out, "receipt.json"), "utf8"));
    expect(receipt.records).toHaveLength(2);
    const back = readSubset(out);
    expect(back.map((r) => r.pID)).toEqual(["100008", "100012"]);
    expect(at(back, 0).record.pID).toBe(100008);
  });

  it("fails when the entry is not in the ZIP", async () => {
    const { zip } = exportZip();
    await expect(
      scanTcadSubset({
        zipPath: zip,
        wanted: WANTED,
        zipSha256: ZIP_SHA,
        entryName: "missing.json",
        now,
      }),
    ).rejects.toThrow(/missing\.json/);
  });
});

describe("resolveTcadIds", () => {
  it("compares as strings, without digit normalization", () => {
    const hits = [{ pID: "1", geoIDs: ["0100030105"], propType: "R" }];
    expect(resolveTcadIds(["100030105"], hits)).toEqual([
      { tcad_id: "100030105", status: "no_tcad_geoid", pIDs: [] },
    ]);
    expect(resolveTcadIds(["0100030105"], hits)).toEqual([
      { tcad_id: "0100030105", status: "matched", pIDs: ["1"] },
    ]);
  });

  it("deduplicates wanted ids and keeps their first-seen order", () => {
    const hits = [{ pID: "1", geoIDs: ["A"], propType: "R" }];
    expect(resolveTcadIds(["A", "A", null, null], hits).map((r) => r.tcad_id)).toEqual(["A", null]);
  });
});

/** The element at `i`, failing the test when it is absent. */
function at<T>(xs: readonly T[], i: number): T {
  const v = xs[i];
  if (v === undefined) throw new Error(`no element at ${i}`);
  return v;
}
