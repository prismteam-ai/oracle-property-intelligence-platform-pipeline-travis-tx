// Which evidence file A-03-TC-061 checks (A-13 T003, research R11). The deployed build names
// its branch in /build.json; a story branch `NNN-slug` (constitution XX) maps to its own
// evidence file docs/evidence/A-{NN}.md, so each story's preview is checked against that
// story's evidence. feature/oracle-pipeline and any other branch have no single story: the
// case is skipped with this reason, never pointed at a hard-coded file.

export type EvidenceTarget =
  { kind: "story"; story: string; path: string } | { kind: "skip"; reason: string };

/** `NNN-slug`: three digits, a hyphen, then the slug (AD-29). */
const STORY_BRANCH = /^(\d{3})-[^/]+$/;

export function evidenceTargetForBranch(branch: string): EvidenceTarget {
  const match = STORY_BRANCH.exec(branch);
  if (!match?.[1]) {
    return {
      kind: "skip",
      reason: `deployed branch ${branch} is not a story branch (NNN-slug), so no single docs/evidence/A-{NN}.md describes it; TC-061 runs on story previews only`,
    };
  }
  const story = `A-${String(Number(match[1])).padStart(2, "0")}`;
  return { kind: "story", story, path: `docs/evidence/${story}.md` };
}
