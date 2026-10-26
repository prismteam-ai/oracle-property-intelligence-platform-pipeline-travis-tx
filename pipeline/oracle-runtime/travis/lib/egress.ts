// OR-B1: the pre-run egress check of every command that sends a request to a source
// (`discover`, `resolve -- <key> captured`, `refresh-tcad-landing`, `reprobe-jurisdictions`).
//
// FR-006a forbids a retry from a changed network address, and a VPN counts as one
// (research R10; docs/decisions/DEC-A-01-source-access.md D-1, D-3). Before any request,
// the command reads the Cloudflare trace and keeps only its `loc` (the egress country):
// the `ip=` line is never parsed, kept, logged or returned. It then refuses (exit 2) when
// - ORACLE_EXPECT_EGRESS is set and is not the observed country, or
// - the run's recorded egress (the reference) is not the observed country, or
// - no reference is recorded and ORACLE_EXPECT_EGRESS is not set, when one is required.
// The observed country is recorded with the run (discover) or the amendment and evidence
// (offline commands), so every receipt names the egress it was made from.
import { USER_AGENT, type FetchLike } from "./source-client.js";

export const TRACE_URL = "https://www.cloudflare.com/cdn-cgi/trace";
export const EGRESS_METHOD =
  "Cloudflare trace loc (www.cloudflare.com/cdn-cgi/trace); the IP address is not read";
export const EXPECT_ENV = "ORACLE_EXPECT_EGRESS";
const COUNTRY = /^[A-Z]{2}$/;
const TRACE_TIMEOUT_MS = 10_000;

export interface Egress {
  country: string;
  captured_at: string;
  method: string;
}

export interface EgressCheckOptions {
  fetch?: FetchLike;
  now?: () => Date;
  env?: Record<string, string | undefined>;
  /** The run's recorded egress country (null when the run recorded none). */
  reference: string | null;
  /** True for commands acting on an existing run: a reference or ORACLE_EXPECT_EGRESS is needed. */
  requireReference: boolean;
}

export type EgressCheck = { ok: true; egress: Egress } | { ok: false; reason: string };

/** The `loc` value of a Cloudflare trace body, or null. Other lines (ip=...) are skipped. */
export function traceCountry(body: string): string | null {
  for (const line of body.split(/\r?\n/)) {
    if (!line.startsWith("loc=")) continue;
    const loc = line.slice(4).trim();
    return COUNTRY.test(loc) ? loc : null;
  }
  return null;
}

/** Why the observed egress may not send requests for this run, or null when it may. */
export function egressRefusal(
  observed: string,
  reference: string | null,
  expected: string | undefined,
  requireReference: boolean,
): string | null {
  if (expected !== undefined) {
    if (!COUNTRY.test(expected)) {
      return `${EXPECT_ENV} must be a two-letter country code, not "${expected.slice(0, 8)}"`;
    }
    if (observed !== expected) {
      return `egress country is ${observed}, but ${EXPECT_ENV} is ${expected}; switch off any VPN or proxy and use the network the run was made from`;
    }
  }
  if (reference !== null && observed !== reference) {
    return `egress country is ${observed}, but the run recorded ${reference}; a request from a changed network address is a retry with a changed identity (FR-006a)`;
  }
  if (reference === null && expected === undefined && requireReference) {
    return `the run records no egress country; set ${EXPECT_ENV}=<country> to confirm the network these requests may come from`;
  }
  return null;
}

/** Reads the egress country (one request to the Cloudflare trace) and checks it. */
export async function checkEgress(options: EgressCheckOptions): Promise<EgressCheck> {
  const fetchImpl: FetchLike = options.fetch ?? ((url, init) => globalThis.fetch(url, init));
  const env = options.env ?? process.env;
  const expectedRaw = env[EXPECT_ENV];
  const expected =
    expectedRaw === undefined || expectedRaw.trim() === ""
      ? undefined
      : expectedRaw.trim().toUpperCase();
  const at = (options.now ?? (() => new Date()))();
  let country: string | null;
  try {
    const response = await fetchImpl(TRACE_URL, {
      method: "GET",
      headers: { "user-agent": USER_AGENT, accept: "text/plain" },
      signal: AbortSignal.timeout(TRACE_TIMEOUT_MS),
      redirect: "follow",
    });
    country = response.ok ? traceCountry(await response.text()) : null;
  } catch {
    country = null;
  }
  if (country === null) {
    return {
      ok: false,
      reason: "egress country unknown (the Cloudflare trace gave no loc); nothing was sent",
    };
  }
  const refusal = egressRefusal(country, options.reference, expected, options.requireReference);
  if (refusal !== null) return { ok: false, reason: `${refusal}; nothing was sent` };
  return {
    ok: true,
    egress: { country, captured_at: at.toISOString(), method: EGRESS_METHOD },
  };
}

/**
 * The reference egress for the operator's next request (CR2-3 / OR-N2): the newest
 * amendment made on the operator's own network (`venue: "operator"`) that recorded an
 * egress, else the discovery run's own. A CI runner's amendment (`venue: "runner"`) or one
 * that records no venue is never a reference: a US runner's egress would otherwise refuse
 * the operator's network and accept a US VPN.
 */
export function catalogEgressReference(catalog: {
  discovery_egress?: { country: string } | undefined;
  amendments?:
    ReadonlyArray<{ egress_country?: string | undefined; venue?: string | undefined }> | undefined;
}): string | null {
  const operator = [...(catalog.amendments ?? [])]
    .reverse()
    .find((a) => a.venue === "operator" && a.egress_country);
  return operator?.egress_country ?? catalog.discovery_egress?.country ?? null;
}
