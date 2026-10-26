// T014: the TravisDiscovery Restate workflow shell (pattern 4, research R11).
//
// - Each probe runs as a journaled `ctx.run` step named by its idempotency key
//   `source:measurement:captured_date`, so a replay never re-probes a finished step.
// - The run record keeps `state: DISCOVERING | WAITING_HUMAN | READY` in workflow state;
//   any blocked or failed probe (403, challenge, timeout, or 429/5xx after 5 attempts,
//   FR-006e) moves it to WAITING_HUMAN with a blocker entry.
// - T036: each waiting source has its own durable promise `resolve:<source_key>:<attempt>`;
//   the run waits on them (no timer loop) until a human resolves one with the shared
//   `resolve` handler (operator command resolve.ts). `captured` re-probes only that source
//   once with the same client identity, then rewrites the catalog and re-runs the
//   validator; `still-blocked` documents the blocker and its records request and the run
//   stays WAITING_HUMAN (FR-006f). Time spent waiting is `waiting_human_hours` (SC-006).
// - T037/T038: blocked rows get their evidence file and, for TCAD and BBB, the records
//   request / API application that is the next human step.
// - READY never auto-advances to seed (kit default overridden; seed is A-04).
// - CR-3 / OR-M1: the catalog write refuses (terminal error, no retry) when the catalog on
//   disk carries offline amendments or approved exceptions, was written by another run, or
//   changed after this snapshot (`catalogWriteRefusal`). The catalog records the run id.
// - CR-4: permanent failures inside a journaled step (catalog schema or write refusal,
//   evidence write, validator hash mismatch or crash) are terminal errors, never retried.
// - OR-B1: `discover` passes the egress country it checked; the run records it in the
//   run record and the catalog (`discovery_egress`).
//
// One SDK instance: this file imports the Restate SDK **type-only**. The host
// (pipeline/local-stack/services/app.ts) passes in its own SDK module, so only the
// local-stack copy is ever loaded at runtime.
import type * as restate from "@restatedev/restate-sdk";
import { z } from "zod";
import {
  EgressSchema,
  SourceKeySchema,
  type Catalog,
  type RecordsRequest,
  type Source,
  type SourceKey,
} from "./catalog.schema.js";
import { catalogWriteRefusal } from "./write-catalog.js";
import { detectChallengeSignal, type CaptureReceipt } from "../lib/source-client.js";
import { renderBlockedEvidence } from "./blocked-evidence.js";
import type { Destination } from "./destination-proof.js";
import {
  assembleUs1,
  BBB_NEXT_STEP,
  type AssembleOptions,
  type Us1Blocks,
  type Us1Results,
} from "./assemble.js";
import { NOT_FILED, savedStop } from "./jurisdiction-explanation.js";
import { catalogSafe } from "./catalog-text.js";
import {
  assemblePermits,
  type AssemblePermitsOptions,
  type JurisdictionBlocks,
} from "./assemble-permits.js";
import type { AustinLocatedEntry } from "./austin-issued.js";
import { probeGisCount } from "./probes/arcgis.js";
import { probeCensusPlaces, type CensusProbe } from "./probes/census.js";
import { brokenAt, brokenDownload, type BrokenDownload, type ProbeDeps } from "./probes/common.js";
import {
  probeEvidencePage,
  type EvidenceProbe,
  probeBbb,
  probeContractorLicensing,
  probeOverture,
  type PriorObservation,
} from "./probes/evidence.js";
import { probeAustinPermits, probeComptroller } from "./probes/socrata.js";
import { probeTcad, type PriorExport } from "./probes/tcad.js";
import {
  TRAVIS_JURISDICTION_PROFILE,
  type JurisdictionProfileEntry,
} from "../profiles/jurisdictions.js";

export const WORKFLOW_NAME = "TravisDiscovery";

export type RunState = "DISCOVERING" | "WAITING_HUMAN" | "READY";

export type ResolutionOutcome = "captured" | "still-blocked";

export interface Blocker {
  source_key: SourceKey;
  step_key: string;
  receipt: CaptureReceipt;
  next_step: string;
  /** The records request (or API application) a human files for this source, if any. */
  records_request?: RecordsRequest;
  /** 1 for the first stop; +1 after each `captured` re-probe that is still blocked. */
  attempt: number;
  /** True while the run waits on this source's durable promise. */
  waiting: boolean;
  /** Durable promise name: `resolve:<source_key>:<attempt>`. */
  promise: string;
  /** `still-blocked` once a human documented the blocker; null while waiting. */
  resolution: "still-blocked" | null;
  resolved_at: string | null;
}

export interface ResolutionRecord {
  source_key: SourceKey;
  outcome: ResolutionOutcome;
  attempt: number | null;
  at: string;
}

export interface StepRecord {
  key: string;
  source_key: SourceKey;
  measurement: string;
  outcome: CaptureReceipt["outcome"];
  status: number | null;
  captured_at: string;
}

export interface RunRecord {
  run_id: string;
  started_at: string;
  state: RunState;
  blockers: Blocker[];
  steps: StepRecord[];
  validator: ValidatorResult | null;
  /** Hours spent in WAITING_HUMAN (wall time while at least one source waited), SC-006. */
  waiting_human_hours: number;
  /** Every human resolution received, in order. */
  resolutions: ResolutionRecord[];
  /** UTC time the run started waiting on a human; null while it is not waiting. */
  waiting_since: string | null;
  /** UTC time the run handler finished (READY, or WAITING_HUMAN with documented blockers). */
  completed_at: string | null;
  /** Always false: READY never starts seed (A-04 does). */
  auto_advance_to_seed: false;
  /** Egress country `discover` checked before it started the run (OR-B1); null if none. */
  egress?: Egress | null;
}

export type Egress = z.infer<typeof EgressSchema>;

/** The run handler's optional input: the egress `discover` checked (OR-B1). */
export const RunInputSchema = z.strictObject({ egress: EgressSchema.optional() });

export interface ValidatorResult {
  exit_code: number;
  report_path: string;
  vendored_sha256: string;
}

export function newRunRecord(runId: string, startedAt: Date): RunRecord {
  return {
    run_id: runId,
    started_at: startedAt.toISOString(),
    state: "DISCOVERING",
    blockers: [],
    steps: [],
    validator: null,
    waiting_human_hours: 0,
    resolutions: [],
    waiting_since: null,
    completed_at: null,
    auto_advance_to_seed: false,
  };
}

export function promiseName(source: SourceKey, attempt: number): string {
  return `resolve:${source}:${attempt}`;
}

function resolveHint(source: SourceKey): string {
  // T066: `captured` is refused for a 403, challenge or WAF block (T056), so the hint says when it applies.
  return `then run: npm --prefix pipeline/oracle-runtime run resolve -- ${source} still-blocked (after a 403, challenge or WAF block) or captured (only after a timeout, network error, throttling or broken download)`;
}

export interface BlockerInput {
  source_key: SourceKey;
  step_key: string;
  receipt: CaptureReceipt;
  next_step: string;
  records_request?: RecordsRequest;
}

export function newBlocker(input: BlockerInput, attempt = 1): Blocker {
  const blocker: Blocker = {
    source_key: input.source_key,
    step_key: input.step_key,
    receipt: input.receipt,
    next_step: input.next_step,
    attempt,
    waiting: true,
    promise: promiseName(input.source_key, attempt),
    resolution: null,
    resolved_at: null,
  };
  if (input.records_request) blocker.records_request = input.records_request;
  return blocker;
}

export interface ProbeStep {
  source_key: SourceKey;
  measurement: string;
  probe: () => Promise<CaptureReceipt>;
}

/** The side-effect surface of the workflow, so the logic is testable without Restate. */
export interface DiscoveryIO {
  /** Deterministic (journaled) current time. */
  now(): Promise<Date>;
  /** Journaled step: runs `fn` once and replays its (JSON-serializable) result afterwards. */
  run<T>(name: string, fn: () => Promise<T>): Promise<T>;
  /** Persists the run record (workflow state). */
  save(record: RunRecord): void;
  /**
   * A permanent-failure error to throw inside `run` (CR-4): the Restate host returns its SDK's
   * TerminalError, so the step is not retried. Defaults to PermanentFailure.
   */
  fail?(message: string): Error;
}

/** A permanent failure (no retry) when no Restate host supplies its TerminalError. */
export class PermanentFailure extends Error {
  override name = "PermanentFailure";
}

function permanent(io: DiscoveryIO, message: string): Error {
  return io.fail ? io.fail(message) : new PermanentFailure(message);
}

function errorText(error: unknown): string {
  return error instanceof Error ? (error.message.split("\n")[0] ?? error.name) : String(error);
}

const KEY_PART = /^[a-z0-9_]+$/;

/** Idempotency key `source:measurement:captured_date` (UTC date). */
export function stepKey(source: SourceKey, measurement: string, capturedAt: Date): string {
  for (const part of [source, measurement]) {
    if (!KEY_PART.test(part)) {
      throw new Error(`workflow: step key part "${part}" must be lower snake_case without ':'`);
    }
  }
  return `${source}:${measurement}:${capturedAt.toISOString().slice(0, 10)}`;
}

const NEXT_STEP_BLOCKED =
  "Human review: confirm the blocker and its records request, or capture the source with the same identity";

export async function runDiscovery(
  io: DiscoveryIO,
  runId: string,
  steps: readonly ProbeStep[],
): Promise<RunRecord> {
  const record = newRunRecord(runId, await io.now());
  io.save(record);

  for (const step of steps) {
    const key = stepKey(step.source_key, step.measurement, await io.now());
    const receipt = await io.run(key, step.probe);
    record.steps.push({
      key,
      source_key: step.source_key,
      measurement: step.measurement,
      outcome: receipt.outcome,
      status: receipt.status,
      captured_at: receipt.captured_at,
    });
    if (receipt.outcome === "blocked" || receipt.outcome === "failed") {
      record.blockers.push(
        newBlocker({
          source_key: step.source_key,
          step_key: key,
          receipt,
          next_step: `${NEXT_STEP_BLOCKED}; ${resolveHint(step.source_key)}`,
        }),
      );
    }
    io.save(record);
  }

  record.state = record.blockers.length > 0 ? "WAITING_HUMAN" : "READY";
  io.save(record);
  return record;
}

/** The subset of the SDK this module needs; the host passes its own SDK module. */
export type RestateSdk = Pick<typeof restate, "workflow" | "RestatePromise" | "TerminalError">;

/** Workflow step timeouts sit above the TCAD probe's own limits (10 min idle, 2 h total). */
export const WORKFLOW_OPTIONS = {
  inactivityTimeout: 15 * 60 * 1000,
  abortTimeout: 150 * 60 * 1000,
} as const;

const RUN_STATE_KEY = "run";

/** What the run reads before it builds its probes, from a journaled step (CR2-5). */
export interface ProbeContext {
  /** The TCAD export already held (the catalog's export receipt), or null. */
  priorExport: PriorExport | null;
}

/** Journaled step that reads the prior export from the catalog (CR2-5). */
export const PRIOR_EXPORT_STEP = "catalog:prior-export";

export interface TravisDiscoveryOptions {
  /** US1 probes (built per run). Without them the workflow records an empty run. */
  probes?: (context: ProbeContext) => Us1Probes;
  /**
   * CR2-5: reads the export already held from the catalog on disk. It runs inside the
   * journaled step PRIOR_EXPORT_STEP, so a replay sees the value the first attempt read; a
   * read or schema error is a terminal error (no endless retry).
   */
  readPriorExport?: () => PriorExport | null;
  /** Writes the assembled catalog (pipeline/docs/travis-sources.yaml in production). */
  writeCatalog?: (catalog: Catalog) => void;
  /** Reads the catalog on disk (null when none) for the overwrite guard (CR-3). */
  readCatalog?: () => Catalog | null;
  /** US2 jurisdiction probes (built per run). Without them no permits block is written. */
  jurisdictions?: () => JurisdictionProbes;
  /** The curated profile (defaults to the Travis profile). */
  profile?: readonly JurisdictionProfileEntry[];
  /** Runs the vendored readiness validator (after a `captured` resolution). */
  runValidator?: () => Promise<ValidatorResult>;
  /** Writes one blocked-evidence file (repository-relative path, docs/evidence/blocked/). */
  writeEvidence?: (relPath: string, content: string) => void;
  /** Extra secrets redacted from evidence files (for example the Socrata app token). */
  secrets?: () => readonly string[];
  /** T044: proves the internal destination (Docker side + SQL side) for the catalog. */
  destinationProof?: () => Promise<Destination>;
}

export function createTravisDiscovery(sdk: RestateSdk, options: TravisDiscoveryOptions = {}) {
  return sdk.workflow({
    name: WORKFLOW_NAME,
    options: WORKFLOW_OPTIONS,
    handlers: {
      run: async (ctx: restate.WorkflowContext, input?: unknown): Promise<RunRecord> => {
        const parsed = RunInputSchema.safeParse(input ?? {});
        if (!parsed.success) throw new sdk.TerminalError("run input must be {egress?}");
        const io: HumanIO = {
          now: async () => new Date(await ctx.date.now()),
          run: (name, fn) => ctx.run(name, fn),
          save: (record) => ctx.set(RUN_STATE_KEY, record),
          fail: (message) => new sdk.TerminalError(message),
          // Durable promises: the invocation suspends until the resolve handler completes one.
          awaitResolution: (names) =>
            sdk.RestatePromise.race(names.map((name) => ctx.promise<Resolution>(name).get())),
        };
        if (!options.probes) return runDiscovery(io, ctx.key, []);
        const readPrior = options.readPriorExport;
        const priorExport = readPrior
          ? await io.run(PRIOR_EXPORT_STEP, async () => {
              try {
                return readPrior();
              } catch (error) {
                throw permanent(
                  io,
                  `reading the prior TCAD export from the catalog failed: ${errorText(error)}`,
                );
              }
            })
          : null;
        const deps: DiscoveryDeps = { probes: options.probes({ priorExport }) };
        if (options.jurisdictions) deps.jurisdictions = options.jurisdictions();
        if (options.profile) deps.profile = options.profile;
        if (options.writeCatalog) deps.writeCatalog = options.writeCatalog;
        if (options.readCatalog) deps.readCatalog = options.readCatalog;
        if (parsed.data.egress) deps.egress = parsed.data.egress;
        if (options.runValidator) deps.runValidator = options.runValidator;
        if (options.writeEvidence) deps.writeEvidence = options.writeEvidence;
        if (options.secrets) deps.secrets = options.secrets();
        if (options.destinationProof) deps.destinationProof = options.destinationProof;
        return runTravisDiscovery(io, ctx.key, deps);
      },
      status: async (ctx: restate.WorkflowSharedContext): Promise<RunRecord | null> =>
        (await ctx.get<RunRecord>(RUN_STATE_KEY)) ?? null,
      /** FR-006f: completes the waiting source's durable promise; refuses any other source. */
      resolve: async (
        ctx: restate.WorkflowSharedContext,
        request: unknown,
      ): Promise<ResolvePlan> => {
        const record = (await ctx.get<RunRecord>(RUN_STATE_KEY)) ?? null;
        const plan = planResolution(record, request);
        if (!plan.accepted) return plan;
        const resolution: Resolution = ResolveRequestSchema.parse(request);
        await ctx.promise<Resolution>(plan.promise).resolve(resolution);
        return plan;
      },
    },
  });
}

// ---------- T025: the US1 probe steps ----------

/** One function per US1 probe step; each returns a JSON-serializable probe result. */
export interface Us1Probes {
  austin: () => Promise<Us1Results["austin"]>;
  comptroller: () => Promise<Us1Results["comptroller"]>;
  tcad: () => Promise<Us1Results["tcad"]>;
  gis: () => Promise<Us1Results["gis"]>;
  bbb: () => Promise<Us1Results["bbb"]>;
  overture: () => Promise<Us1Results["overture"]>;
  licensing: () => Promise<Us1Results["licensing"]>;
}

export interface Us1Deps extends ProbeDeps {
  /** Override of pipeline/data/raw/tcad/ (tests only). */
  rawDir?: string;
  tcadLandingUrl?: string;
  tcadLimits?: { inactivityMs: number; totalMs: number };
  /** JSON record path of the TCAD export once confirmed from the Export Layouts. */
  tcadRecordPath?: string;
  gisTimeoutMs?: number;
  /** The recorded BBB challenge observation to reuse instead of a new request. */
  bbbPrior?: PriorObservation;
  /** The export already held (its receipt and file): reused with no request (OR-m8). */
  priorExport?: PriorExport;
}

export function createUs1Probes(deps: Us1Deps): Us1Probes {
  const base: ProbeDeps = { client: deps.client, now: deps.now };
  return {
    austin: () => probeAustinPermits(base),
    comptroller: () => probeComptroller(base),
    tcad: () =>
      probeTcad({
        ...base,
        ...(deps.rawDir === undefined ? {} : { rawDir: deps.rawDir }),
        ...(deps.tcadLandingUrl === undefined ? {} : { landingUrl: deps.tcadLandingUrl }),
        ...(deps.tcadLimits === undefined ? {} : { limits: deps.tcadLimits }),
        ...(deps.tcadRecordPath === undefined ? {} : { recordPath: deps.tcadRecordPath }),
        ...(deps.priorExport === undefined ? {} : { priorExport: deps.priorExport }),
      }),
    gis: () =>
      probeGisCount(base, deps.gisTimeoutMs === undefined ? {} : { timeoutMs: deps.gisTimeoutMs }),
    bbb: () => probeBbb(base, deps.bbbPrior),
    overture: () => probeOverture(base),
    licensing: () => probeContractorLicensing(base),
  };
}

/** Step order, the source each step measures and its measurement name (idempotency key). */
const US1_STEPS: ReadonlyArray<readonly [keyof Us1Probes, SourceKey, string]> = [
  ["austin", "austin_permits", "measurements"],
  ["comptroller", "tx_comptroller", "measurements"],
  ["tcad", "tcad_certified", "export"],
  ["gis", "tcad_gis", "feature_count"],
  ["bbb", "bbb", "observation"],
  ["overture", "overture", "licence"],
  ["licensing", "contractor_licensing", "evidence"],
];

/** Which step's stop receipt explains a blocked source row. */
const STEP_FOR_SOURCE: Partial<Record<SourceKey, keyof Us1Probes>> = {
  austin_permits: "austin",
  tx_comptroller: "comptroller",
  tcad_certified: "tcad",
  tcad_supplemental: "tcad",
  tcad_gis: "gis",
  bbb: "bbb",
  overture: "overture",
  contractor_licensing: "licensing",
};

export interface SourceDiscoveryResult {
  record: RunRecord;
  results: Us1Results;
  blocks: Us1Blocks;
  /** Idempotency key of each US1 step (a re-probe journals under `<key>:reprobe:<n>`). */
  stepKeys: Record<keyof Us1Probes, string>;
}

export async function runSourceDiscovery(
  io: DiscoveryIO,
  runId: string,
  probes: Us1Probes,
  options: Partial<AssembleOptions> = {},
): Promise<SourceDiscoveryResult> {
  const record = newRunRecord(runId, await io.now());
  io.save(record);

  const results: Partial<Us1Results> = {};
  const stepKeys: Partial<Record<keyof Us1Probes, string>> = {};
  for (const [name, sourceKey, measurement] of US1_STEPS) {
    const key = stepKey(sourceKey, measurement, await io.now());
    stepKeys[name] = key;
    const result = await io.run(key, probes[name] as () => Promise<Us1Results[typeof name]>);
    (results as Record<string, unknown>)[name] = result;
    const last = result.blocked_receipt ?? result.receipts.at(-1) ?? null;
    record.steps.push({
      key,
      source_key: sourceKey,
      measurement,
      outcome: last?.outcome ?? "ok",
      status: last?.status ?? null,
      captured_at: last?.captured_at ?? (await io.now()).toISOString(),
    });
    io.save(record);
  }

  const complete = results as Us1Results;
  const blocks = assembleUs1(complete, {
    assembledAt: options.assembledAt ?? (await io.now()).toISOString(),
    ...(options.evidencePath === undefined ? {} : { evidencePath: options.evidencePath }),
  });

  const keys = stepKeys as Record<keyof Us1Probes, string>;
  record.blockers = sourceBlockers(blocks.sources, complete, keys).map((b) => newBlocker(b));
  record.state = record.blockers.length > 0 ? "WAITING_HUMAN" : "READY";
  io.save(record);
  return { record, results: complete, blocks, stepKeys: keys };
}

/** One blocker per blocked source row whose stop receipt is known (FR-006, FR-006e). */
function sourceBlockers(
  sources: readonly Source[],
  results: Us1Results,
  stepKeys: Record<keyof Us1Probes, string>,
): BlockerInput[] {
  const out: BlockerInput[] = [];
  for (const source of sources) {
    if (source.status !== "blocked") continue;
    const step = STEP_FOR_SOURCE[source.key];
    const receipt = step ? results[step].blocked_receipt : null;
    if (!step || !receipt) continue;
    const input: BlockerInput = {
      source_key: source.key,
      step_key: stepKeys[step],
      receipt,
      next_step: `${source.next_step ?? NEXT_STEP_BLOCKED}; ${resolveHint(source.key)}`,
    };
    if (source.records_request) input.records_request = source.records_request;
    out.push(input);
  }
  return out;
}

/** The catalog with the US1 blocks (permits, destination and census come in US2-US4). */
export function buildUs1Catalog(
  blocks: Us1Blocks,
  snapshotTime: string,
  waitingHumanHours: number,
  runId?: string,
): Catalog {
  return {
    county: "Travis",
    state: "TX",
    slug: "travis",
    fips: "48453",
    snapshot_time: snapshotTime,
    ...(runId === undefined ? {} : { discovery_run_id: runId }),
    waiting_human_hours: waitingHumanHours,
    parcel: blocks.parcel,
    enrichment: blocks.enrichment,
    sources: blocks.sources,
  };
}

// ---------- T032: the US2 jurisdiction steps ----------

/** The Census probe and one evidence probe per profile entry; results are JSON-serializable. */
export interface JurisdictionProbes {
  census: () => Promise<CensusProbe>;
  evidence: (entry: JurisdictionProfileEntry) => Promise<EvidenceProbe>;
}

export interface JurisdictionProbeOptions {
  /** Override of the Census place-by-county file URL (tests only). */
  censusUrl?: string;
}

export function createJurisdictionProbes(
  deps: ProbeDeps,
  options: JurisdictionProbeOptions = {},
): JurisdictionProbes {
  return {
    census: () =>
      probeCensusPlaces(deps, options.censusUrl === undefined ? {} : { url: options.censusUrl }),
    evidence: (entry) => probeEvidencePage(deps, entry.evidence_url),
  };
}

const NEXT_STEP_CENSUS =
  "Human review: the Census place list could not be read, so the expected jurisdiction count is unknown; capture the Census file";

function stepFrom(
  key: string,
  measurement: string,
  probe: { blocked_receipt: CaptureReceipt | null; receipts: CaptureReceipt[] },
  fallbackAt: string,
): StepRecord {
  const last = probe.blocked_receipt ?? probe.receipts.at(-1) ?? null;
  return {
    key,
    source_key: "other_jurisdictions",
    measurement,
    outcome: last?.outcome ?? "ok",
    status: last?.status ?? null,
    captured_at: last?.captured_at ?? fallbackAt,
  };
}

/**
 * Runs the Census step, then one journaled evidence step per profile entry, and assembles the
 * `permits` block and `census_reference`. Appends step records to `record`; a Census file
 * that cannot be read is a blocker (the expected set is unknown). A blocked evidence page is
 * recorded on its row (status `blocked` with its records request), not as a run blocker.
 */
export async function runJurisdictionDiscovery(
  io: DiscoveryIO,
  record: RunRecord,
  probes: JurisdictionProbes,
  profile: readonly JurisdictionProfileEntry[],
  austinLocated: readonly AustinLocatedEntry[],
  options: AssemblePermitsOptions = {},
): Promise<JurisdictionBlocks> {
  const captured = await captureJurisdictions(io, record, probes, profile);
  return assemblePermits(captured.census, profile, captured.evidence, austinLocated, options);
}

export interface JurisdictionCapture {
  census: CensusProbe;
  censusKey: string;
  evidence: Record<string, EvidenceProbe>;
}

/** The journaled jurisdiction probes (Census, then one evidence page per profile entry). */
export async function captureJurisdictions(
  io: DiscoveryIO,
  record: RunRecord,
  probes: JurisdictionProbes,
  profile: readonly JurisdictionProfileEntry[],
): Promise<JurisdictionCapture> {
  const censusKey = stepKey("other_jurisdictions", "census_places", await io.now());
  const census = await io.run(censusKey, probes.census);
  record.steps.push(stepFrom(censusKey, "census_places", census, census.captured_at));
  const censusReceipt = census.blocked_receipt ?? census.receipts.at(-1) ?? null;
  if (census.census_reference === null && censusReceipt) {
    record.blockers.push(
      newBlocker({
        source_key: "other_jurisdictions",
        step_key: censusKey,
        receipt: censusReceipt,
        next_step: `${NEXT_STEP_CENSUS}; ${resolveHint("other_jurisdictions")}`,
      }),
    );
  }
  io.save(record);

  const evidence: Record<string, EvidenceProbe> = {};
  for (const entry of profile) {
    const measurement = `evidence_${entry.key}`;
    const key = stepKey("other_jurisdictions", measurement, await io.now());
    const captured = await io.run(key, () => probes.evidence(entry));
    evidence[entry.key] = captured;
    record.steps.push(stepFrom(key, measurement, captured, captured.captured_at));
    io.save(record);
  }

  return { census, censusKey, evidence };
}

/** Adds the US2 blocks (permits, census_reference) to a catalog. */
export function withJurisdictions(
  catalog: Omit<Catalog, "permits" | "census_reference">,
  blocks: JurisdictionBlocks,
): Catalog {
  const out: Catalog = { ...catalog, permits: blocks.permits };
  if (blocks.census_reference) out.census_reference = blocks.census_reference;
  return out;
}

// ---------- T038: records requests for blocked sources ----------

/**
 * TCAD records request (FR-001d, FR-006c). Channel verified 2026-10-19 without contacting
 * traviscad.org: the TCAD Open Records Center on GovQA names "Travis Central Appraisal
 * District" and the Public Information Act and offers "Submit a Records Request". No
 * request email was verified, so none is recorded. The recipient is the statutory officer
 * for public information (the chief administrative officer, Tex. Gov't Code 552.201); the
 * named person is not verified.
 */
export const TCAD_RECORDS_REQUEST: RecordsRequest = {
  recipient_office:
    "Travis Central Appraisal District, officer for public information (chief appraiser, Tex. Gov't Code 552.201)",
  system_scope:
    "Texas Public Information Act (Tex. Gov't Code ch. 552) request for the TCAD 2026 Certified Special Export (JSON) with its Export Layouts, and every 2026 supplemental appraisal roll export issued to date (roll year 2026)",
  route: "records-first",
  request_portal_url: "https://traviscad.govqa.us/WEBAPP/_rs/SupportHome.aspx",
};

const TCAD_RECORDS_NOTE =
  "records request channel checked 2026-10-19 from a non-traviscad.org host: the TCAD Open Records Center (GovQA) names Travis Central Appraisal District and the Public Information Act; no request email was verified, so none is recorded; the recipient is the statutory officer for public information, the named person is not verified";

export const TCAD_NEXT_STEP = `The Public Information Act records request through the TCAD Open Records Center is the recorded lawful route and is ${NOT_FILED}; TCAD stays blocked and seed, pilot and ingest stay stopped (FR-006c, FR-006d)`;

/**
 * BBB records request: the official BBB API application (recorded only, never filed: PO
 * decision 2026-10-20; the next step text is BBB_NEXT_STEP in assemble.ts).
 * developer.bbb.org is the BBB API site whose terms require the BBB API Registration Form;
 * it was found by web search, bbb.org was not contacted.
 */
export const BBB_API_APPLICATION: RecordsRequest = {
  recipient_office: "IABBB (International Association of Better Business Bureaus), BBB API program",
  system_scope:
    "BBB business profiles (accreditation, rating, complaints) for Travis County contractors through the official BBB API, requested with the BBB API Registration Form",
  route: "api-first",
  request_portal_url: "https://developer.bbb.org/",
};

/**
 * Next step for a reachable source whose 2xx download broke part-way. It is not a block:
 * the outcome stays `failed` and nothing retries automatically (FR-006, NFR-001); the
 * operator may allow one more attempt with the same identity (`resolve -- <key> captured`).
 */
export function brokenDownloadStep(key: SourceKey, broken: BrokenDownload): string {
  return `The source is reachable: it answered HTTP ${broken.status} and the download broke at ${brokenAt(broken)} (${broken.error}); this is not a block. Recommended: one more attempt with the same identity: npm --prefix pipeline/oracle-runtime run resolve -- ${key} captured (no automatic retry, FR-006, NFR-001)`;
}

/** The PIA request kept as a documented fallback note on a broken (not blocked) TCAD row. */
function tcadFallbackNote(): string {
  const req = TCAD_RECORDS_REQUEST;
  return `${TCAD_RECORDS_NOTE}; fallback only if the download keeps breaking or TCAD starts refusing it: the Public Information Act request to ${req.recipient_office} through ${req.request_portal_url ?? req.request_email ?? "no channel"} (${req.route}), ${NOT_FILED}`;
}

/**
 * Adds the next step (and, for a real block, the records request and note) to the blocked
 * TCAD and BBB rows. `stops` holds the receipt that stopped each source, so a broken
 * download on a reachable source gets "one more captured attempt" instead of a records
 * request; a records request is the next step only for a real block (403, challenge,
 * timeout with no response).
 */
export function withRecordsRequests(
  sources: readonly Source[],
  stops: Partial<Record<SourceKey, CaptureReceipt | null>> = {},
): Source[] {
  return sources.map((source) => {
    if (source.status !== "blocked") return source;
    if (source.key === "tcad_certified" || source.key === "tcad_supplemental") {
      const stop = stops[source.key];
      const broken = stop ? brokenDownload(stop) : null;
      if (broken) {
        const { records_request: _none, ...rest } = source;
        return {
          ...rest,
          next_step: brokenDownloadStep(source.key, broken),
          notes: tcadFallbackNote(),
        };
      }
      return {
        ...source,
        records_request: TCAD_RECORDS_REQUEST,
        next_step: TCAD_NEXT_STEP,
        notes: TCAD_RECORDS_NOTE,
      };
    }
    if (source.key === "bbb") {
      return { ...source, records_request: BBB_API_APPLICATION, next_step: BBB_NEXT_STEP };
    }
    return source;
  });
}

// ---------- T036: WAITING_HUMAN, the durable promise and its resolution ----------

export interface Resolution {
  source_key: SourceKey;
  outcome: ResolutionOutcome;
}

export const ResolveRequestSchema = z.strictObject({
  source_key: SourceKeySchema,
  outcome: z.enum(["captured", "still-blocked"]),
});

/** The workflow side effects plus the durable promise a human completes. */
export interface HumanIO extends DiscoveryIO {
  /** Waits until one of the named durable promises is completed; returns its resolution. */
  awaitResolution(promiseNames: readonly string[]): Promise<Resolution>;
}

export interface DiscoveryDeps {
  probes: Us1Probes;
  jurisdictions?: JurisdictionProbes;
  profile?: readonly JurisdictionProfileEntry[];
  writeCatalog?: (catalog: Catalog) => void;
  readCatalog?: () => Catalog | null;
  runValidator?: () => Promise<ValidatorResult>;
  writeEvidence?: (relPath: string, content: string) => void;
  secrets?: readonly string[];
  destinationProof?: () => Promise<Destination>;
  /** Egress country checked by `discover` before the run started (OR-B1). */
  egress?: Egress;
}

export type ResolvePlan = { accepted: true; promise: string } | { accepted: false; reason: string };

/** The receipt fields that tell a block (403, challenge, WAF) from a failure (T056). */
export interface StopReceipt {
  status: CaptureReceipt["status"];
  blocked_reason?: CaptureReceipt["blocked_reason"] | undefined;
  challenge_signal?: string | undefined;
  stop_evidence?: { headers: Record<string, string>; excerpt_base64: string } | undefined;
}

/**
 * T056 / AC-6: true when the receipt stopped on HTTP 403, a bot challenge or a WAF block.
 * Such a source is never re-probed (`captured`); a human may only document it
 * (`still-blocked`). Timeouts, network errors, 429/5xx after 5 attempts and broken downloads
 * are failures, not blocks, and may still be `captured` (FR-006f). The saved stop response
 * is re-read with the source client's own detectors (challenge, `cf-mitigated`, WAF).
 */
export function stoppedOnBlock(receipt: StopReceipt): boolean {
  if (receipt.status === 403) return true;
  if (receipt.blocked_reason === "http-403" || receipt.blocked_reason === "challenge") return true;
  if (receipt.challenge_signal !== undefined && receipt.challenge_signal !== "") return true;
  const saved = savedStop(receipt);
  return saved !== null && detectChallengeSignal(saved) !== null;
}

/** The refusal reason for `captured` on a blocked source (T056, AC-6). */
export function blockedReprobeReason(key: SourceKey): string {
  return `${key} stopped on HTTP 403 / challenge; a blocked source is never re-probed (AC-6); only still-blocked is allowed`;
}

/** Decides whether a resolve request names a source that is waiting (FR-006f). */
export function planResolution(record: RunRecord | null, request: unknown): ResolvePlan {
  const parsed = ResolveRequestSchema.safeParse(request);
  if (!parsed.success) {
    return { accepted: false, reason: "expected <source_key> captured|still-blocked" };
  }
  if (record === null) {
    return { accepted: false, reason: "no discovery run is recorded under this run id" };
  }
  const key = parsed.data.source_key;
  const waiting = record.blockers.find((b) => b.source_key === key && b.waiting);
  if (waiting) {
    if (parsed.data.outcome === "captured" && stoppedOnBlock(waiting.receipt)) {
      return { accepted: false, reason: blockedReprobeReason(key) };
    }
    return { accepted: true, promise: waiting.promise };
  }
  const documented = record.blockers.some(
    (b) => b.source_key === key && b.resolution === "still-blocked",
  );
  return {
    accepted: false,
    reason: documented
      ? `${key} was already resolved still-blocked (documented blocker)`
      : `${key} is not waiting for a human (run state ${record.state})`,
  };
}

const HOUR_MS = 3_600_000;

interface Session {
  record: RunRecord;
  results: Us1Results;
  stepKeys: Record<keyof Us1Probes, string>;
  probes: Us1Probes;
  jurisdictions: (JurisdictionCapture & { probes: JurisdictionProbes }) | null;
  profile: readonly JurisdictionProfileEntry[];
  destination: Destination | null;
}

/**
 * Assembles the full catalog from the journaled probe results (pure, deterministic). Runtime
 * text (challenge titles, error messages) is mapped into the writer's safe character set
 * here, the single point where journaled probe output enters the catalog (catalog-text.ts).
 */
function assembleSession(session: Session, snapshot: string): Catalog {
  return catalogSafe(assembleCatalog(session, snapshot));
}

function assembleCatalog(session: Session, snapshot: string): Catalog {
  const blocks = assembleUs1(session.results, { assembledAt: snapshot });
  const tcadStop = session.results.tcad.blocked_receipt;
  blocks.sources = withRecordsRequests(blocks.sources, {
    tcad_certified: tcadStop,
    tcad_supplemental: tcadStop,
  });
  const us1 = buildUs1Catalog(
    blocks,
    snapshot,
    session.record.waiting_human_hours,
    session.record.run_id,
  );
  if (session.record.egress) us1.discovery_egress = session.record.egress;
  if (session.destination) us1.destination = session.destination;
  const j = session.jurisdictions;
  if (!j) return us1;
  return withJurisdictions(
    us1,
    assemblePermits(
      j.census,
      session.profile,
      j.evidence,
      session.results.austin.located_in_other_jurisdictions,
    ),
  );
}

/** Every blocker the catalog implies: blocked source rows plus an unreadable Census file. */
function sessionBlockers(session: Session, catalog: Catalog): BlockerInput[] {
  const out = sourceBlockers(catalog.sources, session.results, session.stepKeys);
  const j = session.jurisdictions;
  const censusReceipt = j ? (j.census.blocked_receipt ?? j.census.receipts.at(-1) ?? null) : null;
  if (j && j.census.census_reference === null && censusReceipt) {
    out.push({
      source_key: "other_jurisdictions",
      step_key: j.censusKey,
      receipt: censusReceipt,
      next_step: `${NEXT_STEP_CENSUS}; ${resolveHint("other_jurisdictions")}`,
    });
  }
  return out;
}

/** The stop receipt behind each blocked row, keyed by the row's evidence path. */
function evidenceJobs(
  session: Session,
  catalog: Catalog,
): Array<{ path: string; kind: "source" | "jurisdiction"; key: string; receipt: CaptureReceipt }> {
  const jobs = new Map<
    string,
    { path: string; kind: "source" | "jurisdiction"; key: string; receipt: CaptureReceipt }
  >();
  for (const source of catalog.sources) {
    const path = source.blocked_evidence?.evidence_path;
    const step = STEP_FOR_SOURCE[source.key];
    const receipt = step ? session.results[step].blocked_receipt : null;
    if (path && receipt?.stop_evidence) {
      jobs.set(path, { path, kind: "source", key: source.key, receipt });
    }
  }
  for (const row of catalog.permits?.jurisdictions ?? []) {
    const path = row.blocked_evidence?.evidence_path;
    const receipt = session.jurisdictions?.evidence[row.key]?.blocked_receipt ?? null;
    if (path && receipt?.stop_evidence) {
      jobs.set(path, { path, kind: "jurisdiction", key: row.key, receipt });
    }
  }
  return [...jobs.values()];
}

/** Assembles the catalog, writes evidence files and the catalog as journaled steps. */
async function publishCatalog(
  io: HumanIO,
  session: Session,
  deps: DiscoveryDeps,
  round: number,
): Promise<Catalog> {
  const snapshot = (await io.now()).toISOString();
  const catalog = assembleSession(session, snapshot);
  const suffix = round === 0 ? "" : `:r${round}`;
  const write = deps.writeEvidence;
  const jobs = evidenceJobs(session, catalog);
  if (write && jobs.length > 0) {
    await io.run(`evidence:write:${snapshot.slice(0, 10)}${suffix}`, async () => {
      try {
        for (const job of jobs) {
          write(
            job.path,
            renderBlockedEvidence({
              path: job.path,
              subject: { kind: job.kind, key: job.key },
              receipt: job.receipt,
              secrets: deps.secrets ?? [],
              identity: "unchanged",
              ...(session.record.egress ? { egressCountry: session.record.egress.country } : {}),
            }),
          );
        }
      } catch (error) {
        throw permanent(io, `evidence write failed: ${errorText(error)}`);
      }
      return jobs.length;
    });
  }
  const writeCatalog = deps.writeCatalog;
  if (writeCatalog) {
    const readOnDisk = deps.readCatalog;
    await io.run(`catalog:write:${snapshot.slice(0, 10)}${suffix}`, async () => {
      let refusal: string | null;
      try {
        refusal = readOnDisk ? catalogWriteRefusal(readOnDisk(), catalog) : null;
      } catch (error) {
        refusal = `catalog write refused: the catalog on disk is unreadable (${errorText(error)})`;
      }
      if (refusal !== null) throw permanent(io, refusal);
      try {
        writeCatalog(catalog);
      } catch (error) {
        throw permanent(io, `catalog write failed (schema or emit): ${errorText(error)}`);
      }
      return true;
    });
  }
  return catalog;
}

/** Runs the validator as a journaled step; any failure of the runner is permanent (CR-4). */
function validatorStep(
  io: HumanIO,
  name: string,
  validate: () => Promise<ValidatorResult>,
): Promise<ValidatorResult> {
  return io.run(name, async () => {
    try {
      return await validate();
    } catch (error) {
      throw permanent(io, `validator step failed: ${errorText(error)}`);
    }
  });
}

/** Sources whose row is produced by the same probe step as `source`. */
function sourcesOfStep(source: SourceKey): Set<SourceKey> {
  if (source === "other_jurisdictions") return new Set(["other_jurisdictions"]);
  const step = STEP_FOR_SOURCE[source];
  const out = new Set<SourceKey>();
  for (const [key, s] of Object.entries(STEP_FOR_SOURCE)) {
    if (s === step) out.add(key as SourceKey);
  }
  return out;
}

/** `captured`: probes the blocker's step exactly once more with the same client. */
async function reprobe(io: HumanIO, session: Session, blocker: Blocker): Promise<void> {
  const name = `${blocker.step_key}:reprobe:${blocker.attempt}`;
  const j = session.jurisdictions;
  if (blocker.source_key === "other_jurisdictions" && j) {
    const census = await io.run(name, j.probes.census);
    j.census = census;
    session.record.steps.push(stepFrom(name, "census_places", census, census.captured_at));
    return;
  }
  const entry =
    US1_STEPS.find(([, key]) => key === blocker.source_key) ??
    US1_STEPS.find(([step]) => step === STEP_FOR_SOURCE[blocker.source_key]);
  if (!entry) throw new Error(`workflow: no probe step for ${blocker.source_key}`);
  const [step, sourceKey, measurement] = entry;
  const result = await io.run(name, session.probes[step] as () => Promise<Us1Results[typeof step]>);
  (session.results as unknown as Record<string, unknown>)[step] = result;
  const last = result.blocked_receipt ?? result.receipts.at(-1) ?? null;
  session.record.steps.push({
    key: name,
    source_key: sourceKey,
    measurement,
    outcome: last?.outcome ?? "ok",
    status: last?.status ?? null,
    captured_at: last?.captured_at ?? (await io.now()).toISOString(),
  });
}

/** Replaces the blockers of the re-probed sources; a documented blocker stays documented. */
function mergeBlockers(
  record: RunRecord,
  affected: ReadonlySet<SourceKey>,
  fresh: readonly BlockerInput[],
): void {
  const previous = new Map(
    record.blockers.filter((b) => affected.has(b.source_key)).map((b) => [b.source_key, b]),
  );
  const kept = record.blockers.filter((b) => !affected.has(b.source_key));
  const replaced = fresh
    .filter((b) => affected.has(b.source_key))
    .map((input) => {
      const old = previous.get(input.source_key);
      if (old?.resolution === "still-blocked") return old;
      return newBlocker(input, (old?.attempt ?? 0) + 1);
    });
  record.blockers = [...kept, ...replaced];
}

function stillBlockedStep(blocker: Blocker, at: string): string {
  const req = blocker.records_request;
  const request = req
    ? `records request to ${req.recipient_office} (${req.request_portal_url ?? req.request_email ?? "no channel"}, ${req.route}) stands`
    : "no records request applies to this source";
  return `still blocked after human review at ${at}: documented blocker; ${request}; seed, pilot and ingest for this source stay stopped (FR-006c, FR-006d)`;
}

/**
 * The whole discovery run: US1 and US2 probes, catalog and evidence, then WAITING_HUMAN
 * until every waiting source is resolved (FR-006 to FR-006f). Ends READY when nothing is
 * blocked, or WAITING_HUMAN with documented blockers. Never starts seed.
 */
export async function runTravisDiscovery(
  io: HumanIO,
  runId: string,
  deps: DiscoveryDeps,
): Promise<RunRecord> {
  const us1 = await runSourceDiscovery(io, runId, deps.probes);
  const record = us1.record;
  record.egress = deps.egress ?? null;
  record.state = "DISCOVERING";
  io.save(record);
  const profile = deps.profile ?? TRAVIS_JURISDICTION_PROFILE;
  const session: Session = {
    record,
    results: us1.results,
    stepKeys: us1.stepKeys,
    probes: deps.probes,
    jurisdictions: deps.jurisdictions
      ? {
          ...(await captureJurisdictions(io, record, deps.jurisdictions, profile)),
          probes: deps.jurisdictions,
        }
      : null,
    profile,
    destination: null,
  };
  const prove = deps.destinationProof;
  if (prove) {
    const key = `destination:proof:${(await io.now()).toISOString().slice(0, 10)}`;
    session.destination = await io.run(key, prove);
  }

  const first = await publishCatalog(io, session, deps, 0);
  record.blockers = sessionBlockers(session, first).map((b) => newBlocker(b));
  const validateFirst = deps.runValidator;
  if (validateFirst) record.validator = await validatorStep(io, "validator:run:r0", validateFirst);
  io.save(record);

  let round = 0;
  for (;;) {
    const waiting = record.blockers.filter((b) => b.waiting);
    if (waiting.length === 0) break;
    record.state = "WAITING_HUMAN";
    const since = await io.now();
    record.waiting_since = since.toISOString();
    io.save(record);
    const resolution = await io.awaitResolution(waiting.map((b) => b.promise));
    const at = await io.now();
    record.waiting_since = null;
    record.waiting_human_hours =
      Math.round((record.waiting_human_hours + (at.getTime() - since.getTime()) / HOUR_MS) * 1e6) /
      1e6;
    round += 1;
    const targets = waiting.filter((b) => b.source_key === resolution.source_key);
    record.resolutions.push({
      source_key: resolution.source_key,
      outcome: resolution.outcome,
      attempt: targets[0]?.attempt ?? null,
      at: at.toISOString(),
    });
    const target = targets[0];
    if (!target) {
      io.save(record);
      continue;
    }

    if (resolution.outcome === "still-blocked") {
      for (const b of targets) {
        b.waiting = false;
        b.resolution = "still-blocked";
        b.resolved_at = at.toISOString();
        b.next_step = stillBlockedStep(b, at.toISOString());
      }
      io.save(record);
      await publishCatalog(io, session, deps, round);
      continue;
    }

    record.state = "DISCOVERING";
    io.save(record);
    await reprobe(io, session, target);
    const catalog = await publishCatalog(io, session, deps, round);
    mergeBlockers(record, sourcesOfStep(target.source_key), sessionBlockers(session, catalog));
    const validate = deps.runValidator;
    if (validate) record.validator = await validatorStep(io, `validator:run:r${round}`, validate);
    io.save(record);
  }

  record.state = record.blockers.length > 0 ? "WAITING_HUMAN" : "READY";
  record.completed_at = (await io.now()).toISOString();
  io.save(record);
  return record;
}
