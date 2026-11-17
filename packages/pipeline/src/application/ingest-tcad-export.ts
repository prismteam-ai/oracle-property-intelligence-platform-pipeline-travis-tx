import type { FetchReceipt } from "../domain/fetch-receipt.js";
import { SourceId } from "../domain/source-id.js";
import { exportFileName, exportKey, type TcadExportFile } from "../domain/tcad-export-catalog.js";
import { TCAD_EXPORT_LAYOUT_VERSION, TCAD_EXPORT_TABLES } from "../domain/tcad-export-layout.js";
import { laterWatermark } from "../domain/watermark.js";
import { IngestStatus } from "./ingest-status.js";
import type {
  ArtifactPaths,
  ExportCatalog,
  FileDownloader,
  TableTransformer,
  WatermarkStore,
} from "./ports.js";

export interface TcadExportDependencies {
  catalog: ExportCatalog;
  downloader: FileDownloader;
  transformer: TableTransformer;
  watermarks: WatermarkStore;
  paths: ArtifactPaths;
}

export interface TableRows {
  table: string;
  rows: number;
}

export interface TcadExportResult {
  status: IngestStatus;
  source: SourceId;
  runId: string;
  export: TcadExportFile;
  layout: string;
  receipt?: FetchReceipt;
  previousWatermark: string | undefined;
  watermark: string;
  tables: TableRows[];
}

export async function ingestTcadExport(
  { catalog, downloader, transformer, watermarks, paths }: TcadExportDependencies,
  { runId }: { runId: string },
): Promise<TcadExportResult> {
  const source = SourceId.TcadAppraisalExport;
  const latest = await catalog.latestExport();
  if (latest === undefined) {
    throw new Error("TCAD's public information page links no appraisal export");
  }

  const previousWatermark = await watermarks.read(source);
  const key = exportKey(latest);
  const run = { source, runId, export: latest, layout: TCAD_EXPORT_LAYOUT_VERSION };
  if (
    previousWatermark !== undefined &&
    laterWatermark(previousWatermark, key) === previousWatermark
  ) {
    return {
      ...run,
      status: IngestStatus.Unchanged,
      previousWatermark,
      watermark: previousWatermark,
      tables: [],
    };
  }

  const archive = paths.rawFile(runId, source, exportFileName(latest));
  const receipt = await downloader.download(latest.url, archive);
  const tables: TableRows[] = [];
  for (const table of TCAD_EXPORT_TABLES) {
    const output = paths.table(runId, source, table.name);
    tables.push({ table: table.name, rows: await transformer.transform(archive, table, output) });
  }
  await watermarks.write(source, key);

  return {
    ...run,
    status: IngestStatus.Ingested,
    receipt,
    previousWatermark,
    watermark: key,
    tables,
  };
}
