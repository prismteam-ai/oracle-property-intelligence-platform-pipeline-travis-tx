import { describe, expect, it } from "vitest";
import { Confidence } from "../../src/domain/confidence.js";
import { PermitState } from "../../src/domain/permit-state.js";
import { estimateRoofAge, RoofAnchor, type RoofPermitEvidence } from "../../src/domain/roof-age.js";
import { RoofWork } from "../../src/domain/roof-work.js";

const AS_OF = "2026-10-27";

const permit = (
  work: RoofWork,
  state: PermitState,
  completedDate: string | undefined,
  permitNumber = "2010-000001 BP",
): RoofPermitEvidence => ({ permitNumber, work, state, completedDate });

describe("estimateRoofAge", () => {
  it("anchors on the latest completed roof replacement with high confidence", () => {
    const estimate = estimateRoofAge({
      asOf: AS_OF,
      yearBuilt: 1984,
      permits: [
        permit(RoofWork.Replacement, PermitState.Completed, "2003-05-01", "2003-1 BP"),
        permit(RoofWork.Replacement, PermitState.Completed, "2010-10-28", "2010-2 BP"),
      ],
    });

    expect(estimate).toEqual({
      anchor: RoofAnchor.CompletedReplacement,
      anchorDate: "2010-10-28",
      anchorPermitNumber: "2010-2 BP",
      estimatedAgeYears: 15,
      confidence: Confidence.High,
    });
  });

  it("counts whole years only", () => {
    const estimate = estimateRoofAge({
      asOf: AS_OF,
      yearBuilt: undefined,
      permits: [permit(RoofWork.Replacement, PermitState.Completed, "2010-10-27")],
    });

    expect(estimate?.estimatedAgeYears).toBe(16);
  });

  it("does not reset the age for open, expired or abandoned replacements, or for repairs", () => {
    const estimate = estimateRoofAge({
      asOf: AS_OF,
      yearBuilt: 1984,
      permits: [
        permit(RoofWork.Replacement, PermitState.Open, undefined),
        permit(RoofWork.Replacement, PermitState.Expired, undefined),
        permit(RoofWork.Replacement, PermitState.Abandoned, "2020-01-01"),
        permit(RoofWork.Repair, PermitState.Completed, "2021-01-01"),
        permit(RoofWork.Accessory, PermitState.Completed, "2022-01-01"),
      ],
    });

    expect(estimate).toMatchObject({
      anchor: RoofAnchor.YearBuilt,
      anchorDate: "1984",
      estimatedAgeYears: 42,
      confidence: Confidence.Low,
    });
  });

  it("uses a completed new-construction permit with medium confidence", () => {
    const estimate = estimateRoofAge({
      asOf: AS_OF,
      yearBuilt: 2012,
      permits: [permit(RoofWork.NewConstruction, PermitState.Completed, "2012-08-15")],
    });

    expect(estimate).toMatchObject({
      anchor: RoofAnchor.NewConstruction,
      estimatedAgeYears: 14,
      confidence: Confidence.Medium,
    });
  });

  it("prefers a later year built over an older reroof of a building that was since replaced", () => {
    const estimate = estimateRoofAge({
      asOf: AS_OF,
      yearBuilt: 2018,
      permits: [permit(RoofWork.Replacement, PermitState.Completed, "1995-03-01")],
    });

    expect(estimate).toMatchObject({ anchor: RoofAnchor.YearBuilt, estimatedAgeYears: 8 });
  });

  it("prefers the permit when it falls in the same year as the year built", () => {
    const estimate = estimateRoofAge({
      asOf: AS_OF,
      yearBuilt: 2012,
      permits: [permit(RoofWork.NewConstruction, PermitState.Completed, "2012-08-15")],
    });

    expect(estimate?.anchor).toBe(RoofAnchor.NewConstruction);
  });

  it("breaks ties the same way whatever order the permits arrive in", () => {
    const sameDay = [
      permit(RoofWork.Replacement, PermitState.Completed, "2015-06-01", "2015-000200 BP"),
      permit(RoofWork.NewConstruction, PermitState.Completed, "2015-06-01", "2015-000100 BP"),
      permit(RoofWork.Replacement, PermitState.Completed, "2015-06-01", "2015-000150 BP"),
    ];

    const forwards = estimateRoofAge({ asOf: AS_OF, yearBuilt: 1990, permits: sameDay });
    const backwards = estimateRoofAge({
      asOf: AS_OF,
      yearBuilt: 1990,
      permits: [...sameDay].reverse(),
    });

    expect(forwards).toEqual(backwards);
    expect(forwards).toMatchObject({
      anchor: RoofAnchor.CompletedReplacement,
      anchorPermitNumber: "2015-000150 BP",
      confidence: Confidence.High,
    });
  });

  it("ignores impossible dates and years", () => {
    const estimate = estimateRoofAge({
      asOf: AS_OF,
      yearBuilt: 2031,
      permits: [permit(RoofWork.Replacement, PermitState.Completed, "0021-04-22")],
    });

    expect(estimate).toBeUndefined();
  });

  it("has no estimate without any evidence", () => {
    expect(estimateRoofAge({ asOf: AS_OF, yearBuilt: undefined, permits: [] })).toBeUndefined();
  });
});
