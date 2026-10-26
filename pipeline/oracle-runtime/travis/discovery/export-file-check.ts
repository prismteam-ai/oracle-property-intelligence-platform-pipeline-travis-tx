// The receipt check shared by the offline export commands (rescan-tcad, reconcile-parcel-gap).
//
// Before any scan, the downloaded TCAD export must match its catalog receipt byte-for-byte
// (size, then SHA-256). Any mismatch is a refusal: nothing is written and a fresh discovery
// run is asked for. No network request is made.
import { createHash } from "node:crypto";
import { createReadStream, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Catalog, ExportReceipt } from "./catalog.schema.js";

export const FRESH_RUN = "a fresh discovery run (npm run discover) is needed";

/** A refusal: the command writes nothing and exits 2. */
export class Refusal extends Error {}

export async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

export interface VerifiedExport {
  parcel: NonNullable<Catalog["parcel"]>;
  receipt: ExportReceipt;
  /** Absolute path of the verified file. */
  file: string;
}

/** Checks the catalog names a downloaded export and that the file matches its receipt. */
export async function verifyExportFile(
  catalog: Catalog,
  repoRoot: string,
  say: (line: string) => void,
  command: string,
): Promise<VerifiedExport> {
  const parcel = catalog.parcel;
  if (!parcel) throw new Refusal(`catalog has no parcel block; ${FRESH_RUN}`);
  const receipt = parcel.export_receipt;
  if (!receipt) {
    throw new Refusal(`parcel has no export_receipt (nothing downloaded to rescan); ${FRESH_RUN}`);
  }
  const file = join(repoRoot, receipt.file_path);
  if (!existsSync(file)) {
    throw new Refusal(`export ${receipt.file_path} not found; ${FRESH_RUN}`);
  }
  const size = statSync(file).size;
  if (size !== receipt.bytes) {
    throw new Refusal(
      `export ${receipt.file_path} is ${size} bytes but the receipt says ${receipt.bytes}; ${FRESH_RUN}`,
    );
  }
  say(`${command}: hashing ${receipt.file_path} (${size} bytes)`);
  const digest = await sha256File(file);
  if (digest !== receipt.sha256) {
    throw new Refusal(
      `export SHA-256 ${digest} does not match the receipt ${receipt.sha256}; ${FRESH_RUN}`,
    );
  }
  say(`${command}: sha256 matches the export receipt (captured_at ${receipt.captured_at})`);
  return { parcel, receipt, file };
}
