// A-11: the reusable "build a run manifest from batched outputs" logic behind
// scripts/build-run-manifest.ts (the generalization of scripts/build-run1-manifest.ts, which
// hard-coded Run 1's facts). A follow-up run that captured nothing new (Run 2, the correction
// run) takes its *source* facts, profiles, coverage and limitations from a base manifest (Run 1's
// committed manifest) and only its artifacts, ids and times from the new batch directories.
//
// Every guard stays in the real buildManifest(): CAR root vs CountyTables.county_root, tables
// root, every part CID/size, the 48m bound, the clean-tree gate and `permits_emitted` vs the
// published rows. This module adds only checks that are about *carrying facts over*:
//   - previousManifestCid must equal the CID of the base manifest's bytes;
//   - the sources' watermark/records/captured_at must come out identical to the base's (no new
//     capture means those cannot change);
//   - the carried contractor/permit-link coverage keys must still be true: if the number of
//     published permits differs from the base's, the caller must supply those keys explicitly.
// The output bytes are `built.bytes` (RFC 8785 JCS) written verbatim, never re-serialized.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { z } from "zod";
import { RunManifestV1, type CoverageCount, type ManifestProfile } from "@countylens/contract";
import { GAZETTEER_SHA256 } from "@countylens/query-core";
import { cidOfBytes } from "./cid.js";
import {
  buildManifest,
  manifestGroupInputsFromBatches,
  ADDRESS_POINT_SOURCE,
  COUNTY_ROW_COVERAGE,
  type BuildManifestInput,
  type BuiltManifest,
  type ManifestGroupInput,
} from "./manifest.js";
import {
  austinSourceInput,
  checkFactsAgainstBase,
  parseAustinFacts,
  unchangedSourceInput,
  type AustinIncrementalFacts,
} from "./incremental/austin-run.js";
import { parseRunsIndex } from "./runs-index.js";

export const DEFAULT_BASE_MANIFEST = "runs/travis-full-run1-20261023/manifest.json";
export const DEFAULT_AUSTIN_RECEIPT = "specs/011-publish-and-runs/receipts/austin-run1.json";
export const DEFAULT_TCAD_RECEIPT = "specs/011-publish-and-runs/receipts/tcad-run1.json";
export const PILOT_MANIFEST_PATH = "specs/011-publish-and-runs/pilot/manifest.json";
/** Run 1's draft marker; it describes a pre-publish draft and must not travel into a published run. */
const DRAFT_LIMITATION_PREFIX = "DRAFT for Stage 6";

/** The basis of coverage.parcels_published: which accounts the County group publishes. */
export const PARCELS_BASIS =
  "County `property` rows of the TCAD 2026 certified export: real-property (R) accounts only; accounts of other property types are not published";

export const CORRECTION_NOTE =
  "Correction run, no new source capture: the Property Improvement group's shared property files were rebuilt so that each permit's property CID equals its County property CID (the previous run's did not join, so none of its permits linked to a County property). The County group's batches are reused unchanged from the previous run.";

/** The travis-places gazetteer: a static in-repo reference list (Census ZCTA-county relationship
 *  file), not a captured source. A full-county run names it so a consumer can classify owner
 *  mailing ZIPs (owner_area_class) with the exact list the run was built against. */
export const GAZETTEER_PROFILE_ENTRY = {
  name: "travis-places",
  version: "1.0.0",
  path: "packages/query-core/gazetteer/travis-places@1.0.0",
} as const;

const Cid = z.string().min(1);
const Dir = z.string().min(1);

export const RunManifestConfig = z
  .object({
    runId: z.string().min(1),
    startedAt: z.string().min(1),
    finishedAt: z.string().min(1),
    previousManifestCid: Cid,
    /** Directory holding `cars/` and `tables/` of the county batches. */
    countyDir: Dir,
    /** Directory holding `cars/` and `tables/` of the permits (property_improvement) batches. */
    permitsDir: Dir,
    /** Batch numbers; default: every `cars/travis-<group>-bNN.car` found, ascending. */
    countyBatches: z.array(z.number().int().positive()).optional(),
    permitsBatches: z.array(z.number().int().positive()).optional(),
    baseManifest: Dir.default(DEFAULT_BASE_MANIFEST),
    austinReceipt: Dir.default(DEFAULT_AUSTIN_RECEIPT),
    tcadReceipt: Dir.default(DEFAULT_TCAD_RECEIPT),
    /**
     * Replaces carried-over coverage keys (never `permits_emitted`, `parcels_published` or the
     * COUNTY_ROW_COVERAGE keys, which are computed from the published rows).
     */
    coverageOverrides: z
      .record(
        z.string(),
        z.object({
          count: z.number().int().nonnegative(),
          derivation: z.enum(["published_rows", "capture_receipt", "aggregate_match"]),
          note: z.string().optional(),
        }),
      )
      .optional(),
    /** Linked-permit total for the A-16 #6 reconciliation (unpublished; see buildManifest). */
    linkedPermits: z.number().int().nonnegative().optional(),
    /** Run 1's Run 2 default; an incremental run states its own note instead (see below). */
    correctionNote: z.string().min(1).optional(),
    /**
     * A correction run on the same captures (Run 3.1, ERR-73): carried run-level limitations that
     * start with one of these prefixes are dropped, because the correction note restates them.
     */
    dropLimitationPrefixes: z.array(z.string().min(1)).optional(),
    /**
     * A correction run on the same captures: replaces a carried source's limitations by name
     * (for example the Austin source's stale "Comptroller baseline not loaded"). Each named
     * source must exist in the base manifest.
     */
    sourceLimitations: z.record(z.string().min(1), z.array(z.string().min(1))).optional(),
    /** Replaces the Austin source's "Comptroller baseline not loaded" note (ERR-73). */
    registryNote: z.string().min(1).optional(),
    /**
     * A run that reuses the base run's County artifacts (Run 3.1, Run 4): the base's
     * address-point source is carried like the other sources (delta 0, its limitations kept),
     * because the reused coordinates still come from it. In an incremental run it also states
     * that it was carried without a new capture. Needs `addressPointsReceipt`.
     */
    carryAddressPoints: z.boolean().optional(),
    /**
     * The report written by pipeline/local-stack/scripts/contractor-coverage.ts (ERR-73). With it,
     * every contractor_* coverageOverrides count must equal the report's five-state totals, and the
     * totals must add up to the published permits, so hand-copied counts cannot drift.
     */
    contractorCoverage: Dir.optional(),
    /**
     * An incremental run (Run 3): the facts file written by
     * pipeline/local-stack/scripts/incremental-facts.ts for the Austin permits source. With it
     * the Austin source gets the new watermark, the real delta and the new capture-time total;
     * every other source keeps its facts with delta 0 and the reason "source unchanged,
     * watermark X". `austinReceipt` must then be the receipt file written beside the facts.
     */
    austinFacts: Dir.optional(),
    /**
     * Run 3 (ADR 0004): a receipt file for the City of Austin address-point layer used for
     * County coordinates: `{captured_at, records, sha256, layer_last_edit_date, layer_url}`.
     * It adds the optional third source `austin-address-points`.
     */
    addressPointsReceipt: Dir.optional(),
  })
  .strict();
export type RunManifestConfig = z.input<typeof RunManifestConfig>;

/**
 * A limitation carried from the base run that states the base's published permit rows
 * ("(17387 rows)") restated with this run's count; any other text is carried unchanged. A
 * published manifest is immutable, so a stale count would stay wrong forever.
 */
export function restatePermitRows(
  limitation: string,
  baseRows: number | undefined,
  rows: number,
): string {
  if (baseRows === undefined || baseRows === rows) return limitation;
  return limitation.split(`(${baseRows} rows)`).join(`(${rows} rows)`);
}

const AddressPointReceipt = z
  .object({
    captured_at: z.string().min(1),
    records: z.number().int().nonnegative(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    layer_last_edit_date: z.string().min(1),
    layer_url: z.string().url(),
  })
  .loose();

/** The address-point source of a run: first listed, so everything in it is new (added = records). */
export function addressPointSourceInput(
  receiptPath: string,
): BuildManifestInput["sources"][number] {
  const r = AddressPointReceipt.parse(JSON.parse(readFileSync(receiptPath, "utf8")));
  return {
    name: ADDRESS_POINT_SOURCE,
    url: r.layer_url,
    watermark: r.layer_last_edit_date,
    receipts: receiptPath,
    limitations: [
      `Layer snapshot sha256 ${r.sha256}; ${r.records} records; layer last edited ${r.layer_last_edit_date}`,
    ],
    delta: { added: r.records, changed: 0, removed: 0 },
  };
}

/** The correction run's note, however it was worded when that run was published. */
const CORRECTION_NOTE_PREFIX = "Correction run, no new source capture";
const INCREMENTAL_NOTE_PREFIX = "Incremental refresh of the Austin permits source";

/** A source an incremental run still uses but did not capture again (carryAddressPoints). */
const NOT_RECAPTURED_PREFIX = "Not re-captured in this run:";

/** The note of a carried source: carried, not checked (unlike "source unchanged" for TCAD). */
export function notRecapturedLimitation(baseRunId: string, watermark: string | null): string {
  return `${NOT_RECAPTURED_PREFIX} carried from ${baseRunId} (watermark ${watermark ?? "none"})`;
}

/**
 * Source limitations an earlier run added; they describe that run, not the source. Dropped in an
 * incremental run, which states its own. "No new capture since" is a correction run's note on the
 * Austin source (Run 3.1's sourceLimitations); a run with its own capture makes it false.
 */
const RUN_SCOPED_SOURCE_LIMITATIONS = [
  "Incremental run:",
  "Row count reconciliation:",
  "source unchanged, watermark",
  "source bulk re-stamp; delta by content digest",
  "removals not checked:",
  "No new capture since",
  NOT_RECAPTURED_PREFIX,
];

/** A base source's limitations without the ones a previous incremental run attached to itself. */
export function carriedSourceLimitations(limitations: readonly string[]): string[] {
  return limitations.filter((l) => !RUN_SCOPED_SOURCE_LIMITATIONS.some((p) => l.startsWith(p)));
}

/** The run-level limitation of an incremental run: what was refreshed, from which watermark. */
export function incrementalRunNote(f: AustinIncrementalFacts): string {
  return (
    `Incremental refresh of the Austin permits source (watermark ${f.watermarkUsed} to ${f.watermarkNew}): ` +
    `added ${f.delta.added}, changed ${f.delta.changed}, removed ${f.delta.removed} permits by content digest. ` +
    `Groups listed here were rebuilt from the Query DB after the merge; their previous CIDs stay fetchable.`
  );
}

const PERMIT_LINK_NOTES: Record<string, string> = {
  permits_no_tcad_geoid:
    "Query DB property_improvements.unmatched_reason='no_tcad_geoid', request_identifier IS NULL, all captured Austin permits",
  permits_no_tcad_id: "unmatched_reason='no_tcad_id'",
  permits_ambiguous_geoid: "unmatched_reason='ambiguous_geoid'",
  permits_address_unmatched: "unmatched_reason='address_unmatched'",
  permits_ambiguous_address: "unmatched_reason='ambiguous_address'",
};

/** The five permit-link exclusion counts of an incremental run, as coverage overrides. */
function permitLinkCoverage(f: AustinIncrementalFacts): Record<string, CoverageCount> {
  const out: Record<string, CoverageCount> = {};
  for (const [key, note] of Object.entries(PERMIT_LINK_NOTES)) {
    out[key] = {
      count: f.permitLink[key as keyof typeof f.permitLink],
      derivation: "aggregate_match",
      note,
    };
  }
  return out;
}

function resolvePath(repoRoot: string, path: string): string {
  return isAbsolute(path) ? path : join(repoRoot, path);
}

/** Batch numbers present as `cars/<prefix>-bNN.car` under `dir`, ascending. */
export function discoverBatches(dir: string, carPrefix: string): number[] {
  const carsDir = join(dir, "cars");
  if (!existsSync(carsDir)) throw new Error(`${carsDir} does not exist`);
  const pattern = new RegExp(`^${carPrefix}-b(\\d+)\\.car$`);
  const numbers = readdirSync(carsDir)
    .map((f) => pattern.exec(f)?.[1])
    .filter((n): n is string => n !== undefined)
    .map(Number)
    .sort((a, b) => a - b);
  if (numbers.length === 0) throw new Error(`no ${carPrefix}-bNN.car under ${carsDir}`);
  return numbers;
}

function ownersRedactedOf(base: RunManifestV1): number {
  const note = base.sources
    .flatMap((s) => s.limitations)
    .find((l) => l.startsWith("Confidential owner records redacted"));
  const n = note === undefined ? undefined : /:\s*(\d+)\s*$/.exec(note)?.[1];
  if (n === undefined)
    throw new Error("base manifest carries no 'Confidential owner records redacted: N' note");
  return Number(n);
}

/** Sum of `tables.<table>.rows` over a group's batches' export summaries. */
function publishedRows(
  groups: readonly ManifestGroupInput[],
  table: string,
): {
  total: number;
  perBatch: string;
} {
  const rows = groups.map((g) => {
    const summary = JSON.parse(readFileSync(g.tablesExportJson, "utf8")) as {
      tables?: Record<string, { rows?: number }>;
    };
    const n = summary.tables?.[table]?.rows;
    if (typeof n !== "number") throw new Error(`${g.tablesExportJson} has no tables.${table}.rows`);
    return n;
  });
  const perBatch = groups
    .map((g, i) => `${/-(b\d+)\.car$/.exec(g.carPath)?.[1] ?? `#${i + 1}`} ${rows[i]}`)
    .join(" + ");
  return { total: rows.reduce((a, b) => a + b, 0), perBatch };
}

/**
 * The County group's ownership and coordinates counts (COUNTY_ROW_COVERAGE), from the export
 * summaries of the county batches this run publishes. A run that reuses an earlier run's county
 * batches (Run 4, Run 5) counts them from that reused directory, so the keys are never left out.
 */
export function countyRowCoverage(
  countyGroups: readonly ManifestGroupInput[],
): Record<string, CoverageCount> {
  const out: Record<string, CoverageCount> = {};
  for (const { key, table, basis } of COUNTY_ROW_COVERAGE) {
    const r = publishedRows(countyGroups, table);
    out[key] = { count: r.total, derivation: "published_rows", note: `${r.perBatch}, ${basis}` };
  }
  return out;
}

/** The base run's profiles plus travis-places when the base names none (a base profile is kept). */
export function withGazetteerProfile(
  profiles: readonly ManifestProfile[],
  gitCommit: string,
): ManifestProfile[] {
  if (profiles.some((p) => p.name === GAZETTEER_PROFILE_ENTRY.name)) return [...profiles];
  return [...profiles, { ...GAZETTEER_PROFILE_ENTRY, sha256: GAZETTEER_SHA256, gitCommit }];
}

export interface BuildRunManifestDeps {
  repoRoot: string;
  /** Injectable for tests; defaults to buildManifest's own `git status` gate. */
  workTreeStatus?: (repoRoot: string) => string;
  /** Injectable for tests; the short commit stamped on a profile this module adds. */
  gitCommit?: (repoRoot: string) => string;
}

function shortCommit(repoRoot: string): string {
  return execFileSync("git", ["rev-parse", "--short=7", "HEAD"], {
    cwd: repoRoot,
    encoding: "utf8",
  }).trim();
}

/**
 * Builds the run manifest through the real buildManifest() (all its checks run). Returns the
 * built manifest whose `bytes` are the exact JCS bytes to write.
 */
export async function buildRunManifest(
  rawConfig: RunManifestConfig,
  deps: BuildRunManifestDeps,
): Promise<BuiltManifest> {
  const config = RunManifestConfig.parse(rawConfig);
  const { repoRoot } = deps;
  const basePath = resolvePath(repoRoot, config.baseManifest);
  const baseBytes = readFileSync(basePath);
  const base = RunManifestV1.parse(JSON.parse(baseBytes.toString("utf8")));
  const baseCid = await cidOfBytes(baseBytes);
  if (baseCid !== config.previousManifestCid) {
    throw new Error(
      `previousManifestCid ${config.previousManifestCid} is not the CID of the base manifest ${config.baseManifest} (${baseCid})`,
    );
  }
  if (config.runId === base.runId) throw new Error(`runId ${config.runId} is the base run's id`);

  // An incremental run (Run 3): the Austin source's real delta, watermark and total.
  const facts =
    config.austinFacts === undefined
      ? null
      : parseAustinFacts(
          JSON.parse(readFileSync(resolvePath(repoRoot, config.austinFacts), "utf8")),
        );
  if (facts !== null) {
    const austin = base.sources.find((s) => s.name.startsWith("austin-3"));
    if (austin === undefined) throw new Error("the base manifest has no Austin source");
    checkFactsAgainstBase(facts, austin);
  }
  const linkedPermits = config.linkedPermits ?? facts?.permitLink.linkedPermits;

  const countyDir = resolvePath(repoRoot, config.countyDir);
  const permitsDir = resolvePath(repoRoot, config.permitsDir);
  const countyBatches = config.countyBatches ?? discoverBatches(countyDir, "travis-county");
  const permitsBatches = config.permitsBatches ?? discoverBatches(permitsDir, "travis-permits");
  const countyGroups = manifestGroupInputsFromBatches({
    group: "county",
    dir: countyDir,
    carPrefix: "travis-county",
    batches: countyBatches,
  });
  const permitsGroups = manifestGroupInputsFromBatches({
    group: "property_improvement",
    dir: permitsDir,
    carPrefix: "travis-permits",
    batches: permitsBatches,
  });

  // Coverage: carried from the base, `permits_emitted` recomputed from the permits tables.
  const emitted = publishedRows(permitsGroups, "property_improvement");
  const parcels = publishedRows(countyGroups, "property");
  const countyRows = countyRowCoverage(countyGroups);
  const baseEmitted = base.coverage.permits_emitted?.count;
  // Facts-derived permit-link totals first; an explicit coverageOverrides entry wins.
  const overrides: Record<string, CoverageCount> = {
    ...(facts === null ? {} : permitLinkCoverage(facts)),
    ...((config.coverageOverrides ?? {}) as Record<string, CoverageCount>),
  };
  // A11-10(d): the base's other coverage keys (contractor_*, permits_trade_sub_permit) describe the
  // published permit rows. They are stale when the count moved, and also when an incremental run
  // (facts present: the source changed) rebuilt a permits batch whose archive root the base does
  // not hold, even if the count is unchanged. Then they must be supplied, never carried.
  const baseCarRoots = new Set(base.artifacts.filter((a) => a.kind === "car").map((a) => a.cid));
  const permitsRebuilt = permitsGroups.some((g) => !baseCarRoots.has(g.carRoot));
  const countMoved = emitted.total !== baseEmitted;
  if (countMoved || (facts !== null && permitsRebuilt)) {
    const stale = Object.keys(base.coverage).filter(
      (k) =>
        k !== "permits_emitted" &&
        k !== "parcels_published" &&
        !(k in countyRows) &&
        !(k in overrides),
    );
    if (stale.length > 0) {
      const why = countMoved
        ? `${emitted.total} permits are published but the base manifest recorded ${String(baseEmitted)}; `
        : `the permits group was rebuilt in an incremental run (${emitted.total} permits, the base's count) and its batches differ from the base manifest's; `;
      throw new Error(
        `${why}its other coverage keys no longer apply. Supply coverageOverrides for: ${stale.join(", ")}`,
      );
    }
  }
  const baseNote = base.coverage.permits_emitted?.note ?? "";
  const noteSuffix = baseNote.includes(", ")
    ? baseNote.slice(baseNote.indexOf(", ") + 2)
    : "roofing-classified decided-status permits only";
  const coverage: Record<string, CoverageCount> = {
    ...(base.coverage as Record<string, CoverageCount>),
    ...(overrides as Record<string, CoverageCount>),
    permits_emitted: {
      count: emitted.total,
      derivation: "published_rows",
      note: `${emitted.perBatch}, ${noteSuffix}`,
    },
    // The County group's published property rows; buildManifest() refuses a different count.
    parcels_published: {
      count: parcels.total,
      derivation: "published_rows",
      note: `${parcels.perBatch}, ${PARCELS_BASIS}`,
    },
    // Ownership and coordinates rows of the County group; buildManifest() checks each count.
    ...countyRows,
  };

  // The address-point source belongs to the run that used the layer; it is never carried over.
  const carryPoints = config.carryAddressPoints === true;
  if (carryPoints) {
    if (config.addressPointsReceipt === undefined)
      throw new Error("carryAddressPoints needs addressPointsReceipt");
    if (!base.sources.some((s) => s.name === ADDRESS_POINT_SOURCE))
      throw new Error(
        `carryAddressPoints: the base manifest has no ${ADDRESS_POINT_SOURCE} source`,
      );
  }
  const baseSources = base.sources.filter((s) => carryPoints || s.name !== ADDRESS_POINT_SOURCE);
  const sourceLimits = config.sourceLimitations ?? {};
  for (const name of Object.keys(sourceLimits)) {
    if (!baseSources.some((s) => s.name === name))
      throw new Error(`sourceLimitations names ${name}, which the base manifest does not carry`);
  }
  const dropPrefixes = config.dropLimitationPrefixes ?? [];
  for (const p of dropPrefixes) {
    if (!base.limitations.some((l) => l.startsWith(p)))
      throw new Error(`dropLimitationPrefixes: no carried limitation starts with "${p}"`);
  }
  if (config.contractorCoverage !== undefined) {
    const report = JSON.parse(
      readFileSync(resolvePath(repoRoot, config.contractorCoverage), "utf8"),
    ) as { permits: number; byState: Record<string, number> };
    const STATES = ["resolved", "candidate", "ambiguous", "conflicting", "unresolved"];
    const missing = STATES.filter((s) => typeof report.byState?.[s] !== "number");
    if (missing.length > 0)
      throw new Error(`contractorCoverage has no count for: ${missing.join(", ")}`);
    const sum = STATES.reduce((n, s) => n + (report.byState[s] as number), 0);
    if (sum !== report.permits)
      throw new Error(`contractorCoverage states sum to ${sum}, not its ${report.permits} permits`);
    if (report.permits !== emitted.total)
      throw new Error(
        `contractorCoverage counts ${report.permits} permits but ${emitted.total} are published`,
      );
    for (const state of STATES) {
      const n = report.byState[state];
      const got = coverage[`contractor_${state}`]?.count;
      if (got !== n)
        throw new Error(
          `coverage contractor_${state} is ${String(got)} but contractorCoverage says ${n}`,
        );
    }
  }
  const receiptFor = (name: string): string =>
    resolvePath(
      repoRoot,
      name === ADDRESS_POINT_SOURCE && config.addressPointsReceipt !== undefined
        ? config.addressPointsReceipt
        : name.startsWith("austin")
          ? config.austinReceipt
          : config.tcadReceipt,
    );
  const input: BuildManifestInput = {
    runId: config.runId,
    county: base.county,
    state: base.state,
    fips: base.fips,
    startedAt: config.startedAt,
    finishedAt: config.finishedAt,
    previousManifestCid: config.previousManifestCid,
    runDir: repoRoot,
    groups: [...countyGroups, ...permitsGroups],
    sources: [
      ...baseSources.map((s) => {
        if (facts === null) {
          return {
            name: s.name,
            url: s.url,
            watermark: s.watermark,
            receipts: receiptFor(s.name),
            limitations: [...(sourceLimits[s.name] ?? s.limitations)],
            // No new capture: nothing added, changed or removed since the base run.
            delta: { added: 0, changed: 0, removed: 0 },
          };
        }
        const carried = {
          name: s.name,
          url: s.url,
          receipts: receiptFor(s.name),
          limitations: carriedSourceLimitations(s.limitations),
        };
        if (s.name === ADDRESS_POINT_SOURCE) {
          return {
            ...carried,
            watermark: s.watermark,
            limitations: [...carried.limitations, notRecapturedLimitation(base.runId, s.watermark)],
            delta: { added: 0, changed: 0, removed: 0 },
          };
        }
        return s.name.startsWith("austin")
          ? austinSourceInput(facts, carried)
          : unchangedSourceInput({ ...carried, watermark: s.watermark });
      }),
      ...(config.addressPointsReceipt === undefined || carryPoints
        ? []
        : [addressPointSourceInput(resolvePath(repoRoot, config.addressPointsReceipt))]),
    ],
    profiles: withGazetteerProfile(base.profiles, (deps.gitCommit ?? shortCommit)(repoRoot)),
    coverage,
    ownersRedacted: ownersRedactedOf(base),
    ...(config.registryNote === undefined ? {} : { registryNote: config.registryNote }),
    limitations: [
      ...base.limitations
        .filter((l) => !l.startsWith(DRAFT_LIMITATION_PREFIX))
        .filter((l) => !dropPrefixes.some((p) => l.startsWith(p)))
        // an incremental run is not a correction run: drop the earlier run's own notes
        .filter(
          (l) =>
            facts === null ||
            (!l.startsWith(CORRECTION_NOTE_PREFIX) && !l.startsWith(INCREMENTAL_NOTE_PREFIX)),
        )
        .map((l) => restatePermitRows(l, baseEmitted, emitted.total)),
      config.correctionNote ?? (facts === null ? CORRECTION_NOTE : incrementalRunNote(facts)),
    ],
    repoRoot,
    ...(linkedPermits === undefined ? {} : { linkedPermits }),
    ...(deps.workTreeStatus === undefined ? {} : { workTreeStatus: deps.workTreeStatus }),
  };

  const built = await buildManifest(input);
  // The source facts must come out exactly as the base recorded them, except the Austin source
  // of an incremental run, which must carry the facts' new watermark, total and delta. A layer
  // source first listed by this run has nothing to compare; a carried one must match its base.
  for (const [i, s] of built.manifest.sources.entries()) {
    if (s.name === ADDRESS_POINT_SOURCE && !carryPoints) continue;
    const b = baseSources[i];
    if (facts !== null && s.name.startsWith("austin") && s.name !== ADDRESS_POINT_SOURCE) {
      if (
        s.watermark !== facts.watermarkNew ||
        s.records !== facts.totalAfter ||
        s.captured_at !== facts.capturedAt ||
        s.added !== facts.delta.added ||
        s.changed !== facts.delta.changed ||
        s.removed !== facts.delta.removed
      ) {
        throw new Error(
          `source ${s.name}: the receipt file does not match the incremental facts (watermark, total, captured_at or delta); regenerate both with incremental-facts.ts`,
        );
      }
      continue;
    }
    if (
      b === undefined ||
      s.watermark !== b.watermark ||
      s.records !== b.records ||
      s.captured_at !== b.captured_at
    ) {
      throw new Error(
        `source ${s.name}: watermark/records/captured_at differ from the base manifest, but this run has no new capture`,
      );
    }
  }
  return built;
}

export interface OutputPathOptions {
  repoRoot: string;
  runId: string;
  pilot: boolean;
  /** Pilot only: override the default pilot path. */
  out?: string;
}

function isUnder(parent: string, child: string): boolean {
  const rel = relative(resolve(parent), resolve(child));
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

/**
 * A real run must give the linked-permit total, so buildManifest's permit-link reconciliation
 * (five exclusions + linked = the Austin source's records) always runs; only a trial may omit it.
 */
export function requireLinkedPermits(
  config: Pick<RunManifestConfig, "linkedPermits">,
  pilot: boolean,
): void {
  if (!pilot && config.linkedPermits === undefined)
    throw new Error(
      "a real run needs --linked-permits <n> (linkedPermits in --config): the permit-link reconciliation must run before publishing",
    );
}

/**
 * Where the manifest goes. A real run: `runs/<runId>/manifest.json`, never overridable, and
 * refused when `runs/index.json` already lists the runId. A pilot: the pilot path, and any path
 * under `runs/` is refused.
 */
export function manifestOutputPath(options: OutputPathOptions): string {
  const runsDir = join(options.repoRoot, "runs");
  if (options.pilot) {
    const path = resolvePath(options.repoRoot, options.out ?? PILOT_MANIFEST_PATH);
    if (isUnder(runsDir, path))
      throw new Error(`a pilot manifest is never written under runs/: ${path}`);
    return path;
  }
  if (options.out !== undefined)
    throw new Error(
      "--out is only for --pilot; a real run is written to runs/<runId>/manifest.json",
    );
  const indexPath = join(runsDir, "index.json");
  if (existsSync(indexPath)) {
    const index = parseRunsIndex(readFileSync(indexPath));
    if (index.runs.some((r) => r.runId === options.runId))
      throw new Error(
        `runs/index.json already lists ${options.runId}; a published manifest never changes`,
      );
  }
  return join(runsDir, options.runId, "manifest.json");
}

export type WriteOutcome = "written" | "unchanged";

/**
 * Writes `built.bytes` verbatim (the exact JCS bytes the manifest CID names). An existing file
 * with identical bytes is left alone; one with different bytes is refused unless `overwrite`.
 */
export function writeManifestBytes(
  path: string,
  built: Pick<BuiltManifest, "bytes">,
  overwrite = false,
): WriteOutcome {
  if (existsSync(path)) {
    const existing = readFileSync(path);
    if (Buffer.from(built.bytes).equals(existing)) return "unchanged";
    if (!overwrite)
      throw new Error(`${path} exists with different bytes; pass --overwrite to replace`);
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, built.bytes);
  return "written";
}
