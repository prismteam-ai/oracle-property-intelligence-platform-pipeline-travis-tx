// A-07 T052 (Track D, contracts/report.md, data-model.md § "Manifest coverage contribution"):
// proves the shape `runs/a07-coverage.ts` must assemble from each track's report JSON files,
// on fixtures only. `runs/a07-coverage.ts` itself is Wave-5 work (T053) and is NOT built in
// this wave — this test is intentionally left red until T053 lands; it exists now so T053
// cannot land without first making it pass (constitution X/XXI/XXII, tests-first).
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { assembleA07Coverage } from "../../../../travis/runs/a07-coverage.js";

let tmp: string | undefined;
afterEach(() => {
  if (tmp !== undefined) rmSync(tmp, { recursive: true, force: true });
  tmp = undefined;
});

function write(dir: string, name: string, body: unknown): string {
  const path = join(dir, name);
  writeFileSync(path, JSON.stringify(body));
  return path;
}

describe("assembleA07Coverage", () => {
  it("assembles one manifest-coverage row per required metric, each carrying a derivation", () => {
    tmp = mkdtempSync(join(tmpdir(), "a07-coverage-"));
    const identityReport = write(tmp, "resolution-report.json", {
      resolved: 0,
      candidate: 2,
      ambiguous: 1,
      conflicting: 0,
      unresolved: 22_081,
      permitTotal: 22_084,
    });
    const bbbReport = write(tmp, "status-report.json", {
      resolved: 0,
      counts: {},
      coveragePct: null,
    });
    const businessReport = write(tmp, "business-coverage-report.json", {
      loadedCount: 150_000,
      sourceCount: 150_000,
    });
    const placesReport = write(tmp, "overture-probe-report.json", {
      licenceGatePassed: false,
      reason: "licence_gate_failed",
    });
    const mergeReport = write(tmp, "merge-property-owner-report.json", {
      property: { inputRecords: 493_246, canonical: 493_246 },
      owner: { inputRecords: 493_246, canonical: 493_246 },
      contractor: { inputRecords: 0, canonical: 0 },
    });
    const roofAgeReport = write(tmp, "full-roll-report.json", {
      byBasis: { permit: 100, new_construction: 20, built_year: 300, unknown: 50 },
      byConfidence: { high: 100, medium: 20, low: 300, none: 50 },
    });

    const rows = assembleA07Coverage({
      identityReportPath: identityReport,
      bbbReportPath: bbbReport,
      businessReportPath: businessReport,
      placesReportPath: placesReport,
      mergeReportPath: mergeReport,
      roofAgeReportPath: roofAgeReport,
    });

    const metrics = rows.map((r) => r.metric).sort();
    expect(metrics).toEqual(
      [
        "bbb_status_counts",
        "business_count",
        "contractor_five_state_totals",
        "merge_counts",
        "places_count_by_category",
        "roof_age_coverage",
      ].sort(),
    );
    for (const row of rows) {
      expect(row).toHaveProperty("derivation");
      expect(["published_rows", "capture_receipt", "aggregate_match"]).toContain(row.derivation);
      expect(row.limitation === null || typeof row.limitation === "string").toBe(true);
    }

    const totals = rows.find((r) => r.metric === "contractor_five_state_totals");
    expect(totals?.value).toEqual({
      resolved: 0,
      candidate: 2,
      ambiguous: 1,
      conflicting: 0,
      unresolved: 22_081,
    });

    const places = rows.find((r) => r.metric === "places_count_by_category");
    expect(places?.limitation).toBe("Places: not loaded · licence_gate_failed");

    const bbb = rows.find((r) => r.metric === "bbb_status_counts");
    expect(bbb?.limitation).toBe("not computable: 0 resolved companies");
  });

  it("degrades Track B and C to the documented-gap shape when their report paths are undefined (not built this pass)", () => {
    tmp = mkdtempSync(join(tmpdir(), "a07-coverage-"));
    const identityReport = write(tmp, "resolution-report.json", {
      resolved: 0,
      candidate: 2,
      ambiguous: 1,
      conflicting: 0,
      unresolved: 22_081,
      permitTotal: 22_084,
    });
    const mergeReport = write(tmp, "merge-property-owner-report.json", {
      entityTypes: {
        property: { inputRecords: 493_246, canonical: 493_246, refused: 0 },
        owner: { inputRecords: 493_246, canonical: 493_246, refused: 0 },
        contractor: { inputRecords: 0, canonical: 0, refused: 0 },
      },
    });
    const roofAgeReport = write(tmp, "full-roll-report.json", {
      byBasis: { permit: 100, new_construction: 20, built_year: 300, unknown: 50 },
      byConfidence: { high: 100, medium: 20, low: 300, none: 50 },
      total: 470,
    });

    const rows = assembleA07Coverage({
      identityReportPath: identityReport,
      bbbReportPath: undefined,
      businessReportPath: undefined,
      placesReportPath: undefined,
      mergeReportPath: mergeReport,
      roofAgeReportPath: roofAgeReport,
    });

    const bbb = rows.find((r) => r.metric === "bbb_status_counts");
    expect(bbb?.value).toBeNull();
    expect(bbb?.limitation).toBe("BBB: not run this pass · track_not_built");

    const business = rows.find((r) => r.metric === "business_count");
    expect(business?.value).toBeNull();
    expect(business?.limitation).toBe("Business: not loaded this pass · track_not_built");

    const places = rows.find((r) => r.metric === "places_count_by_category");
    expect(places?.value).toBeNull();
    expect(places?.limitation).toBe("Places: not loaded · track_not_built");

    for (const row of [bbb, business, places]) {
      expect(row?.derivation).toBeDefined();
      expect(
        row?.value === null || row?.value === undefined || typeof row?.value === "object",
      ).toBe(true);
    }

    const merge = rows.find((r) => r.metric === "merge_counts");
    expect(merge?.limitation).toBeNull();

    const roofAge = rows.find((r) => r.metric === "roof_age_coverage");
    expect(roofAge?.limitation).toBeNull();
  });

  it("flags a refused cross-TCAD merge in merge_counts' limitation instead of hiding it", () => {
    tmp = mkdtempSync(join(tmpdir(), "a07-coverage-"));
    const identityReport = write(tmp, "resolution-report.json", {
      resolved: 0,
      candidate: 0,
      ambiguous: 0,
      conflicting: 0,
      unresolved: 1,
      permitTotal: 1,
    });
    const mergeReport = write(tmp, "merge-property-owner-report.json", {
      entityTypes: {
        property: { inputRecords: 10, canonical: 9, refused: 1 },
        owner: { inputRecords: 10, canonical: 10, refused: 0 },
        contractor: { inputRecords: 0, canonical: 0, refused: 0 },
      },
    });
    const roofAgeReport = write(tmp, "full-roll-report.json", {
      byBasis: {},
      byConfidence: {},
      total: 0,
    });

    const rows = assembleA07Coverage({
      identityReportPath: identityReport,
      bbbReportPath: undefined,
      businessReportPath: undefined,
      placesReportPath: undefined,
      mergeReportPath: mergeReport,
      roofAgeReportPath: roofAgeReport,
    });

    const merge = rows.find((r) => r.metric === "merge_counts");
    expect(merge?.limitation).toBe("refused cross-TCAD merges on: property");
  });

  it("flags a roof-age basis/total mismatch in roof_age_coverage's limitation instead of hiding it", () => {
    tmp = mkdtempSync(join(tmpdir(), "a07-coverage-"));
    const identityReport = write(tmp, "resolution-report.json", {
      resolved: 0,
      candidate: 0,
      ambiguous: 0,
      conflicting: 0,
      unresolved: 1,
      permitTotal: 1,
    });
    const mergeReport = write(tmp, "merge-property-owner-report.json", {
      entityTypes: {
        property: { inputRecords: 1, canonical: 1, refused: 0 },
        owner: { inputRecords: 1, canonical: 1, refused: 0 },
        contractor: { inputRecords: 0, canonical: 0, refused: 0 },
      },
    });
    const roofAgeReport = write(tmp, "full-roll-report.json", {
      byBasis: { permit: 10, built_year: 10, unknown: 10 },
      byConfidence: {},
      total: 100,
    });

    const rows = assembleA07Coverage({
      identityReportPath: identityReport,
      bbbReportPath: undefined,
      businessReportPath: undefined,
      placesReportPath: undefined,
      mergeReportPath: mergeReport,
      roofAgeReportPath: roofAgeReport,
    });

    const roofAge = rows.find((r) => r.metric === "roof_age_coverage");
    expect(roofAge?.limitation).toBe(
      "roof-age basis counts (30) do not sum to the reported total (100)",
    );
  });
});
