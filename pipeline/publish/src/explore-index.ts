// A-16 T003 (AC-13, ADR-0001 Amendment 1): the per-run Explore index, frozen interface and pure
// planning. The index is the four contract/v1 views (`v_property`, `v_roofing_permit`,
// `v_contractor`, `v_run`) materialised to Parquet with exactly the published columns, plus an
// `index.json` written LAST that binds it to the run's CID-verified manifest: every source part's
// name, CID and SHA-256, the SHA-256 of the view SQL it was built with, and the batch coverage
// that proves no export batch was skipped. Private derived data under
// `s3://<CID-copy bucket>/private/explore-index/<manifestCid>/`, never published or pinned.
//
// Pure module (AD-19: no DuckDB in pipeline/publish/src): key layout, the Zod descriptor, the part
// plan (query-core `boundPartNames`, the same selection bindManifest reads), the batch-coverage
// hard stop ported from Task B (`apps/sync/src/batchCoverage.ts`), the source-part check and the
// upload decision. The DuckDB work lives in scripts/build-explore-index.ts.
import { createHash } from "node:crypto";
import { z } from "zod";
import { CidV1, type RunManifestV1 } from "@countylens/contract";
import {
  CONTRACT_VIEWS,
  VIEWS_SQL,
  boundPartNames,
  tablesForViews,
  type BoundTable,
  type ContractView,
} from "@countylens/query-core";

/** `index.json`'s `schema` value. A reader refuses any other (index_stale). */
export const EXPLORE_INDEX_SCHEMA = "countylens-explore-index.v1";
/** Default `EXPLORE_INDEX_PREFIX` (frozen-interfaces.md). */
// Must equal infra/src/config.ts EXPLORE_INDEX_PREFIX, the folder the API reads (2026-10-26: the
// bridge built without --prefix and would have written the index where the API never looks).
export const EXPLORE_INDEX_PREFIX = "private/explore-index/v1.3/";
/** The four views, in CONTRACT_VIEWS order; one Parquet file each. */
export const EXPLORE_INDEX_VIEWS: readonly ContractView[] = CONTRACT_VIEWS;
export const INDEX_JSON = "index.json";
/** Cost gate default: stop before fetching more than this from the CID copy (design § 1). */
export const DEFAULT_MAX_FETCH_GB = 2;

/** `private/<name>/` plus an optional views-version folder (`v1.2/`); nothing else. */
const PREFIX = /^private\/[a-z0-9-]+\/(?:v[0-9]+(?:\.[0-9]+)*\/)?$/;
const SHA256 = /^[0-9a-f]{64}$/;

/** SHA-256 hex of the view SQL the index was materialised with (query-core VIEWS_SQL). */
export function viewsSha256(sql: string = VIEWS_SQL): string {
  return createHash("sha256").update(sql, "utf8").digest("hex");
}

export interface IndexKeys {
  readonly prefix: string;
  readonly indexJson: string;
  readonly files: Readonly<Record<ContractView, string>>;
}

/** `<prefix><manifestCid>/{index.json, v_*.parquet}`; refuses a prefix outside `private/<name>/`
 *  and anything but a base32 CIDv1, so no key can escape the private prefix. */
export function indexKeys(prefix: string, manifestCid: string): IndexKeys {
  if (!PREFIX.test(prefix))
    throw new Error(`explore index prefix ${prefix} is not private/<name>/[v<version>/]`);
  const cid = CidV1.parse(manifestCid);
  const root = `${prefix}${cid}/`;
  const files = Object.fromEntries(
    EXPLORE_INDEX_VIEWS.map((v) => [v, `${root}${v}.parquet`]),
  ) as Record<ContractView, string>;
  return { prefix: root, indexJson: `${root}${INDEX_JSON}`, files };
}

export const IndexFile = z
  .object({
    key: z.string().min(1),
    sha256: z.string().regex(SHA256),
    bytes: z.number().int().nonnegative(),
    rows: z.number().int().nonnegative(),
  })
  .strict();
export type IndexFile = z.infer<typeof IndexFile>;

export const SourcePart = z
  .object({ name: z.string().min(1), cid: CidV1, sha256: z.string().regex(SHA256) })
  .strict();
export type SourcePart = z.infer<typeof SourcePart>;

export const BatchCoverage = z
  .object({
    batchesListed: z.number().int().nonnegative(),
    unboundBatches: z.array(z.string()),
    emptyCountyBatches: z.array(z.string()),
  })
  .strict();
export type BatchCoverage = z.infer<typeof BatchCoverage>;

/** A14-7: the raw permit table against what `v_roofing_permit` keeps. `v_roofing_permit` inner-
 *  joins a permit to a published property (meta.permit), so roofing replacements with no property
 *  row are dropped there; the header says how many, instead of hiding it. */
export const PermitCounts = z
  .object({
    /** Rows of property_improvement.property_improvement (every permit kind). */
    rawPermitRows: z.number().int().nonnegative(),
    /** Distinct permit CIDs of that table. */
    rawPermitCids: z.number().int().nonnegative(),
    /** Distinct raw permit CIDs with improvement_type Roofing and action Replacement. */
    rawRoofingReplacementCids: z.number().int().nonnegative(),
    /** Rows of meta.permit: permits linked to a published property. */
    linkedPermitRows: z.number().int().nonnegative(),
    /** Rows of v_roofing_permit. */
    roofingPermitRows: z.number().int().nonnegative(),
    /** rawRoofingReplacementCids − distinct permit CIDs of v_roofing_permit. */
    roofingWithoutPropertyRow: z.number().int(),
  })
  .strict();
export type PermitCounts = z.infer<typeof PermitCounts>;

/** Whether this run publishes the owner's area at all (`owner_area_class` other than unknown). */
export const OwnerArea = z
  .object({ knownRows: z.number().int().nonnegative(), published: z.boolean() })
  .strict();
export type OwnerArea = z.infer<typeof OwnerArea>;

export const IndexDescriptor = z
  .object({
    schema: z.literal(EXPLORE_INDEX_SCHEMA),
    manifestCid: CidV1,
    runId: z.string().min(1),
    /** The manifest's finishedAt (the views' as_of): the reader's BoundRun.asOf. */
    asOf: z.string().min(1),
    viewsSha256: z.string().regex(SHA256),
    profileSha256: z.string().min(1),
    builder: z.object({ gitSha: z.string().min(1), duckdb: z.string().min(1) }).strict(),
    builtAt: z.iso.datetime(),
    files: z
      .object({
        v_property: IndexFile,
        v_roofing_permit: IndexFile,
        v_contractor: IndexFile,
        v_run: IndexFile,
      })
      .strict(),
    sourceParts: z.array(SourcePart).min(1),
    batchCoverage: BatchCoverage,
    permitCounts: PermitCounts,
    ownerArea: OwnerArea,
  })
  .strict();
export type IndexDescriptor = z.infer<typeof IndexDescriptor>;

export interface PlannedPart {
  readonly name: string;
  readonly cid: string;
  readonly sha256: string;
  readonly size: number;
}

/** Exactly the table parts bindManifest reads for the four views (same rule, same order). */
export function planSourceParts(manifest: Pick<RunManifestV1, "artifacts">): PlannedPart[] {
  const needed = new Set(boundPartNames(manifest.artifacts, EXPLORE_INDEX_VIEWS));
  return manifest.artifacts
    .filter((a) => a.kind === "table" && needed.has(a.name))
    .map((a) => ({ name: a.name, cid: a.cid, sha256: a.sha256, size: a.size }));
}

/** Cost gate (design § 1): the bytes to fetch, refused above `maxGb`. */
export function fetchBudget(
  parts: readonly PlannedPart[],
  maxGb: number = DEFAULT_MAX_FETCH_GB,
): { bytes: number; ok: boolean; message: string } {
  const bytes = parts.reduce((sum, p) => sum + p.size, 0);
  const gb = bytes / 1e9;
  const ok = gb <= maxGb;
  return {
    bytes,
    ok,
    message: `${parts.length} parts, ${(bytes / 1e6).toFixed(1)} MB to fetch${ok ? "" : ` — above the ${maxGb} GB ceiling (--max-fetch-gb)`}`,
  };
}

/** Problems with `sourceParts` against the manifest: each must be a manifest table artifact with
 *  the same CID and SHA-256, and the set must equal the plan exactly. Empty = valid. */
export function checkSourceParts(
  sourceParts: readonly SourcePart[],
  manifest: Pick<RunManifestV1, "artifacts">,
): string[] {
  const problems: string[] = [];
  const artifacts = new Map(
    manifest.artifacts.filter((a) => a.kind === "table").map((a) => [a.name, a]),
  );
  for (const p of sourceParts) {
    const a = artifacts.get(p.name);
    if (a === undefined) problems.push(`${p.name}: not a table artifact of the manifest`);
    else if (a.cid !== p.cid || a.sha256 !== p.sha256)
      problems.push(`${p.name}: cid/sha256 differ from the manifest`);
  }
  const planned = new Set(planSourceParts(manifest).map((p) => p.name));
  const given = new Set(sourceParts.map((p) => p.name));
  for (const name of planned) if (!given.has(name)) problems.push(`${name}: planned but not used`);
  for (const name of given) if (!planned.has(name)) problems.push(`${name}: used but not planned`);
  return problems;
}

/** An export batch is everything before a table artifact's last two path segments
 *  (`<batch>/<table>/<part>`), the rule bindManifest groups parts by. */
function batchOf(name: string): { batch: string; table: string } | null {
  const segs = name.split("/");
  if (segs.length < 3) return null;
  const table = segs[segs.length - 2];
  if (table === undefined || table === "") return null;
  return { batch: segs.slice(0, -2).join("/"), table };
}

export interface BatchCoverageInput {
  readonly tableArtifactNames: readonly string[];
  /** bindManifest's BoundRun.tables. */
  readonly boundTables: readonly BoundTable[];
  /** Row count per `_part` of the bound county.property relation. */
  readonly countyPropertyRowsByPart: ReadonlyMap<string, number>;
  readonly views?: readonly ContractView[];
}

/** Ported from Task B: the manifest batches holding a table the views read, those none of whose
 *  parts was bound (bindManifest skips a batch whose group it cannot resolve), and the county
 *  batches that gave no county.property row. Either list non-empty is a hard stop. */
export function batchCoverage(input: BatchCoverageInput): BatchCoverage {
  const needed = new Set(tablesForViews(input.views ?? EXPLORE_INDEX_VIEWS).map((r) => r.table));
  const listed = new Map<string, string[]>();
  for (const name of input.tableArtifactNames) {
    const loc = batchOf(name);
    if (loc === null) continue;
    const parts = listed.get(loc.batch) ?? [];
    parts.push(name);
    listed.set(loc.batch, parts);
  }
  const needing = [...listed.entries()].filter(([, parts]) =>
    parts.some((name) => needed.has(batchOf(name)?.table ?? "")),
  );
  const groupOfPart = new Map<string, string>();
  for (const t of input.boundTables) {
    if (!t.emitted) continue;
    for (const part of t.parts) groupOfPart.set(part, t.group);
  }
  const unboundBatches: string[] = [];
  const emptyCountyBatches: string[] = [];
  for (const [batch, parts] of needing) {
    const bound = parts.filter((p) => groupOfPart.has(p));
    if (bound.length === 0) {
      unboundBatches.push(batch);
      continue;
    }
    if (!bound.some((p) => groupOfPart.get(p) === "county")) continue;
    const rows = parts.reduce((sum, p) => sum + (input.countyPropertyRowsByPart.get(p) ?? 0), 0);
    if (rows === 0) emptyCountyBatches.push(batch);
  }
  return { batchesListed: needing.length, unboundBatches, emptyCountyBatches };
}

/** Throws (no index is written) when a batch is unbound or a county batch is empty. */
export function assertBatchCoverage(coverage: BatchCoverage): void {
  const problems = [
    ...coverage.unboundBatches.map((b) => `unbound batch ${b}`),
    ...coverage.emptyCountyBatches.map((b) => `county batch ${b} has no county.property rows`),
  ];
  if (problems.length > 0)
    throw new Error(`explore index: batch coverage failed: ${problems.join("; ")}`);
}

/** The same index as far as a reader can tell: run, view SQL and every source part. */
export function sameIndex(a: IndexDescriptor, b: IndexDescriptor): boolean {
  const parts = (d: IndexDescriptor): string =>
    JSON.stringify([...d.sourceParts].sort((x, y) => (x.name < y.name ? -1 : 1)));
  return (
    a.manifestCid === b.manifestCid && a.viewsSha256 === b.viewsSha256 && parts(a) === parts(b)
  );
}

export type UploadDecision = "upload" | "noop" | "conflict";

/** No existing `index.json` → upload; the same index → no-op (idempotent re-run); a different
 *  one under the same manifest CID → conflict (never overwritten; a view-SQL change needs the
 *  operator to remove the old prefix first). */
export function decideUpload(
  existing: IndexDescriptor | undefined,
  next: IndexDescriptor,
): UploadDecision {
  if (existing === undefined) return "upload";
  return sameIndex(existing, next) ? "noop" : "conflict";
}
