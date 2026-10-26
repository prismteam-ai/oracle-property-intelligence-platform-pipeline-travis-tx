// T055 (A-02, FR-009): no text classification in the views or in source code.
// views.sql filters roofing by enum equality only; profile terms live only in profiles/.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const VIEWS_SQL = join(ROOT, "packages/query-core/views.sql");

/** The grep of TC-011, as a regex (case-insensitive). */
const TEXT_MATCHING =
  /\b(i?like|similar to|regexp_[a-z_]+)\b|~|now\(\)|current_date|reroof|re-roof|roof replace|solar|photovoltaic|\brtu\b/i;
const PROFILE_TERMS = /\b(reroof|re-roof|roof replace|solar|pv|rtu|roof-mounted)\b/i;
const SOURCE_EXT = /\.(ts|mts|js|mjs|cjs|sql)$/;

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (name === "node_modules" || name === "test" || name === "tests" || name === "fixtures")
      return [];
    return statSync(path).isDirectory() ? walk(path) : SOURCE_EXT.test(name) ? [path] : [];
  });
}

const sourceFiles = (): string[] => [
  ...readdirSync(join(ROOT, "packages")).flatMap((p) => walk(join(ROOT, "packages", p, "src"))),
  VIEWS_SQL,
  ...walk(join(ROOT, "pipeline/publish/src")),
  ...walk(join(ROOT, "pipeline/oracle-runtime/travis")),
];

describe("no text classification (T055, FR-009)", () => {
  it("views.sql has no LIKE/ILIKE/SIMILAR TO/regexp_/~, no profile term, no now()/current_date", () => {
    const sql = readFileSync(VIEWS_SQL, "utf8");
    const hits = sql.split("\n").filter((line) => TEXT_MATCHING.test(line));
    expect(hits).toEqual([]);
  });

  it("v_roofing_permit filters on improvement_type = 'Roofing' AND improvement_action = 'Replacement'", () => {
    const sql = readFileSync(VIEWS_SQL, "utf8");
    expect(sql).toMatch(
      /improvement_type\s*=\s*'Roofing'\s+AND\s+\w+\.improvement_action\s*=\s*'Replacement'/,
    );
  });

  it("no profile term literal in source code outside profiles/", () => {
    const offenders = sourceFiles()
      .filter((f) => PROFILE_TERMS.test(readFileSync(f, "utf8")))
      .map((f) => relative(ROOT, f));
    expect(offenders).toEqual([]);
  });

  it("the stored structure.roof_age_years is never referenced (mew M9)", () => {
    const sql = readFileSync(VIEWS_SQL, "utf8");
    // A qualified reference (alias.roof_age_years) would read the stored field.
    expect(sql).not.toMatch(/\b\w+\.roof_age_years\b/);
    expect(sql).not.toMatch(/\bstructure\b[^;]*\bSELECT \*/i);
  });
});
