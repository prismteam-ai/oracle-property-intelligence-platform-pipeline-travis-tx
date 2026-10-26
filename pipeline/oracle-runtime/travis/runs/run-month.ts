// T036: one month of Austin permits (September 2026 for A-03) through the Socrata adapter
// module (PO decision D-5), the frozen profile, the local TCAD certified export and the two
// transforms, into pipeline/data/runs/<runId>/groups/{county,property_improvement} plus
// summary.json. Stages, taken from run-pilot.ts for the September slice only (no D-3 extra
// slices, no CLI sequence and no manifest: those are `pipeline/publish` cli.ts build/upload):
//   1 lexicon manifest (data-group schema CIDs, live)
//   2 Austin capture: travis/adapters/socrata (list → one GET per permit → raw + receipt +
//     status/<key>.json; ≤ 1 request/s; a 403 or challenge stops the run with exit 2; a timeout
//     also stops it, labelled `error` with exit 1, per contracts/cli.md). This run's own
//     receipts (one per captured permit it uses) go to capture/austin-receipts.jsonl, the
//     manifest's record count: the job's receipts.jsonl is shared across runs of the job.
//   3 classification by profiles/travis-austin@1.0.0 only (no classification term here):
//     accepted = the profile would emit it; everything else is excluded or needs review
//   4 TCAD subset from the local certified zip, after its sha256 is checked against
//     `export_sha256` in pipeline/docs/travis-sources.yaml; only the accepted permits'
//     tcad_ids are looked up, so an excluded trade sub-permit pulls no parcel in, and an
//     accepted permit with no tcad_id is counted (`permits_no_tcad_geoid`), never published
//   5 seed (county-seed-data contract) · 6 classification ledger + status artifacts
//   7 roof-age ledger (vendored kit estimator) · 8 transforms (the County transform applies
//     the confidentiality flags, so they precede any `validate`) · 9 summary.json, whose
//     `owners_redacted` is the number of TCAD confidentiality redactions applied in stage 8
//     (P0-15); pipeline/publish repeats it in the TCAD source's limitation note (T083)
// finishedAt is the end of the capture phase: the data's as-of instant and the roof-age as_of.
// Contractors: no official licensing baseline is loaded yet (Comptroller ingest is A-07), so
// every emitted permit's contractor state is `contractor_unresolved`; nothing is copied from
// the permit's printed contractor name (constitution A5).
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { GAZETTEER_SHA256 } from "../../../../packages/query-core/src/sql.generated.js";
import * as travisAustin from "../../../../profiles/travis-austin@1.0.0/index.js";
import { AUSTIN_3SYK_W9EU, captureAustinMonth } from "../adapters/socrata/austin-3syk-w9eu.js";
import {
  datasetUrl,
  exitCodeFor,
  loadCaptures,
  updateStatus,
  type AdapterOutcome,
  type SocrataCaptureResult,
} from "../adapters/socrata/socrata.js";
import { createLogger, type LogFields } from "../lib/log.js";
import type { FetchLike } from "../lib/source-client.js";
import { buildSeedRow, writeSeed } from "../pilot/build-seed.js";
import {
  TCAD_SOURCE,
  readSubset,
  scanTcadSubset,
  writeSubset,
  type TcadSubsetReceipt,
} from "../pilot/capture-tcad-subset.js";
import {
  estimateTravisRoofAge,
  TRAVIS_ROOF_AGE_PROFILE_VERSION,
  type RoofAgeLedgerRow,
} from "../roof-age/travis-roof-age-profile.js";
import {
  classifyCapture,
  transformAustinPropertyImprovement,
  type AustinPermitCapture,
  type AustinRow,
  type ClassificationLedgerRow,
  type ContractorIdentityInput,
  type ProfileApi,
} from "../transforms/austin-property-improvement.js";
import type { RegistryRecord, ResolverState } from "../identity/resolver.js";
import type { CrosswalkIndex } from "../identity/crosswalk.js";
import { fetchDataGroupCids, type DataGroupCids } from "../transforms/lexicon-manifest.js";
import {
  TCAD_EXPORT_REQUEST,
  parseTcadRecord,
  propertyFields,
  type SeedRow,
} from "../transforms/shared-seed.js";
import { transformTcadCounty, type CountyTransformCounts } from "../transforms/tcad-county.js";

export { exitCodeFor };

export const COUNTY = { slug: "travis", state: "TX", fips: "48453" } as const;
export const PROFILE_PATH = "profiles/travis-austin@1.0.0";
export const ROOF_PROFILE_PATH =
  "pipeline/oracle-runtime/travis/roof-age/travis-roof-age-profile.ts";
/** The travis-places gazetteer every manifest must name (bindManifest refuses a run without it;
 *  CR-A-03 F-1). Its digest is the query-core generated constant, which equals the DIGEST file. */
export const GAZETTEER_PATH = "packages/query-core/gazetteer/travis-places@1.0.0";
export const GAZETTEER_PROFILE = { name: "travis-places", version: "1.0.0" } as const;
export const DEFAULT_CATALOG = "pipeline/docs/travis-sources.yaml";
export const DEFAULT_TCAD_ZIP =
  "pipeline/data/raw/tcad/2026_20Certified_20JSON_20SUPP_200_2007182026.zip";
/** The contractor note of every emitted permit until the Comptroller baseline lands (A-07). */
export const CONTRACTOR_NOTE = "Comptroller baseline not loaded (A-07)";

/** The A-07 Comptroller registry snapshot this run resolves contractors against, if wired. */
export interface ContractorRegistryOption {
  registry: readonly RegistryRecord[];
  registrySnapshotDigest: string;
  crosswalk?: CrosswalkIndex;
}

export function parseMonth(month: string): { year: number; month: number } {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) throw new Error(`month must be YYYY-MM, got ${month}`);
  const parsed = { year: Number(m[1]), month: Number(m[2]) };
  if (parsed.month < 1 || parsed.month > 12) throw new Error(`month ${m[2]} is not 01…12`);
  return parsed;
}

/** `travis-<yyyymm>-permits-<utc instant>`, lower-case so it matches the manifest's runId rule. */
export function runIdFor(month: string, now: Date): string {
  const { year, month: m } = parseMonth(month);
  const utc = now
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z")
    .replace(/[-:]/g, "")
    .toLowerCase();
  return `travis-${year}${String(m).padStart(2, "0")}-permits-${utc}`;
}

type Derivation = "aggregate_match" | "capture_receipt" | "published_rows";
export type Coverage = Record<string, { count: number; derivation: Derivation; note?: string }>;

/**
 * AD-24's manifest-coverage fallback for A-07/AD-05's five contractor-identity states,
 * collapsed to the three buckets the manifest actually requires (`ambiguous`/`conflicting`/
 * `unresolved` are all genuine non-identifications, per ADR-0002 #6: no lexicon carrier
 * distinguishes them, so the published coverage does not either). `byState` comes from
 * summing every published property's `PropertyImprovementCounts.by_contractor_state`
 * (emitted permits only) -- never fabricated here. Without a wired registry, `byState` is
 * empty and every emitted permit genuinely resolved `unresolved`/`registry_unavailable`
 * (resolver.ts step 2), so `contractor_unresolved.count` still equals `emitted` and keeps the
 * A-07 note.
 */
export function contractorCoverage(
  byState: Partial<Record<ResolverState, number>>,
  registryLoaded: boolean,
): Coverage {
  const n = (k: ResolverState): number => byState[k] ?? 0;
  const unresolved = n("ambiguous") + n("conflicting") + n("unresolved");
  return {
    contractor_resolved: { count: n("resolved"), derivation: "aggregate_match" },
    contractor_candidate: { count: n("candidate"), derivation: "aggregate_match" },
    contractor_unresolved: {
      count: unresolved,
      derivation: "aggregate_match",
      ...(registryLoaded ? {} : { note: CONTRACTOR_NOTE }),
    },
  };
}

/** Owner gaps per published property, from the County transform's outcome on each record. */
export function ownerCoverage(outcomes: Record<string, number>): Coverage {
  const n = (k: string): number => outcomes[k] ?? 0;
  return {
    owner_no_dated_sale: {
      count: n("no_dated_sale"),
      derivation: "capture_receipt",
      note: "owners[] present but no dated sale; the owners are linked to the property all the same (ERR-69)",
    },
    owner_unparsed: {
      count: n("unparsed"),
      derivation: "capture_receipt",
      note: "a dated sale, but no owner name splits into a person or reads as a company",
    },
    owner_confidential: {
      count: n("suppressed"),
      derivation: "capture_receipt",
      note: "owner name and mailing withheld: a confidentiality flag on the TCAD record (P0-15), or individuals left out by OWNER_PERSONS=omit",
    },
    owner_no_record: {
      count: n("none"),
      derivation: "capture_receipt",
      note: "the TCAD record has no owners[]",
    },
  };
}

/** The profile as the transforms consume it: no addition, no trade-type mapping (D-4b). */
function strictProfileApi(): ProfileApi {
  return {
    PROFILE: { ...travisAustin.PROFILE },
    classifyPermit: (row) => {
      const c = travisAustin.classifyPermit(row);
      return {
        roofing: c.roofing,
        reason: c.reason,
        improvement_type: c.improvement_type,
        improvement_action: c.improvement_action,
        sha256: c.profile_sha256,
      };
    },
    classifyStatus: (word) => {
      const s = travisAustin.classifyStatus(word);
      return { class: s.class, improvement_status: s.improvement_status, sha256: s.profile_sha256 };
    },
  };
}

export function catalogZipSha256(catalogPath: string): string {
  const doc = parseYaml(readFileSync(catalogPath, "utf8")) as {
    parcel?: { account_breakdown?: { export_sha256?: unknown } };
  };
  const sha = doc?.parcel?.account_breakdown?.export_sha256;
  if (typeof sha !== "string" || !/^[0-9a-f]{64}$/.test(sha)) {
    throw new Error(`${catalogPath} has no parcel.account_breakdown.export_sha256`);
  }
  return sha;
}

async function fileSha256(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

export interface RunMonthOptions {
  repoRoot: string;
  /** `YYYY-MM`. */
  month: string;
  /** Adapter job id (artifact dir); default `austin-<month>`. */
  jobId?: string;
  runId?: string;
  tcadZip?: string;
  catalogPath?: string;
  fetch?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
  random?: () => number;
  log?: (event: string, fields: LogFields) => void;
  /** Omitted = the Comptroller baseline is not wired for this run (pre-A-07 default). */
  contractorRegistry?: ContractorRegistryOption;
}

export interface RunCounts {
  captured: number;
  accepted: number;
  excluded: number;
  emitted: number;
  no_tcad: number;
}

export interface RunSummary {
  runId: string;
  month: string;
  jobId: string;
  county: typeof COUNTY;
  startedAt: string;
  finishedAt: string;
  status: "ok";
  counts: RunCounts;
  /**
   * TCAD confidentiality redactions applied (Texas Tax Code §25.025, P0-15): published parcels
   * whose owner name and mailing address were withheld by the County transform, before any
   * `validate` input was written. Repeated in the manifest's TCAD limitation note.
   */
  owners_redacted: number;
  excluded_by_reason: Record<string, number>;
  needs_review_by_reason: Record<string, number>;
  /** Permits whose GET returned several rows of one number, by the adapter's reason (#5). */
  duplicates_by_reason: Record<string, number>;
  coverage: Coverage;
  sources: Array<{
    name: string;
    url: string;
    watermark: string | null;
    captured_at: string | null;
    records: number;
    receipts: string;
    limitations: string[];
  }>;
  profiles: Array<{
    name: string;
    version: string;
    sha256: string;
    path: string;
    gitCommit: string | null;
  }>;
  groups: Record<"county" | "property_improvement", string>;
  artifacts: { jobDir: string; ledger: string; roofAge: string; seed: string; tcad: string };
  limitations: string[];
}

export interface RunMonthResult {
  ok: boolean;
  status: AdapterOutcome;
  stage: string;
  reason?: string;
  runId: string;
  runDir: string;
  summary?: RunSummary;
}

const json = (v: unknown): string => `${JSON.stringify(v, null, 2)}\n`;
const jsonl = (rows: unknown[]): string =>
  rows.length === 0 ? "" : `${rows.map((r) => JSON.stringify(r)).join("\n")}\n`;
const tally = (keys: string[]): Record<string, number> =>
  keys.reduce<Record<string, number>>((a, k) => ({ ...a, [k]: (a[k] ?? 0) + 1 }), {});

type TcadMatch =
  | "matched"
  | "matched_unmapped_property_type"
  | "ambiguous_geoid"
  | "tcad_id_unmatched"
  | "no_tcad_geoid"
  | "not_looked_up";

type LedgerRow = ClassificationLedgerRow & { tcad_id: string | null; tcad_match: TcadMatch };

/** The status artifact state of a ledger row (data-model PermitStatus). */
function statusState(l: LedgerRow): string {
  if (l.emitted) return "emitted";
  if (l.skip_reason === null) {
    switch (l.tcad_match) {
      case "no_tcad_geoid":
        return "not_emitted:no_tcad_id";
      case "ambiguous_geoid":
        return "not_emitted:ambiguous_geoid";
      case "matched_unmapped_property_type":
        return "not_emitted:unmapped_property_type";
      default:
        return "not_emitted:tcad_id_unmatched";
    }
  }
  return `${exclusionKind(l)}:${exclusionReason(l)}`;
}

const exclusionKind = (l: ClassificationLedgerRow): "excluded" | "needs_review" =>
  l.skip_reason === "status_exclude" ||
  l.skip_reason === "no_improvement_type" ||
  l.skip_reason === "trade_sub_permit"
    ? "excluded"
    : "needs_review";

/** `status_exclude`, the profile's exclusion id (for example `trade_permit`), or the review id. */
const exclusionReason = (l: ClassificationLedgerRow): string =>
  l.skip_reason === "status_exclude"
    ? "status_exclude"
    : l.skip_reason === "status_needs_review"
      ? "status_needs_review"
      : l.reason;

function gitCommit(repoRoot: string): string | null {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

export async function runMonth(options: RunMonthOptions): Promise<RunMonthResult> {
  const { repoRoot } = options;
  const now = options.now ?? (() => new Date());
  const log =
    options.log ?? ((event: string, fields: LogFields) => createLogger().info(event, fields));
  parseMonth(options.month);
  const runId = options.runId ?? runIdFor(options.month, now());
  const jobId = options.jobId ?? `austin-${options.month}`;
  const runDir = join(repoRoot, "pipeline/data/runs", runId);
  const jobDir = join(repoRoot, "pipeline/data/artifacts/permits", COUNTY.slug, jobId);
  mkdirSync(runDir, { recursive: true });
  const statePath = join(runDir, "run-state.json");
  const state: Record<string, unknown> = {
    runId,
    month: options.month,
    jobId,
    startedAt: now().toISOString(),
    finishedAt: null,
    status: "running",
    stage: "start",
  };
  const saveState = (patch: Record<string, unknown>): void => {
    Object.assign(state, patch);
    writeFileSync(statePath, json(state));
  };
  saveState({});
  const fail = (
    stage: string,
    reason: string,
    status: AdapterOutcome = "error",
  ): RunMonthResult => {
    saveState({ status, stage, reason });
    log("run-month.failed", { runId, stage, status, reason });
    return { ok: false, status, stage, reason, runId, runDir };
  };
  const io = {
    now,
    log,
    ...(options.fetch ? { fetch: options.fetch } : {}),
    ...(options.sleep ? { sleep: options.sleep } : {}),
  };
  log("run-month.start", { runId, month: options.month, jobId });

  // 1 lexicon manifest
  let cids: DataGroupCids;
  try {
    const lexicon = await fetchDataGroupCids(io);
    cids = lexicon.cids;
    mkdirSync(join(runDir, "capture/lexicon"), { recursive: true });
    writeFileSync(join(runDir, "capture/lexicon/receipt.json"), json({ ...lexicon.receipt, cids }));
  } catch (error) {
    return fail("lexicon", (error as Error).message);
  }
  saveState({ stage: "austin" });

  // 2 Austin capture through the adapter
  let capture: SocrataCaptureResult;
  try {
    capture = await captureAustinMonth({
      month: options.month,
      jobDir,
      ...io,
      ...(options.random ? { random: options.random } : {}),
    });
  } catch (error) {
    return fail("austin", (error as Error).message);
  }
  mkdirSync(join(runDir, "capture"), { recursive: true });
  writeFileSync(
    join(runDir, "capture/austin.json"),
    json({
      source: AUSTIN_3SYK_W9EU.name,
      jobDir,
      status: capture.status,
      reason: capture.reason ?? null,
      listed: capture.listed.length,
      captured: capture.captured.length,
      skipped: capture.skipped.length,
      watermark: capture.watermark,
      list: capture.list,
    }),
  );
  // contracts/cli.md: the adapter labels a 403 or a bot challenge `blocked` (exit 2) and a
  // timeout or any other failure `error` (exit 1); its label is passed through (CR-A-03 F-6).
  if (capture.status !== "ok")
    return fail("austin", capture.reason ?? capture.status, capture.status);
  const loaded = loadCaptures(jobDir, AUSTIN_3SYK_W9EU, capture.listed);
  // This run's receipts only (OR-10): the job dir's receipts.jsonl keeps every earlier run's lines.
  const runReceipts = join(runDir, "capture/austin-receipts.jsonl");
  writeFileSync(runReceipts, loaded.map((c) => `${JSON.stringify(c.receipt)}\n`).join(""));
  const captures: AustinPermitCapture[] = loaded.map((c) => ({
    row: c.row as AustinRow,
    receipt: {
      url: c.receipt.url,
      method: "GET",
      multiValueQueryString: { permit_number: [c.permit_number] },
      status: c.receipt.status,
      sha256: c.receipt.sha256,
      captured_at: c.receipt.captured_at,
    },
  }));
  const keyOf = new Map(loaded.map((c) => [c.permit_number, c.key]));
  const austinCapturedAt =
    loaded
      .map((c) => c.receipt.captured_at)
      .sort()
      .at(-1) ?? null;

  // 3 classification by the profile only; accepted = would be emitted
  const profile = strictProfileApi();
  const tcadIdOf = (c: AustinPermitCapture): string | null => {
    const v = c.row.tcad_id;
    return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
  };
  const pre = new Map(
    captures.map((c) => [c.row.permit_number, classifyCapture(c, profile, null)]),
  );
  const accepted = captures.filter((c) => pre.get(c.row.permit_number)?.emitted === true);
  const wanted = [...new Set(accepted.map(tcadIdOf).filter((v): v is string => v !== null))];
  saveState({ stage: "tcad-zip" });

  // 4 TCAD subset: the certified zip, checked against the catalog, scanned for `wanted` only
  const catalogPath = options.catalogPath ?? join(repoRoot, DEFAULT_CATALOG);
  const zipPath = options.tcadZip ?? join(repoRoot, DEFAULT_TCAD_ZIP);
  let expectedSha: string;
  try {
    expectedSha = catalogZipSha256(catalogPath);
  } catch (error) {
    return fail("catalog", (error as Error).message);
  }
  if (!existsSync(zipPath)) return fail("tcad-zip", `certified zip not found: ${zipPath}`);
  const zipSha = await fileSha256(zipPath);
  if (zipSha !== expectedSha) {
    return fail(
      "tcad-zip",
      `certified zip sha256 ${zipSha} does not match the catalog export_sha256 ${expectedSha}`,
    );
  }
  const tcadDir = join(runDir, "capture/tcad");
  log("run-month.tcad.scan", { wanted: wanted.length });
  const scanned = await scanTcadSubset({ zipPath, wanted, zipSha256: zipSha, now });
  await writeSubset(tcadDir, scanned);
  const tcadReceipt = JSON.parse(
    readFileSync(join(tcadDir, "receipt.json"), "utf8"),
  ) as TcadSubsetReceipt;
  const finishedAt = now().toISOString();
  saveState({ finishedAt, stage: "transform" });

  // 5 seed
  const byGeo = new Map(tcadReceipt.resolution.map((r) => [r.tcad_id ?? "(null)", r]));
  const allParcels = readSubset(tcadDir).map((s) => {
    const record = parseTcadRecord(s.record);
    return { record, geoID: s.geoID, seed: buildSeedRow(record, s.geoID) as SeedRow };
  });
  allParcels.sort((a, b) =>
    a.seed.parcel_id.localeCompare(b.seed.parcel_id, "en", { numeric: true }),
  );
  // property.property_type is required: a parcel whose TCAD state code has no mapping is not
  // written (never guessed) and is counted; its permits stay in the ledger as not emitted.
  const unmappedType = allParcels
    .map((p) => ({ pID: p.seed.parcel_id, fields: propertyFields(p.record) }))
    .filter((p) => p.fields.property_type === null)
    .map((p) => ({ pID: p.pID, warnings: p.fields.warnings }));
  const unmappedPids = new Set(unmappedType.map((p) => p.pID));
  const parcels = allParcels.filter((p) => !unmappedPids.has(p.seed.parcel_id));
  const seedPath = join(runDir, "seed", `${COUNTY.slug}.csv`);
  writeSeed(
    seedPath,
    parcels.map((p) => p.seed),
  );

  // 6 classification ledger with parcel identity, and the status artifacts
  const matchOf = (c: AustinPermitCapture): { match: TcadMatch; pID: string | null } => {
    const id = tcadIdOf(c);
    if (id === null) return { match: "no_tcad_geoid", pID: null };
    if (!wanted.includes(id)) return { match: "not_looked_up", pID: null };
    const r = byGeo.get(id);
    if (r === undefined || r.status === "no_tcad_geoid")
      return { match: "tcad_id_unmatched", pID: null };
    if (r.status === "ambiguous_geoid") return { match: "ambiguous_geoid", pID: null };
    const pID = r.pIDs[0] as string;
    return unmappedPids.has(pID)
      ? { match: "matched_unmapped_property_type", pID: null }
      : { match: "matched", pID };
  };
  const pidOfPermit = (c: AustinPermitCapture): string | null =>
    pre.get(c.row.permit_number)?.emitted === true ? matchOf(c).pID : null;
  const ledger: LedgerRow[] = captures.map((c) => {
    const { match, pID } = matchOf(c);
    const l = classifyCapture(c, profile, pidOfPermit(c));
    return { ...l, emitted: l.emitted && pID !== null, tcad_id: tcadIdOf(c), tcad_match: match };
  });
  mkdirSync(join(runDir, "ledger"), { recursive: true });
  writeFileSync(join(runDir, "ledger/classification.jsonl"), jsonl(ledger));
  for (const l of ledger) {
    updateStatus(jobDir, keyOf.get(l.permit_number) as string, {
      state: statusState(l),
      pID: l.pID,
      tcad_id: l.tcad_id,
      tcad_match: l.tcad_match,
      classification: {
        roofing: l.roofing,
        reason: l.reason,
        status_class: l.status_class,
        skip_reason: l.skip_reason,
        profile: l.profile_version,
        profile_sha256: l.profile_sha256,
      },
      runId,
    });
  }

  // 7 roof-age ledger
  const roofAge: RoofAgeLedgerRow[] = parcels.map((p) => {
    const pID = p.seed.parcel_id;
    return estimateTravisRoofAge({
      pID,
      finishedAt,
      builtYear: propertyFields(p.record).property_structure_built_year,
      permits: ledger
        .filter((l) => l.pID === pID)
        .map((l) => ({
          permit_number: l.permit_number,
          status_class: l.status_class,
          roofing: l.roofing,
          issue_date: l.issue_date,
          completed_date: l.completed_date,
        })),
    });
  });
  writeFileSync(join(runDir, "ledger/roof-age.jsonl"), jsonl(roofAge));

  // 8 transforms: a parcel is written to both groups only when it has an emitted permit
  const groupsDir = join(runDir, "groups");
  rmSync(groupsDir, { recursive: true, force: true });
  const countyCounts: Array<{ pID: string } & CountyTransformCounts> = [];
  const piCounts: Array<{
    pID: string;
    emitted: number;
    excluded: number;
    needs_review: number;
    by_contractor_state: Partial<Record<ResolverState, number>>;
  }> = [];
  const contractorRegistry = options.contractorRegistry;
  const contractorIdentity: ContractorIdentityInput | undefined = contractorRegistry && {
    registry: contractorRegistry.registry,
    registryLoaded: true,
    registrySnapshotDigest: contractorRegistry.registrySnapshotDigest,
    ...(contractorRegistry.crosswalk === undefined
      ? {}
      : { crosswalk: contractorRegistry.crosswalk }),
  };
  const writeFiles = (group: string, dir: string, files: Record<string, string>): void => {
    for (const [name, text] of Object.entries(files)) {
      const path = join(groupsDir, group, dir, name);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, text);
    }
  };
  let parcelsWithoutEmittedPermit = 0;
  for (const p of parcels) {
    const pID = p.seed.parcel_id;
    const permits = captures
      .filter((c) => pidOfPermit(c) === pID)
      .sort((a, b) => a.row.permit_number.localeCompare(b.row.permit_number));
    const pi = transformAustinPropertyImprovement({
      record: p.record,
      seed: p.seed,
      cids,
      permits,
      profile,
      ...(contractorIdentity === undefined ? {} : { contractorIdentity }),
    });
    if (pi.counts.emitted === 0) {
      parcelsWithoutEmittedPermit += 1;
      continue;
    }
    const roof = roofAge.find((r) => r.pID === pID) ?? null;
    const county = transformTcadCounty({
      record: p.record,
      seed: p.seed,
      cids,
      roofAge: roof && {
        pID,
        roof_date: roof.roof_date,
        anchor: roof.estimate.anchor?.type ?? null,
      },
    });
    writeFiles("county", county.dir, county.files);
    writeFiles("property_improvement", pi.dir, pi.files);
    countyCounts.push({ pID, ...county.counts });
    piCounts.push({
      pID,
      emitted: pi.counts.emitted,
      excluded: pi.counts.excluded,
      needs_review: pi.counts.needs_review,
      by_contractor_state: pi.counts.by_contractor_state,
    });
  }
  const contractorByState: Partial<Record<ResolverState, number>> = {};
  for (const pi of piCounts) {
    for (const [state, count] of Object.entries(pi.by_contractor_state)) {
      const key = state as ResolverState;
      contractorByState[key] = (contractorByState[key] ?? 0) + (count ?? 0);
    }
  }

  // 9 summary
  const byMatch = (m: TcadMatch): number => ledger.filter((l) => l.tcad_match === m).length;
  const emittedRows = ledger.filter((l) => l.emitted);
  const notAccepted = ledger.filter((l) => l.skip_reason !== null);
  const excludedRows = notAccepted.filter((l) => exclusionKind(l) === "excluded");
  const reviewRows = notAccepted.filter((l) => exclusionKind(l) === "needs_review");
  const noTcad = ledger.filter((l) => l.skip_reason === null && l.tcad_match === "no_tcad_geoid");
  const ownerOutcomes = tally(countyCounts.map((c) => c.owner));
  const roofByAnchor = tally(roofAge.map((r) => r.estimate.anchor?.type ?? "none"));
  const roofCaveats = [
    ...new Set(roofAge.flatMap((r) => r.estimate.historicalCoverage.caveats)),
  ].sort();
  const counts: RunCounts = {
    captured: captures.length,
    accepted: accepted.length,
    excluded: excludedRows.length,
    emitted: emittedRows.length,
    no_tcad: noTcad.length,
  };
  const commit = gitCommit(repoRoot);
  const roofProfileSha = roofAge[0]?.profile.sha256 ?? null;
  const gazetteerSha = gazetteerDigest(repoRoot);
  const ownersRedacted = countyCounts.filter((c) => c.confidential).length;
  const summary: RunSummary = {
    runId,
    month: options.month,
    jobId,
    county: COUNTY,
    startedAt: state.startedAt as string,
    finishedAt,
    status: "ok",
    counts,
    owners_redacted: ownersRedacted,
    excluded_by_reason: tally(excludedRows.map(exclusionReason)),
    needs_review_by_reason: tally(reviewRows.map(exclusionReason)),
    duplicates_by_reason: tally(capture.duplicates.map((d) => d.reason)),
    coverage: {
      permits_captured: { count: captures.length, derivation: "capture_receipt" },
      permits_accepted: {
        count: accepted.length,
        derivation: "aggregate_match",
        note: "the profile would publish them; a parcel match is still needed",
      },
      permits_excluded: {
        count: excludedRows.length,
        derivation: "aggregate_match",
        note: "not emitted",
      },
      permits_needs_review: {
        count: reviewRows.length,
        derivation: "aggregate_match",
        note: "not emitted",
      },
      permits_no_tcad_geoid: { count: noTcad.length, derivation: "aggregate_match" },
      permits_tcad_id_unmatched: {
        count: byMatch("tcad_id_unmatched"),
        derivation: "aggregate_match",
        note: "tcad_id printed but no residential account carries that geoID",
      },
      permits_ambiguous_geoid: { count: byMatch("ambiguous_geoid"), derivation: "aggregate_match" },
      // CR-A-11-porygon finding 2: `link.ts`'s other 2 full-scale, link-stage `UnmatchedReason`s
      // (`no_tcad_id`, `address_unmatched`/`ambiguous_address` — a permit with no usable tcad_id
      // that falls through to the geoID+address matcher). This one-month flow never runs that
      // matcher: every permit here already carries a seed-assigned pID before TCAD lookup
      // starts (D-5), so these counts are genuinely, structurally zero here, not omitted or
      // assumed. The full Query-DB-driven run (A-11 T031) is the producer that can see a
      // nonzero count for these reasons.
      permits_no_tcad_id: {
        count: 0,
        derivation: "aggregate_match",
        note: "this one-month capture pre-assigns pID by seed; link.ts's address-fallback matcher never runs here",
      },
      permits_address_unmatched: {
        count: 0,
        derivation: "aggregate_match",
        note: "this one-month capture pre-assigns pID by seed; link.ts's address-fallback matcher never runs here",
      },
      permits_ambiguous_address: {
        count: 0,
        derivation: "aggregate_match",
        note: "this one-month capture pre-assigns pID by seed; link.ts's address-fallback matcher never runs here",
      },
      permits_matched_parcel: { count: byMatch("matched"), derivation: "aggregate_match" },
      parcels_matched: { count: allParcels.length, derivation: "aggregate_match" },
      parcels_published: { count: countyCounts.length, derivation: "published_rows" },
      parcels_unmapped_property_type: {
        count: unmappedType.length,
        derivation: "aggregate_match",
        note: "TCAD state code with no lexicon property_type mapping; not published",
      },
      parcels_without_emitted_permit: {
        count: parcelsWithoutEmittedPermit,
        derivation: "aggregate_match",
      },
      permits_emitted: { count: emittedRows.length, derivation: "published_rows" },
      permits_emitted_stalled: {
        count: emittedRows.filter((l) => l.status_class === "stalled").length,
        derivation: "aggregate_match",
        note: "Expired: improvement_status null (D-4a)",
      },
      confidential_suppressed: {
        count: ownersRedacted,
        derivation: "capture_receipt",
        note: "owner name and mailing withheld before validate (P0-15)",
      },
      ...ownerCoverage(ownerOutcomes),
      ...contractorCoverage(contractorByState, contractorRegistry !== undefined),
      roof_age_permit_anchor: {
        count: roofByAnchor.permit_terminal_date ?? 0,
        derivation: "published_rows",
        note: `estimator confidence high; caveats: ${roofCaveats.join(", ") || "none"}`,
      },
      roof_age_built_year: {
        count: roofByAnchor.property_built_year ?? 0,
        derivation: "published_rows",
        note: `estimator confidence low; caveats: ${roofCaveats.join(", ") || "none"}`,
      },
    },
    sources: [
      {
        name: AUSTIN_3SYK_W9EU.name,
        url: datasetUrl(AUSTIN_3SYK_W9EU),
        watermark: capture.watermark,
        captured_at: austinCapturedAt,
        records: captures.length,
        receipts: runReceipts,
        limitations: [`one month of issue dates (${options.month}); one GET per permit`],
      },
      {
        name: TCAD_SOURCE,
        url: TCAD_EXPORT_REQUEST.url,
        watermark: `${tcadReceipt.entry_name}@sha256:${tcadReceipt.zip_sha256}`,
        captured_at: tcadReceipt.captured_at,
        records: tcadReceipt.counts.matched,
        receipts: join(tcadDir, "receipt.json"),
        limitations: ["subset: only the parcels the emitted permits point to (geoID = tcad_id)"],
      },
    ],
    profiles: [
      {
        name: travisAustin.PROFILE.name,
        version: travisAustin.PROFILE.version,
        sha256: travisAustin.PROFILE.sha256,
        path: PROFILE_PATH,
        gitCommit: commit,
      },
      ...(roofProfileSha === null
        ? []
        : [
            {
              name: "travis-austin-roof-profile",
              version: TRAVIS_ROOF_AGE_PROFILE_VERSION,
              sha256: roofProfileSha,
              path: ROOF_PROFILE_PATH,
              gitCommit: commit,
            },
          ]),
      {
        name: GAZETTEER_PROFILE.name,
        version: GAZETTEER_PROFILE.version,
        sha256: gazetteerSha,
        path: GAZETTEER_PATH,
        gitCommit: commit,
      },
    ],
    groups: { county: "groups/county", property_improvement: "groups/property_improvement" },
    artifacts: {
      jobDir,
      ledger: join(runDir, "ledger/classification.jsonl"),
      roofAge: join(runDir, "ledger/roof-age.jsonl"),
      seed: seedPath,
      tcad: tcadDir,
    },
    limitations: [
      ...(capture.duplicates.length > 0
        ? [
            `duplicates: ${capture.duplicates.length} permit number${capture.duplicates.length === 1 ? "" : "s"} returned several rows in the per-permit GET; one row kept per number (${capture.duplicates.map((d) => `${d.permit_number}: ${d.rows} rows, ${d.reason}`).join("; ")})`,
          ]
        : []),
      "finishedAt is the end of the capture phase (the data's as-of instant)",
      `roof age: the estimator saw one month of each parcel's Austin permits, not its full history (${roofCaveats.join(", ") || "no caveat"})`,
      `contractors: ${CONTRACTOR_NOTE}; no contractor, person or license is written`,
    ],
  };
  mkdirSync(join(runDir, "reports"), { recursive: true });
  writeFileSync(
    join(runDir, "reports/transform-counts.json"),
    json({
      county: countyCounts,
      property_improvement: piCounts,
      roof_age: roofByAnchor,
      owner_outcomes: ownerOutcomes,
    }),
  );
  writeFileSync(join(runDir, "summary.json"), json(summary));
  saveState({ status: "ok", stage: "done" });
  log("run-month.done", { runId, ...counts, owners_redacted: ownersRedacted });
  return { ok: true, status: "ok", stage: "done", runId, runDir, summary };
}

/** The generated gazetteer digest; when the repo's DIGEST file is present it must agree. */
function gazetteerDigest(repoRoot: string): string {
  const file = join(repoRoot, GAZETTEER_PATH, "DIGEST");
  if (existsSync(file)) {
    const onDisk = readFileSync(file, "utf8").trim();
    if (onDisk !== GAZETTEER_SHA256)
      throw new Error(
        `${GAZETTEER_PATH}/DIGEST ${onDisk} is not the generated ${GAZETTEER_SHA256}`,
      );
  }
  return GAZETTEER_SHA256;
}

function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const isMain =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
  const month = argValue("--month");
  const jobId = argValue("--job");
  if (month === undefined) {
    process.stderr.write("usage: run-month.ts --month YYYY-MM [--job <jobId>]\n");
    process.exitCode = 1;
  } else {
    runMonth({ repoRoot, month, ...(jobId !== undefined ? { jobId } : {}) }).then(
      (r) => {
        process.stdout.write(
          `${JSON.stringify({ ok: r.ok, status: r.status, stage: r.stage, reason: r.reason ?? null, runId: r.runId, runDir: r.runDir, counts: r.summary?.counts ?? null, owners_redacted: r.summary?.owners_redacted ?? null })}\n`,
        );
        process.exitCode = exitCodeFor(r.status);
      },
      (error: unknown) => {
        process.stderr.write(`${(error as Error).stack ?? String(error)}\n`);
        process.exitCode = 1;
      },
    );
  }
}
