// Parquet footers for Data · Catalog (A-13 T014, research R4): each table part's footer is read
// by HTTP Range from the CID copy with hyparquet 1.31.2 (pure JS, pinned). This module is imported
// only by the Catalog page (a lazy route), so hyparquet stays out of every other page's bundle.
// (A dynamic import was tried for ERR-41; scripts/bundle-size.ts only follows static imports, so
// its Catalog-only placement gate rejects it.)
// It gives the columns, their types and the row count of the published file ("rows in the
// published file"); it cannot check a CID (each CID links to Verify for that). `catalogTables`
// groups the manifest's table parts by table, from the manifest only.
import type { RunManifestV1 } from "@countylens/contract";
import {
  parquetMetadataAsync,
  parquetSchema,
  type AsyncBuffer,
  type SchemaElement,
} from "hyparquet";
import { resolveBatchGroups } from "@countylens/query-core";
import { browserFetch } from "./http";
import { readCapped } from "./read-capped";

export interface ParquetColumn {
  readonly name: string;
  readonly type: string;
}

export interface ParquetFooter {
  readonly columns: readonly ParquetColumn[];
  readonly rows: number;
}

export interface ReadFooterOptions {
  readonly fetch?: typeof fetch;
  readonly signal?: AbortSignal;
  /** readTableMeta: how many of the table's part footers are read at once (default 1). */
  readonly concurrency?: number;
}

/** The type label of a schema element: logical type, else converted type, else physical. */
function typeOf(element: SchemaElement, hasChildren: boolean): string {
  const logical = element.logical_type?.type;
  if (logical !== undefined) return logical;
  if (element.converted_type !== undefined) return element.converted_type;
  if (element.type !== undefined) return element.type;
  return hasChildren ? "GROUP" : "UNKNOWN";
}

/**
 * The first slice read from the end of a part (hyparquet's default is 512 KB, which made the
 * catalog download about 119 MB for Run 4's 255 parts). Run 4's footers: median 3.9 KB, largest
 * 35 KB (measured 2026-10-26), so one 64 KB read holds the footer; a larger one costs one more
 * read, never more data than the footer itself.
 */
export const FOOTER_FIRST_READ_BYTES = 64 * 1024;

/** Largest footer slice one Range GET may ask for (a footer is KBs; this is a hard ceiling). */
export const FOOTER_MAX_BYTES = 4 * 1024 * 1024;
/** Shown when a host answers a Range request with the whole file (or more than the slice). */
export const FOOTER_RANGE_IGNORED = "footer unavailable · host ignored Range";
/** Tables read at once by the Catalog (each table's parts are read one after another). */
export const CATALOG_TABLE_CONCURRENCY = 2;

/** An AsyncBuffer over `url` that reads each slice with one `Range: bytes=a-b` GET, never more. */
function rangeBuffer(url: string, size: number, options: ReadFooterOptions): AsyncBuffer {
  const fetchImpl = options.fetch ?? browserFetch;
  return {
    byteLength: size,
    async slice(start: number, end: number = size): Promise<ArrayBuffer> {
      const wanted = end - start;
      if (wanted > FOOTER_MAX_BYTES) throw new Error("footer unavailable · footer too large");
      const init: RequestInit = { headers: { Range: `bytes=${start}-${end - 1}` } };
      if (options.signal !== undefined) init.signal = options.signal;
      const response = await fetchImpl(url, init);
      if (response.status !== 206) {
        if (response.status === 200) {
          await response.body?.cancel().catch(() => undefined);
          throw new Error(FOOTER_RANGE_IGNORED);
        }
        await response.body?.cancel().catch(() => undefined);
        throw new Error(`${new URL(url).host} answered ${response.status}`);
      }
      const read = await readCapped(response, wanted);
      if (read.kind === "too_large") throw new Error(FOOTER_RANGE_IGNORED);
      const { bytes } = read;
      return bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer;
    },
  };
}

/** Columns, types and row count of one published Parquet part of `size` bytes. */
export async function readParquetFooter(
  url: string,
  size: number,
  options: ReadFooterOptions = {},
): Promise<ParquetFooter> {
  const metadata = await parquetMetadataAsync(rangeBuffer(url, size, options), {
    initialFetchSize: FOOTER_FIRST_READ_BYTES,
  });
  const tree = parquetSchema(metadata);
  return {
    columns: tree.children.map((child) => ({
      name: child.element.name,
      type: typeOf(child.element, child.children.length > 0),
    })),
    rows: Number(metadata.num_rows),
  };
}

export interface TablePartRef {
  readonly name: string;
  readonly cid: string;
  readonly size: number;
}

/**
 * One table: columns and types from the FIRST part's footer (it has the schema), rows summed over
 * every part's footer, read one part after another (each with the same Range guard).
 */
export async function readTableMeta(
  parts: readonly TablePartRef[],
  urlOf: (part: TablePartRef) => string,
  options: ReadFooterOptions = {},
): Promise<ParquetFooter> {
  if (parts.length === 0) throw new Error("the table has no part in the manifest");
  // Label review 2026-10-26: the parts were read one after another (Run 4: 255 parts, about 30 s
  // for the page); now up to `concurrency` at a time. Columns come from the first part.
  const footers = new Array<ParquetFooter>(parts.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < parts.length) {
      const i = next++;
      const part = parts[i] as TablePartRef;
      footers[i] = await readParquetFooter(urlOf(part), part.size, options);
    }
  };
  const width = Math.max(1, Math.min(options.concurrency ?? 1, parts.length));
  await Promise.all(Array.from({ length: width }, worker));
  const [head] = footers as [ParquetFooter];
  return { columns: head.columns, rows: footers.reduce((sum, f) => sum + f.rows, 0) };
}

export interface CatalogPart {
  readonly name: string;
  readonly cid: string;
  readonly size: number;
}

export interface CatalogTable {
  /** `{group}.{table}`, e.g. "county.property". */
  readonly table: string;
  readonly parts: readonly CatalogPart[];
  /** Sum of the parts' manifest sizes. */
  readonly size: number;
}

/** The manifest's table parts grouped by table, in manifest order. A part's table is its parent folder; its group is the one query-core resolves for its export batch (the pilot's `tables/<group>/<table>/<part>` and a full-county run's `…/tables/<bNN>/<table>/<part>` alike), so a table split over batches is one row. */
export function catalogTables(manifest: RunManifestV1): CatalogTable[] {
  const parts = manifest.artifacts.filter((a) => a.kind === "table");
  const groups = resolveBatchGroups(parts.map((a) => a.name));
  const tables = new Map<string, CatalogPart[]>();
  for (const a of parts) {
    const segs = a.name.split("/");
    const group = groups.get(segs.slice(0, -2).join("/"));
    const name = segs.at(-2);
    if (!group || !name) continue;
    const table = `${group}.${name}`;
    tables.set(table, [...(tables.get(table) ?? []), { name: a.name, cid: a.cid, size: a.size }]);
  }
  return [...tables].map(([table, parts]) => ({
    table,
    parts,
    size: parts.reduce((n, p) => n + p.size, 0),
  }));
}
