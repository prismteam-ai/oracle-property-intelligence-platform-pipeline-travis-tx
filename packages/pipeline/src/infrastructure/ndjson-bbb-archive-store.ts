import { appendFile, mkdir, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  ArchivedProfileRecord,
  ArchivedSnapshots,
  BbbArchiveStore,
} from "../application/bbb-ports.js";
import { SourceId } from "../domain/source-id.js";
import { RAW_DIR } from "./file-raw-store.js";

export const BBB_ARCHIVE_FILE = "profiles.ndjson";
const MISSING_DIRECTORY = "ENOENT";
const SNAPSHOT_SEPARATOR = "@";

export class NdjsonBbbArchiveStore implements BbbArchiveStore {
  constructor(private readonly dataDir: string) {}

  async append(runId: string, record: ArchivedProfileRecord): Promise<void> {
    const runDir = join(this.dataDir, RAW_DIR, SourceId.BbbArchive, runId);
    await mkdir(runDir, { recursive: true });
    await appendFile(join(runDir, BBB_ARCHIVE_FILE), `${JSON.stringify(record)}\n`);
  }
}

export async function loadArchivedSnapshots(dataDir: string): Promise<ArchivedSnapshots> {
  const archiveDir = join(dataDir, RAW_DIR, SourceId.BbbArchive);
  const fetched = new Set<string>();
  const key = (profileId: string, timestamp: string) =>
    `${profileId}${SNAPSHOT_SEPARATOR}${timestamp}`;

  let runs: string[] = [];
  try {
    runs = await readdir(archiveDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== MISSING_DIRECTORY) throw error;
  }
  for (const run of runs) {
    const lines = await readFile(join(archiveDir, run, BBB_ARCHIVE_FILE), "utf8").catch(() => "");
    for (const line of lines.split("\n").filter(Boolean)) {
      const record = JSON.parse(line) as ArchivedProfileRecord;
      if (record.receipt) fetched.add(key(record.profileId, record.capture.timestamp));
    }
  }
  return { has: (profileId, timestamp) => fetched.has(key(profileId, timestamp)) };
}
