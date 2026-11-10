import { describe, expect, it } from "vitest";
import { IngestStatus } from "../../src/application/ingest-status.js";
import { ingestTcadExport } from "../../src/application/ingest-tcad-export.js";
import type {
  ArtifactPaths,
  ExportCatalog,
  FileDownloader,
  TableTransformer,
  WatermarkStore,
} from "../../src/application/ports.js";
import type { FetchReceipt } from "../../src/domain/fetch-receipt.js";
import type { FixedWidthTable } from "../../src/domain/fixed-width.js";
import { SourceId } from "../../src/domain/source-id.js";
import type { TcadExportFile } from "../../src/domain/tcad-export-catalog.js";
import { TCAD_EXPORT_TABLES } from "../../src/domain/tcad-export-layout.js";

const RUN_ID = "20261027T090000Z";
const LATEST: TcadExportFile = {
  url: "https://traviscad.org/wp-content/largefiles/travis_SUPP%20335_2026_WEBSITE%20EXPORT_Renamed.zip",
  year: 2026,
  supplement: 335,
};
const RECEIPT: FetchReceipt = {
  url: LATEST.url,
  fetchedAt: "2026-10-27T09:00:00.000Z",
  httpStatus: 200,
  bytes: 511_099_040,
  sha256: "63da76773f8a8652dffeb7432525a739205027ace4aeab1c0f2d9ac0f31388eb",
};

class FixedCatalog implements ExportCatalog {
  constructor(private readonly latest: TcadExportFile | undefined) {}
  async latestExport() {
    return this.latest;
  }
}

class RecordingDownloader implements FileDownloader {
  readonly downloads: { url: string; destination: string }[] = [];
  async download(url: string, destination: string) {
    this.downloads.push({ url, destination });
    return RECEIPT;
  }
}

class CountingTransformer implements TableTransformer {
  readonly calls: { archive: string; table: string; output: string }[] = [];
  async transform(archive: string, table: FixedWidthTable, output: string) {
    this.calls.push({ archive, table: table.name, output });
    return 10;
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

const paths: ArtifactPaths = {
  rawFile: (runId, source, fileName) => `/data/raw/${source}/${runId}/${fileName}`,
  table: (runId, source, table) => `/data/tables/${source}/${runId}/${table}.parquet`,
};

function dependencies(latest: TcadExportFile | undefined, watermarks = new MemoryWatermarks()) {
  return {
    catalog: new FixedCatalog(latest),
    downloader: new RecordingDownloader(),
    transformer: new CountingTransformer(),
    watermarks,
    paths,
  };
}

describe("ingestTcadExport", () => {
  it("downloads a new export, turns every table into Parquet and advances the watermark", async () => {
    const deps = dependencies(LATEST);

    const result = await ingestTcadExport(deps, { runId: RUN_ID });

    const archive = `/data/raw/tcad-appraisal-export/${RUN_ID}/travis_SUPP 335_2026_WEBSITE EXPORT_Renamed.zip`;
    expect(deps.downloader.downloads).toEqual([{ url: LATEST.url, destination: archive }]);
    expect(deps.transformer.calls.map((call) => call.table)).toEqual(
      TCAD_EXPORT_TABLES.map((table) => table.name),
    );
    expect(deps.transformer.calls[0]).toEqual({
      archive,
      table: TCAD_EXPORT_TABLES[0]?.name,
      output: `/data/tables/tcad-appraisal-export/${RUN_ID}/${TCAD_EXPORT_TABLES[0]?.name}.parquet`,
    });
    expect(result).toMatchObject({
      status: IngestStatus.Ingested,
      source: SourceId.TcadAppraisalExport,
      runId: RUN_ID,
      export: LATEST,
      receipt: RECEIPT,
      previousWatermark: undefined,
      watermark: "2026-supp-0335",
    });
    expect(result.tables).toHaveLength(TCAD_EXPORT_TABLES.length);
    expect(result.tables[0]).toEqual({ table: TCAD_EXPORT_TABLES[0]?.name, rows: 10 });
    expect(await deps.watermarks.read(SourceId.TcadAppraisalExport)).toBe("2026-supp-0335");
  });

  it("skips an export it has already ingested", async () => {
    const watermarks = new MemoryWatermarks(
      new Map([[SourceId.TcadAppraisalExport, "2026-supp-0335"]]),
    );
    const deps = dependencies(LATEST, watermarks);

    const result = await ingestTcadExport(deps, { runId: RUN_ID });

    expect(deps.downloader.downloads).toEqual([]);
    expect(deps.transformer.calls).toEqual([]);
    expect(result).toMatchObject({
      status: IngestStatus.Unchanged,
      watermark: "2026-supp-0335",
      tables: [],
    });
  });

  it("fails loudly when TCAD links no appraisal export", async () => {
    await expect(ingestTcadExport(dependencies(undefined), { runId: RUN_ID })).rejects.toThrow(
      /no appraisal export/i,
    );
  });
});
