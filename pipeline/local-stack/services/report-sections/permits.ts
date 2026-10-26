// A-04 T056: the `permits` and `jurisdictions` sections of `backbone report` (contracts/
// report.md). Read-only (the Loader is the only writer); counts, digests, URLs and timestamps
// only, never a payload or a contractor field. Both sections use the latest complete permits
// capture job (backfill or incremental) and the latest `--link` job, named in `source_jobs`.
import type postgres from "postgres";
import type { ReportSection } from "../report.js";
import { throughputRow } from "../../../oracle-runtime/travis/backbone/source-limits.js";
import { readCatalog } from "../../../oracle-runtime/travis/discovery/write-catalog.js";
import { TRAVIS_JURISDICTION_PROFILE } from "../../../oracle-runtime/travis/profiles/jurisdictions.js";
import { statusVsBaseline } from "../../../oracle-runtime/travis/permits/classify-run.js";
import { buildJurisdictionsReport } from "../../../oracle-runtime/travis/permits/jurisdictions-report.js";
import {
  AustinWatermark,
  PERMITS_SOURCE_KEY,
} from "../../../oracle-runtime/travis/permits/merge-input.js";

const SOURCE = PERMITS_SOURCE_KEY;

export interface PermitsReportData {
  sourceJobs: string[];
  watermark: AustinWatermark | null;
  /** permit_source_rows with :updated_at ≤ W. */
  capturedAtW: number;
  outsideTravis: number;
  candidates: number;
  linked: number;
  unmatchedByReason: Record<string, number>;
  statusCounts: Record<string, number>;
  tombstones: number;
  profileSha256: string | null;
  delta?: { added: number; changed: number; removed: number };
}

export function assemblePermitsSection(d: PermitsReportData) {
  const w = d.watermark;
  const throughput =
    w !== null && Date.parse(w.finishedAt) > Date.parse(w.startedAt)
      ? throughputRow({ source: SOURCE, pages: w.pages, rows: w.rows, startedAt: w.startedAt, finishedAt: w.finishedAt, concurrency: 1 })
      : null;
  return {
    source_jobs: d.sourceJobs,
    source_total_at_watermark: w?.sourceCountAtW ?? null,
    captured_at_watermark: d.capturedAtW,
    above_watermark: w?.aboveW ?? null,
    watermark: w?.maxUpdatedAt ?? null,
    watermark_check: w?.watermarkCheck ?? null,
    start_total: w?.startTotal ?? null,
    end_total: w?.endTotal ?? null,
    outside_travis: d.outsideTravis,
    reroof_candidates: d.candidates,
    linked: d.linked,
    link_rate: d.candidates > 0 ? Math.round((d.linked / d.candidates) * 10_000) / 10_000 : 0,
    unmatched_by_reason: d.unmatchedByReason,
    status_class_vs_baseline: statusVsBaseline(d.statusCounts),
    needs_review: d.statusCounts.needs_review ?? 0,
    restamp: { detected: w?.restamp?.detected ?? false, rows_written: w?.restamp?.rowsWritten ?? 0 },
    delta: d.delta ?? null,
    tombstones: d.tombstones,
    profile_sha256: d.profileSha256,
    throughput:
      throughput === null
        ? null
        : { pages: throughput.pages, duration_s: throughput.duration_s, rows_per_s: throughput.rows_per_s, markdown: throughput.markdown },
  };
}

export interface JurisdictionsData {
  captured: number;
  sourceTotal: number;
  capturedAt: string | null;
  /** Austin rows by located jurisdiction (the source `jurisdiction` column). */
  located: Record<string, number>;
  sourceJobs?: string[];
}

export function assembleJurisdictionsSection(d: JurisdictionsData, catalogPath?: string) {
  const catalog = catalogPath === undefined ? readCatalog() : readCatalog(catalogPath);
  const r = buildJurisdictionsReport({
    jurisdictions: catalog.permits?.jurisdictions ?? [],
    profile: TRAVIS_JURISDICTION_PROFILE,
    austin: { captured: d.captured, sourceTotal: d.sourceTotal, capturedAt: d.capturedAt },
    located: d.located,
  });
  return {
    source_jobs: d.sourceJobs ?? [],
    supported: r.supported,
    absent: r.absent,
    limitations: r.limitations.map((l) => l.text),
  };
}

const n = (v: unknown): number => Number(v ?? 0);

async function latestJobs(sql: postgres.Sql): Promise<{ capture: string | null; link: string | null }> {
  const rows = await sql<{ job_id: string; mode: string }[]>`
    SELECT job_id, mode FROM backbone_runs
    WHERE track = 'permits' AND status = 'complete' AND mode IN ('backfill', 'incremental', 'link')
    ORDER BY finished_at DESC NULLS LAST`;
  return {
    capture: rows.find((r) => r.mode !== "link")?.job_id ?? null,
    link: rows.find((r) => r.mode === "link")?.job_id ?? null,
  };
}

async function readWatermark(sql: postgres.Sql): Promise<AustinWatermark | null> {
  const rows = await sql<{ value: unknown }[]>`
    SELECT value FROM watermarks WHERE track = 'permits' AND source_key = ${SOURCE}`;
  const parsed = AustinWatermark.safeParse(rows[0]?.value);
  return parsed.success ? parsed.data : null;
}

async function capturedAtW(sql: postgres.Sql, w: AustinWatermark | null): Promise<number> {
  if (w?.maxUpdatedAt == null) return 0;
  const [r] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM permit_source_rows WHERE source = ${SOURCE} AND updated_at <= ${w.maxUpdatedAt}::timestamptz`;
  return n(r?.n);
}

export async function loadPermitsData(sql: postgres.Sql): Promise<PermitsReportData> {
  const jobs = await latestJobs(sql);
  const watermark = await readWatermark(sql);
  const [c] = await sql<{ outside_travis: number; candidates: number; linked: number; profile_sha256: string | null }[]>`
    SELECT count(*) FILTER (WHERE in_travis IS NOT TRUE)::int AS outside_travis,
           count(*) FILTER (WHERE reroof_match)::int AS candidates,
           count(*) FILTER (WHERE reroof_match AND request_identifier IS NOT NULL)::int AS linked,
           min(profile_sha256) AS profile_sha256
    FROM property_improvements WHERE source = ${SOURCE}`;
  const unmatched = await sql<{ reason: string; n: number }[]>`
    SELECT unmatched_reason AS reason, count(*)::int AS n FROM property_improvements
    WHERE source = ${SOURCE} AND reroof_match AND request_identifier IS NULL AND unmatched_reason IS NOT NULL
    GROUP BY 1 ORDER BY 1`;
  const status = await sql<{ cls: string; n: number }[]>`
    SELECT status_class AS cls, count(*)::int AS n FROM property_improvements
    WHERE source = ${SOURCE} AND reroof_match AND status_class IS NOT NULL GROUP BY 1`;
  const [t] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM source_tombstones WHERE source_key = ${SOURCE}`;
  let delta: PermitsReportData["delta"];
  if (jobs.capture !== null) {
    const [d] = await sql<{ added: number; changed: number }[]>`
      SELECT count(*) FILTER (WHERE previous_content_sha256 IS NULL)::int AS added,
             count(*) FILTER (WHERE previous_content_sha256 IS NOT NULL)::int AS changed
      FROM property_improvements WHERE source = ${SOURCE} AND updated_in_job = ${jobs.capture}`;
    const [r] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM source_tombstones WHERE source_key = ${SOURCE} AND job_id = ${jobs.capture}`;
    delta = { added: n(d?.added), changed: n(d?.changed), removed: n(r?.n) };
  }
  return {
    sourceJobs: [jobs.capture, jobs.link].filter((j): j is string => j !== null),
    watermark,
    capturedAtW: await capturedAtW(sql, watermark),
    outsideTravis: n(c?.outside_travis),
    candidates: n(c?.candidates),
    linked: n(c?.linked),
    unmatchedByReason: Object.fromEntries(unmatched.map((u) => [u.reason, n(u.n)])),
    statusCounts: Object.fromEntries(status.map((s) => [s.cls, n(s.n)])),
    tombstones: n(t?.n),
    profileSha256: c?.profile_sha256 ?? null,
    ...(delta !== undefined ? { delta } : {}),
  };
}

export const section: ReportSection = {
  key: "permits",
  build: async (sql) => assemblePermitsSection(await loadPermitsData(sql)),
};

/**
 * The `jurisdictions` section. report.ts loads one `section` per file, so this second export
 * needs a seam (a `sections` export or a one-line `report-sections/jurisdictions.ts`).
 */
export const jurisdictionsSection: ReportSection = {
  key: "jurisdictions",
  build: async (sql) => {
    const jobs = await latestJobs(sql);
    const watermark = await readWatermark(sql);
    const located = await sql<{ j: string | null; n: number }[]>`
      SELECT located_jurisdiction AS j, count(*)::int AS n FROM property_improvements
      WHERE source = ${SOURCE} AND issuing_jurisdiction = 'austin' GROUP BY 1`;
    return assembleJurisdictionsSection({
      captured: await capturedAtW(sql, watermark),
      sourceTotal: watermark?.sourceCountAtW ?? 0,
      capturedAt: watermark?.finishedAt ?? null,
      located: Object.fromEntries(located.filter((l) => l.j !== null).map((l) => [l.j as string, n(l.n)])),
      sourceJobs: [jobs.capture, jobs.link].filter((j): j is string => j !== null),
    });
  },
};

export const sections: readonly ReportSection[] = [section, jurisdictionsSection];
