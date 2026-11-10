import { describe, expect, it } from "vitest";
import { ingestSnapshot } from "../../src/application/ingest-snapshot.js";
import { IngestStatus } from "../../src/application/ingest-status.js";
import type {
  FetchedPage,
  RawPage,
  RawStore,
  SnapshotLayer,
  WatermarkStore,
} from "../../src/application/ports.js";
import { SourceId } from "../../src/domain/source-id.js";

const RUN_ID = "20261027T110000Z";
const VERSION = "2026-10-04T12:14:41.225Z";

function page(records: number, lastKey: string, isLastPage: boolean): FetchedPage {
  return {
    body: "{}",
    recordCount: records,
    lastKey,
    maxBusinessDate: undefined,
    isLastPage,
    receipt: {
      url: "https://services.arcgis.com/layer/query",
      fetchedAt: "2026-10-27T11:00:00.000Z",
      httpStatus: 200,
      bytes: 2,
      sha256: "44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a",
    },
  };
}

class ScriptedLayer implements SnapshotLayer {
  readonly id = SourceId.TcadParcels;
  readonly afterKeys: (string | undefined)[] = [];
  constructor(private readonly pages: FetchedPage[]) {}
  async version() {
    return VERSION;
  }
  async fetchPage(afterKey: string | undefined) {
    this.afterKeys.push(afterKey);
    const next = this.pages.shift();
    if (!next) throw new Error("layer asked for more pages than scripted");
    return next;
  }
}

class MemoryRawStore implements RawStore {
  readonly pages: RawPage[] = [];
  async savePage(rawPage: RawPage) {
    this.pages.push(rawPage);
  }
}

class MemoryWatermarks implements WatermarkStore {
  constructor(readonly values = new Map<SourceId, string>()) {}
  async read(source: SourceId) {
    return this.values.get(source);
  }
  async write(source: SourceId, watermark: string) {
    this.values.set(source, watermark);
  }
}

describe("ingestSnapshot", () => {
  it("reads every page of a layer version it has not seen and records that version", async () => {
    const layer = new ScriptedLayer([page(2000, "2000", false), page(10, "2010", true)]);
    const rawStore = new MemoryRawStore();
    const watermarks = new MemoryWatermarks();

    const result = await ingestSnapshot({ layer, rawStore, watermarks }, { runId: RUN_ID });

    expect(layer.afterKeys).toEqual([undefined, "2000"]);
    expect(rawStore.pages.map((saved) => saved.pageNumber)).toEqual([1, 2]);
    expect(result).toEqual({
      status: IngestStatus.Ingested,
      source: SourceId.TcadParcels,
      runId: RUN_ID,
      version: VERSION,
      previousWatermark: undefined,
      watermark: VERSION,
      pages: 2,
      records: 2010,
    });
    expect(await watermarks.read(SourceId.TcadParcels)).toBe(VERSION);
  });

  it("keeps paging past a page without records until the layer's last page", async () => {
    const layer = new ScriptedLayer([page(0, "2000", false), page(3, "2001", true)]);

    const result = await ingestSnapshot(
      { layer, rawStore: new MemoryRawStore(), watermarks: new MemoryWatermarks() },
      { runId: RUN_ID },
    );

    expect(layer.afterKeys).toEqual([undefined, "2000"]);
    expect(result).toMatchObject({ pages: 2, records: 3 });
  });

  it("stops when a page makes no progress", async () => {
    const layer = new ScriptedLayer([page(5, "2000", false), page(0, "2000", false)]);

    const result = await ingestSnapshot(
      { layer, rawStore: new MemoryRawStore(), watermarks: new MemoryWatermarks() },
      { runId: RUN_ID },
    );

    expect(layer.afterKeys).toEqual([undefined, "2000"]);
    expect(result).toMatchObject({ status: IngestStatus.Ingested, pages: 2, records: 5 });
  });

  it("skips a layer version it has already ingested", async () => {
    const layer = new ScriptedLayer([]);
    const watermarks = new MemoryWatermarks(new Map([[SourceId.TcadParcels, VERSION]]));

    const result = await ingestSnapshot(
      { layer, rawStore: new MemoryRawStore(), watermarks },
      { runId: RUN_ID },
    );

    expect(layer.afterKeys).toEqual([]);
    expect(result).toMatchObject({ status: IngestStatus.Unchanged, pages: 0, records: 0 });
  });
});
