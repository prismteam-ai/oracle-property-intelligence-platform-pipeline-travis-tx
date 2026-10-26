// A-11: the resumable publish driver for one built run manifest (Run 2 onward; Run 1 was done by
// hand). Six steps in a fixed order, each recording receipts under
// specs/011-publish-and-runs/upload-receipts/<runId>/ so a rerun skips finished work and resumes
// at the first unfinished item:
//   0 gate       the identity gate on the manifest (local-or-remote parts), BEFORE any upload
//   1 filebase   elephant-cli upload of every CAR and tables directory (Filebase Kubo RPC)
//   2 car-files  the AM-05 carCid plain files (Kubo add + two-gateway readback)
//   3 manifest   the manifest's own JCS bytes (Kubo add + two-gateway readback)
//   4 cid-copy   the S3 CID copy (copyManifestObjects; already idempotent)
//   4b gate-remote the identity gate again, remote-only: the bytes the app reads, before release/index
//   5 release    the GitHub Release holding the CARs (AD-22 durable backup)
//   6 index      the runs/index.json entry (append-only), written last
// A pilot runs steps 1-4 only: it has no Release and no index entry, and its manifest may not
// live under runs/.
//
// The two gate steps are mandatory: no flag skips them, `--step X` runs `gate` first (and
// `gate-remote` before release/index), and their receipts are keyed by the manifest CID, so a
// receipt for another manifest never counts. A dry run runs the gate for real (it is read-only).
//
// Every effect (CLI, gateways, S3, gh, clock, sleep) is injected through PublishDeps, so the tests
// run with no network. Nothing here prints a credential: the Filebase keys are read into a child
// env only and every logged line is redact()ed.
import { createHash } from "node:crypto";
import {
  createReadStream,
  existsSync,
  mkdirSync,
  openSync,
  closeSync,
  linkSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import { RunManifestV1, type ManifestArtifact } from "@countylens/contract";
import {
  carFileTargets,
  receiptCoversGateways,
  uploadCarFile,
  type CarFileTarget,
  type UploadCarFileOptions,
} from "./car-files.js";
import { cidOfBytes, sameDigest } from "./cid.js";
import type { IdentityGateSummary } from "./identity-gate.js";
import {
  gatewaysAgree,
  probeBothGateways,
  readbackWhole,
  READBACK_GATEWAYS,
} from "./gateway-readback.js";
import { jcsBytes } from "./jcs.js";
import type { FetchLike } from "./kubo-add.js";
import { uploadManifestBytes } from "./manifest-upload.js";
import { GITHUB_ASSET_MAX_BYTES, releaseTag } from "./release.js";
import {
  appendRun,
  emptyRunsIndex,
  parseRunsIndex,
  runsIndexBytes,
  verifyCommittedRuns,
} from "./runs-index.js";
import { FILEBASE_RPC_API, redact, secretValues, type CliResult } from "./sequence.js";

export const PUBLISH_STEPS = [
  "gate",
  "filebase",
  "car-files",
  "manifest",
  "cid-copy",
  "gate-remote",
  "release",
  "index",
] as const;
export type PublishStepName = (typeof PUBLISH_STEPS)[number];
/** Steps a pilot never runs. */
export const PILOT_SKIPPED_STEPS: readonly PublishStepName[] = ["release", "index"];

export const UPLOAD_RECEIPTS_DIR = "specs/011-publish-and-runs/upload-receipts";
export const FILEBASE_UPLOAD_ATTEMPTS = 8;

export interface PublishContext {
  repoRoot: string;
  runId: string;
  pilot: boolean;
  manifestPath: string;
  manifestBytes: Buffer;
  manifestCid: string;
  manifest: RunManifestV1;
  /** specs/011-publish-and-runs/upload-receipts: Run 1's receipts live at its top level. */
  receiptsRoot: string;
  /** receiptsRoot/<runId>: where this run's new receipts are written. */
  receiptsDir: string;
}

export interface PlanItem {
  id: string;
  action: "skip" | "run";
  reason: string;
  /** Run by the driver (real runs only) for a skipped item, e.g. to record an adopted receipt. */
  onSkip?: () => void;
}

export interface StepImpl {
  /** What is done and what is not. `probe` allows read-only network checks. No writes. */
  plan(ctx: PublishContext, options: { probe: boolean }): Promise<PlanItem[]>;
  /** Performs the `run` items; throws on the first failure. Records receipts as it goes. */
  execute(ctx: PublishContext, pending: readonly PlanItem[]): Promise<void>;
  /**
   * Read-only check a dry run performs for real (the gate steps). `deferred` says why it cannot
   * run yet (e.g. the CID copy is not written), which is not a failure.
   */
  dryRunCheck?(ctx: PublishContext): Promise<GateCheck>;
}
export interface GateCheck {
  result: "PASS" | "FAIL";
  failures: string[];
  summary?: IdentityGateSummary;
}
export type StepImpls = Record<PublishStepName, StepImpl>;

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Temp file + rename: a crash never leaves a truncated receipt or index behind. */
function writeAtomic(path: string, data: string | Uint8Array): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, data);
  renameSync(tmp, path);
}

function writeJson(path: string, value: unknown): void {
  writeAtomic(path, `${JSON.stringify(value, null, 2)}\n`);
}

const sha256OfFile = (path: string): Promise<string> =>
  new Promise((done, fail) => {
    const hash = createHash("sha256");
    createReadStream(path)
      .on("data", (chunk) => hash.update(chunk))
      .on("error", fail)
      .on("end", () => done(hash.digest("hex")));
  });

function readJson(path: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function rel(ctx: PublishContext, path: string): string {
  return relative(ctx.repoRoot, path);
}

// ---------------------------------------------------------------------------------------------
// Context

export interface LoadContextOptions {
  repoRoot: string;
  manifestPath: string;
  /** Must equal the manifest's own runId. */
  runId: string;
  pilot: boolean;
}

function isUnder(parent: string, child: string): boolean {
  const r = relative(resolve(parent), resolve(child));
  return r !== "" && !r.startsWith("..") && !r.startsWith("/");
}

/** Reads and checks the manifest: exact JCS bytes of a RunManifestV1 for `runId`; pilot rules. */
export async function loadPublishContext(options: LoadContextOptions): Promise<PublishContext> {
  const { repoRoot, runId, pilot } = options;
  const manifestPath = resolve(repoRoot, options.manifestPath);
  const runsDir = join(repoRoot, "runs");
  if (pilot && isUnder(runsDir, manifestPath))
    throw new Error(
      `a pilot never publishes a manifest under runs/: ${relative(repoRoot, manifestPath)}`,
    );
  if (!pilot && manifestPath !== join(runsDir, runId, "manifest.json"))
    throw new Error(
      `a real run's manifest is runs/${runId}/manifest.json, got ${options.manifestPath}`,
    );
  const manifestBytes = readFileSync(manifestPath);
  const manifest = RunManifestV1.parse(JSON.parse(manifestBytes.toString("utf8")));
  if (manifest.runId !== runId)
    throw new Error(`manifest runId ${manifest.runId} is not --run-id ${runId}`);
  if (!manifestBytes.equals(Buffer.from(jcsBytes(manifest))))
    throw new Error(
      `${options.manifestPath} is not the exact JCS bytes of its RunManifestV1; rebuild it`,
    );
  const receiptsRoot = join(repoRoot, UPLOAD_RECEIPTS_DIR);
  return {
    repoRoot,
    runId,
    pilot,
    manifestPath,
    manifestBytes,
    manifestCid: await cidOfBytes(manifestBytes),
    manifest,
    receiptsRoot,
    receiptsDir: join(receiptsRoot, runId),
  };
}

// ---------------------------------------------------------------------------------------------
// Upload units: a CAR and its tables directory, named like Run 1's receipts (county-b01-car, ...)

interface UploadUnit {
  /** Receipt stem, e.g. county-b01-car / county-b01-tables. */
  id: string;
  artifact: ManifestArtifact;
  kind: "car" | "tables";
  /** For tables: the CAR artifact it belongs to (its receipt's countyRoot must equal it). */
  carCid?: string;
}

/** Pairs each `directory` artifact with the `car` artifact built just before it. */
export function uploadUnits(manifest: RunManifestV1): UploadUnit[] {
  const units: UploadUnit[] = [];
  let lastCar: { stem: string; cid: string } | undefined;
  for (const artifact of manifest.artifacts) {
    if (artifact.kind === "car") {
      const stem = basename(artifact.name, ".car").replace(/^travis-/, "");
      lastCar = { stem, cid: artifact.cid };
      units.push({ id: `${stem}-car`, artifact, kind: "car" });
    } else if (artifact.kind === "directory") {
      const stem = lastCar?.stem ?? basename(artifact.name);
      units.push({
        id: `${stem}-tables`,
        artifact,
        kind: "tables",
        ...(lastCar === undefined ? {} : { carCid: lastCar.cid }),
      });
    }
  }
  return units;
}

// ---------------------------------------------------------------------------------------------
// Steps 0 and 4b: the identity gate (mandatory; no flag skips it)

export interface GateStepDeps {
  /**
   * Runs the identity gate on `ctx.manifestBytes`. `remoteOnly` binds every table part from the
   * CID copy (the bytes the app will read). May throw: a throw is a FAIL.
   */
  run: (ctx: PublishContext, options: { remoteOnly: boolean }) => Promise<IdentityGateSummary>;
  now: () => Date;
  log: (line: string) => void;
}

/** The file recording that the gate passed for exactly this manifest CID. */
export function gateReceiptPath(ctx: PublishContext, remote: boolean): string {
  return join(ctx.receiptsDir, remote ? "gate-remote.json" : "gate.json");
}

/** True only for a PASS receipt of this step recorded for this exact manifest CID. */
export function hasGateReceipt(ctx: PublishContext, remote: boolean): boolean {
  const receipt = readJson(gateReceiptPath(ctx, remote));
  return (
    receipt !== undefined &&
    receipt.manifestCid === ctx.manifestCid &&
    receipt.result === "PASS" &&
    receipt.remoteOnly === remote
  );
}

async function checkGate(
  deps: GateStepDeps,
  ctx: PublishContext,
  remote: boolean,
): Promise<GateCheck> {
  try {
    const summary = await deps.run(ctx, { remoteOnly: remote });
    return { result: summary.result, failures: summary.failures, summary };
  } catch (error) {
    return { result: "FAIL", failures: [`gate could not run: ${message(error)}`] };
  }
}

function gateStep(deps: GateStepDeps, remote: boolean): StepImpl {
  const id = remote ? "gate-remote" : "gate";
  const what = remote ? "remote-only (CID copy) identity gate" : "identity gate";
  return {
    async plan(ctx) {
      return hasGateReceipt(ctx, remote)
        ? [{ id, action: "skip", reason: `PASS receipt ${rel(ctx, gateReceiptPath(ctx, remote))}` }]
        : [
            {
              id,
              action: "run",
              reason: `no ${what} PASS receipt for manifest ${ctx.manifestCid}`,
            },
          ];
    },
    async execute(ctx) {
      const check = await checkGate(deps, ctx, remote);
      if (check.result !== "PASS" || check.summary === undefined)
        throw new Error(
          `${what} FAILED for manifest ${ctx.manifestCid}: ${check.failures.join("; ")}. Publishing is refused.`,
        );
      writeJson(gateReceiptPath(ctx, remote), {
        step: id,
        manifestCid: ctx.manifestCid,
        remoteOnly: remote,
        result: "PASS",
        summary: check.summary,
        recordedAt: deps.now().toISOString(),
      });
      deps.log(
        `${id} PASS: v_roofing_permit ${check.summary.v_roofing_permit}, ${check.summary.permit_side_properties} permit-side properties all county properties`,
      );
    },
    dryRunCheck: (ctx) => checkGate(deps, ctx, remote),
  };
}

// ---------------------------------------------------------------------------------------------
// Step 1: Filebase (elephant-cli upload)

interface ReceiptFile {
  path: string;
  root: string;
  countyRoot?: string;
}

/** Every elephant-cli upload receipt (has `api` and `root`) at the top of `root` and one level down. */
export function scanUploadReceipts(root: string): ReceiptFile[] {
  if (!existsSync(root)) return [];
  const files: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".json")) files.push(join(root, entry.name));
    else if (entry.isDirectory()) {
      for (const inner of readdirSync(join(root, entry.name), { withFileTypes: true }))
        if (inner.isFile() && inner.name.endsWith(".json"))
          files.push(join(root, entry.name, inner.name));
    }
  }
  const out: ReceiptFile[] = [];
  for (const path of files) {
    const json = readJson(path);
    if (json === undefined || typeof json.api !== "string" || typeof json.root !== "string")
      continue;
    out.push({
      path,
      root: json.root,
      ...(typeof json.countyRoot === "string" ? { countyRoot: json.countyRoot } : {}),
    });
  }
  return out;
}

function sameCid(a: string, b: string): boolean {
  try {
    return sameDigest(a, b);
  } catch {
    return false;
  }
}

/** Throws when `receipt` does not describe `unit` (root, and for tables the CAR it indexes). */
function assertReceiptMatches(unit: UploadUnit, receipt: ReceiptFile): void {
  if (!sameCid(receipt.root, unit.artifact.cid))
    throw new Error(
      `receipt ${receipt.path} records root ${receipt.root} but the manifest says ${unit.artifact.cid} for ${unit.id}`,
    );
  if (
    unit.kind === "tables" &&
    unit.carCid !== undefined &&
    receipt.countyRoot !== undefined &&
    !sameCid(receipt.countyRoot, unit.carCid)
  )
    throw new Error(
      `receipt ${receipt.path} records countyRoot ${receipt.countyRoot} but the manifest's CAR is ${unit.carCid} for ${unit.id}`,
    );
}

export interface FilebaseStepDeps {
  /** Filebase credentials in a child env; throws when they are unusable. Called only when uploading. */
  loadEnv: () => NodeJS.ProcessEnv;
  runCli: (argv: string[], env: NodeJS.ProcessEnv) => Promise<CliResult>;
  sleep: (ms: number) => Promise<void>;
  log: (line: string) => void;
  attempts?: number;
  /** Walk the pending units from the end: a second worker started with this never meets the first early. */
  reverse?: boolean;
  /** Upload only these unit kinds (for example only "car" while the provider's dag/import of tables hangs). */
  kinds?: readonly string[];
  /** Test seam: called right after a unit's lock is taken, before the receipt re-check. */
  onLockTaken?: (unitId: string) => void;
  /** Upload only these unit ids (one runner of a split job); every other unit is left for another worker. */
  units?: readonly string[];
}

/** Whether a unit of `kind` is uploaded by a worker limited to `kinds` (no limit when empty). */
export function unitSelected(kind: string, kinds: readonly string[] | undefined): boolean {
  return kinds === undefined || kinds.length === 0 || kinds.includes(kind);
}

/**
 * Takes the per-unit upload lock (`<receipt>.lock`, holding the owner's pid) so two filebase workers
 * never upload the same unit. A lock whose pid is no longer alive is stale and is taken over.
 * Returns a release function, or undefined when another live worker holds the unit.
 */
export function tryUnitLock(
  lockPath: string,
  pid: number = process.pid,
  alive: (pid: number) => boolean = processAlive,
): (() => void) | undefined {
  // A11-17 R5: the pid goes into a private temp file and is published with a hard link, so the lock
  // never exists empty (a reader would take that for stale), and a stale lock is replaced only by
  // the one worker that creates the takeover guard (exclusive create); everyone else backs off.
  const readOwner = (): number => {
    try {
      return Number(readFileSync(lockPath, "utf8").trim());
    } catch {
      return Number.NaN; // vanished or unreadable
    }
  };
  const create = (): boolean => {
    const tmp = `${lockPath}.${pid}.${process.pid}.tmp`;
    writeFileSync(tmp, String(pid));
    try {
      linkSync(tmp, lockPath);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
      throw error;
    } finally {
      rmSync(tmp, { force: true });
    }
  };
  const release = (): void => {
    if (readOwner() === pid) rmSync(lockPath, { force: true });
  };
  if (create()) return release;
  const owner = readOwner();
  if (Number.isInteger(owner) && owner > 0 && owner !== pid && alive(owner)) return undefined;
  const guard = `${lockPath}.takeover`;
  try {
    closeSync(openSync(guard, "wx"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return undefined;
    throw error;
  }
  try {
    const now = readOwner();
    // Changed hands since we judged it stale (a rival finished a takeover): not ours to replace.
    if (!Object.is(now, owner) && !Number.isNaN(now)) return undefined;
    const aside = `${lockPath}.stale.${pid}.${process.pid}`;
    try {
      renameSync(lockPath, aside);
      rmSync(aside, { force: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    return create() ? release : undefined;
  } finally {
    rmSync(guard, { force: true });
  }
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function filebaseStep(deps: FilebaseStepDeps): StepImpl {
  const attempts = deps.attempts ?? FILEBASE_UPLOAD_ATTEMPTS;
  return {
    async plan(ctx) {
      const all = scanUploadReceipts(ctx.receiptsRoot);
      return uploadUnits(ctx.manifest).map((unit): PlanItem => {
        const own = join(ctx.receiptsDir, `${unit.id}.json`);
        if (existsSync(own)) {
          const receipt = all.find((r) => r.path === own);
          if (receipt === undefined)
            throw new Error(`${rel(ctx, own)} is not an upload receipt (no api/root)`);
          assertReceiptMatches(unit, receipt);
          return { id: unit.id, action: "skip", reason: `receipt ${rel(ctx, own)}` };
        }
        const other = all.find((r) => sameCid(r.root, unit.artifact.cid));
        if (other !== undefined) {
          assertReceiptMatches(unit, other);
          return {
            id: unit.id,
            action: "skip",
            reason: `receipt ${rel(ctx, other.path)} records this CID`,
          };
        }
        return { id: unit.id, action: "run", reason: "no receipt records this CID" };
      });
    },
    async execute(ctx, pending) {
      const env = deps.loadEnv();
      const secrets = secretValues(env);
      const units = new Map(uploadUnits(ctx.manifest).map((u) => [u.id, u]));
      const unknown = (deps.units ?? []).filter((id) => !units.has(id));
      if (unknown.length > 0)
        throw new Error(
          `PUBLISH_FILEBASE_UNITS names units the manifest does not have: ${unknown.join(", ")}`,
        );
      const order = deps.reverse === true ? [...pending].reverse() : pending;
      for (const item of order) {
        const unit = units.get(item.id);
        if (unit === undefined) throw new Error(`no upload unit ${item.id}`);
        if (!unitSelected(unit.kind, deps.kinds)) {
          deps.log(`skip ${unit.id} (this worker uploads only ${(deps.kinds ?? []).join(", ")})`);
          continue;
        }
        if (!unitSelected(unit.id, deps.units)) {
          deps.log(`skip ${unit.id} (another runner uploads it)`);
          continue;
        }
        // A tables folder links its batch CAR (county_root): Filebase pins it recursively, so the
        // folder waits until a receipt records that CAR (Run 3.1: a folder uploaded first never pinned).
        if (
          unit.kind === "tables" &&
          unit.carCid !== undefined &&
          !scanUploadReceipts(ctx.receiptsRoot).some((r) => sameCid(r.root, unit.carCid as string))
        ) {
          deps.log(`skip ${unit.id} (waiting for its CAR ${unit.carCid} to have a receipt)`);
          continue;
        }
        const final = join(ctx.receiptsDir, `${unit.id}.json`);
        const partial = `${final}.partial`;
        mkdirSync(ctx.receiptsDir, { recursive: true });
        // Another worker may have finished this unit since the plan was made.
        if (scanUploadReceipts(ctx.receiptsRoot).some((r) => sameCid(r.root, unit.artifact.cid))) {
          deps.log(`skip ${unit.id} (a receipt now records this CID)`);
          continue;
        }
        const release = tryUnitLock(`${final}.lock`);
        if (release === undefined) {
          deps.log(`skip ${unit.id} (another worker is uploading it)`);
          continue;
        }
        try {
          deps.onLockTaken?.(unit.id);
          // A11-17 R5: re-check AFTER taking the lock. Another worker may have finished and
          // released this unit between the first check and our lock; uploading again is wasted
          // work (content-addressed, so harmless) and would overwrite its receipt.
          if (
            scanUploadReceipts(ctx.receiptsRoot).some((r) => sameCid(r.root, unit.artifact.cid))
          ) {
            deps.log(`skip ${unit.id} (a receipt appeared while taking the lock)`);
            continue;
          }
          const input = join(ctx.repoRoot, unit.artifact.name);
          if (!existsSync(input))
            throw new Error(`${unit.id}: ${unit.artifact.name} does not exist`);
          let done = false;
          for (let attempt = 1; attempt <= attempts && !done; attempt += 1) {
            rmSync(partial, { force: true });
            deps.log(`uploading ${unit.id} (attempt ${attempt}/${attempts})`);
            let result: CliResult | undefined;
            let failure = "";
            try {
              result = await deps.runCli(
                ["upload", input, "--api", FILEBASE_RPC_API, "--output-json", partial],
                env,
              );
            } catch (error) {
              failure = message(error);
            }
            if (result !== undefined && result.code === 0 && existsSync(partial)) {
              const receipt = scanOne(partial);
              if (receipt === undefined)
                throw new Error(`${unit.id}: upload wrote no usable --output-json receipt`);
              // A wrong root is not transient: fail now, keep nothing.
              try {
                assertReceiptMatches(unit, receipt);
              } catch (error) {
                rmSync(partial, { force: true });
                throw error;
              }
              renameSync(partial, final);
              deps.log(`done ${unit.id} -> ${rel(ctx, final)}`);
              done = true;
              break;
            }
            if (result !== undefined)
              failure = `exit ${result.code}: ${(result.stderr || result.stdout).trim().slice(-300)}`;
            deps.log(redact(`failed ${unit.id}: ${failure}`, secrets));
            if (attempt < attempts) await deps.sleep(Math.min(5_000 * 2 ** (attempt - 1), 120_000));
          }
          rmSync(partial, { force: true });
          if (!done) throw new Error(`${unit.id}: upload failed after ${attempts} attempts`);
        } finally {
          release();
        }
      }
    },
  };
}

function scanOne(path: string): ReceiptFile | undefined {
  const json = readJson(path);
  if (json === undefined || typeof json.root !== "string") return undefined;
  return {
    path,
    root: json.root,
    ...(typeof json.countyRoot === "string" ? { countyRoot: json.countyRoot } : {}),
  };
}

// ---------------------------------------------------------------------------------------------
// Step 2: the carCid plain files (AM-05)

export interface CarFilesStepDeps {
  loadEnv: () => NodeJS.ProcessEnv;
  fetch?: FetchLike;
  add?: UploadCarFileOptions["add"];
  now: () => Date;
  log: (line: string) => void;
  /** Readback gateways for the carCid files; default both (see UploadCarFileOptions). */
  readbackGateways?: readonly string[];
  /**
   * Skip the "already served?" gateway probe before uploading. Both gateways hang on a CID they
   * do not hold, so for a new run the probe only costs time; the upload is idempotent (same bytes,
   * same CID) and the local receipts still skip finished files.
   */
  skipProbe?: boolean;
  /**
   * Plan only the files already on disk; a missing one is skipped with no receipt, so a later
   * call uploads it. For a runner that fetches the CARs one by one as the CID copy fills.
   */
  presentOnly?: boolean;
}

function carFileId(ctx: PublishContext, target: CarFileTarget): string {
  const unit = uploadUnits(ctx.manifest).find((u) => u.artifact.name === target.name);
  return unit?.id ?? basename(target.name);
}

function carFilesStep(deps: CarFilesStepDeps): StepImpl {
  const receiptPath = (ctx: PublishContext, id: string): string =>
    join(ctx.receiptsDir, "carfiles", `${id}.json`);
  const validLocal = (
    ctx: PublishContext,
    target: CarFileTarget,
    size: number,
  ): string | undefined => {
    const path = receiptPath(ctx, carFileId(ctx, target));
    const json = readJson(path);
    // A11-17 R4: a receipt that deferred a gateway this run must read back is not a full receipt.
    return json !== undefined &&
      json.carCid === target.carCid &&
      json.size === size &&
      receiptCoversGateways(
        json as Parameters<typeof receiptCoversGateways>[0],
        deps.readbackGateways ?? READBACK_GATEWAYS,
      )
      ? path
      : undefined;
  };
  return {
    async plan(ctx, { probe }) {
      const items: PlanItem[] = [];
      for (const target of carFileTargets(ctx.manifest, ctx.repoRoot)) {
        const id = carFileId(ctx, target);
        const size = ctx.manifest.artifacts.find((a) => a.name === target.name)?.size ?? 0;
        const local = validLocal(ctx, target, size);
        if (local !== undefined) {
          items.push({ id, action: "skip", reason: `receipt ${rel(ctx, local)}` });
          continue;
        }
        if (deps.presentOnly === true && !existsSync(target.path)) {
          // Still "run": it has no receipt, so the step's completion check and the index gate count
          // it as open (code review 2026-10-26). execute() leaves it for a later call.
          items.push({ id, action: "run", reason: "file not fetched yet (no receipt written)" });
          continue;
        }
        if (probe && deps.skipProbe !== true) {
          const checks = await probeBothGateways(target.carCid, size, deps.fetch);
          if (gatewaysAgree(checks)) {
            items.push({
              id,
              action: "skip",
              reason:
                "a gateway serves this carCid at the manifest size and none disagrees (a rate-limited one is not counted against it)",
              onSkip: () =>
                writeJson(receiptPath(ctx, id), {
                  name: target.name,
                  carCid: target.carCid,
                  size,
                  adopted: true,
                  gateways: checks,
                  deferredGateways: [],
                  recordedAt: deps.now().toISOString(),
                }),
            });
            continue;
          }
        }
        items.push({
          id,
          action: "run",
          reason:
            deps.skipProbe === true
              ? "no local receipt (gateway probe skipped)"
              : probe
                ? "not confirmed by the gateways"
                : "no local receipt (not probed offline)",
        });
      }
      return items;
    },
    async execute(ctx, pending) {
      const env = deps.loadEnv();
      const byId = new Map(
        carFileTargets(ctx.manifest, ctx.repoRoot).map((t) => [carFileId(ctx, t), t]),
      );
      for (const item of pending) {
        const target = byId.get(item.id);
        if (target === undefined) throw new Error(`no carCid target ${item.id}`);
        const result = await uploadCarFile(target, {
          env,
          ...(deps.readbackGateways === undefined
            ? {}
            : { readbackGateways: deps.readbackGateways }),
          log: (line) => deps.log(`  ${item.id}: ${line}`),
          ...(deps.fetch === undefined ? {} : { fetch: deps.fetch }),
          ...(deps.add === undefined ? {} : { add: deps.add }),
        });
        if (!result.ok) throw new Error(`${item.id}: ${result.error ?? "carCid upload failed"}`);
        writeJson(receiptPath(ctx, item.id), {
          name: target.name,
          carCid: target.carCid,
          size: result.size,
          adopted: false,
          gateways: result.gateways,
          deferredGateways: result.deferredGateways,
          recordedAt: deps.now().toISOString(),
        });
      }
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Step 3: the manifest's own bytes

export interface ManifestStepDeps {
  loadEnv: () => NodeJS.ProcessEnv;
  fetch?: FetchLike;
  now: () => Date;
  log: (line: string) => void;
}

function manifestStep(deps: ManifestStepDeps): StepImpl {
  const receiptPath = (ctx: PublishContext): string =>
    join(ctx.receiptsDir, "manifest-upload.json");
  const write = (ctx: PublishContext, adopted: boolean, sha256: string): void =>
    writeJson(receiptPath(ctx), {
      cid: ctx.manifestCid,
      size: ctx.manifestBytes.length,
      sha256,
      adopted,
      recordedAt: deps.now().toISOString(),
    });
  return {
    async plan(ctx, { probe }) {
      const id = "manifest";
      const local = readJson(receiptPath(ctx));
      if (local !== undefined && local.cid === ctx.manifestCid)
        return [{ id, action: "skip", reason: `receipt ${rel(ctx, receiptPath(ctx))}` }];
      if (probe) {
        const sha256 = createHash("sha256").update(ctx.manifestBytes).digest("hex");
        const checks = [];
        for (const gateway of READBACK_GATEWAYS)
          checks.push(
            await readbackWhole(
              gateway,
              ctx.manifestCid,
              { size: ctx.manifestBytes.length, sha256 },
              deps.fetch,
            ),
          );
        if (gatewaysAgree(checks))
          return [
            {
              id,
              action: "skip",
              reason:
                "a gateway serves the manifest bytes and none disagrees (a rate-limited one is not counted against it)",
              onSkip: () => write(ctx, true, sha256),
            },
          ];
      }
      return [
        {
          id,
          action: "run",
          reason: probe ? "not confirmed by the gateways" : "no local receipt (not probed offline)",
        },
      ];
    },
    async execute(ctx) {
      const result = await uploadManifestBytes(ctx.manifestBytes, {
        env: deps.loadEnv(),
        log: (line) => deps.log(`  manifest: ${line}`),
        ...(deps.fetch === undefined ? {} : { fetch: deps.fetch }),
      });
      if (result.cid !== ctx.manifestCid)
        throw new Error(
          `manifest upload returned CID ${result.cid}, the manifest CID is ${ctx.manifestCid}`,
        );
      if (!result.ok)
        throw new Error("manifest readback: not both gateways served identical bytes");
      write(ctx, false, result.sha256);
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Step 4: the S3 CID copy

export interface CidCopyStepDeps {
  copy: (ctx: PublishContext) => Promise<{ written: number; skipped: number; total: number }>;
  now: () => Date;
}

function cidCopyStep(deps: CidCopyStepDeps): StepImpl {
  const receiptPath = (ctx: PublishContext): string => join(ctx.receiptsDir, "cid-copy.json");
  return {
    async plan(ctx) {
      const local = readJson(receiptPath(ctx));
      if (local !== undefined && local.manifestCid === ctx.manifestCid)
        return [
          { id: "cid-copy", action: "skip", reason: `receipt ${rel(ctx, receiptPath(ctx))}` },
        ];
      return [
        {
          id: "cid-copy",
          action: "run",
          reason: "no receipt (the copy is idempotent: each object is HEAD-checked first)",
        },
      ];
    },
    async execute(ctx) {
      const report = await deps.copy(ctx);
      writeJson(receiptPath(ctx), {
        manifestCid: ctx.manifestCid,
        written: report.written,
        skipped: report.skipped,
        total: report.total,
        recordedAt: deps.now().toISOString(),
      });
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Step 5: the GitHub Release

export interface GhAsset {
  name: string;
  size: number;
  /** `sha256:<hex>` as `gh release view --json assets` prints it. */
  digest: string | null;
  state: string;
}
export interface GhRelease {
  tagName: string;
  assets: GhAsset[];
}
export interface GhClient {
  /** null when the release does not exist. */
  view(tag: string): Promise<GhRelease | null>;
  create(options: {
    tag: string;
    title: string;
    notes: string;
    target: string;
    files: string[];
  }): Promise<void>;
  upload(tag: string, files: string[]): Promise<void>;
  deleteAsset(tag: string, name: string): Promise<void>;
}

export interface ReleaseStepOptions {
  tag?: string;
  /** Earlier releases whose identical assets (same name and SHA-256) are not uploaded again. */
  reuseTags?: readonly string[];
  /** The ref the new tag points at (default: the current branch). */
  target?: string;
}
export interface ReleaseStepDeps {
  gh: GhClient;
  options: ReleaseStepOptions;
  currentBranch: () => string;
  now: () => Date;
  log: (line: string) => void;
}

interface ReleaseAssetWant {
  name: string;
  path: string;
  size: number;
  sha256: string;
}

export function releaseAssets(ctx: PublishContext): ReleaseAssetWant[] {
  return ctx.manifest.artifacts
    .filter((a) => a.kind === "car")
    .map((a) => ({
      name: basename(a.name),
      path: join(ctx.repoRoot, a.name),
      size: a.size,
      sha256: a.sha256,
    }));
}

function releaseNotes(ctx: PublishContext, reuse: readonly string[]): string {
  const cars = releaseAssets(ctx).length;
  const lines = [
    `${ctx.runId}: CAR files for story A-11, attached as a re-pinnable durability backup (AD-22).`,
    "",
    `- Manifest CID: ${ctx.manifestCid}`,
    `- Previous manifest CID: ${String(ctx.manifest.previousManifestCid)}`,
    `- CAR files in the manifest: ${cars}`,
    "- Primary pin: Filebase. Verify from two independent gateways: Filebase's gateway and Pinata's public gateway.",
  ];
  if (reuse.length > 0)
    lines.push(
      `- CARs byte-identical to an earlier run's are attached to that run's release (${reuse.join(", ")}), not repeated here.`,
    );
  return lines.join("\n");
}

function digestOf(a: GhAsset): string | undefined {
  return a.digest?.replace(/^sha256:/, "");
}

function releaseStep(deps: ReleaseStepDeps): StepImpl {
  const tagOf = (ctx: PublishContext): string => deps.options.tag ?? releaseTag(ctx.runId);
  const receiptPath = (ctx: PublishContext): string => join(ctx.receiptsDir, "release.json");
  const reuse = deps.options.reuseTags ?? [];

  async function assess(ctx: PublishContext): Promise<{
    release: GhRelease | null;
    items: (PlanItem & { want: ReleaseAssetWant; replace: boolean })[];
    reusedFrom: Record<string, string>;
  }> {
    const release = await deps.gh.view(tagOf(ctx));
    const reused = new Map<string, GhRelease>();
    for (const t of reuse) {
      const r = await deps.gh.view(t);
      if (r !== null) reused.set(t, r);
    }
    const reusedFrom: Record<string, string> = {};
    const items = releaseAssets(ctx).map((want) => {
      if (want.size > GITHUB_ASSET_MAX_BYTES)
        throw new Error(
          `${want.name} is over GitHub's 2 GiB asset cap; split it with release.ts planRelease first`,
        );
      const here = release?.assets.find((a) => a.name === want.name);
      if (here !== undefined) {
        if (here.state === "uploaded") {
          if (digestOf(here) !== want.sha256)
            throw new Error(
              `release ${tagOf(ctx)} has ${want.name} with a different SHA-256; refusing to replace a published asset`,
            );
          return {
            id: want.name,
            action: "skip" as const,
            reason: `already in release ${tagOf(ctx)}`,
            want,
            replace: false,
          };
        }
        return {
          id: want.name,
          action: "run" as const,
          reason: `asset state ${here.state}: delete and re-upload`,
          want,
          replace: true,
        };
      }
      for (const [t, r] of reused) {
        const other = r.assets.find(
          (a) => a.name === want.name && a.state === "uploaded" && digestOf(a) === want.sha256,
        );
        if (other !== undefined) {
          reusedFrom[want.name] = t;
          return {
            id: want.name,
            action: "skip" as const,
            reason: `identical asset already in release ${t}`,
            want,
            replace: false,
          };
        }
      }
      return {
        id: want.name,
        action: "run" as const,
        reason: "not attached",
        want,
        replace: false,
      };
    });
    return { release, items, reusedFrom };
  }

  const writeReceipt = (
    ctx: PublishContext,
    adopted: boolean,
    reusedFrom: Record<string, string>,
  ): void =>
    writeJson(receiptPath(ctx), {
      tag: tagOf(ctx),
      manifestCid: ctx.manifestCid,
      adopted,
      reusedFrom,
      assets: releaseAssets(ctx).map((a) => ({ name: a.name, size: a.size, sha256: a.sha256 })),
      recordedAt: deps.now().toISOString(),
    });

  return {
    async plan(ctx, { probe }) {
      const local = readJson(receiptPath(ctx));
      if (local !== undefined && local.manifestCid === ctx.manifestCid && local.tag === tagOf(ctx))
        return [{ id: "release", action: "skip", reason: `receipt ${rel(ctx, receiptPath(ctx))}` }];
      if (!probe)
        return [{ id: "release", action: "run", reason: "no local receipt (not probed offline)" }];
      const { items, reusedFrom } = await assess(ctx);
      const pending = items.filter((i) => i.action === "run");
      if (pending.length === 0)
        return [
          {
            id: "release",
            action: "skip",
            reason: `all ${items.length} CARs are attached`,
            onSkip: () => writeReceipt(ctx, true, reusedFrom),
          },
        ];
      return items.map(({ id, action, reason }) => ({ id, action, reason }));
    },
    async execute(ctx) {
      const tag = tagOf(ctx);
      const { release, items, reusedFrom } = await assess(ctx);
      const pending = items.filter((i) => i.action === "run");
      if (pending.length > 0) {
        for (const i of pending) {
          if (!existsSync(i.want.path))
            throw new Error(`${i.want.name}: ${rel(ctx, i.want.path)} does not exist`);
          // A published asset is never replaced later, so a wrong local CAR must not go out.
          const got = await sha256OfFile(i.want.path);
          if (got !== i.want.sha256)
            throw new Error(
              `${i.want.name}: ${rel(ctx, i.want.path)} hashes to ${got}, the manifest says ${i.want.sha256}`,
            );
          if (i.replace) await deps.gh.deleteAsset(tag, i.want.name);
        }
        const files = pending.map((i) => i.want.path);
        if (release === null) {
          deps.log(`creating release ${tag} with ${files.length} assets`);
          await deps.gh.create({
            tag,
            title: `A-11 ${ctx.runId}: Travis County CARs`,
            notes: releaseNotes(ctx, Object.values(reusedFrom).length > 0 ? reuse : []),
            target: deps.options.target ?? deps.currentBranch(),
            files,
          });
        } else {
          deps.log(`uploading ${files.length} assets to release ${tag}`);
          await deps.gh.upload(tag, files);
        }
      }
      const after = await assess(ctx);
      const missing = after.items.filter((i) => i.action === "run");
      if (missing.length > 0)
        throw new Error(`release ${tag} is still missing: ${missing.map((m) => m.id).join(", ")}`);
      writeReceipt(ctx, false, after.reusedFrom);
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Step 6: runs/index.json

export interface IndexStepDeps {
  log: (line: string) => void;
}

function indexStep(deps: IndexStepDeps): StepImpl {
  const indexPath = (ctx: PublishContext): string => join(ctx.repoRoot, "runs", "index.json");
  const read = (ctx: PublishContext) =>
    existsSync(indexPath(ctx)) ? parseRunsIndex(readFileSync(indexPath(ctx))) : emptyRunsIndex();
  return {
    async plan(ctx) {
      const listed = read(ctx).runs.find((r) => r.runId === ctx.runId);
      if (listed === undefined)
        return [{ id: "index", action: "run", reason: "runs/index.json does not list this run" }];
      if (listed.manifestCid !== ctx.manifestCid)
        throw new Error(
          `runs/index.json lists ${ctx.runId} with manifestCid ${listed.manifestCid}, not ${ctx.manifestCid}; a committed manifestCid is never altered`,
        );
      return [
        { id: "index", action: "skip", reason: "runs/index.json already lists this manifest CID" },
      ];
    },
    async execute(ctx) {
      const next = appendRun(read(ctx), {
        runId: ctx.runId,
        manifestCid: ctx.manifestCid,
        finishedAt: ctx.manifest.finishedAt,
      });
      const before = existsSync(indexPath(ctx)) ? readFileSync(indexPath(ctx)) : null;
      writeAtomic(indexPath(ctx), runsIndexBytes(next));
      const check = await verifyCommittedRuns(join(ctx.repoRoot, "runs"));
      if (!check.ok) {
        // Put the previous index back, so a rerun attempts (and verifies) the append again.
        if (before === null) rmSync(indexPath(ctx), { force: true });
        else writeAtomic(indexPath(ctx), before);
        throw new Error(
          `runs/ failed verification after the index write: ${check.checks
            .filter((c) => !c.ok)
            .map((c) => `${c.runId}: ${c.reason}`)
            .join("; ")}`,
        );
      }
      deps.log(`runs/index.json now lists ${ctx.runId}`);
    },
  };
}

// ---------------------------------------------------------------------------------------------
// The driver

export interface PublishDeps {
  /** Used for both gate steps. There is no way to leave it out. */
  gate: GateStepDeps;
  filebase: FilebaseStepDeps;
  carFiles: CarFilesStepDeps;
  manifest: ManifestStepDeps;
  cidCopy: CidCopyStepDeps;
  release: ReleaseStepDeps;
  index: IndexStepDeps;
}

/** The real step implementations over `deps` (tests pass fakes for every effect). */
export function createPublishSteps(deps: PublishDeps): StepImpls {
  return {
    gate: gateStep(deps.gate, false),
    filebase: filebaseStep(deps.filebase),
    "car-files": carFilesStep(deps.carFiles),
    manifest: manifestStep(deps.manifest),
    "cid-copy": cidCopyStep(deps.cidCopy),
    "gate-remote": gateStep(deps.gate, true),
    release: releaseStep(deps.release),
    index: indexStep(deps.index),
  };
}

export interface StepReport {
  step: PublishStepName;
  status: "already-done" | "done" | "would-run" | "not-applicable" | "failed" | "checked";
  items: { id: string; action: "skip" | "run"; reason: string }[];
  error?: string;
  /** Dry run only, gate steps: what the real (read-only) gate said. */
  gate?: GateCheck;
  /** Dry run, gate-remote only: not run yet because the CID copy is still to be written. */
  deferred?: string;
}
export interface PublishReport {
  runId: string;
  manifestCid: string;
  mode: "dry-run" | "dry-run+probe" | "run";
  pilot: boolean;
  steps: StepReport[];
  ok: boolean;
  /** Dry run: true when a real run would be refused by a gate (ok is false too). */
  refused?: boolean;
}

export interface RunPublishOptions {
  ctx: PublishContext;
  impls: StepImpls;
  /** Run only this step (still refused for a pilot's release/index). */
  step?: PublishStepName;
  dryRun: boolean;
  /** Dry run only: allow read-only network checks (gateway range requests, `gh release view`). */
  probe?: boolean;
}

function stepsToRun(options: RunPublishOptions): {
  run: PublishStepName[];
  notApplicable: PublishStepName[];
} {
  const { ctx, step } = options;
  if (step !== undefined && ctx.pilot && PILOT_SKIPPED_STEPS.includes(step))
    throw new Error(
      `a pilot has no ${step} step: it is never released or added to runs/index.json`,
    );
  // The gates are mandatory: any single step still runs behind `gate`, and release/index behind
  // `gate-remote` as well. Nothing can select a step without them.
  if (step !== undefined) {
    const behind: PublishStepName[] = [];
    if (step !== "gate") behind.push("gate");
    if (step === "release" || step === "index") behind.push("gate-remote");
    return {
      run: PUBLISH_STEPS.filter((s) => s === step || behind.includes(s)),
      notApplicable: [],
    };
  }
  const notApplicable = ctx.pilot ? [...PILOT_SKIPPED_STEPS] : [];
  return { run: PUBLISH_STEPS.filter((s) => !notApplicable.includes(s)), notApplicable };
}

/**
 * Runs the steps in order. A failed step stops the run (the report says which); finished items
 * are skipped on the next call. A dry run makes no write and, without `probe`, no network call.
 */
export async function runPublish(options: RunPublishOptions): Promise<PublishReport> {
  const { ctx, impls, dryRun } = options;
  const probe = options.probe === true;
  const { run, notApplicable } = stepsToRun(options);
  const report: PublishReport = {
    runId: ctx.runId,
    manifestCid: ctx.manifestCid,
    mode: dryRun ? (probe ? "dry-run+probe" : "dry-run") : "run",
    pilot: ctx.pilot,
    steps: [],
    ok: true,
  };

  // The index is the last, public-facing write: only after every earlier step has its receipts.
  if (!dryRun && options.step === "index") {
    for (const earlier of PUBLISH_STEPS.slice(0, PUBLISH_STEPS.indexOf("index"))) {
      const items = await impls[earlier].plan(ctx, { probe: false });
      const open = items.filter((i) => i.action === "run");
      if (open.length > 0)
        throw new Error(
          `refusing to write the index: step ${earlier} has ${open.length} unfinished item(s) (no receipt); run it first`,
        );
    }
  }

  for (const name of PUBLISH_STEPS) {
    if (notApplicable.includes(name)) {
      report.steps.push({ step: name, status: "not-applicable", items: [] });
      continue;
    }
    if (!run.includes(name)) continue;
    const impl = impls[name];
    try {
      const items = await impl.plan(ctx, { probe: !dryRun || probe });
      const summary = items.map(({ id, action, reason }) => ({ id, action, reason }));
      const pending = items.filter((i) => i.action === "run");
      if (dryRun) {
        if (impl.dryRunCheck !== undefined) {
          // The gate is read-only, so a dry run runs it for real. gate-remote reads the CID copy,
          // which cid-copy writes: while that is still to be done it cannot be checked yet.
          const copyPending =
            report.steps.find((s) => s.step === "cid-copy")?.status === "would-run";
          if (name === "gate-remote" && copyPending) {
            report.steps.push({
              step: name,
              status: "would-run",
              items: summary,
              deferred: "runs after cid-copy writes the CID copy",
            });
            continue;
          }
          const gate = await impl.dryRunCheck(ctx);
          if (gate.result === "FAIL") {
            report.steps.push({
              step: name,
              status: "failed",
              items: summary,
              gate,
              error: `${name} FAILED: ${gate.failures.join("; ")}`,
            });
            report.ok = false;
            report.refused = true;
            break;
          }
          report.steps.push({ step: name, status: "checked", items: summary, gate });
          continue;
        }
        report.steps.push({
          step: name,
          status: pending.length === 0 ? "already-done" : "would-run",
          items: summary,
        });
        continue;
      }
      for (const i of items) if (i.action === "skip") i.onSkip?.();
      if (pending.length === 0) {
        report.steps.push({ step: name, status: "already-done", items: summary });
        continue;
      }
      await impl.execute(ctx, pending);
      // The receipts must now say it is done; a step that finished without recording them would
      // be redone on the next run.
      const after = (await impl.plan(ctx, { probe: false })).filter((i) => i.action === "run");
      if (after.length > 0)
        throw new Error(
          `step ${name} finished but ${after.length} item(s) still have no receipt: ${after.map((i) => i.id).join(", ")}`,
        );
      report.steps.push({ step: name, status: "done", items: summary });
    } catch (error) {
      report.steps.push({ step: name, status: "failed", items: [], error: message(error) });
      report.ok = false;
      if (dryRun && (name === "gate" || name === "gate-remote")) report.refused = true;
      break;
    }
  }
  return report;
}

// ---------------------------------------------------------------------------------------------
// Command line

export interface PublishArgs {
  manifest: string;
  runId: string;
  step?: PublishStepName;
  dryRun: boolean;
  probe: boolean;
  pilot: boolean;
  cli?: string;
  releaseTag?: string;
  releaseReuseTags?: string[];
  releaseTarget?: string;
  repo?: string;
  copyHost: string;
}

/**
 * The accepted flags. There is deliberately no flag that skips or forces a gate (no --force, no
 * --skip-gate): parsing is strict, so an unknown flag is an error, not a bypass.
 */
export function parsePublishArgs(
  argv: readonly string[],
  env: Record<string, string | undefined> = {},
): PublishArgs {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      manifest: { type: "string" },
      "run-id": { type: "string" },
      step: { type: "string" },
      "dry-run": { type: "boolean", default: false },
      probe: { type: "boolean", default: false },
      pilot: { type: "boolean", default: false },
      cli: { type: "string" },
      "release-tag": { type: "string" },
      "release-reuse-tag": { type: "string", multiple: true },
      "release-target": { type: "string" },
      repo: { type: "string" },
      "copy-host": { type: "string" },
    },
    strict: true,
  });
  if (values.manifest === undefined || values["run-id"] === undefined)
    throw new Error(
      "usage: publish-run.ts --manifest <path> --run-id <id> [--step <name>] [--dry-run [--probe]] [--pilot] [--copy-host <host>]",
    );
  if (values.step !== undefined && !PUBLISH_STEPS.includes(values.step as PublishStepName))
    throw new Error(`--step must be one of: ${PUBLISH_STEPS.join(", ")}`);
  if (values.probe && !values["dry-run"])
    throw new Error(
      "--probe only applies to --dry-run (a real run always checks before it uploads)",
    );
  const copyHost = values["copy-host"] ?? env["CID_COPY_HOST"];
  if (copyHost === undefined || copyHost === "")
    throw new Error(
      "--copy-host or CID_COPY_HOST is required: the identity gate reads the CID copy",
    );
  return {
    manifest: values.manifest,
    runId: values["run-id"],
    ...(values.step === undefined ? {} : { step: values.step as PublishStepName }),
    dryRun: values["dry-run"],
    probe: values.probe,
    pilot: values.pilot,
    ...(values.cli === undefined ? {} : { cli: values.cli }),
    ...(values["release-tag"] === undefined ? {} : { releaseTag: values["release-tag"] }),
    ...(values["release-reuse-tag"] === undefined
      ? {}
      : { releaseReuseTags: values["release-reuse-tag"] }),
    ...(values["release-target"] === undefined ? {} : { releaseTarget: values["release-target"] }),
    ...(values.repo === undefined ? {} : { repo: values.repo }),
    copyHost,
  };
}

/** The report as plain lines for the terminal. */
export function formatReport(report: PublishReport): string[] {
  const lines = [
    `run ${report.runId}${report.pilot ? " (pilot)" : ""}  manifest ${report.manifestCid}  mode ${report.mode}`,
  ];
  for (const s of report.steps) {
    const skip = s.items.filter((i) => i.action === "skip").length;
    const run = s.items.filter((i) => i.action === "run").length;
    lines.push(
      `[${s.step}] ${s.status}${s.items.length > 0 ? `: ${skip} skip, ${run} to run` : ""}`,
    );
    for (const i of s.items)
      lines.push(`  ${i.action === "skip" ? "skip" : "RUN "} ${i.id}  (${i.reason})`);
    if (s.gate !== undefined) {
      const g = s.gate.summary;
      lines.push(
        `  gate ${s.gate.result}${
          g === undefined
            ? ""
            : ` (v_roofing_permit ${g.v_roofing_permit}, meta.permit ${g.meta_permit}, permits_emitted ${g.permits_emitted ?? "none"}, ${g.unmatched_properties} of ${g.permit_side_properties} permit-side properties are not county properties)`
        }`,
      );
      for (const f of s.gate.failures) lines.push(`    FAIL ${f}`);
    }
    if (s.deferred !== undefined) lines.push(`  gate not run yet: ${s.deferred}`);
    if (s.error !== undefined) lines.push(`  ERROR ${s.error}`);
  }
  if (report.refused === true)
    lines.push(
      "REFUSED: an identity gate failed, so a real run of this manifest would stop here and publish nothing",
    );
  lines.push(
    report.ok ? "ok" : "FAILED: fix the error above and rerun; finished items are skipped",
  );
  return lines;
}
