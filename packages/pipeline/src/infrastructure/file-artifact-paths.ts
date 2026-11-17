import { join } from "node:path";
import type { ArtifactPaths } from "../application/ports.js";
import type { SourceId } from "../domain/source-id.js";
import { RAW_DIR } from "./file-raw-store.js";

export const TABLES_DIR = "tables";
const PARQUET_EXTENSION = ".parquet";

export class FileArtifactPaths implements ArtifactPaths {
  constructor(private readonly dataDir: string) {}

  rawFile(runId: string, source: SourceId, fileName: string): string {
    return join(this.dataDir, RAW_DIR, source, runId, fileName);
  }

  table(runId: string, source: SourceId, table: string): string {
    return join(this.dataDir, TABLES_DIR, source, runId, `${table}${PARQUET_EXTENSION}`);
  }
}
