// A-04 (G-FIX): a workflow that fails must not leave its backbone_runs row `running` (it would
// hold the FR-025 unique index for every later run). The Loader is the single writer: it exposes
// failRun, and the workflows call it through failRunOnTerminal when the handler throws a
// terminal error. waiting_human and blocked are results, not throws, and keep their statuses.
import * as restate from "@restatedev/restate-sdk";
import { describe, expect, it } from "vitest";
import type postgres from "postgres";
import { createLoader, failRun, failRunOnTerminal } from "../services/loader.js";

function fakeSql(rows: Array<{ job_id: string; status: string; finished_at: string | null }>) {
  const queries: string[] = [];
  const sql = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("?").replace(/\s+/g, " ").trim();
    queries.push(text);
    if (!text.startsWith("UPDATE backbone_runs SET status = 'failed', finished_at = now()")) {
      throw new Error(`fake db: unexpected query ${text}`);
    }
    const hit = rows.filter((r) => r.job_id === values[0] && r.status === "running");
    for (const r of hit) {
      r.status = "failed";
      r.finished_at = "2026-10-22T00:00:00Z";
    }
    return hit.map((r) => ({ job_id: r.job_id }));
  }) as unknown as postgres.Sql;
  return { sql, queries };
}

const JOB = "travis-a04-permits-pilot-202610220100";

describe("Loader failRun", () => {
  it("marks a running row failed with finished_at", async () => {
    const rows = [{ job_id: JOB, status: "running", finished_at: null }];
    const { sql } = fakeSql(rows);
    expect(await failRun(sql, JOB)).toEqual({ failed: true });
    expect(rows[0]).toMatchObject({ status: "failed", finished_at: expect.any(String) });
  });

  it.each(["waiting_human", "blocked", "complete"])("leaves a %s row alone", async (status) => {
    const rows = [{ job_id: JOB, status, finished_at: null }];
    const { sql } = fakeSql(rows);
    expect(await failRun(sql, JOB)).toEqual({ failed: false });
    expect(rows[0]?.status).toBe(status);
  });

  it("the Loader object has a failRun handler", () => {
    const def = createLoader(restate, { tracks: new Map(), sql: () => fakeSql([]).sql });
    expect(
      Object.keys((def as unknown as { object: Record<string, unknown> }).object ?? {}),
    ).toContain("failRun");
  });
});

describe("failRunOnTerminal", () => {
  const ctxWith = (calls: unknown[]) =>
    ({
      objectClient: () => ({
        failRun: async (body: unknown) => {
          calls.push(body);
          return { failed: true };
        },
      }),
    }) as never;

  it("on a TerminalError calls Loader.failRun once and rethrows the same error", async () => {
    const calls: unknown[] = [];
    const boom = new restate.TerminalError("rows are not ordered by :id");
    await expect(
      failRunOnTerminal(restate, ctxWith(calls), JOB, async () => {
        throw boom;
      }),
    ).rejects.toBe(boom);
    expect(calls).toEqual([{ jobId: JOB }]);
  });

  it("a non-terminal error (Restate retries it) does not fail the run", async () => {
    const calls: unknown[] = [];
    await expect(
      failRunOnTerminal(restate, ctxWith(calls), JOB, async () => {
        throw new Error("transient");
      }),
    ).rejects.toThrow("transient");
    expect(calls).toEqual([]);
  });

  it("a result (even waiting_human or blocked) passes through without failRun", async () => {
    const calls: unknown[] = [];
    const result = { status: "waiting_human" };
    expect(await failRunOnTerminal(restate, ctxWith(calls), JOB, async () => result)).toBe(result);
    expect(calls).toEqual([]);
  });

  it("a null job id (invalid input) just rethrows", async () => {
    const calls: unknown[] = [];
    await expect(
      failRunOnTerminal(restate, ctxWith(calls), null, async () => {
        throw new restate.TerminalError("bad input");
      }),
    ).rejects.toThrow("bad input");
    expect(calls).toEqual([]);
  });
});
