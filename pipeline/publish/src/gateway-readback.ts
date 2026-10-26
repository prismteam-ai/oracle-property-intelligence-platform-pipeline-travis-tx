// Gateway readback helpers shared by the carCid-file upload, the manifest upload and the
// resumable run driver (publish-run.ts). Two independent gateways (AM-01): Pinata's public
// gateway and the Filebase gateway. `readbackWhole` downloads and compares (size, and SHA-256
// when known); `probeGateway` is the cheap form (a 1-byte range request) the driver uses to decide
// that a file is already published without downloading it again.
import { createHash } from "node:crypto";
import type { FetchLike } from "./kubo-add.js";
import { FILEBASE_GATEWAY } from "./sequence.js";

/** Independent of the pin host (AM-01): Pinata's public gateway and the Filebase gateway. */
export const READBACK_GATEWAYS = ["https://gateway.pinata.cloud", FILEBASE_GATEWAY] as const;

export interface GatewayCheck {
  gateway: string;
  ok: boolean;
  status?: number;
  reason?: string;
  /** The gateway rate-limited or challenged the request (429/403): no answer about the content. */
  inconclusive?: boolean;
}

function blocked(status: number): boolean {
  return status === 429 || status === 403;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Downloads `cid` from `gateway` and compares its size (and SHA-256 when given). */
export async function readbackWhole(
  gateway: string,
  cid: string,
  expected: { size: number; sha256?: string },
  fetchImpl: FetchLike = fetch,
): Promise<GatewayCheck> {
  try {
    const res = await fetchImpl(`${gateway}/ipfs/${cid}`, {
      signal: AbortSignal.timeout(300_000),
    });
    if (!res.ok) {
      await res.body?.cancel();
      return {
        gateway,
        ok: false,
        ...(blocked(res.status) ? { inconclusive: true } : {}),
        status: res.status,
        reason: `HTTP ${res.status}`,
      };
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const sizeOk = bytes.length === expected.size;
    const shaOk = expected.sha256 === undefined || sha256 === expected.sha256;
    return sizeOk && shaOk
      ? { gateway, ok: true, status: res.status }
      : {
          gateway,
          ok: false,
          status: res.status,
          reason: `size ${bytes.length} (want ${expected.size}) sha256 ${sha256}${
            expected.sha256 === undefined ? "" : ` (want ${expected.sha256})`
          }`,
        };
  } catch (error) {
    return { gateway, ok: false, reason: message(error) };
  }
}

/**
 * One gateway's answer to a 1-byte range request for `cid`: the total size it reports
 * (Content-Range, else Content-Length of a full 200) compared with `size`. A 429 or 403 is a rate
 * limit or a bot challenge (Pinata's public gateway does this to automated clients), not an
 * answer about the content, so it is `inconclusive`.
 */
export async function probeGateway(
  gateway: string,
  cid: string,
  size: number,
  fetchImpl: FetchLike = fetch,
): Promise<GatewayCheck> {
  try {
    const res = await fetchImpl(`${gateway}/ipfs/${cid}`, {
      headers: { Range: "bytes=0-0" },
      signal: AbortSignal.timeout(120_000),
    });
    await res.body?.cancel();
    let total: number | undefined;
    if (res.status === 206) {
      const t = /\/(\d+)\s*$/.exec(res.headers.get("content-range") ?? "")?.[1];
      total = t === undefined ? undefined : Number(t);
    } else if (res.status === 200) {
      const length = res.headers.get("content-length");
      total = length === null ? undefined : Number(length);
    } else {
      return blocked(res.status)
        ? {
            gateway,
            ok: false,
            inconclusive: true,
            status: res.status,
            reason: `HTTP ${res.status}`,
          }
        : { gateway, ok: false, status: res.status, reason: `HTTP ${res.status}` };
    }
    return total === size
      ? { gateway, ok: true, status: res.status }
      : {
          gateway,
          ok: false,
          status: res.status,
          reason: total === undefined ? "no size reported" : `size ${total} (want ${size})`,
        };
  } catch (error) {
    return { gateway, ok: false, reason: message(error) };
  }
}

/** Every gateway's range-probe answer for `cid` at `size` (no download). */
export async function probeBothGateways(
  cid: string,
  size: number,
  fetchImpl: FetchLike = fetch,
): Promise<GatewayCheck[]> {
  const out: GatewayCheck[] = [];
  for (const gateway of READBACK_GATEWAYS)
    out.push(await probeGateway(gateway, cid, size, fetchImpl));
  return out;
}

/**
 * The gateways agree the content is published: at least one confirmed it, and every other one
 * either confirmed it or could not answer (rate limited / challenged). A gateway that answered
 * with a different size, a 404 or a transport error is a disagreement.
 */
export function gatewaysAgree(checks: readonly GatewayCheck[]): boolean {
  return checks.some((c) => c.ok) && checks.every((c) => c.ok || c.inconclusive === true);
}
