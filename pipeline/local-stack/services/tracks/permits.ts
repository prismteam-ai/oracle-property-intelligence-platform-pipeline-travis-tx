// A-04 T053: the Loader `permits` track (contracts/seams.md LoaderTrack). The Loader is the
// only writer: this module writes only through the transaction it is handed, and the Loader
// commits its rows, the watermark it returns and its tombstones together.
//
// Inputs (oracle-runtime travis/permits/merge-input.ts), one per AustinPermits step:
//   run_start  backbone_runs row (status running)
//   page       one keyset page artifact (sha256 verified): every source row into
//              permit_source_rows; the current row per (permit_number, issuing_jurisdiction)
//              chosen with A-03's pickPermitRow (keyset-diff.ts) and upserted
//              ON CONFLICT … WHERE content_sha256 IS DISTINCT FROM excluded.content_sha256,
//              so an unchanged or only re-stamped row is never rewritten; the page receipt
//   finalize   key-set diff → source_removed tombstones (rows downgraded, never deleted; a
//              permit number seen under a new :id is a re-key, no tombstone), limitations,
//              receipts, the run complete, and the watermark returned to the Loader
//   stop       receipts (the blocked one with blocked_at) and the run waiting_human | failed
//   link       link (link.ts) + classify (profile travis-austin@1.0.0 via classify-run.ts) +
//              open_days (as_of = the run date) over every loaded permit
// Contractor and applicant fields stay in permit_source_rows.payload only (AD-06).
import { existsSync, readFileSync } from "node:fs";
import { TerminalError } from "@restatedev/restate-sdk";
import type postgres from "postgres";
import type { z } from "zod";
import type { LoaderTrack, MergeOutcome } from "../loader.js";
import { AUSTIN_PAGES } from "../../../oracle-runtime/travis/adapters/socrata/austin-3syk-w9eu.js";
import { permitUrl } from "../../../oracle-runtime/travis/adapters/socrata/socrata.js";
import { readPage } from "../../../oracle-runtime/travis/adapters/socrata/socrata-pages.js";
import { classifyRun } from "../../../oracle-runtime/travis/permits/classify-run.js";
import { contentDigest } from "../../../oracle-runtime/travis/permits/content-digest.js";
import {
  classifyMissing,
  planPageMerge,
  type CurrentRow,
  type SourceRowIn,
} from "../../../oracle-runtime/travis/permits/keyset-diff.js";
import {
  ISSUING_JURISDICTION,
  buildLinkIndex,
  linkPermit,
  locatedJurisdiction,
  permitAddress,
  type ParcelCandidate,
  type SitusLike,
} from "../../../oracle-runtime/travis/permits/link.js";
import {
  PERMITS_SOURCE_KEY,
  PermitsMergeInput,
  ReceiptLine,
} from "../../../oracle-runtime/travis/permits/merge-input.js";
import { openDays } from "../../../oracle-runtime/travis/permits/open-days.js";
import { readKeys } from "../../../oracle-runtime/travis/permits/workflow.js";

type Input = z.infer<typeof PermitsMergeInput>;
type Tx = postgres.TransactionSql;

// The SQL below spells the issuing jurisdiction as a literal; it must stay the link module's.
if (ISSUING_JURISDICTION !== "austin") throw new Error("permits track: issuing jurisdiction drift");

const SOURCE = PERMITS_SOURCE_KEY;
const KEY_BATCH = 50_000;
/** OR-M3: a key set this far below the source total, or removals above this share, is refused. */
const KEYS_TOLERANCE_FLOOR = 1000;
const KEYS_TOLERANCE_SHARE = 0.001;
const MAX_REMOVAL_SHARE = 0.01;
const LINK_BATCH = 20_000;

const text = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
};

/** The YYYY-MM-DD part of a Socrata floating timestamp, or null. */
export function dateOf(v: unknown): string | null {
  const t = text(v);
  const m = t === null ? null : /^(\d{4}-\d{2}-\d{2})/.exec(t);
  if (!m?.[1]) return null;
  return new Date(`${m[1]}T00:00:00Z`).toISOString().slice(0, 10) === m[1] ? m[1] : null;
}

const numberText = (v: unknown): string | null => {
  const t = text(v);
  return t !== null && Number.isFinite(Number(t)) ? t : null;
};

function receiptLines(path: string | null): ReceiptLine[] {
  if (path === null || !existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => ReceiptLine.parse(JSON.parse(l)));
}

const pageKey = (r: ReceiptLine): string | null =>
  r.page_index === null ? null : `page-${String(r.page_index).padStart(6, "0")}`;

async function insertReceipt(tx: Tx, jobId: string, r: ReceiptLine): Promise<void> {
  await tx`
    INSERT INTO capture_receipts (job_id, source_key, url, http_status, bytes, sha256, captured_at, outcome, attempts, ua, page_key, blocked_at)
    VALUES (${jobId}, ${SOURCE}, ${r.url}, ${r.http_status}, ${r.bytes}, ${r.sha256}, ${r.captured_at}::timestamptz,
            ${r.outcome}, ${r.attempts}, ${r.ua}, ${pageKey(r)}, ${r.blocked_at}::timestamptz)`;
}

/** Every receipt not already recorded by a page merge (counts, histograms, failed pages). */
async function insertRunReceipts(tx: Tx, jobId: string, path: string | null): Promise<number> {
  const lines = receiptLines(path).filter((r) => r.kind !== "page" || r.outcome !== "ok");
  for (const r of lines) await insertReceipt(tx, jobId, r);
  return lines.length;
}

async function mergePage(tx: Tx, input: Extract<Input, { kind: "page" }>): Promise<MergeOutcome> {
  const rows = readPage(input.artifactPath, input.artifactSha256);
  const receipt = receiptLines(input.receiptsPath).find(
    (r) => r.kind === "page" && r.page_index === input.pageIndex && r.sha256 === input.artifactSha256,
  );
  if (receipt === undefined) {
    throw new Error(`permits track: no receipt for page ${input.pageIndex} (${input.artifactSha256})`);
  }
  const capturedAt = receipt.captured_at;
  const incoming: (SourceRowIn & { index: number })[] = rows.map((r, index) => ({
    index,
    rowId: r[":id"],
    permitNumber: r.permit_number,
    contentSha256: contentDigest(r, AUSTIN_PAGES.volatileFields),
    updatedAt: text(r[":updated_at"]),
    payload: r as Record<string, unknown>,
  }));
  const numbers = [...new Set(incoming.map((r) => r.permitNumber))];
  const existingRows = await tx<
    { permit_number: string; source_row_id: string; content_sha256: string; payload: Record<string, unknown> | null }[]
  >`
    SELECT pi.permit_number, pi.source_row_id, pi.content_sha256, psr.payload
    FROM property_improvements pi
    LEFT JOIN permit_source_rows psr ON psr.source = pi.source AND psr.row_id = pi.source_row_id
    WHERE pi.issuing_jurisdiction = 'austin' AND pi.permit_number = ANY(${numbers}::text[])`;
  const existing = new Map<string, CurrentRow>(
    existingRows.map((e) => [
      e.permit_number,
      {
        permitNumber: e.permit_number,
        rowId: e.source_row_id,
        contentSha256: e.content_sha256,
        payload: e.payload ?? {},
      },
    ]),
  );
  const plan = planPageMerge(existing, incoming);

  await tx`
    INSERT INTO permit_source_rows (source, row_id, permit_number, page_sha256, row_index, content_sha256, updated_at, captured_at, job_id, payload)
    SELECT ${SOURCE}, u.row_id, u.permit_number, ${input.artifactSha256}, u.row_index::int, u.content_sha256,
           u.updated_at::timestamptz, ${capturedAt}::timestamptz, ${input.jobId}, u.payload::jsonb
    FROM unnest(${incoming.map((r) => r.rowId)}::text[], ${incoming.map((r) => r.permitNumber)}::text[],
                ${incoming.map((r) => String(r.index))}::text[], ${incoming.map((r) => r.contentSha256)}::text[],
                ${incoming.map((r) => r.updatedAt)}::text[], ${incoming.map((r) => JSON.stringify(r.payload))}::text[])
         AS u(row_id, permit_number, row_index, content_sha256, updated_at, payload)
    ON CONFLICT (source, row_id) DO UPDATE SET
      permit_number = excluded.permit_number, page_sha256 = excluded.page_sha256, row_index = excluded.row_index,
      content_sha256 = excluded.content_sha256, updated_at = excluded.updated_at, captured_at = excluded.captured_at,
      job_id = excluded.job_id, payload = excluded.payload
    WHERE permit_source_rows.content_sha256 IS DISTINCT FROM excluded.content_sha256`;

  let written = 0;
  if (plan.upserts.length > 0) {
    const u = plan.upserts;
    const col = (f: (p: (typeof u)[number]) => string | null): (string | null)[] => u.map(f);
    const out = await tx<{ permit_number: string }[]>`
      INSERT INTO property_improvements (source, permit_number, issuing_jurisdiction, located_jurisdiction, source_row_id, tcad_id,
        status_raw, issue_date, expiry_date, latitude, longitude, payload_sha256, content_sha256, previous_content_sha256,
        updated_in_job, source_url, captured_at, tombstoned, page_key)
      SELECT ${SOURCE}, u.permit_number, 'austin', u.located, u.row_id, u.tcad_id, u.status_raw, u.issue_date::date,
             u.expiry_date::date, u.lat::double precision, u.lon::double precision, ${input.artifactSha256}, u.content_sha256,
             u.previous, ${input.jobId}, u.source_url, ${capturedAt}::timestamptz, false, ${pageKey(receipt)}
      FROM unnest(${col((p) => p.row.permitNumber)}::text[], ${col((p) => locatedJurisdiction(p.row.payload))}::text[],
                  ${col((p) => p.row.rowId)}::text[], ${col((p) => text(p.row.payload.tcad_id))}::text[],
                  ${col((p) => text(p.row.payload.status_current))}::text[], ${col((p) => dateOf(p.row.payload.issue_date))}::text[],
                  ${col((p) => dateOf(p.row.payload.expiresdate))}::text[], ${col((p) => numberText(p.row.payload.latitude))}::text[],
                  ${col((p) => numberText(p.row.payload.longitude))}::text[], ${col((p) => p.row.contentSha256)}::text[],
                  ${col((p) => p.previousContentSha256)}::text[], ${col((p) => permitUrl(AUSTIN_PAGES.source, p.row.permitNumber))}::text[])
           AS u(permit_number, located, row_id, tcad_id, status_raw, issue_date, expiry_date, lat, lon, content_sha256, previous, source_url)
      ON CONFLICT (permit_number, issuing_jurisdiction) DO UPDATE SET
        located_jurisdiction = excluded.located_jurisdiction, source_row_id = excluded.source_row_id, tcad_id = excluded.tcad_id,
        status_raw = excluded.status_raw, issue_date = excluded.issue_date, expiry_date = excluded.expiry_date,
        latitude = excluded.latitude, longitude = excluded.longitude, payload_sha256 = excluded.payload_sha256,
        previous_content_sha256 = property_improvements.content_sha256, content_sha256 = excluded.content_sha256,
        updated_in_job = excluded.updated_in_job, source_url = excluded.source_url, captured_at = excluded.captured_at,
        tombstoned = false, page_key = excluded.page_key
      WHERE property_improvements.content_sha256 IS DISTINCT FROM excluded.content_sha256
      RETURNING permit_number`;
    written = out.length;
  }
  // A permit served again is live again, even when its content digest is unchanged (the upsert
  // above is skipped then): clear the downgrade and the tombstone row in the same transaction.
  await tx`
    UPDATE property_improvements SET tombstoned = false
    WHERE issuing_jurisdiction = 'austin' AND tombstoned AND permit_number = ANY(${numbers}::text[])`;
  await tx`
    DELETE FROM source_tombstones
    WHERE source_key = ${SOURCE} AND row_key = ANY(${incoming.map((r) => r.rowId)}::text[])`;
  await insertReceipt(tx, input.jobId, receipt);
  return { rowsWritten: written };
}

async function mergeFinalize(
  tx: Tx,
  input: Extract<Input, { kind: "finalize" }>,
): Promise<MergeOutcome> {
  let tombstones = 0;
  if (input.keys !== null) {
    const keys = readKeys(input.keys.path, input.keys.sha256);
    await tx`CREATE TEMP TABLE IF NOT EXISTS permits_seen_keys (row_id text PRIMARY KEY, permit_number text NOT NULL)`;
    await tx`TRUNCATE permits_seen_keys`;
    for (let i = 0; i < keys.length; i += KEY_BATCH) {
      const batch = keys.slice(i, i + KEY_BATCH);
      await tx`
        INSERT INTO permits_seen_keys (row_id, permit_number)
        SELECT * FROM unnest(${batch.map((k) => k.rowId)}::text[], ${batch.map((k) => k.permitNumber)}::text[])
        ON CONFLICT DO NOTHING`;
    }
    await tx`CREATE INDEX IF NOT EXISTS permits_seen_keys_permit ON permits_seen_keys (permit_number)`;
    // OR-M3: a truncated key set must never mass-tombstone. Checked before anything is removed.
    const distinct = new Set(keys.map((k) => k.rowId)).size;
    const endTotal = input.watermark?.endTotal ?? null;
    if (endTotal !== null) {
      const tolerance = Math.max(KEYS_TOLERANCE_FLOOR, Math.ceil(endTotal * KEYS_TOLERANCE_SHARE));
      if (distinct < endTotal - tolerance) {
        throw new TerminalError(
          `permits finalize refused: ${distinct} distinct keys is below endTotal ${endTotal} minus tolerance ${tolerance}; nothing tombstoned`,
        );
      }
    }
    // a permit that reappears is live again: clear the downgrade and its tombstone row first
    await tx`
      UPDATE property_improvements SET tombstoned = false
      WHERE issuing_jurisdiction = 'austin' AND tombstoned
        AND permit_number IN (SELECT permit_number FROM permits_seen_keys)`;
    await tx`
      DELETE FROM source_tombstones
      WHERE source_key = ${SOURCE} AND row_key IN (SELECT row_id FROM permits_seen_keys)`;
    const stored = await tx<{ n: number | string }[]>`
      SELECT count(*) AS n FROM permit_source_rows WHERE source = ${SOURCE}`;
    const storedRows = Number(stored[0]?.n ?? 0);
    const missing = await tx<{ row_id: string; permit_number: string; permit_seen: boolean }[]>`
      SELECT p.row_id, p.permit_number,
             EXISTS (SELECT 1 FROM permits_seen_keys s WHERE s.permit_number = p.permit_number) AS permit_seen
      FROM permit_source_rows p
      WHERE p.source = ${SOURCE} AND NOT EXISTS (SELECT 1 FROM permits_seen_keys s WHERE s.row_id = p.row_id)`;
    const diff = classifyMissing(
      missing.map((m) => ({ rowId: m.row_id, permitNumber: m.permit_number, permitSeen: m.permit_seen })),
    );
    if (diff.removed.length > storedRows * MAX_REMOVAL_SHARE) {
      throw new TerminalError(
        `permits finalize refused: ${diff.removed.length} removals exceed ${MAX_REMOVAL_SHARE * 100}% of ${storedRows} stored rows; nothing tombstoned`,
      );
    }
    if (diff.removed.length > 0) {
      const ids = diff.removed.map((r) => r.rowId);
      const nums = diff.removed.map((r) => r.permitNumber);
      const inserted = await tx<{ row_key: string }[]>`
        INSERT INTO source_tombstones (source_key, row_key, permit_number, reason, first_missing_at, evidence_sha256, job_id)
        SELECT ${SOURCE}, u.row_key, u.permit_number, 'source_removed', ${input.finishedAt}::timestamptz, ${input.keys.sha256}, ${input.jobId}
        FROM unnest(${ids}::text[], ${nums}::text[]) AS u(row_key, permit_number)
        ON CONFLICT (source_key, row_key) DO NOTHING
        RETURNING row_key`;
      tombstones = inserted.length;
      await tx`
        UPDATE property_improvements SET tombstoned = true
        WHERE issuing_jurisdiction = 'austin' AND permit_number = ANY(${[...new Set(nums)]}::text[]) AND NOT tombstoned`;
    }
    await tx`DROP TABLE IF EXISTS permits_seen_keys`;
  }
  for (const l of input.limitations) {
    await tx`
      INSERT INTO source_limitations (job_id, source_key, code, text, count, evidence_url)
      VALUES (${input.jobId}, ${l.sourceKey}, ${l.code}, ${l.text}, ${l.count}, ${l.evidenceUrl})
      ON CONFLICT (job_id, source_key, code)
      DO UPDATE SET text = excluded.text, count = excluded.count, evidence_url = excluded.evidence_url`;
  }
  await insertRunReceipts(tx, input.jobId, input.receiptsPath);
  await tx`
    UPDATE backbone_runs SET status = ${"complete"}, finished_at = ${input.finishedAt}::timestamptz, as_of = ${input.asOf}::date
    WHERE job_id = ${input.jobId}`;
  return {
    rowsWritten: tombstones,
    tombstones,
    ...(input.watermark !== null
      ? { watermark: { sourceKey: SOURCE, value: input.watermark as unknown as Record<string, unknown> } }
      : {}),
  };
}

/**
 * `parcels.situs_address` as G-TCAD stores it is snake_case (street_number, street_name, ...);
 * the printed TCAD situs is camelCase (streetNum, streetName, ...). Read either.
 */
export const situsOf = (input: unknown): SitusLike | null => {
  let v = input;
  if (typeof v === "string") {
    // A jsonb string (the JSON text stored as a string) is read as the object it encodes.
    try {
      v = JSON.parse(v) as unknown;
    } catch {
      return null;
    }
  }
  if (typeof v !== "object" || v === null || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const pick = (camel: string, snake: string): string | null => text(o[camel]) ?? text(o[snake]);
  return {
    streetNum: pick("streetNum", "street_number"),
    streetPrefix: pick("streetPrefix", "street_prefix"),
    streetName: pick("streetName", "street_name"),
    streetSuffix: pick("streetSuffix", "street_suffix"),
    streetSecondary: pick("streetSecondary", "street_secondary"),
    state: pick("state", "state"),
    zip: pick("zip", "zip"),
  };
};

async function mergeLink(tx: Tx, input: Extract<Input, { kind: "link" }>): Promise<MergeOutcome> {
  // OR-m8: link only against a fully loaded parcels table. A shared geoID looks unique in a
  // partial table, so a complete TCAD run must exist and none may still be loading.
  const tcadRuns = await tx<{ job_id: string; status: string; mode: string }[]>`
    SELECT job_id, status, mode FROM backbone_runs
    WHERE track = 'appraisal' AND mode IN ('full', 'pilot')`;
  const running = tcadRuns.find((r) => r.status === "running");
  if (running !== undefined) {
    throw new TerminalError(
      `permits --link refused: TCAD run ${running.job_id} is still running, so the parcels table is partial; link after it completes`,
    );
  }
  if (!tcadRuns.some((r) => r.status === "complete")) {
    throw new TerminalError(
      "permits --link refused: no complete TCAD full or pilot run in backbone_runs; load TCAD first",
    );
  }
  const parcels = await tx<{ request_identifier: string; geo_id: string | null; prop_type: string; situs_address: unknown }[]>`
    SELECT request_identifier, geo_id, prop_type, situs_address FROM parcels WHERE prop_type = 'R'`;
  const extraGeoIds = await tx<{ geo_id: string; request_identifier: string }[]>`
    SELECT g.geo_id, g.request_identifier FROM parcel_geoids g WHERE g.prop_type = 'R'`;
  const situsById = new Map(parcels.map((p) => [p.request_identifier, situsOf(p.situs_address)]));
  const candidates: ParcelCandidate[] = [
    ...parcels.map((p) => ({
      requestIdentifier: p.request_identifier,
      geoId: p.geo_id,
      propType: p.prop_type,
      situs: situsById.get(p.request_identifier) ?? null,
    })),
    ...extraGeoIds.map((g) => ({
      requestIdentifier: g.request_identifier,
      geoId: g.geo_id,
      propType: "R",
      situs: situsById.get(g.request_identifier) ?? null,
    })),
  ];
  const index = buildLinkIndex(candidates);

  let written = 0;
  let last = "";
  for (;;) {
    const batch = await tx<{ permit_number: string; payload: Record<string, unknown> | null }[]>`
      SELECT pi.permit_number, psr.payload
      FROM property_improvements pi
      LEFT JOIN permit_source_rows psr ON psr.source = pi.source AND psr.row_id = pi.source_row_id
      WHERE pi.issuing_jurisdiction = 'austin' AND pi.permit_number > ${last}
      ORDER BY pi.permit_number
      LIMIT ${LINK_BATCH}`;
    if (batch.length === 0) break;
    const cols: (string | null)[][] = Array.from({ length: 17 }, () => []);
    for (const b of batch) {
      const payload = b.payload ?? {};
      const link = linkPermit(index, permitAddress(payload));
      const cls = classifyRun({ permit_number: b.permit_number, ...payload });
      const days = openDays({ statusClass: cls.statusClass, issueDate: dateOf(payload.issue_date), asOf: input.asOf });
      const values = [
        b.permit_number,
        link.requestIdentifier,
        link.linkMethod,
        link.linkRule,
        link.linkConfidence === null ? null : String(link.linkConfidence),
        link.unmatchedReason,
        String(link.inTravis),
        String(cls.includeTerm),
        cls.statusClass,
        cls.profileSha256,
        days.openDays === null ? null : String(days.openDays),
        days.reason,
        cls.permit.roofing,
        cls.permit.reason,
        cls.permit.improvement_type,
        cls.permit.improvement_action,
        String(link.staleTcadId),
      ];
      values.forEach((v, i) => cols[i]?.push(v));
    }
    const [numbers, reqIds, methods, rules, confidence, reasons, inTravis, includeTerm, statusClass, profileSha, days, daysReason, verdict, verdictReason, impType, impAction, staleTcad] = cols;
    const out = await tx<{ permit_number: string }[]>`
      UPDATE property_improvements AS pi SET
        request_identifier = u.request_identifier, link_method = u.link_method, link_rule = u.link_rule,
        link_confidence = u.link_confidence::numeric, unmatched_reason = u.unmatched_reason,
        in_travis = u.in_travis::boolean, reroof_match = u.include_term::boolean, status_class = u.status_class,
        profile_sha256 = u.profile_sha256, open_days = u.open_days::int, open_days_reason = u.open_days_reason,
        roofing_verdict = u.roofing_verdict, roofing_reason = u.roofing_reason,
        improvement_type = u.improvement_type, improvement_action = u.improvement_action,
        stale_tcad_id = u.stale_tcad_id::boolean
      FROM unnest(${numbers ?? []}::text[], ${reqIds ?? []}::text[], ${methods ?? []}::text[], ${rules ?? []}::text[],
                  ${confidence ?? []}::text[], ${reasons ?? []}::text[], ${inTravis ?? []}::text[], ${includeTerm ?? []}::text[],
                  ${statusClass ?? []}::text[], ${profileSha ?? []}::text[], ${days ?? []}::text[], ${daysReason ?? []}::text[],
                  ${verdict ?? []}::text[], ${verdictReason ?? []}::text[], ${impType ?? []}::text[], ${impAction ?? []}::text[],
                  ${staleTcad ?? []}::text[])
           AS u(permit_number, request_identifier, link_method, link_rule, link_confidence, unmatched_reason, in_travis,
                include_term, status_class, profile_sha256, open_days, open_days_reason, roofing_verdict, roofing_reason,
                improvement_type, improvement_action, stale_tcad_id)
      WHERE pi.permit_number = u.permit_number AND pi.issuing_jurisdiction = 'austin'
      RETURNING pi.permit_number`;
    written += out.length;
    last = (batch[batch.length - 1] as { permit_number: string }).permit_number;
    if (batch.length < LINK_BATCH) break;
  }
  return { rowsWritten: written };
}

async function merge(tx: Tx, input: Input): Promise<MergeOutcome> {
  switch (input.kind) {
    case "run_start":
      await tx`
        INSERT INTO backbone_runs (job_id, track, mode, status, started_at, profile_sha256)
        VALUES (${input.jobId}, 'permits', ${input.mode}, 'running', ${input.startedAt}::timestamptz, ${input.profileSha256})
        ON CONFLICT (job_id) DO NOTHING`;
      return { rowsWritten: 1 };
    case "page":
      return mergePage(tx, input);
    case "finalize":
      return mergeFinalize(tx, input);
    case "stop":
      await insertRunReceipts(tx, input.jobId, input.receiptsPath);
      await tx`
        UPDATE backbone_runs SET status = ${input.status}, finished_at = ${input.finishedAt}::timestamptz
        WHERE job_id = ${input.jobId}`;
      return { rowsWritten: 0 };
    case "link":
      return mergeLink(tx, input);
  }
}

export const track: LoaderTrack<Input> = {
  name: "permits",
  // oracle-runtime and local-stack each install zod; the schema is the runtime's.
  input: PermitsMergeInput as unknown as z.ZodType<Input>,
  merge,
};
