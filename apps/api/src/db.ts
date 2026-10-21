import type { Logger } from '@aws-lambda-powertools/logger';
import type { Meta } from '@travis/contract';
import { DEFAULT_LIMITS, Queries, servingFromEnv } from '@travis/query';

const dbPath = (): string => process.env.DUCKDB_PATH ?? '/opt/db/serving.duckdb';

/** `/v1/meta.limits` from LIMITS_JSON (the CDK config), over the defaults. */
export function limitsFromEnv(): Meta['limits'] | undefined {
  const raw = process.env.LIMITS_JSON;
  if (!raw) return undefined;
  const parsed = JSON.parse(raw) as Partial<Meta['limits']>;
  return { ...DEFAULT_LIMITS, ...parsed } as Meta['limits'];
}

/**
 * The instance's query layer, opened on first use (in Lambda: at init) and reused across warm invocations; a failed open
 * is retried by the next request. With SERVING_BASE set (the deployed functions), DUCKDB_PATH is the serving file and
 * the large tables are read from the private deploy bucket (decisions.md section 30).
 */
export function queriesLoader(logger: Logger): () => Promise<Queries> {
  let queries: Promise<Queries> | null = null;
  return () => {
    if (!queries) {
      const t0 = performance.now();
      const p = (async () => {
        const q = await Queries.open({
          dbPath: dbPath(),
          serving: servingFromEnv(),
          memoryLimit: process.env.DUCKDB_MEMORY_LIMIT,
          threads: process.env.DUCKDB_THREADS ? Number(process.env.DUCKDB_THREADS) : undefined,
          tempDirectory: '/tmp',
          extensionDirectory: process.env.DUCKDB_EXTENSION_DIR,
          limits: limitsFromEnv(),
        });
        logger.info('cold start', {
          open_ms: q.openMs,
          ready_ms: Math.round(performance.now() - t0),
        });
        return q;
      })();
      p.catch(() => {
        queries = null;
      });
      queries = p;
    }
    return queries;
  };
}
