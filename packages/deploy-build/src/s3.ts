import { createReadStream, statSync } from 'node:fs';
import { HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { mapLimit } from './hash.js';

/** The slice of an S3 client the operator commands use; tests pass a mock. */
export interface S3Like {
  send(command: HeadObjectCommand | PutObjectCommand): Promise<any>; // eslint-disable-line @typescript-eslint/no-explicit-any
}

export interface UploadItem {
  key: string;
  file: string;
  /** hex SHA-256 */
  sha256: string;
  size: number;
}

export interface UploadResult {
  uploaded: string[];
  skipped: string[];
}

const b64 = (hex: string) => Buffer.from(hex, 'hex').toString('base64');

async function headChecksum(
  s3: S3Like,
  bucket: string,
  key: string,
): Promise<{ exists: boolean; checksum?: string; size?: number }> {
  try {
    const r = await s3.send(
      new HeadObjectCommand({ Bucket: bucket, Key: key, ChecksumMode: 'ENABLED' }),
    );
    return { exists: true, checksum: r.ChecksumSHA256, size: r.ContentLength };
  } catch (e) {
    const err = e as { name?: string; $metadata?: { httpStatusCode?: number } };
    if (
      err.name === 'NotFound' ||
      err.name === 'NoSuchKey' ||
      err.$metadata?.httpStatusCode === 404
    )
      return { exists: false };
    throw e;
  }
}

/**
 * PutObject of each item with ChecksumSHA256 (S3 rejects mismatching bytes); an object that already exists with the same
 * checksum is skipped. Objects are immutable: an existing key with a different checksum is an error, never overwritten.
 */
export async function uploadAll(
  s3: S3Like,
  bucket: string,
  items: readonly UploadItem[],
  opts: {
    concurrency?: number;
    cacheControl?: string;
    contentType?: string;
    dryRun?: boolean;
    log?: (m: string) => void;
  } = {},
): Promise<UploadResult> {
  const result: UploadResult = { uploaded: [], skipped: [] };
  await mapLimit(items, opts.concurrency ?? 8, async (it) => {
    const want = b64(it.sha256);
    const head = await headChecksum(s3, bucket, it.key);
    if (head.exists) {
      if (head.checksum === want) {
        result.skipped.push(it.key);
        return;
      }
      throw new Error(
        `${it.key} exists in ${bucket} with checksum ${head.checksum ?? '(none)'} but the input is ${want}: objects are immutable, refusing to overwrite`,
      );
    }
    if (opts.dryRun) {
      result.uploaded.push(it.key);
      return;
    }
    if (statSync(it.file).size !== it.size)
      throw new Error(`${it.file}: size changed since verification`);
    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: it.key,
        Body: createReadStream(it.file),
        ContentLength: it.size,
        ChecksumSHA256: want,
        ContentType: opts.contentType ?? 'application/octet-stream',
        ...(opts.cacheControl ? { CacheControl: opts.cacheControl } : {}),
      }),
    );
    result.uploaded.push(it.key);
    opts.log?.(`uploaded ${it.key}`);
  });
  return result;
}
