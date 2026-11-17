import { describe, expect, it } from "vitest";
import { isUnfinished, PermitState, permitStateOf } from "../../src/domain/permit-state.js";

describe("permitStateOf", () => {
  it.each([
    ["Final", PermitState.Completed],
    ["Active", PermitState.Open],
    ["Pending", PermitState.Open],
    ["Pending Permit", PermitState.Open],
    ["On Hold", PermitState.Open],
    ["Suspended", PermitState.Open],
    ["Re Review", PermitState.Open],
    ["Inactive Pending Revision", PermitState.Open],
    ["Expired", PermitState.Expired],
    ["Expired - License", PermitState.Expired],
    ["VOID", PermitState.Abandoned],
    ["Withdrawn", PermitState.Abandoned],
    ["Cancelled", PermitState.Abandoned],
    ["Cancelled - Contractor Required", PermitState.Abandoned],
    ["Aborted", PermitState.Abandoned],
  ])("maps the city's status %s to %s", (status, state) => {
    expect(permitStateOf(status)).toBe(state);
  });

  it("keeps statuses it does not know as unknown rather than guessing", () => {
    expect(permitStateOf("Something New")).toBe(PermitState.Unknown);
    expect(permitStateOf(undefined)).toBe(PermitState.Unknown);
  });
});

describe("isUnfinished", () => {
  it("counts open and expired permits as never finished", () => {
    expect(isUnfinished(PermitState.Open)).toBe(true);
    expect(isUnfinished(PermitState.Expired)).toBe(true);
    expect(isUnfinished(PermitState.Completed)).toBe(false);
    expect(isUnfinished(PermitState.Abandoned)).toBe(false);
    expect(isUnfinished(PermitState.Unknown)).toBe(false);
  });
});
