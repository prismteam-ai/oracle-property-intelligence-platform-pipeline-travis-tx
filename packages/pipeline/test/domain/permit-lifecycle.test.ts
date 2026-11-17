import { describe, expect, it } from "vitest";
import { permitLifecycle } from "../../src/domain/permit-lifecycle.js";
import { PermitState } from "../../src/domain/permit-state.js";

const AS_OF = "2026-10-27";

describe("permitLifecycle", () => {
  it("measures how long an unfinished permit has been open from its issue date", () => {
    expect(
      permitLifecycle(
        {
          status: "Active",
          appliedDate: "2015-12-01",
          issueDate: "2016-03-03",
          expiresDate: "2017-01-02",
        },
        AS_OF,
      ),
    ).toEqual({
      state: PermitState.Open,
      unfinished: true,
      openSince: "2016-03-03",
      yearsOpen: 10,
      pastExpiry: true,
    });
  });

  it("falls back to the applied date when the permit was never issued", () => {
    expect(
      permitLifecycle(
        {
          status: "Pending",
          appliedDate: "2024-05-01",
          issueDate: undefined,
          expiresDate: undefined,
        },
        AS_OF,
      ),
    ).toMatchObject({ openSince: "2024-05-01", yearsOpen: 2, pastExpiry: false });
  });

  it("counts an expired permit that was never finaled as still open", () => {
    expect(
      permitLifecycle(
        {
          status: "Expired",
          appliedDate: undefined,
          issueDate: "2009-06-10",
          expiresDate: "2010-06-10",
        },
        AS_OF,
      ),
    ).toMatchObject({
      state: PermitState.Expired,
      unfinished: true,
      yearsOpen: 17,
      pastExpiry: true,
    });
  });

  it("has no open duration for finished or abandoned permits", () => {
    for (const status of ["Final", "VOID"]) {
      expect(
        permitLifecycle(
          { status, appliedDate: "2010-01-01", issueDate: "2010-02-01", expiresDate: "2011-02-01" },
          AS_OF,
        ),
      ).toMatchObject({
        unfinished: false,
        openSince: undefined,
        yearsOpen: undefined,
        pastExpiry: false,
      });
    }
  });

  it("does not trust impossible start dates", () => {
    expect(
      permitLifecycle(
        {
          status: "Active",
          appliedDate: undefined,
          issueDate: "0021-04-22",
          expiresDate: undefined,
        },
        AS_OF,
      ),
    ).toMatchObject({ unfinished: true, openSince: undefined, yearsOpen: undefined });
  });
});
