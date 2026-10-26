// A-04 T020: one streaming pass over the TCAD 2026 certified JSON export (agent-design § 1).
// The ZIP entry is one pretty-printed top-level array (one-space indent): each account is the
// text between a line " {" and the next " }," or " }" (the same splitter as A-03's
// pilot/capture-tcad-subset.ts). Each record is yielded as its exact text, its 0-based
// ordinal and the SHA-256 of that text (`record_sha256`, provenance against the file on
// disk). The 3.5 GB entry is never held in memory; nothing here parses owner fields.
import { createHash } from "node:crypto";
import { createInterface } from "node:readline";
import { RunDataError } from "../backbone/errors.js";
import { listZipEntries, openZipEntry, type ZipEntry } from "../lib/zip-entry.js";

/** The JSON entry of the 2026 certified export (A-03 capture-tcad-subset.ts). */
export const TCAD_ENTRY_NAME = "Travis-protaxExport-20260719.json";

export interface ExportRecordText {
  /** 0-based position of the record in the export array. */
  ordinal: number;
  /** The exact text of the array element (trailing comma removed). */
  text: string;
  /** SHA-256 of `text` as UTF-8 (record_sha256). */
  sha256: string;
  bytes: number;
}

/** The export's JSON entry: the named one, else the largest `.json` entry. */
export function exportEntry(zipPath: string, entryName: string = TCAD_ENTRY_NAME): ZipEntry {
  const entries = listZipEntries(zipPath);
  const named = entries.find((e) => e.name === entryName);
  if (named) return named;
  const json = entries
    .filter((e) => /\.json$/i.test(e.name))
    .sort((a, b) => b.uncompressedSize - a.uncompressedSize)[0];
  if (!json) throw new Error("tcad export: the ZIP has no .json entry");
  return json;
}

export const sha256Text = (text: string): string =>
  createHash("sha256").update(text, "utf8").digest("hex");

/** Yields every account record of the export in order, as exact text. */
export async function* streamExportRecords(
  zipPath: string,
  options: { entryName?: string } = {},
): AsyncGenerator<ExportRecordText> {
  const entry = exportEntry(zipPath, options.entryName);
  const stream = openZipEntry(zipPath, entry);
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  let lines: string[] | null = null;
  let ordinal = 0;
  try {
    for await (const line of rl) {
      if (lines === null) {
        if (line === " {") lines = [line];
        continue;
      }
      lines.push(line);
      if (line === " }," || line === " }") {
        const text = lines.join("\n").replace(/,$/, "");
        lines = null;
        yield { ordinal, text, sha256: sha256Text(text), bytes: Buffer.byteLength(text) };
        ordinal += 1;
      }
    }
    if (lines !== null) throw new RunDataError(`tcad export: record ${ordinal} is not closed`);
  } finally {
    rl.close();
    stream.destroy();
  }
}
