// A-16 T032: the Restate ingress client used for the AustinPermits incremental step.
import { describe, expect, it } from "vitest";
import { createRestateRunner } from "../src/restate.js";
import { must } from "./support.js";

function response(status: number, body: unknown): Response {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
}

describe("createRestateRunner", () => {
  it("sends the workflow keyed by the command, polls while pending (470), returns the output", async () => {
    const seen: { url: string; method: string; body?: string }[] = [];
    const replies = [
      response(200, { invocationId: "inv_1" }),
      response(470, ""),
      response(470, ""),
      response(200, { status: "complete", exitCode: 0, rows: 5 }),
    ];
    const sleeps: number[] = [];
    const runner = createRestateRunner({
      ingressUrl: "http://localhost:8080/",
      fetch: async (url, init) => {
        seen.push({
          url,
          method: init.method ?? "GET",
          ...(typeof init.body === "string" ? { body: init.body } : {}),
        });
        return must(replies.shift());
      },
      sleep: async (ms) => void sleeps.push(ms),
    });
    const out = await runner.runIncremental(
      "travis-a04-permits-incremental-abc",
      "austin-3syk-w9eu-incremental-abc",
    );
    expect(out).toMatchObject({ status: "complete", exitCode: 0 });
    expect(seen[0]).toMatchObject({
      method: "POST",
      url: "http://localhost:8080/AustinPermits/austin-3syk-w9eu-incremental-abc/run/send",
    });
    expect(JSON.parse(must(must(seen[0]).body))).toEqual({
      jobId: "travis-a04-permits-incremental-abc",
      mode: "incremental",
    });
    expect(must(seen[1]).url).toBe(
      "http://localhost:8080/restate/workflow/AustinPermits/austin-3syk-w9eu-incremental-abc/output",
    );
    expect(sleeps).toEqual([2000, 4000]);
  });

  it("re-sending the same key is fine: an already-running workflow just attaches", async () => {
    const replies = [
      response(200, { invocationId: "inv_1", status: "AlreadyExists" }),
      response(200, { status: "complete", exitCode: 0 }),
    ];
    const runner = createRestateRunner({
      ingressUrl: "http://localhost:8080",
      fetch: async () => must(replies.shift()),
      sleep: async () => {},
    });
    await expect(
      runner.runIncremental("travis-a04-permits-incremental-x", "k"),
    ).resolves.toMatchObject({ exitCode: 0 });
  });

  it("fails on a workflow error body and on a non-JSON output", async () => {
    const bad = createRestateRunner({
      ingressUrl: "http://x",
      fetch: async (url) =>
        url.endsWith("/send") ? response(200, {}) : response(500, { code: 500, message: "boom" }),
      sleep: async () => {},
    });
    await expect(bad.runIncremental("j", "k")).rejects.toThrow(/boom/);
    const odd = createRestateRunner({
      ingressUrl: "http://x",
      fetch: async (url) =>
        url.endsWith("/send") ? response(200, {}) : response(200, { nope: 1 }),
      sleep: async () => {},
    });
    await expect(odd.runIncremental("j", "k")).rejects.toThrow();
  });
});
