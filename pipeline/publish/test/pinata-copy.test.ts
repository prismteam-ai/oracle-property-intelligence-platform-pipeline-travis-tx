// A-16 T079 (AM-10): the Pinata second-copy tool over a fake Pinata API. No network, no real JWT.
// The fake answers pinFileToIPFS with the raw-leaves CIDv1 of the uploaded bytes (what the
// 2026-10-26 probe showed Pinata does with cidVersion 1), unless a test makes it answer another
// CID. Cases: match; mismatch -> unpin at once (+ stop for a manifest), unpin failure, a
// pre-existing duplicate left alone; budget stop (also under concurrency 3) and the quota cap on
// the flags; already-pinned skip and receipt preservation on a re-run; local SHA-256 mismatch
// skip; fail-closed manifest CIDs (runs/index.json or --manifest-cid; older runs taken from the
// index by default); --first-only; --dry-run; 429 backoff; upload 500 / network error recorded as
// an error and not resent; the multipart filename carries no "/"; the JWT never appears anywhere.
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { cidOfBytes } from "../src/cid.js";
import { jcsBytes } from "../src/jcs.js";
import {
  PreconditionError,
  localPathFor,
  runPinataCopy,
  safeName,
  type PinataCopyOptions,
} from "../src/pinata-copy.js";
import type { FetchLike } from "../src/pinata-pin.js";
import { main } from "../scripts/pinata-copy.js";

const JWT = "fake.pinata.jwt-value-that-must-never-appear";
const RUN_ID = "travis-full-run3-20261025";
const OLD_RUN = "travis-full-run2-20261024";
const MANIFEST_NAME = `runs/${RUN_ID}/manifest.json`;
const sha256Hex = (b: Uint8Array): string => createHash("sha256").update(b).digest("hex");

interface Table {
  name: string;
  cid: string;
  size: number;
  bytes: Uint8Array;
}

interface Fixture {
  root: string;
  filesRoot: string;
  manifestPath: string;
  manifestCid: string;
  indexPath: string;
  receiptsRoot: string;
  tables: Table[];
}

/** A RunManifestV1 with the given table artifacts and one CAR (never uploaded). */
async function manifestBytes(runId: string, tables: Table[]): Promise<Uint8Array> {
  const car = new TextEncoder().encode(`car of ${runId}`);
  const carCid = await cidOfBytes(car);
  return jcsBytes({
    schema: "oracle-travis-run-manifest.v1",
    runId,
    county: "travis",
    state: "TX",
    fips: "48453",
    startedAt: "2026-10-25T10:00:00.000Z",
    finishedAt: "2026-10-25T12:00:00.000Z",
    previousManifestCid: null,
    sources: [
      {
        name: "tcad-2026-certified-json",
        url: "https://traviscad.org/publicinformation/certified-roll-2026",
        watermark: "2026",
        captured_at: "2026-10-25T10:05:00.000Z",
        records: 1,
        added: 1,
        changed: 0,
        removed: 0,
        limitations: [],
      },
    ],
    artifacts: [
      {
        name: "car/county.car",
        cid: carCid,
        codec: "dag-json",
        kind: "car",
        carCid,
        size: car.length,
        sha256: sha256Hex(car),
      },
      ...tables.map((t) => ({
        name: t.name,
        cid: t.cid,
        codec: "raw",
        kind: "table",
        size: t.size,
        sha256: sha256Hex(t.bytes),
      })),
    ],
    profiles: [],
    coverage: {},
    limitations: [],
  });
}

async function fixture(
  sizes = [1000, 2000, 3000],
  opts: { inIndex?: boolean; oldRun?: boolean } = {},
): Promise<Fixture> {
  const root = mkdtempSync(join(tmpdir(), "pinata-copy-"));
  const filesRoot = join(root, "repo");
  const tables: Table[] = [];
  for (const [i, size] of sizes.entries()) {
    const bytes = new Uint8Array(size).fill(i + 1);
    const name = `pipeline/data/runs/${RUN_ID}/tables/t/part-0000${i}.parquet`;
    const path = join(filesRoot, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, bytes);
    tables.push({ name, cid: await cidOfBytes(bytes), size, bytes });
  }
  const bytes = await manifestBytes(RUN_ID, tables);
  const manifestPath = join(filesRoot, "runs", RUN_ID, "manifest.json");
  mkdirSync(dirname(manifestPath), { recursive: true });
  writeFileSync(manifestPath, bytes);
  const manifestCid = await cidOfBytes(bytes);
  const runs: Array<{ runId: string; manifestCid: string }> = [];
  if (opts.oldRun) {
    const old = await manifestBytes(OLD_RUN, []);
    const oldPath = join(filesRoot, "runs", OLD_RUN, "manifest.json");
    mkdirSync(dirname(oldPath), { recursive: true });
    writeFileSync(oldPath, old);
    runs.push({ runId: OLD_RUN, manifestCid: await cidOfBytes(old) });
  }
  if (opts.inIndex ?? true) runs.push({ runId: RUN_ID, manifestCid });
  const indexPath = join(filesRoot, "runs", "index.json");
  writeFileSync(indexPath, JSON.stringify({ runs }));
  return {
    root,
    filesRoot,
    manifestPath,
    manifestCid,
    indexPath,
    receiptsRoot: join(root, "receipts"),
    tables,
  };
}

function tbl(f: Fixture, i: number): Table {
  const t = f.tables[i];
  if (t === undefined) throw new Error(`fixture has no table ${i}`);
  return t;
}

interface FakeOptions {
  pinned?: string[];
  usage?: { pin_count: number; pin_size_total: number };
  /** Override the CID Pinata answers for an upload named `name`. */
  answer?: (name: string, realCid: string) => string;
  /** Answer isDuplicate: true for these upload names. */
  duplicate?: (name: string) => boolean;
  /** Statuses to answer for the first uploads of `name` before succeeding. */
  uploadStatuses?: (name: string) => number[];
  /** Throw a network error for every upload of `name`. */
  networkError?: (name: string) => boolean;
  /** Echo the JWT in an error body (to prove redaction). */
  echoJwtOn?: (name: string) => boolean;
  /** Status for every unpin (default 200). */
  unpinStatus?: number;
  /** Delay per upload, to let concurrent workers overlap. */
  delayMs?: number;
}

function fakePinata(opts: FakeOptions = {}) {
  const pinned = new Set(opts.pinned ?? []);
  const uploads: string[] = [];
  const fileNames: string[] = [];
  const unpins: string[] = [];
  const attempts = new Map<string, number>();
  const signals: Array<AbortSignal | null | undefined> = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const fetch: FetchLike = async (input, init) => {
    const url = new URL(String(input));
    signals.push(init?.signal);
    if (new Headers(init?.headers).get("authorization") !== `Bearer ${JWT}`)
      return new Response("unauthorized", { status: 401 });
    if (url.pathname === "/data/userPinnedDataTotal")
      return Response.json(opts.usage ?? { pin_count: 0, pin_size_total: 0 });
    if (url.pathname === "/data/pinList") {
      const cid = url.searchParams.get("hashContains") ?? "";
      return Response.json({ count: pinned.has(cid) ? 1 : 0, rows: pinned.has(cid) ? [{}] : [] });
    }
    if (url.pathname.startsWith("/pinning/unpin/")) {
      const cid = decodeURIComponent(url.pathname.slice("/pinning/unpin/".length));
      unpins.push(cid);
      if ((opts.unpinStatus ?? 200) !== 200)
        return new Response("nope", { status: opts.unpinStatus ?? 500 });
      pinned.delete(cid);
      return new Response("OK");
    }
    if (url.pathname === "/pinning/pinFileToIPFS") {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      try {
        await new Promise((r) => setTimeout(r, opts.delayMs ?? 2));
        const form = init?.body as FormData;
        const options = JSON.parse(String(form.get("pinataOptions")));
        if (options.cidVersion !== 1) return new Response("want v1", { status: 400 });
        const label = (JSON.parse(String(form.get("pinataMetadata"))) as { name: string }).name;
        // Real Pinata (2026-10-26): a "/" in the metadata name wraps the file in a folder and
        // answers the folder's CID. The fake does the same, so a regression shows as a mismatch.
        const slashInLabel = label.includes("/");
        const name = label.split(" > ").join("/");
        const file = form.get("file") as File;
        fileNames.push(file.name);
        const n = (attempts.get(name) ?? 0) + 1;
        attempts.set(name, n);
        if (opts.networkError?.(name)) throw new TypeError("fetch failed");
        const statuses = opts.uploadStatuses?.(name) ?? [];
        if (n <= statuses.length)
          return new Response(opts.echoJwtOn?.(name) ? `bad token ${JWT}` : "slow down", {
            status: statuses[n - 1] as number,
            headers: { "retry-after": "1" },
          });
        const bytes = new Uint8Array(await file.arrayBuffer());
        const real = slashInLabel
          ? "bafybeicjntqsqvszodo7tzhp6ke4gr5qdoezh7hobbzwqituawt7c2oswy"
          : await cidOfBytes(bytes);
        const cid = opts.answer ? opts.answer(name, real) : real;
        uploads.push(name);
        pinned.add(cid);
        return Response.json({
          IpfsHash: cid,
          PinSize: bytes.length + 11,
          Timestamp: "2026-10-26T10:00:00.000Z",
          ID: `id-${uploads.length}`,
          ...(opts.duplicate?.(name) ? { isDuplicate: true } : {}),
        });
      } finally {
        inFlight -= 1;
      }
    }
    return new Response("not found", { status: 404 });
  };
  return {
    fetch,
    pinned,
    uploads,
    fileNames,
    unpins,
    attempts,
    signals,
    maxInFlight: () => maxInFlight,
  };
}

let clockTick = 0;
function base(
  f: Fixture,
  fetch: FetchLike,
  lines: string[],
  over: Partial<PinataCopyOptions> = {},
): PinataCopyOptions {
  return {
    jwt: JWT,
    manifestPath: f.manifestPath,
    runId: RUN_ID,
    filesRoot: f.filesRoot,
    runsIndexPath: f.indexPath,
    receiptsRoot: f.receiptsRoot,
    fetch,
    sleep: async () => {},
    random: () => 0.5,
    now: () => new Date(Date.parse("2026-10-26T10:00:00Z") + 1000 * clockTick++),
    log: (l: string) => lines.push(l),
    ...over,
  };
}

function receiptFiles(f: Fixture): string[] {
  const dir = join(f.receiptsRoot, RUN_ID);
  return existsSync(dir) ? readdirSync(dir).sort() : [];
}

function readReceipt(f: Fixture, name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(f.receiptsRoot, RUN_ID, `${safeName(name)}.json`), "utf8"));
}

describe("pinata-copy: match", () => {
  it("uploads the manifest first, then every table, and records a receipt per file", async () => {
    const f = await fixture();
    const gw = fakePinata();
    const result = await runPinataCopy(base(f, gw.fetch, []));
    expect(result.exitCode).toBe(0);
    expect(gw.uploads[0]).toBe(MANIFEST_NAME);
    expect(gw.uploads.slice(1).sort()).toEqual(f.tables.map((t) => t.name).sort());
    expect(gw.uploads).not.toContain("car/county.car");
    expect(result.summary.counts.pinned).toBe(4);
    expect(result.summary.mismatches).toEqual([]);
    expect(result.summary.usage_before).toEqual({ pinCount: 0, pinSizeTotal: 0 });
    const files = receiptFiles(f);
    for (const t of f.tables) expect(files).toContain(`${safeName(t.name)}.json`);
    expect(files).toContain(`${safeName(MANIFEST_NAME)}.json`);
    expect(files).toContain("summary.json");
    expect(files.filter((n) => /^summary-\d{8}T\d{6}Z\.json$/.test(n))).toHaveLength(1);
    expect(readReceipt(f, tbl(f, 0).name)).toMatchObject({
      cid: tbl(f, 0).cid,
      name: tbl(f, 0).name,
      size: 1000,
      sha256: sha256Hex(tbl(f, 0).bytes),
      pinata_cid: tbl(f, 0).cid,
      match: true,
      pinned_at: "2026-10-26T10:00:00.000Z",
      pin_size: 1011,
      status: "pinned",
    });
    expect(gw.maxInFlight()).toBeLessThanOrEqual(3);
  });

  it("sends the basename as the multipart filename (no '/'), the full path only as the name", async () => {
    const f = await fixture();
    const gw = fakePinata();
    await runPinataCopy(base(f, gw.fetch, []));
    expect(gw.fileNames.length).toBe(4);
    for (const n of gw.fileNames) expect(n).not.toContain("/");
    expect(gw.fileNames).toContain("manifest.json");
    expect(gw.fileNames).toContain("part-00000.parquet");
    expect(gw.uploads).toContain(tbl(f, 0).name);
  });

  it("bounds every Pinata request with a timeout signal", async () => {
    const f = await fixture();
    const gw = fakePinata();
    await runPinataCopy(base(f, gw.fetch, []));
    expect(gw.signals.length).toBeGreaterThan(0);
    expect(gw.signals.every((s) => s instanceof AbortSignal)).toBe(true);
  });
});

describe("pinata-copy: mismatch", () => {
  it("unpins a table whose Pinata CID differs, records it, continues, and exits 1", async () => {
    const f = await fixture();
    const bad = tbl(f, 1);
    const gw = fakePinata({
      answer: (name, real) => (name === bad.name ? "bafkreiwrongcid" : real),
    });
    const lines: string[] = [];
    const result = await runPinataCopy(base(f, gw.fetch, lines));
    expect(result.exitCode).toBe(1);
    expect(gw.unpins).toEqual(["bafkreiwrongcid"]);
    expect(gw.pinned.has("bafkreiwrongcid")).toBe(false);
    expect(result.summary.mismatches).toEqual([
      {
        name: bad.name,
        cid: bad.cid,
        pinata_cid: "bafkreiwrongcid",
        unpinned: true,
        preexisting: false,
      },
    ]);
    expect(result.summary.counts.pinned).toBe(3);
    expect(result.receipts.find((r) => r.name === bad.name)).toMatchObject({
      status: "mismatch_unpinned",
      match: false,
    });
    expect(lines.some((l) => l.startsWith("FAIL MISMATCH") && l.includes(bad.name))).toBe(true);
  });

  it("records mismatch_unpin_failed when the unpin itself fails", async () => {
    const f = await fixture();
    const bad = tbl(f, 0);
    const gw = fakePinata({
      answer: (name, real) => (name === bad.name ? "bafkreiwrongcid" : real),
      unpinStatus: 400,
    });
    const result = await runPinataCopy(base(f, gw.fetch, []));
    expect(result.exitCode).toBe(1);
    expect(gw.unpins).toEqual(["bafkreiwrongcid"]);
    expect(result.summary.counts.mismatch_unpin_failed).toBe(1);
    const receipt = result.receipts.find((r) => r.name === bad.name);
    expect(receipt?.status).toBe("mismatch_unpin_failed");
    expect(receipt?.reason).toMatch(/unpin failed/);
    expect(result.summary.mismatches[0]).toMatchObject({ unpinned: false, preexisting: false });
  });

  it("leaves a pre-existing duplicate pin alone on a mismatch (isDuplicate: true)", async () => {
    const f = await fixture();
    const bad = tbl(f, 0);
    const gw = fakePinata({
      answer: (name, real) => (name === bad.name ? "bafkreisomeoneelses" : real),
      duplicate: (name) => name === bad.name,
    });
    const result = await runPinataCopy(base(f, gw.fetch, []));
    expect(result.exitCode).toBe(1);
    expect(gw.unpins).toEqual([]);
    expect(result.summary.counts.mismatch_preexisting).toBe(1);
    expect(result.summary.mismatches[0]).toMatchObject({ unpinned: false, preexisting: true });
  });

  it("stops after a manifest mismatch (default) and uploads nothing else", async () => {
    const f = await fixture();
    const gw = fakePinata({
      answer: (name, real) => (name.endsWith("manifest.json") ? "QmV0" : real),
    });
    const result = await runPinataCopy(base(f, gw.fetch, []));
    expect(result.exitCode).toBe(1);
    expect(gw.uploads).toEqual([MANIFEST_NAME]);
    expect(gw.unpins).toEqual(["QmV0"]);
    expect(result.summary.stopped).toBe("mismatch");
    expect(result.summary.left.map((l) => l.status)).toEqual(Array(3).fill("left_stopped"));
  });

  it("--stop-on-mismatch also stops after a table mismatch", async () => {
    const f = await fixture();
    const gw = fakePinata({
      answer: (name, real) => (name === tbl(f, 0).name ? "bafkreiother" : real),
    });
    const result = await runPinataCopy(
      base(f, gw.fetch, [], { stopOnMismatchTable: true, concurrency: 1 }),
    );
    expect(result.exitCode).toBe(1);
    expect(result.summary.stopped).toBe("mismatch");
    expect(result.summary.counts.left_stopped).toBe(2);
  });
});

describe("pinata-copy: upload errors", () => {
  it("records an upload 500 as an error, does not resend it, and exits 1", async () => {
    const f = await fixture();
    const bad = tbl(f, 0);
    const gw = fakePinata({ uploadStatuses: (n) => (n === bad.name ? [500] : []) });
    const result = await runPinataCopy(base(f, gw.fetch, []));
    expect(result.exitCode).toBe(1);
    expect(gw.attempts.get(bad.name)).toBe(1);
    expect(result.summary.errors.map((e) => e.name)).toEqual([bad.name]);
    expect(result.receipts.find((r) => r.name === bad.name)?.status).toBe("error");
    expect(result.summary.counts.pinned).toBe(3);
  });

  it("records a network error (or a timeout) on a write as an error, not resent", async () => {
    const f = await fixture();
    const bad = tbl(f, 2);
    const gw = fakePinata({ networkError: (n) => n === bad.name });
    const result = await runPinataCopy(base(f, gw.fetch, []));
    expect(result.exitCode).toBe(1);
    expect(gw.attempts.get(bad.name)).toBe(1);
    expect(result.summary.errors[0]).toMatchObject({ name: bad.name });
    expect(result.summary.errors[0]?.reason).toMatch(/fetch failed/);
  });
});

describe("pinata-copy: budget", () => {
  it("stops cleanly before the first file that does not fit and reports what was left", async () => {
    const f = await fixture([1000, 2000, 3000]);
    const gw = fakePinata();
    const lines: string[] = [];
    const manifestSize = readFileSync(f.manifestPath).length;
    const result = await runPinataCopy(
      base(f, gw.fetch, lines, { budgetBytes: manifestSize + 1000 + 1999, concurrency: 1 }),
    );
    expect(result.exitCode).toBe(0);
    expect(result.summary.stopped).toBe("budget");
    expect(gw.uploads).toEqual([MANIFEST_NAME, tbl(f, 0).name]);
    expect(result.summary.left.map((l) => l.name)).toEqual([tbl(f, 1).name, tbl(f, 2).name]);
    expect(result.summary.bytes.left).toBe(5000);
    expect(lines.some((l) => l.startsWith("stop budget:"))).toBe(true);
  });

  it("stops cleanly under concurrency 3: never over budget, every file pinned or left", async () => {
    const sizes = Array.from({ length: 9 }, () => 1000);
    const f = await fixture(sizes);
    const gw = fakePinata({ delayMs: 10 });
    const manifestSize = readFileSync(f.manifestPath).length;
    const budget = manifestSize + 4500;
    const result = await runPinataCopy(
      base(f, gw.fetch, [], { budgetBytes: budget, concurrency: 3 }),
    );
    expect(result.exitCode).toBe(0);
    expect(result.summary.stopped).toBe("budget");
    expect(gw.maxInFlight()).toBeLessThanOrEqual(3);
    expect(result.summary.counts.pinned).toBe(5);
    expect(result.summary.bytes.uploaded).toBeLessThanOrEqual(budget);
    expect(result.summary.counts.left_budget).toBe(5);
    const seen = [...gw.uploads, ...result.summary.left.map((l) => l.name)];
    expect(new Set(seen).size).toBe(10);
  });

  it("defaults to 950 MB minus usage and 500 files minus the pin count", async () => {
    const f = await fixture();
    const gw = fakePinata({ usage: { pin_count: 498, pin_size_total: 949_000_000 } });
    const result = await runPinataCopy(base(f, gw.fetch, [], { concurrency: 1 }));
    expect(result.summary.budget).toEqual({
      bytes: 1_000_000,
      files: 2,
      source: "quota minus usage",
    });
    expect(result.summary.counts.pinned).toBe(2);
    expect(result.summary.counts.left_budget).toBe(2);
  });

  it("caps --budget-bytes / --budget-files at the quota minus usage", async () => {
    const f = await fixture();
    const gw = fakePinata({ usage: { pin_count: 499, pin_size_total: 940_000_000 } });
    const result = await runPinataCopy(
      base(f, gw.fetch, [], { budgetBytes: 900_000_000, budgetFiles: 50 }),
    );
    expect(result.summary.budget).toEqual({
      bytes: 10_000_000,
      files: 1,
      source: "flag, capped at quota minus usage",
    });
    expect(result.summary.counts.pinned).toBe(1);
  });
});

describe("pinata-copy: idempotent re-runs", () => {
  it("skips a CID Pinata already lists as pinned", async () => {
    const f = await fixture();
    const gw = fakePinata({ pinned: [f.manifestCid, tbl(f, 2).cid] });
    const result = await runPinataCopy(base(f, gw.fetch, []));
    expect(result.exitCode).toBe(0);
    expect(gw.uploads.sort()).toEqual([tbl(f, 0).name, tbl(f, 1).name].sort());
    expect(result.summary.counts.already_pinned).toBe(2);
    expect(result.receipts.find((r) => r.cid === f.manifestCid)?.status).toBe("already_pinned");
  });

  it("a re-run keeps the original pinned receipts and adds a second timestamped summary", async () => {
    const f = await fixture();
    const gw = fakePinata();
    await runPinataCopy(base(f, gw.fetch, []));
    const before = readReceipt(f, tbl(f, 0).name);
    expect(before.status).toBe("pinned");
    const lines: string[] = [];
    const again = await runPinataCopy(base(f, gw.fetch, lines));
    expect(again.summary.counts.already_pinned).toBe(4);
    expect(readReceipt(f, tbl(f, 0).name)).toEqual(before);
    expect(lines.some((l) => l.includes("kept the existing pinned receipt"))).toBe(true);
    expect(receiptFiles(f).filter((n) => n.startsWith("summary-"))).toHaveLength(2);
    const latest = JSON.parse(
      readFileSync(join(f.receiptsRoot, RUN_ID, "summary.json"), "utf8"),
    ) as { counts: { already_pinned: number } };
    expect(latest.counts.already_pinned).toBe(4);
  });
});

describe("pinata-copy: local checks (fail closed)", () => {
  it("skips (never uploads) a table whose bytes on disk differ from the manifest, or that is missing", async () => {
    const f = await fixture();
    writeFileSync(join(f.filesRoot, tbl(f, 0).name), new Uint8Array(1000).fill(9));
    rmSync(join(f.filesRoot, tbl(f, 1).name));
    const gw = fakePinata();
    const result = await runPinataCopy(base(f, gw.fetch, []));
    expect(gw.uploads).not.toContain(tbl(f, 0).name);
    expect(gw.uploads).not.toContain(tbl(f, 1).name);
    const reasons = Object.fromEntries(result.summary.skipped.map((s) => [s.name, s.reason]));
    expect(reasons[tbl(f, 0).name]).toMatch(/sha256 on disk/);
    expect(reasons[tbl(f, 1).name]).toMatch(/missing on disk/);
    expect(result.summary.counts.skipped_local).toBe(2);
    expect(result.exitCode).toBe(0);
  });

  it("refuses a manifest that is not its own exact JCS bytes, before any request", async () => {
    const f = await fixture();
    writeFileSync(f.manifestPath, `${readFileSync(f.manifestPath, "utf8")}\n`);
    const gw = fakePinata();
    await expect(runPinataCopy(base(f, gw.fetch, []))).rejects.toBeInstanceOf(PreconditionError);
    expect(gw.uploads).toEqual([]);
  });

  it("refuses a manifest that is not a RunManifestV1", async () => {
    const f = await fixture();
    writeFileSync(f.manifestPath, jcsBytes({ runId: RUN_ID, artifacts: [] }));
    const gw = fakePinata();
    await expect(runPinataCopy(base(f, gw.fetch, []))).rejects.toThrow(/not a RunManifestV1/);
    expect(gw.uploads).toEqual([]);
  });

  it("refuses the run manifest when no expected CID is known; --manifest-cid supplies one", async () => {
    const f = await fixture(undefined, { inIndex: false });
    const gw = fakePinata();
    await expect(runPinataCopy(base(f, gw.fetch, []))).rejects.toThrow(/no expected CID/);
    expect(gw.uploads).toEqual([]);
    await expect(
      runPinataCopy(base(f, gw.fetch, [], { manifestCid: "bafkreiwrong" })),
    ).rejects.toThrow(/the command line names bafkreiwrong/);
    const ok = await runPinataCopy(
      base(f, gw.fetch, [], { manifestCid: f.manifestCid, firstOnly: true }),
    );
    expect(ok.exitCode).toBe(0);
    expect(gw.uploads).toEqual([MANIFEST_NAME]);
  });

  it("copies every other run manifest runs/index.json lists by default, checked against its CID", async () => {
    const f = await fixture(undefined, { oldRun: true });
    const gw = fakePinata();
    const result = await runPinataCopy(base(f, gw.fetch, [], { kinds: ["manifest"] }));
    expect(result.exitCode).toBe(0);
    expect(gw.uploads).toEqual([MANIFEST_NAME, `runs/${OLD_RUN}/manifest.json`]);

    // --no-index-manifests: only the run manifest.
    const g2 = fakePinata();
    await runPinataCopy(
      base(f, g2.fetch, [], { kinds: ["manifest"], indexManifests: false, receiptsRoot: f.root }),
    );
    expect(g2.uploads).toEqual([MANIFEST_NAME]);
  });

  it("skips an older manifest whose bytes do not hash to its index CID, or with no expected CID", async () => {
    const f = await fixture(undefined, { oldRun: true });
    const index = JSON.parse(readFileSync(f.indexPath, "utf8")) as {
      runs: Array<{ runId: string; manifestCid: string }>;
    };
    for (const r of index.runs) if (r.runId === OLD_RUN) r.manifestCid = "bafkreinotthisone";
    writeFileSync(f.indexPath, JSON.stringify(index));
    const stray = join(f.root, "stray.json");
    writeFileSync(stray, await manifestBytes("travis-full-run9-20261030", []));
    const gw = fakePinata();
    const result = await runPinataCopy(
      base(f, gw.fetch, [], {
        kinds: ["manifest"],
        extraManifests: [{ path: stray }, { path: join(f.root, "nope.json") }],
      }),
    );
    expect(gw.uploads).toEqual([MANIFEST_NAME]);
    expect(result.summary.skipped.map((s) => s.reason)).toEqual([
      expect.stringMatching(/runs\/index.json names bafkreinotthisone/),
      expect.stringMatching(/no expected CID/),
      "missing on disk",
    ]);
  });

  it("refuses an artifact name that escapes --files-root", () => {
    expect(localPathFor("/a/b", "../c")).toBeNull();
    expect(localPathFor("/a/b", "/etc/passwd")).toBeNull();
    expect(localPathFor("/a/b", "x/y")).toBe("/a/b/x/y");
  });
});

describe("pinata-copy: probe and dry run", () => {
  it("--first-only uploads just the run manifest and stops", async () => {
    const f = await fixture(undefined, { oldRun: true });
    const gw = fakePinata();
    const result = await runPinataCopy(base(f, gw.fetch, [], { firstOnly: true }));
    expect(result.exitCode).toBe(0);
    expect(gw.uploads).toEqual([MANIFEST_NAME]);
    expect(result.summary.first_only).toBe(true);
  });

  it("--dry-run makes no request and writes nothing", async () => {
    const f = await fixture();
    let calls = 0;
    const fetch: FetchLike = async () => {
      calls += 1;
      return new Response("", { status: 500 });
    };
    const result = await runPinataCopy(base(f, fetch, [], { dryRun: true, jwt: "" }));
    expect(calls).toBe(0);
    expect(result.summary.counts.planned).toBe(4);
    expect(receiptFiles(f)).toEqual([]);
  });
});

describe("pinata-copy: 429 backoff and JWT redaction", () => {
  it("retries a 429 upload with backoff, then succeeds", async () => {
    const f = await fixture();
    const gw = fakePinata({
      uploadStatuses: (n) => (n === tbl(f, 0).name ? [429, 429] : []),
    });
    const sleeps: number[] = [];
    const result = await runPinataCopy(
      base(f, gw.fetch, [], { sleep: async (ms) => void sleeps.push(ms) }),
    );
    expect(result.exitCode).toBe(0);
    expect(gw.attempts.get(tbl(f, 0).name)).toBe(3);
    expect(sleeps).toEqual([1000, 1000]);
  });

  it("never prints, stores or returns the JWT, even when Pinata echoes it", async () => {
    const f = await fixture();
    const gw = fakePinata({
      uploadStatuses: (n) => (n === tbl(f, 0).name ? [401] : []),
      echoJwtOn: () => true,
    });
    const out: string[] = [];
    const err: string[] = [];
    const code = await main(
      [
        "--manifest",
        f.manifestPath,
        "--run-id",
        RUN_ID,
        "--files-root",
        f.filesRoot,
        "--receipts-root",
        f.receiptsRoot,
        "--runs-index",
        f.indexPath,
      ],
      { PINATA_JWT: JWT },
      { out: (l) => out.push(l), err: (l) => err.push(l) },
      { fetch: gw.fetch, sleep: async () => {} },
    );
    expect(code).toBe(1);
    const everything = [
      ...out,
      ...err,
      ...receiptFiles(f).map((n) => readFileSync(join(f.receiptsRoot, RUN_ID, n), "utf8")),
    ].join("\n");
    expect(everything).toContain("[redacted]");
    expect(everything).not.toContain(JWT);
  });

  it("refuses without PINATA_JWT (exit 2) and prints usage on a bad flag", async () => {
    const f = await fixture();
    const err: string[] = [];
    const io = { out: () => {}, err: (l: string) => err.push(l) };
    const args = ["--manifest", f.manifestPath, "--run-id", RUN_ID, "--files-root", f.filesRoot];
    expect(await main(args, {}, io)).toBe(2);
    expect(err.join("\n")).toMatch(/PINATA_JWT is not set/);
    expect(await main([...args, "--kinds", "car"], { PINATA_JWT: JWT }, io)).toBe(2);
  });
});

describe("pinata-copy: review batch 2", () => {
  it("an upload ERROR on the run manifest stops the run before any table upload", async () => {
    const f = await fixture();
    const gw = fakePinata({ uploadStatuses: (n) => (n === MANIFEST_NAME ? [500] : []) });
    const result = await runPinataCopy(base(f, gw.fetch, []));
    expect(result.exitCode).toBe(1);
    expect(gw.uploads).toEqual([]);
    expect(gw.attempts.get(MANIFEST_NAME)).toBe(1);
    expect(result.summary.stopped).toBe("error");
    expect(result.summary.counts.left_stopped).toBe(3);
    expect(result.summary.left[0]?.reason).toMatch(/upload error on runs\//);
  });

  it("refunds the budget of an upload that errored, so later files still fit", async () => {
    const f = await fixture([1000, 1000, 1000]);
    const gw = fakePinata({ uploadStatuses: (n) => (n === tbl(f, 0).name ? [500] : []) });
    const manifestSize = readFileSync(f.manifestPath).length;
    const result = await runPinataCopy(
      base(f, gw.fetch, [], { budgetBytes: manifestSize + 2000, concurrency: 1 }),
    );
    expect(result.summary.counts.error).toBe(1);
    expect(gw.uploads).toEqual([MANIFEST_NAME, tbl(f, 1).name, tbl(f, 2).name]);
    expect(result.summary.stopped).toBeNull();
  });

  it("refunds the budget of a mismatching pin that was unpinned", async () => {
    const f = await fixture([1000, 1000, 1000]);
    const gw = fakePinata({
      answer: (name, real) => (name === tbl(f, 0).name ? "bafkreiwrongcid" : real),
    });
    const manifestSize = readFileSync(f.manifestPath).length;
    const result = await runPinataCopy(
      base(f, gw.fetch, [], { budgetBytes: manifestSize + 2000, concurrency: 1 }),
    );
    expect(result.summary.counts.mismatch_unpinned).toBe(1);
    expect(result.summary.counts.pinned).toBe(3);
    expect(result.summary.stopped).toBeNull();
  });

  it("does not refund a mismatching pin whose unpin failed (it still uses quota)", async () => {
    const f = await fixture([1000, 1000, 1000]);
    const gw = fakePinata({
      answer: (name, real) => (name === tbl(f, 0).name ? "bafkreiwrongcid" : real),
      unpinStatus: 400,
    });
    const manifestSize = readFileSync(f.manifestPath).length;
    const result = await runPinataCopy(
      base(f, gw.fetch, [], { budgetBytes: manifestSize + 2000, concurrency: 1 }),
    );
    expect(result.summary.counts.mismatch_unpin_failed).toBe(1);
    expect(result.summary.stopped).toBe("budget");
    expect(result.summary.left.map((l) => l.name)).toEqual([tbl(f, 2).name]);
  });

  it("skips and reports an unsafe runId from runs/index.json (no path is built from it)", async () => {
    const f = await fixture();
    const index = JSON.parse(readFileSync(f.indexPath, "utf8")) as {
      runs: Array<{ runId: string; manifestCid: string }>;
    };
    index.runs.push({ runId: "../../etc", manifestCid: f.manifestCid });
    writeFileSync(f.indexPath, JSON.stringify(index));
    const gw = fakePinata();
    const result = await runPinataCopy(base(f, gw.fetch, [], { kinds: ["manifest"] }));
    expect(gw.uploads).toEqual([MANIFEST_NAME]);
    expect(result.summary.skipped).toEqual([
      expect.objectContaining({
        reason: "unsafe run id in runs/index.json",
        status: "skipped_local",
      }),
    ]);
  });

  it("compares against the JCS bytes of the parsed RunManifestV1 (as verify.ts does)", async () => {
    const f = await fixture();
    const parsed = JSON.parse(readFileSync(f.manifestPath, "utf8")) as unknown;
    // Same content, not canonical bytes: refused.
    writeFileSync(f.manifestPath, JSON.stringify(parsed, null, 2));
    const gw = fakePinata();
    await expect(runPinataCopy(base(f, gw.fetch, []))).rejects.toThrow(
      /not the exact JCS bytes of its own content/,
    );
    // Canonical bytes of the parsed manifest: accepted (CID from runs/index.json still matches).
    writeFileSync(f.manifestPath, jcsBytes(parsed));
    const ok = await runPinataCopy(base(f, gw.fetch, [], { firstOnly: true }));
    expect(ok.exitCode).toBe(0);
  });
});
