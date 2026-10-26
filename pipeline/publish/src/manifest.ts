// buildManifest(): the run manifest from CLI outputs and capture receipts only (oracle § 5,
// research R-08). No database is read. Part CIDs come from the `CountyTables` block in each
// tables.car and are re-derived from the part files (raw-leaves CIDv1); any mismatch fails.
// A-03: a published run is never the pilot (no pilot runId, no pilot limitation), the sources
// are listed in a fixed order, coverage carries `permits_emitted` (published_rows, checked
// against the published property_improvement rows) and `permits_no_tcad_geoid`
// (aggregate_match), every `car` and `directory` artifact carries `carCid` (AM-05), every table
// part is within the 48m export bound, and the working tree must be clean. The manifest CID is
// the raw-leaves CIDv1 of its RFC 8785 JCS bytes.
// Fixed limitation notes (FR-001, TC-003; plan § "Fixed texts and config keys", verbatim):
// `sources[0].limitations` (Austin) carries `Comptroller baseline not loaded (A-07)` (addendum
// A5: why every permit is `contractor_unresolved`); `sources[1].limitations` (TCAD) carries
// `Confidential owner records redacted (Texas Tax Code §25.025): {n}` with `n` = the run
// summary's `owners_redacted` (P0-15: the redaction precedes `validate`). Each note is added
// once, after the source's own notes.
import { execFileSync } from "node:child_process";
import { createReadStream, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { CarBlockIterator, CarReader } from "@ipld/car";
import * as dagJson from "@ipld/dag-json";
import { CID } from "multiformats/cid";
import { sha256 } from "multiformats/hashes/sha2";
import { z } from "zod";
import {
  PILOT_LIMITATION,
  RunManifestV1,
  type CoverageCount,
  type ManifestArtifact,
  type ManifestProfile,
  type ManifestSource,
} from "@countylens/contract";
import { cidOfBytes, cidOfFile, codecName, sameDigest } from "./cid.js";
import type { SourceDeltaResult } from "./incremental/delta.js";
import { jcsBytes } from "./jcs.js";
import { PART_SIZE, PART_SIZE_BYTES, sha256File, type DataGroup } from "./sequence.js";

/** The display order of `sources[]` (data-model.md): Austin permits first, then TCAD. This is
 *  the known-real source profile for Run 1; it is a plain constant, not a group count, because
 *  sources and groups are independent axes (one source can feed several groups). A future source
 *  (BBB/places) is added here, to SOURCE_ORDER, once it is actually captured — never fabricated
 *  ahead of real provenance (research.md "Manifest builder scaling to 5 data groups"). */
export const SOURCE_ORDER = ["austin-3syk-w9eu", "tcad-2026-certified-json"] as const;

/** A-11 Run 3 (ADR 0004): the City of Austin address-point layer. An optional third source,
 *  named only by a run that really used it (it feeds County coordinates). It always follows
 *  SOURCE_ORDER; a run without it still lists exactly SOURCE_ORDER. */
export const ADDRESS_POINT_SOURCE = "austin-address-points" as const;
export const ADDRESS_POINT_LIMITATION =
  "Public coordinates for accounts without a GIS point come from the City of Austin address-point layer only when the situs matches exactly one point on house number and street and the point lies inside the Travis County box (ADR 0004); no geocoder, nearest or fuzzy match is used, and a GIS centroid is never replaced. The layer carries no ZIP or city, so an address shared by two cities stays unmatched.";

/**
 * County-group coverage keys counted from published rows, like `parcels_published`: the key, the
 * County table whose rows it counts, and the basis stated in its note. Ownership keys start with
 * `owner_` and coordinates with `coordinates_`, so the Coverage page files them under those
 * kinds. They are new keys: owner_unparsed / owner_confidential / owner_no_record are read by
 * query-core's owner_gap_reason and keep their meaning. Checked, not required, when present.
 */
export const COUNTY_ROW_COVERAGE: ReadonlyArray<{
  readonly key: string;
  readonly table: string;
  readonly basis: string;
}> = [
  {
    key: "owner_sales_published",
    table: "sales_history",
    basis:
      "County `sales_history` rows: the TCAD sale and deed records of the published properties",
  },
  {
    key: "owner_persons_published",
    table: "person",
    basis:
      "County `person` rows: owners whose name splits into a person, linked to their property through person_has_property",
  },
  {
    key: "owner_companies_published",
    table: "company",
    basis:
      "County `company` rows: owners whose name reads as a company, linked to their property through company_has_property",
  },
  {
    key: "coordinates_published",
    table: "geometry",
    basis:
      "County `geometry` rows, each linked to one parcel through parcel_has_geometry; a parcel without one has no coordinates",
  },
];

/**
 * The required coverage keys per data group (AD-05's five contractor states; data-model.md's
 * three derivations: `published_rows`, `capture_receipt`, `aggregate_match`). `checkInput`
 * requires exactly the union of these for the groups actually present in `input.groups` — never
 * "anything goes": a present group's key missing, or an absent group's key supplied, both throw.
 * This is the per-run profile T004/T009 widen from the old hardcoded 2-item tuple.
 */
export const GROUP_COVERAGE_KEYS: Record<
  DataGroup,
  ReadonlyArray<readonly [string, CoverageCount["derivation"]]>
> = {
  // No coverage key of its own: the county group is the parcel backbone, not a counted metric
  // (A-03 status quo, kept unchanged so the walking-skeleton fixtures keep passing). Owner and
  // parcel geometry are already embedded fields inside county's per-record export — not a
  // separately counted coverage key (corrected 2026-10-23; see sequence.ts's DataGroup comment).
  county: [],
  // (county's `parcels_published` is checked, not required, when present: see buildManifest.)
  property_improvement: [
    ["permits_emitted", "published_rows"],
    // CR-A-11-porygon finding 2: `permits_no_tcad_geoid` alone left 4 of A-04's 5
    // permit-to-parcel-link `UnmatchedReason`s (travis/permits/link.ts) with no coverage key at
    // all, so captured - emitted could legitimately differ by hundreds of thousands of rows with
    // the manifest naming only part of why. All 5 reasons are now labeled, same convention
    // (`permits_<reason>`, `aggregate_match`).
    ["permits_no_tcad_geoid", "aggregate_match"],
    ["permits_no_tcad_id", "aggregate_match"],
    ["permits_ambiguous_geoid", "aggregate_match"],
    ["permits_address_unmatched", "aggregate_match"],
    ["permits_ambiguous_address", "aggregate_match"],
    // AD-05's five contractor-identity states (A-07). These three are required in every run;
    // a run that resolved its published names against the loaded registry (Run 3.1, ERR-73)
    // also states contractor_ambiguous and contractor_conflicting. Run-level counts only: no
    // per-permit state is published (ADR-0002 #6, AD-06). Producers: run-month.ts's
    // `contractorCoverage` for a monthly run, pipeline/local-stack/scripts/contractor-coverage.ts
    // for a re-export.
    ["contractor_resolved", "aggregate_match"],
    ["contractor_candidate", "aggregate_match"],
    ["contractor_unresolved", "aggregate_match"],
  ],
};

/**
 * The coverage keys required for exactly `groups` (order-independent; T004/T009 profile). Groups
 * are deduped first: a group split into N batches (full-county scale, S6a.2) still names its own
 * keys once, never once per batch — the per-run profile is about which groups are present, not
 * how many CARs carry each one.
 */
export function requiredCoverageKeys(
  groups: readonly DataGroup[],
): ReadonlyArray<readonly [string, CoverageCount["derivation"]]> {
  return [...new Set(groups)].flatMap((g) => GROUP_COVERAGE_KEYS[g]);
}

/** The Austin source's fixed limitation note (addendum A5; plan § "Fixed texts"). */
export const COMPTROLLER_LIMITATION = "Comptroller baseline not loaded (A-07)";

/** The TCAD source's fixed limitation note (P0-15; plan § "Fixed texts"); `n` = owners_redacted. */
export function confidentialLimitation(ownersRedacted: number): string {
  return `Confidential owner records redacted (Texas Tax Code §25.025): ${ownersRedacted}`;
}

/**
 * The fixed note of a source in SOURCE_ORDER. `registryNote` replaces the Austin source's
 * "baseline not loaded" note for a run that did resolve against the loaded registry (ERR-73).
 */
function fixedLimitation(name: string, ownersRedacted: number, registryNote?: string): string {
  switch (name) {
    case SOURCE_ORDER[0]:
      return registryNote ?? COMPTROLLER_LIMITATION;
    case SOURCE_ORDER[1]:
      return confidentialLimitation(ownersRedacted);
    case ADDRESS_POINT_SOURCE:
      return ADDRESS_POINT_LIMITATION;
    default:
      throw new Error(`no fixed limitation note for source ${name}`);
  }
}

const RUN_ID = /^[a-z0-9][a-z0-9-]*$/;

export interface ManifestGroupInput {
  group: DataGroup;
  carPath: string;
  /** Archive root printed by `hash`. */
  carRoot: string;
  tablesDir: string;
  /** Tables root printed by `export-tables`. */
  tablesRoot: string;
  tablesExportJson: string;
}

export interface ManifestSourceInput {
  name: string;
  url: string;
  watermark: string | null;
  /** A `.jsonl` of capture receipts, or a `.json` receipt with `captured_at` and `records`. */
  receipts: string;
  limitations: string[];
  /**
   * The source's added/changed/removed counts (data-model.md's `SourceDelta.delta`), supplied by
   * `incremental/delta.ts`'s `computeSourceDelta` for an incremental run (T017/T018). Omitted for
   * Run 1 — or any caller not yet wired to the delta computation (e.g. upload.ts's `manifestInput`,
   * out of this wave's file ownership) — which keeps A-03's walking-skeleton default: everything
   * this capture reports is new (`added: records, changed: 0, removed: 0`). Never invented by
   * `source()`: when supplied, its three counts are used verbatim.
   */
  delta?: { added: number; changed: number; removed: number };
}

/**
 * Builds the `delta` (and merges the limitations) a `ManifestSourceInput` needs from T017's
 * `SourceDeltaResult` (T018/T019 wiring): the delta's own `added`/`changed`/`removed` verbatim,
 * and its own limitations (e.g. `NO_NEWER_EXPORT`, `RESTAMP_LIMITATION`) appended after any
 * caller-supplied notes — the same "add once, after the source's own notes" rule `source()`
 * already applies to the fixed Austin/TCAD notes. Never invents a count or a reason: everything
 * here comes from the delta result the caller already computed.
 */
export function sourceInputFromDelta(
  result: Pick<SourceDeltaResult, "watermark" | "delta" | "limitations">,
  base: { name: string; url: string; receipts: string; limitations?: string[] },
): ManifestSourceInput {
  return {
    name: base.name,
    url: base.url,
    watermark: result.watermark,
    receipts: base.receipts,
    limitations: [...(base.limitations ?? []), ...result.limitations],
    delta: { ...result.delta },
  };
}

export interface BuildManifestInput {
  runId: string;
  county: string;
  state: string;
  fips: string;
  startedAt: string;
  finishedAt: string;
  previousManifestCid: string | null;
  /** Artifact names are paths relative to this directory. */
  runDir?: string;
  /** @deprecated A-02 name of `runDir`, kept while travis/pilot/run-pilot.ts calls it. */
  pilotDir?: string;
  groups: ManifestGroupInput[];
  sources: ManifestSourceInput[];
  profiles: ManifestProfile[];
  coverage: Record<string, CoverageCount>;
  /**
   * The run summary's `owners_redacted`: TCAD confidentiality redactions applied before
   * `validate` (P0-15). Written into the TCAD source's limitation note; never defaulted.
   */
  ownersRedacted: number;
  /**
   * The Austin source's registry note when the run resolved its permits against the loaded
   * Comptroller registry (ERR-73); omitted, the note says the baseline is not loaded.
   */
  registryNote?: string;
  limitations: string[];
  /**
   * A-16 #6: how many captured Austin permits linked to a TCAD property (Query DB). It is not
   * published (no manifest field carries it). When given and the five permit-link exclusion keys
   * are present, `exclusions + linkedPermits` must equal the Austin source's `records`.
   */
  linkedPermits?: number;
  /** Where `git status` runs (default: the current directory). */
  repoRoot?: string;
  /** `git status --porcelain --untracked-files=no` output; injectable for tests. */
  workTreeStatus?: (repoRoot: string) => string;
}

export interface BuiltManifest {
  manifest: RunManifestV1;
  /** The exact JCS bytes to write and commit. */
  bytes: Uint8Array;
  cid: string;
}

const CidLink = z.custom<CID>((v) => CID.asCID(v) !== null, "expected a CID link");

const CountyTablesBlock = z.object({
  label: z.literal("CountyTables"),
  version: z.number().int(),
  county_root: CidLink,
  part_size_bytes: z.number().int().positive(),
  codec: z.string(),
  tables: z.record(
    z.string(),
    z.object({
      rows: z.number().int().nonnegative(),
      parts: z.array(
        z.object({
          cid: CidLink,
          rows: z.number().int().nonnegative(),
          bytes: z.number().int().nonnegative(),
        }),
      ),
    }),
  ),
});

const TablesExportSummary = z.object({
  root: z.string(),
  countyRoot: z.string(),
  tables: z.record(z.string(), z.object({ rows: z.number().int(), parts: z.number().int() })),
});

const Receipt = z.object({ captured_at: z.string(), outcome: z.string().optional() }).loose();
const ReceiptFile = z
  .object({ captured_at: z.string(), records: z.union([z.number().int(), z.array(z.unknown())]) })
  .loose();

/** The roots in a CAR header (read lazily: the blocks are not walked). */
export async function carRoots(path: string): Promise<CID[]> {
  const stream = createReadStream(path);
  try {
    const it = await CarBlockIterator.fromIterable(stream);
    return await it.getRoots();
  } finally {
    stream.destroy();
  }
}

async function fileArtifact(
  runDir: string,
  path: string,
  kind: ManifestArtifact["kind"],
  cid: string,
): Promise<ManifestArtifact> {
  return {
    name: relative(runDir, path),
    cid,
    codec: codecName(cid),
    size: statSync(path).size,
    sha256: await sha256File(path),
    kind,
  };
}

interface GroupArtifacts {
  artifacts: ManifestArtifact[];
  /** Rows per table, from the CountyTables block (what the published Parquet holds). */
  rows: Record<string, number>;
}

async function groupArtifacts(runDir: string, g: ManifestGroupInput): Promise<GroupArtifacts> {
  const [carRoot] = await carRoots(g.carPath);
  if (!carRoot || carRoot.toString() !== g.carRoot) {
    throw new Error(
      `${g.group}: archive root ${carRoot?.toString()} in ${g.carPath} is not the hash root ${g.carRoot}`,
    );
  }
  const tablesCar = join(g.tablesDir, "tables.car");
  const reader = await CarReader.fromIterable(createReadStream(tablesCar));
  const [tablesRoot] = await reader.getRoots();
  if (!tablesRoot || tablesRoot.toString() !== g.tablesRoot) {
    throw new Error(
      `${g.group}: tables root ${tablesRoot?.toString()} in ${tablesCar} is not the printed root ${g.tablesRoot}`,
    );
  }
  const block = await reader.get(tablesRoot);
  if (!block) throw new Error(`${g.group}: tables.car has no block for its root`);
  const recomputed = CID.create(1, dagJson.code, await sha256.digest(block.bytes));
  if (!recomputed.equals(tablesRoot))
    throw new Error(`${g.group}: tables root block does not hash to its CID`);
  const countyTables = CountyTablesBlock.parse(dagJson.decode(block.bytes));
  if (!sameDigest(countyTables.county_root.toString(), g.carRoot)) {
    throw new Error(
      `${g.group}: CountyTables county_root ${countyTables.county_root.toString()} is not the CAR root ${g.carRoot}`,
    );
  }
  if (countyTables.part_size_bytes !== PART_SIZE_BYTES) {
    throw new Error(
      `${g.group}: tables.car part_size_bytes ${countyTables.part_size_bytes} is not --part-size ${PART_SIZE} (${PART_SIZE_BYTES})`,
    );
  }
  const summary = TablesExportSummary.parse(JSON.parse(readFileSync(g.tablesExportJson, "utf8")));
  if (summary.root !== g.tablesRoot)
    throw new Error(`${g.group}: tables root in ${g.tablesExportJson} differs`);
  if (summary.countyRoot !== g.carRoot)
    throw new Error(`${g.group}: countyRoot in ${g.tablesExportJson} differs`);

  const tables: ManifestArtifact[] = [];
  const rows: Record<string, number> = {};
  for (const [name, table] of Object.entries(countyTables.tables)) {
    const listed = summary.tables[name];
    if (!listed || listed.rows !== table.rows || listed.parts !== table.parts.length) {
      throw new Error(
        `${g.group}: table ${name} rows/parts disagree between tables.car and the export summary`,
      );
    }
    rows[name] = table.rows;
    for (const [i, part] of table.parts.entries()) {
      if (part.bytes > PART_SIZE_BYTES) {
        throw new Error(
          `${g.group}: table ${name} part ${i} is ${part.bytes} bytes, above the --part-size ${PART_SIZE} bound (${PART_SIZE_BYTES})`,
        );
      }
      const file = join(g.tablesDir, name, `part-${String(i).padStart(5, "0")}.parquet`);
      const derived = await cidOfFile(file);
      if (derived !== part.cid.toString()) {
        throw new Error(
          `${g.group}: part CID mismatch for ${file}: tables.car ${part.cid.toString()}, file ${derived}`,
        );
      }
      const artifact = await fileArtifact(runDir, file, "table", derived);
      if (artifact.size !== part.bytes)
        throw new Error(
          `${g.group}: ${file} is ${artifact.size} bytes, tables.car says ${part.bytes}`,
        );
      tables.push(artifact);
    }
  }
  // Code-unit order: byte-stable across locales (code-review #5).
  tables.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const directory: ManifestArtifact = {
    name: relative(runDir, g.tablesDir),
    cid: g.tablesRoot,
    codec: codecName(g.tablesRoot),
    size: statSync(tablesCar).size,
    sha256: await sha256File(tablesCar),
    kind: "directory",
    carCid: await cidOfFile(tablesCar),
  };
  // AM-05: the .car file is also added to IPFS as a plain raw-leaves file; carCid is that CID,
  // so verify-manifest can check the file's size and SHA-256 (its `cid` is the DAG root).
  const car: ManifestArtifact = {
    ...(await fileArtifact(runDir, g.carPath, "car", g.carRoot)),
    carCid: await cidOfFile(g.carPath),
  };
  return { artifacts: [car, directory, ...tables], rows };
}

/** The source entry, with its fixed limitation note added once after the source's own notes. */
function source(input: ManifestSourceInput, fixedNote: string): ManifestSource {
  const text = readFileSync(input.receipts, "utf8");
  let records: number;
  let capturedAt: string;
  if (input.receipts.endsWith(".jsonl")) {
    const rows = text
      .split("\n")
      .filter((l) => l.trim() !== "")
      .map((l) => Receipt.parse(JSON.parse(l)));
    const ok = rows.filter(
      (r) => r.outcome === undefined || r.outcome === "ok" || r.outcome === "throttled-then-ok",
    );
    if (ok.length === 0)
      throw new Error(`${input.name}: no successful capture receipt in ${input.receipts}`);
    records = ok.length;
    capturedAt = ok
      .map((r) => r.captured_at)
      .sort()
      .at(-1) as string;
  } else {
    const receipt = ReceiptFile.parse(JSON.parse(text));
    records = typeof receipt.records === "number" ? receipt.records : receipt.records.length;
    capturedAt = receipt.captured_at;
  }
  // T018: explicit added/changed/removed when the caller supplies a delta (incremental runs,
  // via sourceInputFromDelta/computeSourceDelta); otherwise A-03's walking-skeleton default —
  // the first run of this contract, where everything this capture reports is new.
  const delta = input.delta ?? { added: records, changed: 0, removed: 0 };
  // A run that states its own registry note (ERR-73) drops a carried "baseline not loaded" note,
  // so the two never stand side by side.
  const carried =
    fixedNote !== COMPTROLLER_LIMITATION
      ? input.limitations.filter((l) => l !== COMPTROLLER_LIMITATION)
      : [...input.limitations];
  return {
    name: input.name,
    url: input.url,
    watermark: input.watermark,
    captured_at: capturedAt,
    records,
    added: delta.added,
    changed: delta.changed,
    removed: delta.removed,
    limitations: carried.includes(fixedNote) ? carried : [...carried, fixedNote],
  };
}

function gitStatus(repoRoot: string): string {
  return execFileSync("git", ["status", "--porcelain", "--untracked-files=no"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
}

/** Checks that need no file: identity, source order, coverage shape, clean tree. */
function checkInput(input: BuildManifestInput): void {
  if (!RUN_ID.test(input.runId))
    throw new Error(`runId "${input.runId}" must match ${RUN_ID.source}`);
  if (input.runId.includes("pilot"))
    throw new Error(`runId "${input.runId}" names the pilot; a published run is never the pilot`);
  if (input.limitations.includes(PILOT_LIMITATION))
    throw new Error("a published run carries no pilot limitation");
  // P0-15: the redaction count is stated, never assumed; a missing or malformed count fails.
  if (!Number.isInteger(input.ownersRedacted) || input.ownersRedacted < 0) {
    throw new Error(
      `ownersRedacted (the run summary's owners_redacted) must be a non-negative integer, got ${String(input.ownersRedacted)}`,
    );
  }
  const names = input.sources.map((s) => s.name);
  const expected: readonly string[] = names.includes(ADDRESS_POINT_SOURCE)
    ? [...SOURCE_ORDER, ADDRESS_POINT_SOURCE]
    : SOURCE_ORDER;
  if (names.length !== expected.length || names.some((n, i) => n !== expected[i])) {
    throw new Error(
      `sources must be exactly, in order: ${SOURCE_ORDER.join(", ")} (optionally followed by ${ADDRESS_POINT_SOURCE}); got ${names.join(", ") || "none"}`,
    );
  }
  const required = requiredCoverageKeys(input.groups.map((g) => g.group));
  for (const [key, derivation] of required) {
    const count = input.coverage[key];
    if (!count) throw new Error(`coverage.${key} is required for group(s) in this run`);
    if (count.derivation !== derivation)
      throw new Error(
        `coverage.${key}.derivation must be "${derivation}", not "${count.derivation}"`,
      );
  }
  const status = (input.workTreeStatus ?? gitStatus)(input.repoRoot ?? process.cwd()).trim();
  if (status !== "") throw new Error(`working tree is dirty; commit before publishing:\n${status}`);
}

export const PERMIT_EXCLUSION_KEYS = [
  "permits_no_tcad_geoid",
  "permits_no_tcad_id",
  "permits_ambiguous_geoid",
  "permits_address_unmatched",
  "permits_ambiguous_address",
] as const;

/**
 * A-16 #6: every captured Austin permit is either linked or excluded for exactly one of the five
 * reasons. Checked only when all five exclusion keys and a linked total are available; throws
 * with the numbers otherwise-wrong.
 */
export function assertPermitLinkReconciliation(args: {
  coverage: Record<string, CoverageCount>;
  linkedPermits: number | undefined;
  austinRecords: number;
}): void {
  const { coverage, linkedPermits, austinRecords } = args;
  if (linkedPermits === undefined) return;
  // Given a linked total, the check must run: a missing key is a failure, never a silent skip.
  const missing = PERMIT_EXCLUSION_KEYS.filter((k) => coverage[k] === undefined);
  if (missing.length > 0)
    throw new Error(
      `permit link reconciliation cannot run: coverage lacks ${missing.join(", ")} (linkedPermits ${linkedPermits} was given)`,
    );
  if (!Number.isInteger(linkedPermits) || linkedPermits < 0)
    throw new Error(`linkedPermits must be a non-negative integer, got ${String(linkedPermits)}`);
  const excluded = PERMIT_EXCLUSION_KEYS.reduce(
    (n, k) => n + (coverage[k] as CoverageCount).count,
    0,
  );
  if (excluded + linkedPermits !== austinRecords) {
    throw new Error(
      `permit link reconciliation failed: excluded ${excluded} (${PERMIT_EXCLUSION_KEYS.map((k) => `${k} ${(coverage[k] as CoverageCount).count}`).join(", ")}) + linked ${linkedPermits} = ${excluded + linkedPermits}, but the Austin source records ${austinRecords}`,
    );
  }
}

export async function buildManifest(input: BuildManifestInput): Promise<BuiltManifest> {
  const runDir = input.runDir ?? input.pilotDir;
  if (!runDir) throw new Error("runDir is required");
  checkInput(input);
  const artifacts: ManifestArtifact[] = [];
  // S6a.2: `input.groups` is N CARs per data group at full-county scale (AD-0001's batching —
  // 10 for `county`, 2 for `property_improvement` in Run 1), not the A-03 pilot's one-CAR
  // assumption. Every batch's artifacts are kept (never overwritten); each table's rows are
  // summed across every batch of the same group, so a published-rows coverage check (e.g.
  // `permits_emitted`) sees the group's true total, not just its last batch's.
  const rows = new Map<DataGroup, Record<string, number>>();
  for (const g of input.groups) {
    const built = await groupArtifacts(runDir, g);
    artifacts.push(...built.artifacts);
    const existing = rows.get(g.group) ?? {};
    for (const [table, count] of Object.entries(built.rows)) {
      existing[table] = (existing[table] ?? 0) + count;
    }
    rows.set(g.group, existing);
  }
  // `published_rows`: the count is literally the number of published property_improvement rows.
  // Only checked when this run actually includes the property_improvement group (T004/T009's
  // per-group profile: a run of, say, county+owner alone never needs permits_emitted).
  if (input.groups.some((g) => g.group === "property_improvement")) {
    const published = rows.get("property_improvement")?.property_improvement;
    const emitted = input.coverage.permits_emitted as CoverageCount;
    if (published === undefined)
      throw new Error("coverage.permits_emitted needs the property_improvement group's table");
    if (emitted.count !== published) {
      throw new Error(
        `coverage.permits_emitted.count ${emitted.count} is not the number of published property_improvement rows (${published})`,
      );
    }
  }
  // `parcels_published` (published_rows): the number of County `property` rows across all county
  // batches. Optional so older manifests and walking-skeleton inputs stay valid, but when a
  // county group is built and the key is given it must equal the published rows, like permits.
  const parcels = input.coverage.parcels_published;
  if (parcels !== undefined) {
    const published = rows.get("county")?.property;
    if (published === undefined)
      throw new Error("coverage.parcels_published needs the county group's property table");
    if (parcels.derivation !== "published_rows")
      throw new Error(
        `coverage.parcels_published.derivation must be "published_rows", not "${parcels.derivation}"`,
      );
    if (parcels.count !== published) {
      throw new Error(
        `coverage.parcels_published.count ${parcels.count} is not the number of published county property rows (${published})`,
      );
    }
  }
  // The ownership and coordinates counts (COUNTY_ROW_COVERAGE): same rule as parcels_published.
  for (const { key, table } of COUNTY_ROW_COVERAGE) {
    const given = input.coverage[key];
    if (given === undefined) continue;
    const published = rows.get("county")?.[table];
    if (published === undefined)
      throw new Error(`coverage.${key} needs the county group's ${table} table`);
    if (given.derivation !== "published_rows")
      throw new Error(
        `coverage.${key}.derivation must be "published_rows", not "${given.derivation}"`,
      );
    if (given.count !== published)
      throw new Error(
        `coverage.${key}.count ${given.count} is not the number of published county ${table} rows (${published})`,
      );
  }
  const manifest = RunManifestV1.parse({
    schema: "oracle-travis-run-manifest.v1",
    runId: input.runId,
    county: input.county,
    state: input.state,
    fips: input.fips,
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    previousManifestCid: input.previousManifestCid,
    sources: input.sources.map((s) =>
      source(s, fixedLimitation(s.name, input.ownersRedacted, input.registryNote)),
    ),
    artifacts,
    profiles: input.profiles,
    coverage: input.coverage,
    limitations: input.limitations,
  });
  const austin = manifest.sources.find((s) => s.name === SOURCE_ORDER[0]);
  if (!austin && input.linkedPermits !== undefined)
    throw new Error(
      `permit link reconciliation cannot run: no ${SOURCE_ORDER[0]} source in the manifest`,
    );
  if (austin)
    assertPermitLinkReconciliation({
      coverage: input.coverage,
      linkedPermits: input.linkedPermits,
      austinRecords: austin.records,
    });
  const bytes = jcsBytes(manifest);
  return { manifest, bytes, cid: await cidOfBytes(bytes) };
}

/**
 * A data group split into N batches at full-county scale (AD-0001's batching:
 * `pipeline/publish/scripts/split-into-batches.py` + `batch-hash-validate-export.sh` — 10 for
 * Run 1's `county`, 2 for its `property_improvement`). Their fixed layout under `dir`:
 * `cars/<carPrefix>-bNN.car` and `tables/bNN/` + `tables/bNN-export.json`, `NN` zero-padded to 2
 * digits. T013's original stub assumed a single dry run directory for every group; corrected at
 * S6a.2, now that the real batched output exists and spans more than one run directory per group
 * (`dir` is passed per group, not assumed shared).
 */
export interface BatchedGroupDirs {
  group: DataGroup;
  /** Directory containing this group's `cars/` and `tables/` batch subdirectories. */
  dir: string;
  /** The CAR file prefix before `-bNN`, e.g. `travis-county`. */
  carPrefix: string;
  /** Batch numbers to include, in the order they should appear (e.g. `[1, 2, ..., 10]`). */
  batches: readonly number[];
}

/**
 * Builds one `ManifestGroupInput` per batch from `BatchedGroupDirs`'s fixed layout (T013/T017
 * wave-2 wiring, closed at S6a.2: `buildManifest()` itself now sums rows across batches of the
 * same group; this is the glue that turns N on-disk batch directories into the
 * `ManifestGroupInput[]` it expects). The CAR root and tables root are read verbatim from each
 * batch's own `export-tables --output-json` summary (its `countyRoot`/`root` fields) — never
 * recomputed, guessed, or taken from a differently-named file — so this is pure path/JSON
 * plumbing over `elephant-cli`'s own printed output, not a new source of truth. `buildManifest`'s
 * own checks (CAR root vs `CountyTables.county_root`, tables root vs the block's own hash, every
 * part's CID and size) still re-verify every one of these batches against the real files.
 */
export function manifestGroupInputsFromBatches(spec: BatchedGroupDirs): ManifestGroupInput[] {
  return spec.batches.map((n) => {
    const b = String(n).padStart(2, "0");
    const tablesExportJson = join(spec.dir, "tables", `b${b}-export.json`);
    const summary = TablesExportSummary.parse(JSON.parse(readFileSync(tablesExportJson, "utf8")));
    return {
      group: spec.group,
      carPath: join(spec.dir, "cars", `${spec.carPrefix}-b${b}.car`),
      carRoot: summary.countyRoot,
      tablesDir: join(spec.dir, "tables", `b${b}`),
      tablesRoot: summary.root,
      tablesExportJson,
    };
  });
}
