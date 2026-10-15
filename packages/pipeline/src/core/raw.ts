import { createReadStream, createWriteStream } from "node:fs";
import { readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";
import { sqlString } from "./db.js";
import type { RunContext } from "./run.js";

const COMPRESSIBLE = /\.(csv|json|geojson)$/i;
const MIN_BYTES = 1024 * 1024;

export async function compressRaw(ctx: RunContext, sourceId: string): Promise<number> {
  const dir = ctx.rawDir(sourceId);
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  let saved = 0;
  for (const e of entries) {
    if (!e.isFile() || !COMPRESSIBLE.test(e.name)) continue;
    const file = path.join(dir, e.name);
    const before = (await stat(file)).size;
    if (before < MIN_BYTES) continue;
    await pipeline(
      createReadStream(file),
      createGzip({ level: 6 }),
      createWriteStream(`${file}.gz`),
    );
    await rm(file);
    saved += before - (await stat(`${file}.gz`)).size;
    const rel = path.relative(ctx.config.dataDir, file);
    await ctx.db.exec(
      `UPDATE raw_artifacts SET local_path = ${sqlString(`${rel}.gz`)} WHERE run_id = ${sqlString(ctx.runId)} AND local_path = ${sqlString(rel)}`,
    );
  }
  return saved;
}
