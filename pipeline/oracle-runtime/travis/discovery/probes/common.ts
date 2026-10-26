// Shared helpers for the A-01 probes: the outcome every probe returns, and how a blocked
// or failed capture becomes a null Measurement with an honest reason (FR-006, FR-006e).
import { MAX_ATTEMPTS, type CaptureReceipt, type SourceClient } from "../../lib/source-client.js";
import type { Measurement } from "../catalog.schema.js";

export interface ProbeDeps {
  client: SourceClient;
  /** Clock for measurement windows (page timings). Receipts use the client's own clock. */
  now: () => Date;
}

/** What every probe returns; JSON-serializable so a Restate step can journal it. */
export interface ProbeOutcome {
  status: "available" | "blocked";
  receipts: CaptureReceipt[];
  /** The receipt that stopped the source (outcome `blocked` or `failed`), if any. */
  blocked_receipt: CaptureReceipt | null;
}

export function stopsSource(receipt: CaptureReceipt): boolean {
  return receipt.outcome === "blocked" || receipt.outcome === "failed";
}

/** The reason text recorded when a capture gives no value. */
export function missingReason(receipt: CaptureReceipt): string {
  const at = receipt.captured_at;
  if (receipt.outcome === "blocked") {
    if (receipt.blocked_reason === "timeout") {
      return `blocked: timeout after ${receipt.timeout_ms ?? 0} ms at ${at}`;
    }
    if (receipt.blocked_reason === "challenge") {
      const signal = receipt.challenge_signal ? `; ${receipt.challenge_signal}` : "";
      return `blocked: challenge seen (HTTP ${receipt.status ?? "none"}${signal}) at ${at}`;
    }
    return `blocked: HTTP ${receipt.status ?? "none"} at ${at}`;
  }
  if (receipt.outcome === "failed") {
    const status = receipt.status;
    if (status !== null && (status === 429 || status >= 500) && receipt.attempts >= MAX_ATTEMPTS) {
      return `throttled: ${MAX_ATTEMPTS} attempts exhausted (HTTP ${status}) at ${at}`;
    }
    if (status === null) {
      return `failed: network error, no HTTP response (${receipt.error ?? "no message"}) at ${at}`;
    }
    const broken = brokenDownload(receipt);
    if (broken) {
      return `failed: HTTP ${status}, the download broke at ${brokenAt(broken)} (${broken.error}) after ${receipt.attempts} attempt(s)${resumesText(receipt)} at ${at}`;
    }
    const why = receipt.error ? ` (${receipt.error})` : "";
    return `failed: HTTP ${status}${why} after ${receipt.attempts} attempt(s) at ${at}`;
  }
  return `not measured at ${at}`;
}

/** A reachable source whose 2xx download stream broke part-way (not a block). */
export interface BrokenDownload {
  status: number;
  bytes: number;
  content_length: number | null;
  error: string;
}

/** The broken-download facts of a receipt, or null when it is not one. */
export function brokenDownload(receipt: CaptureReceipt): BrokenDownload | null {
  const body = receipt.incomplete_body;
  const status = receipt.status;
  if (receipt.outcome !== "failed" || body === undefined || status === null) return null;
  if (status < 200 || status >= 300) return null;
  return {
    status,
    bytes: body.bytes,
    content_length: body.content_length,
    error: receipt.error ?? "stream ended early",
  };
}

/** " and N range resume(s)" when a download resumed (FR-003); "" otherwise or on old receipts. */
export function resumesText(receipt: CaptureReceipt): string {
  const resumes = receipt.resumes ?? 0;
  return resumes > 0 ? ` and ${resumes} range resume(s)` : "";
}

/** "<bytes> of <content-length> bytes" (or "of an unknown length"). */
export function brokenAt(broken: BrokenDownload): string {
  return broken.content_length === null
    ? `${broken.bytes} bytes of an unknown length`
    : `${broken.bytes} of ${broken.content_length} bytes`;
}

export function nullMeasurement(
  sourceUrl: string,
  capturedAt: string,
  reason: string,
  method?: string,
): Measurement {
  const m: Measurement = {
    value: null,
    missing_reason: reason,
    source_url: sourceUrl,
    captured_at: capturedAt,
  };
  if (method !== undefined) m.method = method;
  return m;
}

/** A null measurement for a source that was never asked because an earlier step stopped it. */
export function notAskedMeasurement(
  sourceUrl: string,
  stoppedBy: CaptureReceipt,
  method?: string,
): Measurement {
  return nullMeasurement(
    sourceUrl,
    stoppedBy.captured_at,
    `not measured: source stopped earlier (${missingReason(stoppedBy)})`,
    method,
  );
}

/** Summarizes observed rate limits across receipts ("none observed" when there were none). */
export function rateLimitsObserved(receipts: readonly CaptureReceipt[]): string {
  const seen = receipts.map((r) => r.rate_limits_observed).filter((x): x is string => x !== null);
  return seen.length > 0 ? seen.join("; ") : "none observed";
}

/** Normalizes a captured_at to second precision UTC ("2026-01-01T00:00:00Z" style kept). */
export function utc(date: Date): string {
  return date.toISOString();
}
