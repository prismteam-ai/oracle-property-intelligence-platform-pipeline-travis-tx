// Network-free unit tests for the grader logic (A-14, checks.md § 7.2). No AGENT_URL needed.
import { describe, expect, it } from "vitest";
import {
  checkHonesty,
  expectedEmptyReason,
  isEmptyReasonInconclusive,
  isVacuous,
  type AgentAskResponse,
} from "./grader.js";

const response = (over: Partial<AgentAskResponse> = {}): AgentAskResponse => ({
  answer: "No matching permits found.",
  how: "Searched permits.",
  steps: [],
  matches: [],
  query: {},
  missing: [],
  outcome: "answered",
  ...over,
});

describe("expectedEmptyReason", () => {
  it("golden null + oracle zero rows -> the oracle's reason", () => {
    expect(expectedEmptyReason(null, 0, "no_match")).toBe("no_match");
  });
  it("golden null + oracle rows -> stays null", () => {
    expect(expectedEmptyReason(null, 3, null)).toBeNull();
  });
  it("non-null golden reason is kept as written whenever the oracle can express it", () => {
    expect(expectedEmptyReason("field_not_published", 0, "field_not_published")).toBe(
      "field_not_published",
    );
    expect(expectedEmptyReason("field_not_published", 4, null)).toBe("field_not_published");
    expect(expectedEmptyReason("out_of_scope", 0, "no_match")).toBe("out_of_scope");
  });
  it("undefined golden stays unchecked; unknown row count keeps golden value", () => {
    expect(expectedEmptyReason(undefined, 0, "no_match")).toBeUndefined();
    expect(expectedEmptyReason(null, null, null)).toBeNull();
  });
});

describe("checkHonesty empty_reason", () => {
  it("passes golden null when oracle returned zero rows with no_match", () => {
    const r = checkHonesty(response(), { empty_reason: null }, "no_match", 0);
    expect(r.emptyReasonMismatch).toBe(false);
    expect(r.expectedEmptyReason).toBe("no_match");
    expect(r.pass).toBe(true);
  });
  it("still requires null when the oracle returned rows but reports a reason", () => {
    const r = checkHonesty(response(), { empty_reason: null }, "no_match", 5);
    expect(r.emptyReasonMismatch).toBe(true);
    expect(r.pass).toBe(false);
  });
  it("passes golden null when oracle returned rows and no reason", () => {
    expect(checkHonesty(response(), { empty_reason: null }, null, 5).pass).toBe(true);
  });
  it("a mismatched non-null reason still fails even with zero oracle rows", () => {
    const r = checkHonesty(response(), { empty_reason: "out_of_scope" }, "no_match", 0);
    expect(r.emptyReasonMismatch).toBe(true);
    expect(r.pass).toBe(false);
  });
  it("matching non-null reason passes", () => {
    expect(checkHonesty(response(), { empty_reason: "out_of_scope" }, "out_of_scope", 0).pass).toBe(
      true,
    );
  });
  it("must_mention and must_flag_missing stay strict under zero oracle rows", () => {
    const r = checkHonesty(
      response(),
      { empty_reason: null, must_mention: ["stalled"], must_flag_missing: ["roof_age"] },
      "no_match",
      0,
    );
    expect(r.missingMentions).toEqual(["stalled"]);
    expect(r.missingFlags).toEqual(["roof_age"]);
    expect(r.pass).toBe(false);
  });
});

describe("isVacuous", () => {
  it("is true only for a zero-row oracle", () => {
    expect(isVacuous(0)).toBe(true);
    expect(isVacuous(1)).toBe(false);
    expect(isVacuous(null)).toBe(false);
  });
});

describe("empty_reason expectations the oracle cannot express are inconclusive, not passed", () => {
  it("a geocode oracle (no row count) skips the golden out_of_scope comparison", () => {
    expect(expectedEmptyReason("out_of_scope", null, null)).toBeUndefined();
    expect(isEmptyReasonInconclusive("out_of_scope", null, null)).toBe(true);
  });
  it("field_not_published on a run with zero in-scope rows is inconclusive", () => {
    expect(expectedEmptyReason("field_not_published", 0, "no_match")).toBeUndefined();
    expect(isEmptyReasonInconclusive("field_not_published", 0, "no_match")).toBe(true);
  });
  it("field_not_published still fails when the oracle says something else with rows", () => {
    expect(expectedEmptyReason("field_not_published", 3, null)).toBe("field_not_published");
    expect(isEmptyReasonInconclusive("field_not_published", 3, null)).toBe(false);
  });
  it("a null golden reason is never inconclusive", () => {
    expect(isEmptyReasonInconclusive(null, 0, "no_match")).toBe(false);
  });
});
