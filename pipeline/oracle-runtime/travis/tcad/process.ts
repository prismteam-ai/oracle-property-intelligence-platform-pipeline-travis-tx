// A-04 T021/T026: one chunk of export records through the fixed step order
//   parse (strict keys) → redact → map → store → validate
// (D-7: redaction right after parse, before anything is stored or validated). Each record is
// classified for the roll reconciliation (FR-002): `dead` (text is not JSON; kept in
// dead.json), `invalid` (fails the record shape), `transform_failure` (mapping threw) or
// `loaded`. An unknown key is not a record class: it fails the run (UnknownKeyError).
// `store` is the chunk writer / Loader merge; `validate` receives the County group files
// built from the redacted records (write-group.ts), never the original record.
import { gunzipSync, gzipSync } from "node:zlib";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createHash } from "node:crypto";
import type { DataGroupCids } from "../transforms/lexicon-manifest.js";
import type { ExportRecordText } from "./export-stream.js";
import { InvalidRecordError, mapParcel, type MappedRecord, type ParcelRow } from "./fields.js";
import { parseExportRecord, UnknownKeyError, type KeyInventory } from "./key-inventory.js";
import { redactRecord } from "./redact.js";
import { planCountyGroup, type CountyGroup } from "./write-group.js";
import type { PropType } from "./account-class.js";

export type RollClass = "loaded" | "dead" | "invalid" | "transform_failure";
export const ROLL_CLASSES: readonly RollClass[] = [
  "loaded",
  "dead",
  "invalid",
  "transform_failure",
];

export interface ChunkContext {
  jobId: string;
  asOf: string;
  exportSha256: string;
  capturedAt: string;
}

export interface ReconRow {
  job_id: string;
  record_ordinal: number;
  request_identifier: string | null;
  geo_id: string | null;
  class: RollClass;
  detail: string | null;
}

export interface DeadRecord {
  ordinal: number;
  sha256: string;
  bytes: number;
  detail: string;
}

export interface LoadedRecord extends MappedRecord {
  /** The redacted record (for the County group); never the original. */
  record: Record<string, unknown>;
}

export interface ChunkSummary {
  records: number;
  loaded: number;
  dead: number;
  invalid: number;
  transform_failure: number;
  redacted: number;
  by_prop_type: Partial<Record<PropType, number>>;
}

export interface ChunkResult {
  loaded: LoadedRecord[];
  reconciliation: ReconRow[];
  dead: DeadRecord[];
  summary: ChunkSummary;
  typeStats: TypeStats;
}

export type Step = "parse" | "redact" | "map" | "store" | "validate";

export interface ChunkHooks {
  trace?: (step: Step) => void;
  store?: (rows: readonly LoadedRecord[], reconciliation: readonly ReconRow[]) => Promise<void>;
  /** Called with the County group of the chunk's R accounts (needs `cids`). */
  validate?: (groups: readonly CountyGroup[]) => Promise<void>;
  cids?: DataGroupCids;
}

/**
 * A failure's detail for roll_reconciliation, dead.json and the journal: the error class, where
 * it happened and the record length, never a snippet of the record (OR-m1). Parser messages
 * quote the offending JSON, so only the class and numeric position are taken from them.
 */
export function safeDetail(e: unknown, rec: ExportRecordText): string {
  const name = e instanceof Error ? e.name : "Error";
  const message = e instanceof Error ? e.message : "";
  const at = /position (\d+)/.exec(message) ?? null;
  const lineCol = /line (\d+) column (\d+)/.exec(message) ?? null;
  const where = at
    ? ` at position ${at[1]}`
    : lineCol
      ? ` at line ${lineCol[1]} column ${lineCol[2]}`
      : "";
  const issues = (e as { issues?: Array<{ path?: unknown[] }> } | null)?.issues;
  const path =
    Array.isArray(issues) && Array.isArray(issues[0]?.path) ? issues[0].path.join(".") : "";
  return `${name}${where}${path === "" ? "" : ` (${path})`}, record length ${rec.bytes}`;
}

/** Counts behind the property_type source limitations (OR-M4, DP-8); key names only. */
export interface TypeStats {
  /** R accounts typed by the improvement fallback. */
  fallback: number;
  /** Those fallback accounts by TCAD state code. */
  fallbackByState: Record<string, number>;
  /** R accounts with state code A4 (typed Townhouse, unverified) and F4. */
  a4: number;
  f4: number;
}

export const emptyTypeStats = (): TypeStats => ({ fallback: 0, fallbackByState: {}, a4: 0, f4: 0 });

export function addTypeStats(into: TypeStats, row: ParcelRow): void {
  if (!row.county_emit) return;
  const code = row.state_cd?.trim() ?? "";
  if (row.property_type_rule === "improvement_fallback") {
    into.fallback += 1;
    const key = code === "" ? "(empty)" : code;
    into.fallbackByState[key] = (into.fallbackByState[key] ?? 0) + 1;
  }
  if (code === "A4") into.a4 += 1;
  if (code === "F4") into.f4 += 1;
}

/** Classifies and maps one record; an UnknownKeyError propagates (the run fails). */
export function processRecord(
  rec: ExportRecordText,
  ctx: ChunkContext,
  inventory: KeyInventory,
  trace: (step: Step) => void = () => undefined,
): { recon: ReconRow; loaded?: LoadedRecord; dead?: DeadRecord; redacted: boolean } {
  const base = { job_id: ctx.jobId, record_ordinal: rec.ordinal };
  trace("parse");
  let raw: unknown;
  try {
    raw = JSON.parse(rec.text);
  } catch (e) {
    const detail = `not JSON: ${safeDetail(e, rec)}`;
    return {
      recon: { ...base, request_identifier: null, geo_id: null, class: "dead", detail },
      dead: { ordinal: rec.ordinal, sha256: rec.sha256, bytes: rec.bytes, detail },
      redacted: false,
    };
  }
  let record: Record<string, unknown>;
  try {
    record = parseExportRecord(raw, inventory);
  } catch (e) {
    if (e instanceof UnknownKeyError) throw e;
    return {
      recon: {
        ...base,
        request_identifier: null,
        geo_id: null,
        class: "invalid",
        detail: safeDetail(e, rec),
      },
      redacted: false,
    };
  }
  trace("redact");
  const redaction = redactRecord(record);
  trace("map");
  try {
    const mapped = mapParcel(redaction, { ...ctx, ordinal: rec.ordinal, recordSha256: rec.sha256 });
    return {
      recon: {
        ...base,
        request_identifier: mapped.parcel.request_identifier,
        geo_id: mapped.parcel.geo_id,
        class: "loaded",
        detail: null,
      },
      loaded: { ...mapped, record: redaction.record },
      redacted: redaction.redacted,
    };
  } catch (e) {
    const cls: RollClass = e instanceof InvalidRecordError ? "invalid" : "transform_failure";
    const pid =
      typeof record.pID === "number" || typeof record.pID === "string" ? String(record.pID) : null;
    return {
      recon: {
        ...base,
        request_identifier: pid,
        geo_id: null,
        class: cls,
        detail: safeDetail(e, rec),
      },
      redacted: redaction.redacted,
    };
  }
}

export async function processChunk(
  records: Iterable<ExportRecordText> | AsyncIterable<ExportRecordText>,
  ctx: ChunkContext,
  inventory: KeyInventory,
  hooks: ChunkHooks = {},
): Promise<ChunkResult> {
  const trace = hooks.trace ?? (() => undefined);
  const result: ChunkResult = {
    typeStats: emptyTypeStats(),
    loaded: [],
    reconciliation: [],
    dead: [],
    summary: {
      records: 0,
      loaded: 0,
      dead: 0,
      invalid: 0,
      transform_failure: 0,
      redacted: 0,
      by_prop_type: {},
    },
  };
  for await (const rec of records) {
    const out = processRecord(rec, ctx, inventory, trace);
    result.summary.records += 1;
    result.summary[out.recon.class] += 1;
    result.reconciliation.push(out.recon);
    if (out.dead) result.dead.push(out.dead);
    if (out.loaded) {
      result.loaded.push(out.loaded);
      addTypeStats(result.typeStats, out.loaded.parcel);
      if (out.redacted) result.summary.redacted += 1;
      const t = out.loaded.parcel.prop_type;
      result.summary.by_prop_type[t] = (result.summary.by_prop_type[t] ?? 0) + 1;
    }
  }
  if (hooks.store) {
    trace("store");
    await hooks.store(result.loaded, result.reconciliation);
  }
  if (hooks.validate) {
    if (!hooks.cids) throw new Error("processChunk: validate needs the lexicon data-group cids");
    trace("validate");
    const plan = planCountyGroup(
      result.loaded.map((l) => ({
        pID: l.parcel.request_identifier,
        geoId: l.parcel.geo_id,
        propType: l.parcel.prop_type,
        record: l.record,
        yearBuilt: l.parcel.property_structure_built_year,
        exportPoint:
          l.parcel.export_point_lat === null || l.parcel.export_point_lon === null
            ? null
            : {
                lat: l.parcel.export_point_lat,
                lon: l.parcel.export_point_lon,
                kind: l.parcel.export_point_kind,
              },
      })),
      hooks.cids,
    );
    await hooks.validate(plan.groups);
  }
  return result;
}

// ---------- chunk artifact (runs/<jobId>/chunks/c<N>.ndjson.gz), read by the Loader track ----------

export interface ChunkFile {
  rows: MappedRecord[];
  reconciliation: ReconRow[];
}

/** Writes the chunk (mapped rows + reconciliation, redacted only) and returns its SHA-256. */
export function writeChunkFile(path: string, chunk: ChunkFile): string {
  const lines = [
    ...chunk.rows.map((r) =>
      JSON.stringify({ t: "p", parcel: r.parcel, geoids: r.geoids, structures: r.structures }),
    ),
    ...chunk.reconciliation.map((r) => JSON.stringify({ t: "r", ...r })),
  ];
  const body = gzipSync(Buffer.from(lines.length === 0 ? "" : `${lines.join("\n")}\n`, "utf8"));
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body);
  return createHash("sha256").update(body).digest("hex");
}

export function readChunkFile(path: string): ChunkFile {
  const text = gunzipSync(readFileSync(path)).toString("utf8");
  const out: ChunkFile = { rows: [], reconciliation: [] };
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    const v = JSON.parse(line) as { t: string } & Record<string, unknown>;
    if (v.t === "p")
      out.rows.push({
        parcel: v.parcel,
        geoids: v.geoids,
        structures: v.structures,
      } as MappedRecord);
    else if (v.t === "r") {
      const { t: _t, ...rest } = v;
      out.reconciliation.push(rest as unknown as ReconRow);
    }
  }
  return out;
}
