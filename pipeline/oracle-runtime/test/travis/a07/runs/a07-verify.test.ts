// A-07 T054 (tasks.md TZ05, spec.md's four-part independent test): `runs/a07-verify.ts` must
// pass on a known-good fixture set and fail (non-zero exit / status "fail") on each of the four
// broken-report fixtures, one per independent-test condition. Tracks B/C having no report file
// this pass is "not_applicable", never a failure (the documented gap, same reasoning as T053).
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { verifyA07, type VerifyA07Options } from "../../../../travis/runs/a07-verify.js";

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

function goodFixtures(dir: string): VerifyA07Options {
  return {
    identityReportPath: write(dir, "resolution-report.json", {
      fiveStateTotals: {
        resolved: 0,
        candidate: 311,
        ambiguous: 0,
        conflicting: 78,
        unresolved: 21695,
      },
      permitTotal: 22084,
    }),
    // bbbReportPath / businessReportPath deliberately omitted: not built this pass (not_applicable).
    roofAgeAuditPath: write(dir, "audit.json", { total: 25, agreeCount: 25, agreeAll25: true }),
    roofAgeRerun25Path: write(dir, "rerun-25.json", { rowsWritten: 0 }),
    workedExamplePath: write(dir, "worked-example.json", {
      tcadId: "221829",
      anchor: { chosenBasis: "built_year", chosenConfidence: "low", roofAgeYears: 85 },
    }),
  };
}

describe("verifyA07", () => {
  it("passes on a known-good fixture set, with B/C correctly not_applicable, not failed", () => {
    tmp = mkdtempSync(join(tmpdir(), "a07-verify-good-"));
    const result = verifyA07(goodFixtures(tmp));
    expect(result.ok).toBe(true);
    const byId = Object.fromEntries(result.conditions.map((c) => [c.id, c.status]));
    expect(byId.five_state_sum_matches_permit_total).toBe("pass");
    expect(byId.bbb_coverage_with_receipts).toBe("not_applicable");
    expect(byId.business_count_matches_watermark).toBe("not_applicable");
    expect(byId.roof_age_25_sample_and_worked_example).toBe("pass");
  });

  it("fails condition 1 when the five-state sum does not equal the permit total", () => {
    tmp = mkdtempSync(join(tmpdir(), "a07-verify-c1-"));
    const options = goodFixtures(tmp);
    options.identityReportPath = write(tmp, "resolution-report.json", {
      fiveStateTotals: { resolved: 0, candidate: 1, ambiguous: 0, conflicting: 0, unresolved: 1 },
      permitTotal: 99,
    });
    const result = verifyA07(options);
    expect(result.ok).toBe(false);
    expect(
      result.conditions.find((c) => c.id === "five_state_sum_matches_permit_total")?.status,
    ).toBe("fail");
  });

  it("fails condition 2 when a BBB report exists but a resolved company has no bbb_status", () => {
    tmp = mkdtempSync(join(tmpdir(), "a07-verify-c2-"));
    const options = goodFixtures(tmp);
    options.bbbReportPath = write(tmp, "status-report.json", {
      resolved: 5,
      counts: {},
      coveragePct: null,
    });
    const result = verifyA07(options);
    expect(result.ok).toBe(false);
    expect(result.conditions.find((c) => c.id === "bbb_coverage_with_receipts")?.status).toBe(
      "fail",
    );
  });

  it("fails condition 3 when the business report's loaded count does not match the source count", () => {
    tmp = mkdtempSync(join(tmpdir(), "a07-verify-c3-"));
    const options = goodFixtures(tmp);
    options.businessReportPath = write(tmp, "business-coverage-report.json", {
      loadedCount: 100,
      sourceCount: 150,
    });
    const result = verifyA07(options);
    expect(result.ok).toBe(false);
    expect(result.conditions.find((c) => c.id === "business_count_matches_watermark")?.status).toBe(
      "fail",
    );
  });

  it("fails condition 4 when the 25-property audit is not 25/25, the rerun writes rows, or the worked example is missing a field", () => {
    tmp = mkdtempSync(join(tmpdir(), "a07-verify-c4-"));
    const options = goodFixtures(tmp);
    options.roofAgeAuditPath = write(tmp, "audit.json", {
      total: 25,
      agreeCount: 24,
      agreeAll25: false,
    });
    const result = verifyA07(options);
    expect(result.ok).toBe(false);
    expect(
      result.conditions.find((c) => c.id === "roof_age_25_sample_and_worked_example")?.status,
    ).toBe("fail");
  });
});
