// A-04 T051: the AustinPermits Restate binding (services/workflows/austin-permits.ts). The page
// loop itself is covered in oracle-runtime; here the real binding runs over a fake journaled
// context with the page loop replaced by a probe, to prove the wiring: registration, the IO
// surface handed to the loop, the watermark read, input validation and failRunOnTerminal.
import * as restate from "@restatedev/restate-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FakeJournal } from "../../oracle-runtime/test/travis/a04/fake-restate-ctx.js";

const h = vi.hoisted(() => ({
  rows: [] as unknown[],
  queries: [] as string[],
  runAustin: undefined as
    undefined | ((io: unknown, input: unknown, deps: unknown) => Promise<unknown>),
}));

vi.mock("../services/loader.js", async (orig) => ({
  ...(await orig<object>()),
  lazyQueryDb: () => () =>
    (async (strings: TemplateStringsArray) => {
      h.queries.push(strings.join("?").replace(/\s+/g, " ").trim());
      return h.rows;
    }) as never,
}));
vi.mock("../../oracle-runtime/travis/permits/workflow.js", async (orig) => ({
  ...(await orig<object>()),
  runAustinPermits: (io: unknown, input: unknown, deps: unknown) => h.runAustin!(io, input, deps),
}));

import { createService } from "../services/workflows/austin-permits.js";

const JOB = "travis-a04-permits-pilot-202610220100";
const KEY = "austin-3syk-w9eu-pilot-202610220100";

type Def = {
  name: string;
  handlers: { run: (ctx: unknown, input: unknown) => Promise<unknown> };
  options: { inactivityTimeout: unknown; abortTimeout: unknown };
};

/** The SDK is only asked for workflow(); TerminalError is the real one. */
function build(): Def {
  const sdk = { workflow: (d: Def) => d, TerminalError: restate.TerminalError };
  return createService(sdk as unknown as typeof restate) as unknown as Def;
}

type IoProbe = {
  now(): Promise<Date>;
  sleep(ms: number): Promise<void>;
  run<T>(name: string, fn: () => Promise<T>): Promise<T>;
  merge(name: string, input: unknown): Promise<unknown>;
  fail(message: string): Error;
};

afterEach(() => {
  h.rows = [];
  h.queries = [];
  h.runAustin = undefined;
  vi.useRealTimers();
});

describe("AustinPermits binding", () => {
  it("registers the AustinPermits workflow with long step timeouts", () => {
    const def = build();
    expect(def.name).toBe("AustinPermits");
    expect(def.options).toEqual({
      inactivityTimeout: { minutes: 30 },
      abortTimeout: { minutes: 60 },
    });
  });

  it("hands the page loop a journaled IO: one run attempt, sleeps, Loader.merge calls, terminal fail", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.UTC(2026, 9, 22, 1, 0, 0));
    const journal = new FakeJournal();
    const calls: Array<[string, string, unknown]> = [];
    const ctx = journal.ctx(KEY, (target, method, request) => {
      calls.push([target, method, request]);
      return { rowsWritten: 3, skipped: false };
    });
    const runOpts: unknown[] = [];
    const baseRun = ctx.run.bind(ctx);
    ctx.run = ((name: string, fn: () => Promise<unknown>, opts?: unknown) => {
      runOpts.push(opts);
      return baseRun(name, fn);
    }) as typeof ctx.run;

    let seen: IoProbe | undefined;
    h.runAustin = async (io) => {
      seen = io as IoProbe;
      const now = await seen.now();
      const page = await seen.run("page-1", async () => ({ lastId: "a", rows: 2 }));
      await seen.sleep(1500);
      const merged = await seen.merge("merge-1", { page: 1 });
      return { now: now.toISOString(), page, merged };
    };

    const result = await build().handlers.run(ctx, { jobId: JOB, mode: "pilot" });
    expect(result).toEqual({
      now: "2026-10-22T01:00:00.000Z",
      page: { lastId: "a", rows: 2 },
      merged: { rowsWritten: 3, skipped: false },
    });
    // the page loop owns its 5 attempts: Restate gets exactly one
    expect(runOpts).toEqual([{ maxRetryAttempts: 1 }]);
    // every merge goes to the single writer, Loader/travis, on the permits track
    expect(calls).toEqual([["Loader/travis", "merge", { track: "permits", input: { page: 1 } }]]);
    expect(journal.ops.map((o) => o.kind)).toEqual(["date", "run", "sleep", "call"]);
    const failure = seen!.fail("source refused");
    expect(failure).toBeInstanceOf(restate.TerminalError);
    expect(failure.message).toBe("source refused");
  });

  it("passes the parsed-by-the-loop input through unchanged, with a source client and artifacts root", async () => {
    const journal = new FakeJournal();
    const ctx = journal.ctx(KEY, () => ({}));
    let got: { input: unknown; deps: Record<string, unknown> } | undefined;
    h.runAustin = async (_io, input, deps) => {
      got = { input, deps: deps as Record<string, unknown> };
      return { status: "complete" };
    };
    const input = { jobId: JOB, mode: "backfill", fresh: true };
    expect(await build().handlers.run(ctx, input)).toEqual({ status: "complete" });
    expect(got!.input).toBe(input);
    expect(typeof got!.deps.artifactsRoot).toBe("string");
    expect(typeof (got!.deps.client as { get?: unknown } | undefined)).toBe("object");
    expect(Array.isArray((got!.deps.limitations as () => unknown)())).toBe(true);
  });

  it("readWatermark returns the stored Austin watermark, or null when none or malformed", async () => {
    const journal = new FakeJournal();
    const ctx = journal.ctx(KEY, () => ({}));
    let deps: { readWatermark(): Promise<unknown> } | undefined;
    h.runAustin = async (_io, _input, d) => {
      deps = d as typeof deps;
      return {};
    };
    await build().handlers.run(ctx, { jobId: JOB, mode: "pilot" });
    h.rows = [];
    expect(await deps!.readWatermark()).toBeNull();
    h.rows = [{ value: { not: "a watermark" } }];
    expect(await deps!.readWatermark()).toBeNull();
    expect(
      h.queries.every((q) => q.startsWith("SELECT value FROM watermarks WHERE track = 'permits'")),
    ).toBe(true);
    expect(h.queries.length).toBe(2);
  });

  it("a terminal failure closes the run row through Loader.failRun, then rethrows the same error", async () => {
    const journal = new FakeJournal();
    const calls: Array<[string, string, unknown]> = [];
    const ctx = journal.ctx(KEY, (t, m, r) => {
      calls.push([t, m, r]);
      return { failed: true };
    });
    const boom = new restate.TerminalError("rows are not ordered by :id");
    h.runAustin = async () => {
      throw boom;
    };
    await expect(build().handlers.run(ctx, { jobId: JOB, mode: "pilot" })).rejects.toBe(boom);
    expect(calls).toEqual([["Loader/travis", "failRun", { jobId: JOB }]]);
  });

  it("a retryable error does not fail the run row (Restate retries the handler)", async () => {
    const journal = new FakeJournal();
    const calls: unknown[] = [];
    const ctx = journal.ctx(KEY, (...c) => {
      calls.push(c);
      return {};
    });
    h.runAustin = async () => {
      throw new Error("socket hang up");
    };
    await expect(build().handlers.run(ctx, { jobId: JOB, mode: "pilot" })).rejects.toThrow(
      "socket hang up",
    );
    expect(calls).toEqual([]);
  });

  it("a Zod validation error becomes a terminal invalid-input error and fails no row (no job id)", async () => {
    const journal = new FakeJournal();
    const calls: unknown[] = [];
    const ctx = journal.ctx(KEY, (...c) => {
      calls.push(c);
      return {};
    });
    h.runAustin = async () => {
      const err = new Error("jobId: bad");
      err.name = "ZodError";
      throw err;
    };
    const failure = build().handlers.run(ctx, { jobId: "nope", mode: "pilot" });
    await expect(failure).rejects.toBeInstanceOf(restate.TerminalError);
    await expect(failure).rejects.toThrow(/AustinPermits\.run: invalid input: jobId: bad/);
    expect(calls).toEqual([]);
  });
});
