import type { SourceId } from "../domain/source-id.js";
import { laterWatermark } from "../domain/watermark.js";
import { IngestStatus } from "./ingest-status.js";
import type { FetchedPage, RawStore, SnapshotLayer, WatermarkStore } from "./ports.js";

export interface SnapshotDependencies {
  layer: SnapshotLayer;
  rawStore: RawStore;
  watermarks: WatermarkStore;
}

export interface SnapshotResult {
  status: IngestStatus;
  source: SourceId;
  runId: string;
  version: string;
  previousWatermark: string | undefined;
  watermark: string;
  pages: number;
  records: number;
}

export async function ingestSnapshot(
  { layer, rawStore, watermarks }: SnapshotDependencies,
  { runId }: { runId: string },
): Promise<SnapshotResult> {
  const version = await layer.version();
  const previousWatermark = await watermarks.read(layer.id);
  const run = { source: layer.id, runId, version, previousWatermark };

  if (
    previousWatermark !== undefined &&
    laterWatermark(previousWatermark, version) === previousWatermark
  ) {
    return {
      ...run,
      status: IngestStatus.Unchanged,
      watermark: previousWatermark,
      pages: 0,
      records: 0,
    };
  }

  let pages = 0;
  let records = 0;
  let afterKey: string | undefined;
  let previousKey: string | undefined;
  let fetched: FetchedPage;
  do {
    previousKey = afterKey;
    fetched = await layer.fetchPage(afterKey);
    pages += 1;
    records += fetched.recordCount;
    await rawStore.savePage({
      runId,
      source: layer.id,
      pageNumber: pages,
      body: fetched.body,
      receipt: fetched.receipt,
    });
    afterKey = fetched.lastKey;
  } while (!fetched.isLastPage && afterKey !== undefined && afterKey !== previousKey);

  await watermarks.write(layer.id, version);
  return { ...run, status: IngestStatus.Ingested, watermark: version, pages, records };
}
