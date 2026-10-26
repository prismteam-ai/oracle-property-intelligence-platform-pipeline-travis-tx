// T030 (TC-044 at unit level, FR-012): the CID-copy writer against a fake S3. It takes only the
// manifest, re-reads every local file and fails before any S3 call when size, SHA-256 or CID
// differ; HeadObject first (same size + sha → skip, different → fail hard); PutObject with
// IfNoneMatch "*", ChecksumSHA256, metadata {cid, sha256}, Content-Type by kind and
// `Cache-Control: public, max-age=31536000, immutable`; HeadObject readback with ChecksumMode;
// keys only `ipfs/<cid>`, never `runs/index.json`; no Delete anywhere. Bucket from
// CID_COPY_BUCKET or SSM `/countylens/cid-copy/bucket`; region never a literal.
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import * as dagJson from "@ipld/dag-json";
import { CID } from "multiformats/cid";
import { sha256 } from "multiformats/hashes/sha2";
import { describe, expect, it, vi } from "vitest";
import { RunManifestV1, type ManifestArtifact } from "@countylens/contract";
import {
  CACHE_CONTROL,
  CID_COPY_BUCKET_PARAMETER,
  CID_COPY_PROFILE,
  CONTENT_TYPES,
  cidCopyKey,
  cidCopyS3,
  cidCopySsm,
  copyManifestObjects,
  resolveCidCopyBucket,
  type CidCopyS3,
  type CidCopySsm,
} from "../src/cid-copy.js";
import { cidOfBytes } from "../src/cid.js";
import { jcsBytes } from "../src/jcs.js";
import {
  HeadObjectCommand,
  PutObjectCommand,
  type HeadObjectCommandInput,
  type HeadObjectCommandOutput,
  type PutObjectCommandInput,
  type PutObjectCommandOutput,
  type S3Client,
} from "@aws-sdk/client-s3";
import { GetParameterCommand, type SSMClient } from "@aws-sdk/client-ssm";

const RUN_ID = "travis-202609-reroof-20261021t1530z";
const BUCKET = "countylensdata-cidcopy-fixture";
const SRC = fileURLToPath(new URL("../src/cid-copy.ts", import.meta.url));

const sha256Hex = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
const base64Of = (hex: string): string => Buffer.from(hex, "hex").toString("base64");

function bytesOf(seed: string, length: number): Uint8Array {
  const out = new Uint8Array(length);
  let block = createHash("sha256").update(seed).digest();
  let i = 0;
  while (i < length) {
    for (const b of block) {
      if (i >= length) break;
      out[i] = b;
      i += 1;
    }
    block = createHash("sha256").update(block).digest();
  }
  return out;
}

async function dagRoot(label: string): Promise<string> {
  const bytes = dagJson.encode({ label });
  return CID.create(1, dagJson.code, await sha256.digest(bytes)).toString();
}

function write(path: string, body: Uint8Array): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body);
}

interface Fixture {
  root: string;
  runDir: string;
  manifestPath: string;
  manifestBytes: Uint8Array;
  manifestCid: string;
  manifest: RunManifestV1;
  /** Local bytes by the key the copy must hold them under. */
  expected: Map<string, { bytes: Uint8Array; contentType: string; name: string }>;
}

async function fixture(): Promise<Fixture> {
  const root = mkdtempSync(join(tmpdir(), "cid-copy-"));
  const runDir = join(root, "pipeline", "data", "runs", RUN_ID);
  const expected: Fixture["expected"] = new Map();
  const artifacts: ManifestArtifact[] = [];
  for (const group of ["county", "property_improvement"] as const) {
    const car = bytesOf(`car ${group}`, 3000);
    const carName = `car/travis-${group}.car`;
    write(join(runDir, carName), car);
    const carCid = await cidOfBytes(car);
    artifacts.push({
      name: carName,
      cid: await dagRoot(`CountyIndex ${group}`),
      codec: "dag-json",
      size: car.length,
      sha256: sha256Hex(car),
      kind: "car",
      carCid,
    });
    expected.set(`ipfs/${carCid}`, { bytes: car, contentType: CONTENT_TYPES.car, name: carName });
    const tablesCar = bytesOf(`tables.car ${group}`, 1200);
    write(join(runDir, "tables", group, "tables.car"), tablesCar);
    const tablesCarCid = await cidOfBytes(tablesCar);
    artifacts.push({
      name: `tables/${group}`,
      cid: await dagRoot(`CountyTables ${group}`),
      codec: "dag-json",
      size: tablesCar.length,
      sha256: sha256Hex(tablesCar),
      kind: "directory",
      carCid: tablesCarCid,
    });
    expected.set(`ipfs/${tablesCarCid}`, {
      bytes: tablesCar,
      contentType: CONTENT_TYPES.directory,
      name: `tables/${group}`,
    });
    for (const table of ["property", group === "county" ? "structure" : "property_improvement"]) {
      const part = bytesOf(`part ${group} ${table}`, 800);
      const name = `tables/${group}/${table}/part-00000.parquet`;
      write(join(runDir, name), part);
      const cid = await cidOfBytes(part);
      artifacts.push({
        name,
        cid,
        codec: "raw",
        size: part.length,
        sha256: sha256Hex(part),
        kind: "table",
      });
      expected.set(`ipfs/${cid}`, { bytes: part, contentType: CONTENT_TYPES.table, name });
    }
  }
  const manifest = RunManifestV1.parse({
    schema: "oracle-travis-run-manifest.v1",
    runId: RUN_ID,
    county: "travis",
    state: "TX",
    fips: "48453",
    startedAt: "2026-10-21T15:00:00.000Z",
    finishedAt: "2026-10-21T15:30:00.000Z",
    previousManifestCid: null,
    sources: [
      {
        name: "austin-3syk-w9eu",
        url: "https://data.austintexas.gov/resource/3syk-w9eu.json",
        watermark: "2026-09",
        captured_at: "2026-10-21T15:05:00.000Z",
        records: 2,
        added: 2,
        changed: 0,
        removed: 0,
        limitations: ["Comptroller baseline not loaded (A-07)"],
      },
      {
        name: "tcad-2026-certified-json",
        url: "https://traviscad.org/publicinformation/certified-roll-2026",
        watermark: "2026",
        captured_at: "2026-10-21T15:10:00.000Z",
        records: 2,
        added: 2,
        changed: 0,
        removed: 0,
        limitations: ["Confidential owner records redacted (Texas Tax Code §25.025): 0"],
      },
    ],
    artifacts,
    profiles: [],
    coverage: {
      permits_emitted: { count: 2, derivation: "published_rows" },
      permits_no_tcad_geoid: { count: 0, derivation: "aggregate_match" },
    },
    limitations: [],
  });
  const manifestBytes = jcsBytes(manifest);
  const manifestCid = await cidOfBytes(manifestBytes);
  const manifestPath = join(root, "runs", RUN_ID, "manifest.json");
  write(manifestPath, manifestBytes);
  expected.set(`ipfs/${manifestCid}`, {
    bytes: manifestBytes,
    contentType: CONTENT_TYPES.manifest,
    name: "manifest.json",
  });
  return { root, runDir, manifestPath, manifestBytes, manifestCid, manifest, expected };
}

interface Stored {
  bytes: Uint8Array;
  contentType: string | undefined;
  cacheControl: string | undefined;
  metadata: Record<string, string> | undefined;
  /** Base64 SHA-256 of the bytes actually received (what S3 would return with ChecksumMode). */
  checksumSHA256: string;
}

interface Call {
  op: "head" | "put";
  input: HeadObjectCommandInput | PutObjectCommandInput;
}

interface FakeS3 extends CidCopyS3 {
  calls: Call[];
  store: Map<string, Stored>;
}

function s3Error(name: string, status: number): Error {
  return Object.assign(new Error(name), { name, $metadata: { httpStatusCode: status } });
}

async function collect(body: PutObjectCommandInput["Body"]): Promise<Uint8Array> {
  if (body === undefined) return new Uint8Array();
  if (typeof body === "string") return new TextEncoder().encode(body);
  if (body instanceof Uint8Array) return body;
  if (body instanceof Readable) {
    const chunks: Buffer[] = [];
    for await (const chunk of body) chunks.push(Buffer.from(chunk as Uint8Array));
    return Buffer.concat(chunks);
  }
  throw new Error(`fake S3: unsupported Body ${typeof body}`);
}

/** A fake bucket with the write guard of contracts/storage.md and no Delete at all. */
function fakeS3(
  initial: Map<string, Stored> = new Map(),
  opts: { readbackChecksum?: (key: string, real: string) => string } = {},
): FakeS3 {
  const store = new Map(initial);
  const calls: Call[] = [];
  const fake: FakeS3 = {
    calls,
    store,
    headObject: vi.fn(async (input: HeadObjectCommandInput): Promise<HeadObjectCommandOutput> => {
      calls.push({ op: "head", input });
      if (input.Bucket !== BUCKET) throw s3Error("NoSuchBucket", 404);
      const obj = store.get(input.Key ?? "");
      if (!obj) throw s3Error("NotFound", 404);
      const checksum = opts.readbackChecksum
        ? opts.readbackChecksum(input.Key ?? "", obj.checksumSHA256)
        : obj.checksumSHA256;
      return {
        $metadata: { httpStatusCode: 200 },
        ContentLength: obj.bytes.length,
        ...(obj.contentType === undefined ? {} : { ContentType: obj.contentType }),
        ...(obj.cacheControl === undefined ? {} : { CacheControl: obj.cacheControl }),
        ...(obj.metadata === undefined ? {} : { Metadata: obj.metadata }),
        ...(input.ChecksumMode === "ENABLED" ? { ChecksumSHA256: checksum } : {}),
      };
    }),
    putObject: vi.fn(async (input: PutObjectCommandInput): Promise<PutObjectCommandOutput> => {
      calls.push({ op: "put", input });
      if (input.Bucket !== BUCKET) throw s3Error("NoSuchBucket", 404);
      const key = input.Key ?? "";
      // Bucket policy: PutObject on ipfs/* without If-None-Match is denied outright.
      if (input.IfNoneMatch === undefined) throw s3Error("AccessDenied", 403);
      if (store.has(key)) throw s3Error("PreconditionFailed", 412);
      const bytes = await collect(input.Body);
      const checksum = createHash("sha256").update(bytes).digest("base64");
      if (input.ChecksumSHA256 !== undefined && input.ChecksumSHA256 !== checksum)
        throw s3Error("BadDigest", 400);
      store.set(key, {
        bytes,
        contentType: input.ContentType,
        cacheControl: input.CacheControl,
        metadata: input.Metadata,
        checksumSHA256: checksum,
      });
      return { $metadata: { httpStatusCode: 200 }, ETag: `"${sha256Hex(bytes).slice(0, 32)}"` };
    }),
  };
  return fake;
}

function fakeSsm(values: Record<string, string>): CidCopySsm & { names: string[] } {
  const names: string[] = [];
  return {
    names,
    getParameter: vi.fn(async (name: string) => {
      names.push(name);
      return values[name];
    }),
  };
}

const puts = (s3: FakeS3): PutObjectCommandInput[] =>
  s3.calls.filter((c) => c.op === "put").map((c) => c.input as PutObjectCommandInput);

describe("local re-check before any S3 call", () => {
  it("fails when a local file's SHA-256 differs from the manifest", async () => {
    const f = await fixture();
    const part = f.manifest.artifacts.find((a) => a.kind === "table") as ManifestArtifact;
    write(join(f.runDir, part.name), bytesOf("tampered", part.size));
    const s3 = fakeS3();
    await expect(
      copyManifestObjects({ manifestPath: f.manifestPath, runDir: f.runDir, bucket: BUCKET, s3 }),
    ).rejects.toThrow(part.name);
    expect(s3.calls).toEqual([]);
  });

  it("fails when a local file's size differs from the manifest", async () => {
    const f = await fixture();
    const car = f.manifest.artifacts.find((a) => a.kind === "car") as ManifestArtifact;
    write(join(f.runDir, car.name), readFileSync(join(f.runDir, car.name)).subarray(0, 10));
    const s3 = fakeS3();
    await expect(
      copyManifestObjects({ manifestPath: f.manifestPath, runDir: f.runDir, bucket: BUCKET, s3 }),
    ).rejects.toThrow(/size/);
    expect(s3.calls).toEqual([]);
  });

  it("fails when the recomputed CID differs from the manifest (carCid of a directory)", async () => {
    const f = await fixture();
    const edited = structuredClone(f.manifest);
    const dir = edited.artifacts.find((a) => a.kind === "directory") as ManifestArtifact;
    dir.carCid = await cidOfBytes(new TextEncoder().encode("another tables.car"));
    write(f.manifestPath, jcsBytes(edited));
    const s3 = fakeS3();
    await expect(
      copyManifestObjects({ manifestPath: f.manifestPath, runDir: f.runDir, bucket: BUCKET, s3 }),
    ).rejects.toThrow(/carCid|CID/);
    expect(s3.calls).toEqual([]);
  });

  it("requires the exact JCS bytes of a RunManifestV1 (the committed form whose CID is indexed)", async () => {
    const f = await fixture();
    write(f.manifestPath, new TextEncoder().encode(JSON.stringify(f.manifest, null, 2)));
    const s3 = fakeS3();
    await expect(
      copyManifestObjects({ manifestPath: f.manifestPath, runDir: f.runDir, bucket: BUCKET, s3 }),
    ).rejects.toThrow(/JCS/);
    expect(s3.calls).toEqual([]);
  });
});

describe("conditional write and readback (TC-044)", () => {
  it("writes every artifact and the manifest under ipfs/<cid> with the immutable headers", async () => {
    const f = await fixture();
    const s3 = fakeS3();
    const lines: string[] = [];
    const report = await copyManifestObjects({
      manifestPath: f.manifestPath,
      runDir: f.runDir,
      bucket: BUCKET,
      s3,
      log: (l) => lines.push(l),
    });
    expect(report.bucket).toBe(BUCKET);
    expect(report.manifestCid).toBe(f.manifestCid);
    expect(report.written).toBe(f.expected.size);
    expect(report.skipped).toBe(0);
    expect(new Set(report.objects.map((o) => o.key))).toEqual(new Set(f.expected.keys()));
    expect([...s3.store.keys()].sort()).toEqual([...f.expected.keys()].sort());
    for (const [key, want] of f.expected) {
      const stored = s3.store.get(key);
      expect(Buffer.from(stored?.bytes ?? [])).toEqual(Buffer.from(want.bytes));
      expect(stored?.contentType).toBe(want.contentType);
      expect(stored?.cacheControl).toBe("public, max-age=31536000, immutable");
      const cid = key.slice("ipfs/".length);
      expect(stored?.metadata).toEqual({ cid, sha256: sha256Hex(want.bytes) });
    }
    for (const put of puts(s3)) {
      const want = f.expected.get(put.Key ?? "");
      expect(want).toBeDefined();
      expect(put.Bucket).toBe(BUCKET);
      expect(put.IfNoneMatch).toBe("*");
      expect(put.ChecksumSHA256).toBe(base64Of(sha256Hex(want?.bytes ?? new Uint8Array())));
      expect(put.ContentLength).toBe(want?.bytes.length);
      expect(put.CacheControl).toBe(CACHE_CONTROL);
      expect(put.ContentType).toBe(want?.contentType);
    }
    expect(CACHE_CONTROL).toBe("public, max-age=31536000, immutable");
    expect(CONTENT_TYPES).toEqual({
      table: "application/vnd.apache.parquet",
      car: "application/vnd.ipld.car",
      directory: "application/vnd.ipld.car",
      manifest: "application/json",
    });
    // The manifest is copied last, after every artifact it points to.
    const putKeys = puts(s3).map((p) => p.Key);
    expect(putKeys.at(-1)).toBe(`ipfs/${f.manifestCid}`);
    // Each object: HeadObject, PutObject, HeadObject readback with ChecksumMode.
    for (const key of f.expected.keys()) {
      const ops = s3.calls.filter((c) => c.input.Key === key);
      expect(ops.map((c) => c.op)).toEqual(["head", "put", "head"]);
      expect((ops[0]?.input as HeadObjectCommandInput).ChecksumMode).toBeUndefined();
      expect((ops[2]?.input as HeadObjectCommandInput).ChecksumMode).toBe("ENABLED");
    }
    expect(lines.filter((l) => l.includes("written"))).toHaveLength(f.expected.size);
  });

  it("uses only ipfs/<cid> keys and never runs/index.json or another mutable key", async () => {
    const f = await fixture();
    const s3 = fakeS3();
    await copyManifestObjects({
      manifestPath: f.manifestPath,
      runDir: f.runDir,
      bucket: BUCKET,
      s3,
    });
    const keys = s3.calls.map((c) => c.input.Key ?? "");
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) expect(key).toMatch(/^ipfs\/ba[a-z2-7]{50,}$/);
    expect(keys).not.toContain("runs/index.json");
    expect(cidCopyKey(f.manifestCid)).toBe(`ipfs/${f.manifestCid}`);
    expect(() => cidCopyKey("runs/index.json")).toThrow();
    expect(() => cidCopyKey("QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG")).toThrow();
  });

  it("skips an existing object with the same size and sha256 (idempotent re-run)", async () => {
    const f = await fixture();
    const s3 = fakeS3();
    await copyManifestObjects({
      manifestPath: f.manifestPath,
      runDir: f.runDir,
      bucket: BUCKET,
      s3,
    });
    const before = new Map(
      [...s3.store].map(([k, v]) => [k, Buffer.from(v.bytes).toString("hex")]),
    );
    const again = fakeS3(s3.store);
    const report = await copyManifestObjects({
      manifestPath: f.manifestPath,
      runDir: f.runDir,
      bucket: BUCKET,
      s3: again,
    });
    expect(report.written).toBe(0);
    expect(report.skipped).toBe(f.expected.size);
    expect(report.objects.every((o) => o.state === "skipped")).toBe(true);
    expect(puts(again)).toEqual([]);
    expect(again.calls.every((c) => c.op === "head")).toBe(true);
    for (const [k, v] of again.store)
      expect(Buffer.from(v.bytes).toString("hex")).toBe(before.get(k));
  });

  it("fails hard on an existing object with different content, never overwrites and never deletes", async () => {
    const f = await fixture();
    const part = f.manifest.artifacts.find((a) => a.kind === "table") as ManifestArtifact;
    const key = `ipfs/${part.cid}`;
    const foreign = bytesOf("something else", part.size + 3);
    const s3 = fakeS3(
      new Map([
        [
          key,
          {
            bytes: foreign,
            contentType: CONTENT_TYPES.table,
            cacheControl: CACHE_CONTROL,
            metadata: { cid: part.cid, sha256: sha256Hex(foreign) },
            checksumSHA256: createHash("sha256").update(foreign).digest("base64"),
          },
        ],
      ]),
    );
    await expect(
      copyManifestObjects({ manifestPath: f.manifestPath, runDir: f.runDir, bucket: BUCKET, s3 }),
    ).rejects.toThrow(key);
    expect(puts(s3).some((p) => p.Key === key)).toBe(false);
    expect(Buffer.from(s3.store.get(key)?.bytes ?? [])).toEqual(Buffer.from(foreign));
    expect(s3.calls.every((c) => c.op === "head" || c.op === "put")).toBe(true);
    expect(Object.keys(s3)).not.toContain("deleteObject");
  });

  it("fails when the readback checksum differs from the manifest sha256", async () => {
    const f = await fixture();
    const s3 = fakeS3(new Map(), {
      readbackChecksum: (key, real) => (key === `ipfs/${f.manifestCid}` ? real : "AAAA"),
    });
    await expect(
      copyManifestObjects({ manifestPath: f.manifestPath, runDir: f.runDir, bucket: BUCKET, s3 }),
    ).rejects.toThrow(/readback/);
  });

  it("derives the run dir from the manifest runId when none is given", async () => {
    const f = await fixture();
    const s3 = fakeS3();
    const report = await copyManifestObjects({
      manifestPath: f.manifestPath,
      repoRoot: f.root,
      bucket: BUCKET,
      s3,
    });
    expect(report.written).toBe(f.expected.size);
  });
});

describe("configuration", () => {
  it("reads the bucket from CID_COPY_BUCKET first, then from SSM /countylens/cid-copy/bucket", async () => {
    expect(CID_COPY_BUCKET_PARAMETER).toBe("/countylens/cid-copy/bucket");
    const fromEnv = fakeSsm({ [CID_COPY_BUCKET_PARAMETER]: "from-ssm" });
    await expect(
      resolveCidCopyBucket({ env: { CID_COPY_BUCKET: "from-env" }, ssm: fromEnv }),
    ).resolves.toBe("from-env");
    expect(fromEnv.names).toEqual([]);
    const fromSsm = fakeSsm({ [CID_COPY_BUCKET_PARAMETER]: "from-ssm" });
    await expect(resolveCidCopyBucket({ env: {}, ssm: fromSsm })).resolves.toBe("from-ssm");
    expect(fromSsm.names).toEqual([CID_COPY_BUCKET_PARAMETER]);
    await expect(resolveCidCopyBucket({ env: {}, ssm: fakeSsm({}) })).rejects.toThrow(
      CID_COPY_BUCKET_PARAMETER,
    );
  });

  it("writes as the assess-cid-writer profile and never names a region or a Delete call", () => {
    expect(CID_COPY_PROFILE).toBe("assess-cid-writer");
    const source = readFileSync(SRC, "utf8");
    expect(source).not.toMatch(/eu-north-1|us-east-\d|us-west-\d|region:\s*["']/);
    expect(source).not.toMatch(/DeleteObject|deleteObject/);
  });

  it("maps the SDK clients to HeadObject, PutObject and GetParameter commands", async () => {
    const sent: unknown[] = [];
    const s3 = cidCopyS3({
      send: vi.fn(async (command: unknown) => {
        sent.push(command);
        return { $metadata: { httpStatusCode: 200 } };
      }),
    } as unknown as S3Client);
    await s3.headObject({ Bucket: BUCKET, Key: "ipfs/x", ChecksumMode: "ENABLED" });
    await s3.putObject({ Bucket: BUCKET, Key: "ipfs/x", IfNoneMatch: "*" });
    expect(sent[0]).toBeInstanceOf(HeadObjectCommand);
    expect((sent[0] as HeadObjectCommand).input).toEqual({
      Bucket: BUCKET,
      Key: "ipfs/x",
      ChecksumMode: "ENABLED",
    });
    expect(sent[1]).toBeInstanceOf(PutObjectCommand);
    expect((sent[1] as PutObjectCommand).input).toEqual({
      Bucket: BUCKET,
      Key: "ipfs/x",
      IfNoneMatch: "*",
    });
    const ssmSent: unknown[] = [];
    const ssm = cidCopySsm({
      send: vi.fn(async (command: unknown) => {
        ssmSent.push(command);
        return { $metadata: { httpStatusCode: 200 }, Parameter: { Value: "bucket-name" } };
      }),
    } as unknown as SSMClient);
    await expect(ssm.getParameter(CID_COPY_BUCKET_PARAMETER)).resolves.toBe("bucket-name");
    expect(ssmSent[0]).toBeInstanceOf(GetParameterCommand);
    expect((ssmSent[0] as GetParameterCommand).input).toEqual({
      Name: CID_COPY_BUCKET_PARAMETER,
    });
  });
});
