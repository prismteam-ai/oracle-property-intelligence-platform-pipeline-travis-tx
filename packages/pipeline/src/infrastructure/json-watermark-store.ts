import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { WatermarkStore } from "../application/ports.js";
import type { SourceId } from "../domain/source-id.js";

const MISSING_FILE = "ENOENT";
const JSON_EXTENSION = ".json";

interface SourceState {
  watermark: string;
}

export class JsonWatermarkStore implements WatermarkStore {
  constructor(private readonly stateDir: string) {}

  async read(source: SourceId): Promise<string | undefined> {
    try {
      const state = JSON.parse(await readFile(this.pathOf(source), "utf8")) as SourceState;
      return state.watermark;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === MISSING_FILE) return undefined;
      throw error;
    }
  }

  async write(source: SourceId, watermark: string): Promise<void> {
    await mkdir(this.stateDir, { recursive: true });
    const state: SourceState = { watermark };
    await writeFile(this.pathOf(source), `${JSON.stringify(state, null, 2)}\n`);
  }

  private pathOf(source: SourceId): string {
    return join(this.stateDir, `${source}${JSON_EXTENSION}`);
  }
}
