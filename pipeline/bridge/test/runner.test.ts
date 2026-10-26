// A-16 T032: the runner reuses the gated Run 3 path, in order, with a fake process runner.
import { describe, expect, it } from "vitest";
import {
  PUBLISH_STEP_ORDER,
  createRunner,
  runIdFor,
  type ExecSpec,
  type Files,
  type RunnerConfig,
} from "../src/runner.js";
import { LiveStatus } from "../src/live.js";
import { StopFlag } from "../src/stop.js";
import { T0, command, must } from "./support.js";

const REPO = "/repo";
const INDEX = JSON.stringify({
  schema: "oracle-travis-runs-index.v1",
  runs: [
    {
      runId: "travis-full-run1-20261023",
      manifestCid: "bafkreiddef7ssybq6m4wpmah7adposaxbiawaxcmqndzk36wyhd7k4h6gu",
      finishedAt: "2026-10-23T15:41:00.000Z",
    },
    {
      runId: "travis-full-run2-20261024",
      manifestCid: "bafkreife3vk3cgcod3v6tue2xes3hvl2vndqoshbhrhsnjtriskihpcute",
      finishedAt: "2026-10-24T18:20:49Z",
    },
  ],
});

function memoryFiles(
  extra: Record<string, string> = {},
): Files & { written: Record<string, string> } {
  const store: Record<string, string> = {
    [`${REPO}/runs/index.json`]: INDEX,
    [`${REPO}/specs/011-publish-and-runs/run1-permit-pids.txt`]: "p1\np2\n",
    ...extra,
  };
  const written: Record<string, string> = {};
  return {
    written,
    readText: (p) => store[p],
    writeText: (p, t) => {
      store[p] = t;
      written[p] = t;
    },
    exists: (p) => p in store,
  };
}

const config: RunnerConfig = {
  repoRoot: REPO,
  bridgeDir: `${REPO}/pipeline/data/bridge`,
  countyDir: "/data/county-batched",
  permitsSeedJob: "travis-a11-permits-run3-20261025",
  dataRunsDir: `${REPO}/pipeline/data/runs`,
  run1PidsFile: `${REPO}/specs/011-publish-and-runs/run1-permit-pids.txt`,
};

interface Harness {
  calls: ExecSpec[];
  steps: string[];
  runner: ReturnType<typeof createRunner>;
  stop: StopFlag;
  live: LiveStatus;
  files: ReturnType<typeof memoryFiles>;
  restateCalls: { jobId: string; key: string }[];
}

function harness(
  over: {
    failOn?: (spec: ExecSpec, n: number) => number;
    restate?: { status: string; exitCode: number };
    onExec?: (spec: ExecSpec, n: number) => void;
    config?: Partial<RunnerConfig>;
  } = {},
): Harness {
  const calls: ExecSpec[] = [];
  const steps: string[] = [];
  const restateCalls: { jobId: string; key: string }[] = [];
  const stop = new StopFlag();
  const live = new LiveStatus({ put: async () => {}, now: () => new Date(T0) });
  const files = memoryFiles({
    // the facts step "writes" this; the runner reads it to build the pid union
    [`${REPO}/pipeline/data/bridge/work/ID/affected-pids.txt`]: "p2\np3\n",
  });
  const runner = createRunner({
    config: { ...config, ...over.config },
    exec: async (spec) => {
      calls.push(spec);
      over.onExec?.(spec, calls.length);
      return over.failOn?.(spec, calls.length) ?? 0;
    },
    restate: {
      runIncremental: async (jobId, key) => {
        restateCalls.push({ jobId, key });
        return over.restate ?? { status: "complete", exitCode: 0 };
      },
    },
    files,
    now: () => new Date(T0),
    live,
    stop,
    log: () => {},
    onStep: (name) => void steps.push(name),
  });
  return { calls, steps, runner, stop, live, files, restateCalls };
}

const cmdLine = (s: ExecSpec): string => [s.cmd, ...s.args].join(" ");

describe("runIdFor", () => {
  it("names real and dry runs differently, lowercase slug", () => {
    const c = command({ commandId: "12345678-1234-4234-8234-123456789012", mode: "publish" });
    expect(runIdFor(c, new Date(T0))).toBe("travis-incr-20261026-12345678");
    expect(runIdFor({ ...c, mode: "dry_run" }, new Date(T0))).toBe(
      "travis-dryrun-20261026-12345678",
    );
  });
});

describe("runner (dry_run)", () => {
  it("runs the local steps in order, then publish-run --dry-run (gate real), never an upload", async () => {
    const c = command({ mode: "dry_run", commandId: "12345678-1234-4234-8234-123456789012" });
    const h = harness();
    // affected-pids file path uses the run id; seed it for this command
    h.files.writeText(
      `${REPO}/pipeline/data/bridge/work/${runIdFor(c, new Date(T0))}/affected-pids.txt`,
      "p2\np3\n",
    );
    const out = await h.runner(c);
    expect(out).toEqual({ outcome: "succeeded", runId: "travis-dryrun-20261026-12345678" });
    expect(h.steps).toEqual([
      "preflight",
      "capture-merge",
      "pre-link-facts",
      "link",
      "final-facts",
      "reexport",
      "batches",
      "manifest",
      "publish-dry-run",
    ]);
    // Restate: keyed by the command ID, job id valid for the workflow
    expect(h.restateCalls).toHaveLength(1);
    expect(must(h.restateCalls[0]).jobId).toMatch(/^travis-a04-permits-incremental-[a-z0-9]+$/);
    expect(must(h.restateCalls[0]).key).toBe(
      `austin-3syk-w9eu-${must(h.restateCalls[0]).jobId.replace("travis-a04-permits-", "")}`,
    );
    expect(must(h.restateCalls[0]).jobId).toBe("travis-a04-permits-incremental-2026102612345678");

    const publish = h.calls.filter((s) => cmdLine(s).includes("publish-run.ts"));
    expect(publish).toHaveLength(1);
    const line = cmdLine(must(publish[0]));
    expect(line).toContain("--dry-run");
    expect(line).toContain("--manifest runs/travis-dryrun-20261026-12345678/manifest.json");
    expect(line).toContain("--run-id travis-dryrun-20261026-12345678");
    expect(line).not.toContain("--step"); // all steps are planned, so the gate step runs
    expect(line).not.toContain("--skip");
    expect(line).not.toContain("--force");
    // never calls an upload or side script
    for (const s of h.calls) expect(cmdLine(s)).not.toMatch(/upload|pinata|cid-copy-run1|side/);
  });

  it("builds the manifest with the previous run as base and the facts from the same run", async () => {
    const c = command({ mode: "dry_run", commandId: "12345678-1234-4234-8234-123456789012" });
    const h = harness();
    h.files.writeText(
      `${REPO}/pipeline/data/bridge/work/${runIdFor(c, new Date(T0))}/affected-pids.txt`,
      "p2\np3\n",
    );
    await h.runner(c);
    const manifest = must(h.calls.map(cmdLine).find((l) => l.includes("build-run-manifest.ts")));
    expect(manifest).toContain("--base runs/travis-full-run2-20261024/manifest.json");
    expect(manifest).toContain(
      "--previous-manifest-cid bafkreife3vk3cgcod3v6tue2xes3hvl2vndqoshbhrhsnjtriskihpcute",
    );
    expect(manifest).toContain("--county-dir /data/county-batched");
    expect(manifest).toMatch(/--austin-facts \S+austin-facts\.json/);
    expect(manifest).toMatch(/--austin-receipt \S+austin-receipt\.json/);
    expect(manifest).toContain("--started-at 2026-10-26T10:00:00.000Z");
    // the pid union (Run 1 list + affected) was written once, de-duplicated and sorted
    const union = must(
      must(Object.entries(h.files.written).find(([p]) => p.endsWith("run-pids.txt")))[1],
    );
    expect(union).toBe("p1\np2\np3\n");
  });
});

describe("runner (publish)", () => {
  it("runs each publish-run step on its own, in order, so Stop can land between them", async () => {
    const c = command({ mode: "publish", commandId: "12345678-1234-4234-8234-123456789012" });
    const h = harness();
    h.files.writeText(
      `${REPO}/pipeline/data/bridge/work/${runIdFor(c, new Date(T0))}/affected-pids.txt`,
      "p2\np3\n",
    );
    const out = await h.runner(c);
    expect(out.outcome).toBe("succeeded");
    const stepsRun = h.calls
      .map(cmdLine)
      .filter((l) => l.includes("publish-run.ts"))
      .map((l) => must(must(/--step (\S+)/.exec(l))[1]));
    expect(stepsRun).toEqual([...PUBLISH_STEP_ORDER]);
    expect(PUBLISH_STEP_ORDER).toEqual([
      "gate",
      "filebase",
      "car-files",
      "manifest",
      "cid-copy",
      "gate-remote",
      "release",
      "index",
    ]);
    for (const l of h.calls.map(cmdLine).filter((x) => x.includes("publish-run.ts")))
      expect(l).not.toContain("--dry-run");
  });

  it("passes the release reuse tags and target to the release step only (as Run 4's p9-publish.sh)", async () => {
    const c = command({ mode: "publish", commandId: "12345678-1234-4234-8234-123456789012" });
    const h = harness({
      config: {
        releaseReuseTags: ["run-travis-full-run4-20261026", "run-travis-full-run3-1-20261025"],
        releaseTarget: "feature/oracle-pipeline",
      },
    });
    h.files.writeText(
      `${REPO}/pipeline/data/bridge/work/${runIdFor(c, new Date(T0))}/affected-pids.txt`,
      "p2\n",
    );
    expect((await h.runner(c)).outcome).toBe("succeeded");
    const lines = h.calls.map(cmdLine).filter((l) => l.includes("publish-run.ts"));
    const release = must(lines.find((l) => l.includes("--step release")));
    expect(release).toContain("--release-reuse-tag run-travis-full-run4-20261026");
    expect(release).toContain("--release-reuse-tag run-travis-full-run3-1-20261025");
    expect(release).toContain("--release-target feature/oracle-pipeline");
    for (const l of lines.filter((x) => !x.includes("--step release")))
      expect(l).not.toContain("--release-");
  });

  it("builds and uploads the Explore index right after the CID copy, before the run is listed (review M1)", async () => {
    const c = command({ mode: "publish", commandId: "12345678-1234-4234-8234-123456789012" });
    const h = harness();
    h.files.writeText(
      `${REPO}/pipeline/data/bridge/work/${runIdFor(c, new Date(T0))}/affected-pids.txt`,
      "p2\n",
    );
    expect((await h.runner(c)).outcome).toBe("succeeded");
    const lines = h.calls.map(cmdLine);
    const at = (needle: string): number => lines.findIndex((l) => l.includes(needle));
    const index = at("build-explore-index.ts");
    expect(index).toBeGreaterThan(at("--step cid-copy"));
    expect(index).toBeLessThan(at("--step index"));
    expect(lines[index]).toContain("--source cidcopy");
    expect(lines[index]).toContain("--verify");
  });

  it("fails closed when the command's base run is not in runs/index.json (finding 6)", async () => {
    const c = command({
      mode: "publish",
      commandId: "12345678-1234-4234-8234-123456789012",
      window: { kind: "austin_permits_since_watermark", sinceRunId: "travis-full-run9-20991231" },
    });
    const out = await harness().runner(c);
    expect(out.outcome).toBe("failed");
    expect(out.outcome === "failed" ? out.reason : "").toMatch(
      /travis-full-run9-20991231 is not in runs\/index.json/,
    );
  });

  it("stops between atomic steps and never starts the index step after a stop", async () => {
    const c = command({ mode: "publish", commandId: "12345678-1234-4234-8234-123456789012" });
    const h = harness({
      onExec: (spec, n) => {
        // the admin presses Stop while the car-files step is executing
        if (cmdLine(spec).includes("--step car-files")) h.stop.request();
        void n;
      },
    });
    h.files.writeText(
      `${REPO}/pipeline/data/bridge/work/${runIdFor(c, new Date(T0))}/affected-pids.txt`,
      "p2\np3\n",
    );
    const out = await h.runner(c);
    expect(out.outcome).toBe("stopped");
    const lines = h.calls.map(cmdLine);
    // the running step finished (it was called), the next one never started
    expect(lines.some((l) => l.includes("--step car-files"))).toBe(true);
    expect(lines.some((l) => l.includes("--step manifest"))).toBe(false);
    expect(lines.some((l) => l.includes("--step index"))).toBe(false);
  });

  it("stops before the first step when a stop is already requested", async () => {
    const h = harness();
    h.stop.request();
    const out = await h.runner(command({ mode: "publish" }));
    expect(out.outcome).toBe("stopped");
    expect(h.calls).toHaveLength(0);
  });
});

describe("retry resumes the run it names", () => {
  it("skips the finished steps (no second capture, no second pre-link facts) and finishes the rest", async () => {
    const c = command({ mode: "dry_run", commandId: "12345678-1234-4234-8234-123456789012" });
    const runId = runIdFor(c, new Date(T0));
    let breakBatches = true;
    const h = harness({
      failOn: (s) => (breakBatches && cmdLine(s).includes("batch-hash-validate-export") ? 3 : 0),
    });
    h.files.writeText(`${REPO}/pipeline/data/bridge/work/${runId}/affected-pids.txt`, "p2\n");
    const first = await h.runner(c);
    expect(first).toMatchObject({ outcome: "failed" });
    expect(h.restateCalls).toHaveLength(1);

    breakBatches = false;
    h.calls.length = 0;
    const retry = command({
      action: "retry",
      window: null,
      targetRunId: runId,
      mode: "dry_run",
    });
    const second = await h.runner(retry);
    expect(second).toEqual({ outcome: "succeeded", runId });
    // the 35 minute capture and the link-order-sensitive steps did not run again
    expect(h.restateCalls).toHaveLength(1);
    const lines = h.calls.map(cmdLine);
    expect(lines.some((l) => l.includes("pre-link"))).toBe(false);
    expect(lines.some((l) => l.includes("permits --link"))).toBe(false);
    expect(lines.some((l) => l.includes("scripts/reexport-permits.ts"))).toBe(false);
    // the failed step and everything after it ran
    expect(lines.some((l) => l.includes("batch-hash-validate-export"))).toBe(true);
    expect(lines.some((l) => l.includes("build-run-manifest.ts"))).toBe(true);
    expect(lines.some((l) => l.includes("publish-run.ts") && l.includes("--dry-run"))).toBe(true);
    // the manifest keeps the original start time
    expect(lines.find((l) => l.includes("build-run-manifest.ts"))).toContain(
      "--started-at 2026-10-26T10:00:00.000Z",
    );
  });

  it("refuses a retry that names no bridge run, or one of the other mode", async () => {
    const h = harness();
    const bad = await h.runner(
      command({
        action: "retry",
        window: null,
        targetRunId: "travis-full-run2-20261024",
        mode: "dry_run",
      }),
    );
    expect(bad).toMatchObject({ outcome: "failed", runId: null });
    expect((bad as { reason: string }).reason).toMatch(/not a dry_run run the bridge started/);
    const wrongMode = await h.runner(
      command({
        action: "retry",
        window: null,
        targetRunId: "travis-dryrun-20261026-12345678",
        mode: "publish",
      }),
    );
    expect(wrongMode).toMatchObject({ outcome: "failed" });
    expect(h.calls).toHaveLength(0);
    expect(h.restateCalls).toHaveLength(0);
  });
});

describe("runner failures", () => {
  it("fails with the step name and exit code, and stops there", async () => {
    const c = command({ mode: "dry_run", commandId: "12345678-1234-4234-8234-123456789012" });
    const h = harness({
      failOn: (s) => (cmdLine(s).includes("batch-hash-validate-export") ? 3 : 0),
    });
    h.files.writeText(
      `${REPO}/pipeline/data/bridge/work/${runIdFor(c, new Date(T0))}/affected-pids.txt`,
      "p2\n",
    );
    const out = await h.runner(c);
    expect(out).toMatchObject({ outcome: "failed" });
    expect((out as { reason: string }).reason).toMatch(/batches.*exit(ed)? 3/);
    expect(h.calls.map(cmdLine).some((l) => l.includes("build-run-manifest"))).toBe(false);
  });

  it("treats a blocked source (Restate exit 2) as failed and says never retry", async () => {
    const h = harness({ restate: { status: "waiting_human", exitCode: 2 } });
    const out = await h.runner(command({ mode: "dry_run" }));
    expect(out).toMatchObject({ outcome: "failed" });
    expect((out as { reason: string }).reason).toMatch(/blocked/i);
    expect(h.calls).toHaveLength(0);
  });

  it("fails preflight with a clear reason when the county dir is not configured", async () => {
    const h = harness({ config: { countyDir: undefined } });
    const out = await h.runner(command({ mode: "dry_run" }));
    expect(out).toMatchObject({ outcome: "failed" });
    expect((out as { reason: string }).reason).toMatch(/BRIDGE_COUNTY_DIR/);
    expect(h.restateCalls).toHaveLength(0);
  });

  it("never throws: an exec rejection becomes a failed outcome", async () => {
    const stop = new StopFlag();
    const runner = createRunner({
      config,
      exec: async () => {
        throw new Error("spawn ENOENT");
      },
      restate: { runIncremental: async () => ({ status: "complete", exitCode: 0 }) },
      files: memoryFiles(),
      now: () => new Date(T0),
      live: new LiveStatus({ put: async () => {}, now: () => new Date(T0) }),
      stop,
      log: () => {},
    });
    const out = await runner(command({ mode: "dry_run" }));
    expect(out).toMatchObject({ outcome: "failed" });
  });
});
