// A-04 F1 (OR-M1, CR-7): a deterministic Loader failure must end the merge (TerminalError), a
// transient one is retried only a bounded number of times, and a failed run is closed by a
// direct bounded UPDATE that does not queue behind the exclusive Loader key.
import * as restate from "@restatedev/restate-sdk";
import { describe, expect, it } from "vitest";
import type postgres from "postgres";
import { z } from "zod";
import {
  LoaderInputBase,
  MergeDataError,
  createLoader,
  failRunOnTerminal,
  type LoaderTrack,
} from "../services/loader.js";

const JOB = "travis-a04-202610220100";
const SHA = "b".repeat(64);

class PgError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly constraint_name?: string,
  ) {
    super(message);
  }
}

const fakeSql = {
  begin: async (fn: (tx: unknown) => Promise<unknown>) => {
    const tx = (async () => []) as unknown;
    return fn(tx);
  },
} as unknown as postgres.Sql;

function loaderWith(mergeError: unknown) {
  const track: LoaderTrack = {
    name: "tcad",
    input: LoaderInputBase as unknown as z.ZodType<z.infer<typeof LoaderInputBase>>,
    merge: async () => {
      throw mergeError;
    },
  };
  const def = createLoader(restate, { tracks: new Map([["tcad", track]]), sql: () => fakeSql });
  const handlers = (def as unknown as { object: Record<string, (c: unknown, r: unknown) => Promise<unknown>> }).object;
  const runOptions: unknown[] = [];
  const ctx = {
    key: "travis",
    run: async (_name: string, fn: () => Promise<unknown>, opts?: unknown) => {
      runOptions.push(opts);
      return fn();
    },
  };
  const call = () =>
    handlers.merge?.(ctx, {
      track: "tcad",
      input: { jobId: JOB, artifactPath: "x", artifactSha256: SHA },
    });
  return { call, runOptions };
}

describe("Loader.merge deterministic failures are terminal (OR-M1, CR-7)", () => {
  it("bounds the retries of the merge step", async () => {
    const h = loaderWith(new MergeDataError("x"));
    await h.call().catch(() => undefined);
    const opts = h.runOptions[0] as { maxRetryAttempts?: number };
    expect(opts.maxRetryAttempts).toBeGreaterThan(0);
    expect(opts.maxRetryAttempts).toBeLessThanOrEqual(10);
  });

  it("a CHECK violation (23514) becomes a TerminalError naming the SQLSTATE, not the row", async () => {
    const h = loaderWith(new PgError('new row for relation "parcels" violates check constraint, Failing row contains (secret)', "23514", "parcels_x_check"));
    const err = await h.call().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(restate.TerminalError);
    expect((err as Error).message).toContain("23514");
    expect((err as Error).message).not.toContain("secret");
  });

  it("the FR-025 unique index violation (23505) is a clear refusal", async () => {
    const h = loaderWith(new PgError("duplicate key", "23505", "backbone_runs_one_ingest_running"));
    const err = await h.call().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(restate.TerminalError);
    expect((err as Error).message).toMatch(/another ingest run is already running/);
  });

  it.each(["22P02", "42703"])("SQLSTATE %s is terminal", async (code) => {
    const err = await loaderWith(new PgError("bad", code)).call().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(restate.TerminalError);
  });

  it("a sha mismatch (MergeDataError) and a zod error are terminal", async () => {
    for (const e of [new MergeDataError("chunk sha256 differs"), new z.ZodError([])]) {
      const err = await loaderWith(e).call().catch((x: unknown) => x);
      expect(err).toBeInstanceOf(restate.TerminalError);
    }
  });

  it("a transient connection error stays retryable (not terminal)", async () => {
    const err = await loaderWith(new PgError("connection terminated", "57P01")).call().catch((e: unknown) => e);
    expect(err).not.toBeInstanceOf(restate.TerminalError);
    const err2 = await loaderWith(Object.assign(new Error("reset"), { code: "ECONNRESET" })).call().catch((e: unknown) => e);
    expect(err2).not.toBeInstanceOf(restate.TerminalError);
  });
});

describe("failRunOnTerminal with a direct bounded UPDATE", () => {
  it("closes the run through ctx.run without calling the exclusive Loader", async () => {
    const queries: string[] = [];
    const sql = (async (strings: TemplateStringsArray) => {
      queries.push(strings.join("?").replace(/\s+/g, " ").trim());
      return [{ job_id: JOB }];
    }) as unknown as postgres.Sql;
    const runs: Array<{ name: string; opts: unknown }> = [];
    let loaderCalls = 0;
    const ctx = {
      run: async (name: string, fn: () => Promise<unknown>, opts?: unknown) => {
        runs.push({ name, opts });
        return fn();
      },
      objectClient: () => ({
        failRun: async () => {
          loaderCalls += 1;
          return { failed: true };
        },
      }),
    } as never;
    const boom = new restate.TerminalError("merge refused");
    await expect(
      failRunOnTerminal(restate, ctx, JOB, async () => { throw boom; }, () => sql),
    ).rejects.toBe(boom);
    expect(loaderCalls).toBe(0);
    expect(queries[0]).toContain("UPDATE backbone_runs SET status = 'failed'");
    expect(runs[0]?.name).toContain("fail-run");
    expect((runs[0]?.opts as { maxRetryAttempts?: number }).maxRetryAttempts).toBeGreaterThan(0);
  });

  it("still rethrows the original error when the direct UPDATE itself fails", async () => {
    const ctx = {
      run: async () => {
        throw new restate.TerminalError("db down");
      },
    } as never;
    const boom = new restate.TerminalError("original");
    await expect(
      failRunOnTerminal(restate, ctx, JOB, async () => { throw boom; }, () => ({}) as postgres.Sql),
    ).rejects.toBe(boom);
  });
});

describe("a TerminalError thrown by track.merge (permits guards) stays terminal", () => {
  it("is not wrapped or retried, so failRunOnTerminal closes the run", async () => {
    const guard = new restate.TerminalError("refusing to tombstone: implausible key set");
    const err = await loaderWith(guard).call().catch((e: unknown) => e);
    expect(err).toBe(guard);
  });
});
