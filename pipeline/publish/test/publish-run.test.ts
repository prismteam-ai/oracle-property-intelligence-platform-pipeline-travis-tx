// A-11: the resumable publish driver, with every effect injected (no network, no real upload):
// resume skips finished work, a receipt whose root differs from the manifest fails, the index
// never gets a duplicate entry, a pilot has no Release or index, a dry run makes no call, and
// the step implementations behave as documented against fakes.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { cidOfBytes } from "../src/cid.js";
import type { IdentityGateSummary } from "../src/identity-gate.js";
import { jcsBytes } from "../src/jcs.js";
import type { FetchLike } from "../src/kubo-add.js";
import { FILEBASE_GATEWAY } from "../src/sequence.js";
import {
  PUBLISH_STEPS,
  createPublishSteps,
  formatReport,
  gateReceiptPath,
  loadPublishContext,
  parsePublishArgs,
  releaseAssets,
  runPublish,
  uploadUnits,
  type GhClient,
  type GhRelease,
  type PlanItem,
  type PublishContext,
  type PublishDeps,
  type PublishStepName,
  type StepImpl,
  type StepImpls,
} from "../src/publish-run.js";
import { buildRunManifest, writeManifestBytes } from "../src/run-manifest.js";
import { appendRun, emptyRunsIndex, runsIndexBytes } from "../src/runs-index.js";
import {
  BASE_RUN_ID,
  NOT_YET_PUBLISHED,
  put,
  runFixture,
  type RunFixture,
} from "./support/run-fixture.js";

const RUN2 = "travis-full-run2-20261024";

async function realContext(
  opts: { pilot?: boolean; runId?: string } = {},
): Promise<{ f: RunFixture; ctx: PublishContext }> {
  const f = await runFixture();
  const runId = opts.runId ?? RUN2;
  const built = await buildRunManifest(
    {
      runId,
      startedAt: "2026-10-24T08:00:00.000Z",
      finishedAt: "2026-10-24T12:00:00.000Z",
      previousManifestCid: f.baseCid,
      countyDir: f.countyDir,
      permitsDir: f.permitsV2,
    },
    { repoRoot: f.root, workTreeStatus: NOT_YET_PUBLISHED, gitCommit: () => "abc1234" },
  );
  const path = opts.pilot
    ? join(f.root, "specs/011-publish-and-runs/pilot/manifest.json")
    : join(f.root, "runs", runId, "manifest.json");
  writeManifestBytes(path, built);
  // The published base run, as runs/index.json holds it.
  writeFileSync(
    join(f.root, "runs/index.json"),
    runsIndexBytes(
      appendRun(emptyRunsIndex(), {
        runId: BASE_RUN_ID,
        manifestCid: f.baseCid,
        finishedAt: "2026-10-23T15:41:00.000Z",
      }),
    ),
  );
  const ctx = await loadPublishContext({
    repoRoot: f.root,
    manifestPath: path,
    runId,
    pilot: opts.pilot === true,
  });
  return { f, ctx };
}

// ---------------------------------------------------------------------------------------------
// The driver, over fake steps

function fakeImpls(state: Record<PublishStepName, { done: boolean; fail?: boolean }>): {
  impls: StepImpls;
  executed: PublishStepName[];
  planned: { step: PublishStepName; probe: boolean }[];
  skipped: PublishStepName[];
} {
  const executed: PublishStepName[] = [];
  const planned: { step: PublishStepName; probe: boolean }[] = [];
  const skipped: PublishStepName[] = [];
  const impl = (step: PublishStepName): StepImpl => ({
    async plan(_ctx, { probe }): Promise<PlanItem[]> {
      planned.push({ step, probe });
      const s = state[step];
      return s.done
        ? [{ id: step, action: "skip", reason: "receipt", onSkip: () => skipped.push(step) }]
        : [{ id: step, action: "run", reason: "no receipt" }];
    },
    async execute() {
      executed.push(step);
      const s = state[step];
      if (s.fail) throw new Error(`${step} blew up`);
      s.done = true;
    },
  });
  const impls = Object.fromEntries(PUBLISH_STEPS.map((s) => [s, impl(s)])) as StepImpls;
  return { impls, executed, planned, skipped };
}

function passingSummary(overrides: Partial<IdentityGateSummary> = {}): IdentityGateSummary {
  return {
    manifest: "m.json",
    v_roofing_permit: 307,
    meta_permit: 307,
    permits_emitted: 307,
    permit_side_properties: 300,
    unmatched_properties: 0,
    pids_checked: 0,
    pids_unmatched: 0,
    result: "PASS",
    failures: [],
    ...overrides,
  };
}

const fresh = () =>
  Object.fromEntries(PUBLISH_STEPS.map((s) => [s, { done: false }])) as Record<
    PublishStepName,
    { done: boolean; fail?: boolean }
  >;

describe("runPublish: order, resume, dry run, pilot", () => {
  it("runs the eight steps in the fixed order, both gates included", async () => {
    const { ctx } = await realContext();
    const { impls, executed } = fakeImpls(fresh());
    const report = await runPublish({ ctx, impls, dryRun: false });
    expect(report.ok).toBe(true);
    expect(executed).toEqual([...PUBLISH_STEPS]);
    expect(report.steps.map((s) => s.status)).toEqual(PUBLISH_STEPS.map(() => "done"));
  });

  it("stops at a failed step and a rerun resumes there without redoing finished steps", async () => {
    const { ctx } = await realContext();
    const state = fresh();
    state["cid-copy"].fail = true;
    const first = fakeImpls(state);
    const r1 = await runPublish({ ctx, impls: first.impls, dryRun: false });
    expect(r1.ok).toBe(false);
    expect(first.executed).toEqual(["gate", "filebase", "car-files", "manifest", "cid-copy"]);
    expect(r1.steps.at(-1)).toMatchObject({
      step: "cid-copy",
      status: "failed",
      error: "cid-copy blew up",
    });
    expect(formatReport(r1).join("\n")).toContain("ERROR cid-copy blew up");

    state["cid-copy"].fail = false;
    const second = fakeImpls(state);
    const r2 = await runPublish({ ctx, impls: second.impls, dryRun: false });
    expect(r2.ok).toBe(true);
    expect(second.executed).toEqual(["cid-copy", "gate-remote", "release", "index"]);
    expect(r2.steps.slice(0, 4).map((s) => s.status)).toEqual([
      "already-done",
      "already-done",
      "already-done",
      "already-done",
    ]);
  });

  it("--step runs that step behind the mandatory gate", async () => {
    const { ctx } = await realContext();
    const { impls, executed } = fakeImpls(fresh());
    const report = await runPublish({ ctx, impls, dryRun: false, step: "manifest" });
    expect(executed).toEqual(["gate", "manifest"]);
    expect(report.steps).toHaveLength(2);
  });

  it("--step index refuses while an earlier step has no receipts", async () => {
    const { ctx } = await realContext();
    const state = fresh();
    state.gate.done = true;
    state.filebase.done = true;
    const { impls, executed } = fakeImpls(state);
    await expect(runPublish({ ctx, impls, dryRun: false, step: "index" })).rejects.toThrow(
      /refusing to write the index: step car-files/,
    );
    expect(executed).toEqual([]);
  });

  it("a dry run executes nothing, writes nothing, and plans without probing", async () => {
    const { ctx } = await realContext();
    const state = fresh();
    state.filebase.done = true;
    const { impls, executed, planned, skipped } = fakeImpls(state);
    const report = await runPublish({ ctx, impls, dryRun: true });
    expect(executed).toEqual([]);
    expect(skipped).toEqual([]); // onSkip (receipt writes) never runs in a dry run
    expect(planned.every((p) => p.probe === false)).toBe(true);
    expect(report.mode).toBe("dry-run");
    expect(report.steps[1]).toMatchObject({ step: "filebase", status: "already-done" });
    expect(report.steps[2]).toMatchObject({ step: "car-files", status: "would-run" });
    expect(report.ok).toBe(true);
  });

  it("a dry run with --probe asks the steps for network checks, still executing nothing", async () => {
    const { ctx } = await realContext();
    const { impls, executed, planned } = fakeImpls(fresh());
    const report = await runPublish({ ctx, impls, dryRun: true, probe: true });
    expect(executed).toEqual([]);
    expect(planned.every((p) => p.probe)).toBe(true);
    expect(report.mode).toBe("dry-run+probe");
  });

  it("a real run applies onSkip (adopt receipts) for skipped items", async () => {
    const { ctx } = await realContext();
    const state = fresh();
    state["car-files"].done = true;
    const { impls, skipped } = fakeImpls(state);
    await runPublish({ ctx, impls, dryRun: false, step: "car-files" });
    expect(skipped).toEqual(["car-files"]);
  });

  it("fails a step that finished without recording its receipts", async () => {
    const { ctx } = await realContext();
    const { impls } = fakeImpls(fresh());
    impls.filebase = {
      plan: async () => [{ id: "x", action: "run", reason: "no receipt" }],
      execute: async () => undefined,
    };
    const report = await runPublish({ ctx, impls, dryRun: false });
    expect(report.ok).toBe(false);
    expect(report.steps.at(-1)?.error).toMatch(/still have no receipt/);
  });

  it("a pilot has no release or index step, and --step release/index is refused", async () => {
    const { ctx } = await realContext({ pilot: true, runId: "travis-full-run2-trial-20261024" });
    const { impls, executed } = fakeImpls(fresh());
    await expect(runPublish({ ctx, impls, dryRun: false, step: "release" })).rejects.toThrow(
      /no release step/,
    );
    await expect(runPublish({ ctx, impls, dryRun: true, step: "index" })).rejects.toThrow(
      /no index step/,
    );
    const report = await runPublish({ ctx, impls, dryRun: false });
    expect(executed).toEqual([
      "gate",
      "filebase",
      "car-files",
      "manifest",
      "cid-copy",
      "gate-remote",
    ]);
    expect(report.steps.filter((s) => s.status === "not-applicable").map((s) => s.step)).toEqual([
      "release",
      "index",
    ]);
  });
});

describe("loadPublishContext", () => {
  it("rejects a pilot manifest under runs/ and a real manifest outside runs/<runId>/", async () => {
    const { f } = await realContext();
    await expect(
      loadPublishContext({
        repoRoot: f.root,
        manifestPath: `runs/${RUN2}/manifest.json`,
        runId: RUN2,
        pilot: true,
      }),
    ).rejects.toThrow(/pilot never publishes a manifest under runs\//);
    await expect(
      loadPublishContext({
        repoRoot: f.root,
        manifestPath: `runs/${BASE_RUN_ID}/manifest.json`,
        runId: RUN2,
        pilot: false,
      }),
    ).rejects.toThrow(/real run's manifest is runs\//);
  });

  it("rejects a manifest that is not the exact JCS bytes (e.g. pretty-printed)", async () => {
    const { f, ctx } = await realContext();
    writeFileSync(ctx.manifestPath, JSON.stringify(ctx.manifest, null, 2));
    await expect(
      loadPublishContext({
        repoRoot: f.root,
        manifestPath: ctx.manifestPath,
        runId: RUN2,
        pilot: false,
      }),
    ).rejects.toThrow(/not the exact JCS bytes/);
  });

  it("rejects a --run-id that is not the manifest's", async () => {
    const { f, ctx } = await realContext();
    await expect(
      loadPublishContext({
        repoRoot: f.root,
        manifestPath: ctx.manifestPath,
        runId: "other",
        pilot: false,
      }),
    ).rejects.toThrow(/real run's manifest is runs\/other/);
  });

  it("computes the manifest CID from the file bytes", async () => {
    const { ctx } = await realContext();
    expect(ctx.manifestCid).toBe(await cidOfBytes(ctx.manifestBytes));
    expect(Buffer.from(jcsBytes(ctx.manifest)).equals(ctx.manifestBytes)).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
// Step implementations, over fakes

const ENV = {
  FILEBASE_ACCESS_KEY: "ak-test",
  FILEBASE_SECRET_KEY: "sk-test-secret",
  FILEBASE_BUCKET: "bk",
};

interface Harness {
  deps: PublishDeps;
  cli: ReturnType<typeof vi.fn>;
  sleeps: number[];
  logs: string[];
}

function harness(
  ctx: PublishContext,
  overrides: {
    cliBehavior?: (
      unitRoot: string,
      attempt: number,
      input: string,
    ) => { code: number; root?: string; countyRoot?: string };
    gh?: GhClient;
    fetch?: FetchLike;
    reuseTags?: string[];
  } = {},
): Harness {
  const sleeps: number[] = [];
  const logs: string[] = [];
  const attempts = new Map<string, number>();
  const cli = vi.fn(async (argv: string[]) => {
    const input = argv[1] as string;
    const out = argv[argv.indexOf("--output-json") + 1] as string;
    const unit = uploadUnits(ctx.manifest).find(
      (u) => join(ctx.repoRoot, u.artifact.name) === input,
    );
    if (unit === undefined) throw new Error(`unexpected input ${input}`);
    const n = (attempts.get(unit.id) ?? 0) + 1;
    attempts.set(unit.id, n);
    const behavior = overrides.cliBehavior?.(unit.artifact.cid, n, input) ?? { code: 0 };
    if (behavior.code !== 0)
      return { code: behavior.code, stdout: "", stderr: "fetch failed sk-test-secret" };
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(
      out,
      JSON.stringify({
        api: "https://rpc.filebase.io",
        root: behavior.root ?? unit.artifact.cid,
        ...(unit.kind === "tables" ? { countyRoot: behavior.countyRoot ?? unit.carCid } : {}),
        uploadedAt: "2026-10-24T09:00:00.000Z",
      }),
    );
    return { code: 0, stdout: "ok", stderr: "" };
  });
  const gh: GhClient = overrides.gh ?? {
    view: async () => null,
    create: async () => undefined,
    upload: async () => undefined,
    deleteAsset: async () => undefined,
  };
  const deps: PublishDeps = {
    gate: {
      run: async () => passingSummary(),
      now: () => new Date("2026-10-24T10:00:00.000Z"),
      log: (l) => logs.push(l),
    },
    filebase: {
      loadEnv: () => ENV,
      runCli: cli,
      sleep: async (ms) => void sleeps.push(ms),
      log: (l) => logs.push(l),
    },
    carFiles: {
      loadEnv: () => ENV,
      now: () => new Date("2026-10-24T10:00:00.000Z"),
      log: (l) => logs.push(l),
      ...(overrides.fetch === undefined ? {} : { fetch: overrides.fetch }),
    },
    manifest: {
      loadEnv: () => ENV,
      now: () => new Date("2026-10-24T10:00:00.000Z"),
      log: (l) => logs.push(l),
      ...(overrides.fetch === undefined ? {} : { fetch: overrides.fetch }),
    },
    cidCopy: {
      copy: async () => ({ written: 3, skipped: 4, total: 7 }),
      now: () => new Date("2026-10-24T10:00:00.000Z"),
    },
    release: {
      gh,
      options: overrides.reuseTags === undefined ? {} : { reuseTags: overrides.reuseTags },
      currentBranch: () => "011-publish-and-runs",
      now: () => new Date("2026-10-24T10:00:00.000Z"),
      log: (l) => logs.push(l),
    },
    index: { log: (l) => logs.push(l) },
  };
  return { deps, cli, sleeps, logs };
}

describe("filebase step", () => {
  it("uploads each CAR and tables directory once, writing one receipt per artifact, then skips them all", async () => {
    const { ctx } = await realContext();
    const h = harness(ctx);
    const impls = createPublishSteps(h.deps);
    const r1 = await runPublish({ ctx, impls, dryRun: false, step: "filebase" });
    expect(r1.ok).toBe(true);
    const units = uploadUnits(ctx.manifest);
    expect(h.cli).toHaveBeenCalledTimes(units.length);
    for (const u of units) expect(existsSync(join(ctx.receiptsDir, `${u.id}.json`))).toBe(true);
    // The argv is the documented one and carries no credential.
    const argv = h.cli.mock.calls[0]?.[0] as string[];
    expect(argv.slice(0, 1)).toEqual(["upload"]);
    expect(argv).toContain("--api");
    expect(argv.join(" ")).not.toContain("sk-test-secret");

    const r2 = await runPublish({ ctx, impls, dryRun: false, step: "filebase" });
    expect(r2.steps.at(-1)?.status).toBe("already-done");
    expect(h.cli).toHaveBeenCalledTimes(units.length);
  });

  it("a runner limited to PUBLISH_FILEBASE_UNITS uploads only those units and writes no other receipt", async () => {
    const { ctx } = await realContext();
    const h = harness(ctx);
    const units = uploadUnits(ctx.manifest);
    // the last batch's CAR and its tables folder (a folder waits for its own CAR's receipt)
    const mine = units.slice(-2).map((u) => u.id);
    h.deps.filebase.units = mine;
    const r = await runPublish({
      ctx,
      impls: createPublishSteps(h.deps),
      dryRun: false,
      step: "filebase",
    });
    // The step stays strict: units left to other runners are reported, so a split job checks its own
    // receipts instead of the exit code.
    expect(r.ok).toBe(false);
    const others = units.map((u) => u.id).filter((id) => !mine.includes(id));
    expect(r.steps.at(-1)?.error).toContain(`${others.length} item(s) still have no receipt`);
    expect(h.cli).toHaveBeenCalledTimes(mine.length);
    for (const u of units)
      expect(existsSync(join(ctx.receiptsDir, `${u.id}.json`)), u.id).toBe(mine.includes(u.id));
  });

  it("refuses PUBLISH_FILEBASE_UNITS names that are not units of the manifest", async () => {
    const { ctx } = await realContext();
    const h = harness(ctx);
    h.deps.filebase.units = ["county-b5-tables"];
    const r = await runPublish({
      ctx,
      impls: createPublishSteps(h.deps),
      dryRun: false,
      step: "filebase",
    });
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r.steps)).toContain(
      "names units the manifest does not have: county-b5-tables",
    );
    expect(h.cli).not.toHaveBeenCalled();
  });

  it("a tables folder waits until its batch CAR has a receipt", async () => {
    const { ctx } = await realContext();
    const h = harness(ctx);
    const tables = uploadUnits(ctx.manifest).filter((u) => u.kind === "tables");
    h.deps.filebase.units = tables.map((u) => u.id);
    const r = await runPublish({
      ctx,
      impls: createPublishSteps(h.deps),
      dryRun: false,
      step: "filebase",
    });
    expect(r.ok).toBe(false);
    expect(h.cli).not.toHaveBeenCalled();
    for (const u of tables) expect(existsSync(join(ctx.receiptsDir, `${u.id}.json`))).toBe(false);
  });

  it("A11-17 R5: a receipt that appears while the lock is being taken stops the upload", async () => {
    const { ctx } = await realContext();
    const [first] = uploadUnits(ctx.manifest);
    if (first === undefined) throw new Error("no unit");
    const h = harness(ctx);
    // Another worker finishes the first unit after our plan but before we hold its lock.
    h.deps.filebase.onLockTaken = (id) => {
      if (id !== first.id) return;
      put(
        join(ctx.receiptsDir, `${first.id}.json`),
        JSON.stringify({ api: "https://rpc.filebase.io", root: first.artifact.cid, blocks: 1 }),
      );
    };
    const report = await runPublish({
      ctx,
      impls: createPublishSteps(h.deps),
      dryRun: false,
      step: "filebase",
    });
    expect(report.ok).toBe(true);
    const uploadedInputs = h.cli.mock.calls.map((c) => (c[0] as string[])[1]);
    expect(uploadedInputs).not.toContain(join(ctx.repoRoot, first.artifact.name));
    expect(h.cli).toHaveBeenCalledTimes(uploadUnits(ctx.manifest).length - 1);
    expect(h.logs.some((l) => l.includes("a receipt appeared while taking the lock"))).toBe(true);
    expect(existsSync(join(ctx.receiptsDir, `${first.id}.json.lock`))).toBe(false);
  });

  it("skips an artifact that an existing top-level receipt (Run 1 style) already records", async () => {
    const { ctx } = await realContext();
    const [first] = uploadUnits(ctx.manifest);
    if (first === undefined) throw new Error("no unit");
    put(
      join(ctx.receiptsRoot, "county-b01-car.json"),
      JSON.stringify({ api: "https://rpc.filebase.io", root: first.artifact.cid, blocks: 1 }),
    );
    const h = harness(ctx);
    const report = await runPublish({
      ctx,
      impls: createPublishSteps(h.deps),
      dryRun: true,
      step: "filebase",
    });
    const items = report.steps.at(-1)?.items ?? [];
    expect(items[0]).toMatchObject({ id: first.id, action: "skip" });
    expect(items[0]?.reason).toMatch(/county-b01-car\.json records this CID/);
    expect(items.slice(1).every((i) => i.action === "run")).toBe(true);
    expect(h.cli).not.toHaveBeenCalled();
  });

  it("fails, and keeps no receipt, when the uploaded root differs from the manifest's CID", async () => {
    const { ctx } = await realContext();
    const other = (await runFixture()).baseCid; // a valid CID that is not this artifact's
    const h = harness(ctx, { cliBehavior: () => ({ code: 0, root: other }) });
    const report = await runPublish({
      ctx,
      impls: createPublishSteps(h.deps),
      dryRun: false,
      step: "filebase",
    });
    expect(report.ok).toBe(false);
    expect(report.steps.at(-1)?.error).toMatch(/records root .* but the manifest says/);
    const [first] = uploadUnits(ctx.manifest);
    expect(existsSync(join(ctx.receiptsDir, `${first?.id}.json`))).toBe(false);
    expect(existsSync(join(ctx.receiptsDir, `${first?.id}.json.partial`))).toBe(false);
    expect(h.cli).toHaveBeenCalledTimes(1); // a wrong root is not retried
  });

  it("fails when a tables receipt's countyRoot is not the CAR it belongs to", async () => {
    const { ctx } = await realContext();
    const wrong = (await runFixture()).baseCid;
    const h = harness(ctx, { cliBehavior: () => ({ code: 0 }) });
    h.cli.mockImplementation(async (argv: string[]) => {
      const input = argv[1] as string;
      const out = argv[argv.indexOf("--output-json") + 1] as string;
      const unit = uploadUnits(ctx.manifest).find(
        (u) => join(ctx.repoRoot, u.artifact.name) === input,
      );
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(
        out,
        JSON.stringify({
          api: "x",
          root: unit?.artifact.cid,
          ...(unit?.kind === "tables" ? { countyRoot: wrong } : {}),
        }),
      );
      return { code: 0, stdout: "", stderr: "" };
    });
    const report = await runPublish({
      ctx,
      impls: createPublishSteps(h.deps),
      dryRun: false,
      step: "filebase",
    });
    expect(report.ok).toBe(false);
    expect(report.steps.at(-1)?.error).toMatch(/countyRoot/);
  });

  it("fails an existing per-run receipt whose root is wrong, even in a dry run", async () => {
    const { ctx } = await realContext();
    const [first] = uploadUnits(ctx.manifest);
    const wrong = (await runFixture()).baseCid;
    put(join(ctx.receiptsDir, `${first?.id}.json`), JSON.stringify({ api: "x", root: wrong }));
    const report = await runPublish({
      ctx,
      impls: createPublishSteps(harness(ctx).deps),
      dryRun: true,
      step: "filebase",
    });
    expect(report.ok).toBe(false);
    expect(report.steps.at(-1)?.error).toMatch(/but the manifest says/);
  });

  it("retries with exponential backoff, redacts credentials from the log, and gives up after the attempt limit", async () => {
    const { ctx } = await realContext();
    const h = harness(ctx, { cliBehavior: (_c, attempt) => ({ code: attempt < 3 ? 1 : 0 }) });
    const ok = await runPublish({
      ctx,
      impls: createPublishSteps(h.deps),
      dryRun: false,
      step: "filebase",
    });
    expect(ok.ok).toBe(true);
    expect(h.sleeps.slice(0, 2)).toEqual([5_000, 10_000]);
    expect(h.logs.join("\n")).toContain("[redacted]");
    expect(h.logs.join("\n")).not.toContain("sk-test-secret");

    const { ctx: ctx2 } = await realContext();
    const bad = harness(ctx2, { cliBehavior: () => ({ code: 1 }) });
    bad.deps.filebase.attempts = 3;
    const failed = await runPublish({
      ctx: ctx2,
      impls: createPublishSteps(bad.deps),
      dryRun: false,
      step: "filebase",
    });
    expect(failed.ok).toBe(false);
    expect(failed.steps.at(-1)?.error).toMatch(/failed after 3 attempts/);
    expect(bad.cli).toHaveBeenCalledTimes(3);
  });
});

describe("car-files and manifest steps (probe / adopt)", () => {
  function servingFetch(sizeOf: (cid: string) => number | undefined): FetchLike {
    return async (url) => {
      const cid = url.split("/ipfs/")[1] as string;
      const size = sizeOf(cid);
      if (size === undefined) return new Response("nope", { status: 404 });
      return new Response(null, { status: 206, headers: { "content-range": `bytes 0-0/${size}` } });
    };
  }

  it("without --probe a dry run reports no local receipt and makes no fetch", async () => {
    const { ctx } = await realContext();
    const fetchSpy = vi.fn();
    const h = harness(ctx, { fetch: fetchSpy as unknown as FetchLike });
    const report = await runPublish({
      ctx,
      impls: createPublishSteps(h.deps),
      dryRun: true,
      step: "car-files",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(report.steps.at(-1)?.items.every((i) => i.action === "run")).toBe(true);
    expect(report.steps.at(-1)?.items.length).toBe(
      ctx.manifest.artifacts.filter((a) => a.carCid !== undefined).length,
    );
  });

  it("skipProbe uploads without asking the gateways first", async () => {
    const { ctx } = await realContext();
    const fetchSpy = vi.fn();
    const h = harness(ctx, { fetch: fetchSpy as unknown as FetchLike });
    h.deps.carFiles.skipProbe = true;
    const report = await runPublish({
      ctx,
      impls: createPublishSteps(h.deps),
      dryRun: true,
      probe: true,
      step: "car-files",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    const items = report.steps.at(-1)?.items ?? [];
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((i) => i.action === "run" && /probe skipped/.test(i.reason))).toBe(true);
  });

  it("presentOnly plans only the files on disk and writes no receipt for the others", async () => {
    const { ctx } = await realContext();
    const h = harness(ctx, { fetch: vi.fn() as unknown as FetchLike });
    h.deps.carFiles.skipProbe = true;
    h.deps.carFiles.presentOnly = true;
    const targets = ctx.manifest.artifacts.filter((a) => a.carCid !== undefined);
    const report = await runPublish({
      ctx,
      impls: createPublishSteps(h.deps),
      dryRun: true,
      step: "car-files",
    });
    const items = report.steps.at(-1)?.items ?? [];
    expect(items.length).toBe(targets.length);
    const missing = items.filter((i) => /not fetched yet/.test(i.reason));
    const present = items.filter((i) => i.action === "run");
    expect(missing.length + present.length).toBe(targets.length);
    expect(missing.every((i) => i.action === "skip")).toBe(true);
    expect(existsSync(join(ctx.receiptsDir, "carfiles"))).toBe(false);
  });

  it("--probe finds files both gateways already serve at the manifest size and skips them", async () => {
    const { ctx } = await realContext();
    const sizes = new Map(
      ctx.manifest.artifacts.filter((a) => a.carCid).map((a) => [a.carCid as string, a.size]),
    );
    const h = harness(ctx, { fetch: servingFetch((cid) => sizes.get(cid)) });
    const report = await runPublish({
      ctx,
      impls: createPublishSteps(h.deps),
      dryRun: true,
      probe: true,
      step: "car-files",
    });
    expect(report.steps.at(-1)?.status).toBe("already-done");
    expect(existsSync(join(ctx.receiptsDir, "carfiles"))).toBe(false); // a dry run writes nothing
  });

  it("a real run adopts what is already served (writes receipts, uploads nothing) and then skips locally", async () => {
    const { ctx } = await realContext();
    const sizes = new Map(
      ctx.manifest.artifacts.filter((a) => a.carCid).map((a) => [a.carCid as string, a.size]),
    );
    const add = vi.fn();
    const h = harness(ctx, { fetch: servingFetch((cid) => sizes.get(cid)) });
    h.deps.carFiles.add = add;
    const impls = createPublishSteps(h.deps);
    const r1 = await runPublish({ ctx, impls, dryRun: false, step: "car-files" });
    expect(r1.steps.at(-1)?.status).toBe("already-done");
    expect(add).not.toHaveBeenCalled();
    const [first] = uploadUnits(ctx.manifest);
    const receipt = JSON.parse(
      readFileSync(join(ctx.receiptsDir, "carfiles", `${first?.id}.json`), "utf8"),
    );
    expect(receipt).toMatchObject({ adopted: true, carCid: first?.artifact.carCid });

    // Offline now: the local receipts are enough.
    const offline = harness(ctx, {
      fetch: (async () => {
        throw new Error("offline");
      }) as FetchLike,
    });
    const r2 = await runPublish({
      ctx,
      impls: createPublishSteps(offline.deps),
      dryRun: true,
      step: "car-files",
    });
    expect(r2.steps.at(-1)?.status).toBe("already-done");
  });

  it("uploads only the files a gateway does not serve, via Kubo add, and records receipts", async () => {
    const { ctx } = await realContext();
    const withCarCid = ctx.manifest.artifacts.filter((a) => a.carCid);
    const missing = withCarCid[0];
    const sizes = new Map(withCarCid.slice(1).map((a) => [a.carCid as string, a.size]));
    // After "uploading", the gateways serve the missing one too (the readback in uploadCarFile is a full GET).
    let uploaded = false;
    const fetchImpl: FetchLike = async (url, init) => {
      const cid = url.split("/ipfs/")[1] as string;
      if (cid === missing?.carCid && uploaded) {
        return init?.headers
          ? new Response(null, {
              status: 206,
              headers: { "content-range": `bytes 0-0/${missing?.size}` },
            })
          : new Response(new Uint8Array(missing?.size ?? 0), { status: 200 });
      }
      return servingFetch((c) => sizes.get(c))(url, init);
    };
    const add = vi.fn(async (_path: string, cid: string) => {
      uploaded = true;
      return { cid, name: "x", size: missing?.size ?? 0 };
    });
    const h = harness(ctx, { fetch: fetchImpl });
    h.deps.carFiles.add = add;
    const report = await runPublish({
      ctx,
      impls: createPublishSteps(h.deps),
      dryRun: false,
      step: "car-files",
    });
    expect(report.ok).toBe(true);
    expect(add).toHaveBeenCalledTimes(1);
    expect(add.mock.calls[0]?.[1]).toBe(missing?.carCid);
  });

  it("A11-17 R4: a Filebase-only receipt records deferredGateways and does not satisfy a full-readback run", async () => {
    const { ctx } = await realContext();
    const withCarCid = ctx.manifest.artifacts.filter((a) => a.carCid);
    const sizes = new Map(withCarCid.map((a) => [a.carCid as string, a.size]));
    // Filebase serves every file in full; Pinata errors (too slow for large CARs).
    const fetchImpl: FetchLike = async (url) => {
      if (!url.startsWith(FILEBASE_GATEWAY)) throw new TypeError("fetch failed");
      const cid = url.split("/ipfs/")[1] as string;
      return new Response(new Uint8Array(sizes.get(cid) ?? 0), { status: 200 });
    };
    const deferred = harness(ctx, { fetch: fetchImpl });
    deferred.deps.carFiles.add = async (_path: string, cid: string) => ({
      cid,
      name: "x",
      size: sizes.get(cid) ?? 0,
    });
    deferred.deps.carFiles.skipProbe = true;
    deferred.deps.carFiles.readbackGateways = [FILEBASE_GATEWAY];
    const run1 = await runPublish({
      ctx,
      impls: createPublishSteps(deferred.deps),
      dryRun: false,
      step: "car-files",
    });
    expect(run1.ok).toBe(true);
    const [first] = uploadUnits(ctx.manifest);
    const receipt = JSON.parse(
      readFileSync(join(ctx.receiptsDir, "carfiles", `${first?.id}.json`), "utf8"),
    );
    expect(receipt.deferredGateways).toEqual(["https://gateway.pinata.cloud"]);

    // Same deferral again: the receipts count, nothing to do.
    const again = await runPublish({
      ctx,
      impls: createPublishSteps(deferred.deps),
      dryRun: true,
      step: "car-files",
    });
    expect(again.steps.at(-1)?.status).toBe("already-done");

    // A run that must read Pinata back too does not accept the Filebase-only receipts.
    const full = harness(ctx);
    full.deps.carFiles.skipProbe = true;
    const report = await runPublish({
      ctx,
      impls: createPublishSteps(full.deps),
      dryRun: true,
      step: "car-files",
    });
    const items = report.steps.at(-1)?.items ?? [];
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((i) => i.action === "run")).toBe(true);
  });

  it("the manifest step adopts a manifest both gateways already serve byte for byte", async () => {
    const { ctx } = await realContext();
    const fetchImpl: FetchLike = async () =>
      new Response(new Uint8Array(ctx.manifestBytes), { status: 200 });
    const h = harness(ctx, { fetch: fetchImpl });
    const report = await runPublish({
      ctx,
      impls: createPublishSteps(h.deps),
      dryRun: false,
      step: "manifest",
    });
    expect(report.steps.at(-1)?.status).toBe("already-done");
    expect(
      JSON.parse(readFileSync(join(ctx.receiptsDir, "manifest-upload.json"), "utf8")),
    ).toMatchObject({
      cid: ctx.manifestCid,
      adopted: true,
    });
  });
});

describe("cid-copy step", () => {
  it("copies once, records a receipt, then skips", async () => {
    const { ctx } = await realContext();
    const h = harness(ctx);
    const copy = vi.fn(h.deps.cidCopy.copy);
    h.deps.cidCopy.copy = copy;
    const impls = createPublishSteps(h.deps);
    await runPublish({ ctx, impls, dryRun: false, step: "cid-copy" });
    const again = await runPublish({ ctx, impls, dryRun: false, step: "cid-copy" });
    expect(copy).toHaveBeenCalledTimes(1);
    expect(again.steps.at(-1)?.status).toBe("already-done");
    expect(JSON.parse(readFileSync(join(ctx.receiptsDir, "cid-copy.json"), "utf8"))).toMatchObject({
      manifestCid: ctx.manifestCid,
      total: 7,
    });
  });
});

describe("release step", () => {
  function fakeGh(initial: Record<string, GhRelease | null> = {}) {
    const releases = new Map<string, GhRelease | null>(Object.entries(initial));
    const calls: string[] = [];
    const digestOf = (ctx: PublishContext, file: string): string => {
      const a = releaseAssets(ctx).find((x) => x.path === file);
      return `sha256:${a?.sha256}`;
    };
    let ctxRef: PublishContext | undefined;
    const gh: GhClient = {
      view: async (tag) => releases.get(tag) ?? null,
      create: async ({ tag, files, target }) => {
        calls.push(`create ${tag} ${files.length} ${target}`);
        releases.set(tag, {
          tagName: tag,
          assets: files.map((f) => ({
            name: f.split("/").at(-1) as string,
            size: 1,
            digest: digestOf(ctxRef as PublishContext, f),
            state: "uploaded",
          })),
        });
      },
      upload: async (tag, files) => {
        calls.push(`upload ${tag} ${files.length}`);
        const r = releases.get(tag) as GhRelease;
        for (const f of files)
          r.assets.push({
            name: f.split("/").at(-1) as string,
            size: 1,
            digest: digestOf(ctxRef as PublishContext, f),
            state: "uploaded",
          });
      },
      deleteAsset: async (tag, name) => {
        calls.push(`delete ${tag} ${name}`);
        const r = releases.get(tag) as GhRelease;
        r.assets = r.assets.filter((a) => a.name !== name);
      },
    };
    return { gh, calls, releases, bind: (c: PublishContext) => void (ctxRef = c) };
  }

  it("creates the release with every CAR when none exists, records a receipt, and skips on rerun", async () => {
    const { ctx } = await realContext();
    const g = fakeGh();
    g.bind(ctx);
    const h = harness(ctx, { gh: g.gh });
    const impls = createPublishSteps(h.deps);
    const r1 = await runPublish({ ctx, impls, dryRun: false, step: "release" });
    expect(r1.ok).toBe(true);
    expect(g.calls).toEqual([
      `create run-${RUN2} ${releaseAssets(ctx).length} 011-publish-and-runs`,
    ]);
    const r2 = await runPublish({ ctx, impls, dryRun: false, step: "release" });
    expect(r2.steps.at(-1)?.status).toBe("already-done");
    expect(g.calls).toHaveLength(1);
  });

  it("refuses to attach a local CAR whose bytes no longer hash to the manifest", async () => {
    const { ctx } = await realContext();
    const g = fakeGh();
    g.bind(ctx);
    const car = releaseAssets(ctx)[0]?.path as string;
    writeFileSync(car, Buffer.concat([readFileSync(car), Buffer.from("x")]));
    const h = harness(ctx, { gh: g.gh });
    const r = await runPublish({
      ctx,
      impls: createPublishSteps(h.deps),
      dryRun: false,
      step: "release",
    });
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r.steps.at(-1))).toMatch(/hashes to/);
    expect(g.calls).toEqual([]);
  });

  it("uploads only missing assets to an existing release, and never replaces an asset with a different SHA-256", async () => {
    const { ctx } = await realContext();
    const assets = releaseAssets(ctx);
    const g = fakeGh({
      [`run-${RUN2}`]: {
        tagName: `run-${RUN2}`,
        assets: assets.slice(0, 2).map((a) => ({
          name: a.name,
          size: a.size,
          digest: `sha256:${a.sha256}`,
          state: "uploaded",
        })),
      },
    });
    g.bind(ctx);
    const h = harness(ctx, { gh: g.gh });
    const report = await runPublish({
      ctx,
      impls: createPublishSteps(h.deps),
      dryRun: false,
      step: "release",
    });
    expect(report.ok).toBe(true);
    expect(g.calls).toEqual([`upload run-${RUN2} ${assets.length - 2}`]);

    const bad = fakeGh({
      [`run-${RUN2}`]: {
        tagName: `run-${RUN2}`,
        assets: [
          {
            name: assets[0]?.name as string,
            size: 1,
            digest: `sha256:${"0".repeat(64)}`,
            state: "uploaded",
          },
        ],
      },
    });
    bad.bind(ctx);
    const { ctx: ctx2 } = await realContext();
    const h2 = harness(ctx2, { gh: bad.gh });
    const failed = await runPublish({
      ctx: ctx2,
      impls: createPublishSteps(h2.deps),
      dryRun: false,
      step: "release",
    });
    expect(failed.ok).toBe(false);
    expect(failed.steps.at(-1)?.error).toMatch(/different SHA-256/);
  });

  it("deletes and re-uploads an asset left in a non-uploaded state", async () => {
    const { ctx } = await realContext();
    const assets = releaseAssets(ctx);
    const g = fakeGh({
      [`run-${RUN2}`]: {
        tagName: `run-${RUN2}`,
        assets: assets.map((a, i) => ({
          name: a.name,
          size: a.size,
          digest: `sha256:${a.sha256}`,
          state: i === 0 ? "starter" : "uploaded",
        })),
      },
    });
    g.bind(ctx);
    const h = harness(ctx, { gh: g.gh });
    const report = await runPublish({
      ctx,
      impls: createPublishSteps(h.deps),
      dryRun: false,
      step: "release",
    });
    expect(report.ok).toBe(true);
    expect(g.calls).toEqual([`delete run-${RUN2} ${assets[0]?.name}`, `upload run-${RUN2} 1`]);
  });

  it("does not re-upload assets already attached, byte-identical, to a reused release", async () => {
    const { ctx } = await realContext();
    const assets = releaseAssets(ctx);
    const county = assets.filter((a) => a.name.includes("county"));
    const g = fakeGh({
      "run1-tag": {
        tagName: "run1-tag",
        assets: county.map((a) => ({
          name: a.name,
          size: a.size,
          digest: `sha256:${a.sha256}`,
          state: "uploaded",
        })),
      },
    });
    g.bind(ctx);
    const h = harness(ctx, { gh: g.gh, reuseTags: ["run1-tag"] });
    const report = await runPublish({
      ctx,
      impls: createPublishSteps(h.deps),
      dryRun: false,
      step: "release",
    });
    expect(report.ok).toBe(true);
    expect(g.calls).toEqual([
      `create run-${RUN2} ${assets.length - county.length} 011-publish-and-runs`,
    ]);
    const receipt = JSON.parse(readFileSync(join(ctx.receiptsDir, "release.json"), "utf8"));
    expect(Object.keys(receipt.reusedFrom).sort()).toEqual(county.map((a) => a.name).sort());
  });

  it("a dry run without --probe never calls gh", async () => {
    const { ctx } = await realContext();
    const g = fakeGh();
    const view = vi.spyOn(g.gh, "view");
    const h = harness(ctx, { gh: g.gh });
    const report = await runPublish({
      ctx,
      impls: createPublishSteps(h.deps),
      dryRun: true,
      step: "release",
    });
    expect(view).not.toHaveBeenCalled();
    expect(report.steps.at(-1)?.status).toBe("would-run");
  });
});

describe("index step", () => {
  it("appends the run in Run 1's entry shape, then never adds a second entry", async () => {
    const { ctx } = await realContext();
    const impls = createPublishSteps(harness(ctx).deps);
    const before = JSON.parse(readFileSync(join(ctx.repoRoot, "runs/index.json"), "utf8"));
    const r1 = await runPublish({ ctx, impls, dryRun: false, step: "index" }).catch(
      (e: Error) => e,
    );
    // Earlier steps have no receipts yet: the guard refuses.
    expect(r1).toBeInstanceOf(Error);

    // Simulate the earlier steps being done by writing their receipts through the real steps.
    const h = harness(ctx);
    const sizes = new Map(
      ctx.manifest.artifacts.filter((a) => a.carCid).map((a) => [a.carCid as string, a.size]),
    );
    h.deps.carFiles.fetch = async (url) => {
      const cid = url.split("/ipfs/")[1] as string;
      return new Response(null, {
        status: 206,
        headers: { "content-range": `bytes 0-0/${sizes.get(cid)}` },
      });
    };
    h.deps.manifest.fetch = async () =>
      new Response(new Uint8Array(ctx.manifestBytes), { status: 200 });
    const g = {
      view: async () => null,
      create: async () => undefined,
      upload: async () => undefined,
      deleteAsset: async () => undefined,
    } satisfies GhClient;
    h.deps.release.gh = {
      ...g,
      view: async () => ({
        tagName: "t",
        assets: releaseAssets(ctx).map((a) => ({
          name: a.name,
          size: a.size,
          digest: `sha256:${a.sha256}`,
          state: "uploaded",
        })),
      }),
    };
    const all = createPublishSteps(h.deps);
    const run = await runPublish({ ctx, impls: all, dryRun: false });
    expect(run.ok).toBe(true);
    expect(run.steps.map((s) => s.step)).toEqual([...PUBLISH_STEPS]);

    const after = JSON.parse(readFileSync(join(ctx.repoRoot, "runs/index.json"), "utf8"));
    expect(after.runs).toHaveLength(before.runs.length + 1);
    expect(after.runs.at(-1)).toEqual({
      finishedAt: ctx.manifest.finishedAt,
      manifestCid: ctx.manifestCid,
      runId: RUN2,
    });
    const bytesAfter = readFileSync(join(ctx.repoRoot, "runs/index.json"));

    // Rerun: the index step is already done, the file is byte-identical, no duplicate.
    const again = await runPublish({ ctx, impls: all, dryRun: false });
    expect(again.steps.map((s) => s.status)).toEqual(PUBLISH_STEPS.map(() => "already-done"));
    expect(readFileSync(join(ctx.repoRoot, "runs/index.json")).equals(bytesAfter)).toBe(true);
  });

  it("fails when the index lists this runId with a different manifest CID (a committed CID is never altered)", async () => {
    const { ctx } = await realContext();
    writeFileSync(
      join(ctx.repoRoot, "runs/index.json"),
      runsIndexBytes(
        appendRun(emptyRunsIndex(), {
          runId: RUN2,
          manifestCid: (await runFixture()).baseCid,
          finishedAt: ctx.manifest.finishedAt,
        }),
      ),
    );
    const report = await runPublish({
      ctx,
      impls: createPublishSteps(harness(ctx).deps),
      dryRun: true,
      step: "index",
    });
    expect(report.ok).toBe(false);
    expect(report.steps.at(-1)?.error).toMatch(/never altered/);
  });
});

// ---------------------------------------------------------------------------------------------
// The mandatory identity gates (gate before any upload, gate-remote before release and index)

const failingSummary = (): IdentityGateSummary =>
  passingSummary({
    v_roofing_permit: 0,
    unmatched_properties: 17387,
    permit_side_properties: 17387,
    result: "FAIL",
    failures: ["17387 permit-side properties are not county properties", "meta.permit is empty"],
  });

/** Real step implementations whose gate is a spy returning `outcome(remoteOnly)`. */
function gated(ctx: PublishContext, outcome: (remoteOnly: boolean) => IdentityGateSummary | Error) {
  const h = harness(ctx);
  const calls: boolean[] = [];
  h.deps.gate.run = async (_ctx, { remoteOnly }) => {
    calls.push(remoteOnly);
    const result = outcome(remoteOnly);
    if (result instanceof Error) throw result;
    return result;
  };
  const create = vi.fn(async () => undefined);
  h.deps.release.gh = {
    view: async () => null,
    create,
    upload: async () => undefined,
    deleteAsset: async () => undefined,
  };
  return { h, calls, create, impls: createPublishSteps(h.deps) };
}

describe("identity gate: mandatory and keyed by manifest CID", () => {
  it("a FAIL at gate stops the run before any upload step", async () => {
    const { ctx } = await realContext();
    const g = gated(ctx, () => failingSummary());
    const report = await runPublish({ ctx, impls: g.impls, dryRun: false });
    expect(report.ok).toBe(false);
    expect(report.steps.map((s) => s.step)).toEqual(["gate"]);
    expect(report.steps[0]?.error).toMatch(/identity gate FAILED.*meta\.permit is empty.*refused/);
    expect(g.h.cli).not.toHaveBeenCalled();
    expect(existsSync(gateReceiptPath(ctx, false))).toBe(false);
    expect(existsSync(ctx.receiptsDir)).toBe(false);
  });

  it("a gate that cannot run (throws) is a FAIL, not a pass", async () => {
    const { ctx } = await realContext();
    const g = gated(ctx, () => new Error("403 from the CID copy"));
    const report = await runPublish({ ctx, impls: g.impls, dryRun: false });
    expect(report.ok).toBe(false);
    expect(report.steps[0]?.error).toMatch(/gate could not run: 403 from the CID copy/);
    expect(g.h.cli).not.toHaveBeenCalled();
  });

  it("--step filebase still runs the gate first and uploads nothing on FAIL", async () => {
    const { ctx } = await realContext();
    const g = gated(ctx, () => failingSummary());
    const report = await runPublish({ ctx, impls: g.impls, dryRun: false, step: "filebase" });
    expect(report.ok).toBe(false);
    expect(g.calls).toEqual([false]);
    expect(g.h.cli).not.toHaveBeenCalled();
  });

  it("a PASS writes a receipt with the manifest CID; the gate runs local-or-remote first", async () => {
    const { ctx } = await realContext();
    const g = gated(ctx, () => passingSummary());
    const report = await runPublish({ ctx, impls: g.impls, dryRun: false, step: "gate" });
    expect(report.ok).toBe(true);
    expect(g.calls).toEqual([false]);
    const receipt = JSON.parse(readFileSync(gateReceiptPath(ctx, false), "utf8"));
    expect(receipt).toMatchObject({
      manifestCid: ctx.manifestCid,
      result: "PASS",
      remoteOnly: false,
    });
    expect(receipt.summary.v_roofing_permit).toBe(307);
  });

  it("a gate receipt for another manifest CID is ignored and the gate runs again", async () => {
    const { ctx } = await realContext();
    const other = (await runFixture()).baseCid;
    expect(other).not.toBe(ctx.manifestCid);
    put(
      gateReceiptPath(ctx, false),
      JSON.stringify({ manifestCid: other, result: "PASS", remoteOnly: false }),
    );
    const g = gated(ctx, () => passingSummary());
    const report = await runPublish({ ctx, impls: g.impls, dryRun: false, step: "gate" });
    expect(report.steps[0]?.status).toBe("done");
    expect(g.calls).toEqual([false]);
    // and a stale PASS for another CID cannot rescue a FAIL
    put(
      gateReceiptPath(ctx, false),
      JSON.stringify({ manifestCid: other, result: "PASS", remoteOnly: false }),
    );
    const failing = gated(ctx, () => failingSummary());
    const refused = await runPublish({ ctx, impls: failing.impls, dryRun: false });
    expect(refused.ok).toBe(false);
    expect(failing.h.cli).not.toHaveBeenCalled();
  });

  it("a receipt for this CID is honored: the gate is not run twice", async () => {
    const { ctx } = await realContext();
    const g = gated(ctx, () => passingSummary());
    await runPublish({ ctx, impls: g.impls, dryRun: false, step: "gate" });
    const again = await runPublish({ ctx, impls: g.impls, dryRun: false, step: "gate" });
    expect(again.steps[0]?.status).toBe("already-done");
    expect(g.calls).toEqual([false]);
  });

  it("a FAIL at gate-remote stops before release and index (fake steps)", async () => {
    const { ctx } = await realContext();
    const state = fresh();
    state["gate-remote"].fail = true;
    const { impls, executed } = fakeImpls(state);
    const report = await runPublish({ ctx, impls, dryRun: false });
    expect(report.ok).toBe(false);
    expect(executed).toEqual([
      "gate",
      "filebase",
      "car-files",
      "manifest",
      "cid-copy",
      "gate-remote",
    ]);
    expect(executed).not.toContain("release");
    expect(executed).not.toContain("index");
  });

  it("gate-remote binds remote-only and a FAIL there creates no release (real steps)", async () => {
    const { ctx } = await realContext();
    const g = gated(ctx, (remote) => (remote ? failingSummary() : passingSummary()));
    const report = await runPublish({ ctx, impls: g.impls, dryRun: false, step: "release" });
    expect(g.calls).toEqual([false, true]);
    expect(report.ok).toBe(false);
    expect(report.steps.at(-1)).toMatchObject({ step: "gate-remote", status: "failed" });
    expect(g.create).not.toHaveBeenCalled();
    expect(existsSync(join(ctx.repoRoot, "runs/index.json"))).toBe(true);
    expect(readFileSync(join(ctx.repoRoot, "runs/index.json"), "utf8")).not.toContain(ctx.runId);
  });

  it("a pilot still runs both gates", async () => {
    const { ctx } = await realContext({ pilot: true, runId: "travis-full-run2-trial-20261024" });
    const g = gated(ctx, () => passingSummary());
    const report = await runPublish({ ctx, impls: g.impls, dryRun: false, step: "gate-remote" });
    expect(report.ok).toBe(true);
    expect(g.calls).toEqual([false, true]);
    rmSync(ctx.receiptsDir, { recursive: true, force: true });
    const pilotFail = gated(ctx, (remote) => (remote ? failingSummary() : passingSummary()));
    const failed = await runPublish({
      ctx,
      impls: pilotFail.impls,
      dryRun: false,
      step: "gate-remote",
    });
    expect(failed.ok).toBe(false);
    expect(failed.steps.at(-1)).toMatchObject({ step: "gate-remote", status: "failed" });
  });

  it("a dry run on FAIL runs the gate for real, reports refusal, uploads and writes nothing", async () => {
    const { ctx } = await realContext();
    const g = gated(ctx, () => failingSummary());
    const report = await runPublish({ ctx, impls: g.impls, dryRun: true });
    expect(g.calls).toEqual([false]);
    expect(report.ok).toBe(false);
    expect(report.refused).toBe(true);
    const text = formatReport(report).join("\n");
    expect(text).toContain("gate FAIL");
    expect(text).toContain("REFUSED");
    expect(g.h.cli).not.toHaveBeenCalled();
    expect(existsSync(ctx.receiptsDir)).toBe(false);
  });

  it("a dry run on PASS reports PASS, even with a receipt already on disk, and defers gate-remote until the copy exists", async () => {
    const { ctx } = await realContext();
    const g = gated(ctx, () => passingSummary());
    const report = await runPublish({ ctx, impls: g.impls, dryRun: true });
    expect(g.calls).toEqual([false]);
    expect(report.ok).toBe(true);
    expect(report.refused).toBeUndefined();
    expect(report.steps[0]).toMatchObject({ step: "gate", status: "checked" });
    expect(report.steps[0]?.gate?.result).toBe("PASS");
    const remote = report.steps.find((s) => s.step === "gate-remote");
    expect(remote?.deferred).toMatch(/after cid-copy/);
    expect(formatReport(report).join("\n")).toContain("gate PASS (v_roofing_permit 307");
  });
});

describe("publish-run arguments: no flag skips a gate", () => {
  const base = ["--manifest", "m.json", "--run-id", "r", "--copy-host", "h.example"];

  it.each([["--force"], ["--skip-gate"], ["--no-gate"], ["--skip", "gate"], ["--gate=off"]])(
    "rejects %s",
    (...flag) => {
      expect(() => parsePublishArgs([...base, ...flag])).toThrow();
    },
  );

  it("accepts the documented flags, takes the copy host from the flag or CID_COPY_HOST", () => {
    expect(parsePublishArgs([...base, "--dry-run", "--probe", "--pilot"])).toMatchObject({
      dryRun: true,
      probe: true,
      pilot: true,
      copyHost: "h.example",
    });
    expect(
      parsePublishArgs(["--manifest", "m.json", "--run-id", "r"], { CID_COPY_HOST: "env.example" })
        .copyHost,
    ).toBe("env.example");
  });

  it("requires a copy host (the gate reads the CID copy) and keeps the --step validation", () => {
    expect(() => parsePublishArgs(["--manifest", "m.json", "--run-id", "r"])).toThrow(/copy-host/);
    expect(() => parsePublishArgs([...base, "--step", "nope"])).toThrow(/--step must be one of/);
    expect(() => parsePublishArgs([...base, "--probe"])).toThrow(/only applies to --dry-run/);
  });

  it("lists both gate steps in the fixed order", () => {
    expect(PUBLISH_STEPS).toEqual([
      "gate",
      "filebase",
      "car-files",
      "manifest",
      "cid-copy",
      "gate-remote",
      "release",
      "index",
    ]);
  });
});
