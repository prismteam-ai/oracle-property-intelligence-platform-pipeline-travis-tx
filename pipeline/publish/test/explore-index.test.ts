// A-16 T010 (AC-13, A14-7): the per-run Explore index, on a small synthetic batched export (TEST
// FIXTURE: invented rows, never presented as real data) bound through the real query-core
// bindManifest. Proves: each index file's schema equals DESCRIBE of its bound view; EXCEPT ALL
// parity against a direct bind is 0; a SHA-256 mismatch and an unbound batch are hard stops; a
// rebuild and a second upload are no-ops; a different index is never overwritten; the header
// records the raw permit count next to v_roofing_permit's (A14-7) and whether owner area exists.
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { REQUIRED_TABLES, rawCid } from "@countylens/query-core";
import {
  EXPLORE_INDEX_PREFIX,
  EXPLORE_INDEX_SCHEMA,
  IndexDescriptor,
  assertBatchCoverage,
  batchCoverage,
  checkSourceParts,
  decideUpload,
  fetchBudget,
  indexKeys,
  planSourceParts,
  viewsSha256,
} from "../src/explore-index.js";
import {
  HardStop,
  buildExploreIndex,
  describe as describeRelation,
  loadManifest,
  materialiseParts,
  openDb,
  uploadExploreIndex,
  verifyExploreIndex,
  type IndexS3,
} from "../scripts/build-explore-index.js";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const PILOT = join(ROOT, "contract/v1/pilot-manifest.json");
const RUN = "fixture-run/tables";
const TCAD = JSON.stringify({
  method: "GET",
  url: "https://traviscad.org/wp-content/largefiles/2026%20Certified%20JSON%20SUPP%200%2007182026.zip",
});
const austin = (permit: string): string =>
  JSON.stringify({
    method: "GET",
    url: "https://data.austintexas.gov/resource/3syk-w9eu.json",
    multiValueQueryString: { permit_number: [permit] },
  });

type Value = string | number | null;
type FixtureRow = Record<string, Value>;

const P1 = "baguqeerafixtureprop1";
const P2 = "baguqeerafixtureprop2";
const ids = (cid: string, property = cid): FixtureRow => ({
  cid,
  property_cid: property,
  data_group_cid: "dg",
  request_identifier: cid.slice(-5),
});
const edge = (from: string, to: string, property: string): FixtureRow => ({
  relationship_cid: `${from}>${to}`,
  from_cid: from,
  to_cid: to,
  property_cid: property,
  data_group_cid: "dg",
});
const permit = (
  cid: string,
  number: string,
  type: string,
  action: string,
  status: string,
): FixtureRow => ({
  ...ids(cid, ""),
  permit_number: number,
  improvement_type: type,
  improvement_action: action,
  improvement_status: status,
  permit_issue_date: "2020-01-15",
  completion_date: null,
  permit_close_date: null,
  final_inspection_date: null,
  source_http_request: austin(number),
});

/** batch → table → rows (one part each). The group of a batch is resolved by bindManifest. */
const BATCHES: Record<string, Record<string, FixtureRow[]>> = {
  b01: {
    property: [
      {
        ...ids(P1),
        parcel_identifier: "0100000001",
        property_type: "SingleFamily",
        property_usage_type: "Residential",
        property_structure_built_year: 1985,
        source_http_request: TCAD,
      },
      {
        ...ids(P2),
        parcel_identifier: "0100000002",
        property_type: "SingleFamily",
        property_usage_type: "Residential",
        property_structure_built_year: 2001,
        source_http_request: TCAD,
      },
    ],
    geometry: [
      { ...ids("g1", P1), latitude: 30.27, longitude: -97.74, source_http_request: TCAD },
      { ...ids("g2", P2), latitude: 30.3, longitude: -97.7, source_http_request: TCAD },
    ],
    property_has_parcel: [edge(P1, "parcel1", P1), edge(P2, "parcel2", P2)],
    parcel_has_geometry: [edge("parcel1", "g1", P1), edge("parcel2", "g2", P2)],
  },
  b02: {
    property_improvement: [
      permit("pi1", "2015-000001 BP", "Roofing", "Replacement", "Final"),
      permit("pi2", "2016-000002 BP", "Roofing", "Replacement", "Final"), // no property edge (A14-7)
      permit("pi3", "2017-000003 BP", "Electrical", "New", "Final"),
    ],
    property_has_property_improvement: [edge(P1, "pi1", P1), edge(P2, "pi3", P2)],
  },
};

function columnsOf(table: string): [string, string][] {
  if (table.includes("_has_"))
    return ["relationship_cid", "from_cid", "to_cid", "property_cid", "data_group_cid"].map((c) => [
      c,
      "VARCHAR",
    ]);
  const req = REQUIRED_TABLES.find((r) => r.table === table);
  if (req === undefined) throw new Error(`no REQUIRED_TABLES entry for ${table}`);
  return Object.entries(req.columns);
}

const lit = (v: Value | undefined, type: string): string =>
  v === null || v === undefined
    ? `NULL::${type}`
    : typeof v === "number"
      ? `${v}::${type}`
      : `'${v.replace(/'/g, "''")}'::${type}`;

interface Fixture {
  readonly root: string;
  readonly manifestPath: string;
  readonly manifestCid: string;
}

/** Writes the batches' Parquet under <root>/fixture-run/tables and a manifest whose table
 *  artifacts are those parts (the committed pilot manifest otherwise). */
async function makeFixture(
  extra: Record<string, Record<string, FixtureRow[]>> = {},
): Promise<Fixture> {
  const root = mkdtempSync(join(tmpdir(), "explore-index-"));
  const db = await openDb({ threads: 1, memoryLimit: "1GB", tempDirectory: join(root, "spill") });
  const manifest = JSON.parse(readFileSync(PILOT, "utf8")) as {
    artifacts: Record<string, unknown>[];
  };
  const parts: Record<string, unknown>[] = [];
  try {
    for (const [batch, tables] of Object.entries({ ...BATCHES, ...extra })) {
      for (const [table, rows] of Object.entries(tables)) {
        const name = `${RUN}/${batch}/${table}/part-00000.parquet`;
        const file = join(root, name);
        mkdirSync(dirname(file), { recursive: true });
        const cols = columnsOf(table);
        const selects =
          rows.length === 0
            ? [`SELECT ${cols.map(([c, t]) => `NULL::${t} AS "${c}"`).join(", ")} WHERE false`]
            : rows.map(
                (r) => `SELECT ${cols.map(([c, t]) => `${lit(r[c], t)} AS "${c}"`).join(", ")}`,
              );
        await db.run(`COPY (${selects.join(" UNION ALL ")}) TO '${file}' (FORMAT parquet)`);
        const bytes = readFileSync(file);
        parts.push({
          cid: await rawCid(bytes),
          codec: "raw",
          kind: "table",
          name,
          sha256: createHash("sha256").update(bytes).digest("hex"),
          size: bytes.length,
        });
      }
    }
  } finally {
    db.close();
  }
  manifest.artifacts = [...manifest.artifacts.filter((a) => a.kind !== "table"), ...parts];
  const bytes = new TextEncoder().encode(JSON.stringify(manifest));
  const manifestPath = join(root, "manifest.json");
  writeFileSync(manifestPath, bytes);
  return { root, manifestPath, manifestCid: await rawCid(bytes) };
}

const options = (f: Fixture, workDir: string) => ({
  manifest: f.manifestPath,
  source: "local" as const,
  localRoot: f.root,
  workDir,
  threads: 1,
  memoryLimit: "1GB",
  gitSha: "test",
  now: () => new Date("2026-10-26T00:00:00Z"),
  log: () => undefined,
});

/** An in-memory S3 with If-None-Match semantics. */
function fakeS3(): IndexS3 & { objects: Map<string, Uint8Array>; puts: string[] } {
  const objects = new Map<string, Uint8Array>();
  const puts: string[] = [];
  return {
    objects,
    puts,
    async get(bucket, key) {
      return objects.get(`${bucket}/${key}`);
    },
    async putIfAbsent(bucket, key, body) {
      if (objects.has(`${bucket}/${key}`)) return { written: false };
      objects.set(`${bucket}/${key}`, body);
      puts.push(key);
      return { written: true };
    },
  };
}

let fixture: Fixture;
let work: string;
let built: Awaited<ReturnType<typeof buildExploreIndex>>;

beforeAll(async () => {
  fixture = await makeFixture();
  work = mkdtempSync(join(tmpdir(), "explore-index-work-"));
  built = await buildExploreIndex(options(fixture, work));
}, 120_000);

afterAll(() => {
  rmSync(fixture.root, { recursive: true, force: true });
  rmSync(work, { recursive: true, force: true });
});

describe("index key layout and descriptor (T003, frozen interface)", () => {
  it("keys live under private/explore-index/<manifestCid>/ with index.json and one file per view", () => {
    const keys = indexKeys(EXPLORE_INDEX_PREFIX, fixture.manifestCid);
    expect(keys.indexJson).toBe(`private/explore-index/v1.3/${fixture.manifestCid}/index.json`);
    expect(Object.values(keys.files)).toEqual(
      ["v_property", "v_roofing_permit", "v_contractor", "v_run"].map(
        (v) => `private/explore-index/v1.3/${fixture.manifestCid}/${v}.parquet`,
      ),
    );
    expect(() => indexKeys("ipfs/", fixture.manifestCid)).toThrow(/private/);
    expect(() => indexKeys(EXPLORE_INDEX_PREFIX, "../escape")).toThrow();
  });

  it("a views-version folder is allowed (private/explore-index/v1.2/), nothing deeper or other", () => {
    expect(indexKeys("private/explore-index/v1.2/", fixture.manifestCid).indexJson).toBe(
      `private/explore-index/v1.2/${fixture.manifestCid}/index.json`,
    );
    for (const bad of [
      "private/explore-index/v1.2/x/",
      "private/explore-index/1.2/",
      "private/explore-index/v1.2",
      "private/a/b/",
    ])
      expect(() => indexKeys(bad, fixture.manifestCid), bad).toThrow(/private/);
  });

  it("the written index.json parses as the strict IndexDescriptor and binds the manifest CID, view SQL and source parts", () => {
    const json = JSON.parse(readFileSync(join(built.dir, "index.json"), "utf8"));
    const d = IndexDescriptor.parse(json);
    expect(d.schema).toBe(EXPLORE_INDEX_SCHEMA);
    expect(d.manifestCid).toBe(fixture.manifestCid);
    expect(d.viewsSha256).toBe(viewsSha256());
    const manifest = JSON.parse(readFileSync(fixture.manifestPath, "utf8"));
    expect(checkSourceParts(d.sourceParts, manifest)).toEqual([]);
    expect(d.sourceParts.map((p) => p.name).sort()).toEqual(
      planSourceParts(manifest)
        .map((p) => p.name)
        .sort(),
    );
    for (const [view, file] of Object.entries(d.files)) {
      const bytes = readFileSync(join(built.dir, `${view}.parquet`));
      expect(file.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
      expect(file.bytes).toBe(bytes.length);
    }
    expect(IndexDescriptor.safeParse({ ...json, extra: 1 }).success).toBe(false);
  });

  it("A14-7: the header records raw permits next to v_roofing_permit (a roofing permit with no property row is counted)", () => {
    expect(built.descriptor.permitCounts).toEqual({
      rawPermitRows: 3,
      rawPermitCids: 3,
      rawRoofingReplacementCids: 2,
      linkedPermitRows: 2,
      roofingPermitRows: 1,
      roofingWithoutPropertyRow: 1,
    });
    expect(built.descriptor.files.v_roofing_permit.rows).toBe(1);
  });

  it("records that owner area is not published when every owner_area_class is unknown", () => {
    expect(built.descriptor.ownerArea).toEqual({ knownRows: 0, published: false });
  });

  it("checkSourceParts names a part whose sha256 differs from the manifest and a planned part left out", () => {
    const manifest = JSON.parse(readFileSync(fixture.manifestPath, "utf8"));
    const [first, ...rest] = built.descriptor.sourceParts;
    if (first === undefined) throw new Error("no source parts");
    const problems = checkSourceParts([{ ...first, sha256: "0".repeat(64) }], manifest);
    expect(problems[0]).toMatch(/cid\/sha256 differ/);
    expect(problems.some((p) => p.includes("planned but not used"))).toBe(true);
    expect(rest.length).toBeGreaterThan(0);
  });

  it("the cost gate refuses a plan above the ceiling", () => {
    expect(fetchBudget([{ name: "a", cid: "x", sha256: "y", size: 3e9 }], 2).ok).toBe(false);
    expect(fetchBudget([{ name: "a", cid: "x", sha256: "y", size: 1e6 }], 2).ok).toBe(true);
  });
});

describe("build: frozen schema and parity (T010)", { timeout: 60_000 }, () => {
  it("each index file's DESCRIBE equals DESCRIBE of the bound view", async () => {
    const db = await openDb({ threads: 1, memoryLimit: "1GB", tempDirectory: join(work, "spill") });
    try {
      const { bindParts } = await import("../scripts/build-explore-index.js");
      const { bytes, manifest } = await loadManifest({ manifest: fixture.manifestPath });
      const { paths } = await materialiseParts(planSourceParts(manifest), {
        source: "local",
        localRoot: fixture.root,
        workDir: work,
      });
      await bindParts(db, bytes, paths);
      for (const v of ["v_property", "v_roofing_permit", "v_contractor", "v_run"]) {
        const view = await describeRelation(db, v);
        const file = await describeRelation(
          db,
          `read_parquet('${join(built.dir, `${v}.parquet`)}')`,
        );
        expect(file).toEqual(view);
      }
      expect((await describeRelation(db, "v_property")).length).toBe(34); // contract v1.2
    } finally {
      db.close();
    }
  });

  it("--verify: EXCEPT ALL against a direct bind is 0 for every view, with equal row counts", async () => {
    const parity = await verifyExploreIndex(options(fixture, work), built.dir);
    expect(parity.map((p) => p.view)).toEqual([
      "v_property",
      "v_roofing_permit",
      "v_contractor",
      "v_run",
    ]);
    for (const p of parity) {
      expect(p.diffRows).toBe(0);
      expect(p.indexRows).toBe(p.boundRows);
    }
    expect(parity.find((p) => p.view === "v_property")?.indexRows).toBe(2);
  });

  it("an existing built index is reused (no rebuild, same descriptor)", async () => {
    const again = await buildExploreIndex(options(fixture, work));
    expect(again.reused).toBe(true);
    expect(again.descriptor).toEqual(built.descriptor);
  });

  it("the descriptor keys follow --prefix, and an index built for another prefix is not reused", async () => {
    await expect(
      buildExploreIndex({ ...options(fixture, work), prefix: "private/explore-index/" }),
    ).rejects.toThrow(/rerun with --rebuild/);
    const w = mkdtempSync(join(tmpdir(), "explore-index-prefix-"));
    try {
      const v12 = await buildExploreIndex({
        ...options(fixture, w),
        prefix: "private/explore-index/",
      });
      expect(v12.descriptor.files.v_property.key).toBe(
        `private/explore-index/${fixture.manifestCid}/v_property.parquet`,
      );
    } finally {
      rmSync(w, { recursive: true, force: true });
    }
  }, 60_000);
});

describe("hard stops (no partial index)", () => {
  it("a part whose bytes do not match the manifest sha256 stops the build and writes no index", async () => {
    const f = await makeFixture();
    const w = mkdtempSync(join(tmpdir(), "explore-index-bad-"));
    try {
      const file = join(f.root, `${RUN}/b01/property/part-00000.parquet`);
      writeFileSync(file, Buffer.concat([readFileSync(file), Buffer.from("x")]));
      await expect(buildExploreIndex(options(f, w))).rejects.toThrow(HardStop);
      await expect(buildExploreIndex(options(f, w))).rejects.toThrow(/do not match the manifest/);
      expect(() => readFileSync(join(w, "index", f.manifestCid, "index.json"))).toThrow();
    } finally {
      rmSync(f.root, { recursive: true, force: true });
      rmSync(w, { recursive: true, force: true });
    }
  }, 60_000);

  it("an export batch none of whose parts can be bound stops the build (batch coverage)", async () => {
    // b03 holds only `company`, a name both groups use: its group cannot be resolved, so
    // bindManifest skips it; the index must not silently validate as a smaller county.
    const f = await makeFixture({ b03: { company: [{ ...ids("co1", ""), name: "ACME" }] } });
    const w = mkdtempSync(join(tmpdir(), "explore-index-unbound-"));
    try {
      await expect(buildExploreIndex(options(f, w))).rejects.toThrow(
        /unbound batch fixture-run\/tables\/b03/,
      );
      expect(() => readFileSync(join(w, "index", f.manifestCid, "index.json"))).toThrow();
    } finally {
      rmSync(f.root, { recursive: true, force: true });
      rmSync(w, { recursive: true, force: true });
    }
  }, 60_000);

  it("a county batch with no county.property rows is a hard stop", () => {
    const coverage = batchCoverage({
      tableArtifactNames: [
        "r/tables/b01/property/part-00000.parquet",
        "r/tables/b04/property/part-00000.parquet",
      ],
      boundTables: [
        {
          group: "county",
          table: "property",
          emitted: true,
          parts: [
            "r/tables/b01/property/part-00000.parquet",
            "r/tables/b04/property/part-00000.parquet",
          ],
        },
      ],
      countyPropertyRowsByPart: new Map([["r/tables/b01/property/part-00000.parquet", 5]]),
    });
    expect(coverage.emptyCountyBatches).toEqual(["r/tables/b04"]);
    expect(() => assertBatchCoverage(coverage)).toThrow(/no county.property rows/);
  });

  it("--manifest with --expect-cid that differs is refused before anything is fetched", async () => {
    await expect(
      loadManifest({
        manifest: fixture.manifestPath,
        expectCid: "bafkreiaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      }),
    ).rejects.toThrow(/--expect-cid/);
  });
});

describe("CID-copy fetch (cidcopy source)", () => {
  const part = async () => {
    const bytes = new TextEncoder().encode("PAR1 test part");
    return {
      bytes,
      part: {
        name: "r/tables/b01/property/part-00000.parquet",
        cid: await rawCid(bytes),
        sha256: createHash("sha256").update(bytes).digest("hex"),
        size: bytes.length,
      },
    };
  };

  it("retries a 503 with backoff, then accepts bytes whose sha256 matches; a re-run reads the cache", async () => {
    const { bytes, part: p } = await part();
    const w = mkdtempSync(join(tmpdir(), "explore-index-fetch-"));
    const calls: string[] = [];
    const sleeps: number[] = [];
    const fetchFake = (async (url: string) => {
      calls.push(url);
      return calls.length === 1 ? new Response("busy", { status: 503 }) : new Response(bytes);
    }) as unknown as typeof fetch;
    try {
      const deps = { fetch: fetchFake, sleep: async (ms: number) => void sleeps.push(ms) };
      const first = await materialiseParts(
        [p],
        { source: "cidcopy", workDir: w, copyHost: "copy.example" },
        deps,
      );
      expect(first.fetchedBytes).toBe(bytes.length);
      expect(calls).toEqual([`https://copy.example/${p.cid}`, `https://copy.example/${p.cid}`]);
      expect(sleeps).toEqual([1000]);
      const second = await materialiseParts(
        [p],
        { source: "cidcopy", workDir: w, copyHost: "copy.example" },
        deps,
      );
      expect(second.fetchedBytes).toBe(0);
      expect(calls.length).toBe(2);
    } finally {
      rmSync(w, { recursive: true, force: true });
    }
  });

  it("a 403 is a hard stop naming the part; a public gateway host is refused", async () => {
    const { part: p } = await part();
    const w = mkdtempSync(join(tmpdir(), "explore-index-403-"));
    try {
      const deps = {
        fetch: (async () => new Response("no", { status: 403 })) as unknown as typeof fetch,
        sleep: async () => undefined,
      };
      await expect(
        materialiseParts([p], { source: "cidcopy", workDir: w, copyHost: "copy.example" }, deps),
      ).rejects.toThrow(/part-00000.parquet .*HTTP 403/);
      await expect(
        materialiseParts(
          [p],
          { source: "cidcopy", workDir: w, copyHost: "ipfs.filebase.io" },
          deps,
        ),
      ).rejects.toThrow(/never a public gateway/);
    } finally {
      rmSync(w, { recursive: true, force: true });
    }
  });

  it("bytes that do not hash to the manifest sha256 are never written", async () => {
    const { part: p } = await part();
    const w = mkdtempSync(join(tmpdir(), "explore-index-mismatch-"));
    try {
      const deps = {
        fetch: (async () => new Response("other bytes")) as unknown as typeof fetch,
        sleep: async () => undefined,
      };
      await expect(
        materialiseParts([p], { source: "cidcopy", workDir: w, copyHost: "copy.example" }, deps),
      ).rejects.toThrow(/do not match/);
      expect(() => readFileSync(join(w, "parts", `${p.cid}.parquet`))).toThrow();
    } finally {
      rmSync(w, { recursive: true, force: true });
    }
  });
});

describe("upload (If-None-Match, index.json last, idempotent)", () => {
  it("uploads the four files then index.json last; a second upload is a no-op", async () => {
    const s3 = fakeS3();
    expect(
      await uploadExploreIndex({
        descriptor: built.descriptor,
        dir: built.dir,
        bucket: "b",
        s3,
        log: () => undefined,
      }),
    ).toBe("uploaded");
    const root = `private/explore-index/v1.3/${fixture.manifestCid}/`;
    expect(s3.puts).toEqual([
      ...["v_property", "v_roofing_permit", "v_contractor", "v_run"].map(
        (v) => `${root}${v}.parquet`,
      ),
      `${root}index.json`,
    ]);
    expect(
      await uploadExploreIndex({
        descriptor: built.descriptor,
        dir: built.dir,
        bucket: "b",
        s3,
        log: () => undefined,
      }),
    ).toBe("noop");
    expect(s3.puts.length).toBe(5);
  });

  it("a different index under the same manifest CID is a conflict, never overwritten", async () => {
    const s3 = fakeS3();
    const other = { ...built.descriptor, viewsSha256: "f".repeat(64) };
    s3.objects.set(
      `b/private/explore-index/v1.3/${fixture.manifestCid}/index.json`,
      new TextEncoder().encode(JSON.stringify(other)),
    );
    expect(decideUpload(other, built.descriptor)).toBe("conflict");
    await expect(
      uploadExploreIndex({
        descriptor: built.descriptor,
        dir: built.dir,
        bucket: "b",
        s3,
        log: () => undefined,
      }),
    ).rejects.toThrow(/never overwritten/);
    expect(s3.puts).toEqual([]);
  });

  it("a Parquet key left by an earlier build with other bytes stops before index.json is written", async () => {
    const s3 = fakeS3();
    s3.objects.set(
      `b/private/explore-index/v1.3/${fixture.manifestCid}/v_property.parquet`,
      new Uint8Array([1, 2, 3]),
    );
    await expect(
      uploadExploreIndex({
        descriptor: built.descriptor,
        dir: built.dir,
        bucket: "b",
        s3,
        log: () => undefined,
      }),
    ).rejects.toThrow(/earlier build/);
    expect(s3.puts.some((k) => k.endsWith("index.json"))).toBe(false);
  });
});
