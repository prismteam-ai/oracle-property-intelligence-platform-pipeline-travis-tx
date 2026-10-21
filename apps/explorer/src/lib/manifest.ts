import type { ManifestObject } from './verify.js';

export interface Manifest {
  schemaVersion: string;
  run_id: string;
  label?: string;
  objects: ManifestObject[];
  notes?: string[];
  [key: string]: unknown;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** The manifest is the kit's JSON, served as pinned; only the artifact list is read here, and rows are checked. */
export function parseManifest(raw: unknown): Manifest {
  if (!isRecord(raw) || !Array.isArray(raw.objects)) throw new Error('manifest has no objects[]');
  const objects: ManifestObject[] = [];
  for (const row of raw.objects) {
    if (
      isRecord(row) &&
      typeof row.cid === 'string' &&
      typeof row.name === 'string' &&
      typeof row.size === 'number' &&
      typeof row.codec === 'string' &&
      typeof row.sha256 === 'string'
    ) {
      objects.push({
        cid: row.cid,
        name: row.name,
        size: row.size,
        codec: row.codec,
        sha256: row.sha256,
        ...(typeof row.digest_of === 'string' ? { digest_of: row.digest_of } : {}),
      });
    }
  }
  return { ...(raw as Manifest), objects };
}

export interface TablePart {
  cid: string;
  size: number;
  /** Path under the tables root, e.g. `address/part-00000.parquet`. */
  relativePath: string;
  table: string;
}

const PART = /^(?<group>[^/]+)\/(?<shard>[^/]+)\/tables\/(?<table>[^/]+)\/(?<rest>.+\.parquet)$/;

/** Parquet parts of a manifest grouped by `<group>/<shard>`; the mirror key is `/tables/<tables_cid>/<table>/<file>`. */
export function tablePartsByShard(objects: readonly ManifestObject[]): Map<string, TablePart[]> {
  const out = new Map<string, TablePart[]>();
  for (const object of objects) {
    const match = PART.exec(object.name);
    if (!match?.groups) continue;
    const g = match.groups as Record<string, string>;
    const group = g.group as string;
    const shard = g.shard as string;
    const table = g.table as string;
    const rest = g.rest as string;
    const key = `${group}/${shard}`;
    const list = out.get(key) ?? [];
    list.push({
      cid: object.cid,
      size: object.size,
      table,
      relativePath: `${table}/${rest}`,
    });
    out.set(key, list);
  }
  return out;
}

export function mirrorPath(tablesCid: string, relativePath: string): string {
  return `/tables/${tablesCid}/${relativePath}`;
}
