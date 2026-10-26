// A-04 T020 (CR2-10): the TCAD export is verified against the A-01 receipt without
// re-hashing 3.5 GB on every run. `<zip>.summary.json` keeps {sha256, size, mtime, inode} of the
// last hash; the file is re-hashed (one streaming read) only when one of those changed.
// A missing export or a SHA-256 other than the receipt's stops the run (A-04-TC-016).
import { createHash } from "node:crypto";
import { createReadStream, existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { z } from "zod";

async function fileSha256(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

/** Why an export cannot be used (A-04-TC-016): the run stops in WAITING_HUMAN. */
export type ExportVerifyCode = "export_missing" | "export_sha256_mismatch";

export class ExportVerifyError extends Error {
  constructor(
    readonly code: ExportVerifyCode,
    message: string,
  ) {
    super(message);
    this.name = "ExportVerifyError";
  }
}

/** `{sha256, size, mtime, inode}` of the export as last hashed (`<zip>.summary.json`). */
const ExportSummary = z.object({
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  size: z.number().int().nonnegative(),
  mtime_ms: z.number(),
  inode: z.number().int(),
});
export type ExportSummary = z.infer<typeof ExportSummary>;

export const exportSummaryPath = (path: string): string => `${path}.summary.json`;

function readSummary(path: string): ExportSummary | null {
  try {
    return ExportSummary.parse(JSON.parse(readFileSync(exportSummaryPath(path), "utf8")));
  } catch {
    return null;
  }
}

/**
 * The export's SHA-256: taken from `<zip>.summary.json` when the file's {size, mtime, inode}
 * are unchanged, else re-hashed (one streaming read) and the summary rewritten.
 */
export async function exportSha256(
  path: string,
  options: { hashFile?: (p: string) => Promise<string> } = {},
): Promise<{ sha256: string; rehashed: boolean }> {
  const st = statSync(path);
  const now = { size: st.size, mtime_ms: st.mtimeMs, inode: st.ino };
  const prior = readSummary(path);
  if (
    prior !== null &&
    prior.size === now.size &&
    prior.mtime_ms === now.mtime_ms &&
    prior.inode === now.inode
  ) {
    return { sha256: prior.sha256, rehashed: false };
  }
  const sha256 = await (options.hashFile ?? fileSha256)(path);
  writeFileSync(exportSummaryPath(path), `${JSON.stringify({ sha256, ...now }, null, 2)}\n`);
  return { sha256, rehashed: true };
}

/** Throws ExportVerifyError unless the export exists and its SHA-256 is `expected`. */
export async function verifyExport(
  path: string,
  expected: string,
  options: { hashFile?: (p: string) => Promise<string> } = {},
): Promise<{ sha256: string; rehashed: boolean }> {
  if (!existsSync(path)) {
    throw new ExportVerifyError("export_missing", `tcad export not on disk: ${basename(path)}`);
  }
  const result = await exportSha256(path, options);
  if (result.sha256 !== expected) {
    throw new ExportVerifyError(
      "export_sha256_mismatch",
      `tcad export ${basename(path)}: sha256 ${result.sha256} is not the A-01 receipt ${expected}`,
    );
  }
  return result;
}
