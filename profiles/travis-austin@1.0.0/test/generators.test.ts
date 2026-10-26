// T016: SoQL include predicate and the generated status map.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PROFILE, RULES, toSoqlInclude, toSoqlSamplePopulation, toSqlStatusMap } from "../index.js";

const generated = new URL(
  "../../../packages/query-core/generated/travis-austin@1.0.0.status-map.sql",
  import.meta.url,
).pathname;

describe("toSoqlInclude", () => {
  it("is the exact SoQL predicate for the three include terms", () => {
    expect(toSoqlInclude()).toBe(
      "(upper(description) like '%REROOF%' OR upper(description) like '%RE-ROOF%' OR upper(description) like '%ROOF REPLACE%')",
    );
  });

  it("the sample population predicate covers description and work_class", () => {
    expect(toSoqlSamplePopulation()).toBe(
      "(upper(description) like '%ROOF%' OR upper(work_class) like '%ROOF%')",
    );
  });
});

describe("toSqlStatusMap", () => {
  const sql = toSqlStatusMap();

  it("has a digest header and a VALUES table", () => {
    expect(sql).toContain(`-- profile: ${PROFILE.name}@${PROFILE.version}`);
    expect(sql).toContain(`-- profile_sha256: ${PROFILE.sha256}`);
    expect(sql).toMatch(/VALUES/);
    expect(sql).toContain("('austin', 'Completed', 'closed')");
    expect(sql).toContain("('austin', 'Permitted', 'open')");
    expect(sql).toContain("('austin', NULL, 'stalled')");
    expect(sql).toContain("AS t(jurisdiction, improvement_status, status_class)");
    expect(sql).not.toMatch(/Cancelled/);
  });

  it("scopes every row, and the NULL → stalled rule, to the profile's own jurisdictions (donphan M2)", () => {
    const rows = sql.split("\n").filter((l) => /^ {2}\(/.test(l));
    const jurisdictions = Object.keys(RULES.jurisdictions);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(
        jurisdictions.some((j) => row.startsWith(`  ('${j}', `)),
        row,
      ).toBe(true);
    }
    expect(rows.filter((r) => r.includes("NULL, 'stalled'"))).toEqual(
      jurisdictions.map((j) => `  ('${j}', NULL, 'stalled')`),
    );
  });

  it("equals the committed generated file byte for byte", () => {
    expect(readFileSync(generated, "utf8")).toBe(sql);
  });

  it("every class in published_encoding is open, stalled or closed", () => {
    const classes = new Set<string>();
    for (const cls of ["open", "stalled", "closed"] as const) {
      for (const word of RULES.status_map[cls]) {
        expect(word in RULES.published_encoding.by_word).toBe(true);
        classes.add(cls);
      }
    }
    for (const word of Object.keys(RULES.published_encoding.by_word)) {
      const cls = (["open", "stalled", "closed"] as const).find((c) =>
        RULES.status_map[c].includes(word),
      );
      expect(cls, word).toBeDefined();
    }
    expect([...classes].sort()).toEqual(["closed", "open", "stalled"]);
  });
});
