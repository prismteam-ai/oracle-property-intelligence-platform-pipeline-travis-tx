// A-11 Run 3: the incremental Austin source entry. The facts file (what incremental-facts.ts
// writes from the Query DB) becomes the manifest's Austin `sources[]` entry with the new
// watermark, the real digest-based delta and the new capture-time total; every other source keeps
// its facts with delta 0 and the reason "source unchanged, watermark X" (AC-7, AC-11).
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  austinReceiptOf,
  austinSourceInput,
  checkFactsAgainstBase,
  incrementalWindowLimitation,
  inferRemovedCount,
  parseAustinFacts,
  reconciliationNote,
  unchangedLimitation,
  unchangedSourceInput,
  type AustinIncrementalFacts,
} from "../src/incremental/austin-run.js";
import {
  buildRunManifest,
  carriedSourceLimitations,
  notRecapturedLimitation,
  type RunManifestConfig,
} from "../src/run-manifest.js";
import { NOT_YET_PUBLISHED, put, runFixture, type RunFixture } from "./support/run-fixture.js";

const W0 = "2026-10-21T14:42:23.154Z";
const W1 = "2026-10-24T14:51:37.805Z";

function facts(extra: Partial<AustinIncrementalFacts> = {}): AustinIncrementalFacts {
  return {
    schema: "oracle-travis-austin-incremental-facts.v1",
    jobId: "travis-a04-permits-incremental-20261026010203",
    watermarkUsed: W0,
    watermarkNew: W1,
    recordsRead: 2381886,
    totalBefore: 2381226,
    totalAfter: 2381886,
    capturedAt: "2026-10-26T01:30:00.000Z",
    mode: "full_pass",
    restampDetected: true,
    delta: { added: 660, changed: 3, removed: 0 },
    unchanged: 2381223,
    removalDetection: "keyset_diff",
    // 208 excluded + 2,381,678 linked = 2,381,886
    permitLink: {
      linkedPermits: 2381678,
      permits_no_tcad_geoid: 110,
      permits_no_tcad_id: 21,
      permits_ambiguous_geoid: 31,
      permits_address_unmatched: 41,
      permits_ambiguous_address: 5,
    },
    ...extra,
  };
}

const LAYER_RECEIPT = {
  captured_at: "2026-10-25T08:28:56.200Z",
  records: 466149,
  sha256: "4".repeat(64),
  layer_last_edit_date: "2026-10-24T04:31:08.027Z",
  layer_url:
    "https://services.arcgis.com/0L95CJ0VTaxqcmED/arcgis/rest/services/LOCATION_address_points/FeatureServer/0",
};

const AUSTIN = {
  name: "austin-3syk-w9eu",
  url: "https://data.austintexas.gov/resource/3syk-w9eu.json",
  receipts: "r.json",
  limitations: ["Comptroller baseline not loaded (A-07)"],
};

describe("austin facts", () => {
  it("parses a complete facts object and refuses an unknown key", () => {
    expect(parseAustinFacts(facts()).delta).toEqual({ added: 660, changed: 3, removed: 0 });
    expect(() => parseAustinFacts({ ...facts(), extra: 1 })).toThrow();
    expect(() => parseAustinFacts({ ...facts(), recordsRead: -1 })).toThrow();
  });

  it("states the watermark used, the rows read, the new watermark and the whole split in one line", () => {
    const line = incrementalWindowLimitation(facts());
    expect(line).toContain(`watermark used ${W0}`);
    expect(line).toContain(`new watermark ${W1}`);
    expect(line).toContain("2381886 rows read");
    expect(line).toContain("added 660, changed 3, removed 0, unchanged 2381223");
    expect(line).toContain("whole dataset paged by :id");
    expect(incrementalWindowLimitation(facts({ mode: "window" }))).toContain(
      `window :updated_at > ${W0}`,
    );
  });

  it("builds the Austin source input: new watermark, delta verbatim, re-stamp stated", () => {
    const input = austinSourceInput(facts(), AUSTIN);
    expect(input.watermark).toBe(W1);
    expect(input.delta).toEqual({ added: 660, changed: 3, removed: 0 });
    expect(input.limitations[0]).toBe("Comptroller baseline not loaded (A-07)");
    expect(input.limitations).toContain("source bulk re-stamp; delta by content digest");
    expect(input.limitations.some((l) => l.startsWith("Incremental run:"))).toBe(true);
    expect(input.limitations.some((l) => l.startsWith("source unchanged"))).toBe(false);
    expect(austinReceiptOf(facts())).toEqual({
      captured_at: "2026-10-26T01:30:00.000Z",
      records: 2381886,
    });
  });

  it("a window with nothing new keeps its delta at 0 and says why", () => {
    const f = facts({
      delta: { added: 0, changed: 0, removed: 0 },
      unchanged: 2381226,
      totalAfter: 2381226,
      recordsRead: 2381226,
      permitLink: {
        linkedPermits: 2381031,
        permits_no_tcad_geoid: 100,
        permits_no_tcad_id: 20,
        permits_ambiguous_geoid: 30,
        permits_address_unmatched: 40,
        permits_ambiguous_address: 5,
      },
    });
    expect(austinSourceInput(f, AUSTIN).limitations).toContain(unchangedLimitation(W1));
  });

  it("says removals were not checked when the window was narrow", () => {
    const f = facts({ mode: "window", restampDetected: false, removalDetection: "not_checked" });
    expect(austinSourceInput(f, AUSTIN).limitations.join("\n")).toMatch(/removals not checked/);
  });

  it("reports a row-count difference instead of hiding it", () => {
    expect(reconciliationNote(facts())).toBeNull(); // 2381226 + 660 - 0 = 2381886
    expect(reconciliationNote(facts({ totalAfter: 2381890 }))).toMatch(
      /4 more share a permit number/,
    );
  });

  it("an unchanged source keeps its watermark, delta 0 and the reason", () => {
    const input = unchangedSourceInput({
      name: "tcad-2026-certified-json",
      url: "https://traviscad.org/publicinformation",
      watermark: "entry@sha256:abc",
      receipts: "t.json",
      limitations: ["x"],
    });
    expect(input.delta).toEqual({ added: 0, changed: 0, removed: 0 });
    expect(input.watermark).toBe("entry@sha256:abc");
    expect(input.limitations).toEqual(["x", "source unchanged, watermark entry@sha256:abc"]);
  });

  it("refuses facts that do not follow the base run", () => {
    const base = { watermark: W0, records: 2381226 };
    expect(() => checkFactsAgainstBase(facts(), base)).not.toThrow();
    expect(() =>
      checkFactsAgainstBase(facts({ watermarkUsed: "2026-10-20T00:00:00.000Z" }), base),
    ).toThrow(/chain is broken/);
    expect(() =>
      checkFactsAgainstBase(facts({ watermarkNew: "2026-10-01T00:00:00.000Z" }), base),
    ).toThrow(/older than the one used/);
    expect(() => checkFactsAgainstBase(facts({ totalBefore: 5 }), base)).toThrow(
      /rows before the run/,
    );
    expect(() => checkFactsAgainstBase(facts({ recordsRead: 10 }), base)).toThrow(
      /exceeds the 10 rows read/,
    );
    expect(() =>
      checkFactsAgainstBase(
        facts({ permitLink: { ...facts().permitLink, linkedPermits: 1 } }),
        base,
      ),
    ).toThrow(/permit-link totals add up to/);
  });

  it("drops the notes a previous incremental run attached to itself", () => {
    expect(
      carriedSourceLimitations([
        "Comptroller baseline not loaded (A-07)",
        "Incremental run: x",
        "source unchanged, watermark y",
        "source bulk re-stamp; delta by content digest",
        "Row count reconciliation: z",
        "removals not checked: w",
        "No new capture since Run 3 (r3): these are Run 3's source facts",
        notRecapturedLimitation("travis-full-run3-1-20261025", "2026-10-24T04:31:08.027Z"),
      ]),
    ).toEqual(["Comptroller baseline not loaded (A-07)"]);
  });
});

describe("inferRemovedCount (no key-set read)", () => {
  it("is zero when every stored row is either unmoved or in the window", () => {
    expect(
      inferRemovedCount({ stored: 100, sourceCountAtWatermark: 90, windowRowsAlreadyStored: 10 }),
    ).toBe(0);
  });
  it("counts stored rows that are neither unmoved nor in the window", () => {
    expect(
      inferRemovedCount({ stored: 100, sourceCountAtWatermark: 88, windowRowsAlreadyStored: 9 }),
    ).toBe(3);
  });
  it("never goes negative", () => {
    expect(
      inferRemovedCount({ stored: 10, sourceCountAtWatermark: 10, windowRowsAlreadyStored: 5 }),
    ).toBe(0);
  });
});

function config(f: RunFixture, extra: Partial<RunManifestConfig> = {}): RunManifestConfig {
  return {
    runId: "travis-full-run3-20261026",
    startedAt: "2026-10-26T01:00:00.000Z",
    finishedAt: "2026-10-26T04:00:00.000Z",
    previousManifestCid: f.baseCid,
    countyDir: f.countyDir,
    permitsDir: f.permitsV1,
    austinFacts: "specs/011-publish-and-runs/run3/austin-facts.json",
    austinReceipt: "specs/011-publish-and-runs/run3/austin-receipt.json",
    ...extra,
  };
}

function writeFacts(f: RunFixture, value: AustinIncrementalFacts): void {
  put(join(f.root, "specs/011-publish-and-runs/run3/austin-facts.json"), JSON.stringify(value));
  put(
    join(f.root, "specs/011-publish-and-runs/run3/austin-receipt.json"),
    JSON.stringify(austinReceiptOf(value)),
  );
}

const deps = (f: RunFixture) => ({
  repoRoot: f.root,
  workTreeStatus: NOT_YET_PUBLISHED,
  gitCommit: () => "abc1234",
});

describe("buildRunManifest, incremental (Run 3)", () => {
  it("records the Austin delta, new watermark and total; TCAD stays unchanged with the reason", async () => {
    const f = await runFixture();
    writeFacts(f, facts());
    const { manifest: m } = await buildRunManifest(config(f), deps(f));
    const austin = m.sources.find((s) => s.name === "austin-3syk-w9eu");
    const tcad = m.sources.find((s) => s.name.startsWith("tcad"));
    expect(austin).toMatchObject({
      watermark: W1,
      records: 2381886,
      captured_at: "2026-10-26T01:30:00.000Z",
      added: 660,
      changed: 3,
      removed: 0,
    });
    expect(austin?.limitations.some((l) => l.includes(`watermark used ${W0}`))).toBe(true);
    expect(tcad).toMatchObject({ added: 0, changed: 0, removed: 0, records: 493246 });
    expect(tcad?.limitations).toContain(unchangedLimitation(tcad?.watermark ?? null));
    expect(m.previousManifestCid).toBe(f.baseCid);
  });

  it("takes the five permit-link totals from the facts and runs the A-16 reconciliation on them", async () => {
    const f = await runFixture();
    writeFacts(f, facts());
    const { manifest: m } = await buildRunManifest(config(f), deps(f));
    expect(m.coverage.permits_no_tcad_geoid?.count).toBe(110);
    expect(m.coverage.permits_ambiguous_address?.count).toBe(5);
    // a wrong linked total fails the build: excluded 208 + linked != 2,381,886
    writeFacts(f, facts({ permitLink: { ...facts().permitLink, linkedPermits: 2381677 } }));
    await expect(buildRunManifest(config(f), deps(f))).rejects.toThrow(/permit-link totals add up/);
  });

  it("states an incremental note instead of the correction note", async () => {
    const f = await runFixture();
    writeFacts(f, facts());
    const { manifest: m } = await buildRunManifest(config(f), deps(f));
    expect(
      m.limitations.some((l) => l.startsWith("Incremental refresh of the Austin permits source")),
    ).toBe(true);
    expect(m.limitations.join("\n")).not.toMatch(/Correction run/);
  });

  it("refuses facts that started from another watermark than the base manifest's", async () => {
    const f = await runFixture();
    writeFacts(f, facts({ watermarkUsed: "2026-10-01T00:00:00.000Z" }));
    await expect(buildRunManifest(config(f), deps(f))).rejects.toThrow(/chain is broken/);
  });

  it("refuses a receipt file that disagrees with the facts", async () => {
    const f = await runFixture();
    writeFacts(f, facts());
    put(
      join(f.root, "specs/011-publish-and-runs/run3/austin-receipt.json"),
      JSON.stringify({ captured_at: "2026-10-25T01:30:00.000Z", records: 2381886 }),
    );
    await expect(buildRunManifest(config(f), deps(f))).rejects.toThrow(
      /receipt file does not match the incremental facts/,
    );
    // a total that disagrees is caught even earlier, by the permit-link reconciliation
    put(
      join(f.root, "specs/011-publish-and-runs/run3/austin-receipt.json"),
      JSON.stringify({ captured_at: "2026-10-26T01:30:00.000Z", records: 2381000 }),
    );
    await expect(buildRunManifest(config(f), deps(f))).rejects.toThrow(/reconciliation failed/);
  });

  it("A11-10(d): same permit count, different exclusions: the facts' numbers replace the base's, other keys carry", async () => {
    const f = await runFixture();
    writeFacts(
      f,
      facts({
        permitLink: {
          ...facts().permitLink,
          // the base manifest recorded 100 / 20 / 30 / 40 / 5; this refresh sees different totals
          permits_no_tcad_geoid: 130,
          permits_no_tcad_id: 15,
          permits_ambiguous_geoid: 30,
          permits_address_unmatched: 33,
          permits_ambiguous_address: 0,
          linkedPermits: 2381886 - (130 + 15 + 30 + 33 + 0),
        },
      }),
    );
    // permitsV1 are the base's own batches: the published permit rows are unchanged
    const { manifest: m } = await buildRunManifest(config(f), deps(f));
    expect(m.coverage.permits_emitted?.count).toBe(7); // unchanged count
    expect(m.coverage.permits_no_tcad_geoid?.count).toBe(130);
    expect(m.coverage.permits_no_tcad_id?.count).toBe(15);
    expect(m.coverage.permits_address_unmatched?.count).toBe(33);
    expect(m.coverage.permits_ambiguous_address?.count).toBe(0);
    // the keys about the published rows are still the base's, because those rows did not change
    expect(m.coverage.contractor_unresolved?.count).toBe(7);
  });

  it("A11-6: an exclusion override that breaks the sum is refused with the numbers", async () => {
    const f = await runFixture();
    writeFacts(f, facts());
    await expect(
      buildRunManifest(
        config(f, {
          coverageOverrides: {
            permits_no_tcad_geoid: { count: 111, derivation: "aggregate_match" },
          },
        }),
        deps(f),
      ),
    ).rejects.toThrow(/permit link reconciliation failed: excluded .*permits_no_tcad_geoid 111/);
  });

  it("A11-10(d): same count but a rebuilt permits group in an incremental run needs explicit coverage", async () => {
    const f = await runFixture();
    writeFacts(f, facts());
    await expect(buildRunManifest(config(f, { permitsDir: f.permitsV2 }), deps(f))).rejects.toThrow(
      /rebuilt in an incremental run.*Supply coverageOverrides for: .*contractor_unresolved/s,
    );
    const supplied = await buildRunManifest(
      config(f, {
        permitsDir: f.permitsV2,
        coverageOverrides: {
          contractor_resolved: { count: 0, derivation: "aggregate_match" },
          contractor_candidate: { count: 0, derivation: "aggregate_match" },
          contractor_unresolved: { count: 7, derivation: "aggregate_match" },
        },
      }),
      deps(f),
    );
    expect(supplied.manifest.coverage.permits_emitted?.count).toBe(7);
  });

  it("Run 4: carries the layer source with delta 0 and drops the correction run's per-run Austin note", async () => {
    const f = await runFixture();
    const layer = join(f.root, "address-points-receipt.json");
    writeFileSync(layer, JSON.stringify(LAYER_RECEIPT));
    // The base is a Run 3.1-style correction run: no capture, the layer listed, and its own
    // "No new capture since" note on the Austin source.
    const correction = await buildRunManifest(
      {
        runId: "travis-full-run3-1-20261025",
        startedAt: "2026-10-25T21:00:00.000Z",
        finishedAt: "2026-10-25T23:00:00.000Z",
        previousManifestCid: f.baseCid,
        countyDir: f.countyDir,
        permitsDir: f.permitsV1,
        addressPointsReceipt: layer,
        sourceLimitations: {
          "austin-3syk-w9eu": ["No new capture since Run 3 (r3): these are Run 3's source facts"],
        },
      },
      deps(f),
    );
    put(join(f.root, "runs/travis-full-run3-1-20261025/manifest.json"), correction.bytes);
    writeFacts(f, facts());
    const { manifest: m } = await buildRunManifest(
      config(f, {
        baseManifest: "runs/travis-full-run3-1-20261025/manifest.json",
        previousManifestCid: correction.cid,
        addressPointsReceipt: layer,
        carryAddressPoints: true,
      }),
      deps(f),
    );
    expect(m.sources.map((s) => s.name)).toEqual([
      "austin-3syk-w9eu",
      "tcad-2026-certified-json",
      "austin-address-points",
    ]);
    const before = correction.manifest.sources[2];
    expect(m.sources[2]).toMatchObject({
      watermark: before?.watermark,
      records: before?.records,
      captured_at: before?.captured_at,
      added: 0,
      changed: 0,
      removed: 0,
    });
    expect(m.sources[2]?.limitations).toEqual([
      ...(before?.limitations ?? []),
      notRecapturedLimitation("travis-full-run3-1-20261025", before?.watermark ?? null),
    ]);
    const austin = m.sources[0];
    expect(austin).toMatchObject({ watermark: W1, added: 660, changed: 3, removed: 0 });
    expect(austin?.limitations.join("\n")).not.toMatch(/No new capture since/);
  });

  it("a run with new facts but without carryAddressPoints still leaves the layer out", async () => {
    const f = await runFixture();
    writeFacts(f, facts());
    const { manifest: m } = await buildRunManifest(config(f), deps(f));
    expect(m.sources.map((s) => s.name)).not.toContain("austin-address-points");
  });

  it("without facts a follow-up run is still the no-capture correction run (delta 0, same watermark)", async () => {
    const f = await runFixture();
    const { manifest: m } = await buildRunManifest(
      {
        runId: "travis-full-run2-20261024",
        startedAt: "2026-10-24T08:00:00.000Z",
        finishedAt: "2026-10-24T12:00:00.000Z",
        previousManifestCid: f.baseCid,
        countyDir: f.countyDir,
        permitsDir: f.permitsV2,
      },
      deps(f),
    );
    const austin = m.sources.find((s) => s.name === "austin-3syk-w9eu");
    expect(austin).toMatchObject({ watermark: W0, added: 0, changed: 0, removed: 0 });
    expect(austin?.limitations.some((l) => l.startsWith("source unchanged"))).toBe(false);
  });
});
