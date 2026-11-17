import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { type BuildResult, buildLeadTables } from "../application/build-lead-tables.js";
import type { BuildInputs } from "../application/lead-build-ports.js";
import { SOURCE_CATALOG } from "../domain/source-catalog.js";
import { SourceId } from "../domain/source-id.js";
import { DuckDbLeadWarehouse } from "../infrastructure/duckdb-lead-warehouse.js";
import { TABLES_DIR } from "../infrastructure/file-artifact-paths.js";
import { RAW_DIR, RAW_PAGE_GLOB } from "../infrastructure/file-raw-store.js";
import { BBB_ARCHIVE_FILE } from "../infrastructure/ndjson-bbb-archive-store.js";
import { latestRunDir } from "../infrastructure/run-directories.js";
import { readRunHistory } from "../infrastructure/run-history-files.js";
import {
  BUILD_DIR,
  BUILD_RESULT_FILE,
  BUILD_STAGING_DIR,
  RUN_HISTORY_FILE,
  SOURCES_FILE,
} from "./settings.js";

export async function runBuild(
  dataDir: string,
  buildId: string,
  asOf: string,
): Promise<BuildResult> {
  const appraisalTablesDir = await latestRunDir(
    join(dataDir, TABLES_DIR, SourceId.TcadAppraisalExport),
  );
  const parcelRun = await latestRunDir(join(dataDir, RAW_DIR, SourceId.TcadParcels));
  const snapshotPages = async (source: SourceId) => {
    const run = await latestRunDir(join(dataDir, RAW_DIR, source));
    return run && join(run, RAW_PAGE_GLOB);
  };
  const bbbArchiveDir = join(dataDir, RAW_DIR, SourceId.BbbArchive);
  const hasBbbArchive = (await latestRunDir(bbbArchiveDir)) !== undefined;
  if (appraisalTablesDir === undefined || parcelRun === undefined) {
    throw new Error("build needs an ingested TCAD appraisal export and a TCAD parcel snapshot");
  }

  const buildsDir = join(dataDir, BUILD_DIR);
  const outputDir = join(buildsDir, buildId);
  const stagingDir = join(dataDir, BUILD_STAGING_DIR, buildId);
  await rm(stagingDir, { recursive: true, force: true });
  const inputs: BuildInputs = {
    permitPages: join(dataDir, RAW_DIR, SourceId.AustinPermits, "*", RAW_PAGE_GLOB),
    appraisalTablesDir,
    parcelPages: join(parcelRun, RAW_PAGE_GLOB),
    addressPointPages: await snapshotPages(SourceId.TravisAddressPoints),
    bbbProfiles: hasBbbArchive ? join(bbbArchiveDir, "*", BBB_ARCHIVE_FILE) : undefined,
    salesTaxPages: await snapshotPages(SourceId.TxSalesTaxPermits),
    franchisePages: await snapshotPages(SourceId.TxFranchiseTaxpayers),
    licensePages: await snapshotPages(SourceId.TdlrLicenses),
    hailPages: await snapshotPages(SourceId.NoaaStormEvents),
  };

  const warehouse = await DuckDbLeadWarehouse.open();
  try {
    const result = await buildLeadTables(warehouse, {
      buildId,
      asOf,
      inputs,
      outputDir: stagingDir,
      previousDir: await latestRunDir(buildsDir, buildId),
    });
    const portable: BuildResult = {
      ...result,
      inputs: relativeInputs(dataDir, inputs),
    };
    await writeJson(join(stagingDir, BUILD_RESULT_FILE), portable);
    await writeJson(join(stagingDir, RUN_HISTORY_FILE), await readRunHistory(dataDir));
    await writeJson(join(stagingDir, SOURCES_FILE), SOURCE_CATALOG);
    await mkdir(buildsDir, { recursive: true });
    await rm(outputDir, { recursive: true, force: true });
    await rename(stagingDir, outputDir);
    return portable;
  } finally {
    warehouse.close();
  }
}

function relativeInputs(dataDir: string, inputs: BuildInputs): BuildInputs {
  return Object.fromEntries(
    Object.entries(inputs).flatMap(([name, path]) =>
      path === undefined ? [] : [[name, relative(dataDir, path)]],
    ),
  ) as unknown as BuildInputs;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}
