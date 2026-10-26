// publishRun: the `upload` command (contracts/cli.md; research R-06; FR-001), after PO decision
// D-8 only, for the exact build the PO approved. In order:
//   0 verifyApprovedBuild (approval.ts): reports/public-files.json must hash to `approved`, and
//     every build output and public file on disk must still be what reports/sequence-build.json
//     and the listing record (size, SHA-256, CID, CAR roots), else ApprovalError/BuildDriftError
//     before any upload. Phase 1 is never re-run here and the build report never rewritten;
//   1 runUpload: the four uploads only (reports/sequence-upload.json);
//   2 readback of every group (readback.ts): roots by digest, part count, every part by its
//     APPROVED CID, size and SHA-256 from the Filebase gateway (F-5; a part changed on disk
//     after step 0 fails even if the gateway serves the changed bytes);
//   3 Kubo add of each .car (the archive and the tables.car of every group) as a plain pinned
//     file; the Hash must be the local raw-leaves CIDv1, which the manifest records as carCid
//     (AM-05, D-5); then that carCid is read back from the Filebase gateway by size and SHA-256
//     (OR-4);
//   4 buildManifest from the CLI outputs, the capture receipts and summary.json (never a
//     database); every carCid it records must be one of the adds of step 3;
//   4b the bind guard (bind-guard.ts, CR-A-03 F-1): the built bytes are bound against the
//     LOCAL tables with the real query-core bindManifest; listRoofingPermitsSql() and
//     runSummarySql() must return coverage.permits_emitted rows, else BindGuardError (stage
//     `bind`) and no manifest add;
//   5 Kubo add of the manifest's JCS bytes; the Hash must equal cidOfBytes;
//   6 runs/<runId>/manifest.json (the exact bytes) and runs/index.json (appendRun, exact JCS
//     bytes), written only now and read back from disk before the result says ok.
// A failure before step 6 leaves no manifest and no index. Pre-flight problems (preflight(),
// OR-14: no summary, no owners_redacted, a profile without a commit, a runId already in the
// index, Filebase credentials incomplete or shadowed by IPFS_API_TOKEN, a dirty working tree, a
// recorded profiles[].gitCommit that is not HEAD, no approval or a drifted build) throw before
// the first CLI call or network write. Credentials live in `env` (the child env) only; reports/*.json carry CIDs,
// paths, sizes and digests, with every secret value redacted.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative } from "node:path";
import { z } from "zod";
import { CoverageCount, type ManifestProfile, type RunsIndexV1 } from "@countylens/contract";
import { cidOfBytes, cidOfFile } from "./cid.js";
import { approvedGroups, builtGroups, verifyApprovedBuild, type PublicFile } from "./approval.js";
import { assertBindable, type BoundRows, type LocalBinder } from "./bind-guard.js";
import { kuboAddBytes, kuboAddFile, type FetchLike, type KuboAddOptions } from "./kubo-add.js";
import { buildManifest, type BuildManifestInput, type BuiltManifest } from "./manifest.js";
import {
  readbackFile,
  readbackGroup,
  type FileReadback,
  type ReadbackOptions,
  type ReadbackResult,
} from "./readback.js";
import { appendRun, emptyRunsIndex, parseRunsIndex, runsIndexBytes } from "./runs-index.js";
import {
  FILEBASE_GATEWAY,
  FILEBASE_RPC_API,
  filebaseEnvProblem,
  redact,
  runUpload,
  secretValues,
  sha256File,
  type CliRunner,
  type DataGroup,
  type GroupResult,
  type SequenceReport,
} from "./sequence.js";

export { publicFiles } from "./approval.js";

/** The data groups A-03 publishes, in CAR order (agent-design oracle § 2). */
export const DATA_GROUPS: readonly DataGroup[] = ["county", "property_improvement"];

const RUN_ID = /^[a-z0-9][a-z0-9-]*$/;

/** The parts of run-month.ts's summary.json the publication needs. */
export const RunSummaryFile = z
  .object({
    runId: z
      .string()
      .regex(RUN_ID)
      .refine((id) => !id.includes("pilot"), "a published run is never the pilot"),
    county: z.object({
      slug: z.string().min(1),
      state: z.string().regex(/^[A-Z]{2}$/),
      fips: z.string().regex(/^\d{5}$/),
    }),
    startedAt: z.string().min(1),
    finishedAt: z.string().min(1),
    coverage: z.record(z.string().min(1), CoverageCount),
    /** TCAD confidentiality redactions applied before validate (P0-15, T082); never defaulted. */
    owners_redacted: z.number().int().nonnegative(),
    sources: z.array(
      z
        .object({
          name: z.string().min(1),
          url: z.string().min(1),
          watermark: z.string().nullable(),
          receipts: z.string().min(1),
          limitations: z.array(z.string()),
        })
        .loose(),
    ),
    profiles: z.array(
      z
        .object({
          name: z.string().min(1),
          version: z.string().min(1),
          sha256: z.string().min(1),
          path: z.string().min(1),
          gitCommit: z.string().nullable(),
        })
        .loose(),
    ),
    groups: z.record(z.string(), z.string()),
    limitations: z.array(z.string()),
  })
  .loose();
export type RunSummaryFile = z.infer<typeof RunSummaryFile>;

/** summary.json of a finished run-month.ts run; its runId must name the run directory. */
export function loadRunSummary(runDir: string): RunSummaryFile {
  const path = join(runDir, "summary.json");
  if (!existsSync(path))
    throw new Error(`${path} is missing: run-month.ts did not finish this run`);
  const parsed = RunSummaryFile.safeParse(JSON.parse(readFileSync(path, "utf8")));
  if (!parsed.success) throw new Error(`${path} is not a run summary: ${parsed.error.message}`);
  if (parsed.data.runId !== basename(runDir))
    throw new Error(`${path} is the summary of ${parsed.data.runId}, not ${basename(runDir)}`);
  return parsed.data;
}

/** The known data groups the summary lists, in CAR order. */
export function runGroups(summary: RunSummaryFile): DataGroup[] {
  const unknown = Object.keys(summary.groups).filter(
    (g) => !(DATA_GROUPS as readonly string[]).includes(g),
  );
  if (unknown.length > 0)
    throw new Error(`summary.json lists unknown data groups: ${unknown.join(", ")}`);
  const groups = DATA_GROUPS.filter((g) => summary.groups[g] !== undefined);
  if (groups.length === 0) throw new Error("summary.json lists no data group");
  return groups;
}

export interface PublishOptions {
  /** pipeline/data/runs/<runId> (gitignored). */
  runDir: string;
  /** The committed runs/ directory (runs/<runId>/manifest.json, runs/index.json). */
  runsDir: string;
  repoRoot: string;
  /** The child env: credentials live here and nowhere else. */
  env: NodeJS.ProcessEnv;
  /** The SHA-256 of reports/public-files.json the PO approved at D-8 (`--approved`). */
  approved: string;
  run?: CliRunner;
  fetch?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  workTreeStatus?: (repoRoot: string) => string;
  /** HEAD of `repoRoot` (default `git rev-parse HEAD`); must equal profiles[].gitCommit. */
  headCommit?: (repoRoot: string) => string;
  /** Kubo RPC API origin for the adds (default: Filebase). */
  api?: string;
  /** The bind guard's local binder (default: scripts/local-bind.ts, query-core over DuckDB). */
  bind?: LocalBinder;
}

export type PublishStage =
  | "sequence"
  | "readback"
  | "car-add"
  | "car-readback"
  | "manifest"
  | "bind"
  | "manifest-add"
  | "index";

export interface PublishFailure {
  stage: PublishStage;
  /** Redacted: no secret value from the child environment survives in it. */
  reason: string;
}

export interface CarAdd {
  group: DataGroup;
  /** Path relative to the run directory (the manifest's artifact name). */
  name: string;
  cid: string;
  size: number;
  /** The gateway's bytes for `cid`, compared with the local file (OR-4). */
  readback?: Pick<FileReadback, "size" | "sha256" | "ok">;
}

/** What the upload checked against the D-8 approval before its first step. */
export interface ApprovalCheck {
  publicFilesSha256: string;
  files: number;
  bytes: number;
}

export interface PublishResult {
  ok: boolean;
  runId: string;
  sequence: SequenceReport;
  readback: ReadbackResult[];
  carAdds: CarAdd[];
  approval?: ApprovalCheck;
  /** The bind guard's result for the built manifest (F-1). */
  bind?: BoundRows;
  manifestCid?: string;
  manifestPath?: string;
  indexPath?: string;
  failed?: PublishFailure;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

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

/** Which precondition refused the run (OR-14). */
export type PreflightCheck = "filebase-env" | "work-tree" | "commit";

/** A precondition that refuses the run before the first network write (OR-14). */
export class PreflightError extends Error {
  constructor(
    readonly check: PreflightCheck,
    detail: string,
  ) {
    super(`PreflightError (${check}): ${detail}`);
    this.name = "PreflightError";
  }
}

function gitStatus(repoRoot: string): string {
  return execFileSync("git", ["status", "--porcelain", "--untracked-files=no"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
}

function gitHead(repoRoot: string): string {
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" });
}

export type PreflightOptions = Pick<
  PublishOptions,
  "runDir" | "runsDir" | "repoRoot" | "env" | "approved" | "workTreeStatus" | "headCommit" | "api"
>;

/** Everything publishRun needs that preflight read and checked. */
export interface Preflight {
  summary: RunSummaryFile;
  groups: DataGroup[];
  profiles: ManifestProfile[];
  index: RunsIndexV1;
  indexPath: string;
  previousManifestCid: string | null;
  buildGroups: GroupResult[];
  approval: ApprovalCheck;
  /** Every approved public file (paths relative to the run directory): readback compares with these. */
  approvedFiles: PublicFile[];
}

/**
 * Every precondition that can refuse the run, checked before the first network write (OR-14):
 * the run summary and its profiles, a run not yet in the index, complete Filebase credentials
 * (names only; no value reaches a message), a clean working tree, the recorded
 * profiles[].gitCommit equal to HEAD, and the D-8 approval with no build drift.
 * Throws PreflightError, ApprovalError or BuildDriftError; makes no network call.
 */
export async function preflight(options: PreflightOptions): Promise<Preflight> {
  const summary = loadRunSummary(options.runDir);
  const groups = runGroups(summary);
  const profiles = profilesOf(summary);
  const indexPath = join(options.runsDir, "index.json");
  const index = existsSync(indexPath) ? parseRunsIndex(readFileSync(indexPath)) : emptyRunsIndex();
  if (index.runs.some((r) => r.runId === summary.runId))
    throw new Error(`run ${summary.runId} is already in ${indexPath}; a run is published once`);
  if ((options.api ?? FILEBASE_RPC_API) === FILEBASE_RPC_API) {
    const problem = filebaseEnvProblem(options.env);
    if (problem !== undefined)
      throw new PreflightError("filebase-env", `Filebase credentials: ${problem}`);
  }
  const status = (options.workTreeStatus ?? gitStatus)(options.repoRoot).trim();
  if (status !== "")
    throw new PreflightError(
      "work-tree",
      `working tree is dirty; commit before publishing:\n${status}`,
    );
  const recorded = [...new Set(profiles.map((p) => p.gitCommit))];
  if (recorded.length !== 1)
    throw new PreflightError(
      "commit",
      `summary.json profiles must record exactly one gitCommit, got ${recorded.join(", ") || "none"}`,
    );
  const commit = recorded[0] as string;
  const head = (options.headCommit ?? gitHead)(options.repoRoot).trim();
  if (commit !== head)
    throw new PreflightError(
      "commit",
      `the build was made at ${commit} (summary.json profiles[].gitCommit) but HEAD is ${head}; rebuild at HEAD or check out ${commit}`,
    );
  // The approved build, checked on disk (throws ApprovalError/BuildDriftError).
  const build = await verifyApprovedBuild(options.runDir, options.approved);
  if (build.listing.runId !== summary.runId || build.listing.county !== summary.county.slug)
    throw new Error(
      `the approved build is ${build.listing.county}/${build.listing.runId}, not ${summary.county.slug}/${summary.runId}`,
    );
  return {
    summary,
    groups,
    profiles,
    index,
    indexPath,
    previousManifestCid: index.runs.at(-1)?.manifestCid ?? null,
    buildGroups: approvedGroups(build, groups),
    approval: {
      publicFilesSha256: build.publicFilesSha256,
      files: build.files,
      bytes: build.bytes,
    },
    approvedFiles: build.listing.groups.flatMap((g) => g.files),
  };
}

/** The buildManifest input for a run: summary.json plus the build's group outputs. */
function manifestInput(
  summary: RunSummaryFile,
  runDir: string,
  groups: readonly GroupResult[],
  profiles: ManifestProfile[],
  previousManifestCid: string | null,
  repoRoot: string,
  workTreeStatus?: (repoRoot: string) => string,
): BuildManifestInput {
  return {
    runId: summary.runId,
    county: summary.county.slug,
    state: summary.county.state,
    fips: summary.county.fips,
    startedAt: summary.startedAt,
    finishedAt: summary.finishedAt,
    previousManifestCid,
    runDir,
    groups: groups.map((g) => ({
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
      receipts: isAbsolute(s.receipts) ? s.receipts : join(runDir, s.receipts),
      limitations: [...s.limitations],
    })),
    profiles,
    coverage: summary.coverage,
    ownersRedacted: summary.owners_redacted,
    limitations: [...summary.limitations],
    repoRoot,
    ...(workTreeStatus === undefined ? {} : { workTreeStatus }),
  };
}

export interface BindBuildOptions {
  runDir: string;
  runsDir: string;
  repoRoot: string;
  bind?: LocalBinder;
}

/**
 * The last step of `build` (CR-A-03 F-1): the draft manifest of the finished build (the bytes
 * `upload` would build, linked to the index's last run) bound against the local tables by the
 * bind guard. A run the web engine or the Lambda could not bind fails here, before D-8 is asked.
 * The clean-tree check is left to `upload`: this draft is never written or added.
 */
export async function bindBuild(options: BindBuildOptions): Promise<BoundRows> {
  const summary = loadRunSummary(options.runDir);
  const groups = runGroups(summary);
  const built = builtGroups(options.runDir);
  const ordered = groups.map((name) => {
    const g = built.find((x) => x.group === name);
    if (g === undefined) throw new Error(`the build has no ${name} group`);
    return g;
  });
  const indexPath = join(options.runsDir, "index.json");
  const index = existsSync(indexPath) ? parseRunsIndex(readFileSync(indexPath)) : emptyRunsIndex();
  const draft = await buildManifest(
    manifestInput(
      summary,
      options.runDir,
      ordered,
      profilesOf(summary),
      index.runs.at(-1)?.manifestCid ?? null,
      options.repoRoot,
      () => "",
    ),
  );
  return assertBindable(draft, options.runDir, options.bind);
}

export async function publishRun(options: PublishOptions): Promise<PublishResult> {
  // Pre-flight (OR-14): every refusal happens here, before the first CLI call or network write.
  const {
    summary,
    groups,
    profiles,
    index,
    indexPath,
    previousManifestCid,
    buildGroups,
    approval,
    approvedFiles,
  } = await preflight(options);

  const secrets = secretValues(options.env);
  const safe = (text: string): string => redact(text, secrets);
  const reportsDir = join(options.runDir, "reports");
  mkdirSync(reportsDir, { recursive: true });
  const readback: ReadbackResult[] = [];
  const carAdds: CarAdd[] = [];
  const finish = (result: PublishResult): PublishResult => {
    writeFileSync(join(reportsDir, "publish.json"), `${safe(JSON.stringify(result, null, 2))}\n`);
    return result;
  };
  const fail = (sequence: SequenceReport, stage: PublishStage, reason: string): PublishResult =>
    finish({
      ok: false,
      runId: summary.runId,
      sequence,
      readback,
      carAdds,
      approval,
      failed: { stage, reason: safe(reason) },
    });

  // 1 The uploads of the approved build only: phase 1 is not re-run.
  const sequence = await runUpload({
    county: summary.county.slug,
    runDir: options.runDir,
    groups,
    built: buildGroups,
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

  // 2 Readback of every group from the gateway, before any add.
  const readbackOptions: ReadbackOptions = {
    env: options.env,
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    ...(options.sleep === undefined ? {} : { sleep: options.sleep }),
    ...(options.random === undefined ? {} : { random: options.random }),
    approved: { runDir: options.runDir, files: approvedFiles },
  };
  for (const g of sequence.groups) readback.push(await readbackGroup(g, readbackOptions));
  writeFileSync(join(reportsDir, "readback.json"), `${safe(JSON.stringify(readback, null, 2))}\n`);
  const bad = readback.filter((r) => !r.ok);
  if (bad.length > 0)
    return fail(
      sequence,
      "readback",
      bad.map((r) => `${r.group}: ${r.problems.join("; ")}`).join("\n"),
    );

  // 3 Each .car as a plain pinned file (the manifest's carCid), read back from the gateway.
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

  // 4 The manifest, from CLI outputs, receipts and the summary.
  const input = manifestInput(
    summary,
    options.runDir,
    sequence.groups,
    profiles,
    previousManifestCid,
    options.repoRoot,
    options.workTreeStatus,
  );
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

  // 4b The bind guard (F-1): the exact bytes must bind against the local tables and return
  // coverage.permits_emitted roofing-permit rows, before anything about the manifest goes public.
  let bound: BoundRows;
  try {
    bound = await assertBindable(built, options.runDir, options.bind);
  } catch (error) {
    return fail(sequence, "bind", message(error));
  }

  // 5 The manifest itself, by its exact bytes; the Hash must be cidOfBytes.
  try {
    await kuboAddBytes(built.bytes, "manifest.json", built.cid, addOptions);
  } catch (error) {
    return fail(sequence, "manifest-add", message(error));
  }

  // 6 runs/<runId>/manifest.json and runs/index.json, then read back from disk.
  let next;
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
  return finish({
    ok: true,
    runId: summary.runId,
    sequence,
    readback,
    carAdds,
    approval,
    bind: bound,
    manifestCid: built.cid,
    manifestPath,
    indexPath,
  });
}

// --- Second independent pin (Pinata, Kubo-RPC-compatible; AD-22, T012) -------------------------
// A sibling to the Filebase client `publishRun` already drives: same mechanism (Kubo RPC
// `/api/v0/add`, pinned, CIDv1 raw-leaves — kubo-add.ts's kuboAddFile/kuboAddBytes, unchanged),
// a second independent provider and credential (`PINATA_JWT`, never the Filebase keys), so a CAR
// surviving on Filebase alone is never the whole durability story (research.md "Second
// independent pin"; three copies total with the GitHub Release, release.ts). kuboAdd already
// reaches a non-Filebase `--api` through IPFS_API_TOKEN (sequence.ts's kuboToken), so no new
// low-level transport is needed — only Pinata's endpoint, its own env check, and the env rewrite
// that puts PINATA_JWT where kuboToken looks for it. This is deliberately NOT wired into
// publishRun's existing car-add step (which is pinned by A-03's walking-skeleton tests and the
// D-8 approval flow): it is a separate, additive call the batch/Fargate runner (T029) or a
// Stage-6 operator makes once the Filebase copy has already succeeded.
export const PINATA_RPC_API = "https://uploads.pinata.cloud";
export const PINATA_GATEWAY = "https://gateway.pinata.cloud";
export const PINATA_VARS = ["PINATA_JWT"] as const;

/** Why `env` cannot add to Pinata, or undefined when it can (fail closed, mirrors OR-8). */
export function pinataEnvProblem(env: NodeJS.ProcessEnv): string | undefined {
  const missing = PINATA_VARS.filter((v) => !env[v]);
  return missing.length > 0 ? `missing ${missing.join(", ")}` : undefined;
}

/** The second pin's own interface: same shape kuboAdd needs, nothing Filebase-specific baked in. */
export interface PinClient {
  name: string;
  api: string;
  gateway: string;
  /** Why `env` cannot use this client, or undefined when it can. */
  envProblem: (env: NodeJS.ProcessEnv) => string | undefined;
  /** The child env kuboAdd should see: Filebase's own token composition, or Pinata's JWT put
   *  where kuboToken reads it (IPFS_API_TOKEN), since `api` is not FILEBASE_RPC_API either way. */
  childEnv: (env: NodeJS.ProcessEnv) => NodeJS.ProcessEnv;
}

export const FILEBASE_CLIENT: PinClient = {
  name: "filebase",
  api: FILEBASE_RPC_API,
  gateway: FILEBASE_GATEWAY,
  envProblem: filebaseEnvProblem,
  childEnv: (env) => env,
};

export const PINATA_CLIENT: PinClient = {
  name: "pinata",
  api: PINATA_RPC_API,
  gateway: PINATA_GATEWAY,
  envProblem: pinataEnvProblem,
  childEnv: (env) => ({ ...env, IPFS_API_TOKEN: env.PINATA_JWT }),
};

/** The two durable pins AD-22 requires beyond the GitHub Release copy. */
export const PIN_CLIENTS: readonly PinClient[] = [FILEBASE_CLIENT, PINATA_CLIENT];

export interface PinnedRecord {
  cid: string;
  size: number;
  sha256: string;
}

/**
 * What a client already holds for an artifact name, so a later call never silently replaces
 * different bytes under the same name — the same immutability guarantee cid-copy.ts gives the
 * S3 CID copy (HeadObject: same digest -> skip, different digest -> refuse), applied here to the
 * second pin. Not needed for correctness against IPFS itself (a CID is the content; two
 * different byte strings never share one), but it catches the real failure mode: an operator or
 * a later run re-adding a file at the same path with different bytes without noticing.
 */
export interface PinRegistry {
  get(client: string, name: string): Promise<PinnedRecord | undefined> | PinnedRecord | undefined;
  set(client: string, name: string, record: PinnedRecord): Promise<void> | void;
}

/** A per-process registry; a caller that wants the guarantee across process runs injects its
 *  own (e.g. backed by the run's reports/ directory or an operator-chosen durable store). */
export function inMemoryPinRegistry(): PinRegistry {
  const store = new Map<string, PinnedRecord>();
  return {
    get: (client, name) => store.get(`${client}:${name}`),
    set: (client, name, record) => void store.set(`${client}:${name}`, record),
  };
}

export interface SecondPinOptions {
  env: NodeJS.ProcessEnv;
  fetch?: FetchLike;
  registry?: PinRegistry;
  /** Per-request timeout for the readback GET (default: kuboAdd's own 300s). */
  readbackTimeoutMs?: number;
}

export interface PinAdd {
  client: string;
  name: string;
  cid: string;
  size: number;
  sha256: string;
  /** The gateway's own bytes for `cid`, compared with the expected size/sha256 (OR-4-equivalent).
   *  Never present on success without this check: readback is required before success (T008). */
  readback: { size: number; sha256: string; ok: boolean; reason?: string };
}

async function gatewayReadback(
  gateway: string,
  cid: string,
  expectedSize: number,
  expectedSha256: string,
  options: SecondPinOptions,
): Promise<PinAdd["readback"]> {
  const fetchImpl = options.fetch ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(`${gateway}/ipfs/${cid}`, {
      signal: AbortSignal.timeout(options.readbackTimeoutMs ?? 300_000),
    });
  } catch (err) {
    return { size: 0, sha256: "", ok: false, reason: message(err) };
  }
  if (!response.ok) {
    await response.body?.cancel();
    return { size: 0, sha256: "", ok: false, reason: `HTTP ${response.status}` };
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const ok = bytes.length === expectedSize && sha256 === expectedSha256;
  return {
    size: bytes.length,
    sha256,
    ok,
    ...(ok
      ? {}
      : {
          reason: `size ${bytes.length} (want ${expectedSize}) sha256 ${sha256} (want ${expectedSha256})`,
        }),
  };
}

/**
 * Adds one artifact (a file on disk, or the manifest's exact bytes) to `client`: refuses up
 * front on missing credentials, refuses — comparing recorded bytes instead of overwriting — when
 * the registry already holds this name under a different digest, otherwise adds through Kubo RPC
 * (kuboAddFile/kuboAddBytes already require the node's returned Hash to equal the local CID) and
 * then requires a gateway readback match before returning. A failed readback throws: this
 * function never reports success without it (T008).
 */
export async function addToPin(
  client: PinClient,
  content: { path: string } | { bytes: Uint8Array; name: string },
  expectedCid: string,
  options: SecondPinOptions,
): Promise<PinAdd> {
  const problem = client.envProblem(options.env);
  if (problem !== undefined) throw new Error(`${client.name} add refused: ${problem}`);
  const name = "path" in content ? basename(content.path) : content.name;
  const size = "path" in content ? statSync(content.path).size : content.bytes.length;
  const sha256 =
    "path" in content
      ? await sha256File(content.path)
      : createHash("sha256").update(content.bytes).digest("hex");

  const registry = options.registry ?? inMemoryPinRegistry();
  const existing = await registry.get(client.name, name);
  if (existing !== undefined) {
    if (existing.cid === expectedCid && existing.sha256 === sha256 && existing.size === size) {
      const readback = await gatewayReadback(client.gateway, expectedCid, size, sha256, options);
      if (!readback.ok)
        throw new Error(
          `${client.name}: ${name} readback failed: ${readback.reason ?? "mismatch"}`,
        );
      return { client: client.name, name, cid: expectedCid, size, sha256, readback };
    }
    throw new Error(
      `${client.name}: ${name} was already pinned as ${existing.cid} (sha256 ${existing.sha256}, size ${existing.size}); ` +
        `refusing to overwrite it with ${expectedCid} (sha256 ${sha256}, size ${size}) — pins are immutable by name`,
    );
  }

  const addOptions: KuboAddOptions = {
    env: client.childEnv(options.env),
    api: client.api,
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  };
  const added =
    "path" in content
      ? await kuboAddFile(content.path, expectedCid, addOptions)
      : await kuboAddBytes(content.bytes, content.name, expectedCid, addOptions);

  const readback = await gatewayReadback(client.gateway, added.cid, size, sha256, options);
  if (!readback.ok)
    throw new Error(
      `${client.name}: ${name} readback failed after add: ${readback.reason ?? "mismatch"}`,
    );
  await registry.set(client.name, name, { cid: added.cid, size, sha256 });
  return { client: client.name, name, cid: added.cid, size, sha256, readback };
}

/**
 * Adds every CAR/tables.car this run already pinned to Filebase (`result.carAdds`) plus the
 * manifest's own bytes to `client` (default: Pinata), in the same order `publishRun` added them.
 * Stops at the first failure (fail-closed): a second pin that silently drops an artifact is worse
 * than one that never started.
 */
export async function addSecondPin(
  result: Pick<PublishResult, "carAdds" | "manifestPath">,
  runDir: string,
  options: SecondPinOptions & { client?: PinClient },
): Promise<PinAdd[]> {
  const client = options.client ?? PINATA_CLIENT;
  const added: PinAdd[] = [];
  for (const a of result.carAdds) {
    added.push(await addToPin(client, { path: join(runDir, a.name) }, a.cid, options));
  }
  if (result.manifestPath !== undefined) {
    const bytes = readFileSync(result.manifestPath);
    const cid = await cidOfBytes(bytes);
    added.push(await addToPin(client, { bytes, name: "manifest.json" }, cid, options));
  }
  return added;
}
