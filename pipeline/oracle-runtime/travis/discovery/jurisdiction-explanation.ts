// PO decision 2026-10-20: no records request, Public Information Act request or API
// application is filed in this project. Every permit row that is not `supported` therefore
// carries `blocked_explanation`: one evaluator-readable text, built only from the row's own
// recorded fields, that says (a) why no permit history is captured, (b) what was tried and
// (c) what would unblock it, and that the request is not filed. Pure, no I/O; the class and
// status rules (status-map.ts) are untouched.
//
// Review fixes (CR-A-01):
// - OR-M2: a stop whose saved response names a web application firewall is a block,
//   whatever its status (San Leanna's HTTP 406 names Mod Security); it is never called a
//   content-negotiation refusal;
// - OR-m5: a row whose only evidence is the Census place listing (no jurisdiction site
//   answered) says so, never calls the Census file "the official page", and marks an
//   unverified request channel;
// - OR-m6: Austin-issued permits located here are split into full purpose (inside the city
//   limits) and ETJ (outside them).
import { wafSignal, type SavedResponse } from "../lib/source-client.js";
import type { Jurisdiction } from "./catalog.schema.js";

export const PO_DECISION = "PO decision 2026-10-20";
export const NOT_FILED = `not filed (${PO_DECISION})`;

/** The blocked-row note wording before the PO decision, and its replacement. */
export const LEGACY_BLOCKED_NOTE =
  "classified records request until the records request is answered";
export const BLOCKED_NOTE = `classified records request; the records request is ${NOT_FILED}`;
/** Earlier wordings migrated to BLOCKED_NOTE (the first draft of this decision included). */
const LEGACY_BLOCKED_NOTES = [
  LEGACY_BLOCKED_NOTE,
  `classified records request (the records request is ${NOT_FILED})`,
];

/** The Austin dataset that captures Austin-issued permits located in other jurisdictions. */
const AUSTIN_DATASET = "Austin dataset 3syk-w9eu";

export interface ExplainOptions {
  /** The challenge marker recorded with the stop (receipt or evidence file), if any. */
  challengeSignal?: string | null;
  /** The firewall that blocked the stop (`firewallBlock`), if the saved response names one. */
  firewall?: string | null;
}

/**
 * "the site's web application firewall (Mod Security)" when the saved stop response names a
 * WAF (OR-M2), or null. The name is given only when the body or headers print it.
 */
export function firewallBlock(saved: SavedResponse | null): string | null {
  if (saved === null || wafSignal(saved) === null) return null;
  const text = `${saved.body} ${Object.values(saved.headers).join(" ")}`;
  return /\bmod[_ ]?security\b/i.test(text)
    ? "the site's web application firewall (Mod Security)"
    : "the site's web application firewall";
}

/** The saved stop response of a receipt (its bounded excerpt), for `firewallBlock`. */
export function savedStop(receipt: {
  status: number | null;
  stop_evidence?: { headers: Record<string, string>; excerpt_base64: string } | undefined;
}): SavedResponse | null {
  const ev = receipt.stop_evidence;
  if (!ev) return null;
  return {
    status: receipt.status,
    headers: ev.headers,
    body: Buffer.from(ev.excerpt_base64, "base64").toString("utf8"),
  };
}

/** The Census place listing is evidence that a place exists, not about its permits (OR-m5). */
export function isCensusListingOnly(row: Pick<Jurisdiction, "evidence_url">): boolean {
  try {
    return /(?:^|\.)census\.gov$/i.test(new URL(row.evidence_url).hostname);
  } catch {
    return false;
  }
}

function siteWord(row: Jurisdiction): string {
  return /^village\b/i.test(row.records_request?.recipient_office ?? "") ? "village" : "city";
}

function day(iso: string): string {
  return iso.slice(0, 10);
}

/** A plain-language name for a recorded challenge marker (never the raw quoted marker). */
export function describeChallenge(signal: string | null | undefined): string | null {
  if (!signal) return null;
  if (/web application firewall|mod[_ ]?security/i.test(signal)) {
    return "the site's web application firewall";
  }
  if (/cloudflare|cf-mitigated/i.test(signal)) return "a Cloudflare challenge";
  if (/access denied/i.test(signal)) return "an Access Denied page";
  return "a bot challenge";
}

function failureText(be: NonNullable<Jurisdiction["blocked_evidence"]>, short = false): string {
  if (be.timeout_ms !== undefined) return `no answer within ${be.timeout_ms} ms`;
  if (be.http_status === undefined)
    return short ? "network error" : "network error, no HTTP response";
  return `HTTP ${be.http_status}`;
}

function whySentence(row: Jurisdiction, opts: ExplainOptions): string {
  const be = row.blocked_evidence;
  if (row.status === "blocked" && be) {
    const at = day(be.captured_at);
    if (opts.firewall) {
      return `No permit history was captured: blocked by ${opts.firewall}, ${failureText(be)}, on ${at}, and it is not requested again (no retry, no identity change)`;
    }
    if (be.outcome === "blocked") {
      if (be.timeout_ms !== undefined) {
        return `No permit history was captured: the official page did not answer within ${be.timeout_ms} ms on ${at}, and it is not requested again (no retry, no identity change)`;
      }
      const challenge = describeChallenge(opts.challengeSignal);
      return `No permit history was captured: the official site refused automated access with HTTP ${be.http_status ?? "none"}${challenge ? ` (${challenge})` : ""} on ${at}, and it is not requested again (no retry, no identity change, no challenge solved)`;
    }
    return `No permit history was captured: the official evidence page could not be read on ${at} (${failureText(be)}), so the permit system is known only from research`;
  }
  switch (row.status) {
    case "manual-only":
      return `No permit history can be captured: permits are filed in an account-based application portal that shows no public permit history${row.vendor ? ` (portal: ${row.vendor})` : ""}`;
    case "custodian-only":
      if (isCensusListingOnly(row)) {
        return `No permit history can be captured: the ${siteWord(row)} site did not answer; permit system unknown`;
      }
      return "No permit history can be captured: permit files are kept on paper or in the office and no online permit system was found";
    case "delegated":
      return `No permit history of its own: permits here are issued by ${row.issued_by ?? "another body"}`;
    case "unavailable":
      return "No permit history can be captured: no permit records were found for this jurisdiction";
    default:
      return `No permit history is captured: the row is ${row.status}`;
  }
}

function permitCount(n: number): string {
  return n === 1 ? "1 permit" : `${n} permits`;
}

function austinClause(row: Jurisdiction): string {
  const here = row.austin_issued_located_here?.value;
  if (row.key === "austin" || typeof here !== "number" || here <= 0) return "";
  const owner = row.jurisdiction.endsWith("s") ? `${row.jurisdiction}'` : `${row.jurisdiction}'s`;
  const fp = row.austin_issued_full_purpose?.value;
  const etj = row.austin_issued_etj?.value;
  if (typeof fp === "number" && typeof etj === "number") {
    const parts: string[] = [];
    if (fp > 0) parts.push(`${permitCount(fp)} inside the city limits (full purpose)`);
    if (etj > 0) parts.push(`${permitCount(etj)} in its ETJ (outside the city limits)`);
    if (fp === 0) parts.push("none inside the city limits (full purpose)");
    const other = here - fp - etj;
    if (other > 0) parts.push(`${permitCount(other)} under another Austin label`);
    return `; ${owner} own permits are not captured, but Austin-issued permits located here are captured through ${AUSTIN_DATASET}: ${parts.join(", ")}`;
  }
  const permits =
    here === 1
      ? "1 Austin-issued permit located here is"
      : `${here} Austin-issued permits located here are`;
  return `; ${owner} own permits are not captured, but ${permits} captured through ${AUSTIN_DATASET}`;
}

function triedSentence(row: Jurisdiction): string {
  const be = row.blocked_evidence;
  if (be) {
    return `Tried: one identified request to ${be.url} on ${day(be.captured_at)} (${failureText(be, true)}); evidence ${be.evidence_path}`;
  }
  const answer =
    row.evidence_http_status === undefined
      ? "with no recorded HTTP status"
      : `answered HTTP ${row.evidence_http_status}`;
  if (isCensusListingOnly(row)) {
    return `Tried: no ${siteWord(row)} site answered on ${day(row.evidence_captured_at)} (see notes); the only evidence is the Census place listing ${row.evidence_url}, which ${answer} and names the place but says nothing about its permits`;
  }
  return `Tried: one identified request to the official page ${row.evidence_url} on ${day(row.evidence_captured_at)} ${answer}`;
}

function unblockSentence(row: Jurisdiction): string {
  const rr = row.records_request;
  if (rr) {
    const via = rr.request_portal_url ?? rr.request_email ?? "no recorded channel";
    const unverified =
      rr.channel_verified === false ? " (channel unverified: it did not answer)" : "";
    return `To unblock: a records request to ${rr.recipient_office} via ${via}${unverified}; ${NOT_FILED}`;
  }
  if (row.status === "delegated") {
    return `To unblock: nothing in this jurisdiction; the issuing body's records cover it (no request ${NOT_FILED})`;
  }
  return `To unblock: no lawful request route is recorded; no request is ${NOT_FILED}`;
}

/** The explanation for a non-supported row, or null for a supported row. */
export function explainJurisdiction(row: Jurisdiction, opts: ExplainOptions = {}): string | null {
  if (row.status === "supported") return null;
  return `${whySentence(row, opts)}${austinClause(row)}. ${triedSentence(row)}. ${unblockSentence(row)}.`;
}

/** The row with `blocked_explanation` set (non-supported) or removed (supported). */
export function withExplanation(row: Jurisdiction, opts: ExplainOptions = {}): Jurisdiction {
  const { blocked_explanation: _old, ...rest } = row;
  const text = explainJurisdiction(rest, opts);
  const out: Jurisdiction = { ...rest };
  if (text !== null) {
    // keep the explanation just before notes so the row reads in order
    const { notes, ...head } = out;
    return notes === undefined
      ? { ...head, blocked_explanation: text }
      : { ...head, blocked_explanation: text, notes };
  }
  return out;
}

/** Replaces the pre-decision blocked-row note wording; idempotent. */
export function migrateBlockedNote(notes: string | undefined): string | undefined {
  if (notes === undefined) return undefined;
  return LEGACY_BLOCKED_NOTES.reduce((text, old) => text.split(old).join(BLOCKED_NOTE), notes);
}
