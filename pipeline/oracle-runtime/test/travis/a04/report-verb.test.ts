// A-04 (TC-048): the real `backbone report --job <id> [--json]` verb. Offline: the Restate ingress
// is a fake that answers BackboneReport/get with a synthetic, already redacted report.
import { describe, expect, it } from "vitest";
import { COMMANDS_DIR, runCli, type CliDeps } from "../../../travis/backbone/cli.js";
import type { RestateIngressClient } from "../../../travis/backbone/restate-client.js";

const JOB = "travis-a04-202610220304";
const SENTINEL = "SENTINEL OWNER NAME";

function harness() {
  const calls: Array<{ service: string; handler: string; body: unknown }> = [];
  const out: string[] = [];
  const err: string[] = [];
  const ingress: RestateIngressClient = {
    async call<T>(service: string, handler: string, body: unknown): Promise<T> {
      calls.push({ service, handler, body });
      return {
        job_id: JOB,
        as_of: "2026-10-22",
        code_sha: "abc123",
        roll: { parcels: 12, source_jobs: [JOB] },
        permits: { linked: 3 },
        limitations: ["gis: blocked at 2026-10-22T03:00:00Z; coverage not complete"],
        limitation_jobs: [{ job_id: JOB, text: "gis: blocked" }],
      } as T;
    },
    async send() {
      throw new Error("report is read-only");
    },
    async callLong<T>(): Promise<T> {
      return null as T;
    },
    async get() {
      throw new Error("report is read-only");
    },
  };
  const deps: CliDeps = {
    commandsDir: COMMANDS_DIR,
    ingress,
    now: () => new Date("2026-10-22T03:04:00Z"),
    env: {},
    freeBytes: () => 0, // a read-only verb must not hit the disk guard
    stdout: (s) => out.push(s),
    stderr: (s) => err.push(s),
  };
  return { deps, calls, out, err };
}

describe("A-04 backbone report verb", () => {
  it("--json prints only the BackboneReportV1 JSON on stdout (pipe-safe), job_id= on stderr", async () => {
    const h = harness();
    expect(await runCli(["report", "--job", JOB, "--json"], h.deps)).toBe(0);
    expect(h.calls).toEqual([{ service: "BackboneReport", handler: "get", body: { jobId: JOB } }]);
    expect(h.err.join("").trimEnd()).toBe(`job_id=${JOB}`);
    expect(h.out.join("")).not.toContain("job_id=travis");
    const parsed = JSON.parse(h.out.join("")) as { job_id: string; roll: unknown };
    expect(parsed.job_id).toBe(JOB);
    expect(parsed.roll).toEqual({ parcels: 12, source_jobs: [JOB] });
  });

  it("without --json prints a readable summary with the limitations and job_id= last", async () => {
    const h = harness();
    expect(await runCli(["report", "--job", JOB], h.deps)).toBe(0);
    const text = h.out.join("");
    expect(text).toContain("roll");
    expect(text).toContain("gis: blocked at");
    expect(text.trimEnd().split("\n").pop()).toBe(`job_id=${JOB}`);
  });

  it("requires --job", async () => {
    const h = harness();
    expect(await runCli(["report"], h.deps)).toBe(64);
    expect(h.calls).toEqual([]);
  });

  it("never prints an owner name, even if the service answer carried one under a non-key", async () => {
    const h = harness();
    h.deps.ingress.call = (async () => ({
      job_id: JOB,
      as_of: null,
      code_sha: null,
      limitations: [],
      limitation_jobs: [],
      roll: { owner_name: SENTINEL, mailing_line: SENTINEL, payload: SENTINEL, parcels: 1 },
    })) as RestateIngressClient["call"];
    await runCli(["report", "--job", JOB, "--json"], h.deps);
    await runCli(["report", "--job", JOB], h.deps);
    expect(h.out.join("") + h.err.join("")).not.toContain(SENTINEL);
  });
});
