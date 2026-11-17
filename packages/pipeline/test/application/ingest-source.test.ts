import { describe, expect, it } from "vitest";
import { ingestSource } from "../../src/application/ingest-source.js";
import type {
  FetchedPage,
  PagedSource,
  RawPage,
  RawStore,
  WatermarkStore,
} from "../../src/application/ports.js";
import { type IngestWindow, WindowKind } from "../../src/domain/ingest-window.js";
import { SourceId } from "../../src/domain/source-id.js";

const RUN_ID = "20261027T063000Z";

function page(
  records: number,
  maxBusinessDate: string | undefined,
  isLastPage: boolean,
): FetchedPage {
  return {
    body: JSON.stringify(Array.from({ length: records }, (_, index) => ({ index }))),
    recordCount: records,
    lastKey: `key-${records}`,
    maxBusinessDate,
    isLastPage,
    receipt: {
      url: "https://example.test/page",
      fetchedAt: "2026-10-27T06:30:00.000Z",
      httpStatus: 200,
      bytes: 10,
      sha256: "abc",
    },
  };
}

class ScriptedSource implements PagedSource {
  readonly id = SourceId.AustinPermits;
  readonly requests: { window: IngestWindow; afterKey: string | undefined }[] = [];

  constructor(private readonly pages: FetchedPage[]) {}

  async fetchPage(window: IngestWindow, afterKey: string | undefined): Promise<FetchedPage> {
    this.requests.push({ window, afterKey });
    const next = this.pages.shift();
    if (!next) throw new Error("source asked for more pages than scripted");
    return next;
  }
}

class MemoryRawStore implements RawStore {
  readonly pages: RawPage[] = [];

  async savePage(rawPage: RawPage): Promise<void> {
    this.pages.push(rawPage);
  }
}

class MemoryWatermarkStore implements WatermarkStore {
  constructor(private readonly watermarks: Map<SourceId, string> = new Map()) {}

  async read(source: SourceId): Promise<string | undefined> {
    return this.watermarks.get(source);
  }

  async write(source: SourceId, watermark: string): Promise<void> {
    this.watermarks.set(source, watermark);
  }
}

describe("ingestSource", () => {
  it("does a full load on the first run, keeps every page and advances the watermark", async () => {
    const source = new ScriptedSource([page(2, "2026-10-25", false), page(1, "2026-10-26", true)]);
    const rawStore = new MemoryRawStore();
    const watermarks = new MemoryWatermarkStore();

    const result = await ingestSource(
      { source, rawStore, watermarks },
      { runId: RUN_ID, lookbackDays: 7 },
    );

    expect(source.requests).toEqual([
      { window: { kind: WindowKind.Full }, afterKey: undefined },
      { window: { kind: WindowKind.Full }, afterKey: "key-2" },
    ]);
    expect(rawStore.pages.map((saved) => saved.pageNumber)).toEqual([1, 2]);
    expect(rawStore.pages[0]).toMatchObject({ runId: RUN_ID, source: SourceId.AustinPermits });
    expect(result).toEqual({
      source: SourceId.AustinPermits,
      runId: RUN_ID,
      window: { kind: WindowKind.Full },
      pages: 2,
      records: 3,
      previousWatermark: undefined,
      watermark: "2026-10-26",
    });
    expect(await watermarks.read(SourceId.AustinPermits)).toBe("2026-10-26");
  });

  it("reads only the window after the stored watermark on later runs", async () => {
    const source = new ScriptedSource([page(1, "2026-10-27", true)]);
    const watermarks = new MemoryWatermarkStore(new Map([[SourceId.AustinPermits, "2026-10-26"]]));

    const result = await ingestSource(
      { source, rawStore: new MemoryRawStore(), watermarks },
      { runId: RUN_ID, lookbackDays: 7 },
    );

    expect(source.requests[0]?.window).toEqual({ kind: WindowKind.Since, since: "2026-10-19" });
    expect(result.previousWatermark).toBe("2026-10-26");
    expect(result.watermark).toBe("2026-10-27");
  });

  it("keeps the watermark when nothing new arrived, but still records the empty request", async () => {
    const source = new ScriptedSource([page(0, undefined, true)]);
    const rawStore = new MemoryRawStore();
    const watermarks = new MemoryWatermarkStore(new Map([[SourceId.AustinPermits, "2026-10-26"]]));

    const result = await ingestSource(
      { source, rawStore, watermarks },
      { runId: RUN_ID, lookbackDays: 7 },
    );

    expect(rawStore.pages).toHaveLength(1);
    expect(result).toMatchObject({ pages: 1, records: 0, watermark: "2026-10-26" });
    expect(await watermarks.read(SourceId.AustinPermits)).toBe("2026-10-26");
  });

  it("uses an explicit window instead of the watermark when one is given", async () => {
    const source = new ScriptedSource([page(1, "2026-10-26", true)]);
    const explicitWindow: IngestWindow = { kind: WindowKind.Since, since: "2026-10-24" };

    await ingestSource(
      { source, rawStore: new MemoryRawStore(), watermarks: new MemoryWatermarkStore() },
      { runId: RUN_ID, lookbackDays: 7, window: explicitWindow },
    );

    expect(source.requests[0]?.window).toEqual(explicitWindow);
  });
});
