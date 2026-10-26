// T024: evidence probes for sources A-01 records but does not measure in volume.
//
// - BBB: reuse the recorded challenge observation, or make at most one request (attempt
//   budget 1, so even a 429 is not retried). A challenge is recorded, never solved.
// - Overture: one capture of the licence page; the denominator stays null with the fixed
//   reason (FR-001b).
// - Contractor licensing: TDLR and the HB 3344 bill-history page, recorded as evidence for
//   "no statewide roofing licence" (A5: evidence only, not identity).
// - TCAD supplemental exports: listed from the TCAD landing page, never downloaded.
import { z } from "zod";
import { detectChallengeSignal, type CaptureReceipt } from "../../lib/source-client.js";
import type { Measurement } from "../catalog.schema.js";
import { missingReason, nullMeasurement, stopsSource, type ProbeDeps } from "./common.js";
import type { TcadLinks } from "./tcad.js";

/** BBB Austin roofing-contractor listing (lead; confirm at the live run, T048). */
export const BBB_URL = "https://www.bbb.org/us/tx/austin/category/roofing-contractors";
/** Overture Maps attribution and licence page (lead; confirm at T048). */
export const OVERTURE_LICENCE_URL = "https://docs.overturemaps.org/attribution/";
/** Texas Department of Licensing and Regulation: the state licensing programs. */
export const TDLR_URL = "https://www.tdlr.texas.gov/";
/** Texas Legislature Online history of HB 3344 (89th Regular Session). */
export const HB3344_URL =
  "https://capitol.texas.gov/BillLookup/History.aspx?LegSess=89R&Bill=HB3344";

export const OVERTURE_MISSING_REASON =
  "not measured in A-01: optional source; licence gate decided in A-09";
export const NO_STATEWIDE_ROOFING_LICENCE = "no statewide roofing licence";

/**
 * An HTML/text page that is not a challenge interstitial. The source client already stops
 * on any explicit challenge signal (`detectChallengeSignal`); a normal page carrying an
 * injected beacon script (for example `/cdn-cgi/challenge-platform/`) passes.
 */
export const ChallengeFreePage = z
  .string()
  .refine((body) => detectChallengeSignal({ status: 200, headers: {}, body }) === null, {
    message: "challenge page",
  });

/** A previously recorded blocked observation (the blocked_evidence shape). */
export interface PriorObservation {
  http_status?: number;
  timeout_ms?: number;
  error?: string;
  captured_at: string;
  url: string;
  evidence_path: string;
  body_sha256: string;
  attempts: number;
  user_agent: string;
  outcome: "blocked" | "failed";
  geo_signal: string;
}

export interface EvidenceProbe {
  status: "available" | "blocked";
  receipts: CaptureReceipt[];
  blocked_receipt: CaptureReceipt | null;
  url: string;
  captured_at: string;
  /** True when a recorded observation was reused and no request was made. */
  reused: boolean;
  /** Path of the reused evidence file, when reused. */
  evidence_path: string | null;
  /** The marker that identified a challenge, when one was seen. */
  challenge: string | null;
}

export interface OvertureProbe extends EvidenceProbe {
  denominator: Measurement;
}

export interface LicensingProbe {
  status: "available" | "blocked";
  receipts: CaptureReceipt[];
  blocked_receipt: CaptureReceipt | null;
  url: string;
  captured_at: string;
  pages: Array<{ url: string; status: number | null; outcome: string; captured_at: string }>;
  denominator: Measurement;
  decision_reason: string;
}

function receiptFromPrior(prior: PriorObservation): CaptureReceipt {
  const receipt: CaptureReceipt = {
    url: prior.url,
    method: "GET",
    status: prior.http_status ?? null,
    bytes: 0, // the reused evidence records the body digest, not the byte count
    sha256: prior.body_sha256,
    captured_at: prior.captured_at,
    user_agent: prior.user_agent,
    attempts: prior.attempts,
    outcome: prior.outcome,
    geo_signal: prior.geo_signal,
    app_token_used: false,
    timeout_ms: prior.timeout_ms ?? null,
    blocked_reason:
      prior.outcome === "failed"
        ? null
        : prior.timeout_ms !== undefined
          ? "timeout"
          : prior.http_status === 403
            ? "http-403"
            : "challenge",
    rate_limits_observed: null,
  };
  if (prior.error !== undefined) receipt.error = prior.error;
  return receipt;
}

async function observeOnce(deps: ProbeDeps, url: string): Promise<EvidenceProbe> {
  const { receipt } = await deps.client.capture({
    url,
    schema: ChallengeFreePage,
    bodyKind: "text",
    accept: "text/html",
    maxAttempts: 1,
  });
  const stopped = stopsSource(receipt);
  return {
    status: stopped ? "blocked" : "available",
    receipts: [receipt],
    blocked_receipt: stopped ? receipt : null,
    url,
    captured_at: receipt.captured_at,
    reused: false,
    evidence_path: null,
    challenge: receipt.challenge_signal ?? null,
  };
}

/**
 * One observation of an official evidence page (a jurisdiction's permit page, T032): one
 * request, no retry; a 403, timeout or explicit challenge is `blocked`; a 404, a network
 * error or an unexpected body is `failed`.
 */
export function probeEvidencePage(deps: ProbeDeps, url: string): Promise<EvidenceProbe> {
  return observeOnce(deps, url);
}

export async function probeBbb(deps: ProbeDeps, prior?: PriorObservation): Promise<EvidenceProbe> {
  if (prior) {
    const receipt = receiptFromPrior(prior);
    return {
      status: "blocked",
      receipts: [],
      blocked_receipt: receipt,
      url: prior.url,
      captured_at: prior.captured_at,
      reused: true,
      evidence_path: prior.evidence_path,
      challenge: null,
    };
  }
  return observeOnce(deps, BBB_URL);
}

export async function probeOverture(deps: ProbeDeps): Promise<OvertureProbe> {
  const observed = await observeOnce(deps, OVERTURE_LICENCE_URL);
  return {
    ...observed,
    denominator: nullMeasurement(
      OVERTURE_LICENCE_URL,
      observed.captured_at,
      OVERTURE_MISSING_REASON,
    ),
  };
}

export async function probeContractorLicensing(deps: ProbeDeps): Promise<LicensingProbe> {
  const tdlr = await observeOnce(deps, TDLR_URL);
  const bill = await observeOnce(deps, HB3344_URL);
  const receipts = [...tdlr.receipts, ...bill.receipts];
  const pages = receipts.map((r) => ({
    url: r.url,
    status: r.status,
    outcome: r.outcome,
    captured_at: r.captured_at,
  }));
  const blocked = receipts.find(stopsSource) ?? null;
  const pageNote = (r: CaptureReceipt): string =>
    stopsSource(r)
      ? `${r.url} (${missingReason(r)})`
      : `${r.url} (HTTP ${r.status} at ${r.captured_at})`;
  const reason =
    `${NO_STATEWIDE_ROOFING_LICENCE}: Texas has no state roofing-contractor licence ` +
    `(TDLR licensing programs evidence ${pageNote(tdlr.receipts[0] as CaptureReceipt)}; ` +
    `HB 3344 reroofing-licence bill status evidence ${pageNote(bill.receipts[0] as CaptureReceipt)}); ` +
    "contractor identity comes from official Comptroller records, otherwise unresolved (A-07)";
  return {
    status: blocked ? "blocked" : "available",
    receipts,
    blocked_receipt: blocked,
    url: TDLR_URL,
    captured_at: tdlr.captured_at,
    pages,
    denominator: nullMeasurement(
      TDLR_URL,
      tdlr.captured_at,
      `${NO_STATEWIDE_ROOFING_LICENCE}: there is no statewide roofing licence register to count`,
    ),
    decision_reason: reason,
  };
}

export interface SupplementalListing {
  count: number;
  urls: string[];
}

/** Lists the supplemental exports found on the TCAD landing page; nothing is downloaded. */
export function listTcadSupplemental(links: TcadLinks | null): SupplementalListing {
  const urls = links ? links.supplemental.map((s) => s.url) : [];
  return { count: urls.length, urls };
}
