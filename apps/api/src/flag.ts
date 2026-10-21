import { createRequire } from 'node:module';

/** The budget kill switches (decisions.md section 20): one SSM parameter per function, value `true`/`false`. */
export type FlagReader = () => Promise<string | null>;

/** Short timeouts and one retry for the SDK clients a request waits on (SSM flag, Secrets Manager key). */
export const SDK_CLIENT_OPTIONS = {
  maxAttempts: 2,
  requestHandler: { connectionTimeout: 1000, requestTimeout: 1000 },
};

/**
 * Reads the kill-switch parameter named by the environment variable `envName` with SSM (null when it is unset, as in
 * local runs). The AWS SDK v3 ships with the Lambda base image, so the client is imported at run time and left out of
 * the bundle.
 */
export function ssmFlagReader(envName: string): FlagReader {
  return async () => {
    const name = process.env[envName];
    if (!name) return null;
    // createRequire, not import(): ESM resolution ignores NODE_PATH, which is how the Lambda base image exposes its bundled SDK
    const { SSMClient, GetParameterCommand } = createRequire(import.meta.url)(
      '@aws-sdk/client-ssm',
    ) as typeof import('@aws-sdk/client-ssm');
    const r = await new SSMClient(SDK_CLIENT_OPTIONS).send(new GetParameterCommand({ Name: name }));
    return r.Parameter?.Value ?? null;
  };
}

/** Short cache (30 s) of the flag, shared by warm invocations. */
export function cachedFlag(
  read: FlagReader,
  ttlMs = 30_000,
  now: () => number = Date.now,
): FlagReader {
  let value: string | null = null;
  let at = -Infinity;
  return async () => {
    if (now() - at < ttlMs) return value;
    try {
      value = await read();
    } catch {
      // a failed read keeps the previous value
    }
    at = now();
    return value;
  };
}

/** Resolves to `fallback` when `p` takes longer than `ms` or rejects. */
export async function within<T, F>(p: Promise<T>, ms: number, fallback: F): Promise<T | F> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      p.catch(() => fallback),
      new Promise<F>((r) => (timer = setTimeout(() => r(fallback), Math.max(0, ms)))),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
