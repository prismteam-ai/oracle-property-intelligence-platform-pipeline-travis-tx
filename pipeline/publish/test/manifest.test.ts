// T027: buildManifest() and the run index from fixture CLI outputs (real CAR and dag-json bytes
// built here). A-03: no pilot limitation, fixed source order, coverage derivations, carCid on
// car and directory artifacts, 48m part bound, exact JCS bytes, RunsIndexV1 ordered by finishedAt.
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { CarWriter } from "@ipld/car/writer";
import * as dagJson from "@ipld/dag-json";
import { CID } from "multiformats/cid";
import { sha256 } from "multiformats/hashes/sha2";
import { describe, expect, it } from "vitest";
import { PILOT_LIMITATION, RunManifestV1, RunsIndexV1, isCidV1 } from "@countylens/contract";
import {
  GROUP_COVERAGE_KEYS,
  SOURCE_ORDER,
  buildManifest,
  manifestGroupInputsFromBatches,
  requiredCoverageKeys,
  sourceInputFromDelta,
  type BuildManifestInput,
} from "../src/manifest.js";
import { NO_NEWER_EXPORT, RESTAMP_LIMITATION } from "../src/incremental/delta.js";
import {
  addRun,
  appendRun,
  emptyRunsIndex,
  parseRunsIndex,
  runsIndexBytes,
  verifyCommittedRuns,
} from "../src/runs-index.js";
import * as runsIndexModule from "../src/runs-index.js";
import { cidOfBytes, cidOfFile } from "../src/cid.js";
import { jcsBytes } from "../src/jcs.js";
import { PART_SIZE_BYTES, type DataGroup } from "../src/sequence.js";

const SHA = "c".repeat(64);
const RUN_ID = "travis-202609-reroof-20261021t1530z";
const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));

async function writeCar(path: string, value: unknown): Promise<CID> {
  const bytes = dagJson.encode(value);
  const root = CID.create(1, dagJson.code, await sha256.digest(bytes));
  const { writer, out } = CarWriter.create([root]);
  const chunks: Uint8Array[] = [];
  const done = (async () => {
    for await (const c of out) chunks.push(c);
  })();
  await writer.put({ cid: root, bytes });
  await writer.close();
  await done;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, Buffer.concat(chunks));
  return root;
}

function write(path: string, body: string | Uint8Array): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body);
}

interface Fixture {
  input: BuildManifestInput;
  runDir: string;
}

interface FixtureOptions {
  corruptPart?: boolean;
  wrongCountyRoot?: boolean;
  countyTables?: string[];
  /** `part_size_bytes` written into every CountyTables block. */
  partSizeBytes?: number;
  /** Declare one county part larger than the 48m bound. */
  oversizedPart?: boolean;
  /** The groups to build (T005/T009/T010: defaults to the 2-group walking skeleton). */
  groups?: readonly DataGroup[];
}

/** One table per group, by default (county keeps its own 2-table fixture for T005's part tests). */
const DEFAULT_TABLES: Record<DataGroup, string[]> = {
  county: ["property", "structure"],
  property_improvement: ["property", "property_improvement"],
};

async function fixture(opts: FixtureOptions = {}): Promise<Fixture> {
  const p = mkdtempSync(join(tmpdir(), "run-"));
  const groups: BuildManifestInput["groups"] = [];
  for (const group of opts.groups ?? (["county", "property_improvement"] as const)) {
    const carPath = join(p, `car/travis-${group}.car`);
    const countyRoot = await writeCar(carPath, { label: "CountyIndex", group });
    const tablesDir = join(p, `tables/${group}`);
    const tableNames =
      group === "county" ? (opts.countyTables ?? DEFAULT_TABLES.county) : DEFAULT_TABLES[group];
    const tables: Record<
      string,
      { rows: number; parts: Array<{ cid: CID; rows: number; bytes: number }> }
    > = {};
    for (const [i, name] of tableNames.entries()) {
      const bytes = new TextEncoder().encode(`PAR1 ${group} ${name} ${i}`);
      write(join(tablesDir, name, "part-00000.parquet"), bytes);
      const declared =
        opts.oversizedPart && group === "county" && i === 0 ? PART_SIZE_BYTES + 1 : bytes.length;
      tables[name] = {
        rows: i + 1,
        parts: [{ cid: CID.parse(await cidOfBytes(bytes)), rows: i + 1, bytes: declared }],
      };
    }
    if (opts.corruptPart && group === "county" && tableNames.includes("property"))
      write(join(tablesDir, "property", "part-00000.parquet"), "tampered");
    const otherRoot = CID.create(
      1,
      dagJson.code,
      await sha256.digest(new TextEncoder().encode("other")),
    );
    const tablesRoot = await writeCar(join(tablesDir, "tables.car"), {
      label: "CountyTables",
      version: 1,
      county_root: opts.wrongCountyRoot ? otherRoot : countyRoot,
      part_size_bytes: opts.partSizeBytes ?? PART_SIZE_BYTES,
      codec: "zstd",
      tables,
    });
    const exportJson = join(p, `reports/${group}-tables-export.json`);
    write(
      exportJson,
      JSON.stringify({
        output: tablesDir,
        car: join(tablesDir, "tables.car"),
        root: tablesRoot.toString(),
        countyRoot: countyRoot.toString(),
        partSizeBytes: opts.partSizeBytes ?? PART_SIZE_BYTES,
        codec: "zstd",
        tables: Object.fromEntries(
          Object.entries(tables).map(([k, v]) => [k, { rows: v.rows, parts: v.parts.length }]),
        ),
        parts: tableNames.length,
        exportedAt: "2026-10-21T15:00:00.000Z",
      }),
    );
    groups.push({
      group,
      carPath,
      carRoot: countyRoot.toString(),
      tablesDir,
      tablesRoot: tablesRoot.toString(),
      tablesExportJson: exportJson,
    });
  }
  write(
    join(p, "capture/austin/receipts.jsonl"),
    [
      {
        url: "https://data.austintexas.gov/resource/3syk-w9eu.json?permit_number=A",
        captured_at: "2026-10-21T14:00:01.000Z",
        outcome: "ok",
      },
      {
        url: "https://data.austintexas.gov/resource/3syk-w9eu.json?permit_number=B",
        captured_at: "2026-10-21T14:00:02.000Z",
        outcome: "ok",
      },
      {
        url: "https://data.austintexas.gov/resource/3syk-w9eu.json?permit_number=C",
        captured_at: "2026-10-21T14:00:03.000Z",
        outcome: "ok",
      },
    ]
      .map((r) => JSON.stringify(r))
      .join("\n") + "\n",
  );
  write(
    join(p, "capture/tcad/receipt.json"),
    JSON.stringify({ captured_at: "2026-10-21T14:30:00.000Z", records: [{}, {}, {}] }),
  );
  const input: BuildManifestInput = {
    runId: RUN_ID,
    county: "travis",
    state: "TX",
    fips: "48453",
    startedAt: "2026-10-21T14:00:00.000Z",
    finishedAt: "2026-10-21T15:00:00.000Z",
    previousManifestCid: null,
    runDir: p,
    groups,
    sources: [
      {
        name: "austin-3syk-w9eu",
        url: "https://data.austintexas.gov/resource/3syk-w9eu.json",
        watermark: "2026-10-20T12:36:38.000Z",
        receipts: join(p, "capture/austin/receipts.jsonl"),
        limitations: [],
      },
      {
        name: "tcad-2026-certified-json",
        url: "https://traviscad.org/publicinformation",
        watermark: "entry@sha256:" + "d".repeat(64),
        receipts: join(p, "capture/tcad/receipt.json"),
        limitations: [],
      },
    ],
    profiles: [
      {
        name: "travis-austin",
        version: "1.0.0",
        sha256: SHA,
        path: "profiles/travis-austin@1.0.0/rules.json",
        gitCommit: "17c6cd8",
      },
    ],
    // The property_improvement table of the property_improvement group has 2 rows (fixture);
    // 3 permits were captured, so 1 had no tcad_id. Other groups' tables have 1 row each
    // (DEFAULT_TABLES): their required coverage keys count that same 1 row.
    coverage: Object.fromEntries(
      requiredCoverageKeys((opts.groups ?? ["county", "property_improvement"]) as DataGroup[]).map(
        ([key, derivation]) => [
          key,
          {
            count: key === "permits_emitted" ? 2 : key === "permits_no_tcad_geoid" ? 1 : 1,
            derivation,
          },
        ],
      ),
    ),
    // The run summary's `owners_redacted` (T082): no confidential owner in this fixture.
    ownersRedacted: 0,
    limitations: [],
    workTreeStatus: () => "",
  };
  return { input, runDir: p };
}

/** The element at `i`, failing the test when it is absent. */
function at<T>(xs: readonly T[], i: number): T {
  const v = xs[i];
  if (v === undefined) throw new Error(`no element at ${i}`);
  return v;
}

describe("buildManifest (A-03)", () => {
  it("sorts table artifacts by code-unit order, not locale ('/' before '_'; code-review #5)", async () => {
    const { input } = await fixture({ countyTables: ["address_has_parcel", "address"] });
    const { manifest } = await buildManifest(input);
    const names = manifest.artifacts
      .filter((a) => a.kind === "table" && a.name.startsWith("tables/county/"))
      .map((a) => a.name);
    expect(names).toEqual([
      "tables/county/address/part-00000.parquet",
      "tables/county/address_has_parcel/part-00000.parquet",
    ]);
  });

  it("builds a RunManifestV1 with a published runId, previousManifestCid null, no pilot limitation", async () => {
    const { input } = await fixture();
    const { manifest } = await buildManifest(input);
    expect(RunManifestV1.parse(manifest)).toEqual(manifest);
    expect(manifest.runId).toBe(RUN_ID);
    expect(manifest.runId).toMatch(/^[a-z0-9][a-z0-9-]*$/);
    expect(manifest.runId).not.toContain("pilot");
    expect(manifest.previousManifestCid).toBeNull();
    expect(manifest.limitations).not.toContain(PILOT_LIMITATION);
  });

  it("rejects a pilot runId and the pilot limitation: a published run is never the pilot", async () => {
    const { input } = await fixture();
    await expect(buildManifest({ ...input, runId: "travis-pilot-20261020" })).rejects.toThrow(
      /pilot/,
    );
    await expect(buildManifest({ ...input, limitations: [PILOT_LIMITATION] })).rejects.toThrow(
      /pilot/,
    );
    await expect(buildManifest({ ...input, runId: "Travis_Run" })).rejects.toThrow(/runId/);
  });

  it("gives every artifact a CIDv1, name, codec, size and sha256; car and directory carry carCid", async () => {
    const { input, runDir } = await fixture();
    const { manifest } = await buildManifest(input);
    expect(manifest.artifacts.length).toBeGreaterThan(0);
    for (const a of manifest.artifacts) {
      expect(isCidV1(a.cid), a.name).toBe(true);
      expect(a.name.length).toBeGreaterThan(0);
      expect(["raw", "dag-pb", "dag-json"]).toContain(a.codec);
      expect(Number.isInteger(a.size) && a.size >= 0).toBe(true);
      expect(a.sha256).toMatch(/^[a-f0-9]{64}$/);
      if (a.kind === "car" || a.kind === "directory") {
        expect(a.carCid, `${a.kind} ${a.name} needs carCid`).toBeDefined();
        expect(isCidV1(a.carCid as string)).toBe(true);
      } else {
        expect(a.carCid).toBeUndefined();
      }
    }
    const kinds = manifest.artifacts.map((a) => a.kind);
    expect(kinds.filter((k) => k === "car")).toHaveLength(2);
    expect(kinds.filter((k) => k === "directory")).toHaveLength(2);
    expect(kinds.filter((k) => k === "table")).toHaveLength(4);
    for (const dir of manifest.artifacts.filter((a) => a.kind === "directory")) {
      expect(dir.carCid).toBe(await cidOfFile(join(runDir, dir.name, "tables.car")));
      expect(dir.codec).toBe("dag-json");
    }
    const car = manifest.artifacts.find((a) => a.name === "car/travis-county.car");
    expect(car).toMatchObject({ kind: "car", codec: "dag-json", cid: at(input.groups, 0).carRoot });
    // AM-05: the .car file itself is also added as a plain raw-leaves file; carCid is its CID.
    expect(car?.carCid).toBe(await cidOfFile(join(runDir, "car/travis-county.car")));
    expect(car?.carCid).not.toBe(car?.cid);
    expect(car?.size).toBe(readFileSync(join(runDir, "car/travis-county.car")).length);
    const part = manifest.artifacts.find(
      (a) => a.name === "tables/county/property/part-00000.parquet",
    );
    expect(part).toMatchObject({ kind: "table", codec: "raw" });
    const bytes = readFileSync(join(runDir, "tables/county/property/part-00000.parquet"));
    expect(part?.size).toBe(bytes.length);
    expect(part?.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
  });

  it("bounds every table part at the 48m export size (ADR-0001 decision 3)", async () => {
    expect(PART_SIZE_BYTES).toBe(48 * 1024 * 1024);
    expect(PART_SIZE_BYTES).toBeLessThanOrEqual(50_331_648);
    const oversized = await fixture({ oversizedPart: true });
    await expect(buildManifest(oversized.input)).rejects.toThrow(/48m/);
    const otherPartSize = await fixture({ partSizeBytes: 1 << 30 });
    await expect(buildManifest(otherPartSize.input)).rejects.toThrow(/part_size_bytes/);
  });

  it("reads part CIDs from the CountyTables block and fails when a part does not re-derive", async () => {
    const { input } = await fixture({ corruptPart: true });
    await expect(buildManifest(input)).rejects.toThrow(/part CID mismatch/);
  });

  it("fails when the CountyTables county_root is not the group's CAR root", async () => {
    const { input } = await fixture({ wrongCountyRoot: true });
    await expect(buildManifest(input)).rejects.toThrow(/county_root/);
  });

  it("fails when the printed roots disagree with the files", async () => {
    const { input } = await fixture();
    at(input.groups, 0).tablesRoot = at(input.groups, 1).tablesRoot;
    await expect(buildManifest(input)).rejects.toThrow(/tables root/);
  });

  it("lists the sources in the fixed order: austin-3syk-w9eu then tcad-2026-certified-json", async () => {
    expect(SOURCE_ORDER).toEqual(["austin-3syk-w9eu", "tcad-2026-certified-json"]);
    const { input } = await fixture();
    const { manifest } = await buildManifest(input);
    expect(manifest.sources.map((s) => s.name)).toEqual([...SOURCE_ORDER]);
    expect(manifest.sources[0]).toMatchObject({
      records: 3,
      added: 3,
      captured_at: "2026-10-21T14:00:03.000Z",
    });
    expect(manifest.sources[1]).toMatchObject({
      records: 3,
      captured_at: "2026-10-21T14:30:00.000Z",
    });
    const swapped = { ...input, sources: [at(input.sources, 1), at(input.sources, 0)] };
    await expect(buildManifest(swapped)).rejects.toThrow(/sources/);
    const one = { ...input, sources: [at(input.sources, 0)] };
    await expect(buildManifest(one)).rejects.toThrow(/sources/);
  });

  it("requires coverage.permits_emitted (published_rows) and permits_no_tcad_geoid (aggregate_match)", async () => {
    const { input } = await fixture();
    const { manifest } = await buildManifest(input);
    expect(manifest.coverage.permits_emitted).toEqual({ count: 2, derivation: "published_rows" });
    expect(manifest.coverage.permits_no_tcad_geoid).toEqual({
      count: 1,
      derivation: "aggregate_match",
    });
    await expect(
      buildManifest({
        ...input,
        coverage: { permits_no_tcad_geoid: { count: 1, derivation: "aggregate_match" } },
      }),
    ).rejects.toThrow(/permits_emitted/);
    await expect(
      buildManifest({
        ...input,
        coverage: { permits_emitted: { count: 2, derivation: "published_rows" } },
      }),
    ).rejects.toThrow(/permits_no_tcad_geoid/);
    await expect(
      buildManifest({
        ...input,
        coverage: {
          permits_emitted: { count: 2, derivation: "aggregate_match" },
          permits_no_tcad_geoid: { count: 1, derivation: "aggregate_match" },
        },
      }),
    ).rejects.toThrow(/published_rows/);
    await expect(
      buildManifest({
        ...input,
        coverage: {
          permits_emitted: { count: 2, derivation: "published_rows" },
          permits_no_tcad_geoid: { count: 1, derivation: "published_rows" },
        },
      }),
    ).rejects.toThrow(/aggregate_match/);
  });

  it("checks permits_emitted against the published property_improvement rows", async () => {
    const { input } = await fixture();
    await expect(
      buildManifest({
        ...input,
        coverage: {
          ...input.coverage,
          permits_emitted: { count: 37, derivation: "published_rows" },
          permits_no_tcad_geoid: { count: 1, derivation: "aggregate_match" },
        },
      }),
    ).rejects.toThrow(/permits_emitted/);
  });

  it("fails on a dirty working tree and names the files", async () => {
    const { input } = await fixture();
    await expect(
      buildManifest({
        ...input,
        workTreeStatus: () => " M profiles/travis-austin@1.0.0/rules.json\n",
      }),
    ).rejects.toThrow(/dirty.*rules\.json/s);
  });

  it("returns exact JCS bytes with no trailing newline and their raw-leaves CIDv1, deterministically", async () => {
    const { input } = await fixture();
    const a = await buildManifest(input);
    const b = await buildManifest(input);
    expect(Buffer.from(a.bytes).equals(Buffer.from(jcsBytes(a.manifest)))).toBe(true);
    expect(a.bytes[a.bytes.length - 1]).not.toBe(0x0a);
    expect(a.cid).toBe(await cidOfBytes(a.bytes));
    expect(a.cid.startsWith("bafkrei")).toBe(true);
    expect(b.cid).toBe(a.cid);
    const text = Buffer.from(a.bytes).toString("utf8");
    expect(text).not.toMatch(/\/ip[fn]s\//);
    expect(text).not.toMatch(/ipns/i);
  });

  it("imports no database client (reads CLI outputs and receipts only)", () => {
    const src = readFileSync(new URL("../src/manifest.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/from\s+["'](pg|postgres|@duckdb\/[^"']+)["']/);
  });
});

// T004/T006/T009 corrected 2026-10-23: checkInput's per-run coverage-key profile stays the real
// 2 groups (county, property_improvement) — matching the actual lexicon manifest. Owner/parcel
// geometry are already embedded fields in county's export. Contractor identity's AD-05 states
// have no lexicon carrier at all (ADR-0002 #6: property_improvement and company are
// additionalProperties:false with no such field, and AD-06's property_improvement_has_contractor
// edge is confined to a `resolved` match that D-10's empty crosswalk never produces live) — so
// the three states land only as this group's manifest-coverage keys (AD-24's fallback), never
// as record fields.
describe("checkInput: the coverage-key profile (T004, T006, T009, corrected)", () => {
  it("requiredCoverageKeys is exactly the union of the present groups' own keys, order-independent", () => {
    expect(requiredCoverageKeys(["county"])).toEqual([]);
    expect(requiredCoverageKeys(["property_improvement"])).toEqual(
      GROUP_COVERAGE_KEYS.property_improvement,
    );
  });

  it("throws when property_improvement's permits_emitted coverage key is missing", async () => {
    const { input } = await fixture();
    const { permits_emitted, ...withoutEmitted } = input.coverage;
    void permits_emitted;
    await expect(buildManifest({ ...input, coverage: withoutEmitted })).rejects.toThrow(
      /permits_emitted/,
    );
  });

  it("throws when a present group's coverage key has the wrong derivation", async () => {
    const { input } = await fixture();
    await expect(
      buildManifest({
        ...input,
        coverage: {
          ...input.coverage,
          permits_emitted: { count: 1, derivation: "capture_receipt" },
        },
      }),
    ).rejects.toThrow(/permits_emitted.*published_rows/);
  });

  it("throws on an extra undeclared source, not only a missing or swapped one", async () => {
    const { input } = await fixture();
    await expect(
      buildManifest({
        ...input,
        sources: [
          ...input.sources,
          {
            name: "bbb-harvest",
            url: "https://www.bbb.org/search",
            watermark: null,
            receipts: input.sources[1]?.receipts as string,
            limitations: [],
          },
        ],
      }),
    ).rejects.toThrow(/sources/);
  });
});

// S6a.2: at full-county scale a data group is N CARs (AD-0001's batching — 10 for Run 1's
// `county`, 2 for its `property_improvement`), not the A-03 pilot's one-CAR assumption.
// `ManifestGroupInput[]` already supports repeated `group` entries (an array); these tests pin
// that `buildManifest` actually sums each group's table rows across its batches (not just the
// last one written) and keeps every batch's artifacts, before any real multi-batch run existed.
describe("buildManifest: multiple CARs (batches) per data group (S6a.2)", () => {
  async function batchedFixture(
    piRowsPerBatch: readonly number[],
  ): Promise<{ input: BuildManifestInput; runDir: string }> {
    const p = mkdtempSync(join(tmpdir(), "run-batched-"));
    const groups: BuildManifestInput["groups"] = [];
    for (const [idx, piRows] of piRowsPerBatch.entries()) {
      const b = idx + 1;
      const carPath = join(p, `car/travis-property_improvement-b${b}.car`);
      const countyRoot = await writeCar(carPath, {
        label: "CountyIndex",
        group: "property_improvement",
        batch: b,
      });
      const tablesDir = join(p, `tables/property_improvement-b${b}`);
      const bytes = new TextEncoder().encode(`PAR1 pi b${b}`);
      write(join(tablesDir, "property_improvement", "part-00000.parquet"), bytes);
      const tables = {
        property_improvement: {
          rows: piRows,
          parts: [{ cid: CID.parse(await cidOfBytes(bytes)), rows: piRows, bytes: bytes.length }],
        },
      };
      const tablesRoot = await writeCar(join(tablesDir, "tables.car"), {
        label: "CountyTables",
        version: 1,
        county_root: countyRoot,
        part_size_bytes: PART_SIZE_BYTES,
        codec: "zstd",
        tables,
      });
      const exportJson = join(p, `reports/property_improvement-b${b}-tables-export.json`);
      write(
        exportJson,
        JSON.stringify({
          output: tablesDir,
          car: join(tablesDir, "tables.car"),
          root: tablesRoot.toString(),
          countyRoot: countyRoot.toString(),
          partSizeBytes: PART_SIZE_BYTES,
          codec: "zstd",
          tables: { property_improvement: { rows: piRows, parts: 1 } },
          parts: 1,
          exportedAt: "2026-10-21T15:00:00.000Z",
        }),
      );
      groups.push({
        group: "property_improvement",
        carPath,
        carRoot: countyRoot.toString(),
        tablesDir,
        tablesRoot: tablesRoot.toString(),
        tablesExportJson: exportJson,
      });
    }
    write(
      join(p, "capture/austin/receipts.jsonl"),
      [
        {
          url: "https://data.austintexas.gov/resource/3syk-w9eu.json?permit_number=A",
          captured_at: "2026-10-21T14:00:01.000Z",
          outcome: "ok",
        },
      ]
        .map((r) => JSON.stringify(r))
        .join("\n") + "\n",
    );
    write(
      join(p, "capture/tcad/receipt.json"),
      JSON.stringify({ captured_at: "2026-10-21T14:30:00.000Z", records: [{}] }),
    );
    const totalPiRows = piRowsPerBatch.reduce((a, c) => a + c, 0);
    const input: BuildManifestInput = {
      runId: RUN_ID,
      county: "travis",
      state: "TX",
      fips: "48453",
      startedAt: "2026-10-21T14:00:00.000Z",
      finishedAt: "2026-10-21T15:00:00.000Z",
      previousManifestCid: null,
      runDir: p,
      groups,
      sources: [
        {
          name: "austin-3syk-w9eu",
          url: "https://data.austintexas.gov/resource/3syk-w9eu.json",
          watermark: "2026-10-20T12:36:38.000Z",
          receipts: join(p, "capture/austin/receipts.jsonl"),
          limitations: [],
        },
        {
          name: "tcad-2026-certified-json",
          url: "https://traviscad.org/publicinformation",
          watermark: "entry@sha256:" + "d".repeat(64),
          receipts: join(p, "capture/tcad/receipt.json"),
          limitations: [],
        },
      ],
      profiles: [
        {
          name: "travis-austin",
          version: "1.0.0",
          sha256: SHA,
          path: "profiles/travis-austin@1.0.0/rules.json",
          gitCommit: "17c6cd8",
        },
      ],
      coverage: Object.fromEntries(
        requiredCoverageKeys(["property_improvement"]).map(([key, derivation]) => [
          key,
          { count: key === "permits_emitted" ? totalPiRows : 1, derivation },
        ]),
      ),
      ownersRedacted: 0,
      limitations: [],
      workTreeStatus: () => "",
    };
    return { input, runDir: p };
  }

  it("sums a group's table rows across every batch for the permits_emitted check, not just the last batch's", async () => {
    const { input } = await batchedFixture([2, 3]);
    const { manifest } = await buildManifest(input);
    expect(manifest.coverage.permits_emitted).toEqual({ count: 5, derivation: "published_rows" });
  });

  it("keeps every batch's car/directory/table artifacts, never overwriting an earlier batch's", async () => {
    const { input } = await batchedFixture([2, 3, 4]);
    const { manifest } = await buildManifest(input);
    const carNames = manifest.artifacts
      .filter((a) => a.kind === "car")
      .map((a) => a.name)
      .sort();
    expect(carNames).toEqual([
      "car/travis-property_improvement-b1.car",
      "car/travis-property_improvement-b2.car",
      "car/travis-property_improvement-b3.car",
    ]);
    expect(manifest.artifacts.filter((a) => a.kind === "directory")).toHaveLength(3);
    expect(manifest.artifacts.filter((a) => a.kind === "table")).toHaveLength(3);
  });

  it("fails permits_emitted when the declared count does not match the batches' summed rows", async () => {
    const { input } = await batchedFixture([2, 3]);
    await expect(
      buildManifest({
        ...input,
        coverage: {
          ...input.coverage,
          permits_emitted: { count: 999, derivation: "published_rows" },
        },
      }),
    ).rejects.toThrow(/permits_emitted/);
  });

  it("requiredCoverageKeys dedupes repeated groups so an N-batch group's keys are listed once", () => {
    const keys = requiredCoverageKeys([
      "property_improvement",
      "property_improvement",
      "property_improvement",
    ]);
    expect(keys).toEqual(GROUP_COVERAGE_KEYS.property_improvement);
  });
});

// S6a.2: the glue from a batched group's on-disk layout (`batch-hash-validate-export.sh`'s
// `cars/<prefix>-bNN.car` + `tables/bNN/` + `tables/bNN-export.json`) to the `ManifestGroupInput[]`
// buildManifest expects, reading each batch's own printed root/countyRoot verbatim.
describe("manifestGroupInputsFromBatches (S6a.2)", () => {
  it("builds one ManifestGroupInput per batch from export-tables JSON's own root/countyRoot", async () => {
    const p = mkdtempSync(join(tmpdir(), "run-glue-"));
    const roots: { countyRoot: string; tablesRoot: string }[] = [];
    for (const n of [1, 2]) {
      const b = String(n).padStart(2, "0");
      const carPath = join(p, "cars", `travis-county-b${b}.car`);
      const countyRoot = await writeCar(carPath, { label: "CountyIndex", batch: n });
      const tablesDir = join(p, "tables", `b${b}`);
      const tablesRoot = await writeCar(join(tablesDir, "tables.car"), {
        label: "CountyTables",
        version: 1,
        county_root: countyRoot,
        part_size_bytes: PART_SIZE_BYTES,
        codec: "zstd",
        tables: {},
      });
      write(
        join(p, "tables", `b${b}-export.json`),
        JSON.stringify({
          output: tablesDir,
          car: join(tablesDir, "tables.car"),
          root: tablesRoot.toString(),
          countyRoot: countyRoot.toString(),
          partSizeBytes: PART_SIZE_BYTES,
          codec: "zstd",
          tables: {},
          parts: 0,
          exportedAt: "2026-10-21T15:00:00.000Z",
        }),
      );
      roots.push({ countyRoot: countyRoot.toString(), tablesRoot: tablesRoot.toString() });
    }
    const inputs = manifestGroupInputsFromBatches({
      group: "county",
      dir: p,
      carPrefix: "travis-county",
      batches: [1, 2],
    });
    expect(inputs).toEqual([
      {
        group: "county",
        carPath: join(p, "cars", "travis-county-b01.car"),
        carRoot: at(roots, 0).countyRoot,
        tablesDir: join(p, "tables", "b01"),
        tablesRoot: at(roots, 0).tablesRoot,
        tablesExportJson: join(p, "tables", "b01-export.json"),
      },
      {
        group: "county",
        carPath: join(p, "cars", "travis-county-b02.car"),
        carRoot: at(roots, 1).countyRoot,
        tablesDir: join(p, "tables", "b02"),
        tablesRoot: at(roots, 1).tablesRoot,
        tablesExportJson: join(p, "tables", "b02-export.json"),
      },
    ]);
  });
});

describe("the run index (RunsIndexV1, JCS)", () => {
  const first = {
    runId: RUN_ID,
    manifestCid: "bafkrei" + "a".repeat(52),
    finishedAt: "2026-10-21T15:00:00.000Z",
  };
  const second = {
    runId: "travis-202610-reroof-20261121t1000z",
    manifestCid: "bafkrei" + "b".repeat(52),
    finishedAt: "2026-11-21T10:00:00.000Z",
  };

  it("orders runs by finishedAt whatever the insertion order", () => {
    const index = addRun(addRun(emptyRunsIndex(), second), first);
    expect(RunsIndexV1.parse(index)).toEqual(index);
    expect(index.runs.map((r) => r.runId)).toEqual([first.runId, second.runId]);
  });

  it("rejects a duplicate runId or manifestCid and a pilot runId", () => {
    const index = addRun(emptyRunsIndex(), first);
    expect(() => addRun(index, { ...first, manifestCid: second.manifestCid })).toThrow(/runId/);
    expect(() => addRun(index, { ...second, manifestCid: first.manifestCid })).toThrow(
      /manifestCid/,
    );
    expect(() => addRun(index, { ...second, runId: "travis-pilot-20261020" })).toThrow(/pilot/);
  });

  it("serializes as JCS bytes with no trailing newline and parses back", () => {
    const index = addRun(emptyRunsIndex(), first);
    const bytes = runsIndexBytes(index);
    expect(Buffer.from(bytes).equals(Buffer.from(jcsBytes(index)))).toBe(true);
    expect(bytes[bytes.length - 1]).not.toBe(0x0a);
    expect(Buffer.from(bytes).toString("utf8")).toBe(
      `{"runs":[{"finishedAt":"${first.finishedAt}","manifestCid":"${first.manifestCid}","runId":"${first.runId}"}],"schema":"oracle-travis-runs-index.v1"}`,
    );
    expect(parseRunsIndex(bytes)).toEqual(index);
    expect(() =>
      parseRunsIndex(
        `{"schema":"oracle-travis-runs-index.v1","runs":[{"runId":"travis-pilot-1","manifestCid":"${first.manifestCid}","finishedAt":"${first.finishedAt}"}]}`,
      ),
    ).toThrow(/pilot/);
  });

  it("verifies committed runs: manifest.json is exact JCS bytes whose CID is in index.json", async () => {
    const { input } = await fixture();
    const built = await buildManifest(input);
    const runsDir = mkdtempSync(join(tmpdir(), "runs-"));
    write(join(runsDir, RUN_ID, "manifest.json"), built.bytes);
    const index = addRun(emptyRunsIndex(), {
      runId: RUN_ID,
      manifestCid: built.cid,
      finishedAt: built.manifest.finishedAt,
    });
    write(join(runsDir, "index.json"), runsIndexBytes(index));
    const ok = await verifyCommittedRuns(runsDir);
    expect(ok.ok).toBe(true);
    expect(ok.checks).toEqual([{ runId: RUN_ID, manifestCid: built.cid, ok: true }]);

    // A trailing newline changes the bytes and therefore the CID: refused.
    write(join(runsDir, RUN_ID, "manifest.json"), Buffer.concat([built.bytes, Buffer.from("\n")]));
    const bad = await verifyCommittedRuns(runsDir);
    expect(bad.ok).toBe(false);
    expect(at(bad.checks, 0).reason).toMatch(/JCS|CID/);

    // A pretty-printed manifest is the same JSON but not the committed bytes: refused.
    write(join(runsDir, RUN_ID, "manifest.json"), JSON.stringify(built.manifest, null, 2));
    expect((await verifyCommittedRuns(runsDir)).ok).toBe(false);
  });

  const committed = join(REPO_ROOT, "runs");
  it.skipIf(!existsSync(join(committed, "index.json")))(
    "every committed runs/<runId>/manifest.json recomputes to the CID in runs/index.json",
    async () => {
      const result = await verifyCommittedRuns(committed);
      expect(result.checks.length).toBeGreaterThan(0);
      expect(result.ok, JSON.stringify(result.checks, null, 2)).toBe(true);
    },
  );
});

describe("pipeline/publish stays free of the Query DB (A2, P0-2)", () => {
  it("package.json and src mention no pg, postgres, query-db package or database URL", () => {
    const pkgDir = fileURLToPath(new URL("..", import.meta.url));
    const banned = ["pg", "postgres", "@elephant-xyz/query-db", "DATABASE_URL"];
    const pkg = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    for (const b of banned) expect(deps, `dependency ${b}`).not.toContain(b);
    const files = readdirSync(join(pkgDir, "src")).filter((f) => f.endsWith(".ts"));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const src = readFileSync(join(pkgDir, "src", f), "utf8");
      expect(src, f).not.toMatch(/from\s+["'](pg|postgres|@elephant-xyz\/query-db)["']/);
      expect(src, f).not.toMatch(/\bDATABASE_URL\b/);
      expect(src, f).not.toMatch(/\bpostgres\b/i);
    }
  });
});

// T083 (FR-001, TC-003): the two fixed limitation notes of plan § "Fixed texts and config
// keys", copied verbatim. The Austin source explains why every permit is
// `contractor_unresolved` (addendum A5); the TCAD source states how many owner records were
// redacted before `validate` (P0-15), the number being the run summary's `owners_redacted`.
describe("manifest limitation notes (T083, FR-001, P0-15)", () => {
  const COMPTROLLER = "Comptroller baseline not loaded (A-07)";
  const CONFIDENTIAL = /^Confidential owner records redacted \(Texas Tax Code §25\.025\): \d+$/;

  it("sources[0].limitations contains exactly `Comptroller baseline not loaded (A-07)`, after the input's own notes", async () => {
    const { input } = await fixture();
    at(input.sources, 0).limitations = ["one month of issue dates (2026-09); one GET per permit"];
    const { manifest } = await buildManifest(input);
    const notes = at(manifest.sources, 0).limitations;
    expect(notes).toContain(COMPTROLLER);
    expect(notes.filter((n) => n === COMPTROLLER)).toHaveLength(1);
    expect(notes).toEqual(["one month of issue dates (2026-09); one GET per permit", COMPTROLLER]);
    // the note belongs to the Austin source only
    expect(at(manifest.sources, 1).limitations).not.toContain(COMPTROLLER);
  });

  it("does not duplicate the Comptroller note when the input already carries it", async () => {
    const { input } = await fixture();
    at(input.sources, 0).limitations = [COMPTROLLER];
    const { manifest } = await buildManifest(input);
    expect(at(manifest.sources, 0).limitations).toEqual([COMPTROLLER]);
  });

  it("sources[1].limitations carries the §25.025 note with n = the summary's owners_redacted", async () => {
    for (const n of [0, 3]) {
      const { input } = await fixture();
      at(input.sources, 1).limitations = ["subset: only the parcels the emitted permits point to"];
      const { manifest } = await buildManifest({ ...input, ownersRedacted: n });
      const notes = at(manifest.sources, 1).limitations;
      expect(notes.filter((x) => CONFIDENTIAL.test(x))).toEqual([
        `Confidential owner records redacted (Texas Tax Code §25.025): ${n}`,
      ]);
      expect(notes[0]).toBe("subset: only the parcels the emitted permits point to");
      // the note belongs to the TCAD source only
      expect(at(manifest.sources, 0).limitations.some((x) => CONFIDENTIAL.test(x))).toBe(false);
      // and it survives the JCS bytes TC-003 and verify-manifest read
      const text = Buffer.from(jcsBytes(manifest)).toString("utf8");
      expect(text).toContain(`Confidential owner records redacted (Texas Tax Code §25.025): ${n}`);
    }
  });

  it("fails closed on a missing, negative or fractional owners_redacted (P0-15)", async () => {
    const { input } = await fixture();
    await expect(buildManifest({ ...input, ownersRedacted: -1 })).rejects.toThrow(
      /owners_redacted|ownersRedacted/,
    );
    await expect(buildManifest({ ...input, ownersRedacted: 1.5 })).rejects.toThrow(
      /owners_redacted|ownersRedacted/,
    );
    const without: Partial<BuildManifestInput> = { ...input };
    delete without.ownersRedacted;
    await expect(buildManifest(without as BuildManifestInput)).rejects.toThrow(
      /owners_redacted|ownersRedacted/,
    );
  });
});

// T083 (FR-001; ARD § 11; research R-08): the run index is append-only in the pipeline. A run
// is withdrawn only by a git revert of the index commit decided by the PO, never by a write.
describe("appendRun: the run index is append-only (T083, FR-001, ARD § 11)", () => {
  const first = {
    runId: RUN_ID,
    manifestCid: "bafkrei" + "a".repeat(52),
    finishedAt: "2026-10-21T15:00:00.000Z",
  };
  const second = {
    runId: "travis-202610-reroof-20261121t1000z",
    manifestCid: "bafkrei" + "b".repeat(52),
    finishedAt: "2026-11-21T10:00:00.000Z",
  };
  const third = {
    runId: "travis-202611-reroof-20261221t1000z",
    manifestCid: "bafkrei" + "c".repeat(52),
    finishedAt: "2026-12-21T10:00:00.000Z",
  };
  const INDEX_TAIL = `],"schema":"oracle-travis-runs-index.v1"}`;

  it("adds exactly one entry; every existing entry stays byte-identical and in finishedAt order", () => {
    const index = appendRun(appendRun(emptyRunsIndex(), first), second);
    const before = index.runs.map((r) => Buffer.from(jcsBytes(r)));
    const next = appendRun(index, third);
    expect(RunsIndexV1.parse(next)).toEqual(next);
    expect(next.runs).toHaveLength(index.runs.length + 1);
    expect(next.runs.slice(0, index.runs.length).map((r) => Buffer.from(jcsBytes(r)))).toEqual(
      before,
    );
    expect(next.runs.map((r) => r.runId)).toEqual([first.runId, second.runId, third.runId]);
    // the committed bytes grow only at the end: the old index minus its tail is a prefix
    const oldText = Buffer.from(runsIndexBytes(index)).toString("utf8");
    const newText = Buffer.from(runsIndexBytes(next)).toString("utf8");
    expect(oldText.endsWith(INDEX_TAIL)).toBe(true);
    expect(newText.startsWith(`${oldText.slice(0, -INDEX_TAIL.length)},`)).toBe(true);
    // the input index is not mutated
    expect(index.runs).toHaveLength(2);
    expect(index.runs.map((r) => Buffer.from(jcsBytes(r)))).toEqual(before);
  });

  it("keeps the finishedAt order when the appended run finished earlier, altering no entry", () => {
    const index = appendRun(emptyRunsIndex(), second);
    const next = appendRun(index, first);
    expect(next.runs.map((r) => r.runId)).toEqual([first.runId, second.runId]);
    expect(Buffer.from(jcsBytes(at(next.runs, 1)))).toEqual(Buffer.from(jcsBytes(second)));
    expect(Buffer.from(jcsBytes(at(next.runs, 0)))).toEqual(Buffer.from(jcsBytes(first)));
  });

  it("rejects a duplicate runId, even with the same manifestCid", () => {
    const index = appendRun(emptyRunsIndex(), first);
    expect(() => appendRun(index, { ...first })).toThrow(/runId/);
    expect(() => appendRun(index, { ...first, finishedAt: second.finishedAt })).toThrow(/runId/);
    expect(index.runs).toEqual([first]);
  });

  it("rejects an entry whose manifestCid differs from the committed one, and a reused manifestCid", () => {
    const index = appendRun(emptyRunsIndex(), first);
    // the same runId with another manifestCid: the committed CID is never altered
    expect(() => appendRun(index, { ...first, manifestCid: second.manifestCid })).toThrow(
      /manifestCid/,
    );
    // another runId claiming a manifestCid that is already committed
    expect(() => appendRun(index, { ...second, manifestCid: first.manifestCid })).toThrow(
      /manifestCid/,
    );
    expect(() => appendRun(index, { ...second, runId: "travis-pilot-20261020" })).toThrow(/pilot/);
    expect(index.runs).toEqual([first]);
  });

  it("exposes no remove, withdraw or delete operation (a withdrawal is a git revert, ARD § 11)", () => {
    const names = Object.keys(runsIndexModule);
    expect(names).toContain("appendRun");
    expect(names.filter((k) => /remove|withdraw|delete|drop|prune/i.test(k))).toEqual([]);
  });
});

// T018/T019 (US2, G-RUN wave 2): source() takes explicit added/changed/removed from the caller
// (delta.ts's computeSourceDelta, via sourceInputFromDelta) instead of always hardcoding "first
// run: everything added". Omitted keeps A-03's walking-skeleton default unchanged.
describe("ManifestSourceInput.delta: explicit added/changed/removed (T018)", () => {
  it("defaults to added = records, changed = 0, removed = 0 when delta is omitted (Run 1, unchanged)", async () => {
    const { input } = await fixture();
    const { manifest } = await buildManifest(input);
    expect(manifest.sources[0]).toMatchObject({ records: 3, added: 3, changed: 0, removed: 0 });
  });

  it("uses the supplied delta verbatim, never recomputing it from records", async () => {
    const { input } = await fixture();
    const withDelta = {
      ...input,
      sources: [
        { ...at(input.sources, 0), delta: { added: 1, changed: 2, removed: 5 } },
        at(input.sources, 1),
      ],
    };
    const { manifest } = await buildManifest(withDelta);
    expect(manifest.sources[0]).toMatchObject({ records: 3, added: 1, changed: 2, removed: 5 });
  });

  it("sourceInputFromDelta carries the delta's watermark and appends its limitations after the caller's own notes", () => {
    const result = {
      name: "austin_permits" as const,
      watermark: "2026-10-19T12:43:00.000Z",
      records: 0,
      delta: { added: 0, changed: 0, removed: 0 },
      limitations: [NO_NEWER_EXPORT],
      restamp: { detected: false, reasons: [], windowShare: 0, concentratedShare: 0 },
    };
    const input = sourceInputFromDelta(result, {
      name: "austin-3syk-w9eu",
      url: "https://data.austintexas.gov/resource/3syk-w9eu.json",
      receipts: "/tmp/receipts.jsonl",
      limitations: ["caller note"],
    });
    expect(input).toMatchObject({
      name: "austin-3syk-w9eu",
      watermark: "2026-10-19T12:43:00.000Z",
      limitations: ["caller note", NO_NEWER_EXPORT],
      delta: { added: 0, changed: 0, removed: 0 },
    });
  });

  it("a zero delta with a restamp carries both RESTAMP_LIMITATION and NO_NEWER_EXPORT through to the manifest", async () => {
    const { input } = await fixture();
    const result = {
      name: "austin_permits" as const,
      watermark: "2026-10-19T12:43:00.000Z",
      records: 3,
      delta: { added: 0, changed: 0, removed: 0 },
      limitations: [RESTAMP_LIMITATION, NO_NEWER_EXPORT],
      restamp: { detected: true, reasons: ["window_share"], windowShare: 1, concentratedShare: 1 },
    };
    const patched = sourceInputFromDelta(result, {
      name: "austin-3syk-w9eu",
      url: at(input.sources, 0).url,
      receipts: at(input.sources, 0).receipts,
    });
    const { manifest } = await buildManifest({
      ...input,
      sources: [patched, at(input.sources, 1)],
    });
    expect(manifest.sources[0]?.limitations).toEqual(
      expect.arrayContaining([RESTAMP_LIMITATION, NO_NEWER_EXPORT]),
    );
    expect(manifest.sources[0]).toMatchObject({ added: 0, changed: 0, removed: 0 });
  });
});

// T019 (US2, AD-03): a run with no change for a group omits that group's artifact entries
// entirely — never repeats the previous run's entries. The manifest builder already iterates
// only `input.groups`, so the caller simply not including an unchanged group is sufficient; this
// test pins that behaviour so it is never accidentally "fixed" into re-pointing.
describe("unchanged groups are omitted from this run's manifest (T019, AD-03)", () => {
  it("a run of only `property_improvement` (Austin changed) carries no county artifacts or coverage keys (TCAD unchanged)", async () => {
    const { input } = await fixture({ groups: ["property_improvement"] });
    const { manifest } = await buildManifest(input);
    const groupsPresent = new Set(
      manifest.artifacts
        .filter((a) => a.kind === "car")
        .map((a) => a.name.replace(/^car\/travis-/, "").replace(/\.car$/, "")),
    );
    expect(groupsPresent).toEqual(new Set(["property_improvement"]));
    expect(Object.keys(manifest.coverage).sort()).toEqual(
      GROUP_COVERAGE_KEYS.property_improvement.map(([k]) => k).sort(),
    );
  });

  it("the omitted group's previously published artifacts are found only by following previousManifestCid, never repeated here", async () => {
    const { input: input1 } = await fixture({ groups: ["county", "property_improvement"] });
    const built1 = await buildManifest(input1);
    const { input: input2 } = await fixture({ groups: ["property_improvement"] });
    const built2 = await buildManifest({
      ...input2,
      runId: "travis-202610-reroof-20261121t1000z",
      previousManifestCid: built1.cid,
    });
    expect(built2.manifest.previousManifestCid).toBe(built1.cid);
    expect(built2.manifest.artifacts.some((a) => a.name.includes("county"))).toBe(false);
  });
});

// T021 (US2, AC-10/research.md): "same inputs -> same CIDs" means the data-group CAR/table CIDs
// (pure functions of the bytes on disk), never the manifest CID itself, which legitimately
// differs run to run because the manifest records startedAt/finishedAt.
describe("idempotency (T021, AC-10)", () => {
  it("a re-run at a different time reproduces identical group CAR/directory/table CIDs, though the manifest CID differs", async () => {
    const { input } = await fixture({ groups: ["county", "property_improvement"] });
    const a = await buildManifest(input);
    const b = await buildManifest({
      ...input,
      startedAt: "2026-10-22T14:00:00.000Z",
      finishedAt: "2026-10-22T15:00:00.000Z",
    });
    const byKind = (m: RunManifestV1, kind: "car" | "directory" | "table") =>
      m.artifacts
        .filter((x) => x.kind === kind)
        .map((x) => [x.name, x.cid] as const)
        .sort();
    expect(byKind(b.manifest, "car")).toEqual(byKind(a.manifest, "car"));
    expect(byKind(b.manifest, "directory")).toEqual(byKind(a.manifest, "directory"));
    expect(byKind(b.manifest, "table")).toEqual(byKind(a.manifest, "table"));
    // the manifest's own CID legitimately differs: startedAt/finishedAt are part of its bytes
    expect(b.cid).not.toBe(a.cid);
  });

  it("identical inputs, including identical timestamps, reproduce the identical manifest CID too", async () => {
    const { input } = await fixture();
    const a = await buildManifest(input);
    const b = await buildManifest(input);
    expect(b.cid).toBe(a.cid);
  });
});

// T030 (FR-008, closes analyze finding F1): building a later run's manifest must never alter an
// earlier run's already-written manifest file or its artifact CIDs.
describe("FR-008: a later run's manifest never alters an earlier run's written manifest (T030)", () => {
  it("Run 1's written manifest.json bytes and CID are untouched after Run 2's manifest is built", async () => {
    const { input: input1 } = await fixture();
    const built1 = await buildManifest(input1);
    const runsDir = mkdtempSync(join(tmpdir(), "runs-"));
    const manifestPath1 = join(runsDir, input1.runId, "manifest.json");
    write(manifestPath1, built1.bytes);
    const before = readFileSync(manifestPath1);
    const beforeCid = await cidOfBytes(before);
    expect(beforeCid).toBe(built1.cid);

    const { input: input2 } = await fixture();
    const built2 = await buildManifest({
      ...input2,
      runId: "travis-202610-reroof-20261121t1000z",
      previousManifestCid: built1.cid,
      startedAt: "2026-11-21T09:00:00.000Z",
      finishedAt: "2026-11-21T10:00:00.000Z",
    });
    expect(built2.manifest.previousManifestCid).toBe(built1.cid);

    const after = readFileSync(manifestPath1);
    expect(Buffer.from(after).equals(Buffer.from(before))).toBe(true);
    expect(await cidOfBytes(after)).toBe(beforeCid);
  });
});
