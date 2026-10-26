// A-04 T005 (disagreement #13): the data symlinks and test output are ignored. A pattern with
// a trailing slash matches only a directory, so the symlinks `pipeline/data` and
// `pipeline/local-stack/data` slipped through. No network; only local git.
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const REPO = resolve(import.meta.dirname, "../../../../..");

function ignored(cwd: string, path: string): boolean {
  try {
    execFileSync("git", ["check-ignore", "-q", "--no-index", path], { cwd, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

describe("A-04 hygiene: data symlinks and test output are gitignored", () => {
  it("the symlinks pipeline/data and pipeline/local-stack/data are ignored (no trailing-slash form only)", () => {
    expect(ignored(REPO, "pipeline/data")).toBe(true);
    expect(ignored(REPO, "pipeline/local-stack/data")).toBe(true);
  });

  it("seeds, raw GIS pages and test/.out are ignored (checked against .gitignore in a scratch repo)", () => {
    // Paths below a symlink cannot be checked in the worktree, so the same rules are checked
    // in an empty scratch repository with only this .gitignore.
    const scratch = mkdtempSync(join(tmpdir(), "a04-hygiene-"));
    execFileSync("git", ["init", "-q"], { cwd: scratch });
    copyFileSync(join(REPO, ".gitignore"), join(scratch, ".gitignore"));
    for (const path of [
      "pipeline/data",
      "pipeline/local-stack/data",
      "pipeline/data/seeds/travis-a04-pilot.csv",
      "pipeline/data/raw/gis/us-runner-1/pages/p.json",
      "pipeline/oracle-runtime/test/.out/x.json",
    ]) {
      expect(ignored(scratch, path), path).toBe(true);
    }
  });
});
