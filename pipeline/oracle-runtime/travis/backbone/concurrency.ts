// Worker-count cap for the transform and prepare pools. An old env file may still hold large
// values (16 / 8) that exhausted memory on a 16 GiB machine; unless TCAD_UNSAFE_CONCURRENCY=1
// is set the counts are capped here, in our code (the vendored kit is never edited).
export const MAX_TRANSFORM_WORKERS = 6;
export const MAX_PREPARE_WORKERS = 2;
/** TCAD_TRANSFORM_WORKERS (1..8) is the lead's explicit raise: it wins over the cap, never above 8. */
export const MAX_EXPLICIT_TRANSFORM_WORKERS = 8;

type Env = Record<string, string | undefined>;

function pick(raw: string | undefined, cap: number, unsafe: boolean): number {
  const n = raw !== undefined && /^\d+$/.test(raw.trim()) ? Number(raw.trim()) : 0;
  if (n < 1) return cap;
  return unsafe ? n : Math.min(n, cap);
}

export function capConcurrency(env: Readonly<Env>): { transform: number; prepare: number } {
  const unsafe = env.TCAD_UNSAFE_CONCURRENCY === "1";
  const raw = env.TCAD_TRANSFORM_WORKERS?.trim() ?? "";
  const explicit =
    /^\d+$/.test(raw) && Number(raw) >= 1
      ? Math.min(Number(raw), MAX_EXPLICIT_TRANSFORM_WORKERS)
      : 0;
  return {
    transform:
      explicit > 0 ? explicit : pick(env.CONCURRENCY_TRANSFORM, MAX_TRANSFORM_WORKERS, unsafe),
    prepare: pick(env.CONCURRENCY_PREPARE, MAX_PREPARE_WORKERS, unsafe),
  };
}

/** Writes the capped counts back into `env` (process.env at service start). */
export function applyConcurrencyCap(env: Env = process.env): {
  transform: number;
  prepare: number;
} {
  const c = capConcurrency(env);
  env.CONCURRENCY_TRANSFORM = String(c.transform);
  env.CONCURRENCY_PREPARE = String(c.prepare);
  return c;
}
