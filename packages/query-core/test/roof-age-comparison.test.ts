// A-07 T047 (Track D, contracts/estimator.md § "View comparison (Track D3)", FR-017, NFR-004/
// SC-006): the view-derivation comparison harness must agree with the estimator's output
// 25/25 for the audited properties before any `--apply` is approved. This fixture test proves
// the harness itself: it reuses packages/query-core's own view-side derivation functions
// (derive.ts), never a reimplementation, and must flag any disagreement precisely.
import { describe, expect, it } from "vitest";
import { compareRoofAgeDerivations, type RoofAgeComparisonRow } from "../roof-age-comparison.js";

function agreeingRow(n: number): RoofAgeComparisonRow {
  return {
    tcadId: String(1_000_000 + n),
    asOf: "2026-10-22",
    roofDate: "2020-05-01",
    replacementMatch: true,
    newMatch: false,
    builtYear: 1990,
    estimator: { basis: "permit", confidence: "high", roofAgeYears: 6 },
  };
}

describe("compareRoofAgeDerivations", () => {
  it("reports 25/25 agreement when the view side and the estimator side match", () => {
    const rows = Array.from({ length: 25 }, (_, i) => agreeingRow(i));
    const result = compareRoofAgeDerivations(rows);
    expect(result.total).toBe(25);
    expect(result.agreeCount).toBe(25);
    expect(result.agreeAll25).toBe(true);
    expect(result.rows.every((r) => r.agree)).toBe(true);
  });

  it("flags a basis mismatch and does not report full agreement", () => {
    const rows: RoofAgeComparisonRow[] = [
      ...Array.from({ length: 24 }, (_, i) => agreeingRow(i)),
      {
        tcadId: "9999999",
        asOf: "2026-10-22",
        roofDate: null,
        replacementMatch: false,
        newMatch: false,
        builtYear: null,
        // Estimator disagrees: it claims a permit basis where the view side has no roof_date.
        estimator: { basis: "permit", confidence: "high", roofAgeYears: 3 },
      },
    ];
    const result = compareRoofAgeDerivations(rows);
    expect(result.total).toBe(25);
    expect(result.agreeCount).toBe(24);
    expect(result.agreeAll25).toBe(false);
    const mismatch = result.rows.find((r) => r.tcadId === "9999999");
    expect(mismatch?.agree).toBe(false);
    expect(mismatch?.mismatchFields).toEqual(
      expect.arrayContaining(["basis", "confidence", "roofAgeYears"]),
    );
    expect(mismatch?.viewSide).toEqual({
      basis: "unknown",
      confidence: "none",
      roofAgeYears: null,
    });
  });

  it("agrees on an unknown basis when both sides have no anchor", () => {
    const row: RoofAgeComparisonRow = {
      tcadId: "5000000",
      asOf: "2026-10-22",
      roofDate: null,
      replacementMatch: false,
      newMatch: false,
      builtYear: null,
      estimator: { basis: "unknown", confidence: "none", roofAgeYears: null },
    };
    const result = compareRoofAgeDerivations([row]);
    expect(result.rows[0]?.agree).toBe(true);
  });

  it("agreeAll25 is false when fewer than 25 rows are supplied, even if all agree", () => {
    const rows = Array.from({ length: 5 }, (_, i) => agreeingRow(i));
    const result = compareRoofAgeDerivations(rows);
    expect(result.agreeCount).toBe(5);
    expect(result.agreeAll25).toBe(false);
  });
});
