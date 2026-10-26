// A-04 T007: ordered Query DB migrations (internal store only; never public).
//
// Files `migrations/NNNN_<name>.sql` are applied in name order (0000_core → 0101_tcad →
// 0201_gis → 0301_permits), each once, each in its own transaction together with its
// `schema_migrations` row. An applied file whose sha256 changed stops the run: migrations are
// append-only, a later file ALTERs an earlier table. `npm run migrate` reads DATABASE_URL and
// prints names and counts only, never the URL.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

export const MIGRATIONS_DIR = fileURLToPath(new URL("../migrations/", import.meta.url));
const FILE_NAME = /^\d{4}_[a-z0-9_]+\.sql$/;
/** One advisory lock for every migrate run, so two runs never interleave. */
const MIGRATE_LOCK = 4_040_000;

export interface MigrationFile {
  name: string;
  sql: string;
  sha256: string;
}

/** Where applied migrations are recorded; the Postgres store is the real one. */
export interface MigrationStore {
  ensureTable(): Promise<void>;
  /** name → sha256 of every applied migration. */
  applied(): Promise<Map<string, string>>;
  /** Runs the file and records it in ONE transaction. */
  apply(file: MigrationFile): Promise<void>;
}

export interface MigrateResult {
  applied: string[];
  skipped: string[];
}

export function readMigrations(dir: string = MIGRATIONS_DIR): MigrationFile[] {
  return readdirSync(dir)
    .filter((name) => FILE_NAME.test(name))
    .sort()
    .map((name) => {
      const sql = readFileSync(join(dir, name), "utf8");
      return { name, sql, sha256: createHash("sha256").update(sql).digest("hex") };
    });
}

export async function migrate(
  store: MigrationStore,
  files: readonly MigrationFile[],
): Promise<MigrateResult> {
  await store.ensureTable();
  const done = await store.applied();
  const result: MigrateResult = { applied: [], skipped: [] };
  for (const file of [...files].sort((a, b) => a.name.localeCompare(b.name))) {
    const prior = done.get(file.name);
    if (prior !== undefined) {
      if (prior !== file.sha256) {
        throw new Error(
          `migration ${file.name}: sha256 changed since it was applied; add a new migration instead`,
        );
      }
      result.skipped.push(file.name);
      continue;
    }
    await store.apply(file);
    result.applied.push(file.name);
  }
  return result;
}

export function postgresMigrationStore(sql: postgres.Sql): MigrationStore {
  return {
    async ensureTable() {
      await sql.unsafe(
        `CREATE TABLE IF NOT EXISTS schema_migrations (
           name text PRIMARY KEY,
           sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
           applied_at timestamptz NOT NULL DEFAULT now())`,
      );
    },
    async applied() {
      const rows = await sql<Array<{ name: string; sha256: string }>>`
        SELECT name, sha256 FROM schema_migrations`;
      return new Map(rows.map((r) => [r.name, r.sha256]));
    },
    async apply(file) {
      await sql.begin(async (tx) => {
        await tx`SELECT pg_advisory_xact_lock(${MIGRATE_LOCK})`;
        const again = await tx<Array<{ sha256: string }>>`
          SELECT sha256 FROM schema_migrations WHERE name = ${file.name}`;
        if (again.length > 0) {
          if (again[0]?.sha256 !== file.sha256) {
            throw new Error(`migration ${file.name}: sha256 changed since it was applied`);
          }
          return;
        }
        await tx.unsafe(file.sql);
        await tx`INSERT INTO schema_migrations (name, sha256) VALUES (${file.name}, ${file.sha256})`;
      });
    },
  };
}

async function main(): Promise<number> {
  const url = process.env.DATABASE_URL;
  if (url === undefined || url.trim() === "") {
    process.stderr.write("migrate: DATABASE_URL is not set\n");
    return 1;
  }
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    const result = await migrate(postgresMigrationStore(sql), readMigrations());
    process.stdout.write(
      `migrate: applied=${result.applied.length} skipped=${result.skipped.length}` +
        (result.applied.length > 0 ? ` (${result.applied.join(", ")})` : "") +
        "\n",
    );
    return 0;
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    const message = error instanceof Error && code === undefined ? error.message : "";
    process.stderr.write(
      `migrate: failed (${typeof code === "string" ? code : "no code"}) ${message}\n`,
    );
    return 1;
  } finally {
    await sql.end();
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await import("dotenv/config");
  process.exitCode = await main();
}
