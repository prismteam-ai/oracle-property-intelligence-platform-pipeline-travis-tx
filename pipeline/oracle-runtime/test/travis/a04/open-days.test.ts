// A-04 T055 (A-04-TC-050, A-04-TC-046, FR-016): open_days = as_of − issue_date for open and
// stalled permits, as_of = the run's finishedAt date (never now()); no issue date → null with
// reason no_issue_date (public needs_review), never 0; other classes → not_open. Synthetic.
import { describe, expect, it } from "vitest";
import { classifyRun } from "../../../travis/permits/classify-run.js";
import { openDays, publicOpenDaysReason } from "../../../travis/permits/open-days.js";

const AS_OF = "2026-10-21";

describe("A-04-TC-050 open days from real dates only", () => {
  it("A-04-TC-050 an Active permit with no issue_date → null, no_issue_date (public needs_review), never 0", () => {
    const r = openDays({ statusClass: "open", issueDate: null, asOf: AS_OF });
    expect(r).toEqual({ openDays: null, reason: "no_issue_date" });
    expect(publicOpenDaysReason(r.reason)).toBe("needs_review");
    expect(openDays({ statusClass: "stalled", issueDate: "", asOf: AS_OF })).toEqual({
      openDays: null,
      reason: "no_issue_date",
    });
  });

  it("A-04-TC-050 closed, exclude and needs_review → null, not_open", () => {
    for (const cls of ["closed", "exclude", "needs_review"] as const) {
      const r = openDays({ statusClass: cls, issueDate: "2026-09-01T00:00:00.000", asOf: AS_OF });
      expect(r).toEqual({ openDays: null, reason: "not_open" });
      expect(publicOpenDaysReason(r.reason)).toBe("not_open");
    }
  });

  it("A-04-TC-050 A-04-TC-046 a Suspended permit issued 1982-06-23 → open, open_days = as_of − 1982-06-23 = 16,191", () => {
    const c = classifyRun({ permit_number: "1982-012866 BP", status_current: "Suspended" });
    expect(c.statusClass).toBe("open");
    const r = openDays({
      statusClass: c.statusClass,
      issueDate: "1982-06-23T00:00:00.000",
      asOf: AS_OF,
    });
    expect(r).toEqual({ openDays: 16191, reason: null });
  });

  it("stalled (Expired) permits get open days too; the date part of a floating timestamp is used", () => {
    expect(
      openDays({ statusClass: "stalled", issueDate: "2026-10-20T23:59:59.000", asOf: AS_OF }),
    ).toEqual({ openDays: 1, reason: null });
    expect(openDays({ statusClass: "open", issueDate: "2026-10-21", asOf: AS_OF })).toEqual({
      openDays: 0,
      reason: null,
    });
  });

  it("refuses an as_of that is not a date (the run's finishedAt date is required)", () => {
    expect(() => openDays({ statusClass: "open", issueDate: "2026-10-01", asOf: "now" })).toThrow(
      /as_of/,
    );
    // an unreadable source date is no usable issue date (never 0, never a crash mid-merge)
    expect(openDays({ statusClass: "open", issueDate: "garbage", asOf: AS_OF })).toEqual({
      openDays: null,
      reason: "no_issue_date",
    });
  });
});
