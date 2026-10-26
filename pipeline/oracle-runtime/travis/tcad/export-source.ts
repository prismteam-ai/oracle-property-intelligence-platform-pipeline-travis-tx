// A-04: where the TCAD export of record is and what the A-01 receipt says about it
// (pipeline/docs/travis-sources.yaml `parcel.export_receipt`). Paths resolve from the repo root.
import { join } from "node:path";
import { DEFAULT_REPO_ROOT } from "../discovery/blocked-evidence.js";
import { readCatalogIfPresent } from "../discovery/write-catalog.js";

export interface ExportSource {
  exportPath: string;
  receipt: { url: string; sha256: string; captured_at: string };
}

export function exportSource(repoRoot: string = DEFAULT_REPO_ROOT): ExportSource {
  const receipt = readCatalogIfPresent()?.parcel?.export_receipt;
  if (!receipt)
    throw new Error(
      "tcad: the sources catalog has no parcel.export_receipt (run A-01 discovery first)",
    );
  return {
    exportPath: join(repoRoot, receipt.file_path),
    receipt: { url: receipt.url, sha256: receipt.sha256, captured_at: receipt.captured_at },
  };
}

export const runDirFor = (jobId: string, repoRoot: string = DEFAULT_REPO_ROOT): string =>
  join(repoRoot, "pipeline/data/runs", jobId);

export const PILOT_SEED_PATH = "pipeline/data/seeds/travis-a04-pilot.csv";
/** Austin roofing-permit tcad_ids from the permits pilot page, permit_number order (T062 writes it). */
export const ANCHOR_CANDIDATES_PATH = "pipeline/data/seeds/travis-a04-anchor-candidates.txt";
