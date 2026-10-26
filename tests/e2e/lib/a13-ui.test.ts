// Unit tests of the A-13 Part 1 spec helpers (lib/a13-ui.ts). Inputs are the committed run index
// and manifest (real published data, read from disk) and the shared fixed texts; no network.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { RunManifestV1, RunsIndexV1 } from "@countylens/contract";
import { EXPLORE_TEXTS, RUNS_TEXTS } from "@countylens/shared";
import { describe, expect, it } from "vitest";
import {
  ExploreSearchResult,
  a11Branch,
  a13EvidenceName,
  chipYears,
  directoryArtifact,
  expectedBbbText,
  exploreUrl,
  flipLastByte,
  hasTablesExport,
  isBlankCell,
  looksLikeStack,
  openYears,
  oversizedFiles,
  placeSuggestion,
  scenario,
  templatePattern,
  trpcData,
  verifyFileArtifact,
} from "./a13-ui.js";
import { repoRoot } from "./runtime.js";

const index = RunsIndexV1.parse(
  JSON.parse(readFileSync(resolve(repoRoot, "runs", "index.json"), "utf8")),
);
const first = index.runs[0];
if (!first) throw new Error("runs/index.json lists no runs");
const manifest = RunManifestV1.parse(
  JSON.parse(readFileSync(resolve(repoRoot, "runs", first.runId, "manifest.json"), "utf8")),
);

describe("evidence names and titles", () => {
  it("pads the case number and slugs the step", () => {
    expect(a13EvidenceName("7", 2)).toBe("A-13-TC-007-2.png");
    expect(a13EvidenceName("A-13-TC-043", "Switch to SQL")).toBe("A-13-TC-043-switch-to-sql.png");
    expect(scenario("TC-001")).toBe("@scenario:A-13-TC-001");
    expect(() => scenario("NF-01")).toThrow(/numeric/);
  });
});

describe("explore URLs", () => {
  it("keeps the case's parameter order and a readable at", () => {
    expect(exploreUrl("/tx/travis/explore", { at: "30.2672,-97.7431", r: 25, view: "list" })).toBe(
      "/tx/travis/explore?at=30.2672,-97.7431&r=25&view=list",
    );
    expect(exploreUrl("/tx/travis/explore")).toBe("/tx/travis/explore");
  });
});

describe("chips, blanks and stacks", () => {
  it("reads {x} from the fixed chip texts", () => {
    expect(chipYears(EXPLORE_TEXTS.stalledNoCarrier(22.6))).toBe(22.6);
    expect(chipYears(EXPLORE_TEXTS.openNoCarrier(5))).toBe(5);
    expect(chipYears("Final")).toBeNull();
    // 8254 / 365.25 = 22.598…: one decimal, rounded down (explore-search contract).
    expect(openYears(8254)).toBe(22.5);
    // A TC-031-like case: 16,309 days is 44.65… years; the chip shows 44.6, never 44.7.
    expect(openYears(16309)).toBe(44.6);
  });

  it("turns templates into anchored patterns", () => {
    const p = templatePattern(RUNS_TEXTS.indexUnavailable, 1);
    expect(p.exec(RUNS_TEXTS.indexUnavailable("network failure"))?.[1]).toBe("network failure");
    expect(p.test("Run index unavailable")).toBe(false);
    const m = templatePattern(RUNS_TEXTS.manifestUnavailable, 2).exec(
      RUNS_TEXTS.manifestUnavailable("bafkcid", "HTTP 503"),
    );
    expect([m?.[1], m?.[2]]).toEqual(["bafkcid", "HTTP 503"]);
  });

  it("flags blank cells and stack traces", () => {
    for (const t of ["", " ", "null", "undefined", "NaN", "—", "-"])
      expect(isBlankCell(t)).toBe(true);
    expect(isBlankCell(EXPLORE_TEXTS.noCarrier)).toBe(false);
    expect(looksLikeStack("at run (engine.ts:12:5)")).toBe(true);
    expect(looksLikeStack('Parser Error: syntax error at or near "SELEC" · Try: SELECT')).toBe(
      false,
    );
  });

  it("maps BBB states to the fixed texts", () => {
    expect(expectedBbbText("not_checked", "A-08 not run")).toBe(
      EXPLORE_TEXTS.bbbNotChecked("A-08 not run"),
    );
    expect(expectedBbbText("blocked", null)).toBe(EXPLORE_TEXTS.bbbBlocked);
    expect(expectedBbbText("not_found", null)).toBe(EXPLORE_TEXTS.bbbNotFound);
    expect(expectedBbbText("rated", null)).toBeNull();
  });
});

describe("manifest test data (committed run)", () => {
  it("picks the largest raw file ≤ 50 MB and the first tables directory", () => {
    const file = verifyFileArtifact(manifest);
    expect(file.kind).toBe("table");
    expect(file.size).toBeLessThanOrEqual(50 * 1024 * 1024);
    for (const a of manifest.artifacts.filter((x) => x.kind === "table" && x.codec === "raw")) {
      expect(a.size).toBeLessThanOrEqual(file.size);
    }
    const dir = directoryArtifact(manifest);
    expect(dir.name).toMatch(/^tables\/[a-z_]+$/);
    expect(dir.carCid).toBeDefined();
  });

  it("reports today's branch for a single run without a table export", () => {
    expect(oversizedFiles(manifest)).toEqual([]);
    expect(hasTablesExport(manifest)).toBe(false);
    expect(a11Branch(index.runs.length, manifest)).toBe("today");
    expect(
      a11Branch(3, {
        ...manifest,
        artifacts: [...manifest.artifacts, { ...dirLike(), name: "tables-export.json" }],
      }),
    ).toBe("a11");
  });

  it("flips exactly the last byte", () => {
    const out = flipLastByte(new Uint8Array([1, 2, 3]));
    expect([...out]).toEqual([1, 2, 3 ^ 0xff]);
    expect(() => flipLastByte(new Uint8Array())).toThrow();
  });
});

function dirLike(): RunManifestV1["artifacts"][number] {
  const a = manifest.artifacts[0];
  if (!a) throw new Error("no artifacts");
  return a;
}

describe("tRPC bodies and the gazetteer label", () => {
  it("unwraps single, batched and superjson bodies", () => {
    expect(trpcData({ result: { data: 1 } })).toBe(1);
    expect(trpcData([{ result: { data: { json: 2 } } }])).toBe(2);
    expect(() => trpcData({})).toThrow();
  });

  it("parses a minimal explore.search result", () => {
    const r = ExploreSearchResult.parse({
      total_within_r: 0,
      tenure_unknown: 0,
      rows: [],
      close_matches: [],
      as_of: { runId: first.runId, manifestCid: first.manifestCid },
      engine: "server",
    });
    expect(r.engine).toBe("server");
  });

  it("formats the Pflugerville suggestion with U+2212", () => {
    const places = JSON.parse(
      readFileSync(
        resolve(repoRoot, "packages/query-core/gazetteer/travis-places@1.0.0/places.json"),
        "utf8",
      ),
    ) as Parameters<typeof placeSuggestion>[0][];
    const pf = places.find((p) => p.name === "Pflugerville");
    if (!pf) throw new Error("no Pflugerville");
    expect(placeSuggestion(pf)).toBe(
      "Pflugerville city · Census 2024 Gazetteer · 30.447765, −97.602116",
    );
  });
});
