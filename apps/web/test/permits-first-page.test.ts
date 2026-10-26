// A-16 T052. A11-9: a Permits subset larger than PERMITS_PREFETCH_MAX_BYTES read from the Filebase
// fallback used to be exempt from the cap (every byte through fetchParts, with no bound); it now
// fails with the typed TooLargeOnFallback and its fixed text, and no part is fetched. A11-11: the
// page paints the first page of permits (ordered as the full listing) as soon as the views are
// bound, before the full listing and its count check; the final result follows. Fakes only.
import { describe, expect, it, vi } from "vitest";
import type { RunManifestV1, RunsIndexV1 } from "@countylens/contract";
import type { QueryEngine } from "@countylens/query-core";
import { readPathUrls } from "@countylens/shared";
import type { PartToFetch } from "../src/data/fetch-parts";
import {
  createPermitsLoader,
  PERMITS_PREFETCH_MAX_BYTES,
  TOO_LARGE_ON_FALLBACK_TEXT,
  TooLargeOnFallback,
  type EngineModule,
  type PermitsLoaded,
} from "../src/engine/load-permits";
import type { PermitListRow } from "../src/engine/permit-list";
import { errorText, resolvePermitsState } from "../src/routes/Permits.page";

const manifestCid = "bafkreimanifest".padEnd(59, "a");
const index: RunsIndexV1 = {
  schema: "oracle-travis-runs-index.v1",
  runs: [{ runId: "test-run", manifestCid, finishedAt: "2026-10-01T00:00:00Z" }],
};
const urls = readPathUrls({ cidCopyHost: "copy.test", filebaseGatewayHost: "gateway.test" });
const row = (n: number) => ({ permit_number: `P-${n}` }) as unknown as PermitListRow;

function setup(options: {
  readonly source: "copy" | "fallback";
  readonly partSize: number;
  readonly emitted: number;
  readonly firstPage?: readonly PermitListRow[];
}) {
  const manifest = {
    runId: "test-run",
    coverage: { permits_emitted: { count: options.emitted, derivation: "published_rows" } },
    artifacts: [{ kind: "table", name: "tables/a/p.parquet", cid: "c-p", size: options.partSize }],
  } as unknown as RunManifestV1;
  const engine = {
    registerFile: async () => undefined,
    run: async () => undefined,
    all: async () => [],
    close: async () => undefined,
  } as unknown as QueryEngine & { close(): Promise<void> };
  const all = Array.from({ length: options.emitted }, (_, i) => row(i));
  const engineModule: EngineModule = {
    openEngine: vi.fn(async () => engine) as unknown as EngineModule["openEngine"],
    permitsPartNames: (m) => m.artifacts.map((a) => a.name),
    bindRun: vi.fn(async () => ({
      runId: "test-run",
      manifestCid,
      asOf: "x",
      tables: [],
      views: [],
    })),
    countPermits: vi.fn(async () => options.emitted),
    listPermits: vi.fn(async () => all),
    listFirstPage: vi.fn(async () => [...(options.firstPage ?? all.slice(0, 2))]),
  };
  const fetchParts = vi.fn(async (parts: readonly PartToFetch[]) =>
    parts.map((p) => ({ ...p, bytes: new Uint8Array(1) })),
  );
  const load = createPermitsLoader({
    loadRunsIndex: async () => index,
    latestRun: (i) => i.runs[0] as RunsIndexV1["runs"][number],
    loadManifest: async () => ({
      manifest,
      manifestCid,
      read: {
        cid: manifestCid,
        bytes: new Uint8Array(),
        source:
          options.source === "copy"
            ? { kind: "copy" as const, host: "copy.test" }
            : { kind: "fallback" as const, host: "ipfs.filebase.io" },
        partUrl: (a) => urls.copyUrl(a.cid),
      },
    }),
    fetchParts,
    fallbackLabel: () => (options.source === "fallback" ? "fallback · ipfs.filebase.io" : null),
    urls,
    engine: async () => engineModule,
  });
  return { load, fetchParts, engineModule };
}

describe("A11-9: TooLargeOnFallback", () => {
  it("a subset above the cap from the fallback throws the typed error and fetches nothing", async () => {
    const { load, fetchParts, engineModule } = setup({
      source: "fallback",
      partSize: PERMITS_PREFETCH_MAX_BYTES + 1,
      emitted: 1,
    });
    const failure = load(() => undefined, new AbortController().signal);
    await expect(failure).rejects.toBeInstanceOf(TooLargeOnFallback);
    await expect(failure).rejects.toThrow(TOO_LARGE_ON_FALLBACK_TEXT);
    expect(fetchParts).not.toHaveBeenCalled();
    expect(engineModule.bindRun).not.toHaveBeenCalled();
  });

  it("the banner shows the fixed text", () => {
    expect(errorText(new TooLargeOnFallback(100, 50))).toBe(TOO_LARGE_ON_FALLBACK_TEXT);
    expect(TOO_LARGE_ON_FALLBACK_TEXT).toMatch(/too large to read from the fallback gateway/);
  });

  it("a subset under the cap from the fallback is still prefetched through fetchParts", async () => {
    const { load, fetchParts } = setup({ source: "fallback", partSize: 10, emitted: 1 });
    await load(() => undefined, new AbortController().signal);
    expect(fetchParts).toHaveBeenCalledTimes(1);
  });

  it("a subset above the cap from the copy stays with DuckDB's range reads (no error)", async () => {
    const { load, fetchParts } = setup({
      source: "copy",
      partSize: PERMITS_PREFETCH_MAX_BYTES + 1,
      emitted: 1,
    });
    await expect(load(() => undefined, new AbortController().signal)).resolves.toBeDefined();
    expect(fetchParts).not.toHaveBeenCalled();
  });
});

describe("A11-11: first paint from the first page", () => {
  it("hands the first page to onFirstPage before the full listing resolves", async () => {
    const { load, engineModule } = setup({ source: "copy", partSize: 10, emitted: 5 });
    const pages: PermitsLoaded[] = [];
    const final = await load(
      () => undefined,
      new AbortController().signal,
      (first) => pages.push(first),
    );
    expect(pages).toHaveLength(1);
    expect(pages[0]?.partial).toBe(true);
    expect(pages[0]?.rows.map((r) => r.permit_number)).toEqual(["P-0", "P-1"]);
    expect(pages[0]?.permitsEmitted).toBe(5);
    expect(final.partial).toBeUndefined();
    expect(final.rows).toHaveLength(5);
    const firstOrder = (engineModule.listFirstPage as ReturnType<typeof vi.fn>).mock
      .invocationCallOrder[0] as number;
    const listOrder = (engineModule.listPermits as ReturnType<typeof vi.fn>).mock
      .invocationCallOrder[0] as number;
    expect(firstOrder).toBeLessThan(listOrder);
  });

  it("skips the first-page query when no one listens", async () => {
    const { load, engineModule } = setup({ source: "copy", partSize: 10, emitted: 5 });
    await load(() => undefined, new AbortController().signal);
    expect(engineModule.listFirstPage).not.toHaveBeenCalled();
  });

  it("a partial result is the first-page state: no count check yet", () => {
    const partial: PermitsLoaded = {
      runId: "r",
      manifestCid,
      permitsEmitted: 5,
      rows: [row(0), row(1)],
      fallbackLabel: null,
      partial: true,
    };
    expect(resolvePermitsState(partial).kind).toBe("first-page");
    const { partial: _drop, ...whole } = partial;
    expect(resolvePermitsState(whole).kind).toBe("error");
  });
});
