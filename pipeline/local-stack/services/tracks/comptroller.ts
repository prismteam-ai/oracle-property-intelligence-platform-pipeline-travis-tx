// A-07 T017 (Track A): the Loader `comptroller` track (migration 0401_comptroller_registry.sql)
// and crosswalk ledger table (0402). The Loader is the only writer: this module writes only
// through the transaction it is handed. Reads the single shared adapter's staged artifact
// (oracle-runtime travis/adapters/socrata/tx-comptroller.ts, T010) -- one writer, Track C's
// business transform (T039) reads the same loaded rows, never a second fetch.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type postgres from "postgres";
import { z } from "zod";
import { registrySnapshotDigest, type ComptrollerRow } from "../../../oracle-runtime/travis/adapters/socrata/tx-comptroller.js";
import { LIVE_CROSSWALK } from "../../../oracle-runtime/travis/identity/crosswalk.js";
import {
  normalizeContractorName,
  resolveContractor,
  type LedgerRow,
  type RegistryRecord,
} from "../../../oracle-runtime/travis/identity/resolver.js";
import { computeFiveStateTotals } from "../../../oracle-runtime/travis/identity/totals.js";
import { PERMITS_SOURCE_KEY } from "../../../oracle-runtime/travis/permits/merge-input.js";
import type { LoaderTrack, MergeOutcome } from "../loader.js";

export const COMPTROLLER_SOURCE_KEY = "tx-comptroller-9cir-efmm";
export const IDENTITY_RESOLUTION_KEY = "identity-resolution-austin-roofing-permits";

const JobId = z.string().regex(/^travis-a07-[a-z0-9-]+$/);
const Sha = z.string().regex(/^[a-f0-9]{64}$/);

const LoadRegistryInput = z.object({
  kind: z.literal("load_registry"),
  jobId: JobId,
  artifactPath: z.string().min(1),
  artifactSha256: Sha,
  scope: z.enum(["travis", "statewide"]),
  /** Max `:updated_at` of the loaded rows (Socrata watermark field), null if none observed. */
  watermark: z.string().nullable(),
  sourceUrl: z.string().min(1),
  capturedAt: z.string().min(1),
});

// A-07 T020 (Track A, Wave 3): resolves every Austin reroof candidate against the Comptroller
// registry loaded by `load_registry` above. A full-table sweep (not an artifact-scoped load),
// so the idempotency check (the generic (track, artifactSha256) one) is scoped the same way
// T056's reconcile:merge is: a content-independent digest per scope, matching this story's
// other full-sweep track.
const ResolvePermitsInput = z.object({
  kind: z.literal("resolve_permits"),
  jobId: JobId,
  artifactPath: z.string().min(1),
  artifactSha256: Sha,
  scope: z.literal("austin-roofing-permits"),
  effectiveOn: z.string().min(1),
});

export const ComptrollerTrackInput = z.discriminatedUnion("kind", [
  LoadRegistryInput,
  ResolvePermitsInput,
]);
export type ComptrollerMergeInput = z.infer<typeof ComptrollerTrackInput>;

const StagedRow = z.object({
  taxpayerNumber: z.string().min(1),
  legalName: z.string().min(1),
  sosStatusCode: z.string().min(1),
  mailingAddress: z.string().nullable(),
  sosFileNumber: z.string().nullable(),
});

const sha256 = (b: Buffer): string => createHash("sha256").update(b).digest("hex");

/** Reads the staged artifact back, verifying it against its declared digest (never trust a path alone). */
function readStagedRows(path: string, expectedSha256: string): ComptrollerRow[] {
  const body = readFileSync(path);
  const actual = sha256(body);
  if (actual !== expectedSha256) {
    throw new Error(`comptroller artifact ${path} sha256 ${actual} differs from declared ${expectedSha256}`);
  }
  // T020's mapping-version fix (tx-comptroller.ts): the artifact is `{ mappingVersion, rows }`,
  // not a bare array, so a corrected mapping always changes the file's bytes/sha256 even when
  // the live source content is unchanged (otherwise the Loader's (track, artifactSha256)
  // idempotency check would skip a corrective re-merge forever).
  const StagedArtifact = z.object({ mappingVersion: z.string().min(1), rows: z.array(StagedRow) });
  return StagedArtifact.parse(JSON.parse(body.toString("utf8"))).rows;
}

async function mergeLoadRegistry(
  tx: postgres.TransactionSql,
  input: Extract<ComptrollerMergeInput, { kind: "load_registry" }>,
): Promise<MergeOutcome> {
  const rows = readStagedRows(input.artifactPath, input.artifactSha256);
  let written = 0;
  if (rows.length > 0) {
    const col = (f: (r: ComptrollerRow) => string | null): (string | null)[] => rows.map(f);
    const out = await tx<{ taxpayer_number: string }[]>`
      INSERT INTO comptroller_registry (taxpayer_number, legal_name, sos_status_code, mailing_address, sos_file_number, source_url, captured_at, updated_at, job_id)
      SELECT u.taxpayer_number, u.legal_name, u.sos_status_code, u.mailing_address, u.sos_file_number,
             ${input.sourceUrl}, ${input.capturedAt}::timestamptz, ${input.watermark}::timestamptz, ${input.jobId}
      FROM unnest(${col((r) => r.taxpayerNumber)}::text[], ${col((r) => r.legalName)}::text[],
                  ${col((r) => r.sosStatusCode)}::text[], ${col((r) => r.mailingAddress)}::text[],
                  ${col((r) => r.sosFileNumber)}::text[])
           AS u(taxpayer_number, legal_name, sos_status_code, mailing_address, sos_file_number)
      ON CONFLICT (taxpayer_number) DO UPDATE SET
        legal_name = excluded.legal_name, sos_status_code = excluded.sos_status_code,
        mailing_address = excluded.mailing_address, sos_file_number = excluded.sos_file_number,
        source_url = excluded.source_url, captured_at = excluded.captured_at,
        updated_at = excluded.updated_at, job_id = excluded.job_id
      WHERE comptroller_registry.updated_at IS DISTINCT FROM excluded.updated_at
         OR comptroller_registry.legal_name IS DISTINCT FROM excluded.legal_name
         OR comptroller_registry.sos_status_code IS DISTINCT FROM excluded.sos_status_code
         OR comptroller_registry.mailing_address IS DISTINCT FROM excluded.mailing_address
         OR comptroller_registry.sos_file_number IS DISTINCT FROM excluded.sos_file_number
      RETURNING comptroller_registry.taxpayer_number`;
    written = out.length;
  }
  const digest = registrySnapshotDigest(rows);
  await tx`
    INSERT INTO comptroller_registry_loads (job_id, scope, row_count, watermark, snapshot_digest, source_url, loaded_at)
    VALUES (${input.jobId}, ${input.scope}, ${rows.length}, ${input.watermark}, ${digest}, ${input.sourceUrl}, ${input.capturedAt}::timestamptz)
    ON CONFLICT (job_id) DO NOTHING`;
  return {
    rowsWritten: written,
    watermark:
      // Written even when `watermark` (the Socrata field) is null: the row count and digest
      // still need to reach the identity report section (T017's other deliverable).
      {
        sourceKey: COMPTROLLER_SOURCE_KEY,
        value: {
          watermark: input.watermark,
          rowCount: rows.length,
          snapshotDigest: digest,
          jobId: input.jobId,
          scope: input.scope,
          sourceUrl: input.sourceUrl,
        },
      },
  };
}

/** `'{"a","b"}'`-style Postgres array literal (escaping `\` and `"`), so a plain-text column
 *  value can carry one row's array and be cast `::text[]` inside the SELECT, the same trick
 *  `mergeLoadRegistry` above avoids needing (its columns are all scalar) but this insert's
 *  `matched_record_ids` column needs. */
function pgTextArrayLiteral(values: readonly string[]): string {
  if (values.length === 0) return "{}";
  return `{${values.map((v) => `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`).join(",")}}`;
}

const BATCH = 5_000;

async function mergeResolvePermits(
  tx: postgres.TransactionSql,
  input: Extract<ComptrollerMergeInput, { kind: "resolve_permits" }>,
): Promise<MergeOutcome> {
  // Every Austin reroof candidate's printed contractor name (payload only, AD-06; never a
  // dedicated property_improvements column) -- the same join shape the `permits` track's
  // own `mergeLink` uses for payload reads.
  const candidates = await tx<{ permit_key: string; raw_contractor_name: string | null }[]>`
    SELECT pi.permit_number AS permit_key, psr.payload->>'contractor_company_name' AS raw_contractor_name
    FROM property_improvements pi
    LEFT JOIN permit_source_rows psr ON psr.source = pi.source AND psr.row_id = pi.source_row_id
    WHERE pi.source = ${PERMITS_SOURCE_KEY} AND pi.reroof_match AND NOT pi.tombstoned
    ORDER BY pi.permit_number`;

  const registryRows = await tx<
    { taxpayer_number: string; legal_name: string; sos_status_code: string | null; mailing_address: string | null; sos_file_number: string | null }[]
  >`SELECT taxpayer_number, legal_name, sos_status_code, mailing_address, sos_file_number FROM comptroller_registry`;
  const registry: ComptrollerRow[] = registryRows.map((r) => ({
    taxpayerNumber: r.taxpayer_number,
    legalName: r.legal_name,
    sosStatusCode: r.sos_status_code ?? "unknown",
    mailingAddress: r.mailing_address,
    sosFileNumber: r.sos_file_number,
  }));
  const registryLoaded = registry.length > 0;
  const snapshotDigest = registrySnapshotDigest(registry);

  // One index build (O(n)), never a per-permit O(n) scan of all ~342k registry rows: the
  // resolver's own `registry` filter stays the correctness boundary (resolver.ts is
  // untouched), it just receives only the already-normalised-name-matching candidates.
  const byNormalizedName = new Map<string, RegistryRecord[]>();
  for (const r of registry) {
    const key = normalizeContractorName(r.legalName);
    const bucket = byNormalizedName.get(key);
    if (bucket) bucket.push(r);
    else byNormalizedName.set(key, [r]);
  }

  const rows: LedgerRow[] = candidates.map((c) => {
    const printed = c.raw_contractor_name !== null && c.raw_contractor_name.trim() !== "" ? c.raw_contractor_name : null;
    const localCandidates = printed === null ? [] : byNormalizedName.get(normalizeContractorName(printed)) ?? [];
    return resolveContractor({
      permitKey: c.permit_key,
      rawContractorName: printed,
      registryLoaded,
      registry: localCandidates,
      registrySnapshotDigest: snapshotDigest,
      crosswalk: LIVE_CROSSWALK,
      effectiveOn: input.effectiveOn,
    });
  });

  let written = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const col = <T>(f: (r: LedgerRow) => T): T[] => batch.map(f);
    const out = await tx<{ permit_key: string }[]>`
      INSERT INTO contractor_resolution_ledger
        (permit_key, raw_contractor_name, state, reason_code, matched_record_ids, match_rule, resolver_version, registry_snapshot_digest, effective_on, job_id)
      SELECT u.permit_key, u.raw_contractor_name, u.state, u.reason_code, u.matched_record_ids::text[],
             u.match_rule, u.resolver_version, u.registry_snapshot_digest, u.effective_on::timestamptz, ${input.jobId}
      FROM unnest(${col((r) => r.permitKey)}::text[], ${col((r) => r.rawContractorName)}::text[],
                  ${col((r) => r.state)}::text[], ${col((r) => r.reasonCode)}::text[],
                  ${col((r) => pgTextArrayLiteral(r.matchedRecordIds))}::text[],
                  ${col((r) => r.matchRule)}::text[], ${col((r) => r.resolverVersion)}::text[],
                  ${col((r) => r.registrySnapshotDigest)}::text[], ${col((r) => r.effectiveOn)}::text[])
           AS u(permit_key, raw_contractor_name, state, reason_code, matched_record_ids, match_rule, resolver_version, registry_snapshot_digest, effective_on)
      RETURNING contractor_resolution_ledger.permit_key`;
    written += out.length;
  }

  const totals = computeFiveStateTotals(rows);
  return {
    rowsWritten: written,
    watermark: {
      sourceKey: IDENTITY_RESOLUTION_KEY,
      value: {
        fiveStateTotals: totals.value,
        permitTotal: rows.length,
        matchRule: rows[0]?.matchRule ?? "normalize-name-v1",
        resolverVersion: rows[0]?.resolverVersion ?? "1.0.0",
        registrySnapshotDigest: snapshotDigest,
        jobId: input.jobId,
      },
    },
  };
}

async function merge(tx: postgres.TransactionSql, input: ComptrollerMergeInput): Promise<MergeOutcome> {
  switch (input.kind) {
    case "load_registry":
      return mergeLoadRegistry(tx, input);
    case "resolve_permits":
      return mergeResolvePermits(tx, input);
  }
}

export const track: LoaderTrack<ComptrollerMergeInput> = {
  name: "comptroller",
  input: ComptrollerTrackInput,
  merge,
};
