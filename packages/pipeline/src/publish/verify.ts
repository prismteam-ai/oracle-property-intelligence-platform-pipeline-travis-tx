import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { OracleConfig } from "../core/config.js";
import { log } from "../core/log.js";
import { DEFAULT_GATEWAYS, gatewayUrl, manifestSchema } from "./manifest.js";

export type GatewayCheck = {
  objectPath: string;
  cid: string;
  gateway: string;
  url: string;
  ok: boolean;
  httpStatus: number | null;
  bytes: number | null;
  sha256: string | null;
  expectedSize: number;
  expectedSha256: string | null;
  error?: string;
  elapsedMs: number;
};

export type VerifyReport = {
  runId: string;
  rootCid: string;
  verifiedAt: string;
  gateways: string[];
  checks: GatewayCheck[];
  summary: {
    objects: number;
    gateways: number;
    passed: number;
    failed: number;
    allPassed: boolean;
  };
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const MAX_RETRY_AFTER_S = 900;
const RETRY_STATUSES = new Set([429, 502, 503, 504]);
const REQUEST_SPACING_MS = Number(process.env.ORACLE_VERIFY_SPACING_MS || 2000);

async function fetchAndHash(
  url: string,
  timeoutMs: number,
  attempts = 4,
): Promise<{ status: number; bytes: number; sha256: string }> {
  await sleep(REQUEST_SPACING_MS);
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), redirect: "follow" });
  if (RETRY_STATUSES.has(res.status) && attempts > 1) {
    await res.body?.cancel();
    const retryAfter = Number(res.headers.get("retry-after") || 30);
    const waitS = Math.min(Number.isFinite(retryAfter) ? retryAfter : 30, MAX_RETRY_AFTER_S);
    log.warn("gateway_backoff", { url, status: res.status, waitS });
    await sleep(waitS * 1000);
    return fetchAndHash(url, timeoutMs, attempts - 1);
  }
  if (!res.ok || !res.body) {
    await res.body?.cancel();
    return { status: res.status, bytes: 0, sha256: "" };
  }
  const h = createHash("sha256");
  let bytes = 0;
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    h.update(chunk);
    bytes += chunk.length;
  }
  return { status: res.status, bytes, sha256: h.digest("hex") };
}

export async function verifyManifest(
  config: OracleConfig,
  opts: {
    runId: string;
    gateways?: string[];
    timeoutMs?: number;
    include?: (path: string) => boolean;
  },
): Promise<VerifyReport> {
  const manifestPath = path.join(config.runsDir, "manifests", `${opts.runId}.json`);
  const manifest = manifestSchema.parse(JSON.parse(await readFile(manifestPath, "utf8")));
  const gateways = opts.gateways?.length
    ? opts.gateways
    : manifest.gateways.length
      ? manifest.gateways
      : DEFAULT_GATEWAYS;
  const timeoutMs = opts.timeoutMs ?? 30 * 60_000;
  const objects = manifest.objects.filter(
    (o) => o.codec === "file" && (opts.include ? opts.include(o.path) : true),
  );
  const checks: GatewayCheck[] = [];
  for (const o of objects) {
    for (const gw of gateways) {
      const url = gatewayUrl(gw, o.cid);
      const t0 = Date.now();
      try {
        const r = await fetchAndHash(url, timeoutMs);
        const ok =
          r.status === 200 && r.bytes === o.size && (o.sha256 === null || r.sha256 === o.sha256);
        checks.push({
          objectPath: o.path,
          cid: o.cid,
          gateway: gw,
          url,
          ok,
          httpStatus: r.status,
          bytes: r.bytes,
          sha256: r.sha256 || null,
          expectedSize: o.size,
          expectedSha256: o.sha256,
          elapsedMs: Date.now() - t0,
        });
      } catch (err) {
        checks.push({
          objectPath: o.path,
          cid: o.cid,
          gateway: gw,
          url,
          ok: false,
          httpStatus: null,
          bytes: null,
          sha256: null,
          expectedSize: o.size,
          expectedSha256: o.sha256,
          error: String(err),
          elapsedMs: Date.now() - t0,
        });
      }
      const last = checks[checks.length - 1];
      log.info("gateway_check", {
        path: o.path,
        gateway: gw,
        ok: last?.ok,
        status: last?.httpStatus,
        ms: last?.elapsedMs,
      });
    }
  }
  const passed = checks.filter((c) => c.ok).length;
  const report: VerifyReport = {
    runId: manifest.runId,
    rootCid: manifest.root.cid,
    verifiedAt: new Date().toISOString(),
    gateways,
    checks,
    summary: {
      objects: objects.length,
      gateways: gateways.length,
      passed,
      failed: checks.length - passed,
      allPassed: passed === checks.length && checks.length > 0,
    },
  };
  await writeFile(
    path.join(config.runsDir, "manifests", `${opts.runId}.verification.json`),
    JSON.stringify(report, null, 2) + "\n",
  );
  return report;
}
