// AWS helpers for the hosted harness (T023). Identities (test plan § 3): profile `assess` for
// reads and the bench; `assess-cid-writer` (the uploader's own role profile, no Delete or ACL
// rights) only for the TC-044 overwrite attempt. The region is read from the profile
// configuration (~/.aws/config) and never from a literal (P0-18). Clients are created lazily,
// so importing this module makes no AWS call.
import {
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  type PutObjectCommandInput,
} from "@aws-sdk/client-s3";
import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import { fromNodeProviderChain } from "@aws-sdk/credential-providers";
import { loadSharedConfigFiles } from "@smithy/shared-ini-file-loader";
import { READER_PROFILE } from "./needs-aws.js";

export const PROFILES = {
  /** Reads, SSM lookups and the Lambda bench. */
  reader: READER_PROFILE,
  /** The CID-copy uploader's identity (CountyLensCidCopyWriter via role_arn), TC-044 only. */
  cidWriter: "assess-cid-writer",
} as const;
export type Profile = (typeof PROFILES)[keyof typeof PROFILES];

/** SSM String parameter that mirrors the `CidCopyBucketName` output (contracts/storage.md). */
export const CID_COPY_BUCKET_PARAMETER = "/countylens/cid-copy/bucket";

/** The region of a profile from ~/.aws/config, falling back to its `source_profile`. */
export async function profileRegion(profile: Profile = PROFILES.reader): Promise<string> {
  const { configFile } = await loadSharedConfigFiles();
  const section = configFile[profile];
  const source = section?.source_profile;
  const region = section?.region ?? (source ? configFile[source]?.region : undefined);
  if (!region) {
    throw new Error(
      `AWS profile "${profile}" has no region in ~/.aws/config; the harness never hard-codes one (P0-18)`,
    );
  }
  return region;
}

const s3Clients = new Map<Profile, Promise<S3Client>>();
let ssmClient: Promise<SSMClient> | undefined;

export function s3(profile: Profile = PROFILES.reader): Promise<S3Client> {
  let client = s3Clients.get(profile);
  if (!client) {
    client = profileRegion(profile).then(
      (region) => new S3Client({ region, credentials: fromNodeProviderChain({ profile }) }),
    );
    s3Clients.set(profile, client);
  }
  return client;
}

export function ssm(): Promise<SSMClient> {
  ssmClient ??= profileRegion(PROFILES.reader).then(
    (region) =>
      new SSMClient({ region, credentials: fromNodeProviderChain({ profile: PROFILES.reader }) }),
  );
  return ssmClient;
}

export async function getSsmParameter(name: string): Promise<string> {
  const client = await ssm();
  const out = await client.send(new GetParameterCommand({ Name: name }));
  const value = out.Parameter?.Value;
  if (!value) throw new Error(`SSM parameter ${name} has no value`);
  return value;
}

/** The CID-copy bucket name, from SSM (mirrors the CountyLensData output). */
export function cidCopyBucket(): Promise<string> {
  return getSsmParameter(CID_COPY_BUCKET_PARAMETER);
}

export interface ObjectHead {
  etag: string | undefined;
  contentLength: number | undefined;
  contentType: string | undefined;
  cacheControl: string | undefined;
  checksumSha256: string | undefined;
  metadata: Record<string, string>;
}

export async function headObject(
  bucket: string,
  key: string,
  profile: Profile = PROFILES.reader,
): Promise<ObjectHead> {
  const client = await s3(profile);
  const out = await client.send(
    new HeadObjectCommand({ Bucket: bucket, Key: key, ChecksumMode: "ENABLED" }),
  );
  return {
    etag: out.ETag,
    contentLength: out.ContentLength,
    contentType: out.ContentType,
    cacheControl: out.CacheControl,
    checksumSha256: out.ChecksumSHA256,
    metadata: out.Metadata ?? {},
  };
}

export async function getObjectBytes(
  bucket: string,
  key: string,
  profile: Profile = PROFILES.reader,
): Promise<Uint8Array> {
  const client = await s3(profile);
  const out = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (!out.Body) throw new Error(`s3://${bucket}/${key} has no body`);
  return out.Body.transformToByteArray();
}

/** Every key under a prefix (paginated). */
export async function listKeys(
  bucket: string,
  prefix: string,
  profile: Profile = PROFILES.reader,
): Promise<string[]> {
  const client = await s3(profile);
  const keys: string[] = [];
  let token: string | undefined;
  do {
    const out = await client.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }),
    );
    for (const object of out.Contents ?? []) if (object.Key) keys.push(object.Key);
    token = out.IsTruncated ? out.NextContinuationToken : undefined;
  } while (token);
  return keys;
}

export type PutAttempt =
  { ok: true } | { ok: false; name: string; status: number | undefined; message: string };

/**
 * A PutObject attempt that reports the refusal instead of throwing, so TC-044 can assert the
 * exact error name (`AccessDenied` without If-None-Match, `PreconditionFailed` with it).
 */
export async function putObjectAttempt(
  input: PutObjectCommandInput,
  profile: Profile,
): Promise<PutAttempt> {
  const client = await s3(profile);
  try {
    await client.send(new PutObjectCommand(input));
    return { ok: true };
  } catch (error: unknown) {
    const err = error as {
      name?: string;
      message?: string;
      $metadata?: { httpStatusCode?: number };
    };
    return {
      ok: false,
      name: err.name ?? "Error",
      status: err.$metadata?.httpStatusCode,
      message: err.message ?? String(error),
    };
  }
}
