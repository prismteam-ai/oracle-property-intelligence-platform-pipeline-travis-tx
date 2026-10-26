// A-04 T007: ordered, recorded, checksum-guarded migrations and the 0000_core schema
// (data-model.md § 0000). Pure SQL-text and in-memory store tests always run; the Query DB
// integration case runs only when QDB_TEST_URL is set, in a throwaway schema.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import postgres from "postgres";
import {
  MIGRATIONS_DIR,
  migrate,
  postgresMigrationStore,
  readMigrations,
  type MigrationFile,
  type MigrationStore,
} from "../services/migrate.js";

const CORE = readFileSync(new URL("../migrations/0000_core.sql", import.meta.url), "utf8");
const norm = CORE.replace(/\s+/g, " ").toLowerCase();

function memoryStore(): MigrationStore & { log: string[]; rows: Map<string, string> } {
  const rows = new Map<string, string>();
  const log: string[] = [];
  return {
    rows,
    log,
    async ensureTable() {
      log.push("ensure");
    },
    async applied() {
      return new Map(rows);
    },
    async apply(file) {
      log.push(`begin ${file.name}`, `run ${file.name}`, `record ${file.name}`, `commit ${file.name}`);
      rows.set(file.name, file.sha256);
    },
  };
}

const file = (name: string, sql: string, sha256 = name.padEnd(64, "0").slice(0, 64)): MigrationFile => ({
  name,
  sql,
  sha256,
});

describe("A-04 migrate: order, once, transaction, checksum", () => {
  it("reads NNNN_<name>.sql files in name order with their sha256", () => {
    const files = readMigrations(MIGRATIONS_DIR);
    expect(files.map((f) => f.name)).toEqual([...files.map((f) => f.name)].sort());
    expect(files[0]?.name).toBe("0000_core.sql");
    for (const f of files) expect(f.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("applies files in name order, each once, each in its own transaction", async () => {
    const store = memoryStore();
    const files = [file("0101_tcad.sql", "b"), file("0000_core.sql", "a"), file("0201_gis.sql", "c")];
    const first = await migrate(store, files);
    expect(first.applied).toEqual(["0000_core.sql", "0101_tcad.sql", "0201_gis.sql"]);
    expect(store.log.filter((l) => l.startsWith("begin"))).toEqual([
      "begin 0000_core.sql",
      "begin 0101_tcad.sql",
      "begin 0201_gis.sql",
    ]);
    const second = await migrate(store, files);
    expect(second.applied).toEqual([]);
    expect(second.skipped).toHaveLength(3);
  });

  it("fails when an applied migration's sha256 changed, and applies nothing after it", async () => {
    const store = memoryStore();
    await migrate(store, [file("0000_core.sql", "a", "a".repeat(64))]);
    await expect(
      migrate(store, [file("0000_core.sql", "a2", "b".repeat(64)), file("0101_tcad.sql", "b")]),
    ).rejects.toThrow(/0000_core\.sql.*sha256 changed/);
    expect(store.rows.has("0101_tcad.sql")).toBe(false);
  });
});

describe("A-04 0000_core.sql (data-model.md § 0000)", () => {
  it("creates the seven core tables", () => {
    for (const t of [
      "schema_migrations",
      "backbone_runs",
      "capture_receipts",
      "watermarks",
      "source_tombstones",
      "source_limitations",
      "loader_merges",
    ]) {
      expect(norm, t).toContain(`create table if not exists ${t} (`);
    }
  });

  it("checks job_id, track, mode, status and outcome values", () => {
    expect(norm).toContain("job_id ~ '^travis-a04-[a-z0-9-]+$'");
    expect(norm).toMatch(/track in \('appraisal', 'gis', 'permits'\)/);
    expect(norm).toMatch(/mode in \('pilot', 'full', 'backfill', 'incremental', 'coords'\)/);
    expect(norm).toMatch(/status in \('running', 'waiting_human', 'blocked', 'complete', 'failed'\)/);
    expect(norm).toMatch(/outcome in \('ok', 'blocked', 'error', 'skipped_checkpoint'\)/);
    expect(norm).toContain("check (outcome <> 'blocked' or blocked_at is not null)");
    expect(norm).toMatch(/reason text not null check \(reason in \('source_removed'\)\)/);
  });

  it("has the data-model keys", () => {
    expect(norm).toMatch(/schema_migrations \( name text primary key/);
    expect(norm).toMatch(/backbone_runs \( job_id text primary key/);
    expect(norm).toContain("primary key (track, source_key)");
    expect(norm).toContain("primary key (source_key, row_key)");
    expect(norm).toContain("primary key (job_id, source_key, code)");
    expect(norm).toContain("primary key (track, artifact_sha256)");
    expect(norm).toMatch(/create index if not exists \w+ on capture_receipts \(job_id, source_key\)/);
  });

  it("allows one running ingest at a time (FR-025)", () => {
    expect(norm).toMatch(
      /create unique index if not exists \w+ on backbone_runs \(\(true\)\) where status = 'running' and mode in \('full', 'backfill', 'incremental'\)/,
    );
  });
});

const QDB = process.env.QDB_TEST_URL;
describe.skipIf(!QDB)("A-04 migrate against the Query DB (QDB_TEST_URL, throwaway schema)", () => {
  it("applies 0000_core once and rejects a changed checksum", async () => {
    const schema = `a04_mig_${Date.now().toString(36)}`;
    const admin = postgres(QDB ?? "", { max: 1, onnotice: () => {} });
    await admin.unsafe(`CREATE SCHEMA ${schema}`);
    const sql = postgres(QDB ?? "", { max: 1, onnotice: () => {}, connection: { search_path: schema } });
    try {
      const files = readMigrations(MIGRATIONS_DIR).filter((f) => f.name === "0000_core.sql");
      const store = postgresMigrationStore(sql);
      expect((await migrate(store, files)).applied).toEqual(["0000_core.sql"]);
      expect((await migrate(store, files)).applied).toEqual([]);
      await expect(
        sql`INSERT INTO capture_receipts (job_id, source_key, url, outcome) VALUES ('travis-a04-t', 'x', 'u', 'blocked')`,
      ).rejects.toThrow();
      await expect(
        migrate(store, files.map((f) => ({ ...f, sha256: "0".repeat(64) }))),
      ).rejects.toThrow(/sha256 changed/);
    } finally {
      await sql.end();
      await admin.unsafe(`DROP SCHEMA ${schema} CASCADE`);
      await admin.end();
    }
  });
});
