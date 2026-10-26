// T014: classifyStatus() against the AD-08 lists and PO decision D-4a.
import { describe, expect, it } from "vitest";
import { PROFILE, classifyStatus } from "../index.js";

describe("classifyStatus", () => {
  it.each([
    ["Active", "Permitted"],
    ["Pending", "Planned"],
    ["Pending Permit", "Planned"],
    ["Re Review", "Planned"],
    ["On Hold", "OnHold"],
    ["Suspended", "OnHold"],
    ["Inactive Pending Revision", "OnHold"],
  ])("%s → open (%s)", (word, status) => {
    const r = classifyStatus(word);
    expect(r.class).toBe("open");
    expect(r.improvement_status).toBe(status);
    expect(r.emit).toBe(true);
    expect(r.profile_sha256).toBe(PROFILE.sha256);
  });

  it.each(["Expired", "Expired - License"])(
    "%s → stalled with improvement_status null (D-4a)",
    (word) => {
      const r = classifyStatus(word);
      expect(r.class).toBe("stalled");
      expect(r.improvement_status).toBeNull();
      expect(r.improvement_status).not.toBe("Completed");
      expect(r.improvement_status).not.toBe("Cancelled");
      expect(r.emit).toBe(true);
      expect(r.status_word).toBe(word);
    },
  );

  it.each(["Final", "Closed"])("%s → closed / Completed", (word) => {
    const r = classifyStatus(word);
    expect(r.class).toBe("closed");
    expect(r.improvement_status).toBe("Completed");
  });

  it.each([
    "VOID",
    "Withdrawn",
    "Cancelled",
    "Cancelled - Contractor Required",
    "Cancelled - New Permit Required",
    "Aborted",
    "Denied but Closed",
    "Revoked",
    "Rejected",
  ])("%s → exclude, not emitted", (word) => {
    const r = classifyStatus(word);
    expect(r.class).toBe("exclude");
    expect(r.improvement_status).toBeNull();
    expect(r.emit).toBe(false);
  });

  it.each(["Archived", "Application Incomplete", "active", "", null, undefined])(
    "an unseen word (%s) → needs_review, not emitted",
    (word) => {
      const r = classifyStatus(word);
      expect(r.class).toBe("needs_review");
      expect(r.improvement_status).toBeNull();
      expect(r.emit).toBe(false);
    },
  );
});
