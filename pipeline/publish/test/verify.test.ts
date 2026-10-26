// T029 (TC-040…043 at unit level; gateways per AM-10, A-16 T078): verify-manifest over an
// injected fetch. No network: a fake gateway serves bytes by CID for the two independent hosts
// (Pinata, orbitor) and the storage-host fallback (Filebase, reported, never counted); every other host is refused before
// any request. Checks: the exact refusal text; the manifest fetched by its CID from both gateways
// and compared byte-for-byte before any artifact (AM-05); car and directory artifacts fetched by
// carCid, tables by cid, dag-json roots never fetched as files; plain GETs (no Range) with a
// timeout signal; size and SHA-256 mismatches named per artifact; 429/5xx backoff honouring
// Retry-After with five attempts; at most two concurrent requests per gateway; and
// `ALL ARTIFACTS VERIFIED` only when the manifest and every artifact match on both gateways.
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import * as dagJson from "@ipld/dag-json";
import { CID } from "multiformats/cid";
import { sha256 } from "multiformats/hashes/sha2";
import { describe, expect, it } from "vitest";
import { RunManifestV1, type ManifestArtifact } from "@countylens/contract";
import { cidOfBytes } from "../src/cid.js";
import { jcsBytes } from "../src/jcs.js";
import {
  ALL_VERIFIED_TEXT,
  FILEBASE_GATEWAY_HOST,
  MAX_ATTEMPTS,
  ORBITOR_GATEWAY_HOST,
  PINATA_GATEWAY_HOST,
  STORAGE_HOST_LABEL,
  TIMEOUT_MS,
  VERIFY_ALLOWED_GATEWAYS,
  VERIFY_FALLBACK_GATEWAYS,
  VERIFY_GATEWAYS,
  assertAllowedGateways,
  refusedGatewayText,
  retryDelayMs,
  verifyManifest,
  type VerifyOptions,
} from "../src/verify.js";

const RUN_ID = "travis-202609-reroof-20261021t1530z";
const PINATA = "gateway.pinata.cloud";
const ORBITOR = "ipfs.orbitor.dev";
const FILEBASE = "ipfs.filebase.io";
const HOSTS = [PINATA, ORBITOR, FILEBASE];
const CLOUDFRONT = "d111111abcdef8.cloudfront.net";

const sha256Hex = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

/** Deterministic pseudo-random bytes from a seed (sha256 chain). */
function bytesOf(seed: string, length: number): Uint8Array {
  const out = new Uint8Array(length);
  let block = createHash("sha256").update(seed).digest();
  let i = 0;
  while (i < length) {
    for (const b of block) {
      if (i >= length) break;
      out[i] = b;
      i += 1;
    }
    block = createHash("sha256").update(block).digest();
  }
  return out;
}

/** A dag-json root CID (what `cid` holds on car and directory artifacts): never a file. */
async function dagRoot(label: string): Promise<string> {
  const bytes = dagJson.encode({ label });
  return CID.create(1, dagJson.code, await sha256.digest(bytes)).toString();
}

interface Fixture {
  manifestPath: string;
  manifestBytes: Uint8Array;
  manifestCid: string;
  manifest: RunManifestV1;
  /** Bytes by the CID a gateway serves: carCid for car and directory, cid for tables, the manifest. */
  published: Map<string, Uint8Array>;
  /** The dag-json roots of car and directory artifacts. */
  roots: string[];
}

async function fixture(): Promise<Fixture> {
  const dir = mkdtempSync(join(tmpdir(), "verify-"));
  const published = new Map<string, Uint8Array>();
  const roots: string[] = [];
  const artifacts: ManifestArtifact[] = [];
  for (const group of ["county", "property_improvement"] as const) {
    const car = bytesOf(`car ${group}`, 2048 + group.length);
    const carRoot = await dagRoot(`CountyIndex ${group}`);
    const carCid = await cidOfBytes(car);
    roots.push(carRoot);
    published.set(carCid, car);
    artifacts.push({
      name: `car/travis-${group}.car`,
      cid: carRoot,
      codec: "dag-json",
      size: car.length,
      sha256: sha256Hex(car),
      kind: "car",
      carCid,
    });
    const tablesCar = bytesOf(`tables.car ${group}`, 1500);
    const tablesRoot = await dagRoot(`CountyTables ${group}`);
    const tablesCarCid = await cidOfBytes(tablesCar);
    roots.push(tablesRoot);
    published.set(tablesCarCid, tablesCar);
    artifacts.push({
      name: `tables/${group}`,
      cid: tablesRoot,
      codec: "dag-json",
      size: tablesCar.length,
      sha256: sha256Hex(tablesCar),
      kind: "directory",
      carCid: tablesCarCid,
    });
    for (const table of ["property", group === "county" ? "structure" : "property_improvement"]) {
      const part = bytesOf(`part ${group} ${table}`, 900);
      const cid = await cidOfBytes(part);
      published.set(cid, part);
      artifacts.push({
        name: `tables/${group}/${table}/part-00000.parquet`,
        cid,
        codec: "raw",
        size: part.length,
        sha256: sha256Hex(part),
        kind: "table",
      });
    }
  }
  const manifest = RunManifestV1.parse({
    schema: "oracle-travis-run-manifest.v1",
    runId: RUN_ID,
    county: "travis",
    state: "TX",
    fips: "48453",
    startedAt: "2026-10-21T15:00:00.000Z",
    finishedAt: "2026-10-21T15:30:00.000Z",
    previousManifestCid: null,
    sources: [
      {
        name: "austin-3syk-w9eu",
        url: "https://data.austintexas.gov/resource/3syk-w9eu.json",
        watermark: "2026-09",
        captured_at: "2026-10-21T15:05:00.000Z",
        records: 2,
        added: 2,
        changed: 0,
        removed: 0,
        limitations: ["Comptroller baseline not loaded (A-07)"],
      },
      {
        name: "tcad-2026-certified-json",
        url: "https://traviscad.org/publicinformation/certified-roll-2026",
        watermark: "2026",
        captured_at: "2026-10-21T15:10:00.000Z",
        records: 2,
        added: 2,
        changed: 0,
        removed: 0,
        limitations: ["Confidential owner records redacted (Texas Tax Code §25.025): 0"],
      },
    ],
    artifacts,
    profiles: [],
    coverage: {
      permits_emitted: { count: 2, derivation: "published_rows" },
      permits_no_tcad_geoid: { count: 0, derivation: "aggregate_match" },
    },
    limitations: [],
  });
  const manifestBytes = jcsBytes(manifest);
  const manifestCid = await cidOfBytes(manifestBytes);
  published.set(manifestCid, manifestBytes);
  const manifestPath = join(dir, "runs", RUN_ID, "manifest.json");
  mkdirSync(dirname(manifestPath), { recursive: true });
  writeFileSync(manifestPath, manifestBytes);
  return { manifestPath, manifestBytes, manifestCid, manifest, published, roots };
}

interface Recorded {
  url: string;
  host: string;
  cid: string;
  method: string;
  headers: Record<string, string>;
  signal: AbortSignal | null | undefined;
}

interface FakeOptions {
  /** What a host serves for a CID; undefined means 404. Defaults to the published bytes. */
  serve?: (host: string, cid: string, bytes: Uint8Array | undefined) => Uint8Array | undefined;
  /** Statuses returned by the first attempts of a URL, before the real answer. */
  statuses?: (host: string, cid: string) => number[];
  retryAfter?: string;
  /** Response delay; rejects with an AbortError when the request's signal fires first. */
  delayMs?: number;
}

function headersOf(init: RequestInit | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  const h = init?.headers;
  if (!h) return out;
  if (h instanceof Headers) h.forEach((v, k) => (out[k.toLowerCase()] = v));
  else {
    const pairs: ReadonlyArray<readonly [string, unknown]> = Array.isArray(h)
      ? h.map((pair) => [String(pair[0]), pair[1]] as const)
      : Object.entries(h);
    for (const [k, v] of pairs) if (v !== undefined) out[k.toLowerCase()] = String(v);
  }
  return out;
}

function delay(ms: number, signal: AbortSignal | null | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(signal.reason instanceof Error ? signal.reason : new Error("aborted"));
    });
  });
}

/** A fake pair of gateways: `https://<host>/ipfs/<cid>` from the published map. */
function fakeGateways(published: Map<string, Uint8Array>, opts: FakeOptions = {}) {
  const requests: Recorded[] = [];
  const inFlight = new Map<string, number>();
  const maxInFlight = new Map<string, number>();
  const attempts = new Map<string, number>();
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
    );
    const host = url.host;
    const cid = /^\/ipfs\/([a-z0-9]+)$/.exec(url.pathname)?.[1] ?? "";
    requests.push({
      url: url.href,
      host,
      cid,
      method: init?.method ?? "GET",
      headers: headersOf(init),
      signal: init?.signal,
    });
    inFlight.set(host, (inFlight.get(host) ?? 0) + 1);
    maxInFlight.set(host, Math.max(maxInFlight.get(host) ?? 0, inFlight.get(host) ?? 0));
    try {
      if (opts.delayMs) await delay(opts.delayMs, init?.signal);
      if (cid === "") return new Response("bad path", { status: 400 });
      const n = attempts.get(url.href) ?? 0;
      attempts.set(url.href, n + 1);
      const status = opts.statuses?.(host, cid)[n];
      if (status !== undefined) {
        return new Response("try later", {
          status,
          headers: opts.retryAfter === undefined ? {} : { "retry-after": opts.retryAfter },
        });
      }
      const bytes = opts.serve ? opts.serve(host, cid, published.get(cid)) : published.get(cid);
      if (!bytes) return new Response("not found", { status: 404 });
      return new Response(bytes, { status: 200 });
    } finally {
      inFlight.set(host, (inFlight.get(host) ?? 1) - 1);
    }
  };
  return { fetch: fetchImpl, requests, maxInFlight, attempts };
}

interface Run {
  report: Awaited<ReturnType<typeof verifyManifest>>;
  lines: string[];
  sleeps: number[];
  requests: Recorded[];
  maxInFlight: Map<string, number>;
  attempts: Map<string, number>;
}

async function run(
  f: Pick<Fixture, "manifestPath" | "published">,
  fake: FakeOptions = {},
  options: Partial<VerifyOptions> = {},
): Promise<Run> {
  const gw = fakeGateways(f.published, fake);
  const lines: string[] = [];
  const sleeps: number[] = [];
  const report = await verifyManifest({
    manifestPath: f.manifestPath,
    fetch: gw.fetch,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    random: () => 0.5,
    log: (line) => lines.push(line),
    ...options,
  });
  return {
    report,
    lines,
    sleeps,
    requests: gw.requests,
    maxInFlight: gw.maxInFlight,
    attempts: gw.attempts,
  };
}

/** The CID verify-manifest must fetch for an artifact: carCid for car and directory, cid for tables. */
function fetchedCid(a: ManifestArtifact): string {
  return a.kind === "table" ? a.cid : (a.carCid as string);
}

describe("gateway allowlist (TC-042)", () => {
  it("counted = Pinata + orbitor (AM-10); Filebase is the separate storage-host fallback", () => {
    expect(PINATA_GATEWAY_HOST).toBe("gateway.pinata.cloud");
    expect(ORBITOR_GATEWAY_HOST).toBe("ipfs.orbitor.dev");
    expect(FILEBASE_GATEWAY_HOST).toBe("ipfs.filebase.io");
    expect([...VERIFY_GATEWAYS]).toEqual([PINATA, ORBITOR]);
    expect([...VERIFY_FALLBACK_GATEWAYS]).toEqual([FILEBASE]);
    expect([...VERIFY_ALLOWED_GATEWAYS]).toEqual(HOSTS);
    expect(() => assertAllowedGateways(HOSTS)).not.toThrow();
  });

  it("refuses CloudFront, w3s.link, storacha.link, ipfs.io and dweb.link with the exact text, before any request", async () => {
    const f = await fixture();
    for (const host of [CLOUDFRONT, "w3s.link", "storacha.link", "ipfs.io", "dweb.link"]) {
      const text = `Refused gateway ${host}: verify-manifest only uses gateway.pinata.cloud (public gateway · also holds our second copy), ipfs.orbitor.dev (public gateway · holds no copy of ours) and ipfs.filebase.io (our main storage host · fallback, not counted)`;
      expect(refusedGatewayText(host)).toBe(text);
      expect(() => assertAllowedGateways([host])).toThrow(text);
      const gw = fakeGateways(f.published);
      await expect(
        verifyManifest({ manifestPath: f.manifestPath, gateways: [host], fetch: gw.fetch }),
      ).rejects.toThrow(text);
      expect(gw.requests).toEqual([]);
    }
  });

  it("refuses a list that mixes an allowed host with a retired one, before any request", async () => {
    const f = await fixture();
    const gw = fakeGateways(f.published);
    await expect(
      verifyManifest({
        manifestPath: f.manifestPath,
        gateways: [PINATA, "dweb.link"],
        fetch: gw.fetch,
      }),
    ).rejects.toThrow(refusedGatewayText("dweb.link"));
    expect(gw.requests).toEqual([]);
  });
});

describe("manifest byte-compare first (AM-05, TC-040 step 1b)", () => {
  it("fetches the manifest by its CID from both gateways before any artifact and compares the bytes", async () => {
    const f = await fixture();
    const { report, requests, lines } = await run(f);
    expect(report.ok).toBe(true);
    expect(report.manifestCid).toBe(f.manifestCid);
    const manifestUrls = HOSTS.map((h) => `https://${h}/ipfs/${f.manifestCid}`);
    expect(
      requests
        .slice(0, HOSTS.length)
        .map((r) => r.url)
        .sort(),
    ).toEqual([...manifestUrls].sort());
    expect(requests.slice(HOSTS.length).some((r) => r.cid === f.manifestCid)).toBe(false);
    expect(report.manifest.map((c) => c.gateway).sort()).toEqual([...HOSTS].sort());
    for (const check of report.manifest) {
      expect(check).toMatchObject({
        name: "manifest",
        field: "manifest",
        cid: f.manifestCid,
        status: 200,
        size: f.manifestBytes.length,
        sha256: sha256Hex(f.manifestBytes),
        ok: true,
      });
    }
    const manifestLines = lines.filter((l) => / manifest /.test(l));
    expect(manifestLines).toHaveLength(HOSTS.length);
    for (const host of HOSTS)
      expect(manifestLines.some((l) => l.includes(host) && l.includes(f.manifestCid))).toBe(true);
  });

  it("stops before any artifact when a gateway serves different manifest bytes", async () => {
    const f = await fixture();
    const other = new TextEncoder().encode(
      new TextDecoder().decode(f.manifestBytes).replace('"county":"travis"', '"county":"harris"'),
    );
    const { report, requests, lines } = await run(f, {
      serve: (host, cid, bytes) => (host === PINATA && cid === f.manifestCid ? other : bytes),
    });
    expect(report.ok).toBe(false);
    expect(requests.every((r) => r.cid === f.manifestCid)).toBe(true);
    expect(requests).toHaveLength(HOSTS.length);
    expect(report.artifacts).toEqual([]);
    const failed = report.manifest.find((c) => c.gateway === PINATA);
    expect(failed?.ok).toBe(false);
    expect(failed?.reason).toMatch(/sha256|bytes/);
    expect(
      lines.some((l) => l.startsWith("FAIL") && l.includes(PINATA) && l.includes("manifest")),
    ).toBe(true);
    expect(lines).not.toContain(ALL_VERIFIED_TEXT);
  });
});

describe("fallback serving other manifest bytes (review 2026-10-26)", () => {
  it("is a loud WARNING, not a failure, when both counted gateways match", async () => {
    const f = await fixture();
    const other = new TextEncoder().encode("not the manifest");
    const { report, lines } = await run(f, {
      serve: (host, cid, bytes) => (host === FILEBASE && cid === f.manifestCid ? other : bytes),
    });
    expect(report.ok).toBe(true);
    expect(report.artifacts.length).toBeGreaterThan(0);
    expect(report.warnings).toHaveLength(1);
    expect(report.warnings[0]).toMatch(/^WARNING ipfs\.filebase\.io .* served other bytes/);
    expect(lines.some((l) => l.startsWith("WARNING") && l.includes(FILEBASE))).toBe(true);
    expect(lines.at(-1)).toBe(ALL_VERIFIED_TEXT);
  });
});

describe("which CID is fetched (TC-043)", () => {
  it("fetches car and directory artifacts by carCid, tables by cid, and never a dag-json root as a file", async () => {
    const f = await fixture();
    const { report, requests } = await run(f);
    expect(report.ok).toBe(true);
    const byHost = new Map<string, Set<string>>(HOSTS.map((h) => [h, new Set<string>()]));
    for (const r of requests) byHost.get(r.host)?.add(r.cid);
    for (const a of f.manifest.artifacts) {
      for (const host of HOSTS) expect(byHost.get(host)?.has(fetchedCid(a))).toBe(true);
      const checks = report.artifacts.filter((c) => c.name === a.name);
      expect(checks.map((c) => c.gateway).sort()).toEqual([...HOSTS].sort());
      for (const c of checks) {
        expect(c.cid).toBe(fetchedCid(a));
        expect(c.field).toBe(a.kind === "table" ? "cid" : "carCid");
        expect(c.ok).toBe(true);
        expect(c.size).toBe(a.size);
        expect(c.sha256).toBe(a.sha256);
      }
    }
    for (const root of f.roots) expect(requests.some((r) => r.cid === root)).toBe(false);
    expect(requests).toHaveLength((f.manifest.artifacts.length + 1) * HOSTS.length);
  });

  it("fails a car artifact whose carCid is missing or corrupted, naming the artifact", async () => {
    const f = await fixture();
    const corrupted = structuredClone(f.manifest);
    const car = corrupted.artifacts.find((a) => a.kind === "car") as ManifestArtifact;
    car.carCid = await cidOfBytes(new TextEncoder().encode("not the car"));
    writeFileSync(f.manifestPath, jcsBytes(corrupted));
    const { report, lines } = await run(f);
    expect(report.ok).toBe(false);
    const failed = report.artifacts.filter((c) => c.name === car.name);
    expect(failed).toHaveLength(HOSTS.length);
    expect(failed.every((c) => !c.ok && c.field === "carCid")).toBe(true);
    expect(lines.some((l) => l.startsWith("FAIL") && l.includes(car.name))).toBe(true);
    expect(lines).not.toContain(ALL_VERIFIED_TEXT);
  });
});

describe("plain GETs", () => {
  it("sends GET without a Range header, with a timeout signal, only to the allowlisted hosts", async () => {
    const f = await fixture();
    const { report, requests } = await run(f);
    expect(TIMEOUT_MS).toBe(120_000);
    expect(requests.length).toBeGreaterThan(0);
    for (const r of requests) {
      expect(r.method).toBe("GET");
      expect(Object.keys(r.headers)).not.toContain("range");
      expect(r.signal).toBeInstanceOf(AbortSignal);
      expect(HOSTS).toContain(r.host);
      expect(r.url).toBe(`https://${r.host}/ipfs/${r.cid}`);
    }
    expect(report.requests).toEqual(requests.map((r) => r.url));
  });

  it("gives up on a request that exceeds timeoutMs", async () => {
    const f = await fixture();
    const { report, attempts } = await run(f, { delayMs: 40 }, { timeoutMs: 5 });
    expect(report.ok).toBe(false);
    for (const n of attempts.values()) expect(n).toBeLessThanOrEqual(MAX_ATTEMPTS);
    expect(report.manifest.every((c) => !c.ok && c.status === null)).toBe(true);
  });
});

describe("size and SHA-256 (TC-041)", () => {
  it("fails on a sha256 mismatch and names the artifact and the field", async () => {
    const f = await fixture();
    const tampered = structuredClone(f.manifest);
    const part = tampered.artifacts.find((a) => a.kind === "table") as ManifestArtifact;
    part.sha256 = "d".repeat(64);
    writeFileSync(f.manifestPath, jcsBytes(tampered));
    const { report, lines } = await run(f);
    expect(report.ok).toBe(false);
    // The edited copy has a new CID that no gateway holds: that is not a byte mismatch, so the
    // artifacts are still checked and the tampered one is named (TC-041).
    expect(report.manifest.every((c) => !c.ok && c.status === 404)).toBe(true);
    const failed = report.artifacts.filter((c) => c.name === part.name);
    expect(failed).toHaveLength(HOSTS.length);
    for (const c of failed) {
      expect(c.ok).toBe(false);
      expect(c.reason).toMatch(/sha256/);
      expect(c.reason).toContain(part.sha256);
    }
    expect(report.artifacts.filter((c) => c.name !== part.name).every((c) => c.ok)).toBe(true);
    expect(
      lines.some((l) => l.startsWith("FAIL") && l.includes(part.name) && l.includes("sha256")),
    ).toBe(true);
    expect(lines).not.toContain(ALL_VERIFIED_TEXT);
  });

  it("fails on a size mismatch and names the artifact and the field", async () => {
    const f = await fixture();
    const tampered = structuredClone(f.manifest);
    const part = tampered.artifacts.find((a) => a.kind === "table") as ManifestArtifact;
    part.size += 1;
    writeFileSync(f.manifestPath, jcsBytes(tampered));
    const { report, lines } = await run(f);
    expect(report.ok).toBe(false);
    const failed = report.artifacts.filter((c) => c.name === part.name);
    expect(failed).toHaveLength(HOSTS.length);
    for (const c of failed) {
      expect(c.ok).toBe(false);
      expect(c.reason).toMatch(/size/);
      expect(c.reason).toContain(String(part.size));
    }
    expect(
      lines.some((l) => l.startsWith("FAIL") && l.includes(part.name) && l.includes("size")),
    ).toBe(true);
    expect(lines).not.toContain(ALL_VERIFIED_TEXT);
  });

  it("fails when a gateway serves fewer bytes, and stops reading at size + 1 when it serves more", async () => {
    const f = await fixture();
    const part = f.manifest.artifacts.find((a) => a.kind === "table") as ManifestArtifact;
    const short = await run(f, {
      serve: (host, cid, bytes) =>
        host === ORBITOR && cid === part.cid ? (bytes as Uint8Array).subarray(0, 100) : bytes,
    });
    expect(short.report.ok).toBe(false);
    const shortCheck = short.report.artifacts.find(
      (c) => c.name === part.name && c.gateway === ORBITOR,
    );
    expect(shortCheck?.ok).toBe(false);
    expect(shortCheck?.size).toBe(100);
    expect(shortCheck?.reason).toMatch(/size/);
    const long = await run(f, {
      serve: (host, cid, bytes) =>
        host === PINATA && cid === part.cid ? bytesOf("long", part.size + 5000) : bytes,
    });
    expect(long.report.ok).toBe(false);
    const longCheck = long.report.artifacts.find(
      (c) => c.name === part.name && c.gateway === PINATA,
    );
    expect(longCheck?.ok).toBe(false);
    expect(longCheck?.size).toBe(part.size + 1);
    expect(longCheck?.reason).toMatch(/size/);
  });
});

describe("backoff on 429 and 5xx", () => {
  it("retries with the Retry-After delay and succeeds within five attempts", async () => {
    const f = await fixture();
    const part = f.manifest.artifacts.find((a) => a.kind === "table") as ManifestArtifact;
    const { report, attempts, sleeps } = await run(f, {
      statuses: (host, cid) => (host === FILEBASE && cid === part.cid ? [503, 429] : []),
      retryAfter: "2",
    });
    expect(report.ok).toBe(true);
    expect(attempts.get(`https://${FILEBASE}/ipfs/${part.cid}`)).toBe(3);
    expect(sleeps).toEqual([2000, 2000]);
  });

  it("uses capped full-jitter backoff without Retry-After", async () => {
    const f = await fixture();
    const part = f.manifest.artifacts.find((a) => a.kind === "table") as ManifestArtifact;
    const { report, sleeps } = await run(f, {
      statuses: (host, cid) => (host === PINATA && cid === part.cid ? [500, 502, 429] : []),
    });
    expect(report.ok).toBe(true);
    expect(sleeps).toHaveLength(3);
    for (const [i, ms] of sleeps.entries()) {
      expect(ms).toBeGreaterThan(0);
      expect(ms).toBeLessThanOrEqual(Math.min(60_000, 1000 * 2 ** i));
    }
    expect(retryDelayMs(1, null, () => 0.5)).toBe(500);
    expect(retryDelayMs(7, null, () => 1)).toBe(60_000);
    expect(retryDelayMs(1, "3", () => 0.5)).toBe(3000);
    const soon = new Date(Date.now() + 4000).toUTCString();
    const dated = retryDelayMs(1, soon, () => 0.5);
    expect(dated).toBeGreaterThan(2000);
    expect(dated).toBeLessThanOrEqual(4000);
  });

  it("gives up after five attempts and names the status; 404 is not retried", async () => {
    const f = await fixture();
    const [first, second] = f.manifest.artifacts.filter((a) => a.kind === "table");
    const part = first as ManifestArtifact;
    const missing = second as ManifestArtifact;
    const { report, attempts } = await run(f, {
      statuses: (host, cid) => (host === FILEBASE && cid === part.cid ? Array(9).fill(503) : []),
      serve: (host, cid, bytes) => (host === PINATA && cid === missing.cid ? undefined : bytes),
    });
    expect(MAX_ATTEMPTS).toBe(5);
    expect(report.ok).toBe(false);
    expect(attempts.get(`https://${FILEBASE}/ipfs/${part.cid}`)).toBe(5);
    const exhausted = report.artifacts.find((c) => c.name === part.name && c.gateway === FILEBASE);
    expect(exhausted?.ok).toBe(false);
    expect(exhausted?.status).toBe(503);
    expect(exhausted?.reason).toMatch(/503/);
    expect(exhausted?.reason).toMatch(/5 attempts/);
    expect(attempts.get(`https://${PINATA}/ipfs/${missing.cid}`)).toBe(1);
    const notFound = report.artifacts.find((c) => c.name === missing.name && c.gateway === PINATA);
    expect(notFound?.status).toBe(404);
    expect(notFound?.ok).toBe(false);
  });
});

describe("concurrency", () => {
  it("runs at most two requests at a time per gateway", async () => {
    const f = await fixture();
    expect(f.manifest.artifacts.length).toBeGreaterThanOrEqual(6);
    const { report, maxInFlight } = await run(f, { delayMs: 5 });
    expect(report.ok).toBe(true);
    for (const host of HOSTS) {
      expect(maxInFlight.get(host)).toBeGreaterThanOrEqual(2);
      expect(maxInFlight.get(host)).toBeLessThanOrEqual(2);
    }
  });
});

describe("ALL ARTIFACTS VERIFIED (TC-040)", () => {
  it("is the last line only when the manifest and every artifact match on both gateways", async () => {
    const f = await fixture();
    const { report, lines } = await run(f);
    expect(ALL_VERIFIED_TEXT).toBe("ALL ARTIFACTS VERIFIED");
    expect(report.ok).toBe(true);
    expect(lines.at(-1)).toBe("ALL ARTIFACTS VERIFIED");
    expect(lines.filter((l) => l === ALL_VERIFIED_TEXT)).toHaveLength(1);
    // One line per artifact per gateway, plus one manifest line per gateway.
    const checkLines = lines.filter((l) => /^(ok|FAIL)\b/.test(l));
    expect(checkLines).toHaveLength((f.manifest.artifacts.length + 1) * HOSTS.length);
    expect(checkLines.every((l) => l.startsWith("ok"))).toBe(true);
    // The committed manifest is untouched by the run.
    expect(readFileSync(f.manifestPath)).toEqual(Buffer.from(f.manifestBytes));
  });

  it("is never printed when one artifact fails on one gateway", async () => {
    const f = await fixture();
    const part = f.manifest.artifacts.find((a) => a.kind === "table") as ManifestArtifact;
    const { report, lines } = await run(f, {
      serve: (host, cid, bytes) => (host === ORBITOR && cid === part.cid ? undefined : bytes),
    });
    expect(report.ok).toBe(false);
    expect(lines).not.toContain(ALL_VERIFIED_TEXT);
    expect(lines.filter((l) => l.startsWith("FAIL"))).toHaveLength(1);
  });

  it("is never printed when only one of the two independent gateways was checked", async () => {
    const f = await fixture();
    const { report, lines, requests } = await run(f, {}, { gateways: [PINATA, FILEBASE] });
    expect(report.ok).toBe(false);
    expect(requests.every((r) => r.host === PINATA || r.host === FILEBASE)).toBe(true);
    expect(lines).not.toContain(ALL_VERIFIED_TEXT);
    expect(lines.some((l) => l.includes(ORBITOR) && /not checked/.test(l))).toBe(true);
  });

  it("a Filebase-only miss is reported with the storage-host label and does not fail the run (AM-10)", async () => {
    const f = await fixture();
    const part = f.manifest.artifacts.find((a) => a.kind === "table") as ManifestArtifact;
    const { report, lines } = await run(f, {
      serve: (host, cid, bytes) => (host === FILEBASE && cid === part.cid ? undefined : bytes),
    });
    expect(report.ok).toBe(true);
    expect(lines.at(-1)).toBe(ALL_VERIFIED_TEXT);
    const miss = report.artifacts.find((c) => c.name === part.name && c.gateway === FILEBASE);
    expect(miss).toMatchObject({ ok: false, role: "fallback" });
    expect(
      lines.some(
        (l) => l.startsWith("FAIL") && l.includes(FILEBASE) && l.includes(STORAGE_HOST_LABEL),
      ),
    ).toBe(true);
    expect(
      lines.some((l) => l.startsWith("fallback") && /checks matched; not counted$/.test(l)),
    ).toBe(true);
  });
});

describe("redirects (OR-6)", () => {
  /**
   * The Pinata host answers every CID with a 302 to a host outside the allowlist. A fetch left at
   * the default `redirect: "follow"` would be answered by that host (simulated here: the fake
   * follows unless the request says `redirect: "manual"`), which must never count as a check.
   */
  function redirecting(published: Map<string, Uint8Array>) {
    const hosts: string[] = [];
    const modes: Array<RequestInit["redirect"]> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = new URL(typeof input === "string" ? input : (input as Request).url);
      const cid = /^\/ipfs\/([a-z0-9]+)$/.exec(url.pathname)?.[1] ?? "";
      hosts.push(url.host);
      modes.push(init?.redirect);
      const bytes = published.get(cid);
      if (url.host !== PINATA)
        return bytes ? new Response(bytes) : new Response("", { status: 404 });
      const location = `https://evil.example/ipfs/${cid}`;
      if (init?.redirect === "manual")
        return new Response(null, { status: 302, headers: { location } });
      hosts.push("evil.example");
      return bytes ? new Response(bytes) : new Response("", { status: 404 });
    };
    return { fetch: fetchImpl, hosts, modes };
  }

  it("does not follow a redirect off the allowlisted host: the check fails and names the host", async () => {
    const f = await fixture();
    const gw = redirecting(f.published);
    const lines: string[] = [];
    const report = await verifyManifest({
      manifestPath: f.manifestPath,
      fetch: gw.fetch,
      sleep: async () => {},
      random: () => 0.5,
      log: (line) => lines.push(line),
    });
    expect(gw.modes.every((m) => m === "manual")).toBe(true);
    expect(gw.hosts).not.toContain("evil.example");
    expect(report.ok).toBe(false);
    const pinata = report.manifest.find((c) => c.gateway === PINATA);
    expect(pinata?.ok).toBe(false);
    expect(pinata?.status).toBe(302);
    expect(pinata?.reason).toContain("redirect to evil.example refused");
    expect(lines).not.toContain(ALL_VERIFIED_TEXT);
  });
});
