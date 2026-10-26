// T025 (assembly half): turns the US1 probe results into the catalog's `sources` rows, the
// `parcel` block and `enrichment.bbb`. Pure functions, no I/O, so the workflow journals the
// probes and this module can be tested on synthetic probe output.
//
// Rules applied here:
// - the TCAD certified roll is always the parcel denominator; GIS is compared, never used;
// - every number is a Measurement copied from a probe (value or null + reason);
// - every source carries a decision and a reason; projected hours come from measure.ts;
// - a blocked or failed source carries blocked_evidence built from its stop receipt.
import { NOT_FILED } from "./jurisdiction-explanation.js";
import { basename } from "node:path";
import type { CaptureReceipt } from "../lib/source-client.js";
import {
  SOURCE_KEYS,
  type Catalog,
  type Measurement,
  type Source,
  type SourceKey,
} from "./catalog.schema.js";
import { exceedsDecisionThreshold, projectedHoursForSource } from "./measure.js";
import { computeGap, type GisProbe } from "./probes/arcgis.js";
import { missingReason, rateLimitsObserved } from "./probes/common.js";
import {
  listTcadSupplemental,
  type EvidenceProbe,
  type LicensingProbe,
  type OvertureProbe,
} from "./probes/evidence.js";
import type { AustinPermitsProbe, ComptrollerProbe, ThroughputMeasured } from "./probes/socrata.js";
import type { TcadProbe } from "./probes/tcad.js";

/** Travis County Transportation & Natural Resources development services (lead; T048). */
export const OTHER_JURISDICTIONS_URL = "https://www.traviscountytx.gov/tnr/development-services";
export const CANONICAL_PARCEL_SOURCE = "TCAD 2026 certified roll";
export const DISCREPANCY_THRESHOLD_PCT = 2.0;
export const BLOCKED_EVIDENCE_DIR = "docs/evidence/blocked";

export interface Us1Results {
  austin: AustinPermitsProbe;
  comptroller: ComptrollerProbe;
  tcad: TcadProbe;
  gis: GisProbe;
  bbb: EvidenceProbe;
  overture: OvertureProbe;
  licensing: LicensingProbe;
}

export interface AssembleOptions {
  /** Assembly time; used only for the other_jurisdictions pointer row (no request made). */
  assembledAt: string;
  /** Repository-relative evidence file for a blocked source (written by T037). */
  evidencePath?: (key: SourceKey, receipt: CaptureReceipt) => string;
}

export type Parcel = NonNullable<Catalog["parcel"]>;
export type BlockedEvidence = NonNullable<Source["blocked_evidence"]>;
export type BbbEnrichment = NonNullable<Catalog["enrichment"]>["bbb"];

export interface Us1Blocks {
  sources: Source[];
  parcel: Parcel;
  enrichment: { bbb: BbbEnrichment };
}

export function defaultEvidencePath(key: SourceKey, receipt: CaptureReceipt): string {
  const stamp = receipt.captured_at.replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  return `${BLOCKED_EVIDENCE_DIR}/${key}-${stamp}.md`;
}

export function blockedEvidence(receipt: CaptureReceipt, evidencePath: string): BlockedEvidence {
  const evidence: BlockedEvidence = {
    captured_at: receipt.captured_at,
    url: receipt.url,
    evidence_path: evidencePath,
    body_sha256: receipt.sha256,
    attempts: receipt.attempts,
    user_agent: receipt.user_agent,
    outcome: receipt.outcome === "failed" ? "failed" : "blocked",
    geo_signal: receipt.geo_signal,
  };
  // A real timeout records timeout_ms; a response records its status; a network error
  // (no response, no timeout) records its error, never a made-up timeout_ms.
  if (receipt.timeout_ms !== null) evidence.timeout_ms = receipt.timeout_ms;
  else if (receipt.status !== null) evidence.http_status = receipt.status;
  if (receipt.error !== undefined) evidence.error = receipt.error;
  else if (receipt.timeout_ms === null && receipt.status === null) {
    evidence.error = "network error, no HTTP response";
  }
  return evidence;
}

/** The challenge part of anti_bot, derived only from the receipts' explicit signals. */
function challengeText(receipts: readonly CaptureReceipt[]): string {
  const seen = receipts.find(
    (r) => r.challenge_signal !== undefined || r.blocked_reason === "challenge",
  );
  if (!seen) return "none seen";
  const signal = seen.challenge_signal ? `; ${seen.challenge_signal}` : "";
  return `seen (HTTP ${seen.status ?? "none"}${signal})`;
}

/**
 * anti_bot text from the source's own receipts. `stop` is the receipt that stopped the
 * source when it is not among `receipts` (a reused earlier observation).
 */
function antiBot(
  receipts: readonly CaptureReceipt[],
  extra?: string,
  stopReceipt?: CaptureReceipt | null,
): string {
  const all =
    stopReceipt && !receipts.includes(stopReceipt) ? [...receipts, stopReceipt] : receipts;
  const stop = all.find((r) => r.outcome === "blocked" || r.outcome === "failed");
  const parts = [
    `rate limits observed: ${rateLimitsObserved(receipts)}`,
    `challenge: ${challengeText(all)}`,
    `app token used: ${receipts.some((r) => r.app_token_used)}`,
    `requests: ${receipts.length}`,
  ];
  if (stop) parts.push(`stopped: ${missingReason(stop)}`);
  if (extra) parts.push(extra);
  return parts.join("; ");
}

function round(n: number, places = 3): number {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

interface RowInput {
  key: SourceKey;
  url: string;
  status: "available" | "blocked";
  denominator: Measurement;
  captured_at: string;
  anti_bot: string;
  decision: NonNullable<Source["decision"]>;
  decision_reason: string;
  blocked: CaptureReceipt | null;
  evidencePath: (key: SourceKey, receipt: CaptureReceipt) => string;
  reusedEvidencePath?: string | null;
  throughput?: ThroughputMeasured | null;
  download_rate?: Source["download_rate"] | null;
}

function row(input: RowInput): Source {
  const source: Source = {
    key: input.key,
    url: input.url,
    status: input.status,
    denominator: input.denominator,
    anti_bot: input.anti_bot,
    decision: input.decision,
    decision_reason: input.decision_reason,
    captured_at: input.captured_at,
  };
  if (input.throughput) source.throughput = input.throughput;
  if (input.download_rate) source.download_rate = input.download_rate;
  const hours = projectedHoursForSource({
    denominator: input.denominator,
    throughput: input.throughput ?? undefined,
    download_rate: input.download_rate ?? undefined,
  });
  if (hours !== null) source.projected_full_capture_hours = round(hours);
  if (input.status === "blocked" && input.blocked) {
    source.blocked_evidence = blockedEvidence(
      input.blocked,
      input.reusedEvidencePath ?? input.evidencePath(input.key, input.blocked),
    );
  }
  return source;
}

function pagedDecision(
  name: string,
  denominator: Measurement,
  throughput: ThroughputMeasured | null,
  missing: string | null,
): { decision: NonNullable<Source["decision"]>; reason: string } {
  const hours = projectedHoursForSource({ denominator, throughput: throughput ?? undefined });
  if (hours === null) {
    return {
      decision: "ingest",
      reason: `${name}: paged Socrata API, planned as ingest; projection not measured (${missing ?? denominator.missing_reason ?? "no rate"})`,
    };
  }
  const rate = (throughput as ThroughputMeasured).rows_per_minute_median;
  if (exceedsDecisionThreshold(hours)) {
    return {
      decision: "runtime retrieval",
      reason: `${name}: full backfill projected ${round(hours, 1)} h at a median ${Math.round(rate)} rows/min, above 48 h; retrieve at runtime and ingest incrementally by :updated_at`,
    };
  }
  return {
    decision: "ingest",
    reason: `${name}: full backfill projected ${round(hours, 2)} h at a median ${Math.round(rate)} rows/min (within 48 h); incremental by :updated_at`,
  };
}

export function assembleSources(r: Us1Results, opts: AssembleOptions): Source[] {
  const evidencePath = opts.evidencePath ?? defaultEvidencePath;
  const rows = new Map<SourceKey, Source>();

  // TCAD certified export
  const tcadDl = r.tcad.download_rate;
  rows.set(
    "tcad_certified",
    row({
      key: "tcad_certified",
      url: r.tcad.export_url ?? r.tcad.url,
      status: r.tcad.status,
      denominator: r.tcad.assessed_parcel_count,
      captured_at: r.tcad.assessed_parcel_count.captured_at,
      anti_bot: antiBot(r.tcad.receipts),
      decision: "bulk download",
      decision_reason: tcadDl
        ? `single certified export file downloaded once in ${round(tcadDl.seconds / 60, 1)} min (${round(tcadDl.megabytes_per_minute, 1)} MB/min); A-04 loads it`
        : `single certified export file; not downloaded: ${r.tcad.assessed_parcel_count.missing_reason ?? "unknown"}`,
      blocked: r.tcad.blocked_receipt,
      evidencePath,
      download_rate: tcadDl,
    }),
  );

  // TCAD supplemental exports: listed, never downloaded
  const listing = listTcadSupplemental(r.tcad.links);
  const landingBlocked = r.tcad.links === null && r.tcad.blocked_receipt !== null;
  const landingReceipt = r.tcad.receipts[0] ?? null;
  rows.set(
    "tcad_supplemental",
    row({
      key: "tcad_supplemental",
      url: listing.urls[0] ?? r.tcad.url,
      status: landingBlocked ? "blocked" : "available",
      denominator: {
        value: null,
        missing_reason: landingBlocked
          ? `not listed: public-information page ${missingReason(r.tcad.blocked_receipt as CaptureReceipt)}`
          : `listed, not downloaded in A-01: ${listing.count} supplemental export file(s) listed`,
        source_url: r.tcad.url,
        captured_at: landingReceipt?.captured_at ?? opts.assembledAt,
      },
      captured_at: landingReceipt?.captured_at ?? opts.assembledAt,
      anti_bot: antiBot(landingReceipt ? [landingReceipt] : []),
      decision: "bulk download",
      decision_reason:
        "supplemental roll exports are the incremental property feed (A-12); listed only in A-01",
      blocked: landingBlocked ? r.tcad.blocked_receipt : null,
      evidencePath,
    }),
  );

  // TCAD parcel GIS: count only
  rows.set(
    "tcad_gis",
    row({
      key: "tcad_gis",
      url: r.gis.url,
      status: r.gis.status,
      denominator: r.gis.gis_feature_count,
      captured_at: r.gis.receipt.captured_at,
      anti_bot: antiBot(r.gis.receipts),
      decision: "ingest",
      decision_reason:
        "count-only probe in A-01; GIS is not the population; coordinates are paged at 2,000 features per request in A-05 through the kit arcgis-feature-service adapter",
      blocked: r.gis.blocked_receipt,
      evidencePath,
    }),
  );

  // Austin permits
  const austinDecision = pagedDecision(
    "Austin issued permits",
    r.austin.denominator,
    r.austin.throughput,
    r.austin.throughput_missing_reason,
  );
  const austin = row({
    key: "austin_permits",
    url: r.austin.url,
    status: r.austin.status,
    denominator: r.austin.denominator,
    captured_at: r.austin.denominator.captured_at,
    anti_bot: antiBot(r.austin.receipts),
    decision: austinDecision.decision,
    decision_reason: austinDecision.reason,
    blocked: r.austin.blocked_receipt,
    evidencePath,
    throughput: r.austin.throughput,
  });
  austin.tcad_id_null_count = r.austin.tcad_id_null_count;
  if (r.austin.located_in_other_jurisdictions.length > 0) {
    austin.located_in_other_jurisdictions = r.austin.located_in_other_jurisdictions;
  }
  rows.set("austin_permits", austin);

  // Other jurisdictions: a pointer row; the permits block (US2) classifies each one
  rows.set(
    "other_jurisdictions",
    row({
      key: "other_jurisdictions",
      url: OTHER_JURISDICTIONS_URL,
      status: "available",
      denominator: {
        value: null,
        missing_reason:
          "per jurisdiction: each Census place with land in Travis County is classified in the permits block (US2); no countywide count exists",
        source_url: OTHER_JURISDICTIONS_URL,
        captured_at: opts.assembledAt,
      },
      captured_at: opts.assembledAt,
      anti_bot: "not probed as one source; each jurisdiction's evidence page is probed in US2",
      decision: "runtime retrieval",
      decision_reason:
        "no countywide bulk source; each jurisdiction's own system is classified supported, records request or no public history in the permits block",
      blocked: null,
      evidencePath,
    }),
  );

  // TX Comptroller: denominator = Travis-coded rows; statewide kept as the A-07 lookup set
  const comptrollerDecision = pagedDecision(
    "Comptroller franchise-tax holders (Travis-coded)",
    r.comptroller.travis_coded_rows,
    r.comptroller.throughput,
    r.comptroller.throughput_missing_reason,
  );
  const comptroller = row({
    key: "tx_comptroller",
    url: r.comptroller.url,
    status: r.comptroller.status,
    denominator: r.comptroller.travis_coded_rows,
    captured_at: r.comptroller.travis_coded_rows.captured_at,
    anti_bot: antiBot(r.comptroller.receipts),
    decision: comptrollerDecision.decision,
    decision_reason: `${comptrollerDecision.reason}; statewide rows are the A-07 identity lookup set`,
    blocked: r.comptroller.blocked_receipt,
    evidencePath,
    throughput: r.comptroller.throughput,
  });
  comptroller.travis_coded_rows = r.comptroller.travis_coded_rows;
  comptroller.statewide_rows = r.comptroller.statewide_rows;
  rows.set("tx_comptroller", comptroller);

  // BBB
  rows.set(
    "bbb",
    row({
      key: "bbb",
      url: r.bbb.url,
      status: r.bbb.status,
      denominator: {
        value: null,
        missing_reason:
          r.bbb.status === "blocked" && r.bbb.blocked_receipt
            ? `not counted: ${missingReason(r.bbb.blocked_receipt)}; advertised listing totals are not harvestable counts`
            : "not counted in A-01: advertised listing totals are not harvestable counts; bounded harvest decided in A-08",
        source_url: r.bbb.url,
        captured_at: r.bbb.captured_at,
      },
      captured_at: r.bbb.captured_at,
      anti_bot: antiBot(
        r.bbb.receipts,
        r.bbb.reused ? "reused the recorded observation; no new request" : undefined,
        r.bbb.blocked_receipt,
      ),
      decision: "runtime retrieval",
      decision_reason: BBB_DECISION_REASON,
      blocked: r.bbb.blocked_receipt,
      evidencePath,
      reusedEvidencePath: r.bbb.evidence_path,
    }),
  );

  // Overture
  rows.set(
    "overture",
    row({
      key: "overture",
      url: r.overture.url,
      status: r.overture.status,
      denominator: r.overture.denominator,
      captured_at: r.overture.captured_at,
      anti_bot: antiBot(r.overture.receipts),
      decision: "bulk download",
      decision_reason: "optional source distributed as bulk files; licence gate decided in A-09",
      blocked: r.overture.blocked_receipt,
      evidencePath,
    }),
  );

  // Contractor licensing
  rows.set(
    "contractor_licensing",
    row({
      key: "contractor_licensing",
      url: r.licensing.url,
      status: r.licensing.status,
      denominator: r.licensing.denominator,
      captured_at: r.licensing.captured_at,
      anti_bot: antiBot(r.licensing.receipts),
      decision: "runtime retrieval",
      decision_reason: r.licensing.decision_reason,
      blocked: r.licensing.blocked_receipt,
      evidencePath,
    }),
  );

  return SOURCE_KEYS.map((k) => rows.get(k) as Source);
}

export function assembleParcel(r: Pick<Us1Results, "tcad" | "gis">): Parcel {
  const assessed = r.tcad.assessed_parcel_count;
  const gis = r.gis.gis_feature_count;
  const gap = computeGap(assessed, gis);
  const parcel: Parcel = {
    canonical_source: CANONICAL_PARCEL_SOURCE,
    assessed_parcel_count: assessed.value,
    assessed_parcel_count_measurement: assessed,
    roll_year: r.tcad.roll_year,
    gis_feature_count: gis.value,
    gis_feature_count_measurement: gis,
    gap_pct: gap.gap_pct,
    discrepancy_threshold_pct: DISCREPANCY_THRESHOLD_PCT,
    identifier_proven: r.tcad.scan?.identifier_proven ?? false,
  };
  if (gap.gap_reason) parcel.gap_reason = gap.gap_reason;
  if (r.tcad.certification_date) parcel.certification_date = r.tcad.certification_date;

  if (assessed.value !== null && gis.value !== null && assessed.value !== gis.value) {
    const diff = gis.value - assessed.value;
    const pct = typeof gap.gap_pct === "number" ? gap.gap_pct : 0;
    parcel.discrepancy_explanation =
      `GIS has ${Math.abs(diff)} ${diff < 0 ? "fewer" : "more"} features than the certified roll (${pct}% of the roll)` +
      (pct > DISCREPANCY_THRESHOLD_PCT ? "; above 2%, so GIS-only seeding is blocked" : "") +
      "; the certified roll is the canonical denominator";
    if (diff < 0) parcel.separately_assessed_without_geometry = "acknowledged";
  } else if (gap.gap_pct === "unknown") {
    parcel.discrepancy_explanation = `gap unknown (${gap.gap_reason ?? "not measured"}); the certified roll stays the canonical denominator and GIS is never substituted`;
  }

  const scan = r.tcad.scan;
  if (scan) {
    if (scan.identifier_name) parcel.identifier_name = scan.identifier_name;
    if (scan.identifier_layout_name) parcel.identifier_layout_name = scan.identifier_layout_name;
    if (scan.identifier_format) parcel.identifier_format = scan.identifier_format;
    parcel.deed_or_sale_dates_present = scan.deed_or_sale_dates_present;
  }

  const receipt = r.tcad.export_receipt;
  if (
    receipt &&
    r.tcad.export_path &&
    r.tcad.download_rate &&
    receipt.status !== null &&
    (receipt.outcome === "ok" || receipt.outcome === "throttled-then-ok")
  ) {
    parcel.export_receipt = {
      url: receipt.url,
      // the TCAD export is a download: GET or HEAD only (a POST belongs to the GIS runner)
      method: receipt.method === "HEAD" ? "HEAD" : "GET",
      status: receipt.status,
      bytes: receipt.bytes,
      sha256: receipt.sha256,
      captured_at: receipt.captured_at,
      user_agent: receipt.user_agent,
      attempts: receipt.attempts,
      outcome: receipt.outcome,
      ...(receipt.resumes === undefined ? {} : { resumes: receipt.resumes }),
      file_path: `pipeline/data/raw/tcad/${basename(r.tcad.export_path)}`,
      seconds: round(r.tcad.download_rate.seconds),
      megabytes_per_minute: round(r.tcad.download_rate.megabytes_per_minute),
      roll_year: r.tcad.roll_year,
      ...(r.tcad.certification_date ? { certification_date: r.tcad.certification_date } : {}),
    };
  }
  return parcel;
}

/**
 * BBB next step (PO decision 2026-10-20): the official BBB API application is the lawful
 * route and is recorded, never filed; the A-08 fallback is a bounded bbb-harvest.
 */
export const BBB_NEXT_STEP = `The official BBB API application (BBB API Registration Form at developer.bbb.org) is ${NOT_FILED}; the challenge is never solved; a bounded bbb-harvest that stops on 403 is the A-08 fallback`;

export const BBB_DECISION_REASON = `challenge-protected listing; the official BBB API application is ${NOT_FILED}, so the route is a bounded bbb-harvest that stops on 403 (A-08); a challenge is never solved`;

export function assembleBbbEnrichment(bbb: EvidenceProbe, opts: AssembleOptions): BbbEnrichment {
  const evidencePath = opts.evidencePath ?? defaultEvidencePath;
  const out: BbbEnrichment = {
    status: bbb.status,
    evidence_url: bbb.url,
    evidence_captured_at: bbb.captured_at,
    next_step: BBB_NEXT_STEP,
  };
  if (bbb.status === "blocked" && bbb.blocked_receipt) {
    out.evidence_path = bbb.evidence_path ?? evidencePath("bbb", bbb.blocked_receipt);
  }
  return out;
}

export function assembleUs1(r: Us1Results, opts: AssembleOptions): Us1Blocks {
  return {
    sources: assembleSources(r, opts),
    parcel: assembleParcel(r),
    enrichment: { bbb: assembleBbbEnrichment(r.bbb, opts) },
  };
}
