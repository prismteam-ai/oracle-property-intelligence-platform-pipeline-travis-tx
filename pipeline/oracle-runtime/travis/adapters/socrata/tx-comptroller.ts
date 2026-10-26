// A-07 T010 (Track A, Foundational): the single shared Comptroller adapter. Loads the Texas
// Comptroller "Active Franchise Tax Permit Holders" dataset (Socrata `9cir-efmm`), Travis-
// scoped to county code 227 (D-1/D-6, research.md). One writer: this module is the only
// fetch path into the registry; Track C's business transform (T039) reads the staged artifact
// this adapter writes, never asking the source a second time.
//
// Column names confirmed live at T019/T020 (a direct `$limit=1` probe plus the real T020
// resolution run, which found the registry's sos_status_code 100% "unknown" on the first
// pass -- a real data-correctness bug, not a cosmetic one, since it silently made every
// name match look non-active): `taxpayer_number`, `taxpayer_name`, `taxpayer_county_code`,
// `sos_status_code` (the SOS standing code: "A" = active, confirmed by a live
// `$group=sos_status_code,right_to_transact_business_code` query; other observed codes
// include C/D/F/M/R/V/W/X/Y, none of them active), `secretary_of_state_sos_or_coa_file_number`
// (not a shorter `sos_file_number`), and `taxpayer_address` (not `taxpayer_mailing_address`).
//
// Politeness (constitution A6): every request goes through travis/lib/source-client.ts
// (identified User-Agent, backoff on 429/5xx only, StopOnBlocked on 403/challenge/timeout),
// no Socrata app token required. Keyset pages ordered by `:id`, `$limit` capped like every
// other Socrata adapter in this repo.
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { z } from "zod";
import { type CaptureReceipt, type SourceClient, stopClass } from "../../lib/source-client.js";
import { MAX_PAGE_SIZE, datasetUrl, type SocrataSource } from "./socrata.js";

export const COMPTROLLER_SOURCE: Readonly<SocrataSource> = Object.freeze({
  name: "tx-comptroller-9cir-efmm",
  domain: "data.texas.gov",
  dataset: "9cir-efmm",
  key: "taxpayer_number",
  dateField: "taxpayer_number",
  watermarkField: ":updated_at",
});

/** County code 227 is Travis County in the Comptroller's own numbering (D-1/D-6, scope kept as decided). */
export const TRAVIS_COUNTY_CODE = "227";
export const COMPTROLLER_COUNTY_FIELD = "taxpayer_county_code";
export const TRAVIS_COUNTY_WHERE = `${COMPTROLLER_COUNTY_FIELD}='${TRAVIS_COUNTY_CODE}'`;

/**
 * Stamped onto the staged artifact (`{ mappingVersion, rows }`, not a bare array) so a fixed
 * field-mapping bug (T020's live finding: `right_to_transact_business`/`sos_file_number`/
 * `taxpayer_mailing_address` do not exist; the real fields are `sos_status_code`/
 * `secretary_of_state_sos_or_coa_file_number`/`taxpayer_address`) changes the artifact's
 * bytes -- and therefore its sha256, the Loader's idempotency key -- even when the live
 * source content is byte-identical between captures. Without this, the Loader's generic
 * (track, artifactSha256) skip-check would never let a corrected mapping re-merge against an
 * unchanged source. Bump this whenever `toComptrollerRow` changes.
 */
export const MAPPING_VERSION = "tx-comptroller-mapping@1.1.0";

export interface ComptrollerRow {
  taxpayerNumber: string;
  legalName: string;
  sosStatusCode: string;
  mailingAddress: string | null;
  sosFileNumber: string | null;
}

const soqlString = (s: string): string => `'${s.replace(/'/g, "''")}'`;

/** The keyset page query after `lastId` (null for the first page), inside the given scope. */
export function buildComptrollerPageQuery(
  lastId: string | null,
  scopeWhere: string,
  pageSize: number,
): { url: string; params: Record<string, string> } {
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
    throw new Error(`page size must be between 1 and ${MAX_PAGE_SIZE}, got ${pageSize}`);
  }
  const where = [scopeWhere, ...(lastId === null ? [] : [`:id > ${soqlString(lastId)}`])].join(
    " AND ",
  );
  const params: Record<string, string> = {
    $select: "*,:id,:updated_at",
    $where: where,
    $order: ":id",
    $limit: String(pageSize),
  };
  return { url: `${datasetUrl(COMPTROLLER_SOURCE)}?${new URLSearchParams(params)}`, params };
}

const RawRow = z.looseObject({
  ":id": z.string().min(1),
  ":updated_at": z.string().optional(),
  taxpayer_number: z.string().min(1),
  taxpayer_name: z.string().min(1),
  sos_status_code: z.string().optional(),
  secretary_of_state_sos_or_coa_file_number: z.string().optional(),
  taxpayer_address: z.string().optional(),
});
const RawRows = z.array(RawRow);

/** The SOS standing code -> a readable label. "A" (confirmed live) is the only active code;
 *  every other observed code (C/D/F/M/R/V/W/X/Y) is kept as its raw trimmed code, so a new,
 *  unmapped code never silently reads as active. */
const STATUS_LABELS: Readonly<Record<string, string>> = Object.freeze({ A: "active" });

function sosStatusLabel(raw: string | undefined): string {
  const trimmed = (raw ?? "").trim().toUpperCase();
  if (trimmed === "") return "unknown";
  return STATUS_LABELS[trimmed] ?? trimmed;
}

function toComptrollerRow(r: z.infer<typeof RawRow>): ComptrollerRow {
  return {
    taxpayerNumber: r.taxpayer_number,
    legalName: r.taxpayer_name,
    sosStatusCode: sosStatusLabel(r.sos_status_code),
    mailingAddress: r.taxpayer_address ?? null,
    sosFileNumber: r.secretary_of_state_sos_or_coa_file_number ?? null,
  };
}

/** sha256 of the canonically sorted row set (AD-26 pattern); order-independent, change-sensitive. */
export function registrySnapshotDigest(rows: readonly ComptrollerRow[]): string {
  const sorted = [...rows].sort((a, b) => (a.taxpayerNumber < b.taxpayerNumber ? -1 : 1));
  const canonical = sorted.map((r) =>
    JSON.stringify(Object.fromEntries(Object.entries(r).sort(([a], [b]) => (a < b ? -1 : 1)))),
  );
  return createHash("sha256").update(canonical.join("\n")).digest("hex");
}

/**
 * In-memory upsert, keyed on taxpayer_number (never mutates `existing`): a later page's row
 * for a taxpayer number already staged replaces the earlier one, matching the Query DB's own
 * `ON CONFLICT (taxpayer_number) DO UPDATE` the Loader track performs on load (T017).
 */
export function stageComptrollerRows(
  existing: ReadonlyMap<string, ComptrollerRow>,
  incoming: readonly ComptrollerRow[],
): Map<string, ComptrollerRow> {
  const staged = new Map(existing);
  for (const row of incoming) staged.set(row.taxpayerNumber, row);
  return staged;
}

export interface LoadComptrollerRegistryOptions {
  client: SourceClient;
  jobDir: string;
  /** Travis-only (D-1/D-6, this story's scope) or statewide (the A-07 lookup-set-only case). */
  scope?: "travis" | "statewide";
  pageSize?: number;
}

export interface LoadComptrollerRegistryResult {
  status: "ok" | "blocked" | "error";
  reason?: string;
  rows: ComptrollerRow[];
  rowCount: number;
  /** Max `:updated_at` observed across every row read. */
  watermark: string | null;
  snapshotDigest: string;
  pages: number;
  sourceUrl: string;
  receipts: CaptureReceipt[];
}

/** Loads the whole scoped dataset by keyset pages, stages it, and writes the staged artifact. */
export async function loadComptrollerRegistry(
  options: LoadComptrollerRegistryOptions,
): Promise<LoadComptrollerRegistryResult> {
  const { client, jobDir } = options;
  const pageSize = options.pageSize ?? MAX_PAGE_SIZE;
  const scopeWhere = options.scope === "statewide" ? "true" : TRAVIS_COUNTY_WHERE;
  const receipts: CaptureReceipt[] = [];

  let staged = new Map<string, ComptrollerRow>();
  let watermark: string | null = null;
  let lastId: string | null = null;
  let pages = 0;

  for (;;) {
    const query = buildComptrollerPageQuery(lastId, scopeWhere, pageSize);
    const { receipt, data } = await client.capture({ url: query.url, schema: RawRows });
    receipts.push(receipt);
    const outcome = stopClass(receipt);
    if (outcome !== "ok" || data === null) {
      return {
        status: outcome,
        reason: `page ${pages + 1} ${outcome} (HTTP ${receipt.status ?? "none"}${receipt.blocked_reason ? `, ${receipt.blocked_reason}` : ""})`,
        rows: [...staged.values()],
        rowCount: staged.size,
        watermark,
        snapshotDigest: registrySnapshotDigest([...staged.values()]),
        pages,
        sourceUrl: datasetUrl(COMPTROLLER_SOURCE),
        receipts,
      };
    }
    pages += 1;
    const incoming = data.map(toComptrollerRow);
    staged = stageComptrollerRows(staged, incoming);
    for (const r of data) {
      const u = r[":updated_at"];
      if (typeof u === "string" && (watermark === null || u > watermark)) watermark = u;
      const id = r[":id"];
      if (typeof id === "string") lastId = id;
    }
    if (data.length < pageSize) break;
  }

  const rows = [...staged.values()];
  mkdirSync(jobDir, { recursive: true });
  writeFileSync(
    `${jobDir}/registry-rows.json`,
    `${JSON.stringify({ mappingVersion: MAPPING_VERSION, rows }, null, 2)}\n`,
  );
  return {
    status: "ok",
    rows,
    rowCount: rows.length,
    watermark,
    snapshotDigest: registrySnapshotDigest(rows),
    pages,
    sourceUrl: datasetUrl(COMPTROLLER_SOURCE),
    receipts,
  };
}
