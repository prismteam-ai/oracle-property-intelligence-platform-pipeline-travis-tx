// T038: the vendored kit roof-age estimator is unmodified, and the Travis profile drives it.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  TRAVIS_ROOF_AGE_PROFILE,
  TRAVIS_ROOF_AGE_SOURCE,
  compiledTravisRoofAgeProfile,
  estimateTravisRoofAge,
  type TravisRoofPermit,
} from "../../travis/roof-age/travis-roof-age-profile.js";

const ESTIMATOR = fileURLToPath(
  new URL("../../kit/use-oracle/runtime/src/roof-age/estimator.ts", import.meta.url),
);
const VENDORED = fileURLToPath(new URL("../../kit/VENDORED.md", import.meta.url));

const FINISHED_AT = "2026-10-20T23:00:00.000Z";

function permit(over: Partial<TravisRoofPermit> = {}): TravisRoofPermit {
  return {
    permit_number: "2026-100001 BP",
    status_class: "closed",
    roofing: "roofing",
    issue_date: "2026-09-02",
    completed_date: "2026-09-20",
    ...over,
  };
}

describe("vendored estimator", () => {
  it("has the SHA-256 recorded in VENDORED.md", () => {
    const digest = createHash("sha256").update(readFileSync(ESTIMATOR)).digest("hex");
    const table = readFileSync(VENDORED, "utf8");
    const row = table
      .split("\n")
      .find((l) => l.includes("`use-oracle/runtime/src/roof-age/estimator.ts`"));
    expect(row, "VENDORED.md row for the estimator").toBeDefined();
    expect(row).toContain(`\`${digest}\``);
    expect(row).toContain("`skills/use-oracle/runtime/src/roof-age/estimator.ts`");
  });
});

describe("Travis roof-age profile", () => {
  it("is a valid kit roof-age profile with a stable digest", () => {
    const a = compiledTravisRoofAgeProfile();
    const b = compiledTravisRoofAgeProfile();
    expect(a.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(b.sha256).toBe(a.sha256);
    expect(a.version).toBe(TRAVIS_ROOF_AGE_PROFILE.version);
    expect(a.sources.map((s) => s.sourceSystem)).toEqual([TRAVIS_ROOF_AGE_SOURCE]);
  });

  it("maps only profile-emitted terms (no source text), so terms stay in profiles/", () => {
    const fields = TRAVIS_ROOF_AGE_PROFILE.sources.flatMap((s) => [
      ...s.statusMappings.map((m) => m.field),
      ...s.workMappings.map((m) => m.field),
    ]);
    expect(new Set(fields)).toEqual(new Set(["travis_status_class", "travis_roof_class"]));
  });

  it("a Final BP reroof with completed_date anchors permit_terminal_date / high", () => {
    const row = estimateTravisRoofAge({
      pID: "100008",
      finishedAt: FINISHED_AT,
      builtYear: 1985,
      permits: [permit()],
    });
    expect(row.estimate.anchor).toMatchObject({ type: "permit_terminal_date", date: "2026-09-20" });
    expect(row.estimate.confidence).toBe("high");
    expect(row.roof_date).toBe("2026-09-20");
    expect(row.estimate.estimatedAgeYears).toBe(0);
  });

  it("an Active replacement never resets roof age (P0-8)", () => {
    const older = permit({
      permit_number: "2014-000001 BP",
      issue_date: "2014-04-01",
      completed_date: "2014-05-01",
    });
    const active = permit({
      permit_number: "2026-200002 BP",
      status_class: "open",
      completed_date: null,
    });
    const row = estimateTravisRoofAge({
      pID: "1",
      finishedAt: FINISHED_AT,
      builtYear: 1990,
      permits: [older, active],
    });
    expect(row.roof_date).toBe("2014-05-01");
    expect(row.estimate.estimatedAgeYears).toBe(12);
    expect(row.estimate.evidence.permitOutcomeCounts.excludedOpenPrimaryRoofReplacement).toBe(1);
  });

  it("an Expired (stalled) replacement never resets roof age either", () => {
    const stalled = permit({ status_class: "stalled", completed_date: null });
    const row = estimateTravisRoofAge({
      pID: "1",
      finishedAt: FINISHED_AT,
      builtYear: 2001,
      permits: [stalled],
    });
    expect(row.estimate.anchor).toMatchObject({ type: "property_built_year", year: 2001 });
    expect(row.estimate.confidence).toBe("low");
    expect(row.roof_date).toBe("2001");
  });

  it("with no permit and no built year there is no roof date", () => {
    const row = estimateTravisRoofAge({
      pID: "1",
      finishedAt: FINISHED_AT,
      builtYear: null,
      permits: [],
    });
    expect(row.roof_date).toBeNull();
    expect(row.estimate.confidence).toBe("none");
  });

  it("a not-roofing permit is non-resetting work", () => {
    const row = estimateTravisRoofAge({
      pID: "1",
      finishedAt: FINISHED_AT,
      builtYear: null,
      permits: [permit({ roofing: "not_roofing" })],
    });
    expect(row.roof_date).toBeNull();
    expect(row.estimate.evidence.permitOutcomeCounts.excludedNonResettingWork).toBe(1);
  });

  it("as_of is the run finishedAt date, never today", () => {
    const row = estimateTravisRoofAge({
      pID: "1",
      finishedAt: FINISHED_AT,
      builtYear: 2000,
      permits: [],
    });
    expect(row.as_of).toBe("2026-10-20");
    expect(row.estimate.asOfDate).toBe("2026-10-20");
  });

  it("stamps the profile digest on every row", () => {
    const row = estimateTravisRoofAge({
      pID: "1",
      finishedAt: FINISHED_AT,
      builtYear: 2000,
      permits: [],
    });
    expect(row.estimate.policy.profileSha256).toBe(compiledTravisRoofAgeProfile().sha256);
    expect(row.profile).toEqual({
      version: TRAVIS_ROOF_AGE_PROFILE.version,
      sha256: compiledTravisRoofAgeProfile().sha256,
    });
  });
});
