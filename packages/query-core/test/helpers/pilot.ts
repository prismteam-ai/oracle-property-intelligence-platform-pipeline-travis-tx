// Shared pilot binding for the PILOT_DIR-gated tests: the real pilot export
// (pipeline/data/pilot/travis-pilot-20261020, local and unpublished) bound through bindManifest().
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { bindManifest, type BoundRun } from "../../src/bind-manifest.js";
import { openDuckDb, type DuckDbEngine } from "../../scripts/duckdb-engine.js";

export const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
export const PILOT_MANIFEST = join(ROOT, "contract/v1/pilot-manifest.json");
export const PILOT_MANIFEST_CID = "bafkreibkonskeytl2lqmaoethxvhegzjkwbeon4couanb4x26ng23cs3ka";

const env = process.env.PILOT_DIR;
/** Absolute pilot directory, or null when PILOT_DIR is unset or missing. */
export const PILOT_DIR: string | null =
  env && existsSync(resolve(ROOT, env, "tables")) ? resolve(ROOT, env) : null;

export const SKIP_MESSAGE =
  "SKIPPED: PILOT_DIR is not set (PILOT_DIR=pipeline/data/pilot/travis-pilot-20261020 pnpm vitest run)";

export interface Pilot {
  db: DuckDbEngine;
  bound: BoundRun;
}

/** Binds the committed pilot manifest over $PILOT_DIR/tables. */
export async function bindPilot(): Promise<Pilot> {
  if (!PILOT_DIR) throw new Error(SKIP_MESSAGE);
  const db = await openDuckDb();
  const bound = await bindManifest(readFileSync(PILOT_MANIFEST), join(PILOT_DIR, "tables"), db);
  return { db, bound };
}
