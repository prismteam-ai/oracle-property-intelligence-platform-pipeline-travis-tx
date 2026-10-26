// T019 checker tests for rules 1-5 and 8 (contracts/catalog.md). Synthetic catalogs only
// (test-only); negative cases mutate a fresh copy and write scratch files to a temp folder.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { stringify } from "yaml";
import {
  DEFAULT_CATALOG_PATH,
  checkCatalog,
  main,
  resolveCatalogPath,
} from "../travis/discovery/check-catalog.js";
import { emitCatalogYaml } from "../travis/discovery/write-catalog.js";
import { syntheticUs1Catalog } from "./fixtures/synthetic-us1-catalog.js";

type Json = Record<string, unknown>;

/** A mutable plain-object copy of the synthetic catalog. */
function cat(): Json {
  return structuredClone(syntheticUs1Catalog()) as unknown as Json;
}
function sources(c: Json): Json[] {
  return c.sources as Json[];
}
function src(c: Json, key: string): Json {
  const s = sources(c).find((x) => x.key === key);
  if (!s) throw new Error(`test: no source ${key}`);
  return s;
}
function parcel(c: Json): Json {
  return c.parcel as Json;
}

const tmpDirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "check-catalog-test-"));
  tmpDirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("a complete US1 catalog", () => {
  it("passes rules 1-5 and 8 with no FAIL lines", () => {
    expect(checkCatalog(cat())).toEqual([]);
  });

  it("every failure line has the form 'FAIL rule <n>: <subject> <detail>'", () => {
    const c = cat();
    c.sources = sources(c).filter((s) => s.key !== "bbb");
    delete src(c, "austin_permits").tcad_id_null_count;
    for (const line of checkCatalog(c)) expect(line).toMatch(/^FAIL rule \d+: \S+ .+$/);
  });
});

describe("rule 1: all 9 source keys present", () => {
  it("one line per missing key", () => {
    const c = cat();
    c.sources = sources(c).filter((s) => s.key !== "bbb" && s.key !== "overture");
    const fails = checkCatalog(c).filter((l) => l.startsWith("FAIL rule 1:"));
    expect(fails).toEqual([
      "FAIL rule 1: sources missing bbb",
      "FAIL rule 1: sources missing overture",
    ]);
  });

  it("a missing sources block fails rule 1 for every key", () => {
    const c = cat();
    delete c.sources;
    expect(checkCatalog(c).filter((l) => l.startsWith("FAIL rule 1:"))).toHaveLength(9);
  });
});

describe("rule 2: Measurement provenance", () => {
  it("a measurement without source_url fails", () => {
    const c = cat();
    delete (src(c, "austin_permits").denominator as Json).source_url;
    expect(checkCatalog(c)).toContainEqual(
      expect.stringMatching(/^FAIL rule 2: sources\[austin_permits\]\.denominator .*source_url/),
    );
  });

  it("a measurement without a UTC captured_at fails", () => {
    const c = cat();
    (src(c, "tx_comptroller").statewide_rows as Json).captured_at = "2026-01-01 00:00";
    expect(checkCatalog(c)).toContainEqual(
      expect.stringMatching(
        /^FAIL rule 2: sources\[tx_comptroller\]\.statewide_rows .*captured_at/,
      ),
    );
  });

  it("a null value without missing_reason fails", () => {
    const c = cat();
    delete (src(c, "overture").denominator as Json).missing_reason;
    expect(checkCatalog(c)).toContainEqual(
      expect.stringMatching(/^FAIL rule 2: sources\[overture\]\.denominator .*missing_reason/),
    );
  });

  it("parcel measurements and located-elsewhere entries are checked too", () => {
    const c = cat();
    delete (parcel(c).gis_feature_count_measurement as Json).captured_at;
    const located = src(c, "austin_permits").located_in_other_jurisdictions as Json[];
    delete (located[0] as Json).source_url;
    const fails = checkCatalog(c).filter((l) => l.startsWith("FAIL rule 2:"));
    expect(fails.some((l) => l.includes("parcel.gis_feature_count_measurement"))).toBe(true);
    expect(fails.some((l) => l.includes("located_in_other_jurisdictions[0]"))).toBe(true);
  });
});

describe("rule 3: decisions", () => {
  it("exact line for a source above 48 h with no decision", () => {
    const c = cat();
    const a = src(c, "austin_permits");
    a.projected_full_capture_hours = 49;
    delete a.decision;
    expect(checkCatalog(c)).toContain("FAIL rule 3: austin_permits projected 49 h has no decision");
  });

  it("every source needs a decision and a reason, even below 48 h", () => {
    const c = cat();
    delete src(c, "bbb").decision;
    delete src(c, "overture").decision_reason;
    const fails = checkCatalog(c).filter((l) => l.startsWith("FAIL rule 3:"));
    expect(fails).toContain("FAIL rule 3: bbb has no decision");
    expect(fails).toContain("FAIL rule 3: overture has no decision_reason");
  });

  it("a decision outside the three allowed words fails", () => {
    const c = cat();
    src(c, "tcad_gis").decision = "scrape";
    expect(checkCatalog(c)).toContainEqual(
      expect.stringMatching(/^FAIL rule 3: tcad_gis decision/),
    );
  });
});

describe("rule 4: Comptroller has both counts", () => {
  it("missing statewide_rows or travis_coded_rows fails", () => {
    const c = cat();
    delete src(c, "tx_comptroller").statewide_rows;
    delete src(c, "tx_comptroller").travis_coded_rows;
    const fails = checkCatalog(c).filter((l) => l.startsWith("FAIL rule 4:"));
    expect(fails).toContain("FAIL rule 4: tx_comptroller missing travis_coded_rows");
    expect(fails).toContain("FAIL rule 4: tx_comptroller missing statewide_rows");
  });

  it("the denominator must equal travis_coded_rows", () => {
    const c = cat();
    (src(c, "tx_comptroller").denominator as Json).value = 90_000;
    expect(checkCatalog(c)).toContainEqual(
      expect.stringMatching(/^FAIL rule 4: tx_comptroller denominator/),
    );
  });
});

describe("rule 5: Austin completeness", () => {
  const cases: Array<[string, (a: Json) => void, RegExp]> = [
    ["count", (a) => ((a.denominator as Json).value = null), /count/],
    ["null tcad_id count", (a) => delete a.tcad_id_null_count, /tcad_id_null_count/],
    ["throughput", (a) => delete a.throughput, /throughput/],
    ["pages >= 3", (a) => ((a.throughput as Json).pages_read = 2), /pages_read/],
    ["page size <= 50,000", (a) => ((a.throughput as Json).page_size = 60_000), /page_size/],
    ["projection", (a) => delete a.projected_full_capture_hours, /projected_full_capture_hours/],
    ["decision", (a) => delete a.decision, /decision/],
    [
      "projection consistent with denominator / median / 60",
      (a) => (a.projected_full_capture_hours = 5),
      /projected_full_capture_hours/,
    ],
  ];
  for (const [name, mutate, detail] of cases) {
    it(`fails without ${name}`, () => {
      const c = cat();
      mutate(src(c, "austin_permits"));
      const fails = checkCatalog(c).filter((l) => l.startsWith("FAIL rule 5: austin_permits"));
      expect(fails.some((l) => detail.test(l))).toBe(true);
    });
  }

  it("a missing Austin row fails rule 5", () => {
    const c = cat();
    c.sources = sources(c).filter((s) => s.key !== "austin_permits");
    expect(checkCatalog(c)).toContain("FAIL rule 5: austin_permits row missing");
  });
});

describe("rule 8: GIS counted, or unknown with a reason", () => {
  function nullGis(c: Json): Json {
    const p = parcel(c);
    p.gis_feature_count = null;
    p.gis_feature_count_measurement = {
      value: null,
      missing_reason: "timeout after 60000 ms at 2026-01-01T00:00:00Z",
      source_url: "https://example.test/gis",
      captured_at: "2026-01-01T00:00:00Z",
    };
    return p;
  }

  it("null GIS with gap_pct unknown and a reason passes", () => {
    const c = cat();
    const p = nullGis(c);
    p.gap_pct = "unknown";
    p.gap_reason = "GIS count missing: timeout after 60000 ms";
    expect(checkCatalog(c).filter((l) => l.startsWith("FAIL rule 8:"))).toEqual([]);
  });

  it("null GIS with a numeric gap fails", () => {
    const c = cat();
    nullGis(c).gap_pct = 0;
    expect(checkCatalog(c)).toContainEqual(expect.stringMatching(/^FAIL rule 8: parcel gap_pct/));
  });

  it("null GIS with unknown but no reason fails", () => {
    const c = cat();
    const p = nullGis(c);
    p.gap_pct = "unknown";
    delete p.gap_reason;
    expect(checkCatalog(c)).toContainEqual(expect.stringMatching(/^FAIL rule 8: parcel .*reason/));
  });

  it("counted GIS with a wrong gap percentage fails", () => {
    const c = cat();
    parcel(c).gap_pct = 5;
    expect(checkCatalog(c)).toContainEqual(expect.stringMatching(/^FAIL rule 8: parcel gap_pct/));
  });

  it("a missing parcel block fails", () => {
    const c = cat();
    delete c.parcel;
    expect(checkCatalog(c)).toContain("FAIL rule 8: parcel block missing");
  });
});

describe("CLI", () => {
  it("defaults to pipeline/docs/travis-sources.yaml", () => {
    expect(
      DEFAULT_CATALOG_PATH.endsWith(["pipeline", "docs", "travis-sources.yaml"].join(sep)),
    ).toBe(true);
    expect(resolveCatalogPath(undefined, "/somewhere")).toBe(DEFAULT_CATALOG_PATH);
  });

  it("resolves a relative path against the caller's directory", () => {
    expect(resolveCatalogPath("x/c.yaml", "/repo")).toBe(join("/repo", "x", "c.yaml"));
    expect(resolveCatalogPath("/abs/c.yaml", "/repo")).toBe("/abs/c.yaml");
  });

  it("main prints one line per failure and returns 1; 0 when all pass", () => {
    const dir = tmp();
    const good = join(dir, "good.yaml");
    writeFileSync(good, emitCatalogYaml(syntheticUs1Catalog()));
    const out: string[] = [];
    expect(main([good], (l) => out.push(l))).toBe(0);
    expect(out.filter((l) => l.startsWith("FAIL"))).toEqual([]);

    const c = cat();
    const a = src(c, "austin_permits");
    a.projected_full_capture_hours = 49;
    delete a.decision;
    const bad = join(dir, "bad.yaml");
    writeFileSync(bad, stringify(c));
    const out2: string[] = [];
    expect(main([bad], (l) => out2.push(l))).toBe(1);
    expect(out2).toContain("FAIL rule 3: austin_permits projected 49 h has no decision");
  });

  it("an unreadable catalog returns 1", () => {
    const out: string[] = [];
    expect(main([join(tmp(), "missing.yaml")], (l) => out.push(l))).toBe(1);
    expect(out.join("\n")).toMatch(/^FAIL rule 0: /m);
  });

  it("the script exits 1 with the exact FAIL line on stdout", () => {
    const dir = tmp();
    const c = cat();
    const a = src(c, "austin_permits");
    a.projected_full_capture_hours = 49;
    delete a.decision;
    const bad = join(dir, "c.yaml");
    writeFileSync(bad, stringify(c));
    const root = fileURLToPath(new URL("..", import.meta.url));
    const run = spawnSync(
      process.execPath,
      ["--import", "tsx", join(root, "travis", "discovery", "check-catalog.ts"), bad],
      { cwd: root, encoding: "utf8" },
    );
    expect(run.status).toBe(1);
    expect(run.stdout.split("\n")).toContain(
      "FAIL rule 3: austin_permits projected 49 h has no decision",
    );
  }, 30_000);
});
