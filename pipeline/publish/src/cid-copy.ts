// The CID copy writer (FR-012, AD-02, contracts/storage.md): a byte-for-byte copy of the
// published elephant-cli output on S3, keyed by CID, for the CloudFront read path. It takes only
// the committed manifest, re-reads every local file and recomputes size, SHA-256 and CID; any
// difference fails before the first S3 call. Keys are `ipfs/<cid>` only (table parts by `cid`,
// each `.car` and `tables.car` by `carCid`, the manifest by its own CID); never `runs/index.json`
// or any other mutable key. Each object: HeadObject first (same size + sha256 → skip; different →
// fail hard, the copy is immutable), else PutObject with `IfNoneMatch: "*"`, `ChecksumSHA256`,
// metadata {cid, sha256}, Content-Type by kind and `Cache-Control: public, max-age=31536000,
// immutable`, then a HeadObject readback with ChecksumMode. There is no delete call in this
// module and the writer role has no delete right. Bucket from `CID_COPY_BUCKET` or the SSM
// parameter `/countylens/cid-copy/bucket`; region from the SDK's default chain (the profile's
// configuration), never a literal; profile `assess-cid-writer`.
import { createHash } from "node:crypto";
import { createReadStream, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  type HeadObjectCommandInput,
  type HeadObjectCommandOutput,
  type PutObjectCommandInput,
  type PutObjectCommandOutput,
} from "@aws-sdk/client-s3";
import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import { RunManifestV1, isCidV1, type ManifestArtifact } from "@countylens/contract";
import { cidOfBytes, cidOfFile } from "./cid.js";
import { jcsBytes } from "./jcs.js";
import { sha256File } from "./sequence.js";

export const CID_COPY_BUCKET_PARAMETER = "/countylens/cid-copy/bucket";
export const CID_COPY_PROFILE = "assess-cid-writer";
export const CACHE_CONTROL = "public, max-age=31536000, immutable";
export const CONTENT_TYPES = {
  table: "application/vnd.apache.parquet",
  car: "application/vnd.ipld.car",
  directory: "application/vnd.ipld.car",
  manifest: "application/json",
} as const;
export type CidCopyKind = keyof typeof CONTENT_TYPES;

/** The two S3 calls this writer makes. Nothing else exists on this interface. */
export interface CidCopyS3 {
  headObject(input: HeadObjectCommandInput): Promise<HeadObjectCommandOutput>;
  putObject(input: PutObjectCommandInput): Promise<PutObjectCommandOutput>;
}

export interface CidCopySsm {
  getParameter(name: string): Promise<string | undefined>;
}

export function cidCopyS3(client: S3Client): CidCopyS3 {
  return {
    headObject: (input) => client.send(new HeadObjectCommand(input)),
    putObject: (input) => client.send(new PutObjectCommand(input)),
  };
}

export function cidCopySsm(client: SSMClient): CidCopySsm {
  return {
    getParameter: async (name) =>
      (await client.send(new GetParameterCommand({ Name: name }))).Parameter?.Value,
  };
}

/** Clients for the writer profile; the region comes from that profile's configuration. */
export function createCidCopyClients(options: { profile?: string } = {}): {
  s3: CidCopyS3;
  ssm: CidCopySsm;
} {
  const profile = options.profile ?? CID_COPY_PROFILE;
  return { s3: cidCopyS3(new S3Client({ profile })), ssm: cidCopySsm(new SSMClient({ profile })) };
}

/** `CID_COPY_BUCKET` when set, else the SSM parameter written by the Data stack. */
export async function resolveCidCopyBucket(options: {
  env: NodeJS.ProcessEnv;
  ssm: CidCopySsm;
}): Promise<string> {
  const fromEnv = options.env.CID_COPY_BUCKET;
  if (fromEnv !== undefined && fromEnv !== "") return fromEnv;
  const value = await options.ssm.getParameter(CID_COPY_BUCKET_PARAMETER);
  if (value === undefined || value === "")
    throw new Error(`CID_COPY_BUCKET is not set and SSM ${CID_COPY_BUCKET_PARAMETER} has no value`);
  return value;
}

/** The only key shape the copy holds. */
export function cidCopyKey(cid: string): string {
  if (!isCidV1(cid))
    throw new Error(`CID copy keys are ipfs/<CIDv1> only; "${cid}" is not a CIDv1`);
  return `ipfs/${cid}`;
}

export interface CidCopyObject {
  key: string;
  /** The manifest artifact name, or `manifest.json`. */
  name: string;
  kind: CidCopyKind;
  cid: string;
  size: number;
  sha256: string;
  contentType: string;
  state: "written" | "skipped";
}

export interface CidCopyReport {
  bucket: string;
  manifestCid: string;
  objects: CidCopyObject[];
  written: number;
  skipped: number;
}

export interface CidCopyOptions {
  /** `runs/<runId>/manifest.json`: the exact JCS bytes of the published manifest. */
  manifestPath: string;
  /** Where the artifact files live (`pipeline/data/runs/<runId>`); derived from runId by default. */
  runDir?: string;
  /** Base for the default runDir (default: the current directory). */
  repoRoot?: string;
  bucket: string;
  s3: CidCopyS3;
  log?: (line: string) => void;
  /** Max simultaneous object copies (default 8); our own bucket, no third-party rate limit. */
  concurrency?: number;
}

interface Planned {
  key: string;
  name: string;
  kind: CidCopyKind;
  cid: string;
  size: number;
  sha256: string;
  contentType: string;
  /** A file path, or the bytes themselves (the manifest). */
  source: { path: string } | { bytes: Uint8Array };
}

function base64Sha(sha256Hex: string): string {
  return Buffer.from(sha256Hex, "hex").toString("base64");
}

/** The file an artifact's CID-copy object is made of, and the CID it is keyed by. */
function localFile(runDir: string, a: ManifestArtifact): { path: string; cid: string } {
  if (a.kind === "table") return { path: join(runDir, a.name), cid: a.cid };
  if (a.carCid === undefined)
    throw new Error(`${a.name}: ${a.kind} artifact has no carCid (AM-05); nothing to copy by file`);
  const path = a.kind === "directory" ? join(runDir, a.name, "tables.car") : join(runDir, a.name);
  return { path, cid: a.carCid };
}

/** Re-reads every local file; any difference from the manifest fails before an S3 call. */
async function plan(
  runDir: string,
  manifest: RunManifestV1,
  manifestBytes: Uint8Array,
  manifestCid: string,
): Promise<Planned[]> {
  const planned: Planned[] = [];
  for (const a of manifest.artifacts) {
    const { path, cid } = localFile(runDir, a);
    const size = statSync(path).size;
    if (size !== a.size)
      throw new Error(`${a.name}: ${path} is ${size} bytes, the manifest says size ${a.size}`);
    const sha256 = await sha256File(path);
    if (sha256 !== a.sha256)
      throw new Error(`${a.name}: ${path} has sha256 ${sha256}, the manifest says ${a.sha256}`);
    const derived = await cidOfFile(path);
    if (derived !== cid) {
      const field = a.kind === "table" ? "cid" : "carCid";
      throw new Error(`${a.name}: ${path} has CID ${derived}, the manifest's ${field} is ${cid}`);
    }
    planned.push({
      key: cidCopyKey(cid),
      name: a.name,
      kind: a.kind,
      cid,
      size,
      sha256,
      contentType: CONTENT_TYPES[a.kind],
      source: { path },
    });
  }
  // The manifest last: it is the pointer to everything above.
  planned.push({
    key: cidCopyKey(manifestCid),
    name: "manifest.json",
    kind: "manifest",
    cid: manifestCid,
    size: manifestBytes.length,
    sha256: createHash("sha256").update(manifestBytes).digest("hex"),
    contentType: CONTENT_TYPES.manifest,
    source: { bytes: manifestBytes },
  });
  return planned;
}

function isNotFound(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { name?: unknown; $metadata?: { httpStatusCode?: unknown } };
  return e.name === "NotFound" || e.name === "NoSuchKey" || e.$metadata?.httpStatusCode === 404;
}

async function headOrNull(
  s3: CidCopyS3,
  input: HeadObjectCommandInput,
): Promise<HeadObjectCommandOutput | null> {
  try {
    return await s3.headObject(input);
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
}

/** One object: HeadObject → skip or fail → conditional PutObject → HeadObject readback. */
async function copyOne(
  s3: CidCopyS3,
  bucket: string,
  p: Planned,
  log: (line: string) => void,
): Promise<CidCopyObject> {
  const result: CidCopyObject = {
    key: p.key,
    name: p.name,
    kind: p.kind,
    cid: p.cid,
    size: p.size,
    sha256: p.sha256,
    contentType: p.contentType,
    state: "skipped",
  };
  const existing = await headOrNull(s3, { Bucket: bucket, Key: p.key });
  if (existing) {
    const same =
      existing.ContentLength === p.size &&
      existing.Metadata?.sha256 === p.sha256 &&
      existing.Metadata?.cid === p.cid;
    if (!same) {
      throw new Error(
        `${p.key} exists with different content (size ${existing.ContentLength}, sha256 ${existing.Metadata?.sha256}); ` +
          `the CID copy is immutable and ${p.name} (size ${p.size}, sha256 ${p.sha256}) was not written`,
      );
    }
    log(`skipped ${p.key} ${p.name} (already present, size ${p.size}, sha256 ${p.sha256})`);
    return result;
  }
  const checksum = base64Sha(p.sha256);
  await s3.putObject({
    Bucket: bucket,
    Key: p.key,
    Body: "path" in p.source ? createReadStream(p.source.path) : Buffer.from(p.source.bytes),
    ContentLength: p.size,
    ContentType: p.contentType,
    CacheControl: CACHE_CONTROL,
    Metadata: { cid: p.cid, sha256: p.sha256 },
    ChecksumSHA256: checksum,
    IfNoneMatch: "*",
  });
  const back = await s3.headObject({ Bucket: bucket, Key: p.key, ChecksumMode: "ENABLED" });
  const problems: string[] = [];
  if (back.ContentLength !== p.size) problems.push(`size ${back.ContentLength} ≠ ${p.size}`);
  if (back.ChecksumSHA256 !== checksum)
    problems.push(`ChecksumSHA256 ${back.ChecksumSHA256} ≠ ${checksum}`);
  if (back.Metadata?.sha256 !== p.sha256)
    problems.push(`metadata sha256 ${back.Metadata?.sha256} ≠ ${p.sha256}`);
  if (back.Metadata?.cid !== p.cid) problems.push(`metadata cid ${back.Metadata?.cid} ≠ ${p.cid}`);
  if (problems.length > 0)
    throw new Error(`${p.key} readback does not match ${p.name}: ${problems.join("; ")}`);
  log(`written ${p.key} ${p.name} (size ${p.size}, sha256 ${p.sha256})`);
  return { ...result, state: "written" };
}

/**
 * Copies every artifact of a published manifest, and the manifest itself, into the CID copy.
 * Idempotent: an object already present with the same size and sha256 is skipped; one present
 * with different content fails the run.
 */
export async function copyManifestObjects(options: CidCopyOptions): Promise<CidCopyReport> {
  const log = options.log ?? ((line: string) => console.log(line));
  const bytes = readFileSync(options.manifestPath);
  const manifest = RunManifestV1.parse(JSON.parse(bytes.toString("utf8")));
  if (!bytes.equals(Buffer.from(jcsBytes(manifest))))
    throw new Error(`${options.manifestPath} is not the exact JCS bytes of its RunManifestV1`);
  const manifestCid = await cidOfBytes(bytes);
  const runDir =
    options.runDir ??
    join(options.repoRoot ?? process.cwd(), "pipeline", "data", "runs", manifest.runId);
  const planned = await plan(runDir, manifest, bytes, manifestCid);
  // S3 has no meaningful rate limit for our own bucket (unlike the public IPFS gateways this
  // module never touches), so copies run with bounded concurrency rather than one at a time.
  // copyOne is already idempotent (HeadObject check) and order-independent.
  const concurrency = options.concurrency ?? 8;
  const objects: CidCopyObject[] = new Array(planned.length);
  let next = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const i = next++;
      if (i >= planned.length) return;
      const p = planned[i];
      if (p === undefined) return;
      objects[i] = await copyOne(options.s3, options.bucket, p, log);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, planned.length) }, worker));
  const written = objects.filter((o) => o.state === "written").length;
  return {
    bucket: options.bucket,
    manifestCid,
    objects,
    written,
    skipped: objects.length - written,
  };
}
