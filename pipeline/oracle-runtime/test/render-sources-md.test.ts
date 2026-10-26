// T042: docs/sources.md renderer (FR-007, FR-007a, FR-007b). Synthetic catalog only
// (test-only); main() writes into a temporary repository root.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Catalog } from "../travis/discovery/catalog.schema.js";
import {
  SOURCES_MD_REL_PATH,
  main,
  renderSourcesMd,
} from "../travis/discovery/render-sources-md.js";
import { emitCatalogYaml } from "../travis/discovery/write-catalog.js";
import { syntheticCatalog } from "./fixtures/synthetic-catalog.js";
import { syntheticUs1Catalog } from "./fixtures/synthetic-us1-catalog.js";
import { must } from "./helpers.js";

/** TC-022 step 5: a table row whose cell is a bare number must also carry a URL then a UTC time. */
const NUMBER_CELL = /\| *[0-9][0-9,]* *\|/;
const URL_THEN_TIME = /https?:\/\/.*[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:]+Z/;

const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function full(): Catalog {
  const c = syntheticCatalog();
  const us1 = syntheticUs1Catalog();
  // the TCAD row of the other fixture is blocked with evidence, so blocked rendering is exercised
  const blockedTcad = must(c.sources.find((s) => s.key === "tcad_certified"));
  return {
    ...us1,
    permits: c.permits,
    destination: c.destination,
    census_reference: c.census_reference,
    sources: us1.sources.map((s) => (s.key === "tcad_certified" ? blockedTcad : s)),
  };
}

describe("T042 render docs/sources.md", () => {
  it("starts with front matter id: SRC-A and parent: A-01 (FR-007b)", () => {
    const md = renderSourcesMd(full());
    const lines = md.split("\n");
    expect(lines[0]).toBe("---");
    const end = lines.indexOf("---", 1);
    expect(end).toBeGreaterThan(1);
    const front = lines.slice(1, end);
    expect(front).toContain("id: SRC-A");
    expect(front).toContain("parent: A-01");
  });

  it("every table row with a number links its source URL and UTC capture time (FR-007a)", () => {
    const md = renderSourcesMd(full());
    const numeric = md.split("\n").filter((l) => l.startsWith("|") && NUMBER_CELL.test(l));
    expect(numeric.length).toBeGreaterThan(5);
    const bare = numeric.filter((l) => !URL_THEN_TIME.test(l));
    expect(bare).toEqual([]);
  });

  it("shows every Measurement value with its URL and capture time, grouped with commas", () => {
    const c = full();
    const austin = must(c.sources.find((s) => s.key === "austin_permits"));
    austin.denominator = { ...austin.denominator, value: 2380725 };
    austin.projected_full_capture_hours =
      2380725 / must(austin.throughput).rows_per_minute_median / 60;
    const md = renderSourcesMd(c);
    const row = must(
      md.split("\n").find((l) => l.includes("2,380,725")),
      "denominator row",
    );
    expect(row).toContain(austin.denominator.source_url);
    expect(row).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z/);
  });

  it("a null shows its missing_reason, never 0", () => {
    const c = full();
    const parcel = must(c.parcel);
    const m = parcel.gis_feature_count_measurement;
    parcel.gis_feature_count = null;
    parcel.gis_feature_count_measurement = {
      value: null,
      missing_reason: "synthetic: timeout after 20000 ms",
      source_url: m.source_url,
      captured_at: m.captured_at,
    };
    parcel.gap_pct = "unknown";
    const md = renderSourcesMd(c);
    const line = must(md.split("\n").find((l) => l.includes("synthetic: timeout after 20000 ms")));
    expect(line).toMatch(/missing/i);
    expect(line).not.toMatch(/\| *0 *\|/);
  });

  it("shows the printed key with its layout name, and the certification date with its source and time", () => {
    const c = full();
    const parcel = must(c.parcel);
    parcel.identifier_name = "pID";
    parcel.identifier_layout_name = "prop_id";
    parcel.certification_date = "2026-07-24";
    parcel.certification_date_measurement = {
      value: "2026-07-24",
      source_url: "https://example.test/publicinformation",
      captured_at: "2026-01-01T00:00:00.000Z",
      method: "synthetic",
    };
    const md = renderSourcesMd(c);
    expect(md).toContain("- Parcel identifier: pID (TCAD layout name: prop_id)");
    const line = must(md.split("\n").find((l) => l.startsWith("- Certification date:")));
    expect(line).toContain("2026-07-24");
    expect(line).toContain("https://example.test/publicinformation");
    expect(line).toContain("2026-01-01T00:00:00Z");
  });

  it("a missing certification date shows its reason", () => {
    const c = full();
    const parcel = must(c.parcel);
    delete parcel.certification_date;
    parcel.certification_date_measurement = {
      value: null,
      missing_reason: "synthetic: page states no certification date",
      source_url: "https://example.test/publicinformation",
      captured_at: "2026-01-01T00:00:00.000Z",
    };
    const line = must(
      renderSourcesMd(c)
        .split("\n")
        .find((l) => l.startsWith("- Certification date:")),
    );
    expect(line).toMatch(/missing/i);
    expect(line).toContain("synthetic: page states no certification date");
  });

  it("documents blocked sources with their status, evidence and records request", () => {
    const c = full();
    const md = renderSourcesMd(c);
    const blocked = c.sources.filter((s) => s.status === "blocked");
    expect(blocked.length).toBeGreaterThan(0);
    for (const s of blocked) {
      const ev = must(s.blocked_evidence);
      expect(md).toContain(ev.evidence_path);
      expect(md).toContain(ev.url);
    }
    expect(md).toMatch(/WAITING_HUMAN/);
  });

  it("renders capture times without fractional seconds and escapes pipes in text", () => {
    const c = full();
    const austin = must(c.sources.find((s) => s.key === "austin_permits"));
    austin.denominator = { ...austin.denominator, captured_at: "2026-01-01T00:00:07.123Z" };
    austin.decision_reason = "synthetic | with a pipe";
    const md = renderSourcesMd(c);
    expect(md).toContain("2026-01-01T00:00:07Z");
    expect(md).not.toContain("00:00:07.123Z");
    expect(md).toContain("synthetic \\| with a pipe");
  });

  it("is deterministic: the same catalog gives a byte-identical file", () => {
    const a = renderSourcesMd(full());
    const b = renderSourcesMd(structuredClone(full()));
    expect(a).toBe(b);
    expect(a.endsWith("\n")).toBe(true);
    expect(a).not.toMatch(/\r/);
  });

  it("main() reads the catalog and writes docs/sources.md under the repository root, twice with no change", () => {
    const root = mkdtempSync(join(tmpdir(), "render-sources-"));
    tmpDirs.push(root);
    const catalogPath = join(root, "pipeline/docs/travis-sources.yaml");
    mkdirSync(dirname(catalogPath), { recursive: true });
    writeFileSync(catalogPath, emitCatalogYaml(full()));
    const out: string[] = [];
    expect(main({ repoRoot: root, catalogPath, out: (l) => out.push(l) })).toBe(0);
    const first = readFileSync(join(root, SOURCES_MD_REL_PATH), "utf8");
    expect(main({ repoRoot: root, catalogPath, out: () => undefined })).toBe(0);
    expect(readFileSync(join(root, SOURCES_MD_REL_PATH), "utf8")).toBe(first);
    expect(SOURCES_MD_REL_PATH).toBe("docs/sources.md");
    expect(out.join("\n")).not.toContain(root);
  });

  it("main() exits 1 when the catalog is missing", () => {
    const root = mkdtempSync(join(tmpdir(), "render-sources-"));
    tmpDirs.push(root);
    const out: string[] = [];
    expect(
      main({ repoRoot: root, catalogPath: join(root, "missing.yaml"), out: (l) => out.push(l) }),
    ).toBe(1);
    expect(out.join("\n")).toMatch(/catalog/);
  });
});
