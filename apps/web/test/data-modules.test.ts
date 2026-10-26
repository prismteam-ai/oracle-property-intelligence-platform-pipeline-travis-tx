// @vitest-environment node
// T007 (A-13, research R3/R4/R5/R6/R10, data-model.md): the published-file readers of apps/web.
// - run-chain: follows previousManifestCid; "old manifest still resolves" only after both
//   gateways answered with the right bytes;
// - run-events: startedAt, each sources[].captured_at, finishedAt + limitations, time-ordered
//   across runs;
// - coverage-rows: unknown keys tolerated; a missing `source_total:{source}` key gives
//   "denominator not in this run's manifest · source {name}";
// - site-links: https only, an invalid or empty value is hidden;
// - parquet-meta: columns, types and rows from a real Parquet footer read by Range;
// - verify-lane: the data-model state machine (✓ only when size and digest match; 429 and
//   unreadable-response labels; backoff 2/4/8 s; never the CID copy; via CAR for directories
//   and files over 50 MB).
// The committed run (runs/index.json and its manifest) is the real input where one is needed;
// chains of two runs are built in this test from it (test-only, never shown by the app).
// Written before the modules exist: the red run fails with "Cannot find module".
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { RunManifestV1, RunsIndexV1 } from "@countylens/contract";
import { rawCid } from "@countylens/query-core";
import { COVERAGE_TEXTS, RUNS_TEXTS, VERIFY_TEXTS, readPathUrls } from "@countylens/shared";
import { describe, expect, it, vi } from "vitest";
import {
  checkManifestResolves,
  loadRunChain,
  oldManifestResolvesText,
  type GatewayCheck,
} from "../src/data/run-chain";
import { runEvents } from "../src/data/run-events";
import { SOURCE_TOTAL_PREFIX, coverageRows, denominatorRows } from "../src/data/coverage-rows";
import { SITE_LINKS_PATH, loadSiteLinks, parseSiteLinks } from "../src/data/site-links";
import { catalogTables, readParquetFooter } from "../src/data/parquet-meta";
import {
  VERIFY_BACKOFF_MS,
  VERIFY_MAX_BYTES,
  runVerifyLane,
  verifyLaneUrl,
  type LaneState,
  type VerifyTarget,
} from "../src/data/verify-lane";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const INDEX = RunsIndexV1.parse(JSON.parse(readFileSync(join(ROOT, "runs/index.json"), "utf8")));
const LATEST = INDEX.runs.at(-1);
if (LATEST === undefined) throw new Error("runs/index.json lists no run");
const MANIFEST_BYTES = new Uint8Array(
  readFileSync(join(ROOT, "runs", LATEST.runId, "manifest.json")),
);
const MANIFEST = RunManifestV1.parse(JSON.parse(new TextDecoder().decode(MANIFEST_BYTES)));

const URLS = readPathUrls({
  cidCopyHost: "copy.host.test",
  filebaseGatewayHost: "filebase.host.test",
  pinataGatewayHost: "pinata.host.test",
  orbitorGatewayHost: "orbitor.host.test",
});

/** A second run after the committed one (test-only). */
const nextRun = (previous: string, patch: Partial<RunManifestV1> = {}): RunManifestV1 => ({
  ...MANIFEST,
  runId: "travis-next-run",
  startedAt: "2026-11-01T00:00:00.000Z",
  finishedAt: "2026-11-01T01:00:00.000Z",
  sources: MANIFEST.sources.map((s) => ({ ...s, captured_at: "2026-11-01T00:30:00.000Z" })),
  previousManifestCid: previous,
  ...patch,
});

describe("run-chain", () => {
  it("follows previousManifestCid from the head to the first run", async () => {
    const first: RunManifestV1 = { ...MANIFEST, previousManifestCid: null };
    const head = nextRun(LATEST.manifestCid);
    const byCid = new Map<string, RunManifestV1>([
      ["bafkreiheadheadheadheadheadheadheadheadheadheadheadheadhea", head],
      [LATEST.manifestCid, first],
    ]);
    const load = vi.fn(async (cid: string) => {
      const m = byCid.get(cid);
      if (m === undefined) throw new Error(`no ${cid}`);
      return m;
    });
    const chain = await loadRunChain(
      "bafkreiheadheadheadheadheadheadheadheadheadheadheadheadhea",
      load,
    );
    expect(chain.map((l) => l.runId)).toEqual(["travis-next-run", LATEST.runId]);
    expect(chain[0]?.previousManifestCid).toBe(LATEST.manifestCid);
    expect(chain[1]?.previousManifestCid).toBeNull();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("the committed runs form one chain from the latest run back to the first", async () => {
    const byCid = new Map(
      INDEX.runs.map((r) => [
        r.manifestCid,
        RunManifestV1.parse(
          JSON.parse(readFileSync(join(ROOT, "runs", r.runId, "manifest.json"), "utf8")),
        ),
      ]),
    );
    const chain = await loadRunChain(LATEST.manifestCid, async (cid) => {
      const m = byCid.get(cid);
      if (m === undefined) throw new Error(`no ${cid}`);
      return m;
    });
    expect(chain[0]?.manifestCid).toBe(LATEST.manifestCid);
    expect(chain.at(-1)?.previousManifestCid).toBeNull();
    chain.slice(0, -1).forEach((link, i) => {
      expect(link.previousManifestCid).toBe(chain[i + 1]?.manifestCid);
    });
    for (const link of chain) expect(INDEX.runs.map((r) => r.runId)).toContain(link.runId);
  });

  it("stops on a cycle instead of looping", async () => {
    const loop = nextRun("bafkreiloop");
    const chain = await loadRunChain("bafkreiloop", async () => loop);
    expect(chain).toHaveLength(1);
  });

  it('"old manifest still resolves" only after both independent gateways (Pinata, orbitor) answered', () => {
    const r = (pinata: GatewayCheck, orbitor: GatewayCheck, filebase: GatewayCheck) =>
      oldManifestResolvesText({ pinata, orbitor, filebase });
    expect(r("pending", "resolves", "resolves")).toBeNull();
    expect(r("resolves", "fails", "resolves")).toBeNull();
    // AM-10: Filebase is the storage host; it never decides the text either way.
    expect(r("resolves", "resolves", "fails")).toBe(RUNS_TEXTS.oldManifestResolves);
    expect(r("resolves", "resolves", "resolves")).toBe(RUNS_TEXTS.oldManifestResolves);
    expect(r("fails", "pending", "resolves")).toBeNull();
  });

  it("checkManifestResolves GETs every gateway (never the copy) and checks the bytes' CID", async () => {
    const seen: string[] = [];
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      seen.push(url);
      return url.includes("pinata")
        ? new Response(MANIFEST_BYTES, { status: 200 })
        : new Response("not the manifest", { status: 200 });
    }) as typeof fetch;
    const r = await checkManifestResolves(LATEST.manifestCid, { urls: URLS, fetch: fetchImpl });
    expect(r).toEqual({ pinata: "resolves", orbitor: "fails", filebase: "fails" });
    expect(seen.sort()).toEqual([
      URLS.gatewayUrl(LATEST.manifestCid, "filebase"),
      URLS.gatewayUrl(LATEST.manifestCid, "orbitor"),
      URLS.gatewayUrl(LATEST.manifestCid, "pinata"),
    ]);
    expect(seen).not.toContain(URLS.copyUrl(LATEST.manifestCid));
  });
});

describe("run-events", () => {
  it("one started, one captured per source and one finished event per run, with limitations", () => {
    const events = runEvents([MANIFEST]);
    // A run with no earlier run owns every capture, even one before its recorded start.
    const own = MANIFEST.sources;
    expect(events).toHaveLength(own.length + 2);
    expect(events.find((e) => e.kind === "started")).toEqual({
      time: MANIFEST.startedAt,
      runId: MANIFEST.runId,
      kind: "started",
    });
    expect(events.find((e) => e.kind === "finished")).toEqual({
      time: MANIFEST.finishedAt,
      runId: MANIFEST.runId,
      kind: "finished",
      limitations: MANIFEST.limitations,
    });
    for (const s of own)
      expect(events).toContainEqual({
        time: s.captured_at,
        runId: MANIFEST.runId,
        kind: "captured",
        source: s.name,
      });
  });

  it("leaves out a capture an earlier run already holds (carried over: same source, same time)", () => {
    const [fresh, ...rest] = MANIFEST.sources;
    if (fresh === undefined) throw new Error("fixture has no source");
    const later = {
      ...MANIFEST,
      runId: "travis-next-run",
      startedAt: "2026-11-01T00:00:00.000Z",
      finishedAt: "2026-11-01T01:00:00.000Z",
      sources: [{ ...fresh, captured_at: "2026-11-01T00:30:00.000Z" }, ...rest],
    };
    const captured = runEvents([later, MANIFEST]).flatMap((e) =>
      e.kind === "captured" && e.runId === later.runId ? [e.source] : [],
    );
    expect(captured).toEqual([fresh.name]);
  });

  it("is time-ordered across runs, whatever order the manifests come in", () => {
    const later = nextRun(LATEST.manifestCid);
    const events = runEvents([later, MANIFEST]);
    const times = events.map((e) => Date.parse(e.time));
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(events[0]?.runId).toBe(MANIFEST.runId);
    expect(events.at(-1)?.runId).toBe("travis-next-run");
  });
});

describe("coverage-rows", () => {
  it("one row per coverage key with count, derivation and note, from the manifest only", () => {
    const rows = coverageRows(MANIFEST);
    const keys = Object.keys(MANIFEST.coverage).filter((k) => !k.startsWith(SOURCE_TOTAL_PREFIX));
    expect(rows.map((r) => r.key).sort()).toEqual(keys.sort());
    for (const r of rows) {
      const c = MANIFEST.coverage[r.key];
      expect(r.count).toBe(c?.count);
      expect(r.derivation).toBe(c?.derivation);
      expect(r.note).toBe(c?.note ?? null);
      expect(r.label.length).toBeGreaterThan(0);
    }
  });

  it("tolerates an unknown coverage key (labelled by its key, never thrown on)", () => {
    const m = {
      ...MANIFEST,
      coverage: {
        ...MANIFEST.coverage,
        brand_new_kind: { count: 3, derivation: "published_rows" as const },
      },
    };
    const row = coverageRows(m).find((r) => r.key === "brand_new_kind");
    expect(row).toMatchObject({ count: 3, label: "brand_new_kind" });
  });

  it("a source without its source_total key → the missing-denominator text with the source name", () => {
    const rows = denominatorRows(MANIFEST);
    expect(rows).toHaveLength(MANIFEST.sources.length);
    for (const [i, s] of MANIFEST.sources.entries()) {
      expect(rows[i]).toMatchObject({
        source: s.name,
        capturedAt: s.captured_at,
        count: null,
        missingText: COVERAGE_TEXTS.denominatorMissingFor(s.name),
      });
    }
  });

  it("a source_total key gives the denominator with its collection time", () => {
    const s = MANIFEST.sources[0];
    if (s === undefined) throw new Error("no source");
    const m = {
      ...MANIFEST,
      coverage: {
        ...MANIFEST.coverage,
        [`${SOURCE_TOTAL_PREFIX}${s.name}`]: {
          count: 1234,
          derivation: "capture_receipt" as const,
        },
      },
    };
    expect(denominatorRows(m)[0]).toMatchObject({
      source: s.name,
      count: 1234,
      derivation: "capture_receipt",
      capturedAt: s.captured_at,
      missingText: null,
    });
    expect(coverageRows(m).some((r) => r.key.startsWith(SOURCE_TOTAL_PREFIX))).toBe(false);
  });
});

describe("site-links", () => {
  it("keeps https URLs and hides empty or invalid values", () => {
    expect(
      parseSiteLinks({
        crmUrl: "https://crm.host.test/",
        demoVideoUrl: "",
        prUrl: "http://insecure.host.test/pr/1",
      }),
    ).toEqual({ crmUrl: "https://crm.host.test/" });
    expect(parseSiteLinks({ crmUrl: "javascript:alert(1)", prUrl: 42 })).toEqual({});
    expect(parseSiteLinks(null)).toEqual({});
    expect(parseSiteLinks("nope")).toEqual({});
  });

  it("loadSiteLinks reads /site-links.json and hides everything when it is unreadable", async () => {
    const seen: string[] = [];
    const ok = (async (input: RequestInfo | URL) => {
      seen.push(String(input));
      return new Response(JSON.stringify({ prUrl: "https://pr.host.test/1" }), { status: 200 });
    }) as typeof fetch;
    expect(await loadSiteLinks({ fetch: ok })).toEqual({ prUrl: "https://pr.host.test/1" });
    expect(seen).toEqual([SITE_LINKS_PATH]);
    expect(SITE_LINKS_PATH).toBe("/site-links.json");
    const missing = (async () => new Response("", { status: 404 })) as typeof fetch;
    expect(await loadSiteLinks({ fetch: missing })).toEqual({});
    const down = (async () => {
      throw new TypeError("network");
    }) as typeof fetch;
    expect(await loadSiteLinks({ fetch: down })).toEqual({});
  });
});

describe("parquet-meta", () => {
  const PARQUET = new Uint8Array(readFileSync(join(ROOT, "contract/v1/sample.parquet")));

  /** Serves PARQUET with Range support, recording each Range header. */
  const rangeFetch = (ranges: string[]) =>
    (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const range = new Headers(init?.headers).get("Range") ?? "";
      ranges.push(range);
      const m = /^bytes=(\d+)-(\d+)$/.exec(range);
      if (!m) return new Response(PARQUET, { status: 200 });
      const body = PARQUET.slice(Number(m[1]), Number(m[2]) + 1);
      return new Response(body, { status: 206 });
    }) as typeof fetch;

  it("reads columns, types and the row count from the footer by Range, never the whole file", async () => {
    const ranges: string[] = [];
    const footer = await readParquetFooter("https://copy.host.test/part", PARQUET.length, {
      fetch: rangeFetch(ranges),
    });
    // Oracle: DuckDB read_parquet over the same file gives count(*) = 20 and 61 columns (contract v1.2, A-11 Run 3.1).
    expect(footer.rows).toBe(20);
    expect(footer.columns).toHaveLength(61);
    expect(footer.columns.map((c) => c.name)).toEqual(
      expect.arrayContaining(["permit_number", "property_cid", "manifest_cid"]),
    );
    for (const c of footer.columns) expect(c.type.length).toBeGreaterThan(0);
    expect(ranges.length).toBeGreaterThan(0);
    for (const r of ranges) expect(r).toMatch(/^bytes=\d+-\d+$/);
  });

  it("groups the manifest's table parts by table", () => {
    const tables = catalogTables(MANIFEST);
    const parts = MANIFEST.artifacts.filter((a) => a.kind === "table");
    expect(tables.flatMap((t) => t.parts).length).toBe(parts.length);
    const property = tables.find((t) => t.table === "county.property");
    expect(property?.parts[0]?.name).toMatch(/\/property\/part-\d+\.parquet$/);
    expect(property?.size).toBe(property?.parts.reduce((n, p) => n + p.size, 0));
  });
});

describe("verify-lane", () => {
  const BYTES = new TextEncoder().encode("published bytes");
  const SHA = createHash("sha256").update(BYTES).digest("hex");
  const target = (patch: Partial<VerifyTarget> = {}): VerifyTarget => ({
    cid: LATEST.manifestCid,
    size: BYTES.length,
    sha256: SHA,
    kind: "table",
    codec: "dag-pb",
    ...patch,
  });
  const noSleep = vi.fn(async () => undefined);

  const lane = async (fetchImpl: typeof fetch, t: VerifyTarget = target()) => {
    const states: LaneState[] = [];
    const sleeps: number[] = [];
    const final = await runVerifyLane({
      url: verifyLaneUrl(URLS, "pinata", t.cid),
      target: t,
      fetch: fetchImpl,
      sleep: async (ms) => {
        sleeps.push(ms);
        await noSleep();
      },
      onState: (s) => states.push(s),
    });
    return { final, states, sleeps };
  };

  it("builds gateway URLs only, never the CID copy", () => {
    expect(verifyLaneUrl(URLS, "pinata", LATEST.manifestCid)).toBe(
      `https://pinata.host.test/ipfs/${LATEST.manifestCid}`,
    );
    expect(verifyLaneUrl(URLS, "filebase", LATEST.manifestCid)).toBe(
      `https://filebase.host.test/ipfs/${LATEST.manifestCid}`,
    );
    expect(verifyLaneUrl(URLS, "orbitor", LATEST.manifestCid)).toBe(
      `https://orbitor.host.test/ipfs/${LATEST.manifestCid}`,
    );
  });

  it("idle → fetching → verified when size and SHA-256 match; a plain GET with credentials omitted", async () => {
    const inits: (RequestInit | undefined)[] = [];
    const { final, states } = await lane((async (_i: RequestInfo | URL, init?: RequestInit) => {
      inits.push(init);
      return new Response(BYTES, { status: 200 });
    }) as typeof fetch);
    expect(states.map((s) => s.kind)).toEqual(["fetching", "verified"]);
    expect(final).toEqual({ kind: "verified", size: BYTES.length, sha256: SHA });
    expect(inits[0]?.credentials).toBe("omit");
    expect(inits[0]?.headers).toBeUndefined(); // no Range, no custom header: no CORS preflight
  });

  it("a size or digest difference is a mismatch with both values, never ✓", async () => {
    const other = new TextEncoder().encode("other bytes!!");
    const { final } = await lane(
      (async () => new Response(other, { status: 200 })) as typeof fetch,
    );
    expect(final.kind).toBe("mismatch");
    if (final.kind !== "mismatch") return;
    expect(final.got.size).toBe(other.length);
    expect(final.expected).toEqual({ size: BYTES.length, sha256: SHA });
    expect(final.text).toBe(VERIFY_TEXTS.mismatch(final.got, final.expected));
  });

  it("a raw CID must also equal the bytes' raw-leaves CID", async () => {
    const cid = await rawCid(BYTES);
    const ok = await lane(
      (async () => new Response(BYTES, { status: 200 })) as typeof fetch,
      target({ cid, codec: "raw" }),
    );
    expect(ok.final.kind).toBe("verified");
    const wrong = await lane(
      (async () => new Response(BYTES, { status: 200 })) as typeof fetch,
      target({ cid: LATEST.manifestCid, codec: "raw" }),
    );
    expect(wrong.final.kind).toBe("mismatch");
  });

  it("a readable 429 retries as 'rate-limited, retrying' with backoff 2/4/8 s, then verifies", async () => {
    let n = 0;
    const { final, states, sleeps } = await lane((async () =>
      ++n < 3
        ? new Response("", { status: 429 })
        : new Response(BYTES, { status: 200 })) as typeof fetch);
    expect(final.kind).toBe("verified");
    expect(sleeps).toEqual([2000, 4000]);
    const retrying = states.filter((s) => s.kind === "retrying");
    expect(retrying.map((s) => (s.kind === "retrying" ? s.text : ""))).toEqual([
      VERIFY_TEXTS.rateLimited,
      VERIFY_TEXTS.rateLimited,
    ]);
  });

  it("an unreadable network error retries as 'no readable response …'; gives up after 3 retries", async () => {
    expect(VERIFY_BACKOFF_MS).toEqual([2000, 4000, 8000]);
    let calls = 0;
    const { final, states, sleeps } = await lane((async () => {
      calls++;
      throw new TypeError("Failed to fetch");
    }) as typeof fetch);
    expect(calls).toBe(4);
    expect(sleeps).toEqual([2000, 4000, 8000]);
    expect(states.filter((s) => s.kind === "retrying")[0]).toMatchObject({
      text: VERIFY_TEXTS.noReadableResponse,
    });
    expect(final.kind).toBe("failed");
    expect(states.some((s) => s.kind === "verified")).toBe(false);
  });

  it("honours a readable Retry-After (seconds) on a 429", async () => {
    let n = 0;
    const { sleeps } = await lane((async () =>
      ++n === 1
        ? new Response("", { status: 429, headers: { "Retry-After": "5" } })
        : new Response(BYTES, { status: 200 })) as typeof fetch);
    expect(sleeps).toEqual([5000]);
  });

  it("a directory or a file over 50 MB → via CAR, with no request", async () => {
    const fetchImpl = vi.fn(
      async () => new Response(BYTES, { status: 200 }),
    ) as unknown as typeof fetch;
    expect(VERIFY_MAX_BYTES).toBe(50 * 1024 * 1024);
    const dir = await lane(fetchImpl, target({ kind: "directory" }));
    expect(dir.final).toEqual({ kind: "via_car", text: VERIFY_TEXTS.viaCar });
    const big = await lane(fetchImpl, target({ size: VERIFY_MAX_BYTES + 1 }));
    expect(big.final.kind).toBe("via_car");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("another HTTP status fails at once with the status, no retry", async () => {
    const { final, sleeps } = await lane(
      (async () => new Response("", { status: 404 })) as typeof fetch,
    );
    expect(final.kind).toBe("failed");
    expect(sleeps).toEqual([]);
    if (final.kind === "failed") expect(final.text).toContain("404");
  });
});
