import { readdir } from "node:fs/promises";
import { join } from "node:path";

const MISSING_DIRECTORY = "ENOENT";

export async function latestRunDir(
  parent: string,
  excludedRunId?: string,
): Promise<string | undefined> {
  try {
    const runs = (await readdir(parent, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && entry.name !== excludedRunId)
      .map((entry) => entry.name)
      .sort();
    const latest = runs.at(-1);
    return latest === undefined ? undefined : join(parent, latest);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === MISSING_DIRECTORY) return undefined;
    throw error;
  }
}
