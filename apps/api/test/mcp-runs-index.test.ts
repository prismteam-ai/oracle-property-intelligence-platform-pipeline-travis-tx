// A-14 T024-T026 follow-up (G-3/G-4): `apps/api/src/mcp/runs-index.ts`'s `loadRunsIndex` reads
// the site's committed `/runs/index.json` over HTTPS when `RUNS_INDEX_URL` is set (the hosted
// Lambdas; the CID-copy bucket holds only `ipfs/*`, so there is no S3 path). The local-file
// fallback (`RUNS_INDEX_PATH_ENV`) stays for the stdio build and for tests that don't set the URL.
// `defaultResolveManifestCid` (agent) reuses the same loader. Nothing here touches the network:
// global fetch is stubbed, and the local-file cases point at a temp file.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultResolveManifestCid } from "../src/agent/ask.js";
import {
  latestOf,
  loadRunsIndex,
  resetRunsIndexCache,
  RUNS_INDEX_CACHE_MS,
  RUNS_INDEX_PATH_ENV,
  RUNS_INDEX_URL_ENV,
} from "../src/mcp/runs-index.js";

const CID1 = `ba${"a".repeat(60)}`;
const CID2 = `ba${"b".repeat(60)}`;

const INDEX = {
  schema: "oracle-travis-runs-index.v1",
  runs: [
    { runId: "a", manifestCid: CID1, finishedAt: "2026-01-01T00:00:00.000Z" },
    { runId: "b", manifestCid: CID2, finishedAt: "2026-06-01T00:00:00.000Z" },
  ],
};

const URL_ENV = { [RUNS_INDEX_URL_ENV]: "https://example.test/runs/index.json" };

describe("loadRunsIndex: RUNS_INDEX_URL set -> HTTPS GET of the site's runs/index.json", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    resetRunsIndexCache();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("A14-8: a fetched index is reused for RUNS_INDEX_CACHE_MS (60 s); a failure is never cached", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    fetchMock.mockRejectedValueOnce(new Error("network down"));
    await expect(loadRunsIndex(URL_ENV)).rejects.toThrow("network down");
    fetchMock.mockResolvedValue(new Response(JSON.stringify(INDEX), { status: 200 }));
    await loadRunsIndex(URL_ENV);
    await loadRunsIndex(URL_ENV);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(RUNS_INDEX_CACHE_MS).toBe(60_000);
    vi.setSystemTime(Date.now() + RUNS_INDEX_CACHE_MS + 1);
    fetchMock.mockResolvedValue(new Response(JSON.stringify(INDEX), { status: 200 }));
    await loadRunsIndex(URL_ENV);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("GETs the URL with a timeout signal and Zod-validates the result", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(INDEX), { status: 200 }));

    const index = await loadRunsIndex(URL_ENV);

    expect(index.runs).toHaveLength(2);
    expect(latestOf(index)).toEqual({
      runId: "b",
      manifestCid: CID2,
      finishedAt: "2026-06-01T00:00:00.000Z",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, { signal?: AbortSignal }];
    expect(url).toBe("https://example.test/runs/index.json");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("throws on a non-2xx answer (no default/empty index)", async () => {
    fetchMock.mockResolvedValue(new Response("nope", { status: 404 }));
    await expect(loadRunsIndex(URL_ENV)).rejects.toThrow(/404/);
  });

  it("throws when the body is not JSON", async () => {
    fetchMock.mockResolvedValue(new Response("<html>spa fallback</html>", { status: 200 }));
    await expect(loadRunsIndex(URL_ENV)).rejects.toThrow();
  });

  it("throws when the body fails RunsIndexV1 (never silently coerced)", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ schema: "wrong", runs: [] }), { status: 200 }),
    );
    await expect(loadRunsIndex(URL_ENV)).rejects.toThrow();
  });

  it("throws when the request times out / is aborted", async () => {
    fetchMock.mockRejectedValue(new DOMException("The operation timed out.", "TimeoutError"));
    await expect(loadRunsIndex(URL_ENV)).rejects.toThrow(/timed out/);
  });

  it("does not read the local file when the URL is set", async () => {
    fetchMock.mockResolvedValue(new Response("x", { status: 500 }));
    await expect(
      loadRunsIndex({ ...URL_ENV, [RUNS_INDEX_PATH_ENV]: "/definitely/missing.json" }),
    ).rejects.toThrow(/500/);
  });
});

describe("defaultResolveManifestCid (agent): reuses loadRunsIndex + latestOf", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    resetRunsIndexCache();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the manifest CID of the entry with the greatest finishedAt", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(INDEX), { status: 200 }));
    await expect(defaultResolveManifestCid(URL_ENV)).resolves.toBe(CID2);
  });

  it("throws on an empty index (no guessed run)", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ schema: INDEX.schema, runs: [] }), { status: 200 }),
    );
    await expect(defaultResolveManifestCid(URL_ENV)).rejects.toThrow(/no published runs/);
  });

  it("propagates a fetch failure", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 503 }));
    await expect(defaultResolveManifestCid(URL_ENV)).rejects.toThrow(/503/);
  });
});

describe("loadRunsIndex: RUNS_INDEX_URL unset -> local-file fallback (stdio build, tests)", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "countylens-mcp-runs-index-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("reads RUNS_INDEX_PATH when RUNS_INDEX_URL is not set", async () => {
    const path = join(dir, "index.json");
    writeFileSync(path, JSON.stringify(INDEX));

    const index = await loadRunsIndex({ [RUNS_INDEX_PATH_ENV]: path });

    expect(latestOf(index)).toEqual({
      runId: "b",
      manifestCid: CID2,
      finishedAt: "2026-06-01T00:00:00.000Z",
    });
  });

  it("throws when the local file is missing (no default/empty index)", async () => {
    await expect(
      loadRunsIndex({ [RUNS_INDEX_PATH_ENV]: join(dir, "missing.json") }),
    ).rejects.toThrow();
  });
});
