import type { FetchReceipt } from "../domain/fetch-receipt.js";
import type { FixedWidthTable } from "../domain/fixed-width.js";
import type { IngestWindow } from "../domain/ingest-window.js";
import type { SourceId } from "../domain/source-id.js";
import type { TcadExportFile } from "../domain/tcad-export-catalog.js";

export interface FetchedPage {
  body: string;
  recordCount: number;
  lastKey: string | undefined;
  maxBusinessDate: string | undefined;
  isLastPage: boolean;
  receipt: FetchReceipt;
}

export interface PagedSource {
  readonly id: SourceId;
  fetchPage(window: IngestWindow, afterKey: string | undefined): Promise<FetchedPage>;
}

export interface SnapshotLayer {
  readonly id: SourceId;
  version(): Promise<string>;
  fetchPage(afterKey: string | undefined): Promise<FetchedPage>;
}

export interface RawPage {
  runId: string;
  source: SourceId;
  pageNumber: number;
  body: string;
  receipt: FetchReceipt;
}

export interface RawStore {
  savePage(page: RawPage): Promise<void>;
}

export interface WatermarkStore {
  read(source: SourceId): Promise<string | undefined>;
  write(source: SourceId, watermark: string): Promise<void>;
}

export interface ExportCatalog {
  latestExport(): Promise<TcadExportFile | undefined>;
}

export interface FileDownloader {
  download(url: string, destination: string): Promise<FetchReceipt>;
}

export interface MemberExtractor {
  extract(archive: string, member: string, destination: string): Promise<void>;
}

export interface TableTransformer {
  transform(archive: string, table: FixedWidthTable, output: string): Promise<number>;
}

export interface ArtifactPaths {
  rawFile(runId: string, source: SourceId, fileName: string): string;
  table(runId: string, source: SourceId, table: string): string;
}
