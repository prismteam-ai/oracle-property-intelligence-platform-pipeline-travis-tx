// A-11 T031 (Stage 5 S5.2): binds the Property Improvement group writer, keyed by job id
// (`travis-a11-…`). Mirrors tcad-backbone.ts's `writeGroupWith` split: this file is the ONLY
// place that opens the Query DB for permits group export, paging through the already-reconciled
// `property_improvements` rows (0301_permits.sql, joined to `permit_source_rows` for the raw
// payload and `parcels` for the owning record) in batches, and handing each batch to
// oracle-runtime's pure `travis/permits/write-group.ts` (planPropertyImprovementGroup +
// writePropertyImprovementGroupFiles), never reimplementing its shaping. The Query DB is read
// here only; no write, no re-request of Austin, no new TCAD export read.
import { join } from "node:path";
import type * as Restate from "@restatedev/restate-sdk";
import type postgres from "postgres";
import { z } from "zod";
import * as travisAustin from "../../../../profiles/travis-austin@1.0.0/index.js";
import { runDirFor } from "../../../oracle-runtime/travis/tcad/export-source.js";
import { fetchDataGroupCids, type DataGroupCids } from "../../../oracle-runtime/travis/transforms/lexicon-manifest.js";
import { parsePidList } from "../../../oracle-runtime/travis/tcad/write-group.js";
import {
  profileApi,
  type TravisAustinProfileModule,
} from "../../../oracle-runtime/travis/pilot/profile-api.js";
import type { ProfileApi } from "../../../oracle-runtime/travis/transforms/austin-property-improvement.js";
import {
  planPropertyImprovementGroup,
  writePropertyImprovementGroupFiles,
  type ParcelDbRow,
  type PermitDbRow,
  type PropertyImprovementGroupInput,
} from "../../../oracle-runtime/travis/permits/write-group.js";
import { asTerminal, lazyQueryDb } from "../loader.js";

export const PROPERTY_IMPROVEMENT_BACKBONE = "PropertyImprovementBackbone";

export const WriteGroupRequest = z.object({
  jobId: z.string(),
  pids: z.array(z.string().regex(/^[1-9][0-9]*$/)).min(1).optional(),
  out: z.string().startsWith("/").optional(),
});

export interface WriteGroupOptions {
  /** Rewrite only these pIDs (read from the Query DB's linked permits). */
  pids?: readonly string[];
  /** Absolute output directory; default is the run's `groups/property_improvement`. */
  out?: string;
}

export interface PermitsWriteGroupDeps {
  sql: postgres.Sql;
  cids: DataGroupCids;
  profile: ProfileApi;
  /** Default output directory (the run's `groups/property_improvement`). */
  defaultDir: string;
  /** pIDs read per DB round trip (default 500); tests pass a small value. */
  batchSize?: number;
  /**
   * Optional progress hook, called once per page written (monitoring only, never behavior).
   * `permits` is linked DB rows READ this page (pre-classification); `emitted` is the
   * roofing-classified, decided-status `property_improvement` rows actually WRITTEN this page
   * (CR-A-11-porygon finding 1: the two are different numbers and must never share one label).
   */
  onPage?: (progress: { pids: number; groups: number; empty: number; permits: number; emitted: number }) => void;
}

export interface PageResult {
  groups: number;
  empty: number;
  /** Linked DB rows read this page, before roofing/status classification. */
  permits: number;
  /** `property_improvement` rows actually written this page (roofing-classified, decided only). */
  emitted: number;
  seen: string[];
}

/** One page's parcels, keyed by request_identifier (pIDs not in the DB are simply absent). */
async function parcelsFor(sql: postgres.Sql, pids: readonly string[]): Promise<Map<string, ParcelDbRow>> {
  if (pids.length === 0) return new Map();
  const rows = await sql<ParcelDbRow[]>`
    SELECT request_identifier, geo_id, payload_redacted, property_structure_built_year,
           export_point_lat, export_point_lon, export_point_kind,
           latitude, longitude, coordinate_source, coordinate_source_url
    FROM parcels
    WHERE request_identifier IN ${sql(pids as string[])}`;
  return new Map(rows.map((r) => [r.request_identifier, r]));
}

/**
 * One page's linked, non-tombstoned permits, keyed by their owning pID. Joins
 * `permit_source_rows` for the raw captured payload (never re-requested) and `content_sha256` /
 * `captured_at`, the exact fields `captureOf` (write-group.ts) rebuilds the GET receipt from.
 */
async function permitsFor(sql: postgres.Sql, pids: readonly string[]): Promise<Map<string, PermitDbRow[]>> {
  if (pids.length === 0) return new Map();
  type Row = { request_identifier: string; permit_number: string; payload: unknown; content_sha256: string; captured_at: string };
  const rows = await sql<Row[]>`
    SELECT pi.request_identifier AS request_identifier,
           pi.permit_number AS permit_number,
           psr.payload AS payload,
           psr.content_sha256 AS content_sha256,
           psr.captured_at::text AS captured_at
    FROM property_improvements pi
    JOIN permit_source_rows psr ON psr.source = pi.source AND psr.row_id = pi.source_row_id
    WHERE pi.tombstoned = false
      AND pi.request_identifier IS NOT NULL
      AND pi.request_identifier IN ${sql(pids as string[])}`;
  const m = new Map<string, PermitDbRow[]>();
  for (const r of rows) {
    const permit: PermitDbRow = {
      request_identifier: r.request_identifier,
      permit_number: r.permit_number,
      payload: r.payload as PermitDbRow["payload"],
      content_sha256: r.content_sha256,
      captured_at: r.captured_at,
    };
    m.set(r.request_identifier, [...(m.get(r.request_identifier) ?? []), permit]);
  }
  return m;
}

/**
 * Pages of pIDs to process: the explicit `wanted` list chunked to `batchSize` when given,
 * otherwise every distinct linked, non-tombstoned pID in `property_improvements`, read in
 * keyset pages (ORDER BY + `> after`, never OFFSET, so a page never re-reads or skips a row
 * while 2.38M permit rows are scanned).
 */
export async function* linkedPidPages(
  sql: postgres.Sql,
  batchSize: number,
  wanted: readonly string[] | null,
): AsyncGenerator<string[]> {
  if (wanted !== null) {
    const ordered = [...new Set(wanted)].sort();
    for (let i = 0; i < ordered.length; i += batchSize) yield ordered.slice(i, i + batchSize);
    return;
  }
  let after = "";
  for (;;) {
    const rows = await sql<Array<{ request_identifier: string }>>`
      SELECT DISTINCT request_identifier
      FROM property_improvements
      WHERE tombstoned = false
        AND request_identifier IS NOT NULL
        AND request_identifier > ${after}
      ORDER BY request_identifier
      LIMIT ${batchSize}`;
    if (rows.length === 0) return;
    yield rows.map((r) => r.request_identifier);
    after = rows[rows.length - 1]?.request_identifier ?? after;
  }
}

/** Plans and writes one page's groups; returns counts plus the pIDs that produced a group. */
async function writePage(
  deps: PermitsWriteGroupDeps,
  dir: string,
  pids: readonly string[],
): Promise<PageResult> {
  const [parcelMap, permitMap] = await Promise.all([parcelsFor(deps.sql, pids), permitsFor(deps.sql, pids)]);
  const inputs: PropertyImprovementGroupInput[] = [];
  const seen: string[] = [];
  let permits = 0;
  for (const pid of pids) {
    const parcel = parcelMap.get(pid);
    const permitRows = permitMap.get(pid) ?? [];
    if (parcel === undefined || permitRows.length === 0) continue;
    seen.push(pid);
    permits += permitRows.length;
    inputs.push({ parcel, permits: permitRows });
  }
  const plan = planPropertyImprovementGroup(inputs, deps.cids, deps.profile);
  writePropertyImprovementGroupFiles(dir, plan.groups);
  const emitted = plan.groups.reduce((sum, g) => sum + g.counts.emitted, 0);
  return { groups: plan.groups.length, empty: plan.empty.length, permits, emitted, seen };
}

/** Property Improvement group for one job (or just `opts.pids`), paged over the Query DB. */
export async function writeGroupWith(
  deps: PermitsWriteGroupDeps,
  jobId: string,
  opts: WriteGroupOptions = {},
) {
  const wanted = opts.pids === undefined ? null : [...opts.pids];
  const dir = opts.out ?? deps.defaultDir;
  const batchSize = deps.batchSize ?? 500;
  let groups = 0;
  let empty = 0;
  let permits = 0;
  let emitted = 0;
  const seen = new Set<string>();
  for await (const page of linkedPidPages(deps.sql, batchSize, wanted)) {
    const r = await writePage(deps, dir, page);
    groups += r.groups;
    empty += r.empty;
    permits += r.permits;
    emitted += r.emitted;
    for (const pid of r.seen) seen.add(pid);
    deps.onPage?.({ pids: page.length, groups: r.groups, empty: r.empty, permits: r.permits, emitted: r.emitted });
  }
  return {
    jobId,
    groups,
    empty,
    // Linked DB rows read (pre-classification), kept distinct from `emitted` (CR-A-11-porygon
    // finding 1): this is NOT the published row count.
    permits,
    // The actual `property_improvement` rows written this run: roofing-classified, decided-
    // status permits only (PO scope decision, specs/011-publish-and-runs/run-log.md). This is
    // the published count, not `permits`.
    emitted,
    dir: dir.replace(/^.*\/pipeline\//, "pipeline/"),
    ...(wanted === null ? {} : { missing_pids: wanted.filter((p) => !seen.has(p)) }),
  };
}

const queryDb = lazyQueryDb();
let cidsCache: DataGroupCids | null = null;
let profileCache: ProfileApi | null = null;

async function cids(): Promise<DataGroupCids> {
  return (cidsCache ??= (await fetchDataGroupCids()).cids);
}

function profile(): ProfileApi {
  return (profileCache ??= profileApi(travisAustin as unknown as TravisAustinProfileModule));
}

async function writeGroup(jobId: string, opts: WriteGroupOptions = {}) {
  return writeGroupWith(
    {
      sql: queryDb(),
      cids: await cids(),
      profile: profile(),
      defaultDir: join(runDirFor(jobId), "groups", "property_improvement"),
    },
    jobId,
    opts,
  );
}

export { parsePidList };

export function createService(restate: typeof Restate) {
  return restate.object({
    name: PROPERTY_IMPROVEMENT_BACKBONE,
    handlers: {
      writeGroup: async (ctx: Restate.ObjectContext, raw: unknown) => {
        const parsed = WriteGroupRequest.safeParse(raw);
        if (!parsed.success || parsed.data.jobId !== ctx.key) {
          throw new restate.TerminalError("PropertyImprovementBackbone.writeGroup: jobId must be the key");
        }
        const { jobId, pids, out } = parsed.data;
        return ctx.run("write-group", async () => {
          try {
            return await writeGroup(jobId, { ...(pids ? { pids } : {}), ...(out ? { out } : {}) });
          } catch (error) {
            throw asTerminal(restate, error) ?? error;
          }
        });
      },
    },
  });
}
