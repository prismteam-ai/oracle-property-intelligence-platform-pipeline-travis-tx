// Zod-validated environment of the API Lambda (A-03 T008; plan § "Fixed texts and config keys";
// constitution III, V). Only the keys the Lambda reads are required: CID_COPY_BUCKET (the S3
// bucket of the CID copy) and READPATH_PRIVATE_PREFIX (the private bench prefix, outside the
// CloudFront origin path). CID_COPY_HOST and FILEBASE_GATEWAY_HOST are read by no Lambda code, so
// they are not required (/code-review Minor 7); host validation stays in @countylens/shared
// (readPathUrls). A missing or invalid key fails at load time, naming the key. The region is never configured here: the AWS SDK reads AWS_REGION
// from the Lambda runtime (P0-18).
import { z } from "zod";

export const REQUIRED_ENV_KEYS = ["CID_COPY_BUCKET", "READPATH_PRIVATE_PREFIX"] as const;

export type RequiredEnvKey = (typeof REQUIRED_ENV_KEYS)[number];

/** `private/<name>/`: the only prefix the bench may read (research R-02, contracts/storage.md). */
const PRIVATE_PREFIX = /^private\/[a-z0-9-]+\/$/;

export const ApiEnv = z.object({
  CID_COPY_BUCKET: z.string().min(1),
  READPATH_PRIVATE_PREFIX: z.string().regex(PRIVATE_PREFIX, "must match private/<name>/"),
});

export interface ApiConfig {
  readonly cidCopyBucket: string;
  readonly readPathPrivatePrefix: string;
}

export type EnvSource = Readonly<Record<string, string | undefined>>;

/**
 * Validates `env` (default: `process.env`) and returns the typed config. Throws an Error whose
 * message names every missing key, or the first invalid one, so a misconfigured deploy fails on
 * the first invocation instead of at query time.
 */
export function loadConfig(env: EnvSource = process.env): ApiConfig {
  const missing = REQUIRED_ENV_KEYS.filter((key) => {
    const value = env[key];
    return value === undefined || value === "";
  });
  if (missing.length > 0) {
    throw new Error(`Missing required environment variable(s): ${missing.join(", ")}`);
  }
  const parsed = ApiEnv.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
    throw new Error(`Invalid environment variable(s): ${issues.join("; ")}`);
  }
  return {
    cidCopyBucket: parsed.data.CID_COPY_BUCKET,
    readPathPrivatePrefix: parsed.data.READPATH_PRIVATE_PREFIX,
  };
}

let cached: ApiConfig | undefined;

/** The process config, validated once per Lambda sandbox. */
export function getConfig(): ApiConfig {
  cached ??= loadConfig();
  return cached;
}
