// verify-manifest (FR-006, AM-05; gateways per AM-10 2026-10-26, which amends AM-01): independent
// proof that every published artifact is what the committed manifest says, read from two public
// gateways that are neither our copy nor our storage host: Pinata's public gateway and
// ipfs.orbitor.dev. "Independent" means a public gateway CountyLens does not operate, with the bytes
// hash-checked (README); the two are the counted gateways, labelled with plain facts (PO wording
// 2026-10-26): Pinata "public gateway · also holds our second copy", orbitor "public gateway ·
// holds no copy of ours". The Filebase gateway may be read as a labelled fallback ("our main
// storage host · fallback, not counted"); its result is reported but never
// counts toward the verdict. ipfs.io and dweb.link retired on 2026-09-21
// (docs/decisions/0001-read-path.md Finding 3); they, the CloudFront CID copy, w3s.link and
// storacha.link (Storacha uploads ended 2026-04-15) are refused before any request.
//
// Order: the manifest itself first, by its own CID (the raw-leaves CIDv1 of the local bytes),
// from both gateways, compared byte-for-byte with the local file; a gateway that returns
// different bytes for that CID stops the run (nothing else is fetched). Then every artifact:
// tables by `cid`, car and directory artifacts by `carCid` (the raw file bytes; a dag-json root
// is never fetched as a file). Plain GETs with `redirect: "manual"`: a 3xx is a failed check
// naming the Location host, never followed, so no byte from outside the allowlist can pass
// (OR-6). No Range, no preflight; a streamed SHA-256 capped at
// size + 1 bytes; TIMEOUT_MS per request; 429/5xx retried up to MAX_ATTEMPTS with Retry-After
// or capped full jitter; at most CONCURRENCY_PER_GATEWAY requests in flight per gateway. One line
// per artifact per gateway; `ALL ARTIFACTS VERIFIED` only when the manifest and every artifact
// match on both counted gateways. The run never writes a file.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { RunManifestV1, type ManifestArtifact } from "@countylens/contract";
import { cidOfBytes } from "./cid.js";
import { jcsBytes } from "./jcs.js";
import { backoffDelayMs } from "./backoff.js";
import {
  ALLOWED_GATEWAY_HOSTS,
  COUNTED_GATEWAY_HOSTS,
  FALLBACK_GATEWAY_HOSTS,
  GATEWAY_LABELS,
  STORAGE_HOST_LABEL,
  gatewayLabel as labelOf,
  gatewayRefusalText,
  gatewayRole as roleOf,
} from "./gateways.js";

// Roles, labels and the refusal text live in ./gateways.ts (one definition, shared with
// scripts/verify-manifest.ts); re-exported here under this module's established names.
export {
  FILEBASE_GATEWAY_HOST,
  ORBITOR_GATEWAY_HOST,
  PINATA_GATEWAY_HOST,
  STORAGE_HOST_LABEL,
} from "./gateways.js";
/** The counted gateways (AM-10). Success needs every host in it. */
export const VERIFY_GATEWAYS: readonly string[] = COUNTED_GATEWAY_HOSTS;
/** Our main storage host's gateway: reported alongside, never counted (AM-10). */
export const VERIFY_FALLBACK_GATEWAYS: readonly string[] = FALLBACK_GATEWAY_HOSTS;
/** Every host verify may read. */
export const VERIFY_ALLOWED_GATEWAYS: readonly string[] = ALLOWED_GATEWAY_HOSTS;
/** The plain-facts label for each host (PO wording 2026-10-26). */
export const VERIFY_GATEWAY_LABELS: Readonly<Record<string, string>> = GATEWAY_LABELS;

/** Per request; the first fetch after an upload is slow (plan R5). */
export const TIMEOUT_MS = 120_000;
export const MAX_ATTEMPTS = 5;
export const CONCURRENCY_PER_GATEWAY = 2;
export const ALL_VERIFIED_TEXT = "ALL ARTIFACTS VERIFIED";
const BACKOFF_BASE_MS = 1000;

/** The exact refusal (plan § "Fixed texts", TC-042). */
export function refusedGatewayText(host: string): string {
  return gatewayRefusalText(host);
}

/** Throws the refusal for the first host outside the allowlist. Runs before any request. */
export function assertAllowedGateways(hosts: readonly string[]): void {
  for (const host of hosts) {
    if (!VERIFY_ALLOWED_GATEWAYS.includes(host)) throw new Error(refusedGatewayText(host));
  }
}

export function gatewayUrl(host: string, cid: string): string {
  return `https://${host}/ipfs/${cid}`;
}

/**
 * The wait before attempt `attempt + 1`: `Retry-After` (delta-seconds or an HTTP-date) when the
 * gateway sent one, else full jitter over an exponential base capped at 60 s.
 */
export function retryDelayMs(
  attempt: number,
  retryAfter: string | null,
  random: () => number = Math.random,
  now: () => number = Date.now,
): number {
  return backoffDelayMs(attempt, retryAfter, { baseMs: BACKOFF_BASE_MS, random, now });
}

export type VerifyField = "cid" | "carCid" | "manifest";

/** One check: an artifact (or the manifest) on one gateway (data-model VerifyResult). */
export interface VerifyCheck {
  name: string;
  /** The CID fetched: `cid` for tables, `carCid` for car and directory, the manifest's own CID. */
  cid: string;
  field: VerifyField;
  gateway: string;
  /** "fallback" = the storage host: reported, never counted toward the verdict (AM-10). */
  role: "counted" | "fallback";
  /** The final HTTP status, or null when no response arrived. */
  status: number | null;
  /** Bytes received (at most the expected size + 1), or null without a response. */
  size: number | null;
  /** SHA-256 of the bytes received, or null without a response. */
  sha256: string | null;
  ok: boolean;
  reason?: string;
}

export interface VerifyReport {
  ok: boolean;
  manifestPath: string;
  manifestCid: string;
  gateways: string[];
  manifest: VerifyCheck[];
  artifacts: VerifyCheck[];
  /** Every URL requested, in request order (TC-040 step 3). */
  requests: string[];
  /** Loud but non-failing findings, e.g. the fallback serving other manifest bytes. */
  warnings: string[];
}

export interface VerifyOptions {
  /** The committed manifest (`runs/<runId>/manifest.json`), exact JCS bytes. */
  manifestPath: string;
  /** Hosts to use; each must be in VERIFY_ALLOWED_GATEWAYS. Default: all three. */
  gateways?: readonly string[];
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  log?: (line: string) => void;
  timeoutMs?: number;
  /** Also log every request URL. */
  verbose?: boolean;
}

interface Fetched {
  status: number | null;
  size: number | null;
  sha256: string | null;
  bytes: Uint8Array | null;
  reason?: string;
}

/** A counting semaphore: at most `slots` callers inside at once. */
class Semaphore {
  private free: number;
  private readonly waiting: Array<() => void> = [];

  constructor(slots: number) {
    this.free = slots;
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.free > 0) this.free -= 1;
    else await new Promise<void>((resolve) => this.waiting.push(resolve));
    try {
      return await task();
    } finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.free += 1;
    }
  }
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

function errorText(err: unknown): string {
  if (err instanceof Error)
    return err.name === "Error" ? err.message : `${err.name}: ${err.message}`;
  return String(err);
}

/**
 * Reads at most `cap` bytes of the body while hashing. Returns the bytes only when `keep` is set
 * (the manifest compare); artifacts are hashed and dropped.
 */
async function drain(
  body: ReadableStream<Uint8Array> | null,
  cap: number,
  keep: boolean,
): Promise<{ size: number; sha256: string; bytes: Uint8Array | null }> {
  const hash = createHash("sha256");
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (body) {
    const reader = body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const room = cap - size;
      const part = value.byteLength > room ? value.subarray(0, room) : value;
      hash.update(part);
      if (keep) chunks.push(part);
      size += part.byteLength;
      if (size >= cap) {
        await reader.cancel();
        break;
      }
    }
  }
  return { size, sha256: hash.digest("hex"), bytes: keep ? Buffer.concat(chunks) : null };
}

interface Transport {
  fetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  random: () => number;
  timeoutMs: number;
  requests: string[];
  verbose: boolean;
  log: (line: string) => void;
}

/** The host a Location header points at (relative to `url`), or "an unknown host". */
function redirectHost(url: string, location: string | null): string {
  if (location === null) return "an unknown host";
  try {
    return new URL(location, url).host;
  } catch {
    return "an unknown host";
  }
}

/**
 * One plain GET with retries on 429/5xx and on transport errors; never a Range header, never a
 * followed redirect.
 */
async function fetchBytes(
  t: Transport,
  url: string,
  expectedSize: number,
  keep: boolean,
): Promise<Fetched> {
  let last: Fetched = { status: null, size: null, sha256: null, bytes: null };
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    t.requests.push(url);
    if (t.verbose) t.log(`GET ${url}${attempt > 1 ? ` (attempt ${attempt})` : ""}`);
    let res: Response;
    try {
      res = await t.fetch(url, {
        method: "GET",
        redirect: "manual",
        signal: AbortSignal.timeout(t.timeoutMs),
      });
    } catch (err) {
      last = { status: null, size: null, sha256: null, bytes: null, reason: errorText(err) };
      if (attempt < MAX_ATTEMPTS) await t.sleep(retryDelayMs(attempt, null, t.random));
      continue;
    }
    if (res.status === 429 || res.status >= 500) {
      await res.body?.cancel();
      last = { status: res.status, size: null, sha256: null, bytes: null };
      if (attempt < MAX_ATTEMPTS)
        await t.sleep(retryDelayMs(attempt, res.headers.get("retry-after"), t.random));
      continue;
    }
    if ((res.status >= 300 && res.status < 400) || res.type === "opaqueredirect") {
      await res.body?.cancel();
      return {
        status: res.status,
        size: null,
        sha256: null,
        bytes: null,
        reason: `HTTP ${res.status}: redirect to ${redirectHost(url, res.headers.get("location"))} refused; verify-manifest only reads ${new URL(url).host}`,
      };
    }
    if (res.redirected || (res.url !== "" && new URL(res.url).host !== new URL(url).host)) {
      // A fetch that followed a redirect anyway: the bytes came from elsewhere.
      await res.body?.cancel();
      return {
        status: res.status,
        size: null,
        sha256: null,
        bytes: null,
        reason: `redirect to ${res.url === "" ? "an unknown host" : new URL(res.url).host} refused`,
      };
    }
    if (res.status !== 200) {
      await res.body?.cancel();
      return {
        status: res.status,
        size: null,
        sha256: null,
        bytes: null,
        reason: `HTTP ${res.status}`,
      };
    }
    try {
      const got = await drain(res.body, expectedSize + 1, keep);
      return { status: 200, ...got };
    } catch (err) {
      last = { status: 200, size: null, sha256: null, bytes: null, reason: errorText(err) };
      if (attempt < MAX_ATTEMPTS) await t.sleep(retryDelayMs(attempt, null, t.random));
    }
  }
  const what = last.status === null ? (last.reason ?? "no response") : `HTTP ${last.status}`;
  return { ...last, reason: `${what} after ${MAX_ATTEMPTS} attempts` };
}

function compare(
  fetched: Fetched,
  expectedSize: number,
  expectedSha: string,
): { ok: boolean; reason?: string } {
  if (fetched.reason !== undefined) return { ok: false, reason: fetched.reason };
  if (fetched.size === null || fetched.sha256 === null) return { ok: false, reason: "no body" };
  if (fetched.size > expectedSize)
    return { ok: false, reason: `size expected ${expectedSize}, got more than ${expectedSize}` };
  if (fetched.size !== expectedSize)
    return { ok: false, reason: `size expected ${expectedSize}, got ${fetched.size}` };
  if (fetched.sha256 !== expectedSha)
    return { ok: false, reason: `sha256 expected ${expectedSha}, got ${fetched.sha256}` };
  return { ok: true };
}

function formatLine(c: VerifyCheck): string {
  const head = `${c.ok ? "ok  " : "FAIL"} ${c.gateway} ${c.name} ${c.field === "manifest" ? "cid" : c.field}=${c.cid}`;
  const body = c.ok
    ? `${head} size=${c.size} match sha256 match`
    : `${head} ${c.reason ?? "failed"}`;
  return `${body} [${labelOf(c.gateway)}]`;
}

/** Which CID the byte check fetches (TC-043): never the dag-json root of a car or directory. */
function target(a: ManifestArtifact): { field: VerifyField; cid: string | null } {
  if (a.kind === "table") return { field: "cid", cid: a.cid };
  return { field: "carCid", cid: a.carCid ?? null };
}

export async function verifyManifest(options: VerifyOptions): Promise<VerifyReport> {
  const gateways = [...new Set(options.gateways ?? VERIFY_ALLOWED_GATEWAYS)];
  assertAllowedGateways(gateways);
  const log = options.log ?? ((line: string) => console.log(line));
  const t: Transport = {
    fetch: options.fetch ?? fetch,
    sleep: options.sleep ?? defaultSleep,
    random: options.random ?? Math.random,
    timeoutMs: options.timeoutMs ?? TIMEOUT_MS,
    requests: [],
    verbose: options.verbose ?? false,
    log,
  };

  const bytes = readFileSync(options.manifestPath);
  const manifest = RunManifestV1.parse(JSON.parse(bytes.toString("utf8")));
  if (!bytes.equals(Buffer.from(jcsBytes(manifest))))
    throw new Error(`${options.manifestPath} is not the exact JCS bytes of its RunManifestV1`);
  const manifestCid = await cidOfBytes(bytes);
  const manifestSha = createHash("sha256").update(bytes).digest("hex");
  const slots = new Map(gateways.map((g) => [g, new Semaphore(CONCURRENCY_PER_GATEWAY)]));
  const slot = (gateway: string): Semaphore => slots.get(gateway) as Semaphore;

  // 1. The manifest itself, from every gateway, before any artifact (AM-05, TC-040 step 1b).
  const manifestChecks = await Promise.all(
    gateways.map((gateway) =>
      slot(gateway).run(async (): Promise<VerifyCheck> => {
        const fetched = await fetchBytes(t, gatewayUrl(gateway, manifestCid), bytes.length, true);
        let verdict = compare(fetched, bytes.length, manifestSha);
        if (verdict.ok && !(fetched.bytes && bytes.equals(Buffer.from(fetched.bytes))))
          verdict = { ok: false, reason: `bytes differ from ${options.manifestPath}` };
        const check: VerifyCheck = {
          name: "manifest",
          cid: manifestCid,
          field: "manifest",
          gateway,
          role: roleOf(gateway),
          status: fetched.status,
          size: fetched.size,
          sha256: fetched.sha256,
          ok: verdict.ok,
          ...(verdict.reason === undefined ? {} : { reason: verdict.reason }),
        };
        log(
          verdict.ok
            ? `${formatLine(check)} bytes match ${options.manifestPath}`
            : formatLine(check),
        );
        return check;
      }),
    ),
  );
  const report: VerifyReport = {
    ok: false,
    manifestPath: options.manifestPath,
    manifestCid,
    gateways,
    manifest: manifestChecks,
    artifacts: [],
    requests: t.requests,
    warnings: [],
  };
  // A counted gateway that answered 200 with other bytes for this CID is broken: stop here.
  // The fallback (our storage host) serving other bytes is worth a loud WARNING, but it does not
  // stop the run: it is never counted.
  const differing = manifestChecks.filter((c) => c.status === 200 && !c.ok);
  for (const c of differing.filter((d) => d.role === "fallback")) {
    const warning = `WARNING ${c.gateway} (${STORAGE_HOST_LABEL}) served other bytes for the manifest CID ${manifestCid}: ${c.reason ?? "bytes differ"}`;
    report.warnings.push(warning);
    log(warning);
  }
  const countedDiffering = differing.filter((c) => c.role === "counted");
  if (countedDiffering.length > 0) {
    log(
      `VERIFICATION FAILED: manifest bytes differ on ${countedDiffering.map((c) => c.gateway).join(", ")}; artifacts not checked`,
    );
    return report;
  }

  // 2. Every artifact on every gateway, at most CONCURRENCY_PER_GATEWAY in flight per gateway.
  const jobs: Array<Promise<VerifyCheck>> = [];
  for (const artifact of manifest.artifacts) {
    const { field, cid } = target(artifact);
    for (const gateway of gateways) {
      jobs.push(
        slot(gateway).run(async (): Promise<VerifyCheck> => {
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
              ok: false,
              reason: `${artifact.kind} artifact has no carCid (AM-05); its cid is a DAG root, not a file`,
            };
          } else {
            const fetched = await fetchBytes(t, gatewayUrl(gateway, cid), artifact.size, false);
            const verdict = compare(fetched, artifact.size, artifact.sha256);
            check = {
              name: artifact.name,
              cid,
              field,
              gateway,
              role: roleOf(gateway),
              status: fetched.status,
              size: fetched.size,
              sha256: fetched.sha256,
              ok: verdict.ok,
              ...(verdict.reason === undefined ? {} : { reason: verdict.reason }),
            };
          }
          log(formatLine(check));
          return check;
        }),
      );
    }
  }
  report.artifacts = await Promise.all(jobs);

  // 3. The verdict: the manifest and every artifact ok on every counted gateway. Fallback
  // (storage host) checks are reported in one summary line and never count (AM-10).
  const missing = VERIFY_GATEWAYS.filter((g) => !gateways.includes(g));
  for (const g of missing)
    log(`FAIL ${g} not checked: ${ALL_VERIFIED_TEXT} needs both counted gateways`);
  const all = [...report.manifest, ...report.artifacts];
  const fallback = all.filter((c) => c.role === "fallback");
  if (fallback.length > 0)
    log(
      `fallback ${VERIFY_FALLBACK_GATEWAYS.join(", ")} (${STORAGE_HOST_LABEL}): ${fallback.filter((c) => c.ok).length} of ${fallback.length} checks matched; not counted`,
    );
  const checks = all.filter((c) => c.role === "counted");
  const failed = checks.filter((c) => !c.ok).length;
  report.ok = failed === 0 && missing.length === 0;
  if (report.ok) log(ALL_VERIFIED_TEXT);
  else
    log(
      `VERIFICATION FAILED: ${failed} of ${checks.length} checks failed${missing.length > 0 ? `, ${missing.join(", ")} not checked` : ""}`,
    );
  return report;
}
