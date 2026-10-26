// The publication entry point (contracts/cli.md), run from the repository root as
//   pnpm --filter @countylens/publish exec tsx src/cli.ts <command> …
//   build    --run <runId>      phase 1 for both groups (validate → hash → validate CAR →
//                               export-tables); writes reports/sequence-build.json and
//                               reports/public-files.json (the D-8 evidence: exactly the files that
//                               would go public, with size, SHA-256 and CID) and prints them with
//                               the listing's SHA-256. Its last step binds the draft manifest
//                               against the local tables (bindBuild, CR-A-03 F-1): a run the web
//                               or the API could not bind fails here, exit 1, before D-8 is asked.
//                               Never uploads.
//   upload   --run <runId> --approved <sha256 of public-files.json>
//                               D-8 gated: loads ~/.config/assessment/filebase.env into the child
//                               env (never process.env, never argv, never printed), requires the
//                               three FILEBASE_* names and no IPFS_API_TOKEN, then runs publishRun
//                               on the approved build only (verify on disk, uploads, readback,
//                               carCid adds + readback, manifest, runs/). Never re-runs phase 1.
//   cid-copy --manifest <path>  hands runs/<runId>/manifest.json to the CID-copy uploader
//                               (src/cid-copy.ts, T041), loaded only by this command.
// Every printed line passes through redact(): a credential value never reaches a terminal or a
// log. There is no flag that skips, reorders or dry-runs a step (P0-2) and no credential flag.
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BUILD_REPORT, writePublicFiles } from "./approval.js";
import type { BoundRows, LocalBinder } from "./bind-guard.js";
import type { FetchLike } from "./kubo-add.js";
import {
  FILEBASE_VARS,
  filebaseEnvProblem,
  redact,
  runBuild,
  secretValues,
  type CliRunner,
} from "./sequence.js";
import {
  bindBuild,
  loadRunSummary,
  publishRun,
  preflight,
  runGroups,
  type BindBuildOptions,
  type PreflightOptions,
  type PublishOptions,
  type PublishResult,
} from "./upload.js";

export { FILEBASE_VARS } from "./sequence.js";

/** Where PUBLISHING.md keeps the Filebase keys: outside every repository. */
export const FILEBASE_ENV_FILE = join(homedir(), ".config", "assessment", "filebase.env");
const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const RUN_ID = /^[a-z0-9][a-z0-9-]*$/;
const USAGE = [
  "usage:",
  "  cli.ts build --run <runId>      phase 1 (validate → hash → validate CAR → export-tables); nothing uploaded",
  "  cli.ts upload --run <runId> --approved <sha256 of reports/public-files.json>",
  "                                  D-8 gated: the approved build only; uploads, readback, carCid adds, manifest, runs/",
  `                                  (credentials from ${FILEBASE_ENV_FILE} or the environment)`,
  "  cli.ts cid-copy --manifest runs/<runId>/manifest.json",
  "",
].join("\n");

export interface CidCopyInput {
  manifestPath: string;
  /** pipeline/data/runs/<runId>: the manifest's artifact names are relative to it. */
  runDir: string;
  repoRoot: string;
  env: NodeJS.ProcessEnv;
  /** One line per object, printed redacted. */
  log: (line: string) => void;
}

export interface CidCopyOutcome {
  ok: boolean;
  summary?: string;
}

export type CidCopyFn = (input: CidCopyInput) => Promise<CidCopyOutcome>;

export interface CliDeps {
  repoRoot?: string;
  /** The Filebase env file (default FILEBASE_ENV_FILE); read by `upload` only. */
  envFile?: string;
  /** The base environment (default process.env, copied; never written back). */
  env?: NodeJS.ProcessEnv;
  run?: CliRunner;
  fetch?: FetchLike;
  publish?: (options: PublishOptions) => Promise<PublishResult>;
  cidCopy?: CidCopyFn;
  workTreeStatus?: (repoRoot: string) => string;
  /** HEAD of the repo (default `git rev-parse HEAD`). */
  headCommit?: (repoRoot: string) => string;
  /** The last `build` step (default upload.ts bindBuild: query-core over a local DuckDB). */
  bindBuild?: (options: BindBuildOptions) => Promise<BoundRows>;
  /** The local binder `upload` hands to publishRun's bind guard (default scripts/local-bind.ts). */
  bind?: LocalBinder;
  /** The OR-14 preflight (default upload.ts preflight), run before publishRun. */
  preflight?: (options: PreflightOptions) => Promise<unknown>;
  stdout?: (text: string) => void;
  stderr?: (text: string) => void;
}

type Command = "build" | "upload" | "cid-copy";

interface Parsed {
  command: Command;
  /** Flag → value, exactly the command's required flags. */
  flags: Record<string, string>;
}

const COMMANDS: Record<Command, readonly string[]> = {
  build: ["--run"],
  upload: ["--run", "--approved"],
  "cid-copy": ["--manifest"],
};

/**
 * `<command>` and exactly its `<flag> <value>` pairs, nothing else: no skip, dry-run,
 * credential or Atlas flag.
 */
function parseArgv(argv: readonly string[]): Parsed | string {
  const [command, ...rest] = argv;
  if (command === undefined) return "a command is required";
  if (!(command in COMMANDS)) return `unknown command ${command}`;
  const required = COMMANDS[command as Command];
  const needs = `${command} needs ${required.map((f) => `${f} <value>`).join(" ")}`;
  const flags: Record<string, string> = {};
  for (let i = 0; i < rest.length; i += 2) {
    const name = rest[i] as string;
    const value = rest[i + 1];
    if (!required.includes(name)) return `unknown option ${rest.slice(i).join(" ")}`;
    if (value === undefined || value.startsWith("--") || name in flags) return needs;
    flags[name] = value;
  }
  if (required.some((f) => flags[f] === undefined)) return needs;
  return { command: command as Command, flags };
}

/** `KEY=value` lines (optional `export`, quotes stripped, `#` comments); never logged. */
export function parseEnvFile(text: string): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let value = (m[2] as string).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    )
      value = value.slice(1, -1);
    vars[m[1] as string] = value;
  }
  return vars;
}

interface ChildEnv {
  env: NodeJS.ProcessEnv;
  /** Where the credentials came from, for the operator (names only). */
  note: string;
}

/** The child env for `upload`: the base env with the env file's variables over it. */
function uploadEnv(base: NodeJS.ProcessEnv, envFile: string): ChildEnv | string {
  const fromFile = existsSync(envFile) ? parseEnvFile(readFileSync(envFile, "utf8")) : undefined;
  const env: NodeJS.ProcessEnv = { ...base, ...(fromFile ?? {}) };
  // Fail closed (OR-8): the three FILEBASE_* names, each of them, and no IPFS_API_TOKEN beside
  // them; a stray token never stands in for a missing key.
  const problem = filebaseEnvProblem(env);
  if (problem !== undefined) {
    if (!problem.startsWith("missing ")) return problem;
    return (
      `${problem}: ` +
      (fromFile === undefined
        ? `${envFile} is absent and the environment does not carry them; `
        : `${envFile} does not set them; `) +
      `the upload needs ${FILEBASE_VARS.join(", ")}; ` +
      "load the Filebase keys per PUBLISHING.md (set -a; . ~/.config/assessment/filebase.env; set +a)"
    );
  }
  const names = FILEBASE_VARS.join(", ");
  const note =
    fromFile === undefined
      ? `credentials: ${names} present in the environment (values not shown)`
      : `credentials: ${names} loaded from ${envFile} into the child environment only (values not shown)`;
  return { env, note };
}

function message(error: unknown): string {
  return error instanceof Error ? (error.stack ?? error.message) : String(error);
}

/** Writes through `redact`, with a secret list that grows once the child env is known. */
class Printer {
  private secrets: string[] = [];
  constructor(
    private readonly out: (text: string) => void,
    private readonly err: (text: string) => void,
  ) {}
  protect(env: NodeJS.ProcessEnv): void {
    // Raw keys plus the composed Filebase token and its Authorization value (OR-7).
    this.secrets = secretValues(env);
  }
  stdout(text: string): void {
    this.out(redact(text, this.secrets));
  }
  stderr(text: string): void {
    this.err(redact(text, this.secrets));
  }
}

function runDirFor(repoRoot: string, runId: string): string {
  if (!RUN_ID.test(runId)) throw new Error(`run id must match ${RUN_ID.source}, got ${runId}`);
  return join(repoRoot, "pipeline", "data", "runs", runId);
}

async function build(runId: string, deps: CliDeps, repoRoot: string, p: Printer): Promise<number> {
  const runDir = runDirFor(repoRoot, runId);
  const summary = loadRunSummary(runDir);
  const groups = runGroups(summary);
  const env = { ...(deps.env ?? process.env) };
  p.protect(env);
  p.stdout(
    `build ${runId}: phase 1 (validate → hash → validate CAR → export-tables) for ${groups.join(", ")}; nothing uploaded\n`,
  );
  const report = await runBuild({
    county: summary.county.slug,
    runDir,
    groups,
    repoRoot,
    env,
    ...(deps.run === undefined ? {} : { run: deps.run }),
  });
  if (!report.ok) {
    const f = report.failed;
    p.stderr(
      f === undefined
        ? "build failed\n"
        : `build failed at ${f.group} ${f.step}: ${f.reason}${f.stderr === "" ? "" : `\n${f.stderr}`}\n`,
    );
    return 1;
  }
  const written = await writePublicFiles({ runDir, runId, report });
  for (const g of written.listing.groups) {
    p.stdout(`${g.group}\n`);
    p.stdout(`  archive root ${g.carRoot}  (${g.blocks} blocks)\n`);
    p.stdout(`  tables root ${g.tablesRoot}  (${g.files.length - 2} parts)\n`);
    for (const f of g.files)
      p.stdout(`  ${f.path}  ${f.size} B  sha256 ${f.sha256}  cid ${f.cid}\n`);
  }
  p.stdout(
    `files that would go public: ${written.listing.totalFiles}, ${written.listing.totalBytes} B (listed above; plus runs/${runId}/manifest.json and runs/index.json after upload)\n`,
  );
  // CR-A-03 F-1: the draft manifest must bind against these tables, or nobody should approve it.
  let bound: BoundRows;
  try {
    bound = await (deps.bindBuild ?? bindBuild)({
      runDir,
      runsDir: join(repoRoot, "runs"),
      repoRoot,
      ...(deps.bind === undefined ? {} : { bind: deps.bind }),
    });
  } catch (error) {
    p.stderr(
      `build failed at bind: ${error instanceof Error ? error.message : String(error)}\nthe web and the API could not bind this run; do not approve it\n`,
    );
    return 1;
  }
  p.stdout(
    `bind: ${bound.permitRows} roofing permit rows bound (= coverage.permits_emitted), ${bound.tables} tables, draft manifest ${bound.manifestCid}\n`,
  );
  p.stdout(`report: ${relative(repoRoot, join(runDir, BUILD_REPORT))}\n`);
  p.stdout(`listing: ${relative(repoRoot, written.path)}\n`);
  p.stdout(`public-files.json sha256 ${written.sha256}\n`);
  p.stdout(`after D-8 approval: cli.ts upload --run ${runId} --approved ${written.sha256}\n`);
  return 0;
}

async function upload(
  runId: string,
  approved: string,
  deps: CliDeps,
  repoRoot: string,
  p: Printer,
): Promise<number> {
  const runDir = runDirFor(repoRoot, runId);
  const child = uploadEnv({ ...(deps.env ?? process.env) }, deps.envFile ?? FILEBASE_ENV_FILE);
  if (typeof child === "string") {
    p.stderr(`error: ${child}\n`);
    return 1;
  }
  p.protect(child.env);
  loadRunSummary(runDir);
  p.stdout(`${child.note}\n`);
  p.stdout(
    `upload ${runId}: the approved build (public-files.json sha256 ${approved}) only: uploads, readback, carCid adds, manifest, runs/\n`,
  );
  const checks: PreflightOptions = {
    runDir,
    runsDir: join(repoRoot, "runs"),
    repoRoot,
    env: child.env,
    approved,
    ...(deps.workTreeStatus === undefined ? {} : { workTreeStatus: deps.workTreeStatus }),
    ...(deps.headCommit === undefined ? {} : { headCommit: deps.headCommit }),
  };
  // OR-14: every refusal before the first upload; a throw exits 1 through main().
  await (deps.preflight ?? preflight)(checks);
  const publish = deps.publish ?? publishRun;
  const result = await publish({
    ...checks,
    ...(deps.run === undefined ? {} : { run: deps.run }),
    ...(deps.fetch === undefined ? {} : { fetch: deps.fetch }),
    ...(deps.bind === undefined ? {} : { bind: deps.bind }),
  });
  if (result.approval !== undefined)
    p.stdout(
      `  approval ${result.approval.publicFilesSha256}: ${result.approval.files} files, ${result.approval.bytes} B unchanged on disk\n`,
    );
  for (const r of result.readback) {
    p.stdout(
      `  readback ${r.group}: ${r.ok ? "ok" : "FAILED"} · archive root ${r.archiveRoot.ok ? "ok" : "MISMATCH"} · tables root ${r.tablesRoot.ok ? "ok" : "MISMATCH"} · ${r.partCount} parts\n`,
    );
  }
  for (const a of result.carAdds) p.stdout(`  carCid ${a.name}  ${a.cid}\n`);
  if (result.bind !== undefined)
    p.stdout(`  bind: ${result.bind.permitRows} roofing permit rows bound locally\n`);
  if (!result.ok) {
    const f = result.failed;
    p.stderr(
      f === undefined
        ? "upload failed; no manifest written\n"
        : `upload failed at ${f.stage}: ${f.reason}\nno manifest written\n`,
    );
    return 1;
  }
  p.stdout(`manifest ${result.manifestCid ?? ""}\n`);
  if (result.manifestPath !== undefined) p.stdout(`  ${relative(repoRoot, result.manifestPath)}\n`);
  if (result.indexPath !== undefined) p.stdout(`  ${relative(repoRoot, result.indexPath)}\n`);
  p.stdout("commit runs/ (the manifest and the index), then record the CIDs in the evidence\n");
  return 0;
}

/**
 * The CID-copy uploader (cid-copy.ts, T041): profile `assess-cid-writer`, bucket from
 * `CID_COPY_BUCKET` or SSM `/countylens/cid-copy/bucket`, conditional PUT + readback per object.
 * Imported here, not at the top, so `build` and `upload` never load the AWS SDK. An object that
 * exists with other bytes makes copyManifestObjects throw: main() prints it and exits 1.
 */
async function defaultCidCopy(input: CidCopyInput): Promise<CidCopyOutcome> {
  const { copyManifestObjects, createCidCopyClients, resolveCidCopyBucket } =
    await import("./cid-copy.js");
  const { s3, ssm } = createCidCopyClients();
  const bucket = await resolveCidCopyBucket({ env: input.env, ssm });
  const report = await copyManifestObjects({
    manifestPath: input.manifestPath,
    runDir: input.runDir,
    repoRoot: input.repoRoot,
    bucket,
    s3,
    log: input.log,
  });
  return {
    ok: true,
    summary: `${report.written} objects written, ${report.skipped} skipped (already identical) in ${report.bucket}; manifest ${report.manifestCid}`,
  };
}

async function cidCopy(
  manifestArg: string,
  deps: CliDeps,
  repoRoot: string,
  p: Printer,
): Promise<number> {
  const manifestPath = resolve(repoRoot, manifestArg);
  const runsDir = join(repoRoot, "runs");
  const inside = relative(runsDir, manifestPath);
  if (inside.startsWith("..") || basename(manifestPath) !== "manifest.json")
    throw new Error(`--manifest must be runs/<runId>/manifest.json, got ${manifestArg}`);
  if (!existsSync(manifestPath)) throw new Error(`${manifestPath} does not exist`);
  const runId = basename(dirname(manifestPath));
  const runDir = runDirFor(repoRoot, runId);
  const env = { ...(deps.env ?? process.env) };
  p.protect(env);
  const outcome = await (deps.cidCopy ?? defaultCidCopy)({
    manifestPath,
    runDir,
    repoRoot,
    env,
    log: (line) => p.stdout(`${line}\n`),
  });
  if (outcome.summary !== undefined) {
    if (outcome.ok) p.stdout(`${outcome.summary}\n`);
    else p.stderr(`${outcome.summary}\n`);
  }
  if (!outcome.ok) p.stderr("cid-copy failed\n");
  return outcome.ok ? 0 : 1;
}

/** Runs one command; returns the exit code. Prints only redacted text. */
export async function main(argv: readonly string[], deps: CliDeps = {}): Promise<number> {
  const p = new Printer(
    deps.stdout ?? ((t) => void process.stdout.write(t)),
    deps.stderr ?? ((t) => void process.stderr.write(t)),
  );
  p.protect(deps.env ?? process.env);
  const parsed = parseArgv(argv);
  if (typeof parsed === "string") {
    p.stderr(`error: ${parsed}\n${USAGE}`);
    return 1;
  }
  const repoRoot = deps.repoRoot ?? REPO_ROOT;
  try {
    switch (parsed.command) {
      case "build":
        return await build(parsed.flags["--run"] as string, deps, repoRoot, p);
      case "upload":
        return await upload(
          parsed.flags["--run"] as string,
          parsed.flags["--approved"] as string,
          deps,
          repoRoot,
          p,
        );
      case "cid-copy":
        return await cidCopy(parsed.flags["--manifest"] as string, deps, repoRoot, p);
    }
  } catch (error) {
    p.stderr(`error: ${message(error)}\n`);
    return 1;
  }
}

const isMain =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      process.stderr.write(`${redact(message(error), secretValues(process.env))}\n`);
      process.exitCode = 1;
    },
  );
}
