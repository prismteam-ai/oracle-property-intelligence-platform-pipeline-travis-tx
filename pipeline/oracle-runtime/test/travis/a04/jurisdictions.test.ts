// A-04 T056 (A-04-TC-048, A-04-TC-049, AC-15, FR-015, FR-022): every permit jurisdiction of
// pipeline/docs/travis-sources.yaml is either supported with its count, total and time, or a
// limitation with its evidence URL. Reads the committed catalog and the curated profile; the
// counts passed in are synthetic test input.
import { describe, expect, it } from "vitest";
import { readCatalog } from "../../../travis/discovery/write-catalog.js";
import { TRAVIS_JURISDICTION_PROFILE } from "../../../travis/profiles/jurisdictions.js";
import {
  buildJurisdictionsReport,
  jurisdictionLimitations,
  recordsRequestText,
} from "../../../travis/permits/jurisdictions-report.js";

const catalog = readCatalog();
const jurisdictions = catalog.permits?.jurisdictions ?? [];

describe("A-04-TC-048 jurisdictions: Austin supported; the 22 others limitations with evidence", () => {
  it("A-04-TC-048 23 rows from travis-sources.yaml, the same keys as profiles/jurisdictions.ts", () => {
    expect(jurisdictions).toHaveLength(23);
    expect(catalog.permits?.expected_jurisdiction_count).toBe(23);
    expect(jurisdictions.map((j) => j.key).sort()).toEqual(
      TRAVIS_JURISDICTION_PROFILE.map((p) => p.key).sort(),
    );
  });

  it("A-04-TC-048 Austin is supported with captured, source_total and captured_at; 22 absent, one limitation each, exact text", () => {
    const r = buildJurisdictionsReport({
      jurisdictions,
      profile: TRAVIS_JURISDICTION_PROFILE,
      austin: {
        captured: 2_381_226,
        sourceTotal: 2_381_226,
        capturedAt: "2026-10-22T03:40:00.000Z",
      },
      located: {},
    });
    expect(r.supported).toEqual([
      {
        key: "austin",
        captured: 2_381_226,
        source_total: 2_381_226,
        captured_at: "2026-10-22T03:40:00.000Z",
      },
    ]);
    expect(r.absent).toHaveLength(22);
    expect(r.limitations).toHaveLength(22);
    const lakeway = jurisdictions.find((j) => j.key === "lakeway");
    expect(r.limitations).toContainEqual({
      sourceKey: "permits:lakeway",
      code: "records_request_not_filed",
      text: `Lakeway: no public permit history captured (records request, not filed); evidence ${lakeway?.evidence_url ?? ""}`,
      count: null,
      evidenceUrl: lakeway?.evidence_url ?? null,
    });
    for (const l of r.limitations) {
      expect(l.text).toMatch(
        /^.+: no public permit history captured \(records request, not filed\); evidence https:\/\//,
      );
    }
    expect(recordsRequestText("Bee Cave", "https://example.test/x")).toBe(
      "Bee Cave: no public permit history captured (records request, not filed); evidence https://example.test/x",
    );
    expect(jurisdictionLimitations(jurisdictions)).toEqual(r.limitations);
  });

  it("A-04-TC-049 Lakeway, Bee Cave, Pflugerville: own_permits_captured false; Austin-issued permits located there counted (full purpose + ETJ)", () => {
    const r = buildJurisdictionsReport({
      jurisdictions,
      profile: TRAVIS_JURISDICTION_PROFILE,
      austin: { captured: 10, sourceTotal: 10, capturedAt: "2026-10-22T03:40:00.000Z" },
      located: {
        "LAKEWAY FULL PURPOSE": 6827,
        "BEE CAVE FULL PURPOSE": 4822,
        "PFLUGERVILLE FULL PURPOSE": 1117,
        "PFLUGERVILLE ETJ": 592,
        "AUSTIN FULL PURPOSE": 5,
      },
    });
    const by = Object.fromEntries(r.absent.map((a) => [a.key, a]));
    expect(by.lakeway).toMatchObject({
      name: "Lakeway",
      class: "records_request",
      own_permits_captured: false,
      austin_issued_located_here: 6827,
    });
    expect(by.bee_cave).toMatchObject({
      own_permits_captured: false,
      austin_issued_located_here: 4822,
    });
    expect(by.pflugerville).toMatchObject({
      own_permits_captured: false,
      austin_issued_located_here: 1709,
    });
    expect(r.absent.every((a) => a.own_permits_captured === false)).toBe(true);
    expect(r.absent.every((a) => a.evidence_url.startsWith("https://"))).toBe(true);
  });

  it("refuses a catalog whose rows disagree with the curated profile", () => {
    expect(() =>
      buildJurisdictionsReport({
        jurisdictions: jurisdictions.slice(1),
        profile: TRAVIS_JURISDICTION_PROFILE,
        austin: { captured: 0, sourceTotal: 0, capturedAt: null },
        located: {},
      }),
    ).toThrow(/23/);
  });
});
