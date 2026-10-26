// T050: the run's ProfileApi over the real profiles/travis-austin@1.0.0 module.
import { describe, expect, it } from "vitest";
import * as travisAustin from "../../../../profiles/travis-austin@1.0.0/index.js";
import {
  TRADE_IMPROVEMENT_TYPES,
  profileApi,
  type TravisAustinProfileModule,
} from "../../travis/pilot/profile-api.js";

const api = profileApi(travisAustin as unknown as TravisAustinProfileModule);
const SHA = travisAustin.PROFILE.sha256;
// Fixture text only (tests are outside the FR-009 term scan).
const reroof = (permittype: string) => ({
  permit_number: `2026-1 ${permittype}`,
  permittype,
  work_class: "Remodel",
  description: "Reroof existing house",
});

describe("profileApi", () => {
  it("a BP reroof is Roofing/Replacement, stamped with the profile digest", () => {
    expect(api.classifyPermit(reroof("BP"))).toEqual({
      roofing: "roofing",
      reason: "include_term",
      improvement_type: "Roofing",
      improvement_action: "Replacement",
      sha256: SHA,
    });
  });

  it.each(Object.entries(TRADE_IMPROVEMENT_TYPES))(
    "a %s trade sub-permit keeps its trade type %s, never Roofing (D-4b)",
    (code, type) => {
      const c = api.classifyPermit(reroof(code));
      expect(c).toMatchObject({
        roofing: "not_roofing",
        reason: "trade_permit",
        improvement_type: type,
      });
      expect(c.improvement_action).toBeNull();
    },
  );

  it("an unmapped trade code has no type (not emitted)", () => {
    expect(api.classifyPermit(reroof("DS")).improvement_type).toBeNull();
  });

  it("Expired is stalled with improvement_status null; an empty word is needs_review", () => {
    expect(api.classifyStatus("Expired")).toEqual({
      class: "stalled",
      improvement_status: null,
      sha256: SHA,
    });
    expect(api.classifyStatus("").class).toBe("needs_review");
    expect(api.classifyStatus("Final").improvement_status).toBe("Completed");
  });
});
