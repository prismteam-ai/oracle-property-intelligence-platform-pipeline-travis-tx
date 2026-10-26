#!/usr/bin/env -S npx tsx
// verify-manifest (A-11 T007/T011, contracts/publish-sequence.md "verify-manifest contract";
// gateways per AM-10 2026-10-26, which amends AM-01 and P0-14; A-16 T078): independent proof
// that every published artifact is what the committed manifest says. "Independent" means what the
// README means: a public gateway CountyLens does not operate, with the bytes hash-checked here.
// Gateways have two roles, and every line carries a plain-facts label (PO wording 2026-10-26):
//
//   counted   gateway.pinata.cloud  "public gateway · also holds our second copy"
//             ipfs.orbitor.dev      "public gateway · holds no copy of ours"
//             An artifact passes ONLY when BOTH match size + SHA-256.
//   fallback  ipfs.filebase.io      "our main storage host · fallback, not counted"
//             Its result is printed alongside and never counts toward the verdict.
//
// Nothing else is ever read: ipfs.io and dweb.link retired on 2026-09-21 (every request answers
// 429 with a Sunset header; docs/decisions/0001-read-path.md Finding 3), storacha.link and
// w3s.link belong to Storacha, whose upload service ended 2026-04-15 (storacha.link now redirects
// to dweb.link), and our CloudFront CID copy is serve infrastructure we run. All of them, and any
// other host, are refused before the first request: they would prove nothing a stranger could
// not fake by trusting us (or prove nothing at all). dget.top was tested 2026-10-26 and timed out.
//
//   npx tsx scripts/verify-manifest.ts runs/<runId>/manifest.json [--gateway <url>]... [--verbose]
//       [--resume-from <prior-log>] [--json <evidence.json>]
//   npx tsx scripts/verify-manifest.ts runs/<runId>/manifest.json --sample      (CI, very small)
//
// `--json <path>` also writes a machine-readable evidence file (schema
// `verify-manifest-evidence.v1`): per artifact the cid, name, expected size + SHA-256, a
// per-gateway { role (counted|fallback), holds_our_copy, label, status, ok, bytes, sha256, ms,
// resumed } map and `independent_ok` (both counted gateways matched), plus a summary.
//
// `--sample` (PO decision 2026-10-25) checks the manifest itself on every gateway exactly as
// below, then only two artifacts: the smallest table part and the smallest CAR (by size, then
// name). A full-county run lists 225 table parts and 15 CARs (about 2.8 GB of CARs) and a full
// check took about two hours locally because Pinata answers 429, so the hosted job checks a
// sample. In a sample the CAR skips Pinata (its gateway answers 429 to CAR downloads, and AM-10
// keeps the CARs on Filebase plus the GitHub Release, not on Pinata): it is read from orbitor and
// Filebase, so it has ONE counted gateway (orbitor), and the output and evidence say so
// (`counted_gateways`). The manifest and the table part are read from both counted gateways. A sample prints
// SAMPLE VERIFIED, never ALL ARTIFACTS VERIFIED, and exits 0 when it passes, like a full run (the
// wording carries the difference; an exit code of 3 broke hosted TC-040, A11-16): 1 = a check
// failed; 2 = usage. The default (no flag) is the full check the operator runs after a publish.
//
// `--resume-from <log>` skips checks a prior run's log shows as ok, keyed by gateway + name + CID
// (a changed CID is re-fetched). A resumed check is not a fresh read: it is recorded with
// `resumed: true` and null status/bytes/sha256, and the verdict line says how many were resumed.
//
// Order: the manifest itself, by its own raw-leaves CIDv1, from every gateway, compared
// byte-for-byte with the local file; the run stops before any artifact is checked when either
// counted gateway does not match. The fallback answering 200 with other bytes is a loud WARNING
// (log + evidence `summary.warnings`), never a stop: it is not counted. Then every artifact: tables by `cid`, car/directory artifacts by `carCid` (never
// the dag-json root as a file). Every GET retries 429/504/timeout up to MAX_ATTEMPTS (5) with
// backoff honouring `Retry-After`; TIMEOUT_MS (default 300000 ms) bounds each attempt. A redirect
// is followed only when its target stays on the same gateway's domain (host-generic: covers a
// CID-subdomain redirect such as dweb.link's old `<cid>.ipfs.dweb.link` pattern) — any redirect
// elsewhere is a failed check, never followed. A miss of any kind marks that check `unverified`
// and the run exits non-zero; printing `ALL ARTIFACTS VERIFIED` (exit 0) requires the manifest
// and every artifact to match on BOTH counted gateways. The body is hashed while streaming
// (never buffered whole), so an artifact over 50 MB is checked the same way as a small one
// (NFR-06).
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { cidOfBytes } from "../pipeline/publish/src/cid.js";
import { jcsBytes } from "../pipeline/publish/src/jcs.js";
import { backoffDelayMs } from "../pipeline/publish/src/backoff.js";
import {
  ALLOWED_GATEWAY_HOSTS,
  COUNTED_GATEWAY_HOSTS,
  FALLBACK_GATEWAY_HOSTS,
  FILEBASE_GATEWAY_HOST,
  NEVER_GATEWAY_HOSTS,
  ORBITOR_GATEWAY_HOST,
  PINATA_GATEWAY_HOST,
  STORAGE_HOST_LABEL,
  gatewayLabel,
  gatewayRefusalText,
  gatewayRole,
  holdsOurCopy,
  type GatewayRole,
} from "../pipeline/publish/src/gateways.js";

// This script lives outside every workspace package (scripts/ is not in pnpm-workspace.yaml),
// so it cannot resolve "@countylens/contract" the way pipeline/publish's own modules do (Node
// resolves a bare import from the importing FILE's own location, and pipeline/publish/src/cid.js
// and jcs.js resolve their own imports fine for that reason). Rather than reach into another
// package's node_modules by a relative path, this script checks the manifest structurally: every
// artifact the verify contract needs (name, cid, kind, carCid, size, sha256) plus the exact-JCS-
// bytes guarantee, computed with the same canonicalizer the real schema's bytes are built from.
// It is deliberately a looser check than RunManifestV1.parse (pipeline/publish/src/verify.ts
// uses the full Zod schema); a CI wiring that wants the stronger schema check should run that
// module's verifyManifest in-process instead of shelling out to this script.
export interface ManifestArtifactLike {
  name: string;
  cid: string;
  kind: string;
  carCid?: string;
  size: number;
  sha256: string;
}
interface ManifestLike {
  artifacts: ManifestArtifactLike[];
}

function isManifestLike(value: unknown): value is ManifestLike {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { artifacts?: unknown }).artifacts)
  );
}

// Roles, labels and the refusal text are defined once in pipeline/publish/src/gateways.ts (shared
// with src/verify.ts); this script speaks in https:// URLs.
const url = (host: string): string => `https://${host}`;
export const PINATA_GATEWAY = url(PINATA_GATEWAY_HOST);
export const ORBITOR_GATEWAY = url(ORBITOR_GATEWAY_HOST);
export const FILEBASE_GATEWAY = url(FILEBASE_GATEWAY_HOST);

/** The counted gateways (AM-10, 2026-10-26, amends AM-01 and P0-14): public gateways CountyLens
 *  does not operate. An artifact passes only when every one of these matches size + SHA-256. */
export const GATEWAYS: readonly string[] = COUNTED_GATEWAY_HOSTS.map(url);
/** Our main storage host's gateway (AM-10): reported alongside, never counted. */
export const FALLBACK_GATEWAYS: readonly string[] = FALLBACK_GATEWAY_HOSTS.map(url);
/** Every gateway this script may read; anything else is refused before the first request. */
export const ALLOWED_GATEWAYS: readonly string[] = ALLOWED_GATEWAY_HOSTS.map(url);
/** Named for the record (and the tests): never valid, whatever the allowlist says. */
export const NEVER_GATEWAYS: readonly string[] = NEVER_GATEWAY_HOSTS.map(url);
export { STORAGE_HOST_LABEL };
export type { GatewayRole };

export function labelOf(gateway: string): string {
  return gatewayLabel(gateway);
}
export const TIMEOUT_MS_DEFAULT = 300_000;
export const MAX_ATTEMPTS = 5;
export const ALL_VERIFIED_TEXT = "ALL ARTIFACTS VERIFIED";
/** Marks a check line taken from a prior log; such a line never seeds another resume. */
export const RESUMED_TEXT = "resumed from a prior run, not re-fetched";

/** The `--sample` selection: the smallest table part and the smallest CAR (size, then name). */
export function selectSample<T extends ManifestArtifactLike>(artifacts: readonly T[]): T[] {
  const smallest = (kind: string): T | undefined =>
    artifacts
      .filter((a) => a.kind === kind)
      .sort((x, y) => x.size - y.size || x.name.localeCompare(y.name))[0];
  return [smallest("table"), smallest("car")].filter((a): a is T => a !== undefined);
}
/** NFR-06: artifacts at or above this size are proof the streaming path is exercised, not a
 *  special code path — the same streaming hash runs for every size. */
export const STREAM_THRESHOLD_BYTES = 50 * 1024 * 1024;
const BACKOFF_BASE_MS = 1000;
const RETRYABLE_STATUS = new Set([429, 504]);

export function refusedGatewayText(gateway: string): string {
  return gatewayRefusalText(gateway, url);
}

/** Throws before the first request when `gateways` names anything outside the fixed allowlist. */
export function assertAllowedGateways(gateways: readonly string[]): void {
  for (const g of gateways) {
    if (NEVER_GATEWAYS.includes(g) || !ALLOWED_GATEWAYS.includes(g))
      throw new Error(refusedGatewayText(g));
  }
}

export function roleOf(gateway: string): GatewayRole {
  return gatewayRole(gateway);
}

/** The wait before the next attempt: `Retry-After` when sent, else full jitter over a capped
 *  exponential base. Exported so TC-040's backoff assertions can pin exact values. */
export function retryDelayMs(
  attempt: number,
  retryAfter: string | null,
  random: () => number = Math.random,
  now: () => number = Date.now,
): number {
  // Retry-After is honoured but capped at 60 s (pipeline/publish/src/backoff.ts says why).
  return backoffDelayMs(attempt, retryAfter, { baseMs: BACKOFF_BASE_MS, random, now });
}

function sameGatewayHost(gateway: string, host: string): boolean {
  const gw = new URL(gateway).host;
  return host === gw || host.endsWith(`.${gw}`);
}

// Pinata's public gateway rate-limits sustained sequential traffic tighter than the per-request
// 429 backoff alone can clear during a full-manifest run (observed 2026-10-24: ~30% of requests
// hit HTTP 429 after 5 retries). A small fixed pause between requests to that gateway keeps us
// under its limit instead of relying on retries to recover from it. Filebase's gateway has not
// shown this behavior, so the pause is scoped to Pinata only.
const PINATA_THROTTLE_MS = 4000;

function isPinataGateway(gateway: string): boolean {
  return new URL(gateway).host === "gateway.pinata.cloud";
}

export interface FetchedBytes {
  ok: boolean;
  status: number | null;
  size: number | null;
  sha256: string | null;
  reason?: string;
}

export interface Transport {
  fetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  random: () => number;
  timeoutMs: number;
  verbose: boolean;
  log: (line: string) => void;
}

function errorText(err: unknown): string {
  if (err instanceof Error)
    return err.name === "Error" ? err.message : `${err.name}: ${err.message}`;
  return String(err);
}

/** Streams the body while hashing (NFR-06): never `response.arrayBuffer()`, whatever the size. */
async function streamHash(
  body: ReadableStream<Uint8Array> | null,
): Promise<{ size: number; sha256: string }> {
  const hash = createHash("sha256");
  let size = 0;
  if (body) {
    const reader = body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      hash.update(value);
      size += value.byteLength;
    }
  }
  return { size, sha256: hash.digest("hex") };
}

/**
 * One logical GET of `cid` from `gateway`: retries 429/504/transport-errors/timeouts up to
 * MAX_ATTEMPTS with backoff honouring Retry-After; follows at most one redirect, and only when
 * its target is the same gateway's domain (never a cross-domain redirect, which would make the
 * "we verified from a gateway we don't operate" guarantee meaningless).
 */
export async function fetchArtifact(
  t: Transport,
  gateway: string,
  cid: string,
): Promise<FetchedBytes> {
  const url = `${gateway}/ipfs/${cid}`;
  let lastReason = "no response";
  let lastStatus: number | null = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    if (t.verbose) t.log(`GET ${url}${attempt > 1 ? ` (attempt ${attempt})` : ""}`);
    let res: Response;
    try {
      res = await t.fetch(url, {
        method: "GET",
        redirect: "manual",
        signal: AbortSignal.timeout(t.timeoutMs),
      });
    } catch (err) {
      lastReason = errorText(err);
      if (attempt < MAX_ATTEMPTS) {
        await t.sleep(retryDelayMs(attempt, null, t.random));
        continue;
      }
      return {
        ok: false,
        status: null,
        size: null,
        sha256: null,
        reason: `${lastReason} after ${MAX_ATTEMPTS} attempts`,
      };
    }
    if (RETRYABLE_STATUS.has(res.status)) {
      await res.body?.cancel();
      lastStatus = res.status;
      lastReason = `HTTP ${res.status}`;
      if (attempt < MAX_ATTEMPTS) {
        await t.sleep(retryDelayMs(attempt, res.headers.get("retry-after"), t.random));
        continue;
      }
      return {
        ok: false,
        status: res.status,
        size: null,
        sha256: null,
        reason: `${lastReason} after ${MAX_ATTEMPTS} attempts`,
      };
    }
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      const target = location ? new URL(location, url) : null;
      await res.body?.cancel();
      if (target !== null && sameGatewayHost(gateway, target.host)) {
        if (t.verbose) t.log(`redirect ${url} -> ${target.href} (same gateway, followed)`);
        // This fetch previously had no try/catch, unlike the main one above: a timeout or
        // network error here crashed the whole process instead of failing just this check
        // (observed 2026-10-24 under concurrent load — higher concurrency simply made a slow
        // redirect target more likely to occur, not a new failure mode).
        let followed: Response;
        try {
          followed = await t.fetch(target.href, {
            method: "GET",
            redirect: "manual",
            signal: AbortSignal.timeout(t.timeoutMs),
          });
        } catch (err) {
          return {
            ok: false,
            status: null,
            size: null,
            sha256: null,
            reason: `${errorText(err)} (after redirect)`,
          };
        }
        if (followed.status !== 200) {
          await followed.body?.cancel();
          return {
            ok: false,
            status: followed.status,
            size: null,
            sha256: null,
            reason: `HTTP ${followed.status} after redirect`,
          };
        }
        // Same gap as the fetch above: the signal can abort mid-stream, after headers already
        // arrived, surfacing here instead of at the fetch call. Uncaught, this crashed the
        // whole run (observed 2026-10-24) instead of failing just this one check.
        try {
          const got = await streamHash(followed.body);
          return { ok: true, status: 200, ...got };
        } catch (err) {
          return {
            ok: false,
            status: 200,
            size: null,
            sha256: null,
            reason: `${errorText(err)} (reading body after redirect)`,
          };
        }
      }
      return {
        ok: false,
        status: res.status,
        size: null,
        sha256: null,
        reason: `redirect to ${target === null ? "an unknown host" : target.host} refused; verify-manifest only reads ${new URL(gateway).host}`,
      };
    }
    if (res.status !== 200) {
      await res.body?.cancel();
      return {
        ok: false,
        status: res.status,
        size: null,
        sha256: null,
        reason: `HTTP ${res.status}`,
      };
    }
    // Same gap as the initial fetch's try/catch above: the abort signal can fire mid-stream,
    // after headers already arrived with status 200, surfacing here instead of at the fetch
    // call. Uncaught, this crashed the whole run (observed 2026-10-24, twice, under load on
    // large ~230MB artifacts) instead of failing just this one check. Retried like any other
    // transport error, since a mid-stream abort on one attempt says nothing about the next.
    try {
      const got = await streamHash(res.body);
      return { ok: true, status: 200, ...got };
    } catch (err) {
      lastReason = errorText(err);
      lastStatus = res.status;
      if (attempt < MAX_ATTEMPTS) {
        await t.sleep(retryDelayMs(attempt, null, t.random));
        continue;
      }
      return {
        ok: false,
        status: res.status,
        size: null,
        sha256: null,
        reason: `${lastReason} after ${MAX_ATTEMPTS} attempts`,
      };
    }
  }
  return {
    ok: false,
    status: lastStatus,
    size: null,
    sha256: null,
    reason: `${lastReason} after ${MAX_ATTEMPTS} attempts`,
  };
}

export type VerifyField = "cid" | "carCid" | "manifest";

export interface VerifyCheck {
  name: string;
  cid: string;
  field: VerifyField;
  gateway: string;
  /** "fallback" = our main storage host (Filebase): shown, never counted (AM-10). */
  role: GatewayRole;
  /** Null for a resumed check (nothing was fetched this run). */
  status: number | null;
  size: number | null;
  sha256: string | null;
  /** Wall time of the logical GET (retries included); null for a check resumed from a log. */
  ms: number | null;
  ok: boolean;
  /** Taken from a prior run's log (--resume-from), not fetched this run. */
  resumed?: true;
  reason?: string;
}

/** One artifact (or the manifest) across every gateway it was read from. */
export interface ArtifactVerdict {
  name: string;
  kind: string;
  /** The CID fetched: `cid` for tables, `carCid` for car/directory, the manifest's own CID. */
  cid: string;
  field: VerifyField;
  size: number;
  sha256: string;
  checks: VerifyCheck[];
  /** Both counted gateways were read and matched. */
  independentOk: boolean;
  /** The fallback (storage host) matched; null when it was not read. */
  fallbackOk: boolean | null;
  /** The counted gateways this artifact must match on: both, except a `--sample` CAR, which
   *  skips Pinata (it answers 429 to CAR downloads) and so has ONE counted gateway, orbitor. */
  countedGateways: string[];
  /** True when every counted gateway was required (false only for a sample CAR). */
  independentCheck: boolean;
  /** independentOk: every required counted gateway matched. */
  ok: boolean;
}

export interface VerifyReport {
  ok: boolean;
  manifestPath: string;
  manifestCid: string;
  gateways: string[];
  independentGateways: string[];
  fallbackGateways: string[];
  manifest: VerifyCheck[];
  artifacts: VerifyCheck[];
  manifestVerdict?: ArtifactVerdict;
  verdicts: ArtifactVerdict[];
  /** Set for a `--sample` run: how many artifacts were checked out of how many are listed. */
  sample?: { checked: number; total: number };
  /** How many artifacts the manifest lists. */
  artifactsListed: number;
  /** Checks taken from a prior run's log instead of fetched (--resume-from). */
  resumed: number;
  /** Loud but non-failing findings, e.g. the fallback serving other manifest bytes. */
  warnings: string[];
  /** The final verdict line, as printed. */
  verdictText: string;
}

export interface VerifyManifestOptions {
  manifestPath: string;
  gateways?: readonly string[];
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  /** Clock for the per-check `ms`; default Date.now. */
  now?: () => number;
  timeoutMs?: number;
  verbose?: boolean;
  /** Check only selectSample(artifacts) instead of every artifact. */
  sample?: boolean;
  log?: (line: string) => void;
  /**
   * Artifact checks to skip, already known-good from a prior run (key: resumeKey(gateway, name,
   * cid); a two-part key without the CID is still honoured for in-process callers).
   * This script has no other persisted state between runs -- a crash, a concurrency change, or
   * any other restart otherwise re-checks every check from zero. Does not skip the manifest
   * self-check (cheap, and correctness-critical to re-verify every run).
   */
  resumeSkip?: ReadonlySet<string> | undefined;
}

/** The resume key: gateway + name + the CID fetched, so a changed CID is never skipped. */
export function resumeKey(gateway: string, name: string, cid?: string): string {
  return cid === undefined ? `${gateway}\u0000${name}` : `${gateway}\u0000${name}\u0000${cid}`;
}

/** Parses a prior run's log output for `ok` artifact-check lines, for --resume-from. */
export function parseResumeLog(text: string): Set<string> {
  const skip = new Set<string>();
  const re = /^ok\s+(\S+)\s+(\S+)\s+(?:cid|carCid)=(\S+)/;
  for (const line of text.split("\n")) {
    // Only a fresh fetch can seed a resume: a line that was itself resumed proves nothing new.
    if (line.includes(RESUMED_TEXT)) continue;
    const m = re.exec(line);
    if (m) skip.add(resumeKey(m[1] as string, m[2] as string, m[3] as string));
  }
  return skip;
}

function target(a: ManifestArtifactLike): { field: VerifyField; cid: string | null } {
  if (a.kind === "table") return { field: "cid", cid: a.cid };
  return { field: "carCid", cid: a.carCid ?? null };
}

function formatLine(c: VerifyCheck): string {
  const head = `${c.ok ? "ok  " : "FAIL"} ${c.gateway} ${c.name} ${c.field === "manifest" ? "cid" : c.field}=${c.cid}`;
  const body = c.ok
    ? `${head} size=${c.size} match sha256 match`
    : `${head} ${c.reason ?? "failed"}`;
  return `${body} [${labelOf(c.gateway)}]`;
}

/** Folds one artifact's checks into its verdict (AM-10: every required counted gateway must match;
 *  the fallback is reported, never counted). */
export function verdictOf(
  item: Omit<
    ArtifactVerdict,
    "independentOk" | "fallbackOk" | "ok" | "independentCheck" | "countedGateways"
  >,
  countedGateways: readonly string[] = GATEWAYS,
): ArtifactVerdict {
  const independentOk =
    countedGateways.length > 0 &&
    countedGateways.every((g) =>
      item.checks.some((c) => c.gateway === g && c.role === "counted" && c.ok),
    );
  const fallback = item.checks.filter((c) => c.role === "fallback");
  const fallbackOk = fallback.length === 0 ? null : fallback.every((c) => c.ok);
  return {
    ...item,
    countedGateways: [...countedGateways],
    independentOk,
    fallbackOk,
    independentCheck: GATEWAYS.every((g) => countedGateways.includes(g)),
    ok: independentOk,
  };
}

export async function verifyManifest(options: VerifyManifestOptions): Promise<VerifyReport> {
  const gateways = [...new Set(options.gateways ?? ALLOWED_GATEWAYS)];
  assertAllowedGateways(gateways);
  const log = options.log ?? ((line: string) => console.log(line));
  const now = options.now ?? Date.now;
  const t: Transport = {
    fetch: options.fetch ?? fetch,
    sleep: options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
    random: options.random ?? Math.random,
    timeoutMs: options.timeoutMs ?? TIMEOUT_MS_DEFAULT,
    verbose: options.verbose ?? false,
    log,
  };

  async function timedFetch(gateway: string, cid: string) {
    const start = now();
    const fetched = await fetchArtifact(t, gateway, cid);
    return { fetched, ms: Math.max(0, now() - start) };
  }

  const bytes = readFileSync(options.manifestPath);
  const parsed: unknown = JSON.parse(bytes.toString("utf8"));
  if (!isManifestLike(parsed))
    throw new Error(`${options.manifestPath} does not look like a run manifest (no artifacts[])`);
  if (!bytes.equals(Buffer.from(jcsBytes(parsed))))
    throw new Error(
      `${options.manifestPath} is not the exact JCS (canonical JSON) bytes of its own content`,
    );
  const manifest = parsed;
  const manifestCid = await cidOfBytes(bytes);
  const manifestSha = createHash("sha256").update(bytes).digest("hex");
  const independentGateways = gateways.filter((g) => roleOf(g) === "counted");
  const fallbackGateways = gateways.filter((g) => roleOf(g) === "fallback");

  const manifestChecks: VerifyCheck[] = [];
  for (const gateway of gateways) {
    if (isPinataGateway(gateway)) await t.sleep(PINATA_THROTTLE_MS);
    const { fetched, ms } = await timedFetch(gateway, manifestCid);
    const ok = fetched.ok && fetched.size === bytes.length && fetched.sha256 === manifestSha;
    const check: VerifyCheck = {
      name: "manifest",
      cid: manifestCid,
      field: "manifest",
      gateway,
      role: roleOf(gateway),
      status: fetched.status,
      size: fetched.size,
      sha256: fetched.sha256,
      ms,
      ok,
      ...(ok ? {} : { reason: fetched.reason ?? "bytes differ" }),
    };
    manifestChecks.push(check);
    log(formatLine(check));
  }
  const manifestVerdict = verdictOf(
    {
      name: "manifest",
      kind: "manifest",
      cid: manifestCid,
      field: "manifest",
      size: bytes.length,
      sha256: manifestSha,
      checks: manifestChecks,
    },
    GATEWAYS,
  );
  const report: VerifyReport = {
    ok: false,
    manifestPath: options.manifestPath,
    manifestCid,
    gateways,
    independentGateways,
    fallbackGateways,
    manifest: manifestChecks,
    artifacts: [],
    manifestVerdict,
    verdicts: [],
    artifactsListed: manifest.artifacts.length,
    resumed: 0,
    warnings: [],
    verdictText: "",
  };
  // The fallback (our storage host) answering 200 with other bytes for the manifest CID is a
  // loud WARNING (worth knowing), but never counted: it does not stop the run.
  for (const c of manifestChecks.filter(
    (m) => m.role === "fallback" && m.status === 200 && !m.ok,
  )) {
    const warning = `WARNING ${c.gateway} (${STORAGE_HOST_LABEL}) served other bytes for the manifest CID ${manifestCid}: ${c.reason ?? "bytes differ"}`;
    report.warnings.push(warning);
    log(warning);
  }
  // Stop when the counted pair does not hold the manifest (unreachable, or other bytes).
  if (!manifestVerdict.independentOk) {
    const where = [
      ...manifestChecks.filter((c) => !c.ok && c.role === "counted").map((c) => c.gateway),
      ...GATEWAYS.filter((g) => !gateways.includes(g)).map((g) => `${g} (not checked)`),
    ];
    report.verdictText = `VERIFICATION FAILED: manifest bytes differ or are unreachable on ${where.join(", ")}; artifacts not checked`;
    log(report.verdictText);
    return report;
  }

  // Concurrency is asymmetric per gateway, not uniform: Filebase's gateway has shown no rate
  // limiting at concurrency 10. Pinata's gateway is the real constraint -- it gave a ~47-minute
  // retry-after penalty under sustained sequential load (2026-10-24) and produced bursts of 429s
  // above 1-3 in flight over time, so it runs one at a time with a fixed pause. ipfs.orbitor.dev
  // has no documented limit; 3 in flight is a modest, polite default for an operator we do not pay.
  const FILEBASE_CONCURRENCY = 10;
  const PINATA_CONCURRENCY = 1;
  const ORBITOR_CONCURRENCY = 3;
  function concurrencyFor(gateway: string): number {
    if (isPinataGateway(gateway)) return PINATA_CONCURRENCY;
    if (gateway === ORBITOR_GATEWAY) return ORBITOR_CONCURRENCY;
    return FILEBASE_CONCURRENCY;
  }

  interface Task {
    index: number;
    artifact: (typeof manifest.artifacts)[number];
    gateway: string;
  }
  const resumeSkip = options.resumeSkip;
  const tasks: Task[] = [];
  const artifactChecks: (VerifyCheck | undefined)[] = [];
  const selected = options.sample ? selectSample(manifest.artifacts) : manifest.artifacts;
  if (options.sample)
    report.sample = { checked: selected.length, total: manifest.artifacts.length };
  /** A sample CAR skips Pinata (429s on CAR downloads): orbitor is its ONE counted gateway. */
  const pinataSkipped = (a: ManifestArtifactLike): boolean =>
    options.sample === true && a.kind === "car";
  const countedFor = (a: ManifestArtifactLike): readonly string[] =>
    pinataSkipped(a) ? GATEWAYS.filter((g) => !isPinataGateway(g)) : GATEWAYS;
  let idx = 0;
  for (const artifact of selected) {
    for (const gateway of gateways) {
      if (pinataSkipped(artifact) && isPinataGateway(gateway)) continue;
      const { field, cid } = target(artifact);
      const fetchedCid = cid ?? artifact.cid;
      if (
        resumeSkip?.has(resumeKey(gateway, artifact.name, fetchedCid)) === true ||
        resumeSkip?.has(resumeKey(gateway, artifact.name)) === true
      ) {
        // Nothing is fetched: no status, bytes or hash are claimed for this run.
        const check: VerifyCheck = {
          name: artifact.name,
          cid: fetchedCid,
          field,
          gateway,
          role: roleOf(gateway),
          status: null,
          size: null,
          sha256: null,
          ms: null,
          ok: true,
          resumed: true,
        };
        artifactChecks[idx] = check;
        report.resumed += 1;
        log(
          `ok   ${gateway} ${artifact.name} ${field === "manifest" ? "cid" : field}=${check.cid} ${RESUMED_TEXT} [${labelOf(gateway)}]`,
        );
        idx += 1;
        continue;
      }
      tasks.push({ index: idx++, artifact, gateway });
    }
  }
  artifactChecks.length = idx;

  async function runOne(task: Task): Promise<void> {
    const { artifact, gateway } = task;
    const { field, cid } = target(artifact);
    let check: VerifyCheck;
    if (cid === null) {
      check = {
        name: artifact.name,
        cid: artifact.cid,
        field,
        gateway,
        role: roleOf(gateway),
        status: null,
        size: null,
        sha256: null,
        ms: null,
        ok: false,
        reason: `${artifact.kind} artifact has no carCid (AM-05); its cid is a DAG root, not a file`,
      };
    } else {
      if (isPinataGateway(gateway)) await t.sleep(PINATA_THROTTLE_MS);
      const { fetched, ms } = await timedFetch(gateway, cid);
      const ok = fetched.ok && fetched.size === artifact.size && fetched.sha256 === artifact.sha256;
      check = {
        name: artifact.name,
        cid,
        field,
        gateway,
        role: roleOf(gateway),
        status: fetched.status,
        size: fetched.size,
        sha256: fetched.sha256,
        ms,
        ok,
        ...(ok ? {} : { reason: fetched.reason ?? "size or sha256 mismatch" }),
      };
    }
    artifactChecks[task.index] = check;
    log(formatLine(check));
  }

  async function runPool(poolTasks: Task[], concurrency: number): Promise<void> {
    let next = 0;
    async function worker(): Promise<void> {
      for (;;) {
        const i = next++;
        if (i >= poolTasks.length) return;
        const task = poolTasks[i];
        if (task === undefined) return;
        await runOne(task);
      }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, poolTasks.length) }, worker));
  }

  const tasksByGateway = new Map<string, Task[]>();
  for (const task of tasks) {
    const list = tasksByGateway.get(task.gateway) ?? [];
    list.push(task);
    tasksByGateway.set(task.gateway, list);
  }
  await Promise.all(
    [...tasksByGateway.entries()].map(([gateway, poolTasks]) =>
      runPool(poolTasks, concurrencyFor(gateway)),
    ),
  );
  report.artifacts = artifactChecks.filter((c): c is VerifyCheck => c !== undefined);
  report.verdicts = selected.map((artifact) => {
    const { field, cid } = target(artifact);
    return verdictOf(
      {
        name: artifact.name,
        kind: artifact.kind,
        cid: cid ?? artifact.cid,
        field,
        size: artifact.size,
        sha256: artifact.sha256,
        checks: report.artifacts.filter((c) => c.name === artifact.name),
      },
      countedFor(artifact),
    );
  });

  const missing = GATEWAYS.filter((g) => !gateways.includes(g));
  for (const g of missing)
    log(`FAIL ${g} not checked: ${ALL_VERIFIED_TEXT} needs both counted gateways`);
  for (const g of FALLBACK_GATEWAYS.filter((f) => !gateways.includes(f)))
    log(`note ${g} not checked (${STORAGE_HOST_LABEL}; reported only, never required)`);

  const fallbackChecks = [...report.manifest, ...report.artifacts].filter(
    (c) => c.role === "fallback",
  );
  if (fallbackChecks.length > 0)
    log(
      `fallback ${fallbackGateways.join(", ")} (${STORAGE_HOST_LABEL}): ${fallbackChecks.filter((c) => c.ok).length} of ${fallbackChecks.length} checks matched; not counted`,
    );
  const fewerCounted = report.verdicts.filter((v) => !v.independentCheck);
  for (const v of fewerCounted)
    log(
      `note ${v.name}: ONE counted gateway in a sample (${v.countedGateways.join(", ") || "none"}); Pinata is skipped for CARs (it answers 429 to CAR downloads), ${FALLBACK_GATEWAYS.join(", ")} is read but not counted`,
    );

  const verdicts = [manifestVerdict, ...report.verdicts];
  const failed = verdicts.filter((v) => !v.ok).length;
  report.ok = failed === 0 && missing.length === 0;
  if (report.ok && report.sample)
    // The exact text the hosted e2e (A-03-TC-040/043) asserts; the "ONE counted gateway" note
    // for the sampled CAR is printed on its own line just above.
    report.verdictText = `SAMPLE VERIFIED ${report.sample.checked} of ${report.sample.total} artifacts${
      fewerCounted.length > 0 ? " (the CAR on orbitor and Filebase only)" : ""
    }`;
  else if (report.ok) report.verdictText = ALL_VERIFIED_TEXT;
  else
    report.verdictText = `VERIFICATION FAILED: ${failed} of ${verdicts.length} artifacts not verified on both counted gateways${missing.length > 0 ? `, ${missing.join(", ")} not checked` : ""}`;
  // A resumed check was not fetched this run: a passing verdict must say so (never a bare
  // ALL ARTIFACTS VERIFIED built partly from a prior run's log).
  if (report.ok && report.resumed > 0)
    report.verdictText += ` (${report.resumed} of ${report.artifacts.length} artifact checks resumed from a prior run, not re-fetched)`;
  log(report.verdictText);
  return report;
}

/**
 * 0 when every check run passed (a full run, or a `--sample` run: the log line says "sample only",
 * so a partial check never reads as a full verification); 1 for any failure. (2 = usage.)
 * A passing sample used to exit 3 (A11-16), which broke hosted TC-040; the wording carries it now.
 */
export function exitCodeFor(report: Pick<VerifyReport, "ok" | "sample">): number {
  return report.ok ? 0 : 1;
}

export const EVIDENCE_SCHEMA = "verify-manifest-evidence.v1";

export interface EvidenceGatewayResult {
  role: GatewayRole;
  /** Whether this gateway's operator holds a copy of our files (Pinata, Filebase: yes). */
  holds_our_copy: boolean;
  label: string;
  /** True when the check was taken from a prior run's log; status/bytes/sha256 are then null. */
  resumed: boolean;
  status: number | null;
  ok: boolean;
  bytes: number | null;
  sha256: string | null;
  ms: number | null;
  reason?: string;
}

export interface EvidenceArtifact {
  name: string;
  kind: string;
  cid: string;
  field: VerifyField;
  size: number;
  sha256: string;
  gateways: Record<string, EvidenceGatewayResult>;
  independent_ok: boolean;
  fallback_ok: boolean | null;
  independent_check: boolean;
  /** The counted gateways this artifact had to match on (one for a sample CAR: orbitor). */
  counted_gateways: string[];
  ok: boolean;
}

export interface Evidence {
  schema: typeof EVIDENCE_SCHEMA;
  generated_at: string;
  manifest_path: string;
  manifest_cid: string;
  mode: "full" | "sample";
  independent_gateways: string[];
  fallback_gateways: string[];
  artifacts: EvidenceArtifact[];
  summary: {
    ok: boolean;
    exit_code: number;
    verdict: string;
    artifacts_listed: number;
    artifacts_checked: number;
    independent_ok: number;
    independent_failed: number;
    /** Artifacts with fewer than both counted gateways (a sample CAR: orbitor only). */
    one_counted_gateway: number;
    /** Loud, non-failing findings (e.g. the fallback serving other manifest bytes). */
    warnings: string[];
    fallback_checks: number;
    fallback_ok: number;
    /** Checks taken from a prior run's log, not fetched this run. */
    resumed: number;
  };
}

function evidenceArtifact(v: ArtifactVerdict): EvidenceArtifact {
  const gateways: Record<string, EvidenceGatewayResult> = {};
  for (const c of v.checks)
    gateways[c.gateway] = {
      role: c.role,
      holds_our_copy: holdsOurCopy(c.gateway),
      label: labelOf(c.gateway),
      resumed: c.resumed === true,
      status: c.status,
      ok: c.ok,
      bytes: c.size,
      sha256: c.sha256,
      ms: c.ms,
      ...(c.reason === undefined ? {} : { reason: c.reason }),
    };
  return {
    name: v.name,
    kind: v.kind,
    cid: v.cid,
    field: v.field,
    size: v.size,
    sha256: v.sha256,
    gateways,
    independent_ok: v.independentOk,
    fallback_ok: v.fallbackOk,
    independent_check: v.independentCheck,
    counted_gateways: v.countedGateways,
    ok: v.ok,
  };
}

/** The machine-readable evidence for `--json` (the manifest is the first artifact). */
export function buildEvidence(report: VerifyReport, generatedAt: Date = new Date()): Evidence {
  const verdicts = [
    ...(report.manifestVerdict ? [report.manifestVerdict] : []),
    ...report.verdicts,
  ];
  const checks = [...report.manifest, ...report.artifacts];
  const fallback = checks.filter((c) => c.role === "fallback");
  return {
    schema: EVIDENCE_SCHEMA,
    generated_at: generatedAt.toISOString(),
    manifest_path: report.manifestPath,
    manifest_cid: report.manifestCid,
    mode: report.sample ? "sample" : "full",
    independent_gateways: report.independentGateways,
    fallback_gateways: report.fallbackGateways,
    artifacts: verdicts.map(evidenceArtifact),
    summary: {
      ok: report.ok,
      exit_code: exitCodeFor(report),
      verdict: report.verdictText,
      artifacts_listed: report.artifactsListed,
      artifacts_checked: report.verdicts.length,
      independent_ok: verdicts.filter((v) => v.independentOk).length,
      independent_failed: verdicts.filter((v) => v.independentCheck && !v.independentOk).length,
      one_counted_gateway: verdicts.filter((v) => !v.independentCheck).length,
      warnings: report.warnings,
      fallback_checks: fallback.length,
      fallback_ok: fallback.filter((c) => c.ok).length,
      resumed: report.resumed,
    },
  };
}

export function writeEvidence(path: string, evidence: Evidence): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(evidence, null, 2)}\n`);
}

interface Args {
  manifestPath: string;
  gateways: string[];
  verbose: boolean;
  resumeFrom?: string | undefined;
  sample: boolean;
  json?: string | undefined;
}

function usage(): never {
  console.error(
    "usage: npx tsx scripts/verify-manifest.ts runs/<runId>/manifest.json [--gateway <url>]... [--verbose] [--resume-from <prior-log-file>] [--sample] [--json <evidence.json>]",
  );
  process.exit(2);
}

function parseArgs(argv: string[]): Args {
  let manifestPath: string | undefined;
  const gateways: string[] = [];
  let verbose = false;
  let sample = false;
  let resumeFrom: string | undefined;
  let json: string | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] as string;
    if (arg === "--gateway" || arg === "--resume-from" || arg === "--json") {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) usage();
      if (arg === "--gateway") gateways.push(value);
      else if (arg === "--resume-from") resumeFrom = value;
      else json = value;
      i += 1;
    } else if (arg.startsWith("--gateway=")) {
      gateways.push(arg.slice("--gateway=".length));
    } else if (arg.startsWith("--resume-from=")) {
      resumeFrom = arg.slice("--resume-from=".length);
    } else if (arg.startsWith("--json=")) {
      json = arg.slice("--json=".length);
    } else if (arg === "--verbose" || arg === "-v") {
      verbose = true;
    } else if (arg === "--sample") {
      sample = true;
    } else if (arg.startsWith("-")) {
      usage();
    } else if (manifestPath === undefined) {
      manifestPath = arg;
    } else {
      usage();
    }
  }
  if (manifestPath === undefined) usage();
  return {
    manifestPath,
    gateways: gateways.length > 0 ? gateways : [...ALLOWED_GATEWAYS],
    verbose,
    resumeFrom,
    sample,
    json,
  };
}

function timeoutMsFromEnv(): number {
  const raw = process.env.TIMEOUT_MS;
  if (raw === undefined || raw === "") return TIMEOUT_MS_DEFAULT;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    console.error(`TIMEOUT_MS must be a positive integer of milliseconds, not "${raw}"`);
    process.exit(2);
  }
  return n;
}

// Only run the CLI when invoked directly (not when imported by the test suite).
if (process.argv[1] !== undefined && import.meta.url === new URL(process.argv[1], "file:").href) {
  const args = parseArgs(process.argv.slice(2));
  let resumeSkip: Set<string> | undefined;
  if (args.resumeFrom !== undefined) {
    const priorText = readFileSync(args.resumeFrom, "utf8");
    resumeSkip = parseResumeLog(priorText);
    console.error(
      `--resume-from ${args.resumeFrom}: skipping ${resumeSkip.size} already-ok checks`,
    );
  }
  try {
    const report = await verifyManifest({
      manifestPath: args.manifestPath,
      gateways: args.gateways,
      timeoutMs: timeoutMsFromEnv(),
      verbose: args.verbose,
      resumeSkip,
      sample: args.sample,
    });
    if (args.json !== undefined) {
      writeEvidence(args.json, buildEvidence(report));
      console.error(`evidence written to ${args.json}`);
    }
    process.exit(exitCodeFor(report));
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(2);
  }
}
