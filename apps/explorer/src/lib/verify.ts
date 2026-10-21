import { CODEC_RAW, multihashSha256Hex, parseCid } from './cid.js';
import { hashInWorker, type Hasher } from './hash.js';

export interface ManifestObject {
  cid: string;
  name: string;
  size: number;
  codec: 'file' | 'directory' | string;
  sha256: string;
  digest_of?: string;
}

/** The two independent public gateways of decisions.md section 29 (`ipfs.io` and `dweb.link` are superseded). */
export const GATEWAYS = ['https://ipfs.filebase.io', 'https://gateway.pinata.cloud'] as const;

/** Gateway URL derived from the CID; a directory root is compared by its raw root block. */
export function gatewayUrl(gateway: string, object: Pick<ManifestObject, 'cid' | 'codec'>): string {
  const base = `${gateway.replace(/\/+$/, '')}/ipfs/${object.cid}`;
  return object.codec === 'directory' ? `${base}?format=raw` : base;
}

export type VerifyState = 'match' | 'mismatch' | 'unverified';

export interface GatewayResult {
  gateway: string;
  url: string;
  state: VerifyState;
  http: number | null;
  size: number | null;
  sha256: string | null;
  /** Directory roots (and raw-leaf files): the fetched bytes' sha256 equals the CID's own multihash. */
  multihashMatches: boolean | null;
  reasons: string[];
  elapsedMs: number;
}

export interface VerifyDeps {
  fetch?: typeof fetch;
  hash?: Hasher;
  /** A gateway that has not answered by then is "unverified", never "mismatch". */
  timeoutMs?: number;
  now?: () => number;
}

/**
 * Section 21's Verify: file parts are fetched in full and compared by size and SHA-256; directory roots compare the
 * `?format=raw` root block (size, SHA-256, and the CID's multihash). Redirects (dweb.link's subdomain hop) are followed.
 * Timeouts, network/CORS failures and gateway errors are "unverified": only fetched bytes that differ are a "mismatch".
 */
export async function verifyOnGateway(
  object: ManifestObject,
  gateway: string,
  deps: VerifyDeps = {},
): Promise<GatewayResult> {
  const doFetch = deps.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const hash = deps.hash ?? hashInWorker;
  const now = deps.now ?? (() => Date.now());
  const url = gatewayUrl(gateway, object);
  const started = now();
  const base: GatewayResult = {
    gateway,
    url,
    state: 'unverified',
    http: null,
    size: null,
    sha256: null,
    multihashMatches: null,
    reasons: [],
    elapsedMs: 0,
  };
  const done = (patch: Partial<GatewayResult>): GatewayResult => ({
    ...base,
    ...patch,
    elapsedMs: now() - started,
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? 60_000);
  try {
    let response: Response;
    try {
      response = await doFetch(url, { redirect: 'follow', signal: controller.signal });
    } catch (error) {
      const aborted = controller.signal.aborted;
      return done({
        reasons: [
          aborted
            ? 'timed out before the gateway answered'
            : `fetch failed (network error or no CORS headers): ${String(error)}`,
        ],
      });
    }
    if (response.status !== 200) {
      return done({
        http: response.status,
        reasons: [
          response.status === 429
            ? 'gateway rate-limited the request (429)'
            : `gateway answered ${response.status}`,
        ],
      });
    }
    let bytes: ArrayBuffer;
    try {
      bytes = await response.arrayBuffer();
    } catch (error) {
      return done({
        http: 200,
        reasons: [
          controller.signal.aborted
            ? 'timed out while reading the body'
            : `body read failed: ${String(error)}`,
        ],
      });
    }
    const size = bytes.byteLength;
    const sha256 = await hash(bytes);
    const reasons: string[] = [];
    if (size !== object.size) reasons.push(`size ${size} differs from manifest ${object.size}`);
    if (sha256 !== object.sha256) reasons.push('sha256 differs from the manifest');

    let multihashMatches: boolean | null = null;
    try {
      const parsed = parseCid(object.cid);
      const expected = multihashSha256Hex(object.cid);
      // A directory root's CID is the hash of its root block; a raw-leaf file's CID is the hash of its bytes.
      if (expected && (object.codec === 'directory' || parsed.codec === CODEC_RAW)) {
        multihashMatches = expected === sha256;
        if (!multihashMatches) reasons.push("sha256 differs from the CID's multihash");
      }
    } catch (error) {
      reasons.push(`CID not parsed: ${String(error)}`);
    }
    return done({
      state: reasons.length === 0 ? 'match' : 'mismatch',
      http: 200,
      size,
      sha256,
      multihashMatches,
      reasons,
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function verifyObject(
  object: ManifestObject,
  deps: VerifyDeps = {},
  gateways: readonly string[] = GATEWAYS,
): Promise<GatewayResult[]> {
  return Promise.all(gateways.map((gateway) => verifyOnGateway(object, gateway, deps)));
}

/** Both gateways must match for the object to count as verified; any mismatch wins over unverified. */
export function overallState(results: readonly GatewayResult[]): VerifyState {
  if (results.some((r) => r.state === 'mismatch')) return 'mismatch';
  if (results.length > 0 && results.every((r) => r.state === 'match')) return 'match';
  return 'unverified';
}
