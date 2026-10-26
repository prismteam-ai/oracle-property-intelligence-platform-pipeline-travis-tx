// The fixed elephant-cli publish order per data group (use-oracle car-publication, FR-001, P0-2):
//   phase 1 (build):   validate <dir> → hash <dir> --output-zip --output-csv --output-car
//                      → validate <car> → export-tables <car> --output --part-size 48m --output-json
//   phase 2 (upload):  upload <car> → upload <tables dir>   (Filebase Kubo RPC, --output-json)
// Phase 1 runs for every group before any upload, so no group's CAR is ever public on its own.
// The steps are a fixed plan computed from paths alone: nothing in the options or the
// environment drops one, and assertOrdered() refuses, before the first CLI call, any plan whose
// steps are out of that order or missing (PlanOrderError names both steps). A non-zero exit, a
// missing output or an unparseable printed root stops every later step. Each phase writes its own
// report (reports/sequence-build.json, reports/sequence-upload.json): the build report is the D-8
// evidence and the upload never rewrites it. Credentials (FILEBASE_*, IPFS_API_TOKEN) reach the
// CLI only through the child process environment, because argv is written to the reports; the
// composed Filebase bearer is redacted like the raw keys. No --atlas-page: Atlas registration is
// A-11. The CLI is the workspace pin at node_modules/.bin/elephant-cli, commit 44bb182 (asserted
// before the first step), never a global or Homebrew copy.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, sep } from "node:path";

/**
 * The 2 full-county publish groups, matching the real lexicon manifest this pipeline fetches
 * (`seed`, `county`, `propertyImprovement` — no separate owner/contractor/parcels groups exist).
 * An earlier A-11 draft widened this to 5 groups; corrected 2026-10-23: owner and parcel geometry
 * are already embedded fields inside `county`'s existing per-record export, and contractor
 * identity (AD-05) is wired as fields on `property_improvement`'s permit records, not a new group.
 */
export type DataGroup = "county" | "property_improvement";
export type StepName =
  "validate" | "hash" | "validate-car" | "export-tables" | "upload-car" | "upload-tables";
/** 1 = build (local), 2 = upload. */
export type Phase = 1 | 2;
/** `build` (phase 1), `upload` (phase 2 of an approved build), `publish` (both, in one run). */
export type SequencePhase = "build" | "upload" | "publish";

/** The fixed order of the six steps of one group. */
export const STEP_ORDER: readonly StepName[] = [
  "validate",
  "hash",
  "validate-car",
  "export-tables",
  "upload-car",
  "upload-tables",
];

/** The pinned elephant-cli commit (root package.json, pnpm-lock.yaml). */
export const CLI_COMMIT = "44bb182";
/** `export-tables --part-size` (ADR-0001 decision 3, D-4): every part stays within 48 MiB. */
export const PART_SIZE = "48m";
export const PART_SIZE_BYTES = 48 * 1024 * 1024;
export const FILEBASE_RPC_API = "https://rpc.filebase.io";
export const FILEBASE_GATEWAY = "https://ipfs.filebase.io";
export const UPLOAD_TIMEOUT_SECONDS = "300";

export interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}
export type CliRunner = (argv: string[]) => Promise<CliResult>;

export interface OutputFile {
  path: string;
  size: number;
  sha256: string;
}

/**
 * A step output. A file: its size and SHA-256. A directory: the total size of the files beneath
 * it, the SHA-256 of their sorted "<relative path>\t<sha256>\n" lines, and every file listed.
 */
export interface OutputDigest {
  path: string;
  size: number;
  sha256: string;
  files?: OutputFile[];
}

export interface PlannedStep {
  group: DataGroup;
  step: StepName;
  phase: Phase;
  argv: string[];
  /** Files or directories the step must leave behind. */
  outputs: string[];
}

export interface StepRecord {
  group: DataGroup;
  step: StepName;
  phase: Phase;
  argv: string[];
  exitCode: number;
  outputs: OutputDigest[];
  carRoot?: string;
  blocks?: number;
  tablesRoot?: string;
}

export interface GroupUploads {
  /** `upload <car> --output-json` summary. */
  archiveJson: string;
  /** `upload <tables dir> --output-json` summary. */
  tablesJson: string;
}

export interface GroupResult {
  group: DataGroup;
  groupDir: string;
  carPath: string;
  carRoot: string;
  blocks: number;
  hashCsv: string;
  /** Distinct dataGroupCid values from hash.csv. */
  dataGroupCids: string[];
  tablesDir: string;
  tablesRoot: string;
  tablesExportJson: string;
  /** Present only after both phase-2 uploads of the group succeeded. */
  uploads?: GroupUploads;
}

export interface SequenceFailure {
  group: DataGroup;
  step: StepName;
  reason: string;
  /** Redacted: no secret value from the child environment survives in it. */
  stderr: string;
}

export interface SequenceReport {
  ok: boolean;
  phase: SequencePhase;
  /** The spawned CLI, or null when a runner was injected. */
  pinnedCli: { bin: string; commit: string } | null;
  steps: StepRecord[];
  groups: GroupResult[];
  failed?: SequenceFailure;
}

/** The report a phase writes under reports/: phase-specific, so an upload never rewrites the build's. */
export function sequenceReportName(phase: SequencePhase): string {
  return `sequence-${phase}.json`;
}

export interface SequenceOptions {
  /** County slug used in CAR names (`<county>-<group>.car`). */
  county: string;
  /** The run directory holding `groups/<group>/` (pipeline/data/runs/<runId>, gitignored). */
  runDir?: string;
  /** @deprecated A-02 name of `runDir`, kept while travis/pilot/run-pilot.ts calls it. */
  pilotDir?: string;
  groups: readonly DataGroup[];
  /** The CLI runner; defaults to spawning the pinned binary in `runDir` with `env`. */
  run?: CliRunner;
  repoRoot?: string;
  /** The child environment (default process.env). Secret values in it never reach argv or reports. */
  env?: NodeJS.ProcessEnv;
}

const CAR_WRITTEN = /CAR written: .* \((\d+) blocks, root (b[a-z2-7]+)\)/;
const TABLES_WRITTEN = /Tables written: .*root (b[a-z2-7]+)\)/;

export interface ResolvedCli {
  bin: string;
  realPath: string;
  commit: string | null;
}

/** The pinned commit, read from the pnpm store path of the GitHub tarball install. */
export function cliCommitFromPath(path: string): string | null {
  const m = /elephant-cli\+tar\.gz\+([0-9a-f]{7,40})/.exec(path);
  return m ? (m[1] as string) : null;
}

/** The workspace-pinned elephant-cli at the repository root. */
export function resolveCli(repoRoot: string): ResolvedCli {
  const bin = join(repoRoot, "node_modules", ".bin", "elephant-cli");
  if (!existsSync(bin)) {
    throw new Error(
      `elephant-cli is not installed at ${bin}; run pnpm install at the repository root`,
    );
  }
  const pkg = join(repoRoot, "node_modules", "elephant-cli");
  const realPath = existsSync(pkg) ? realpathSync(pkg) : realpathSync(bin);
  return { bin, realPath, commit: cliCommitFromPath(realPath) };
}

/** Throws unless the resolved CLI is the workspace pin at CLI_COMMIT. */
export function assertPinnedCli(cli: ResolvedCli): ResolvedCli {
  if (!cli.commit?.startsWith(CLI_COMMIT)) {
    throw new Error(
      `elephant-cli at ${cli.bin} resolves to ${cli.realPath} (commit ${cli.commit ?? "unknown"}); ` +
        `the publish sequence requires the workspace pin ${CLI_COMMIT}`,
    );
  }
  return cli;
}

const SECRET_NAME = /TOKEN|SECRET|JWT|PASSWORD|ACCESS_KEY|API_KEY|PRIVATE/i;

/** Filebase's Kubo RPC token: base64(access key:secret key:bucket), as elephant-cli composes it. */
export function filebaseToken(env: NodeJS.ProcessEnv): string | undefined {
  const parts = [env.FILEBASE_ACCESS_KEY, env.FILEBASE_SECRET_KEY, env.FILEBASE_BUCKET];
  return parts.every((p) => typeof p === "string" && p !== "")
    ? Buffer.from(parts.join(":")).toString("base64")
    : undefined;
}

/** The three names a Filebase upload needs; nothing stands in for any of them. */
export const FILEBASE_VARS = [
  "FILEBASE_ACCESS_KEY",
  "FILEBASE_SECRET_KEY",
  "FILEBASE_BUCKET",
] as const;

/**
 * Why `env` cannot upload to Filebase, or undefined when it can (fail closed, OR-8): all three
 * FILEBASE_* names must be set, and IPFS_API_TOKEN must not be, because the CLI would send it
 * to the Filebase RPC in place of the composed token. Names only; never a value.
 */
export function filebaseEnvProblem(env: NodeJS.ProcessEnv): string | undefined {
  const missing = FILEBASE_VARS.filter((v) => !env[v]);
  if (missing.length > 0) return `missing ${missing.join(", ")}`;
  if (env.IPFS_API_TOKEN)
    return "IPFS_API_TOKEN is set, but the upload is pinned to Filebase: unset IPFS_API_TOKEN so the Filebase keys are the only credential";
  return undefined;
}

/**
 * Values of the credential-looking variables in `env` (FILEBASE_SECRET_KEY, IPFS_API_TOKEN, …)
 * plus every value derived from them that can reach a log: the composed Filebase token and the
 * Authorization header values built from it or from IPFS_API_TOKEN.
 */
export function secretValues(env: NodeJS.ProcessEnv): string[] {
  const raw = Object.entries(env)
    .filter(([name, value]) => SECRET_NAME.test(name) && typeof value === "string" && value !== "")
    .map(([, value]) => value as string);
  const tokens = [filebaseToken(env), env.IPFS_API_TOKEN].filter(
    (t): t is string => typeof t === "string" && t !== "",
  );
  const derived = tokens.flatMap((t) => [`Bearer ${t}`, t]);
  // Longest first, so a header value is replaced whole before its token inside it.
  return [...new Set([...derived, ...raw])].sort((a, b) => b.length - a.length);
}

/** `text` with every secret value replaced by `[redacted]` (longest secret first). */
export function redact(text: string, secrets: readonly string[]): string {
  let out = text;
  for (const secret of [...secrets].sort((a, b) => b.length - a.length))
    out = out.split(secret).join("[redacted]");
  return out;
}

const CREDENTIAL_FLAGS = new Set(["--token", "--pinata-jwt"]);

/** Argv is recorded in reports: it may carry neither a credential flag nor a secret value. */
function assertCleanArgv(argv: readonly string[], secrets: readonly string[]): void {
  for (const a of argv) {
    if (CREDENTIAL_FLAGS.has(a) || a === "--atlas-page")
      throw new Error(`refusing to pass ${a} to elephant-cli`);
    if (secrets.some((s) => a.includes(s)))
      throw new Error("refusing to pass a credential on argv; credentials go in the child env");
  }
}

/** The child environment: `base` without ELEPHANT_IPFS_GATEWAYS (oracle F9). Credentials stay in it. */
export function childEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env = { ...base };
  delete env.ELEPHANT_IPFS_GATEWAYS;
  return env;
}

/** Spawns the pinned CLI in `cwd` (the run dir, so elephant-cli.log lands there) with `env`. */
export function spawnRunner(
  bin: string,
  opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): CliRunner {
  const env = childEnv(opts.env);
  const cwd = opts.cwd;
  return (argv) =>
    new Promise((resolve, reject) => {
      const child = spawn(bin, argv, {
        ...(cwd === undefined ? {} : { cwd }),
        env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (c: Buffer) => (stdout += c.toString("utf8")));
      child.stderr.on("data", (c: Buffer) => (stderr += c.toString("utf8")));
      child.on("error", reject);
      child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
    });
}

/** Size and SHA-256 of a file, or of a directory and every file beneath it (see OutputDigest). */
export async function digestOutput(path: string): Promise<OutputDigest> {
  if (!statSync(path).isDirectory())
    return { path, size: statSync(path).size, sha256: await sha256File(path) };
  const names = (readdirSync(path, { recursive: true }) as string[])
    .map((f) => f.split(sep).join("/"))
    .filter((f) => statSync(join(path, f)).isFile())
    .sort();
  const files: OutputFile[] = [];
  for (const name of names) {
    const file = join(path, name);
    files.push({ path: file, size: statSync(file).size, sha256: await sha256File(file) });
  }
  const lines = names.map((name, i) => `${name}\t${(files[i] as OutputFile).sha256}\n`);
  return {
    path,
    size: files.reduce((n, f) => n + f.size, 0),
    sha256: createHash("sha256").update(lines.join("")).digest("hex"),
    files,
  };
}

export async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

/**
 * SHA-256 of a file, or of a directory as the sorted lines "<relative path>\t<sha256>\n"
 * of every file beneath it.
 */
export async function sha256Output(path: string): Promise<string> {
  if (!statSync(path).isDirectory()) return sha256File(path);
  const files = (readdirSync(path, { recursive: true }) as string[])
    .map((f) => f.split(sep).join("/"))
    .filter((f) => statSync(join(path, f)).isFile())
    .sort();
  const lines: string[] = [];
  for (const f of files) lines.push(`${f}\t${await sha256File(join(path, f))}\n`);
  return createHash("sha256").update(lines.join("")).digest("hex");
}

/** The six steps of one group, phase 1 then phase 2. A pure function of the paths. */
function groupPlan(county: string, runDir: string, group: DataGroup): PlannedStep[] {
  const dir = join(runDir, "groups", group);
  const car = join(runDir, "car", `${county}-${group}.car`);
  const tables = join(runDir, "tables", group);
  const report = (name: string) => join(runDir, "reports", `${group}-${name}`);
  const upload = (input: string, summary: string): string[] => [
    "upload",
    input,
    "--api",
    FILEBASE_RPC_API,
    "--gateway",
    FILEBASE_GATEWAY,
    "--timeout",
    UPLOAD_TIMEOUT_SECONDS,
    "--output-json",
    summary,
  ];
  return [
    {
      group,
      step: "validate",
      phase: 1,
      argv: ["validate", dir, "--output-csv", report("errors.csv")],
      outputs: [report("errors.csv")],
    },
    {
      group,
      step: "hash",
      phase: 1,
      argv: [
        "hash",
        dir,
        "--output-zip",
        // elephant-cli 44bb182 writes --output-zip as a directory of per-property zips.
        join(runDir, "hashed", group),
        "--output-csv",
        report("hash.csv"),
        "--output-car",
        car,
      ],
      outputs: [join(runDir, "hashed", group), report("hash.csv"), car],
    },
    {
      group,
      step: "validate-car",
      phase: 1,
      argv: ["validate", car, "--output-csv", report("car-errors.csv")],
      outputs: [report("car-errors.csv")],
    },
    {
      group,
      step: "export-tables",
      phase: 1,
      argv: [
        "export-tables",
        car,
        "--output",
        tables,
        "--part-size",
        PART_SIZE,
        "--output-json",
        report("tables-export.json"),
      ],
      outputs: [report("tables-export.json"), tables, join(tables, "tables.car")],
    },
    {
      group,
      step: "upload-car",
      phase: 2,
      argv: upload(car, report("archive-upload.json")),
      outputs: [report("archive-upload.json")],
    },
    {
      group,
      step: "upload-tables",
      phase: 2,
      argv: upload(tables, report("tables-upload.json")),
      outputs: [report("tables-upload.json")],
    },
  ];
}

/** Phase 1 for every group: 4 steps per group, nothing uploaded. The `build` command. */
export function planBuild(
  county: string,
  runDir: string,
  groups: readonly DataGroup[],
): PlannedStep[] {
  return groups.flatMap((g) => groupPlan(county, runDir, g).filter((s) => s.phase === 1));
}

/** Phase 2 for every group: 2 uploads per group. The `upload` command, after an approved build. */
export function planUpload(
  county: string,
  runDir: string,
  groups: readonly DataGroup[],
): PlannedStep[] {
  return groups.flatMap((g) => groupPlan(county, runDir, g).filter((s) => s.phase === 2));
}

/** Phase 1 for every group, then phase 2 for every group: the 12-step publish order. */
export function planPublish(
  county: string,
  runDir: string,
  groups: readonly DataGroup[],
): PlannedStep[] {
  return [...planBuild(county, runDir, groups), ...planUpload(county, runDir, groups)];
}

/** A plan out of the fixed order, or with a step missing or repeated. Names the steps. */
export class PlanOrderError extends Error {
  override name = "PlanOrderError";
}

const PHASE_STEPS: Record<Phase, readonly StepName[]> = {
  1: STEP_ORDER.slice(0, 4),
  2: STEP_ORDER.slice(4),
};

/**
 * Throws PlanOrderError unless `plan` keeps the fixed order (TC-002, P0-2): within a group the
 * steps follow STEP_ORDER, every phase-1 step of every group comes before any phase-2 step, no
 * step repeats, and each group runs its phases whole (four build steps, two uploads, or all
 * six). The message names both steps: "<step> of <group> before <step> of <group>".
 */
export function assertOrdered(plan: readonly PlannedStep[]): void {
  const rank = (s: PlannedStep): number => STEP_ORDER.indexOf(s.step);
  plan.forEach((p, i) => {
    for (const q of plan.slice(i + 1)) {
      const sameGroupEarlier = p.group === q.group && rank(q) < rank(p);
      const buildAfterUpload = p.phase === 2 && q.phase === 1;
      if (sameGroupEarlier || buildAfterUpload)
        throw new PlanOrderError(`${p.step} of ${p.group} before ${q.step} of ${q.group}`);
      if (p.group === q.group && p.step === q.step)
        throw new PlanOrderError(`${p.step} of ${p.group} twice`);
    }
  });
  for (const group of new Set(plan.map((s) => s.group))) {
    const steps = plan.filter((s) => s.group === group);
    for (const phase of [1, 2] as const) {
      if (!steps.some((s) => s.phase === phase)) continue;
      const missing = PHASE_STEPS[phase].find((name) => !steps.some((s) => s.step === name));
      if (missing !== undefined) throw new PlanOrderError(`${missing} of ${group} missing`);
    }
  }
}

/** RFC 4180 CSV: quoted fields (commas, CR/LF and doubled quotes inside), CRLF or LF rows.
 *  Blank lines are dropped. A small hand parser: no CSV dependency in this package. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let i = 0;
  const endRow = (): void => {
    row.push(field);
    if (!(row.length === 1 && row[0] === "")) rows.push(row);
    row = [];
    field = "";
  };
  while (i < text.length) {
    const ch = text[i] as string;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i += 2;
        continue;
      }
      if (ch === '"') quoted = false;
      else field += ch;
      i += 1;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      endRow();
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
    } else field += ch;
    i += 1;
  }
  if (quoted) throw new Error("parseCsv: unterminated quoted field");
  if (field !== "" || row.length > 0) endRow();
  return rows;
}

/** Distinct dataGroupCid values of a hash.csv, read by header name, in first-seen order. */
export function dataGroupCids(hashCsv: string): string[] {
  const [header, ...rows] = parseCsv(readFileSync(hashCsv, "utf8"));
  const col = header?.indexOf("dataGroupCid") ?? -1;
  if (col < 0) throw new Error(`${hashCsv}: no dataGroupCid column`);
  return [...new Set(rows.map((r) => r[col] ?? "").filter((v) => v !== ""))];
}

interface GroupState {
  carRoot: string;
  blocks: number;
  tablesRoot: string;
  archiveJson: string;
}

/**
 * Runs `planned` as phase `phase`, after assertOrdered: the named PlanOrderError comes before
 * any directory is made or any CLI call. `built` carries the groups of an approved build into an
 * upload-only plan. Exported for runBuild/runUpload/runPublish and the order tests.
 */
export async function executePlan(
  phase: SequencePhase,
  planned: readonly PlannedStep[],
  options: SequenceOptions,
  built: readonly GroupResult[] = [],
): Promise<SequenceReport> {
  assertOrdered(planned);
  const runDir = options.runDir ?? options.pilotDir;
  if (!runDir) throw new Error("runDir is required");
  const env = options.env ?? process.env;
  const secrets = secretValues(env);
  let pinnedCli: SequenceReport["pinnedCli"] = null;
  let run = options.run;
  if (!run) {
    const pinned = assertPinnedCli(resolveCli(options.repoRoot ?? process.cwd()));
    pinnedCli = { bin: pinned.bin, commit: pinned.commit as string };
    run = spawnRunner(pinned.bin, { cwd: runDir, env });
  }
  for (const sub of ["reports", "hashed", "car", "tables"])
    mkdirSync(join(runDir, sub), { recursive: true });

  const steps: StepRecord[] = [];
  const groups: GroupResult[] = built.map((g) => ({ ...g }));
  const state = new Map<DataGroup, GroupState>(
    built.map((g) => [
      g.group,
      { carRoot: g.carRoot, blocks: g.blocks, tablesRoot: g.tablesRoot, archiveJson: "" },
    ]),
  );
  const finish = (report: SequenceReport): SequenceReport => {
    // argv and redacted stderr; never a credential (those live in the child env).
    writeFileSync(
      join(runDir, "reports", sequenceReportName(phase)),
      `${redact(JSON.stringify(report, null, 2), secrets)}\n`,
    );
    return report;
  };
  const stop = (p: PlannedStep, reason: string, stderr = ""): SequenceReport =>
    finish({
      ok: false,
      phase,
      pinnedCli,
      steps,
      groups,
      failed: { group: p.group, step: p.step, reason, stderr: redact(stderr, secrets) },
    });

  for (const p of planned) {
    assertCleanArgv(p.argv, secrets);
    const result = await run(p.argv);
    const record: StepRecord = {
      group: p.group,
      step: p.step,
      phase: p.phase,
      argv: p.argv,
      exitCode: result.code,
      outputs: [],
    };
    steps.push(record);
    if (result.code !== 0) return stop(p, `exit code ${result.code}`, result.stderr);
    for (const out of p.outputs) {
      if (!existsSync(out)) return stop(p, `missing output ${out}`, result.stderr);
      record.outputs.push(await digestOutput(out));
    }
    const current = state.get(p.group) ?? {
      carRoot: "",
      blocks: 0,
      tablesRoot: "",
      archiveJson: "",
    };
    state.set(p.group, current);
    if (p.step === "hash") {
      const m = CAR_WRITTEN.exec(result.stdout);
      if (!m) return stop(p, "hash printed no CAR root", result.stderr);
      current.blocks = Number(m[1]);
      current.carRoot = m[2] as string;
      record.blocks = current.blocks;
      record.carRoot = current.carRoot;
    }
    if (p.step === "export-tables") {
      const m = TABLES_WRITTEN.exec(result.stdout);
      if (!m) return stop(p, "export-tables printed no tables root", result.stderr);
      current.tablesRoot = m[1] as string;
      record.tablesRoot = current.tablesRoot;
      const hashCsv = join(runDir, "reports", `${p.group}-hash.csv`);
      groups.push({
        group: p.group,
        groupDir: join(runDir, "groups", p.group),
        carPath: join(runDir, "car", `${options.county}-${p.group}.car`),
        carRoot: current.carRoot,
        blocks: current.blocks,
        hashCsv,
        dataGroupCids: dataGroupCids(hashCsv),
        tablesDir: join(runDir, "tables", p.group),
        tablesRoot: current.tablesRoot,
        tablesExportJson: join(runDir, "reports", `${p.group}-tables-export.json`),
      });
    }
    if (p.step === "upload-car") current.archiveJson = p.outputs[0] as string;
    if (p.step === "upload-tables") {
      const group = groups.find((g) => g.group === p.group);
      if (!group) return stop(p, "upload-tables ran before the group's build steps");
      group.uploads = { archiveJson: current.archiveJson, tablesJson: p.outputs[0] as string };
    }
  }
  return finish({ ok: true, phase, pinnedCli, steps, groups });
}

function runDirOf(options: SequenceOptions): string {
  const runDir = options.runDir ?? options.pilotDir;
  if (!runDir) throw new Error("runDir is required");
  return runDir;
}

/** Phase 1 for every group (the `build` command): never uploads. Writes reports/sequence-build.json. */
export function runBuild(options: SequenceOptions): Promise<SequenceReport> {
  return executePlan(
    "build",
    planBuild(options.county, runDirOf(options), options.groups),
    options,
  );
}

/**
 * Phase 2 only, for the groups of an approved build (the `upload` command, after PO decision
 * D-8 and approval.ts's verifyApprovedBuild): never re-runs phase 1. Writes
 * reports/sequence-upload.json; reports/sequence-build.json is left as the build wrote it.
 */
export function runUpload(
  options: SequenceOptions & { built: readonly GroupResult[] },
): Promise<SequenceReport> {
  const absent = options.groups.filter((g) => !options.built.some((b) => b.group === g));
  if (absent.length > 0) throw new Error(`no approved build for ${absent.join(", ")}`);
  return executePlan(
    "upload",
    planUpload(options.county, runDirOf(options), options.groups),
    options,
    options.built.filter((b) => options.groups.includes(b.group)),
  );
}

/**
 * Phase 1 then phase 2 in one run (the 12-step order the order tests pin). The `upload` command
 * does not use it: it uploads only an approved build (runBuild, then runUpload). Writes
 * reports/sequence-publish.json.
 */
export function runPublish(options: SequenceOptions): Promise<SequenceReport> {
  return executePlan(
    "publish",
    planPublish(options.county, runDirOf(options), options.groups),
    options,
  );
}

/** @deprecated A-02 name of `runBuild`, kept while travis/pilot/run-pilot.ts calls it. */
export const runSequence = runBuild;
