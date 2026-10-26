// The runner: the SAME gated path as Run 3, orchestrated as an ordered list of atomic steps.
//
//   preflight -> capture-merge (AustinPermits incremental via the Restate ingress, keyed by the
//   command ID) -> pre-link-facts -> link -> final-facts -> reexport (affected permit folders)
//   -> batches (5 permit batches, county group reused) -> manifest (build-run-manifest.ts)
//   -> publish (publish-run.ts: gate, filebase, car-files, manifest, cid-copy, gate-remote,
//      release, index; one invocation per step so a Stop can land between them).
//
// dry_run passes --dry-run to publish-run.ts: every earlier local step runs, the identity gate runs
// for real (read-only), and nothing is uploaded. There is no skip or force flag anywhere, and the
// bridge never calls an upload or side script: publish-run.ts is the only thing that publishes,
// and `--step X` always runs the gate first inside it.
//
// A Stop is checked between steps only (StopFlag.checkpoint), never inside one.
import type { RunCommandV1 } from "@countylens/contract";
import type { LiveStatus } from "./live.js";
import { StoppedByAdmin, type StopFlag } from "./stop.js";
import type { CommandRunner, Logger, RunOutcome } from "./types.js";

export const PUBLISH_STEP_ORDER = [
  "gate",
  "filebase",
  "car-files",
  "manifest",
  "cid-copy",
  "gate-remote",
  "release",
  "index",
] as const;

export interface ExecSpec {
  /** Step name, for the log file name. */
  label: string;
  cmd: string;
  args: string[];
  cwd: string;
}

export interface Files {
  readText(path: string): string | undefined;
  writeText(path: string, text: string): void;
  exists(path: string): boolean;
}

export interface RestateRunner {
  /** Starts AustinPermits.run for `key` (idempotent per key) and waits for its output. */
  runIncremental(jobId: string, key: string): Promise<{ status: string; exitCode: number }>;
}

export interface RunnerConfig {
  repoRoot: string;
  /** pipeline/data/bridge */
  bridgeDir: string;
  /** Last published run's county batches (BRIDGE_COUNTY_DIR); falls back to state.json. */
  countyDir?: string | undefined;
  /** Last permits job under dataRunsDir (BRIDGE_PERMITS_SEED_JOB); falls back to state.json. */
  permitsSeedJob?: string | undefined;
  dataRunsDir: string;
  run1PidsFile: string;
  /** Extra build-run-manifest --config file (coverageOverrides). */
  manifestConfig?: string | undefined;
  /** CID copy host for publish-run.ts (--copy-host); CID_COPY_HOST is also read by the script. */
  copyHost?: string | undefined;
  /**
   * Earlier release tags whose identical CAR assets the release step reuses instead of
   * re-uploading (BRIDGE_RELEASE_REUSE_TAGS, comma-separated; Run 4 passed Run 3.1's and Run 3's).
   */
  releaseReuseTags?: readonly string[] | undefined;
  /** Branch the release tag points at (BRIDGE_RELEASE_TARGET; default: the current branch). */
  releaseTarget?: string | undefined;
}

export interface RunnerDeps {
  config: RunnerConfig;
  exec: (spec: ExecSpec) => Promise<number>;
  restate: RestateRunner;
  files: Files;
  now: () => Date;
  live: LiveStatus;
  stop: StopFlag;
  log: Logger;
  onStep?: (name: string) => void;
}

const ymd = (d: Date): string => d.toISOString().slice(0, 10).replace(/-/g, "");

export function runIdFor(cmd: RunCommandV1, at: Date): string {
  const prefix = cmd.mode === "dry_run" ? "travis-dryrun" : "travis-incr";
  return `${prefix}-${ymd(at)}-${cmd.commandId.slice(0, 8).toLowerCase()}`;
}

class StepFailed extends Error {}

interface State {
  permitsSeedJob?: string;
  countyDir?: string;
}

export function createRunner(deps: RunnerDeps): CommandRunner {
  const { config: c, files, live, stop, log } = deps;
  const localStack = `${c.repoRoot}/pipeline/local-stack`;

  return async (cmd: RunCommandV1): Promise<RunOutcome> => {
    // Retry resumes the run it names (same run id, work folder, permits job and Restate workflow);
    // progress.json lists the steps already finished, so none of them (a 35 minute capture, the
    // pre-link facts that must precede the link) runs twice.
    let runId: string;
    if (cmd.action === "retry") {
      const target = cmd.targetRunId ?? "";
      const wanted = cmd.mode === "dry_run" ? "dryrun" : "incr";
      if (!new RegExp(`^travis-${wanted}-\\d{8}-[0-9a-f]{8}$`).test(target))
        return {
          outcome: "failed",
          runId: null,
          reason: `retry names ${target || "no run"}, which is not a ${cmd.mode} run the bridge started`,
        };
      runId = target;
    } else {
      runId = runIdFor(cmd, deps.now());
    }
    const workDir = `${c.bridgeDir}/work/${runId}`;
    const progressPath = `${workDir}/progress.json`;
    const progress = readProgress(progressPath);
    const startedAt = progress === undefined ? deps.now() : new Date(progress.startedAt);
    const done = new Set(progress?.done ?? []);
    // A Restate workflow runs once per key, so a retry after a failed capture needs a new key
    // (machamp review M2): failed capture attempts are counted in progress.json.
    let captureAttempts = progress?.captureAttempts ?? 0;
    const saveProgress = (): void =>
      files.writeText(
        progressPath,
        `${JSON.stringify({ startedAt: startedAt.toISOString(), done: [...done], captureAttempts }, null, 2)}\n`,
      );
    // The Restate job id must match /^travis-a04-[a-z0-9-]+$/; derived from the run id so a retry
    // attaches to the same durable workflow instead of starting a new capture.
    const jobId = `travis-a04-permits-incremental-${runId.replace(/^travis-(incr|dryrun)-/, "").replace(/-/g, "")}`;
    const baseKey = `austin-3syk-w9eu-${jobId.replace(/^travis-a04-permits-/, "")}`;
    const keyFor = (attempts: number): string =>
      attempts === 0 ? baseKey : `${baseKey}-a${attempts}`;
    const permitsJob = `travis-a11-permits-${runId}`;
    const permitsDir = `${c.dataRunsDir}/${permitsJob}`;
    const manifestRel = `runs/${runId}/manifest.json`;

    interface Pre {
      base: { runId: string; manifestCid: string };
      countyDir: string;
      seedJob: string;
    }
    let preflight: Pre | undefined;
    const pre = (): Pre => {
      if (preflight === undefined) throw new StepFailed("preflight has not run");
      return preflight;
    };

    const sh = async (
      label: string,
      command: string,
      args: string[],
      cwd: string,
    ): Promise<void> => {
      const code = await deps.exec({ label, cmd: command, args, cwd });
      if (code !== 0) throw new StepFailed(`step ${label} exited ${code}`);
    };
    const publishArgs = (extra: string[]): string[] => [
      "tsx",
      "pipeline/publish/scripts/publish-run.ts",
      "--manifest",
      manifestRel,
      "--run-id",
      runId,
      ...(c.copyHost === undefined ? [] : ["--copy-host", c.copyHost]),
      ...extra,
    ];

    // The release step's options, as Run 4's p9-publish.sh passed them.
    const releaseArgs = [
      ...(c.releaseReuseTags ?? []).flatMap((tag) => ["--release-reuse-tag", tag]),
      ...(c.releaseTarget === undefined ? [] : ["--release-target", c.releaseTarget]),
    ];

    const steps: { name: string; run: () => Promise<void> }[] = [
      {
        name: "preflight",
        run: async () => {
          const state = readState();
          // The saved state (the last run this bridge published) wins; the env only seeds the
          // first run (code-review finding 2: env must never roll the base back).
          const countyDir = state.countyDir ?? c.countyDir;
          const seedJob = state.permitsSeedJob ?? c.permitsSeedJob;
          if (countyDir === undefined)
            throw new StepFailed(
              "BRIDGE_COUNTY_DIR is not set (the last published run's county batches directory)",
            );
          if (seedJob === undefined)
            throw new StepFailed(
              "BRIDGE_PERMITS_SEED_JOB is not set (the last permits job under pipeline/data/runs)",
            );
          const indexText = files.readText(`${c.repoRoot}/runs/index.json`);
          if (indexText === undefined) throw new StepFailed("runs/index.json is missing");
          const runs = (JSON.parse(indexText) as { runs: { runId: string; manifestCid: string }[] })
            .runs;
          // The base is the run the command names (window.sinceRunId); a retry has no window and
          // builds on the newest run. A named run missing from the index fails closed (finding 6).
          const since = cmd.window?.sinceRunId;
          const base =
            since === undefined ? runs[runs.length - 1] : runs.find((r) => r.runId === since);
          if (base === undefined)
            throw new StepFailed(
              since === undefined
                ? "runs/index.json has no runs to build on"
                : `the command's base run ${since} is not in runs/index.json`,
            );
          preflight = { base, countyDir, seedJob };
        },
      },
      {
        name: "capture-merge",
        run: async () => {
          const out = await deps.restate.runIncremental(jobId, keyFor(captureAttempts));
          if (out.exitCode !== 0) {
            captureAttempts += 1;
            saveProgress();
          }
          if (out.exitCode === 2)
            throw new StepFailed(
              `capture blocked by the source or waiting for a human (status ${out.status}); not retried`,
            );
          if (out.exitCode !== 0)
            throw new StepFailed(`capture-merge ended ${out.status} (exit ${out.exitCode})`);
        },
      },
      {
        name: "pre-link-facts",
        run: () =>
          sh(
            "pre-link-facts",
            "npx",
            ["tsx", "scripts/incremental-facts.ts", "pre-link", "--job", jobId, "--out", workDir],
            localStack,
          ),
      },
      {
        name: "link",
        run: () =>
          sh(
            "link",
            "npm",
            ["--prefix", "pipeline/oracle-runtime", "run", "backbone", "--", "permits", "--link"],
            c.repoRoot,
          ),
      },
      {
        name: "final-facts",
        run: () =>
          sh(
            "final-facts",
            "npx",
            [
              "tsx",
              "scripts/incremental-facts.ts",
              "final",
              "--job",
              jobId,
              "--out",
              workDir,
              "--base-manifest",
              `${c.repoRoot}/runs/${pre().base.runId}/manifest.json`,
            ],
            localStack,
          ),
      },
      {
        name: "reexport",
        run: async () => {
          if (!files.exists(permitsDir)) {
            await sh(
              "seed-permits",
              "cp",
              ["-Rl", `${c.dataRunsDir}/${pre().seedJob}`, permitsDir],
              c.repoRoot,
            );
          }
          const affected = files.readText(`${workDir}/affected-pids.txt`);
          const run1 = files.readText(c.run1PidsFile);
          if (affected === undefined || run1 === undefined)
            throw new StepFailed("affected-pids.txt or the Run 1 pID list is missing");
          const union = [
            ...new Set(
              [...run1.split("\n"), ...affected.split("\n")]
                .map((s) => s.trim())
                .filter((s) => s !== ""),
            ),
          ].sort();
          const pidsFile = `${workDir}/run-pids.txt`;
          files.writeText(pidsFile, `${union.join("\n")}\n`);
          await sh(
            "reexport",
            "npx",
            [
              "tsx",
              "scripts/reexport-permits.ts",
              "--pids",
              pidsFile,
              "--job",
              permitsJob,
              "--chunk",
              "500",
              "--concurrency",
              "4",
            ],
            localStack,
          );
        },
      },
      {
        name: "batches",
        run: () =>
          sh(
            "batches",
            "bash",
            [
              `${c.repoRoot}/pipeline/publish/scripts/batch-hash-validate-export.sh`,
              `${permitsDir}/groups/property_improvement`,
              `${permitsDir}/publish/permits-batched`,
              "5",
              "2",
              "travis-permits",
            ],
            c.repoRoot,
          ),
      },
      {
        name: "manifest",
        run: () =>
          sh(
            "manifest",
            "npx",
            [
              "tsx",
              "pipeline/publish/scripts/build-run-manifest.ts",
              ...(c.manifestConfig === undefined ? [] : ["--config", c.manifestConfig]),
              "--run-id",
              runId,
              "--started-at",
              startedAt.toISOString(),
              "--finished-at",
              deps.now().toISOString(),
              "--previous-manifest-cid",
              pre().base.manifestCid,
              "--base",
              `runs/${pre().base.runId}/manifest.json`,
              "--county-dir",
              pre().countyDir,
              "--permits-dir",
              `${permitsDir}/publish/permits-batched`,
              "--austin-facts",
              `${workDir}/austin-facts.json`,
              "--austin-receipt",
              `${workDir}/austin-receipt.json`,
            ],
            c.repoRoot,
          ),
      },
      ...(cmd.mode === "dry_run"
        ? [
            {
              name: "publish-dry-run",
              run: () => sh("publish-dry-run", "npx", publishArgs(["--dry-run"]), c.repoRoot),
            },
          ]
        : PUBLISH_STEP_ORDER.flatMap((step) => {
            const publish = {
              name: `publish-${step}`,
              run: () =>
                sh(
                  `publish-${step}`,
                  "npx",
                  publishArgs(["--step", step, ...(step === "release" ? releaseArgs : [])]),
                  c.repoRoot,
                ),
            };
            // machamp review M1: a bridge-published run gets its Explore index right after the
            // CID copy holds its parts, before the run is listed, so it is searchable at once.
            if (step !== "cid-copy") return [publish];
            return [
              publish,
              {
                name: "explore-index",
                run: () =>
                  sh(
                    "explore-index",
                    "npx",
                    [
                      "tsx",
                      "pipeline/publish/scripts/build-explore-index.ts",
                      "--manifest",
                      manifestRel,
                      "--source",
                      "cidcopy",
                      "--work-dir",
                      `${workDir}/explore-index`,
                      "--verify",
                      "--upload",
                      ...(c.copyHost === undefined ? [] : ["--copy-host", c.copyHost]),
                    ],
                    c.repoRoot,
                  ),
              },
            ];
          })),
    ];

    function readProgress(
      path: string,
    ): { startedAt: string; done: string[]; captureAttempts: number } | undefined {
      const text = files.readText(path);
      if (text === undefined) return undefined;
      try {
        const parsed = JSON.parse(text) as {
          startedAt?: unknown;
          done?: unknown;
          captureAttempts?: unknown;
        };
        if (typeof parsed.startedAt !== "string" || !Array.isArray(parsed.done)) return undefined;
        const attempts = typeof parsed.captureAttempts === "number" ? parsed.captureAttempts : 0;
        return {
          startedAt: parsed.startedAt,
          done: parsed.done.map(String),
          captureAttempts: attempts,
        };
      } catch {
        return undefined;
      }
    }

    function readState(): State {
      const text = files.readText(`${c.bridgeDir}/state.json`);
      if (text === undefined) return {};
      try {
        return JSON.parse(text) as State;
      } catch {
        return {};
      }
    }

    try {
      for (const step of steps) {
        // preflight only reads state, so it always runs; every other finished step is skipped
        if (step.name !== "preflight" && done.has(step.name)) {
          log(`run ${runId}: step ${step.name} already done, skipping`);
          continue;
        }
        stop.checkpoint(step.name);
        deps.onStep?.(step.name);
        await live.update({ runId, step: step.name });
        log(`run ${runId}: step ${step.name}`);
        await step.run();
        if (step.name !== "preflight") {
          done.add(step.name);
          saveProgress();
        }
      }
      if (cmd.mode === "publish") {
        files.writeText(
          `${c.bridgeDir}/state.json`,
          `${JSON.stringify({ permitsSeedJob: permitsJob, countyDir: pre().countyDir }, null, 2)}\n`,
        );
      }
      return { outcome: "succeeded", runId };
    } catch (error) {
      if (error instanceof StoppedByAdmin) return { outcome: "stopped", runId };
      const reason = error instanceof Error ? error.message : String(error);
      log(`run ${runId}: failed: ${reason}`);
      return { outcome: "failed", runId, reason };
    }
  };
}
