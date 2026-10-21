import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { describe, expect, it } from 'vitest';
import { HashCache, sha256Hex } from '../src/hash.js';
import { mirror, mirrorItems, mirrorKey, stageInputs } from '../src/mirror.js';
import type { S3Like } from '../src/s3.js';
import type { VerifiedInputs } from '../src/verify.js';

/** A mocked S3 client: HeadObject answers from the map, PutObject stores the checksum it was given. Nothing touches AWS. */
function mockS3(existing: Record<string, string> = {}) {
  const store = new Map(Object.entries(existing));
  const puts: {
    Key: string;
    ChecksumSHA256: string;
    ContentLength: number;
    Bucket: string;
    CacheControl?: string;
  }[] = [];
  const s3: S3Like = {
    async send(cmd) {
      if (cmd instanceof HeadObjectCommand) {
        const sum = store.get(cmd.input.Key!);
        if (sum === undefined)
          throw Object.assign(new Error('nf'), {
            name: 'NotFound',
            $metadata: { httpStatusCode: 404 },
          });
        expect(cmd.input.ChecksumMode).toBe('ENABLED');
        return { ChecksumSHA256: sum, ContentLength: 1 };
      }
      if (cmd instanceof PutObjectCommand) {
        const i = cmd.input;
        puts.push({
          Key: i.Key!,
          ChecksumSHA256: i.ChecksumSHA256!,
          ContentLength: i.ContentLength!,
          Bucket: i.Bucket!,
          CacheControl: i.CacheControl,
        });
        store.set(i.Key!, i.ChecksumSHA256!);
        return {};
      }
      throw new Error('unexpected command');
    },
  };
  return { s3, puts, store };
}

function fixtureInputs(): { v: VerifiedInputs; hex: string[] } {
  const dir = mkdtempSync(path.join(tmpdir(), 'mirror-'));
  const parts = ['address/part-00000.parquet', 'parcel/part-00000.parquet'].map((rel, i) => {
    const file = path.join(dir, `f${i}.parquet`);
    const body = Buffer.from(`parquet bytes ${i}`);
    writeFileSync(file, body);
    return {
      group: 'county',
      shard: 's0001',
      table: rel.split('/')[0]!,
      relPath: rel,
      size: body.length,
      sha256: sha256Hex(body),
      cid: `cid${i}`,
      file,
    };
  });
  const v = {
    files: parts.map((p) => ({
      id: p.relPath,
      path: p.file,
      sha256: p.sha256,
      expected: p.sha256,
      check: 'manifest',
    })),
    parts,
    tablesDirs: {},
    reconcileDirs: {},
    roots: [{ group: 'county', shard: 's0001', tablesCid: 'baguqeeraTABLES', archiveCid: 'a' }],
    inputsSha256: 'abc',
  } as VerifiedInputs;
  return { v, hex: parts.map((p) => p.sha256) };
}

describe('mirror (mocked S3 only)', () => {
  it('keys parts as tables/<tables_cid>/<relative path>', () => {
    expect(mirrorKey('baguqeeraX', 'address/part-00000.parquet')).toBe(
      'tables/baguqeeraX/address/part-00000.parquet',
    );
    expect(mirrorItems(fixtureInputs().v).map((i) => i.key)).toEqual([
      'tables/baguqeeraTABLES/address/part-00000.parquet',
      'tables/baguqeeraTABLES/parcel/part-00000.parquet',
    ]);
  });

  it('uploads each part with the manifest SHA-256 (base64) as ChecksumSHA256 and immutable caching', async () => {
    const { v, hex } = fixtureInputs();
    const { s3, puts } = mockS3();
    const r = await mirror(s3, 'mirror-bucket', v);
    expect(r.uploaded.length).toBe(2);
    expect(r.skipped).toEqual([]);
    const byKey = Object.fromEntries(puts.map((p) => [p.Key, p]));
    expect(byKey['tables/baguqeeraTABLES/address/part-00000.parquet']?.ChecksumSHA256).toBe(
      Buffer.from(hex[0]!, 'hex').toString('base64'),
    );
    expect(
      puts.every((p) => p.Bucket === 'mirror-bucket' && p.CacheControl?.includes('immutable')),
    ).toBe(true);
  });

  it('skips objects that already exist with the same checksum and refuses to overwrite a different one', async () => {
    const { v, hex } = fixtureInputs();
    const b64 = (h: string) => Buffer.from(h, 'hex').toString('base64');
    const { s3, puts } = mockS3({
      'tables/baguqeeraTABLES/address/part-00000.parquet': b64(hex[0]!),
    });
    const r = await mirror(s3, 'b', v);
    expect(r.skipped).toEqual(['tables/baguqeeraTABLES/address/part-00000.parquet']);
    expect(puts.length).toBe(1);
    const other = mockS3({ 'tables/baguqeeraTABLES/parcel/part-00000.parquet': 'AAAA' });
    await expect(mirror(other.s3, 'b', v)).rejects.toThrow(/immutable/);
  });

  it('a dry run uploads nothing', async () => {
    const { v } = fixtureInputs();
    const { s3, puts } = mockS3();
    const r = await mirror(s3, 'b', v, { dryRun: true });
    expect(r.uploaded.length).toBe(2);
    expect(puts).toEqual([]);
  });
});

describe('stage-inputs (mocked S3 only)', () => {
  it('stores inputs under SHA-256 keys once each and reports the index key', async () => {
    const { v } = fixtureInputs();
    v.files.push({ ...v.files[0]!, id: 'duplicate-content' });
    const { s3, puts } = mockS3();
    const r = await stageInputs(s3, 'deploy-bucket', v);
    expect(puts.map((p) => p.Key).sort()).toEqual(
      v.files
        .slice(0, 2)
        .map((f) => `inputs/sha256/${f.sha256}`)
        .sort(),
    );
    expect(r.indexKey).toBe('inputs/index/abc.json');
    const again = await stageInputs(s3, 'deploy-bucket', v);
    expect(again.uploaded).toEqual([]);
    expect(again.skipped.length).toBe(2);
  });
});

describe('hash cache', () => {
  it('re-hashes a file whose size or mtime changed', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'hc-'));
    const f = path.join(dir, 'x');
    writeFileSync(f, 'one');
    const c = new HashCache(null);
    expect(await c.sha256(f)).toBe(sha256Hex('one'));
    writeFileSync(f, 'three');
    expect(await c.sha256(f)).toBe(sha256Hex('three'));
  });
});
