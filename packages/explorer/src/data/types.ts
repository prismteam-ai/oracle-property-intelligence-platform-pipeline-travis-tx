import type { CheckedObject } from "../ipfs/gateway-check.js";

export interface Publication {
  buildId: string;
  publishedAt: string;
  manifestCid: string;
  rootCid: string;
  ipns: { name: string; resolvedCid: string };
}

export interface ManifestObject extends CheckedObject {
  codec: string;
}

export interface Manifest {
  schema: string;
  build_id: string;
  created_at: string;
  root: ManifestObject;
  objects: ManifestObject[];
  car: { name: string; size: number; sha256: string; root: string; url: string | null };
  dag: Record<string, string | number | boolean>;
  pins: { provider: string; cid: string }[];
  previous: { manifest_cid: string; root_cid: string } | null;
}

export interface TableDelta {
  table: string;
  rows: number;
  added: number;
  changed: number;
  removed: number;
}

export interface BuildSummary {
  buildId: string;
  asOf: string;
  inputs: Record<string, string>;
  sourceRows: Record<string, number>;
  tables: TableDelta[];
  [field: string]: unknown;
}

export interface IngestRun {
  source: string;
  runId: string;
  status?: string;
  records?: number;
  pages?: number;
  watermark?: string;
  previousWatermark?: string;
  window?: { kind: string; since?: string };
  receipt?: { url: string; fetchedAt: string; bytes: number; sha256: string };
  [field: string]: unknown;
}

export interface RunHistory {
  ingests: IngestRun[];
  builds: BuildSummary[];
}

export interface SourceDescription {
  id: string;
  name: string;
  publisher: string;
  url: string;
  provides: string[];
  refresh: string;
  limitations: string[];
}

export type Coverage = Record<string, Record<string, number | Record<string, number>>>;
