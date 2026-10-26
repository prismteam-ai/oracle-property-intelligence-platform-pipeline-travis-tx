// A-04 F1: TcadBackbone / TcadChunk binding helpers (CR-5, CR-6, OR-m7, CR-2, CR-3, OR-M5) and
// the tcad track additions (0103 migration, MergeDataError). Fakes only; no Query DB.
import { readFileSync } from "node:fs";
import * as restate from "@restatedev/restate-sdk";
import { describe, expect, it } from "vitest";
import type postgres from "postgres";
import { PARCEL_COLUMNS } from "../services/tracks/tcad.js";
import {
  asTerminal,
  coordinateRows,
  queryDbHealthy,
  parcelIdsExistFor,
  resolveGeoIdsFor,
  runAsOf,
} from "../services/workflows/tcad-backbone.js";
import { createService as createChunkService } from "../services/workflows/tcad-chunk.js";
import { RunDataError } from "../../oracle-runtime/travis/backbone/errors.js";

const JOB = "travis-a04-20261022040000";

/** Tagged-template fake that records the SQL text and answers from a handler. */
function fake(answer: (text: string, values: unknown[]) => unknown) {
  const queries: string[] = [];
  const sql = ((strings: TemplateStringsArray | unknown[], ...values: unknown[]) => {
    if (!Array.isArray(strings) || !("raw" in strings)) return { helper: strings };
    const text = (strings as unknown as string[]).join("?").replace(/\s+/g, " ").trim();
    queries.push(text);
    const out = answer(text, values);
    if (out instanceof Error) return Promise.reject(out);
    return Promise.resolve(out);
  }) as unknown as postgres.Sql;
  return { sql, queries };
}
const pgError = (code: string) => Object.assign(new Error("pg"), { code });

describe("CR-5 the County group is stamped with the run's as_of", () => {
  it("reads backbone_runs.as_of for the job", async () => {
    const f = fake(() => [{ as_of: "2026-10-20" }]);
    expect(await runAsOf(f.sql, JOB)).toBe("2026-10-20");
    expect(f.queries[0]).toContain("FROM backbone_runs");
  });
  it("a run without as_of is a data error, never today's date", async () => {
    await expect(runAsOf(fake(() => [{ as_of: null }]).sql, JOB)).rejects.toBeInstanceOf(RunDataError);
    await expect(runAsOf(fake(() => []).sql, JOB)).rejects.toBeInstanceOf(RunDataError);
  });
});

describe("CR-6 empty id lists never reach SQL", () => {
  it("resolveGeoIds / parcelIdsExist with [] run no query", async () => {
    const f = fake(() => []);
    expect((await resolveGeoIdsFor(f.sql, [])).size).toBe(0);
    expect((await parcelIdsExistFor(f.sql, [])).size).toBe(0);
    expect(f.queries).toEqual([]);
  });
});

describe("OR-m7 only an unassembled-coordinates error falls back", () => {
  it("undefined table or column (42P01 / 42703) → unassembled", async () => {
    for (const code of ["42P01", "42703"]) {
      const r = await coordinateRows(
        fake((t) => (t.includes("coordinate_source") ? pgError(code) : [{ request_identifier: "1" }])).sql,
        JOB,
      );
      expect(r.assembled).toBe(false);
      expect(r.coords.get("1")?.source).toBe("none");
    }
  });
  it("any other database error propagates (no group full of 'none')", async () => {
    await expect(coordinateRows(fake(() => pgError("57P01")).sql, JOB)).rejects.toMatchObject({ code: "57P01" });
  });
});

describe("CR-3 deterministic errors become TerminalError", () => {
  it("RunDataError and ENOENT convert; a transient error does not", () => {
    expect(asTerminal(restate, new RunDataError("seed pIDs are not in the export"))).toBeInstanceOf(restate.TerminalError);
    expect(asTerminal(restate, Object.assign(new Error("x"), { code: "ENOENT" }))).toBeInstanceOf(restate.TerminalError);
    expect(asTerminal(restate, new Error("socket hang up"))).toBeNull();
    const t = new restate.TerminalError("already");
    expect(asTerminal(restate, t)).toBe(t);
  });
});

describe("OR-M5 TcadChunk stops below 5 GiB before it prepares", () => {
  it("throws a TerminalError 'disk below 5 GiB' from the journaled guard and never prepares", async () => {
    const def = createChunkService(restate, { freeBytes: () => 1024 ** 3 });
    const run = (def as unknown as { service: { run: (c: unknown, s: unknown) => Promise<unknown> } }).service.run;
    const names: string[] = [];
    const ctx = {
      run: async (name: string, fn: () => Promise<unknown>) => {
        names.push(name);
        return fn();
      },
    };
    const err = await run(ctx, { jobId: JOB, n: 0, inputPath: "/nope/x", inputSha256: "a".repeat(64), mappedPath: "/nope/y" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(restate.TerminalError);
    expect((err as Error).message).toBe("disk below 5 GiB");
    expect(names).toEqual(["disk-before-prepare-c0"]);
  });
});

describe("0103 migration and the tcad track", () => {
  const sql = readFileSync(new URL("../migrations/0103_parcel_type_rules_version.sql", import.meta.url), "utf8").replace(/\s+/g, " ");
  it("adds property_type_rules_version as a new migration and the track writes it", () => {
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS property_type_rules_version text");
    expect(PARCEL_COLUMNS).toContain("property_type_rules_version");
  });
});

describe("health probe for the batched run", () => {
  const answering = (impl: () => Promise<unknown>) =>
    (() => (() => impl()) as unknown as postgres.Sql) as () => postgres.Sql;
  it("true when select 1 answers", async () => {
    expect(await queryDbHealthy(answering(async () => [{ ok: 1 }]))).toBe(true);
  });
  it("false when the connection fails or the config is missing", async () => {
    expect(await queryDbHealthy(answering(async () => Promise.reject(new Error("ECONNREFUSED"))))).toBe(false);
    expect(
      await queryDbHealthy(() => {
        throw new Error("DATABASE_URL is not set");
      }),
    ).toBe(false);
  });
  it("false when the database does not answer within the timeout", async () => {
    expect(await queryDbHealthy(answering(() => new Promise(() => {})), 20)).toBe(false);
  });
});
