// A-04: the SQL-facing edges of the local stack, over a fake `postgres` client (no connection is
// ever opened): the report store's three reads, the BackboneReport handlers, the migration store's
// transaction and checksum guard, and the lazily opened configured connection.
import * as restate from "@restatedev/restate-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type postgres from "postgres";

const h = vi.hoisted(() => ({
  factory: vi.fn(),
}));
vi.mock("postgres", () => ({ default: (...args: unknown[]) => h.factory(...args) }));

import { configuredSystemIdentifier } from "../services/configured-db.js";
import { lazyQueryDb } from "../services/loader.js";
import { migrate, postgresMigrationStore, type MigrationFile } from "../services/migrate.js";
import {
  createBackboneReport,
  postgresReportStore,
  type ReportSection,
} from "../services/report.js";

const norm = (strings: TemplateStringsArray): string =>
  strings.join("?").replace(/\s+/g, " ").trim();

/** A tagged-template fake that also answers `sql(list)`, `.unsafe`, `.begin` and `.end`. */
function fakeSql(answer: (text: string, values: unknown[]) => unknown[] = () => []) {
  const log: Array<{ text: string; values: unknown[] }> = [];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = norm(strings);
    log.push({ text, values });
    return Promise.resolve(answer(text, values));
  };
  const sql = Object.assign(
    ((first: unknown, ...rest: unknown[]) =>
      Array.isArray(first) && "raw" in first
        ? tag(first as TemplateStringsArray, ...rest)
        : { list: first }) as unknown as postgres.Sql,
    {
      unsafe: (text: string) => {
        log.push({ text: text.replace(/\s+/g, " ").trim(), values: [] });
        return Promise.resolve(answer(text, []));
      },
      begin: async (fn: (tx: postgres.Sql) => Promise<unknown>) => {
        log.push({ text: "BEGIN", values: [] });
        try {
          const out = await fn(sql);
          log.push({ text: "COMMIT", values: [] });
          return out;
        } catch (error) {
          log.push({ text: "ROLLBACK", values: [] });
          throw error;
        }
      },
      end: vi.fn(async () => undefined),
    },
  );
  return { sql, log };
}

beforeEach(() => h.factory.mockReset());

describe("postgresReportStore", () => {
  const JOB = "travis-a04-202610220100";

  it("run() returns the row, or null for an unknown job, with the job id as a bound value", async () => {
    const hit = fakeSql(() => [{ as_of: "2026-10-22", code_sha: "abc1234" }]);
    expect(await postgresReportStore(hit.sql).run(JOB)).toEqual({
      as_of: "2026-10-22",
      code_sha: "abc1234",
    });
    expect(hit.log[0]?.text).toContain("FROM backbone_runs WHERE job_id = ?");
    expect(hit.log[0]?.values).toEqual([JOB]);
    expect(await postgresReportStore(fakeSql().sql).run(JOB)).toBeNull();
  });

  it("limitations() lists the jobs given, ordered own job first, and returns the rows as read", async () => {
    const rows = [
      { job_id: JOB, text: "gis: blocked at 2026-10-22T03:00:00Z; coverage not complete" },
    ];
    const f = fakeSql(() => rows);
    expect(await postgresReportStore(f.sql).limitations([JOB, "travis-a04-tcad-1"])).toEqual(rows);
    expect(f.log[0]?.text).toContain("FROM source_limitations WHERE job_id IN ?");
    expect(f.log[0]?.text).toContain("array_position");
  });

  it("running() returns the single running job or null, reading only (no transaction)", async () => {
    const job = { job_id: JOB, track: "tcad", mode: "pilot", started_at: "2026-10-22T01:00:00Z" };
    const f = fakeSql(() => [job]);
    expect(await postgresReportStore(f.sql).running()).toEqual(job);
    expect(f.log[0]?.text).toContain("WHERE status = 'running'");
    expect(await postgresReportStore(fakeSql().sql).running()).toBeNull();
    expect(f.log.some((l) => /BEGIN|INSERT|UPDATE|DELETE/.test(l.text))).toBe(false);
  });
});

describe("BackboneReport handlers", () => {
  const JOB = "travis-a04-202610220100";
  const roll: ReportSection = { key: "roll", build: async () => ({ n: 3 }) };
  const ctx = { run: async (_n: string, fn: () => Promise<unknown>) => fn() } as never;

  function service(f: ReturnType<typeof fakeSql>, sql = () => f.sql) {
    const def = createBackboneReport(restate, { sections: new Map([["roll", roll]]), sql });
    return (
      def as unknown as { service: Record<string, (c: unknown, r?: unknown) => Promise<unknown>> }
    ).service;
  }

  it("get builds the report through the journaled step", async () => {
    const f = fakeSql((text) => {
      if (text.includes("FROM backbone_runs WHERE job_id"))
        return [{ as_of: "2026-10-22", code_sha: "abc" }];
      return [];
    });
    expect(await service(f).get!(ctx, { jobId: JOB })).toMatchObject({
      job_id: JOB,
      roll: { n: 3 },
      limitations: [],
    });
  });

  it("get refuses a request without a valid job id as a terminal error", async () => {
    const f = fakeSql();
    await expect(service(f).get!(ctx, { jobId: "x" })).rejects.toBeInstanceOf(
      restate.TerminalError,
    );
    expect(f.log).toEqual([]);
  });

  it("get turns an unknown job into a terminal error (not retried)", async () => {
    await expect(service(fakeSql()).get!(ctx, { jobId: JOB })).rejects.toBeInstanceOf(
      restate.TerminalError,
    );
  });

  it("get re-throws a database error as retryable (not terminal)", async () => {
    const f = fakeSql(() => {
      throw new Error("connection reset");
    });
    const err = await service(f).get!(ctx, { jobId: JOB }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(restate.TerminalError);
  });

  it("a missing DATABASE_URL is a terminal configuration error for get and running", async () => {
    const missing = () => lazyQueryDb({})();
    const svc = service(fakeSql(), missing);
    await expect(svc.get!(ctx, { jobId: JOB })).rejects.toBeInstanceOf(restate.TerminalError);
    await expect(svc.running!(ctx)).rejects.toThrow(/DATABASE_URL is not set/);
  });

  it("running answers the running job, and another connect error stays retryable", async () => {
    const job = { job_id: JOB, track: "tcad", mode: "pilot", started_at: "2026-10-22T01:00:00Z" };
    expect(await service(fakeSql(() => [job])).running!(ctx)).toEqual(job);
    const broken = () => {
      throw new Error("pool exhausted");
    };
    const err = await service(fakeSql(), broken).running!(ctx).catch((e: unknown) => e);
    expect(err).not.toBeInstanceOf(restate.TerminalError);
  });
});

describe("postgresMigrationStore", () => {
  const file: MigrationFile = {
    name: "0001_x.sql",
    sql: "CREATE TABLE x (id int)",
    sha256: "b".repeat(64),
  };

  it("creates the schema_migrations table with a sha256 check, and reads applied checksums", async () => {
    const f = fakeSql((text) =>
      text.includes("FROM schema_migrations")
        ? [{ name: "0000_core.sql", sha256: "a".repeat(64) }]
        : [],
    );
    const store = postgresMigrationStore(f.sql);
    await store.ensureTable();
    expect(f.log[0]?.text).toMatch(
      /CREATE TABLE IF NOT EXISTS schema_migrations .*sha256 text NOT NULL CHECK/,
    );
    expect(await store.applied()).toEqual(new Map([["0000_core.sql", "a".repeat(64)]]));
  });

  it("apply takes the advisory lock, runs the file and records it in one transaction", async () => {
    const f = fakeSql();
    await postgresMigrationStore(f.sql).apply(file);
    const texts = f.log.map((l) => l.text);
    expect(texts[0]).toBe("BEGIN");
    expect(texts[1]).toContain("pg_advisory_xact_lock");
    expect(texts).toContain("CREATE TABLE x (id int)");
    const insert = f.log.find((l) => l.text.startsWith("INSERT INTO schema_migrations"));
    expect(insert?.values).toEqual([file.name, file.sha256]);
    expect(texts.at(-1)).toBe("COMMIT");
  });

  it("apply is a no-op when a concurrent run already recorded the same checksum", async () => {
    const f = fakeSql((text) =>
      text.startsWith("SELECT sha256 FROM schema_migrations") ? [{ sha256: file.sha256 }] : [],
    );
    await postgresMigrationStore(f.sql).apply(file);
    expect(f.log.some((l) => l.text === file.sql || l.text.startsWith("INSERT"))).toBe(false);
  });

  it("apply rolls back and refuses when the recorded checksum differs", async () => {
    const f = fakeSql((text) =>
      text.startsWith("SELECT sha256 FROM schema_migrations") ? [{ sha256: "c".repeat(64) }] : [],
    );
    await expect(postgresMigrationStore(f.sql).apply(file)).rejects.toThrow(
      /sha256 changed since it was applied/,
    );
    expect(f.log.at(-1)?.text).toBe("ROLLBACK");
    expect(f.log.some((l) => l.text === file.sql)).toBe(false);
  });

  it("migrate over the Postgres store skips an applied file and applies only the new one, in order", async () => {
    const applied = [{ name: "0000_core.sql", sha256: "a".repeat(64) }];
    const f = fakeSql((text) => {
      if (text.startsWith("SELECT name, sha256")) return applied;
      return [];
    });
    const files: MigrationFile[] = [
      file,
      { name: "0000_core.sql", sql: "SELECT 1", sha256: "a".repeat(64) },
    ];
    expect(await migrate(postgresMigrationStore(f.sql), files)).toEqual({
      applied: ["0001_x.sql"],
      skipped: ["0000_core.sql"],
    });
  });
});

describe("configured connection", () => {
  const URL_SECRET = "postgres://user:s3cret-pass@db.internal:5432/qdb";

  it("opens no connection at import or when the lazy accessor is only created", () => {
    lazyQueryDb({ DATABASE_URL: URL_SECRET });
    expect(h.factory).not.toHaveBeenCalled();
  });

  it("lazyQueryDb: an unset or blank DATABASE_URL is a QueryDbConfigError and opens nothing", () => {
    for (const env of [{}, { DATABASE_URL: "" }, { DATABASE_URL: "   " }]) {
      expect(() => lazyQueryDb(env)()).toThrowError(/DATABASE_URL is not set/);
    }
    expect(h.factory).not.toHaveBeenCalled();
  });

  it("lazyQueryDb opens one pool on first use and reuses it", () => {
    const pool = fakeSql().sql;
    h.factory.mockReturnValue(pool);
    const get = lazyQueryDb({ DATABASE_URL: URL_SECRET });
    expect(get()).toBe(pool);
    expect(get()).toBe(pool);
    expect(h.factory).toHaveBeenCalledTimes(1);
  });

  it("configuredSystemIdentifier refuses an unset DATABASE_URL without connecting", async () => {
    vi.stubEnv("DATABASE_URL", "");
    await expect(configuredSystemIdentifier()).rejects.toThrow("DATABASE_URL is not set");
    vi.unstubAllEnvs();
    expect(h.factory).not.toHaveBeenCalled();
  });

  it("configuredSystemIdentifier returns only the system identifier and closes the connection", async () => {
    vi.stubEnv("DATABASE_URL", URL_SECRET);
    const f = fakeSql(() => [{ id: "7412345678901234567" }]);
    h.factory.mockReturnValue(f.sql);
    expect(await configuredSystemIdentifier()).toBe("7412345678901234567");
    expect(f.log[0]?.text).toContain("pg_control_system()");
    expect(f.sql.end).toHaveBeenCalled();
    vi.unstubAllEnvs();
  });

  it("a query with no identifier row fails and still closes the connection", async () => {
    vi.stubEnv("DATABASE_URL", URL_SECRET);
    const f = fakeSql(() => []);
    h.factory.mockReturnValue(f.sql);
    // the inner message is reduced to the error code form by the catch
    await expect(configuredSystemIdentifier()).rejects.toThrow(
      /configured connection failed \(no code\)/,
    );
    expect(f.sql.end).toHaveBeenCalled();
    vi.unstubAllEnvs();
  });

  it("a connection error is reduced to its code: no URL, host or password leaks", async () => {
    vi.stubEnv("DATABASE_URL", URL_SECRET);
    const f = fakeSql(() => {
      throw Object.assign(new Error(`connect failed for ${URL_SECRET}`), { code: "ECONNREFUSED" });
    });
    h.factory.mockReturnValue(f.sql);
    const err = await configuredSystemIdentifier().catch((e: unknown) => e as Error);
    expect(err.message).toBe("configured connection failed (ECONNREFUSED)");
    expect(err.message).not.toMatch(/s3cret|db\.internal|postgres:\/\//);
    vi.unstubAllEnvs();
  });
});
