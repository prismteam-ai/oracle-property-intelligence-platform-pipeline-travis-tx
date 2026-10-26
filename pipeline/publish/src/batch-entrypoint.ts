// T029 (US3, G-RUN wave 2): the Fargate/batch task's entrypoint — a non-interactive
// `publishRun`-equivalent (contracts/publish-sequence.md "Fargate batch-task entrypoint
// contract"). research.md's resolved disagreement (AD wins; otherwise the area owner decides —
// oracle owns publication/runs): this path is gated by the six-step sequence's own readback
// checks, never a human D-8 approval. It therefore does NOT call upload.ts's `publishRun`, which
// requires `--approved` (the PO's SHA-256 of reports/public-files.json, CR-A-03 F-4's interactive
// design) — that path is untouched, for the human-operated CLI exactly as it is today.
//
// This file composes the same already-exported building blocks `publishRun` does (sequence.ts's
// `runPublish`, readback.ts's `readbackGroup`/`readbackFile`, kubo-add.ts, manifest.ts's
// `buildManifest`, runs-index.ts) into the non-interactive equivalent: run every group's six
// steps in one pass (build + upload, no separate approval step), read every upload back from the
// gateway using THIS run's own just-produced local files as the ground truth (never an approved
// listing — there is no human approval step on this path), add each CAR/tables.car and the
// manifest itself as plain pinned files with the same gateway readback (AM-05), then write
// runs/<runId>/manifest.json and runs/index.json only after every one of those checks passed,
// reading both back from disk before reporting success. A failure at any stage before the final
// index write leaves no manifest and no index entry (FR-001 failed-mid-publish semantics,
// research.md/incremental/delta.ts's T022 commit-gating).
//
// Per the Fargate entrypoint contract's own table: DB credentials, bucket/CloudFront names,
// pinning credentials and the watermark are all read by the CALLER (the ECS task, outside this
// package) before building BatchPublishOptions — never inside pipeline/publish, which stays free
// of the Query DB (no database client or connection-string import anywhere in this file,
// confirmed by the same repo-wide check manifest.test.ts runs on every src/*.ts file).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative } from "node:path";
import type { ManifestProfile, RunsIndexV1 } from "@countylens/contract";
import { cidOfBytes, cidOfFile } from "./cid.js";
import { buildManifest, type BuildManifestInput, type BuiltManifest } from "./manifest.js";
import { kuboAddBytes, kuboAddFile, type FetchLike, type KuboAddOptions } from "./kubo-add.js";
import {
  readbackFile,
  readbackGroup,
  type FileReadback,
  type ReadbackOptions,
  type ReadbackResult,
} from "./readback.js";
import { appendRun, emptyRunsIndex, parseRunsIndex, runsIndexBytes } from "./runs-index.js";
import { runPublish, type CliRunner, type DataGroup, type SequenceReport } from "./sequence.js";
import { loadRunSummary, runGroups, type RunSummaryFile } from "./upload.js";

export { DATA_GROUPS, loadRunSummary, runGroups } from "./upload.js";

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Same shape upload.ts's private `profilesOf` builds (not exported there; duplicated here as a
 *  small, pure read of summary.json's own fields — not a reimplementation of any upload logic). */
function profilesOf(summary: RunSummaryFile): ManifestProfile[] {
  return summary.profiles.map((p) => {
    if (p.gitCommit === null)
      throw new Error(`profile ${p.name}@${p.version} has no gitCommit; run from a git checkout`);
    return {
      name: p.name,
      version: p.version,
      sha256: p.sha256,
      path: p.path,
      gitCommit: p.gitCommit,
    };
  });
}

export interface BatchPublishOptions {
  /** pipeline/data/runs/<runId> (gitignored). */
  runDir: string;
  /** The committed runs/ directory (runs/<runId>/manifest.json, runs/index.json). */
  runsDir: string;
  repoRoot: string;
  /** The child env: credentials live here and nowhere else. No `approved` field exists on this
   *  interface — this path has no human-approval gate (research.md's resolved disagreement). */
  env: NodeJS.ProcessEnv;
  run?: CliRunner;
  fetch?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  /** Kubo RPC API origin for the plain-file adds (default: Filebase). */
  api?: string;
  /** `git status --porcelain --untracked-files=no` output; injectable for tests and for a
   *  Fargate checkout that is not expected to carry its own `.git` (the ephemeral task image). */
  workTreeStatus?: (repoRoot: string) => string;
}

export type BatchPublishStage =
  "sequence" | "readback" | "car-add" | "car-readback" | "manifest" | "manifest-add" | "index";

export interface BatchPublishFailure {
  stage: BatchPublishStage;
  reason: string;
}

export interface BatchCarAdd {
  group: DataGroup;
  /** Path relative to the run directory (the manifest's artifact name). */
  name: string;
  cid: string;
  size: number;
  readback?: Pick<FileReadback, "size" | "sha256" | "ok">;
}

export interface BatchPublishResult {
  ok: boolean;
  runId: string;
  sequence: SequenceReport;
  readback: ReadbackResult[];
  carAdds: BatchCarAdd[];
  manifestCid?: string;
  manifestPath?: string;
  indexPath?: string;
  failed?: BatchPublishFailure;
}

/**
 * The Fargate task's entrypoint: every group's six steps (build + upload in one pass, no
 * separate approval), then gateway readback gated on THIS run's own local files (no
 * `--approved` listing), then the manifest and the run index, written only once every check
 * above passed and read back from disk. Throws (before any network write) only when `runId` is
 * already published — a run is published once, on this path exactly as on the interactive one.
 */
export async function runBatchPublish(options: BatchPublishOptions): Promise<BatchPublishResult> {
  const summary = loadRunSummary(options.runDir);
  const groups = runGroups(summary);
  const profiles = profilesOf(summary);
  const indexPath = join(options.runsDir, "index.json");
  const index = existsSync(indexPath) ? parseRunsIndex(readFileSync(indexPath)) : emptyRunsIndex();
  if (index.runs.some((r) => r.runId === summary.runId))
    throw new Error(`run ${summary.runId} is already in ${indexPath}; a run is published once`);
  const previousManifestCid = index.runs.at(-1)?.manifestCid ?? null;

  const readback: ReadbackResult[] = [];
  const carAdds: BatchCarAdd[] = [];
  const fail = (
    sequence: SequenceReport,
    stage: BatchPublishStage,
    reason: string,
  ): BatchPublishResult => ({
    ok: false,
    runId: summary.runId,
    sequence,
    readback,
    carAdds,
    failed: { stage, reason },
  });

  // 1 Every group's six steps, build and upload in one pass (sequence.ts's `runPublish`): no
  //   separate approval step exists on this path.
  const sequence = await runPublish({
    county: summary.county.slug,
    runDir: options.runDir,
    groups,
    repoRoot: options.repoRoot,
    env: options.env,
    ...(options.run === undefined ? {} : { run: options.run }),
  });
  if (!sequence.ok) {
    const f = sequence.failed;
    return fail(
      sequence,
      "sequence",
      f === undefined
        ? "the sequence did not finish"
        : `${f.group} ${f.step}: ${f.reason}${f.stderr === "" ? "" : `\n${f.stderr}`}`,
    );
  }

  // 2 Readback of every group's upload from the gateway, against THIS run's own local files —
  //   never an approved listing (no `options.approved` exists to pass here).
  const readbackOptions: ReadbackOptions = {
    env: options.env,
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    ...(options.sleep === undefined ? {} : { sleep: options.sleep }),
    ...(options.random === undefined ? {} : { random: options.random }),
  };
  for (const g of sequence.groups) readback.push(await readbackGroup(g, readbackOptions));
  const bad = readback.filter((r) => !r.ok);
  if (bad.length > 0)
    return fail(
      sequence,
      "readback",
      bad.map((r) => `${r.group}: ${r.problems.join("; ")}`).join("\n"),
    );

  // 3 Each .car (archive and tables.car) as a plain pinned file (the manifest's carCid, AM-05),
  //   read back from the gateway before any further step.
  const addOptions: KuboAddOptions = {
    env: options.env,
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    ...(options.api === undefined ? {} : { api: options.api }),
  };
  for (const g of sequence.groups) {
    for (const path of [g.carPath, join(g.tablesDir, "tables.car")]) {
      const name = relative(options.runDir, path);
      let added;
      try {
        added = await kuboAddFile(path, await cidOfFile(path), addOptions);
      } catch (error) {
        return fail(sequence, "car-add", `${name}: ${message(error)}`);
      }
      const back = await readbackFile(added.cid, path, readbackOptions);
      carAdds.push({
        group: g.group,
        name,
        cid: added.cid,
        size: added.size,
        readback: { size: back.size, sha256: back.sha256, ok: back.ok },
      });
      if (!back.ok) return fail(sequence, "car-readback", `${name}: ${back.reason ?? "mismatch"}`);
    }
  }

  // 4 The manifest, from the sequence's own outputs, the receipts and the summary — never a
  //   database. Chains to the last committed run (or starts its own chain, Run 1).
  const input: BuildManifestInput = {
    runId: summary.runId,
    county: summary.county.slug,
    state: summary.county.state,
    fips: summary.county.fips,
    startedAt: summary.startedAt,
    finishedAt: summary.finishedAt,
    previousManifestCid,
    runDir: options.runDir,
    groups: sequence.groups.map((g) => ({
      group: g.group,
      carPath: g.carPath,
      carRoot: g.carRoot,
      tablesDir: g.tablesDir,
      tablesRoot: g.tablesRoot,
      tablesExportJson: g.tablesExportJson,
    })),
    sources: summary.sources.map((s) => ({
      name: s.name,
      url: s.url,
      watermark: s.watermark,
      receipts: isAbsolute(s.receipts) ? s.receipts : join(options.runDir, s.receipts),
      limitations: [...s.limitations],
    })),
    profiles,
    coverage: summary.coverage,
    ownersRedacted: summary.owners_redacted,
    limitations: [...summary.limitations],
    repoRoot: options.repoRoot,
    ...(options.workTreeStatus === undefined ? {} : { workTreeStatus: options.workTreeStatus }),
  };
  let built: BuiltManifest;
  try {
    built = await buildManifest(input);
  } catch (error) {
    return fail(sequence, "manifest", message(error));
  }
  const added = new Set(carAdds.map((a) => a.cid));
  const unpinned = built.manifest.artifacts.filter(
    (a) => (a.kind === "car" || a.kind === "directory") && !added.has(a.carCid ?? ""),
  );
  if (unpinned.length > 0)
    return fail(
      sequence,
      "manifest",
      `carCid not added for ${unpinned.map((a) => a.name).join(", ")}`,
    );

  // 5 The manifest itself, by its exact bytes; the Hash must equal cidOfBytes.
  try {
    await kuboAddBytes(built.bytes, "manifest.json", built.cid, addOptions);
  } catch (error) {
    return fail(sequence, "manifest-add", message(error));
  }

  // 6 runs/<runId>/manifest.json and runs/index.json, written only now, then read back from
  //   disk before this function reports success — the last stage where a failure leaves neither
  //   file behind (T022's failed-mid-publish contract).
  let next: RunsIndexV1;
  try {
    next = appendRun(index, {
      runId: summary.runId,
      manifestCid: built.cid,
      finishedAt: built.manifest.finishedAt,
    });
  } catch (error) {
    return fail(sequence, "index", message(error));
  }
  const manifestPath = join(options.runsDir, summary.runId, "manifest.json");
  mkdirSync(dirname(manifestPath), { recursive: true });
  writeFileSync(manifestPath, built.bytes);
  writeFileSync(indexPath, runsIndexBytes(next));
  const writtenCid = await cidOfBytes(readFileSync(manifestPath));
  if (writtenCid !== built.cid)
    return fail(sequence, "index", `${manifestPath} reads back as ${writtenCid}, not ${built.cid}`);
  const listed = parseRunsIndex(readFileSync(indexPath)).runs.find(
    (r) => r.runId === summary.runId,
  );
  if (listed?.manifestCid !== built.cid)
    return fail(sequence, "index", `${indexPath} does not list ${summary.runId} with ${built.cid}`);
  return {
    ok: true,
    runId: summary.runId,
    sequence,
    readback,
    carAdds,
    manifestCid: built.cid,
    manifestPath,
    indexPath,
  };
}
