// T046: find the pilot parcels in the TCAD 2026 certified JSON export without loading it
// (oracle § A.4, research R-04/R-05). The entry is one pretty-printed top-level array
// (one-space indent): each property is the text between a line " {" and the next " }," or
// " }". The ZIP entry is streamed with travis/lib/zip-entry.ts; only records whose raw text
// carries `"geoID": "<wanted id>"` are JSON-parsed, and the match is then re-checked on
// propertyIdentification[].geoID exactly as a string (no digit normalization).
// Resolution: exactly one residential (propType R) pID → matched; zero → no_tcad_geoid;
// more than one → ambiguous_geoid. Unmatched ids are kept and counted, never guessed.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { createInterface } from "node:readline";
import { z } from "zod";
import { listZipEntries, openZipEntry } from "../lib/zip-entry.js";

export const TCAD_SOURCE = "tcad-2026-certified-json";
export const TCAD_ENTRY_NAME = "Travis-protaxExport-20260719.json";

export type GeoIdStatus = "matched" | "no_tcad_geoid" | "ambiguous_geoid";

export interface Resolution {
  tcad_id: string | null;
  status: GeoIdStatus;
  pIDs: string[];
}

export interface Hit {
  /** pID exactly as printed (the JSON number's text). */
  pID: string;
  geoIDs: string[];
  propType: string;
}

export interface SubsetRecord {
  pID: string;
  geoID: string;
  /** 0-based position of the record in the export array. */
  ordinal: number;
  bytes: number;
  sha256: string;
  /** The exact text of the array element (trailing comma removed). */
  text: string;
}

export interface TcadSubsetReceipt {
  source: typeof TCAD_SOURCE;
  zip_file: string;
  zip_sha256: string;
  zip_sha256_source: "catalog";
  entry_name: string;
  entry_uncompressed_bytes: number;
  captured_at: string;
  scan: {
    records_scanned: number;
    records_parsed: number;
    bytes_scanned: number;
    started_at: string;
    finished_at: string;
  };
  counts: { wanted: number; matched: number; no_tcad_geoid: number; ambiguous_geoid: number };
  resolution: Resolution[];
  records: Array<Pick<SubsetRecord, "pID" | "geoID" | "ordinal" | "bytes" | "sha256">>;
}

export interface TcadSubsetResult {
  hits: Hit[];
  resolution: Resolution[];
  records: SubsetRecord[];
  receipt: TcadSubsetReceipt;
}

export interface ScanOptions {
  zipPath: string;
  /** The permits' tcad_id values, nulls included (they resolve to no_tcad_geoid). */
  wanted: Iterable<string | null>;
  /** The archive's SHA-256 as recorded in the sources catalog (A-01). */
  zipSha256: string;
  entryName?: string;
  now?: () => Date;
}

const HitRecord = z
  .object({
    pID: z.union([z.number().int(), z.string().min(1)]),
    propType: z.string(),
    propertyIdentification: z.array(z.object({ geoID: z.string().nullable() }).loose()),
  })
  .loose();

const GEO_ID_LINE = /^\s*"geoID": "([^"\\]*)"/;

function unique<T>(values: Iterable<T>): T[] {
  return [...new Set(values)];
}

/** tcad_id → pID, compared as strings; R (real property) accounts only. */
export function resolveTcadIds(
  wanted: Iterable<string | null>,
  hits: readonly Hit[],
): Resolution[] {
  return unique(wanted).map((id) => {
    if (id === null) return { tcad_id: null, status: "no_tcad_geoid", pIDs: [] };
    const pIDs = unique(
      hits.filter((h) => h.propType === "R" && h.geoIDs.includes(id)).map((h) => h.pID),
    ).sort();
    const status: GeoIdStatus =
      pIDs.length === 1 ? "matched" : pIDs.length === 0 ? "no_tcad_geoid" : "ambiguous_geoid";
    return { tcad_id: id, status, pIDs };
  });
}

export async function scanTcadSubset(options: ScanOptions): Promise<TcadSubsetResult> {
  const now = options.now ?? (() => new Date());
  const entryName = options.entryName ?? TCAD_ENTRY_NAME;
  const entry = listZipEntries(options.zipPath).find((e) => e.name === entryName);
  if (!entry) throw new Error(`TCAD ZIP has no entry ${entryName}`);
  const wantedList = [...options.wanted];
  const wanted = new Set(wantedList.filter((id): id is string => id !== null));
  const startedAt = now().toISOString();

  const hits: Hit[] = [];
  const texts = new Map<string, { text: string; ordinal: number }[]>();
  let scanned = 0;
  let parsed = 0;
  let bytes = 0;
  let lines: string[] | null = null;
  let hit = false;

  const stream = openZipEntry(options.zipPath, entry);
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) {
    bytes += Buffer.byteLength(line) + 1;
    if (lines === null) {
      if (line === " {") {
        lines = [line];
        hit = false;
      }
      continue;
    }
    lines.push(line);
    if (!hit) {
      const m = GEO_ID_LINE.exec(line);
      if (m && wanted.has(m[1] as string)) hit = true;
    }
    if (line === " }," || line === " }") {
      const ordinal = scanned;
      scanned += 1;
      if (hit) {
        parsed += 1;
        const text = lines.join("\n").replace(/,$/, "");
        const record = HitRecord.parse(JSON.parse(text));
        const pID = String(record.pID);
        const geoIDs = record.propertyIdentification
          .map((p) => p.geoID)
          .filter((g): g is string => g !== null);
        hits.push({ pID, geoIDs, propType: record.propType });
        const list = texts.get(pID) ?? [];
        list.push({ text, ordinal });
        texts.set(pID, list);
      }
      lines = null;
    }
  }

  const resolution = resolveTcadIds(wantedList, hits);
  const records: SubsetRecord[] = [];
  for (const r of resolution) {
    if (r.status !== "matched" || r.tcad_id === null) continue;
    const pID = r.pIDs[0] as string;
    if (records.some((x) => x.pID === pID)) continue;
    const found = texts.get(pID);
    if (!found || found.length !== 1)
      throw new Error(`TCAD pID ${pID} appears ${found?.length ?? 0} times in the export`);
    const { text, ordinal } = found[0] as { text: string; ordinal: number };
    const buf = Buffer.from(text, "utf8");
    records.push({
      pID,
      geoID: r.tcad_id,
      ordinal,
      bytes: buf.length,
      sha256: createHash("sha256").update(buf).digest("hex"),
      text,
    });
  }
  records.sort((a, b) => a.ordinal - b.ordinal);

  const count = (s: GeoIdStatus) => resolution.filter((r) => r.status === s).length;
  const finishedAt = now().toISOString();
  const receipt: TcadSubsetReceipt = {
    source: TCAD_SOURCE,
    zip_file: basename(options.zipPath),
    zip_sha256: options.zipSha256,
    zip_sha256_source: "catalog",
    entry_name: entryName,
    entry_uncompressed_bytes: entry.uncompressedSize,
    captured_at: finishedAt,
    scan: {
      records_scanned: scanned,
      records_parsed: parsed,
      bytes_scanned: bytes,
      started_at: startedAt,
      finished_at: finishedAt,
    },
    counts: {
      wanted: resolution.length,
      matched: count("matched"),
      no_tcad_geoid: count("no_tcad_geoid"),
      ambiguous_geoid: count("ambiguous_geoid"),
    },
    resolution,
    records: records.map(({ pID, geoID, ordinal, bytes: b, sha256 }) => ({
      pID,
      geoID,
      ordinal,
      bytes: b,
      sha256,
    })),
  };
  return { hits, resolution, records, receipt };
}

/** Writes `subset.jsonl` (one exact record text per line, re-serialized compactly) and `receipt.json`. */
export async function writeSubset(outDir: string, result: TcadSubsetResult): Promise<void> {
  mkdirSync(outDir, { recursive: true });
  const lines = result.records.map((r) =>
    JSON.stringify({
      pID: r.pID,
      geoID: r.geoID,
      ordinal: r.ordinal,
      sha256: r.sha256,
      text: r.text,
    }),
  );
  writeFileSync(join(outDir, "subset.jsonl"), lines.length > 0 ? `${lines.join("\n")}\n` : "");
  writeFileSync(join(outDir, "receipt.json"), `${JSON.stringify(result.receipt, null, 2)}\n`);
}

const SubsetLine = z.object({
  pID: z.string(),
  geoID: z.string(),
  ordinal: z.number().int(),
  sha256: z.string(),
  text: z.string(),
});

export interface LoadedSubsetRecord {
  pID: string;
  geoID: string;
  ordinal: number;
  sha256: string;
  record: Record<string, unknown>;
}

/** Reads `subset.jsonl` back, verifying each record's sha256. */
export function readSubset(dir: string): LoadedSubsetRecord[] {
  const text = readFileSync(join(dir, "subset.jsonl"), "utf8");
  return text
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => {
      const row = SubsetLine.parse(JSON.parse(l));
      const digest = createHash("sha256").update(row.text, "utf8").digest("hex");
      if (digest !== row.sha256)
        throw new Error(`subset record ${row.pID} does not match its sha256`);
      return {
        pID: row.pID,
        geoID: row.geoID,
        ordinal: row.ordinal,
        sha256: row.sha256,
        record: JSON.parse(row.text) as Record<string, unknown>,
      };
    });
}
