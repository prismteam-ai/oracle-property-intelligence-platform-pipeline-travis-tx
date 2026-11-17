import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { gzip } from "node:zlib";
import type { RawPage, RawStore } from "../application/ports.js";

export const RAW_DIR = "raw";
export const RAW_PAGE_GLOB = "page-*.json.gz";
const RECEIPTS_FILE = "receipts.ndjson";
const PAGE_NUMBER_WIDTH = 5;
const GZIPPED_JSON_EXTENSION = ".json.gz";

const gzipAsync = promisify(gzip);

export class FileRawStore implements RawStore {
  constructor(private readonly dataDir: string) {}

  async savePage({ runId, source, pageNumber, body, receipt }: RawPage): Promise<void> {
    const runDir = join(this.dataDir, RAW_DIR, source, runId);
    await mkdir(runDir, { recursive: true });

    const file = `page-${String(pageNumber).padStart(PAGE_NUMBER_WIDTH, "0")}${GZIPPED_JSON_EXTENSION}`;
    await writeFile(join(runDir, file), await gzipAsync(body));
    await appendFile(
      join(runDir, RECEIPTS_FILE),
      `${JSON.stringify({ pageNumber, file, ...receipt })}\n`,
    );
  }
}
