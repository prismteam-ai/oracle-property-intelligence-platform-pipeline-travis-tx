import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type {
  DatasetFile,
  ManifestWriter,
  PublicationHistoryStore,
} from "../application/publication-ports.js";
import type { Manifest } from "../domain/artifact-manifest.js";
import type { Publication } from "../domain/publication-history.js";

const MISSING_FILE = "ENOENT";
export const MANIFEST_FILE = "manifest.json";

export class JsonPublicationHistory implements PublicationHistoryStore {
  constructor(private readonly path: string) {}

  async read(): Promise<Publication[]> {
    try {
      return JSON.parse(await readFile(this.path, "utf8")) as Publication[];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === MISSING_FILE) return [];
      throw error;
    }
  }

  async write(history: readonly Publication[]): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(this.path, `${JSON.stringify(history, null, 2)}\n`);
  }
}

export class JsonManifestWriter implements ManifestWriter {
  async write(manifest: Manifest, workDir: string): Promise<DatasetFile> {
    await mkdir(workDir, { recursive: true });
    const path = join(workDir, MANIFEST_FILE);
    await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`);
    return { name: MANIFEST_FILE, path };
  }
}
