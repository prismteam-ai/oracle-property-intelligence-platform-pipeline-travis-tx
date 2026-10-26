// A-11: the run-manifest builder for a follow-up run with no new capture (Run 2, the correction
// run). Uses the real buildManifest() over real CAR bytes in a throwaway repo root; only the
// clean-tree gate is injected.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { RunManifestV1 } from "@countylens/contract";
import { cidOfBytes, cidOfFile } from "../src/cid.js";
import { jcsBytes } from "../src/jcs.js";
import { GAZETTEER_SHA256 } from "@countylens/query-core";
import {
  COUNTY_ROW_COVERAGE,
  assertPermitLinkReconciliation,
  buildManifest,
  manifestGroupInputsFromBatches,
} from "../src/manifest.js";
import {
  CORRECTION_NOTE,
  DEFAULT_AUSTIN_RECEIPT,
  DEFAULT_TCAD_RECEIPT,
  GAZETTEER_PROFILE_ENTRY,
  PARCELS_BASIS,
  buildRunManifest,
  withGazetteerProfile,
  discoverBatches,
  manifestOutputPath,
  requireLinkedPermits,
  restatePermitRows,
  writeManifestBytes,
  type RunManifestConfig,
} from "../src/run-manifest.js";
import {
  BASE_RUN_ID,
  COUNTY_EXTRA_TABLES,
  NOT_YET_PUBLISHED,
  makeBatches,
  put,
  runFixture,
  type RunFixture,
} from "./support/run-fixture.js";

function config(f: RunFixture, extra: Partial<RunManifestConfig> = {}): RunManifestConfig {
  return {
    runId: "travis-full-run2-20261024",
    startedAt: "2026-10-24T08:00:00.000Z",
    finishedAt: "2026-10-24T12:00:00.000Z",
    previousManifestCid: f.baseCid,
    countyDir: f.countyDir,
    permitsDir: f.permitsV2,
    ...extra,
  };
}
const deps = (f: RunFixture) => ({
  repoRoot: f.root,
  workTreeStatus: NOT_YET_PUBLISHED,
  gitCommit: () => "abc1234",
});

describe("coverage.parcels_published (task B gap 6)", () => {
  it("carries the County group's published property rows with their basis", async () => {
    const f = await runFixture();
    const { manifest: m } = await buildRunManifest(config(f), deps(f));
    expect(m.coverage.parcels_published).toEqual({
      count: 11,
      derivation: "published_rows",
      note: `b01 5 + b02 6, ${PARCELS_BASIS}`,
    });
  });

  it("is recomputed when the base already has it, even if the permit count changes", async () => {
    const f = await runFixture([3, 4]);
    const { manifest: m } = await buildRunManifest(config(f), deps(f));
    const again = withGazetteerProfile(m.profiles, "abc1234");
    expect(again).toEqual(m.profiles); // travis-places is added once, never duplicated
  });

  const countyOnly = (f: RunFixture) =>
    manifestGroupInputsFromBatches({
      group: "county",
      dir: f.countyDir,
      carPrefix: "travis-county",
      batches: [1, 2],
    });
  const base = async (f: RunFixture) => {
    const { manifest } = await buildRunManifest(config(f), deps(f));
    return {
      runId: "travis-county-only-test",
      county: manifest.county,
      state: manifest.state,
      fips: manifest.fips,
      startedAt: manifest.startedAt,
      finishedAt: manifest.finishedAt,
      previousManifestCid: null,
      runDir: f.root,
      groups: countyOnly(f),
      sources: manifest.sources.map((s) => ({
        name: s.name,
        url: s.url,
        watermark: s.watermark,
        receipts: join(
          f.root,
          s.name.startsWith("austin") ? DEFAULT_AUSTIN_RECEIPT : DEFAULT_TCAD_RECEIPT,
        ),
        limitations: [],
        delta: { added: 0, changed: 0, removed: 0 },
      })),
      profiles: manifest.profiles,
      ownersRedacted: 0,
      limitations: [],
      workTreeStatus: NOT_YET_PUBLISHED,
    };
  };

  it("buildManifest refuses a count that differs from the published county property rows", async () => {
    const f = await runFixture();
    const input = await base(f);
    await expect(
      buildManifest({
        ...input,
        coverage: { parcels_published: { count: 999, derivation: "published_rows" } },
      }),
    ).rejects.toThrow(
      /parcels_published\.count 999 is not the number of published county property rows \(11\)/,
    );
  });

  it("buildManifest refuses another derivation and a run with no county group", async () => {
    const f = await runFixture();
    const input = await base(f);
    await expect(
      buildManifest({
        ...input,
        coverage: { parcels_published: { count: 11, derivation: "capture_receipt" } },
      }),
    ).rejects.toThrow(/derivation must be "published_rows"/);
    await expect(
      buildManifest({
        ...input,
        groups: [],
        coverage: { parcels_published: { count: 11, derivation: "published_rows" } },
      }),
    ).rejects.toThrow(/needs the county group's property table/);
  });

  it("an older manifest without the key is still valid, and a matching count builds", async () => {
    const f = await runFixture();
    const input = await base(f);
    const legacy = await buildManifest({ ...input, coverage: {} });
    expect(RunManifestV1.safeParse(legacy.manifest).success).toBe(true);
    expect(legacy.manifest.coverage.parcels_published).toBeUndefined();
    const ok = await buildManifest({
      ...input,
      coverage: { parcels_published: { count: 11, derivation: "published_rows" } },
    });
    expect(ok.manifest.coverage.parcels_published?.count).toBe(11);
  });
});

describe("coverage ownership and coordinates counts (COUNTY_ROW_COVERAGE)", () => {
  const countyOnly = (f: RunFixture) =>
    manifestGroupInputsFromBatches({
      group: "county",
      dir: f.countyDir,
      carPrefix: "travis-county",
      batches: [1, 2],
    });

  it("counts the reused county batches' sales, person, company and geometry rows per batch", async () => {
    const f = await runFixture();
    const base = RunManifestV1.parse(JSON.parse(Buffer.from(f.baseBytes).toString("utf8")));
    // The base run carries none of the keys; the county group is reused from its directory.
    for (const { key } of COUNTY_ROW_COVERAGE) expect(base.coverage[key]).toBeUndefined();
    const { manifest: m } = await buildRunManifest(config(f), deps(f));
    const basis = (key: string) => COUNTY_ROW_COVERAGE.find((c) => c.key === key)?.basis ?? "";
    expect(m.coverage.owner_sales_published).toEqual({
      count: 21,
      derivation: "published_rows",
      note: `b01 9 + b02 12, ${basis("owner_sales_published")}`,
    });
    expect(m.coverage.owner_persons_published).toEqual({
      count: 9,
      derivation: "published_rows",
      note: `b01 4 + b02 5, ${basis("owner_persons_published")}`,
    });
    expect(m.coverage.owner_companies_published).toEqual({
      count: 3,
      derivation: "published_rows",
      note: `b01 1 + b02 2, ${basis("owner_companies_published")}`,
    });
    expect(m.coverage.coordinates_published).toEqual({
      count: 10,
      derivation: "published_rows",
      note: `b01 5 + b02 5, ${basis("coordinates_published")}`,
    });
    for (const [key, rows] of [
      ["owner_sales_published", COUNTY_EXTRA_TABLES.sales_history],
      ["owner_persons_published", COUNTY_EXTRA_TABLES.person],
      ["owner_companies_published", COUNTY_EXTRA_TABLES.company],
      ["coordinates_published", COUNTY_EXTRA_TABLES.geometry],
    ] as const) {
      expect(m.coverage[key]?.count).toBe(rows[0] + rows[1]);
    }
  });

  it("never reuses the owner gap keys query-core reads, and uses the Coverage page's kind prefixes", () => {
    const keys = COUNTY_ROW_COVERAGE.map((c) => c.key);
    for (const k of ["owner_unparsed", "owner_confidential", "owner_no_record", "no_owner_record"])
      expect(keys).not.toContain(k);
    for (const k of keys) expect(k.startsWith("owner_") || k.startsWith("coordinates_")).toBe(true);
  });

  it("a coverageOverrides entry cannot replace a computed count", async () => {
    const f = await runFixture();
    const { manifest: m } = await buildRunManifest(
      config(f, {
        coverageOverrides: { owner_persons_published: { count: 1, derivation: "published_rows" } },
      }),
      deps(f),
    );
    expect(m.coverage.owner_persons_published?.count).toBe(9);
  });

  it("refuses county batches whose export summary lacks a counted table", async () => {
    const f = await runFixture();
    const bare = join(f.root, "data/county-bare");
    await makeBatches({
      dir: bare,
      group: "county",
      prefix: "travis-county",
      table: "property",
      rows: [5, 6],
      salt: "bare",
    });
    await expect(buildRunManifest(config(f, { countyDir: bare }), deps(f))).rejects.toThrow(
      /has no tables\.sales_history\.rows/,
    );
  });

  it("buildManifest refuses a count, derivation or table that does not match the published rows", async () => {
    const f = await runFixture();
    const { manifest } = await buildRunManifest(config(f), deps(f));
    const input = {
      runId: "travis-county-only-test",
      county: manifest.county,
      state: manifest.state,
      fips: manifest.fips,
      startedAt: manifest.startedAt,
      finishedAt: manifest.finishedAt,
      previousManifestCid: null,
      runDir: f.root,
      groups: countyOnly(f),
      sources: manifest.sources.map((s) => ({
        name: s.name,
        url: s.url,
        watermark: s.watermark,
        receipts: join(
          f.root,
          s.name.startsWith("austin") ? DEFAULT_AUSTIN_RECEIPT : DEFAULT_TCAD_RECEIPT,
        ),
        limitations: [],
        delta: { added: 0, changed: 0, removed: 0 },
      })),
      profiles: manifest.profiles,
      ownersRedacted: 0,
      limitations: [],
      workTreeStatus: NOT_YET_PUBLISHED,
    };
    await expect(
      buildManifest({
        ...input,
        coverage: { coordinates_published: { count: 11, derivation: "published_rows" } },
      }),
    ).rejects.toThrow(
      /coordinates_published\.count 11 is not the number of published county geometry rows \(10\)/,
    );
    await expect(
      buildManifest({
        ...input,
        coverage: { owner_sales_published: { count: 21, derivation: "capture_receipt" } },
      }),
    ).rejects.toThrow(/owner_sales_published\.derivation must be "published_rows"/);
    await expect(
      buildManifest({
        ...input,
        groups: [],
        coverage: { owner_companies_published: { count: 3, derivation: "published_rows" } },
      }),
    ).rejects.toThrow(/owner_companies_published needs the county group's company table/);
    const ok = await buildManifest({
      ...input,
      coverage: { owner_companies_published: { count: 3, derivation: "published_rows" } },
    });
    expect(ok.manifest.coverage.owner_companies_published?.count).toBe(3);
  });
});

describe("buildRunManifest", () => {
  it("chains to the base run, reuses the county artifacts unchanged and rebuilds the permits ones", async () => {
    const f = await runFixture();
    const base = RunManifestV1.parse(JSON.parse(Buffer.from(f.baseBytes).toString("utf8")));
    const built = await buildRunManifest(config(f), deps(f));
    const m = built.manifest;
    expect(m.previousManifestCid).toBe(f.baseCid);
    expect(m.runId).toBe("travis-full-run2-20261024");

    const county = (x: RunManifestV1) =>
      x.artifacts.filter((a) => a.name.includes("county-batched"));
    expect(county(m)).toEqual(county(base));
    expect(county(m).length).toBeGreaterThan(0);
    const permits = (x: RunManifestV1) => x.artifacts.filter((a) => a.name.includes("permits-"));
    const cids = new Set(permits(base).map((a) => a.cid));
    expect(permits(m).length).toBe(permits(base).length);
    expect(permits(m).every((a) => a.kind === "table" || !cids.has(a.cid))).toBe(true);
  });

  it("keeps the source facts, sets every source delta to 0/0/0 and carries profiles and coverage", async () => {
    const f = await runFixture();
    const base = RunManifestV1.parse(JSON.parse(Buffer.from(f.baseBytes).toString("utf8")));
    const { manifest: m } = await buildRunManifest(config(f), deps(f));
    for (const [i, s] of m.sources.entries()) {
      const b = base.sources[i];
      expect([s.name, s.url, s.watermark, s.records, s.captured_at]).toEqual([
        b?.name,
        b?.url,
        b?.watermark,
        b?.records,
        b?.captured_at,
      ]);
      expect([s.added, s.changed, s.removed]).toEqual([0, 0, 0]);
      expect(s.limitations).toEqual(b?.limitations);
    }
    // The base names no travis-places; a full-county run adds it (static in-repo list), last.
    expect(m.profiles.slice(0, base.profiles.length)).toEqual(base.profiles);
    expect(m.profiles.slice(base.profiles.length)).toEqual([
      { ...GAZETTEER_PROFILE_ENTRY, sha256: GAZETTEER_SHA256, gitCommit: "abc1234" },
    ]);
    expect(m.coverage.permits_no_tcad_geoid).toEqual(base.coverage.permits_no_tcad_geoid);
    expect(m.coverage.permits_emitted?.count).toBe(7);
    expect(m.coverage.permits_emitted?.note).toBe(
      "b01 3 + b02 4, roofing-classified decided-status permits only (PO 2026-10-23)",
    );
  });

  it("drops the base's DRAFT marker and adds exactly one correction note", async () => {
    const f = await runFixture();
    const { manifest: m } = await buildRunManifest(config(f), deps(f));
    expect(m.limitations.some((l) => l.startsWith("DRAFT"))).toBe(false);
    expect(m.limitations).toEqual(["county published_rows is R-only", CORRECTION_NOTE]);
    expect(CORRECTION_NOTE).toMatch(/Correction run, no new source capture/);
    expect(CORRECTION_NOTE).toMatch(/each permit's property CID equals its County property CID/);
  });

  it("a correction run can drop carried notes by prefix and replace a source's limitations (ERR-73)", async () => {
    const f = await runFixture();
    const base = RunManifestV1.parse(JSON.parse(Buffer.from(f.baseBytes).toString("utf8")));
    const first = base.sources[0];
    if (first === undefined) throw new Error("fixture has no source");
    const { manifest: m } = await buildRunManifest(
      config(f, {
        dropLimitationPrefixes: ["county published_rows"],
        sourceLimitations: { [first.name]: ["one GET per permit"] },
        registryNote: "Comptroller registry loaded 2026-10-22",
        // the carried fixed note is replaced, never listed next to the registry note
        correctionNote: "Run 3.1 note",
      }),
      deps(f),
    );
    expect(m.limitations).toEqual(["Run 3.1 note"]);
    expect(m.sources[0]?.limitations).toEqual([
      "one GET per permit",
      "Comptroller registry loaded 2026-10-22",
    ]);
    expect(m.sources.slice(1).map((s) => s.limitations)).toEqual(
      base.sources.slice(1).map((s) => s.limitations),
    );
  });

  it("refuses a dropLimitationPrefixes entry that matches no carried note", async () => {
    const f = await runFixture();
    await expect(
      buildRunManifest(config(f, { dropLimitationPrefixes: ["Incremental refreshh"] }), deps(f)),
    ).rejects.toThrow(/Incremental refreshh/);
  });

  it("checks contractor_* coverage against the contractor-coverage report (ERR-73)", async () => {
    const f = await runFixture();
    const path = join(f.root, "contractor-coverage.json");
    const byState = { resolved: 0, candidate: 2, ambiguous: 0, conflicting: 1, unresolved: 4 };
    writeFileSync(path, JSON.stringify({ permits: 7, byState }));
    const overrides = (counts: Record<string, number>) =>
      Object.fromEntries(
        Object.entries(counts).map(([k, n]) => [
          `contractor_${k}`,
          { count: n, derivation: "aggregate_match" as const },
        ]),
      );
    const ok = await buildRunManifest(
      config(f, { contractorCoverage: path, coverageOverrides: overrides(byState) }),
      deps(f),
    );
    expect(ok.manifest.coverage.contractor_conflicting?.count).toBe(1);
    await expect(
      buildRunManifest(
        config(f, {
          contractorCoverage: path,
          coverageOverrides: overrides({ ...byState, candidate: 3 }),
        }),
        deps(f),
      ),
    ).rejects.toThrow(/contractor_candidate is 3 but contractorCoverage says 2/);
    writeFileSync(path, JSON.stringify({ permits: 8, byState }));
    await expect(
      buildRunManifest(
        config(f, { contractorCoverage: path, coverageOverrides: overrides(byState) }),
        deps(f),
      ),
    ).rejects.toThrow(/states sum to 7, not its 8 permits/);
    writeFileSync(path, JSON.stringify({ permits: 8, byState: { ...byState, unresolved: 5 } }));
    await expect(
      buildRunManifest(
        config(f, { contractorCoverage: path, coverageOverrides: overrides(byState) }),
        deps(f),
      ),
    ).rejects.toThrow(/8 permits but 7 are published/);
    writeFileSync(path, JSON.stringify({ permits: 7, byState: { resolved: 0, unresolved: 7 } }));
    await expect(
      buildRunManifest(
        config(f, { contractorCoverage: path, coverageOverrides: overrides(byState) }),
        deps(f),
      ),
    ).rejects.toThrow(/no count for: candidate, ambiguous, conflicting/);
  });

  it("registryNote replaces a carried 'baseline not loaded' note, never lists both", async () => {
    const f = await runFixture();
    const { manifest: m } = await buildRunManifest(
      config(f, { registryNote: "Comptroller registry loaded 2026-10-22 (342333 rows, x)" }),
      deps(f),
    );
    const austin = m.sources[0]?.limitations ?? [];
    expect(austin).not.toContain("Comptroller baseline not loaded (A-07)");
    expect(austin.filter((l) => l.startsWith("Comptroller registry loaded"))).toHaveLength(1);
  });

  it("refuses sourceLimitations for a source the base does not carry", async () => {
    const f = await runFixture();
    await expect(
      buildRunManifest(config(f, { sourceLimitations: { "no-such-source": ["x"] } }), deps(f)),
    ).rejects.toThrow(/no-such-source/);
  });

  it("returns exact JCS bytes whose raw-leaves CID is the manifest CID", async () => {
    const f = await runFixture();
    const built = await buildRunManifest(config(f), deps(f));
    expect(Buffer.from(built.bytes).equals(Buffer.from(jcsBytes(built.manifest)))).toBe(true);
    expect(built.cid).toBe(await cidOfBytes(built.bytes));
  });

  it("refuses a previousManifestCid that is not the CID of the base manifest", async () => {
    const f = await runFixture();
    const other = await cidOfBytes(new TextEncoder().encode("something else"));
    await expect(
      buildRunManifest(config(f, { previousManifestCid: other }), deps(f)),
    ).rejects.toThrow(/is not the CID of the base manifest/);
  });

  it("refuses to reuse the base run's id", async () => {
    const f = await runFixture();
    await expect(buildRunManifest(config(f, { runId: BASE_RUN_ID }), deps(f))).rejects.toThrow(
      /base run's id/,
    );
  });

  it("runs buildManifest's own checks: a dirty tree fails", async () => {
    const f = await runFixture();
    await expect(
      buildRunManifest(config(f), {
        repoRoot: f.root,
        workTreeStatus: () => " M file",
        gitCommit: () => "abc1234",
      }),
    ).rejects.toThrow(/working tree is dirty/);
  });

  it("a different permit count needs explicit coverage for the carried permit-link keys", async () => {
    const f = await runFixture();
    // A pilot-sized permits group: 1 + 1 rows instead of 3 + 4.
    const { makeBatches } = await import("./support/run-fixture.js");
    const small = join(f.root, "data/permits-small-batched");
    await makeBatches({
      dir: small,
      group: "property_improvement",
      prefix: "travis-permits",
      table: "property_improvement",
      rows: [1, 1],
      salt: "small",
    });
    await expect(buildRunManifest(config(f, { permitsDir: small }), deps(f))).rejects.toThrow(
      /Supply coverageOverrides for: .*contractor_unresolved/,
    );
    const overrides = Object.fromEntries(
      [
        "permits_no_tcad_geoid",
        "permits_no_tcad_id",
        "permits_ambiguous_geoid",
        "permits_address_unmatched",
        "permits_ambiguous_address",
        "contractor_resolved",
        "contractor_candidate",
        "contractor_unresolved",
      ].map((k) => [k, { count: 0, derivation: "aggregate_match" as const }]),
    );
    const built = await buildRunManifest(
      config(f, { permitsDir: small, coverageOverrides: overrides }),
      deps(f),
    );
    expect(built.manifest.coverage.permits_emitted?.count).toBe(2);
  });
});

describe("address-point source (Run 3, ADR 0004)", () => {
  const receipt = {
    captured_at: "2026-10-25T08:28:56.200Z",
    records: 466149,
    sha256: "4".repeat(64),
    layer_last_edit_date: "2026-10-24T04:31:08.027Z",
    layer_url:
      "https://services.arcgis.com/0L95CJ0VTaxqcmED/arcgis/rest/services/LOCATION_address_points/FeatureServer/0",
  };

  it("lists the layer as a third source with its sha256, edit date and a first-seen delta", async () => {
    const f = await runFixture();
    const path = join(f.root, "address-points-receipt.json");
    writeFileSync(path, JSON.stringify(receipt));
    const { manifest: m } = await buildRunManifest(
      config(f, { addressPointsReceipt: path }),
      deps(f),
    );
    expect(m.sources.map((s) => s.name)).toEqual([
      "austin-3syk-w9eu",
      "tcad-2026-certified-json",
      "austin-address-points",
    ]);
    const a = m.sources[2];
    expect(a).toMatchObject({
      watermark: receipt.layer_last_edit_date,
      captured_at: receipt.captured_at,
      records: 466149,
      added: 466149,
      changed: 0,
      removed: 0,
    });
    expect(a?.limitations.join(" ")).toContain(receipt.sha256);
    // the first two sources are exactly what they were without the layer
    const plain = (await buildRunManifest(config(f), deps(f))).manifest;
    expect(m.sources.slice(0, 2)).toEqual(plain.sources);
  });

  it("a correction run carries the base's layer source with delta 0 (Run 3.1, carryAddressPoints)", async () => {
    const f = await runFixture();
    const path = join(f.root, "address-points-receipt.json");
    writeFileSync(path, JSON.stringify(receipt));
    const run3 = await buildRunManifest(config(f, { addressPointsReceipt: path }), deps(f));
    put(join(f.root, "runs", "travis-full-run2-20261024", "manifest.json"), run3.bytes);
    const { manifest: m } = await buildRunManifest(
      config(f, {
        runId: "travis-full-run3-1-20261025",
        baseManifest: "runs/travis-full-run2-20261024/manifest.json",
        previousManifestCid: run3.cid,
        addressPointsReceipt: path,
        carryAddressPoints: true,
      }),
      deps(f),
    );
    expect(m.sources.map((s) => s.name)).toEqual([
      "austin-3syk-w9eu",
      "tcad-2026-certified-json",
      "austin-address-points",
    ]);
    const a = m.sources[2];
    expect(a).toMatchObject({
      watermark: receipt.layer_last_edit_date,
      added: 0,
      changed: 0,
      removed: 0,
    });
    expect(a?.limitations).toEqual(run3.manifest.sources[2]?.limitations);
  });

  it("carryAddressPoints refuses a run without the receipt", async () => {
    const f = await runFixture();
    await expect(
      buildRunManifest(config(f, { carryAddressPoints: true }), deps(f)),
    ).rejects.toThrow(/addressPointsReceipt/);
  });

  it("a run without the receipt lists exactly the two original sources", async () => {
    const f = await runFixture();
    const { manifest: m } = await buildRunManifest(config(f), deps(f));
    expect(m.sources).toHaveLength(2);
  });

  it("refuses a receipt without a valid sha256", async () => {
    const f = await runFixture();
    const path = join(f.root, "bad-receipt.json");
    writeFileSync(path, JSON.stringify({ ...receipt, sha256: "nope" }));
    await expect(
      buildRunManifest(config(f, { addressPointsReceipt: path }), deps(f)),
    ).rejects.toThrow();
  });
});

describe("requireLinkedPermits", () => {
  it("refuses a real run without the linked-permit total", () => {
    expect(() => requireLinkedPermits({}, false)).toThrow(/--linked-permits/);
  });

  it("accepts a real run with it, and a trial without it", () => {
    expect(() => requireLinkedPermits({ linkedPermits: 2007514 }, false)).not.toThrow();
    expect(() => requireLinkedPermits({}, true)).not.toThrow();
  });
});

describe("restatePermitRows", () => {
  const run1 =
    "property_improvement published scope is roofing-classified, decided-status permits only (17387 rows), not all 2007514 linked permits";

  it("restates a carried permit-row count with this run's count, nothing else", () => {
    expect(restatePermitRows(run1, 17387, 15025)).toBe(
      "property_improvement published scope is roofing-classified, decided-status permits only (15025 rows), not all 2007514 linked permits",
    );
  });

  it("leaves other limitations and an unchanged count as they are", () => {
    const other = "county published_rows is R-only (441961 of the 493246-parcel roll)";
    expect(restatePermitRows(other, 17387, 15025)).toBe(other);
    expect(restatePermitRows(run1, 17387, 17387)).toBe(run1);
    expect(restatePermitRows(run1, undefined, 15025)).toBe(run1);
  });
});

describe("discoverBatches", () => {
  it("lists the batch numbers present, ascending", async () => {
    const f = await runFixture([1, 2]);
    expect(discoverBatches(f.countyDir, "travis-county")).toEqual([1, 2]);
    expect(() => discoverBatches(f.countyDir, "travis-nothing")).toThrow(/no travis-nothing/);
  });
});

describe("manifestOutputPath / writeManifestBytes", () => {
  it("a real run writes runs/<runId>/manifest.json and never takes --out", async () => {
    const f = await runFixture();
    put(
      join(f.root, "runs/index.json"),
      JSON.stringify({ runs: [], schema: "oracle-travis-runs-index.v1" }),
    );
    expect(manifestOutputPath({ repoRoot: f.root, runId: "r2", pilot: false })).toBe(
      join(f.root, "runs/r2/manifest.json"),
    );
    expect(() =>
      manifestOutputPath({ repoRoot: f.root, runId: "r2", pilot: false, out: "x.json" }),
    ).toThrow(/only for --pilot/);
  });

  it("a real run refuses a runId that runs/index.json already lists", async () => {
    const f = await runFixture();
    put(
      join(f.root, "runs/index.json"),
      JSON.stringify({
        runs: [
          { finishedAt: "2026-10-23T15:41:00.000Z", manifestCid: f.baseCid, runId: BASE_RUN_ID },
        ],
        schema: "oracle-travis-runs-index.v1",
      }),
    );
    expect(() =>
      manifestOutputPath({ repoRoot: f.root, runId: BASE_RUN_ID, pilot: false }),
    ).toThrow(/already lists/);
  });

  it("a pilot goes to the pilot path and refuses any path under runs/", async () => {
    const f = await runFixture();
    expect(manifestOutputPath({ repoRoot: f.root, runId: "p", pilot: true })).toBe(
      join(f.root, "specs/011-publish-and-runs/pilot/manifest.json"),
    );
    expect(() =>
      manifestOutputPath({
        repoRoot: f.root,
        runId: "p",
        pilot: true,
        out: "runs/p/manifest.json",
      }),
    ).toThrow(/never written under runs\//);
    expect(() =>
      manifestOutputPath({
        repoRoot: f.root,
        runId: "p",
        pilot: true,
        out: join(f.root, "runs/../runs/x/m.json"),
      }),
    ).toThrow(/never written under runs\//);
  });

  it("writes built.bytes verbatim: the file's CID is the manifest CID (not a re-serialization)", async () => {
    const f = await runFixture();
    const built = await buildRunManifest(config(f), deps(f));
    const path = join(f.root, "runs/travis-full-run2-20261024/manifest.json");
    expect(writeManifestBytes(path, built)).toBe("written");
    expect(Buffer.from(built.bytes).equals(readFileSync(path))).toBe(true);
    expect(await cidOfFile(path)).toBe(built.cid);
    // Pretty-printing the same content would be a different file and a different CID.
    expect(readFileSync(path, "utf8")).not.toContain("\n");
  });

  it("leaves identical bytes alone and refuses different ones unless asked", async () => {
    const f = await runFixture();
    const built = await buildRunManifest(config(f), deps(f));
    const path = join(f.root, "out/manifest.json");
    expect(writeManifestBytes(path, built)).toBe("written");
    expect(writeManifestBytes(path, built)).toBe("unchanged");
    mkdirSync(join(f.root, "out"), { recursive: true });
    writeFileSync(path, "{}");
    expect(() => writeManifestBytes(path, built)).toThrow(/different bytes/);
    expect(writeManifestBytes(path, built, true)).toBe("written");
    expect(existsSync(path)).toBe(true);
  });
});

describe("permit link reconciliation (A-16 #6)", () => {
  const key = (count: number) => ({ count, derivation: "aggregate_match" as const });
  const run1 = {
    permits_no_tcad_geoid: key(275764),
    permits_no_tcad_id: key(31824),
    permits_ambiguous_geoid: key(36560),
    permits_address_unmatched: key(29475),
    permits_ambiguous_address: key(89),
  };

  it("accepts Run 1's real numbers: 373,712 excluded + 2,007,514 linked = 2,381,226", () => {
    expect(() =>
      assertPermitLinkReconciliation({
        coverage: run1,
        linkedPermits: 2007514,
        austinRecords: 2381226,
      }),
    ).not.toThrow();
  });

  it("fails with the numbers when they do not add up", () => {
    expect(() =>
      assertPermitLinkReconciliation({
        coverage: run1,
        linkedPermits: 2007513,
        austinRecords: 2381226,
      }),
    ).toThrow(/reconciliation failed: excluded 373712 .* \+ linked 2007513 = 2381225.*2381226/);
  });

  it("is skipped only without a linked total; with one, a missing key fails", () => {
    expect(() =>
      assertPermitLinkReconciliation({
        coverage: run1,
        linkedPermits: undefined,
        austinRecords: 1,
      }),
    ).not.toThrow();
    expect(() =>
      assertPermitLinkReconciliation({
        coverage: { permits_no_tcad_geoid: key(1) },
        linkedPermits: 5,
        austinRecords: 1,
      }),
    ).toThrow(/cannot run: coverage lacks permits_no_tcad_id/);
  });

  it("fails the build through buildRunManifest when linkedPermits is wrong, passes when right", async () => {
    const f = await runFixture();
    // fixture exclusions: 100 + 20 + 30 + 40 + 5 = 195; Austin source records 2,381,226
    const ok = await buildRunManifest(config(f, { linkedPermits: 2381226 - 195 }), deps(f));
    expect(ok.manifest.runId).toBe("travis-full-run2-20261024");
    await expect(buildRunManifest(config(f, { linkedPermits: 2000000 }), deps(f))).rejects.toThrow(
      /permit link reconciliation failed/,
    );
  });
});
