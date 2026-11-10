import { type IngestWindow, windowAfter } from "../domain/ingest-window.js";
import type { SourceId } from "../domain/source-id.js";
import { laterWatermark } from "../domain/watermark.js";
import type { FetchedPage, PagedSource, RawStore, WatermarkStore } from "./ports.js";

export interface IngestDependencies {
  source: PagedSource;
  rawStore: RawStore;
  watermarks: WatermarkStore;
}

export interface IngestOptions {
  runId: string;
  lookbackDays: number;
  window?: IngestWindow;
}

export interface IngestResult {
  source: SourceId;
  runId: string;
  window: IngestWindow;
  pages: number;
  records: number;
  previousWatermark: string | undefined;
  watermark: string | undefined;
}

export async function ingestSource(
  { source, rawStore, watermarks }: IngestDependencies,
  { runId, lookbackDays, window: explicitWindow }: IngestOptions,
): Promise<IngestResult> {
  const previousWatermark = await watermarks.read(source.id);
  const window = explicitWindow ?? windowAfter(previousWatermark, lookbackDays);

  let watermark = previousWatermark;
  let pages = 0;
  let records = 0;
  let afterKey: string | undefined;
  let fetched: FetchedPage;

  do {
    fetched = await source.fetchPage(window, afterKey);
    pages += 1;
    records += fetched.recordCount;
    await rawStore.savePage({
      runId,
      source: source.id,
      pageNumber: pages,
      body: fetched.body,
      receipt: fetched.receipt,
    });
    watermark = laterWatermark(watermark, fetched.maxBusinessDate);
    afterKey = fetched.lastKey;
  } while (!fetched.isLastPage && fetched.recordCount > 0);

  if (watermark !== undefined && watermark !== previousWatermark) {
    await watermarks.write(source.id, watermark);
  }

  return { source: source.id, runId, window, pages, records, previousWatermark, watermark };
}
