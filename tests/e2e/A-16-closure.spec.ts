// A-16 closure cases (testplans/A-16-test-cases.md TC-038, TC-039, TC-040; AC-13, AC-14, FR-012,
// FR-013). Doc and source checks only: no browser page and no network call, so they run in
// seconds and never touch the hosted runtime (RUNTIME_URL is still required by the config).
//   - TC-038 reads the A-13/A-14 specs (and the A-03 fallback spec, which carries the other
//     item-19 park) and asserts every park left in them is recorded in docs/evidence/A-16.md
//     § Closure as re-parked or kept parked. LIMIT: this is a static check of the sources. That
//     the unparked cases really ran and passed is shown by the hosted runs of the a13-* projects
//     (docs/reports/A-16-test-report.md), not by this file.
//   - TC-039 checks the § Closure table against the story's Closure table with lib/closure.ts:
//     same IDs once each, Closed or Exception, evidence named on every Closed row and resolvable
//     in this repository (file or commit), a reason on every Exception.
//   - TC-040 feeds the same checker a synthetic table with one missing ID, one Closed row
//     without evidence and one Exception without a reason, and expects exactly those three.
// Run: RUNTIME_URL=https://… pnpm exec playwright test --project=a16-closure
import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  checkClosure,
  parkMarkers,
  parseClosureTable,
  recordedParks,
  type EvidenceRowInput,
} from "./lib/closure.js";
import { e2eRoot, repoRoot } from "./lib/runtime.js";

const EVIDENCE_DOC = resolve(repoRoot, "docs", "evidence", "A-16.md");
const STORY_DOC = resolve(repoRoot, "stories", "A-16-cost-and-admin.md");

/** § Closure of the evidence file: | ID | Item | Outcome | Evidence / reason |. */
function evidenceRows(markdown: string): EvidenceRowInput[] {
  return parseClosureTable(markdown, /^##\s+Closure\b/).map((row) => ({
    id: row.id,
    outcome: row.cells[1] ?? "",
    evidence: row.cells[2] ?? "",
  }));
}

/** The story's "## Closure table (AC-14)": | ID | Item (short) | Planned outcome |. */
function plannedIds(markdown: string): string[] {
  return parseClosureTable(markdown, /^##\s+Closure table\b/).map((row) => row.id);
}

const git = (args: string[]): string =>
  execFileSync("git", args, { cwd: repoRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

/** A path names a repository file: the exact repo-relative path, a path under docs/evidence, or
 *  the unique tail of a tracked path (the table often names `run-lock.ts` without its folder). */
function fileResolver(): (path: string) => boolean {
  const tracked = git(["ls-files"]).split("\n").filter(Boolean);
  return (path) =>
    existsSync(resolve(repoRoot, path)) ||
    existsSync(resolve(repoRoot, "docs", "evidence", path)) ||
    tracked.some((f) => f === path || f.endsWith(`/${path}`));
}

function commitExists(hash: string): boolean {
  try {
    git(["cat-file", "-e", `${hash}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

test.describe("A-16 closure", () => {
  test("A-16-TC-038 parked tests rerun", () => {
    const rows = evidenceRows(readFileSync(EVIDENCE_DOC, "utf8"));
    const recorded = recordedParks(rows);
    const files = readdirSync(e2eRoot).filter(
      (f) => /^A-1[34].*\.spec\.ts$/.test(f) || f === "fallback.spec.ts",
    );
    expect(files.length, "A-13/A-14 spec files found").toBeGreaterThan(5);
    const parks = files.flatMap((file) =>
      parkMarkers(
        readFileSync(resolve(e2eRoot, file), "utf8"),
        file,
        /^A-1[34]/.test(file) ? file.slice(0, 4) : "A-03",
      ),
    );
    // The parkedRoute() table must stay empty: a parked route would skip silently inside a case.
    const fixtures = readFileSync(resolve(e2eRoot, "lib", "a13-fixtures.ts"), "utf8");
    expect(fixtures, "PARKED_ROUTES is empty").toMatch(/PARKED_ROUTES[^=]*=\s*\{\s*\}/);

    const unrecorded = parks.filter((p) => !recorded.has(p.tc));
    test.info().annotations.push(
      {
        type: "parks-left",
        description:
          parks.map((p) => `${p.testId} (${p.file}:${String(p.line)} ${p.marker})`).join(", ") ||
          "none",
      },
      { type: "parks-recorded", description: [...recorded].sort().join(", ") },
    );
    expect(
      parks.every((p) => p.testId !== "?"),
      "every park sits under a scenario title",
    ).toBe(true);
    expect(
      unrecorded.map((p) => `${p.testId} at ${p.file}:${String(p.line)}`),
      "parks not recorded as exceptions in docs/evidence/A-16.md § Closure",
    ).toEqual([]);
  });

  test("A-16-TC-039 closure table", () => {
    const planned = plannedIds(readFileSync(STORY_DOC, "utf8"));
    const rows = evidenceRows(readFileSync(EVIDENCE_DOC, "utf8"));
    expect(planned.length, "story Closure table rows").toBeGreaterThan(0);
    test.info().annotations.push({
      type: "ids",
      description: `story ${String(planned.length)}, evidence ${String(rows.length)}`,
    });
    const issues = checkClosure(planned, rows, { fileExists: fileResolver(), commitExists });
    expect(
      issues.map((i) => i.message),
      "closure defects (docs/evidence/A-16.md § Closure vs stories/A-16-cost-and-admin.md)",
    ).toEqual([]);
  });

  test("A-16-TC-040 closure gaps fail", () => {
    const story = [
      "## Closure table (AC-14)",
      "",
      "| ID | Item (short) | Planned outcome |",
      "| --- | --- | --- |",
      "| Z11-1 | Built | Close |",
      "| Z11-2 | Left out | Close |",
      "| Z11-3 | No link | Close |",
      "| Z11-4 | No reason | Exception |",
    ].join("\n");
    const evidence = [
      "## Closure (AC-14)",
      "",
      "| ID | Item | Outcome | Evidence / reason |",
      "| --- | --- | --- | --- |",
      "| Z11-1 | Built | **Closed** | `tests/e2e/lib/closure.ts` |",
      "| Z11-3 | No link | **Closed** | done |",
      "| Z11-4 | No reason | **Exception (PO)** |  |",
    ].join("\n");
    const issues = checkClosure(plannedIds(story), evidenceRows(evidence), {
      fileExists: fileResolver(),
      commitExists,
    });
    expect(issues.map((i) => i.message)).toEqual([
      "Z11-2: missing",
      'Z11-3: closed without evidence (evidence cell: "done")',
      "Z11-4: exception without reason",
    ]);
  });
});
