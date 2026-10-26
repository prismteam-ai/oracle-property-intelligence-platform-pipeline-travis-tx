// The Permits load (A-03 T054/T056): run index → latest run → manifest by CID (the read decides
// the host: CID copy or the labelled Filebase fallback, D-2) → the table parts from that same host,
// in parallel, CID-verified (../data/fetch-parts; no mixed hosts in one load) → bind them as
// registered files → the page's COUNT (checked against the manifest) → the single page of rows.
// ERR-17: the engine starts at the same moment as the index read, so its download and compile
// overlap the manifest and part reads instead of preceding them. The engine emits User Timing
// measures (./timing). The engine
// module is imported dynamically, so DuckDB-WASM, apache-arrow and query-core stay in their own
// chunk until this runs. Every count comes from the manifest (FR-009). Dependencies are
// injectable for the unit tests; the defaults are the real modules.
import type { RunManifestV1, RunsIndexV1 } from "@countylens/contract";
import {
  PERMITS_PAGE_SIZE,
  PERMITS_TEXTS,
  readPathUrls,
  type ReadPathUrls,
} from "@countylens/shared";
import {
  fallbackLabel as defaultFallbackLabel,
  type FetchByCidOptions,
  type ReadSource,
} from "../data/fetch-by-cid";
import {
  fetchParts as defaultFetchParts,
  partsToPrefetch,
  registeredPartName,
  type FetchedPart,
  type FetchPartsOptions,
  type PartToFetch,
} from "../data/fetch-parts";
import { loadManifest as defaultLoadManifest, type LoadedManifest } from "../data/manifest";
import {
  latestRun as defaultLatestRun,
  loadRunsIndex as defaultLoadRunsIndex,
  type RunsIndexEntry,
} from "../data/runs-index";
import type {
  bindRun,
  countPermits,
  listPermits,
  openEngine,
  permitsPartNames,
} from "./duckdb-wasm";
import type { PermitListRow } from "./permit-list";
import { STAGE_TEXTS } from "./stages";

/**
 * The Permits path's own prefetch cap for the bound subset (the default PART_PREFETCH_MAX_BYTES,
 * 16 MiB, is unchanged for every other path). The subset of a full run is ~37 MB.
 */
export const PERMITS_PREFETCH_MAX_BYTES = 64 * 1024 * 1024;

/** A11-9: the banner text when the fallback served a run whose Permits subset is above the cap. */
export const TOO_LARGE_ON_FALLBACK_TEXT =
  "This copy is too large to read from the fallback gateway. Try again when the CID copy is back.";

/**
 * A11-9: the Filebase fallback served the manifest and the Permits parts total more than
 * PERMITS_PREFETCH_MAX_BYTES. Neither path is safe: DuckDB's own range reads have no 429/CORS
 * retry (ERR-15) and an unbounded prefetch has no size limit, so the load stops with this error.
 */
export class TooLargeOnFallback extends Error {
  override readonly name = "TooLargeOnFallback";

  constructor(
    readonly bytes: number,
    readonly limit: number,
  ) {
    super(TOO_LARGE_ON_FALLBACK_TEXT);
  }
}

/** What the page renders from: manifest facts plus the listed rows. */
export interface PermitsLoaded {
  readonly runId: string;
  readonly manifestCid: string;
  /** `coverage.permits_emitted.count` from the manifest. */
  readonly permitsEmitted: number;
  readonly rows: readonly PermitListRow[];
  /** `fallback · {host}` when the Filebase gateway served the manifest and parts; null for the copy. */
  readonly fallbackLabel: string | null;
  /** A11-11: true on the early first page (rows = the first PERMITS_PAGE_SIZE, no count check yet). */
  readonly partial?: true;
}

export type PermitsLoader = (
  report: (stage: string) => void,
  signal: AbortSignal,
  /** A11-11: receives the first page as soon as the views are bound, before the full listing. */
  onFirstPage?: (first: PermitsLoaded) => void,
) => Promise<PermitsLoaded>;

/** The engine chunk's surface (`import("./duckdb-wasm")`). */
export interface EngineModule {
  readonly openEngine: typeof openEngine;
  readonly bindRun: typeof bindRun;
  /** The part names bindRun reads: the Permits views' tables only (ERR-19). */
  readonly permitsPartNames: typeof permitsPartNames;
  readonly countPermits: typeof countPermits;
  readonly listPermits: typeof listPermits;
  /** The first page in listing order (duckdb-wasm listFirstPage); absent = no early paint. */
  readonly listFirstPage?: (engine: OpenedEngine, pageSize: number) => Promise<PermitListRow[]>;
}

export interface PermitsLoaderDeps {
  readonly loadRunsIndex: (options: { readonly signal: AbortSignal }) => Promise<RunsIndexV1>;
  readonly latestRun: (index: RunsIndexV1) => RunsIndexEntry;
  readonly loadManifest: (cid: string, options: FetchByCidOptions) => Promise<LoadedManifest>;
  readonly fallbackLabel: (source: ReadSource) => string | null;
  readonly urls: ReadPathUrls;
  readonly engine: () => Promise<EngineModule>;
  readonly fetchParts: (
    parts: readonly PartToFetch[],
    read: LoadedManifest["read"],
    options: FetchPartsOptions,
  ) => Promise<FetchedPart[]>;
}

function envHost(key: "VITE_CID_COPY_HOST" | "VITE_FILEBASE_GATEWAY_HOST"): string {
  const value: unknown =
    key === "VITE_CID_COPY_HOST"
      ? import.meta.env.VITE_CID_COPY_HOST
      : import.meta.env.VITE_FILEBASE_GATEWAY_HOST;
  if (typeof value !== "string" || value === "") {
    throw new Error(`${key} is not set: the web build reads the public hosts from its environment`);
  }
  return value;
}

/** The read-path URLs from the build environment (plan § "Fixed texts and config keys"). */
export function readPathUrlsFromEnv(): ReadPathUrls {
  return readPathUrls({
    cidCopyHost: envHost("VITE_CID_COPY_HOST"),
    filebaseGatewayHost: envHost("VITE_FILEBASE_GATEWAY_HOST"),
  });
}

function permitsEmitted(manifest: RunManifestV1): number {
  const count = manifest.coverage["permits_emitted"];
  if (count === undefined) {
    throw new Error(
      "Manifest has no coverage.permits_emitted; every count comes from the manifest (FR-009)",
    );
  }
  return count.count;
}

type OpenedEngine = Awaited<ReturnType<typeof openEngine>>;

export function createPermitsLoader(overrides: Partial<PermitsLoaderDeps> = {}): PermitsLoader {
  return async (report, signal, onFirstPage) => {
    const deps: PermitsLoaderDeps = {
      loadRunsIndex: overrides.loadRunsIndex ?? defaultLoadRunsIndex,
      latestRun: overrides.latestRun ?? defaultLatestRun,
      loadManifest: overrides.loadManifest ?? defaultLoadManifest,
      fallbackLabel: overrides.fallbackLabel ?? defaultFallbackLabel,
      urls: overrides.urls ?? readPathUrlsFromEnv(),
      engine: overrides.engine ?? (() => import("./duckdb-wasm")),
      fetchParts: overrides.fetchParts ?? defaultFetchParts,
    };
    report(STAGE_TEXTS.engine);
    // ERR-17: started now, awaited only once the manifest and the parts are in hand.
    const loadingModule = deps.engine();
    const starting: Promise<{ module: EngineModule; engine: OpenedEngine }> = loadingModule.then(
      async (module) => ({ module, engine: await module.openEngine() }),
    );
    loadingModule.catch(() => undefined);
    starting.catch(() => undefined);
    try {
      report(STAGE_TEXTS.manifest);
      const index = await deps.loadRunsIndex({ signal });
      const entry = deps.latestRun(index);
      const loaded = await deps.loadManifest(entry.manifestCid, { urls: deps.urls, signal });
      signal.throwIfAborted();
      // ERR-15 resurfaces above the cap: DuckDB-WASM's own httpfs then range-reads every part
      // itself, with none of fetchParts's concurrency cap or 429/CORS-tolerant retry (measured
      // 2026-10-21: Filebase answers an excess request 429 with no CORS header). The copy
      // (CloudFront) takes that volume (ADR-0001 decision 4). From the fallback a subset above
      // the cap is refused with TooLargeOnFallback (A11-9) instead of an unbounded prefetch.
      const prefetchMaxBytes = PERMITS_PREFETCH_MAX_BYTES;
      // The Permits page binds only the tables its views read, so only those parts are prefetched
      // (or, above the cap, range-read): not the ~225 parts of a full run. The module is the
      // chunk fetch already under way since the top of this load, not the engine start.
      const wantedNames = new Set((await loadingModule).permitsPartNames(loaded.manifest));
      signal.throwIfAborted();
      const wanted = partsToPrefetch(loaded.manifest, prefetchMaxBytes, wantedNames);
      if (wanted === null && loaded.read.source.kind === "fallback") {
        const bytes = loaded.manifest.artifacts
          .filter((a) => a.kind === "table" && wantedNames.has(a.name))
          .reduce((n, a) => n + a.size, 0);
        throw new TooLargeOnFallback(bytes, prefetchMaxBytes);
      }
      const parts = wanted === null ? null : await deps.fetchParts(wanted, loaded.read, { signal });
      signal.throwIfAborted();
      const { module: engineModule, engine } = await starting;
      signal.throwIfAborted();
      report(STAGE_TEXTS.bind);
      let partUrl = loaded.read.partUrl;
      if (parts !== null) {
        for (const part of parts) await engine.registerFile(registeredPartName(part), part.bytes);
        partUrl = registeredPartName;
      }
      await engineModule.bindRun(engine, loaded.read.bytes, partUrl);
      signal.throwIfAborted();
      report(STAGE_TEXTS.query);
      const emitted = permitsEmitted(loaded.manifest);
      const facts = {
        runId: loaded.manifest.runId,
        manifestCid: loaded.manifestCid,
        permitsEmitted: emitted,
        fallbackLabel: deps.fallbackLabel(loaded.read.source),
      };
      if (onFirstPage !== undefined && engineModule.listFirstPage !== undefined) {
        const first = await engineModule.listFirstPage(engine, PERMITS_PAGE_SIZE);
        signal.throwIfAborted();
        onFirstPage({ ...facts, rows: first, partial: true });
      }
      // The page's own COUNT (TC-NF-02 times it): it must equal the manifest's count (FR-009).
      const counted = await engineModule.countPermits(engine);
      if (counted !== emitted) throw new Error(PERMITS_TEXTS.countMismatch(counted, emitted));
      signal.throwIfAborted();
      const rows = await engineModule.listPermits(engine);
      return { ...facts, rows };
    } finally {
      // A-03 lists once; the worker is released so the page holds no idle engine (also when the
      // load failed before the engine was needed: it is closed once it has started).
      starting.then(
        ({ engine }) => engine.close().catch(() => undefined),
        () => undefined,
      );
    }
  };
}
