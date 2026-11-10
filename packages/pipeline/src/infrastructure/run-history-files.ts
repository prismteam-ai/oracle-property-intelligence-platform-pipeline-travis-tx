import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const RUNS_DIR = "runs";
const BUILDS_DIR = "build";
const BUILD_FILE = "build.json";
const JSON_EXTENSION = ".json";
const MISSING = "ENOENT";

export interface IngestRunRecord {
  source: string;
  runId: string;
  [field: string]: unknown;
}

export interface BuildRunRecord {
  buildId: string;
  [field: string]: unknown;
}

export interface RunHistory {
  ingests: IngestRunRecord[];
  builds: BuildRunRecord[];
}

export async function readRunHistory(dataDir: string): Promise<RunHistory> {
  const ingests: IngestRunRecord[] = [];
  for (const run of await directories(join(dataDir, RUNS_DIR))) {
    const runDir = join(dataDir, RUNS_DIR, run);
    for (const file of (await readdir(runDir)).filter((name) => name.endsWith(JSON_EXTENSION))) {
      const record = await readJson<IngestRunRecord>(join(runDir, file));
      if (record) ingests.push(record);
    }
  }

  const builds: BuildRunRecord[] = [];
  for (const build of await directories(join(dataDir, BUILDS_DIR))) {
    const record = await readJson<BuildRunRecord>(join(dataDir, BUILDS_DIR, build, BUILD_FILE));
    if (record) builds.push(record);
  }

  return {
    ingests: ingests.sort(
      (a, b) => a.runId.localeCompare(b.runId) || a.source.localeCompare(b.source),
    ),
    builds: builds.sort((a, b) => a.buildId.localeCompare(b.buildId)),
  };
}

async function directories(parent: string): Promise<string[]> {
  try {
    return (await readdir(parent, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === MISSING) return [];
    throw error;
  }
}

async function readJson<T>(path: string): Promise<T | undefined> {
  try {
    const text = await readFile(path, "utf8");
    return text.trim() === "" ? undefined : (JSON.parse(text) as T);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === MISSING) return undefined;
    throw error;
  }
}
