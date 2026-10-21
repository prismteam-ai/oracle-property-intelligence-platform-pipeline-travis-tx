import { statSync } from 'node:fs';
import { sha256Hex } from './hash.js';
import { uploadAll, type S3Like, type UploadItem, type UploadResult } from './s3.js';
import type { VerifiedInputs } from './verify.js';

/** S3 key of a mirrored table part: `tables/<tables_cid>/<relative path>` (docs/hosted-layer-interfaces.md). */
export const mirrorKey = (tablesCid: string, relPath: string): string =>
  `tables/${tablesCid}/${relPath}`;

export function mirrorItems(v: VerifiedInputs): UploadItem[] {
  const cid = new Map(v.roots.map((r) => [`${r.group}/${r.shard}`, r.tablesCid]));
  return v.parts.map((p) => {
    const tablesCid = cid.get(`${p.group}/${p.shard}`);
    if (!tablesCid) throw new Error(`no tables root for ${p.group}/${p.shard}`);
    return { key: mirrorKey(tablesCid, p.relPath), file: p.file, sha256: p.sha256, size: p.size };
  });
}

/** Operator-run: uploads every verified table part to the mirror bucket. Never executed by the build or by tests against AWS. */
export function mirror(
  s3: S3Like,
  bucket: string,
  v: VerifiedInputs,
  opts: { dryRun?: boolean; log?: (m: string) => void } = {},
): Promise<UploadResult> {
  return uploadAll(s3, bucket, mirrorItems(v), {
    cacheControl: 'public, max-age=31536000, immutable',
    contentType: 'application/vnd.apache.parquet',
    ...opts,
  });
}

/**
 * Operator-run: stores the verified build inputs in the private deploy bucket under SHA-256 keys
 * (`inputs/sha256/<hex>`), plus an index object `inputs/index/<inputs_sha256>.json` naming every input.
 */
export async function stageInputs(
  s3: S3Like,
  bucket: string,
  v: VerifiedInputs,
  opts: { dryRun?: boolean; log?: (m: string) => void } = {},
): Promise<UploadResult & { indexKey: string }> {
  const seen = new Set<string>();
  const items: UploadItem[] = [];
  for (const f of v.files) {
    if (seen.has(f.sha256)) continue;
    seen.add(f.sha256);
    items.push({
      key: `inputs/sha256/${f.sha256}`,
      file: f.path,
      sha256: f.sha256,
      size: statSync(f.path).size,
    });
  }
  const res = await uploadAll(s3, bucket, items, opts);
  return { ...res, indexKey: `inputs/index/${v.inputsSha256}.json` };
}

/** The index document of staged inputs (id -> sha256), small enough to write with a plain PutObject by the CLI. */
export function inputsIndex(v: VerifiedInputs): { body: string; sha256: string } {
  const body = JSON.stringify({
    inputs_sha256: v.inputsSha256,
    files: v.files.map((f) => ({ id: f.id, sha256: f.sha256, check: f.check })),
  });
  return { body, sha256: sha256Hex(body) };
}
