// A-07 T048 (Track D, contracts/estimator.md): estimator profile-mapping tests through the
// invocation wrapper (travis/roof-age/run.ts), no writes. The wrapper never reimplements the
// vendored kit estimator; these tests prove it wires inputs correctly and adds the one gate the
// kit estimator itself does not express: an implausible TCAD built year.
import { describe, expect, it } from "vitest";
import {
  estimateOne,
  simpleBasisOf,
  type RoofAgeRunRecord,
  type RoofAgeRunRow,
} from "../../../../travis/roof-age/run.js";

const AS_OF = "2026-10-22T18:00:00.000Z";

function runRow(
  anchor: RoofAgeRunRow["estimate"]["anchor"],
  workClassification: RoofAgeRunRow["estimate"]["workClassification"],
): RoofAgeRunRow {
  return {
    pID: "test",
    as_of: "2026-10-22",
    roof_date: null,
    profile: { version: "test", sha256: "0".repeat(64) },
    builtYearReason: null,
    estimate: {
      anchor,
      workClassification,
      confidence: "none",
      estimatedAgeYears: null,
    } as unknown as RoofAgeRunRow["estimate"],
  };
}

describe("estimateOne", () => {
  it("an open permit does not reset roof age: the completed replacement anchors, not the open one", () => {
    const record: RoofAgeRunRecord = {
      pID: "0223120506",
      finishedAt: AS_OF,
      builtYear: 1975,
      permits: [
        {
          permit_number: "1982-012866 BP",
          status_class: "open",
          roofing: "roofing",
          issue_date: "2025-08-01",
          completed_date: null,
        },
        {
          permit_number: "2015-004411 BP",
          status_class: "closed",
          roofing: "roofing",
          issue_date: "2015-03-01",
          completed_date: "2015-04-15",
        },
      ],
    };
    const row = estimateOne(record);
    expect(row.estimate.anchor?.type).toBe("permit_terminal_date");
    expect(row.roof_date).toBe("2015-04-15");
    expect(row.estimate.confidence).toBe("high");
  });

  it("two completed finals: the latest completion date wins", () => {
    const record: RoofAgeRunRecord = {
      pID: "0223120507",
      finishedAt: AS_OF,
      builtYear: null,
      permits: [
        {
          permit_number: "2010-000111 BP",
          status_class: "closed",
          roofing: "roofing",
          issue_date: "2010-01-01",
          completed_date: "2010-02-01",
        },
        {
          permit_number: "2019-000222 BP",
          status_class: "closed",
          roofing: "roofing",
          issue_date: "2019-01-01",
          completed_date: "2019-02-01",
        },
      ],
    };
    const row = estimateOne(record);
    expect(row.roof_date).toBe("2019-02-01");
  });

  it("an excluded/expired permit with no completion date is never an anchor", () => {
    const record: RoofAgeRunRecord = {
      pID: "0223120508",
      finishedAt: AS_OF,
      builtYear: 1960,
      permits: [
        {
          permit_number: "2012-000333 BP",
          status_class: "exclude",
          roofing: "roofing",
          issue_date: "2012-01-01",
          completed_date: null,
        },
      ],
    };
    const row = estimateOne(record);
    // No qualifying permit anchor: falls back to built year (low/built_year), never the
    // excluded/expired permit.
    expect(row.estimate.anchor?.type).toBe("property_built_year");
    expect(row.estimate.confidence).toBe("low");
  });

  it("a future built year is rejected and surfaced as a reason, not used as an anchor", () => {
    const record: RoofAgeRunRecord = {
      pID: "0223120509",
      finishedAt: AS_OF,
      builtYear: 2030,
      permits: [],
    };
    const row = estimateOne(record);
    expect(row.estimate.anchor).toBeNull();
    expect(row.estimate.confidence).toBe("none");
    expect(row.builtYearReason).toBe("future_built_year");
  });

  it("an implausibly old (pre-1850) built year is rejected and surfaced as a reason", () => {
    const record: RoofAgeRunRecord = {
      pID: "0223120510",
      finishedAt: AS_OF,
      builtYear: 1700,
      permits: [],
    };
    const row = estimateOne(record);
    expect(row.estimate.anchor).toBeNull();
    expect(row.estimate.confidence).toBe("none");
    expect(row.builtYearReason).toBe("implausibly_old_built_year");
  });

  it("no permit and no year built: unknown/none, excluded from any 'roof > 15' result", () => {
    const record: RoofAgeRunRecord = {
      pID: "0223120511",
      finishedAt: AS_OF,
      builtYear: null,
      permits: [],
    };
    const row = estimateOne(record);
    expect(row.estimate.anchor).toBeNull();
    expect(row.estimate.confidence).toBe("none");
    expect(row.roof_date).toBeNull();
    expect(row.builtYearReason).toBeNull();
  });
});

describe("simpleBasisOf", () => {
  it("maps a null anchor to unknown", () => {
    expect(simpleBasisOf(runRow(null, null))).toBe("unknown");
  });

  it("maps a property_built_year anchor to built_year, regardless of workClassification", () => {
    expect(
      simpleBasisOf(
        runRow({ type: "property_built_year", year: 1975 } as never, "needs_review" as never),
      ),
    ).toBe("built_year");
  });

  it("maps a permit anchor with primary_roof_new_construction to new_construction", () => {
    expect(
      simpleBasisOf(
        runRow(
          { type: "permit_terminal_date", date: "2015-04-15" } as never,
          "primary_roof_new_construction" as never,
        ),
      ),
    ).toBe("new_construction");
  });

  it("maps a permit anchor with any other workClassification to permit", () => {
    expect(
      simpleBasisOf(
        runRow(
          { type: "permit_terminal_date", date: "2015-04-15" } as never,
          "primary_roof_replacement" as never,
        ),
      ),
    ).toBe("permit");
  });
});
