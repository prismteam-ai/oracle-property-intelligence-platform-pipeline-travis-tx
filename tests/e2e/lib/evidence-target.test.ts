// A-03-TC-061 fix (A-13 T003, research R11): the evidence file TC-061 reads comes from the
// deployed build's branch, never a hard-coded story. `NNN-slug` → docs/evidence/A-{NN}.md;
// feature/oracle-pipeline and any non-story branch → skip with a reason.
import { describe, expect, it } from "vitest";
import { evidenceTargetForBranch } from "./evidence-target.js";

describe("A-03-TC-061: evidence file chosen from build.json.branch", () => {
  it.each([
    ["013-explorer-and-pages", "A-13", "docs/evidence/A-13.md"],
    ["003-walking-skeleton", "A-03", "docs/evidence/A-03.md"],
    ["011-publish-run", "A-11", "docs/evidence/A-11.md"],
    ["120-later-story", "A-120", "docs/evidence/A-120.md"],
  ])("story branch %s → %s (%s)", (branch, story, path) => {
    expect(evidenceTargetForBranch(branch)).toEqual({ kind: "story", story, path });
  });

  it("feature/oracle-pipeline (the PR branch) is skipped with a reason naming it", () => {
    const target = evidenceTargetForBranch("feature/oracle-pipeline");
    expect(target.kind).toBe("skip");
    if (target.kind === "skip") {
      expect(target.reason).toContain("feature/oracle-pipeline");
      expect(target.reason).toMatch(/story branch/);
    }
  });

  it.each(["main", "13-short", "abc-013", "feature/013-x", "0130"])(
    "non-story branch %s is skipped",
    (branch) => {
      const target = evidenceTargetForBranch(branch);
      expect(target.kind).toBe("skip");
      if (target.kind === "skip") expect(target.reason).toContain(branch);
    },
  );
});
