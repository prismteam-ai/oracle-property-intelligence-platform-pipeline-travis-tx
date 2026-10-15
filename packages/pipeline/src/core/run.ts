import path from "node:path";
import type { OracleConfig } from "./config.js";
import type { Db } from "./db.js";
import { downloadToFile, type DownloadResult, type FetchOptions } from "./http.js";
import type { MergeCounts } from "./merge.js";

export type SourceStatus = "ok" | "unchanged" | "skipped" | "blocked" | "failed";

export type SourceOutcome = {
  status: SourceStatus;
  counts?: MergeCounts;
  outOfScope?: number;
  limitation?: string;
  detail?: Record<string, unknown>;
};

export type RunMode = "full" | "incremental";

export type RunContext = {
  runId: string;
  mode: RunMode;
  windowStart?: string;
  windowEnd?: string;
  config: OracleConfig;
  db: Db;
  http: FetchOptions;
  rawDir(sourceId: string): string;
  download(
    sourceId: string,
    url: string,
    fileName: string,
    headers?: Record<string, string>,
  ): Promise<DownloadResult>;
  previousArtifact(
    sourceId: string,
    url: string,
  ): Promise<{ sha256: string; etag: string | null } | undefined>;
  getWatermark(sourceId: string): Promise<string | undefined>;
  setWatermark(sourceId: string, value: string): Promise<void>;
};

export interface SourceAdapter {
  readonly id: string;
  readonly name: string;
  readonly provides: string[];
  readonly dependsOn?: string[];
  run(ctx: RunContext): Promise<SourceOutcome>;
}

export function newRunId(now = new Date()): string {
  return `run-${now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "Z")}`;
}

export function createRunContext(args: {
  runId: string;
  mode: RunMode;
  windowStart?: string;
  windowEnd?: string;
  config: OracleConfig;
  db: Db;
}): RunContext {
  const { config, db, runId } = args;
  const http: FetchOptions = { userAgent: config.userAgent, timeoutMs: config.httpTimeoutMs };
  const rawDir = (sourceId: string) => path.join(config.dataDir, "raw", sourceId, runId);
  return {
    ...args,
    http,
    rawDir,
    async download(sourceId, url, fileName, headers) {
      const res = await downloadToFile(url, path.join(rawDir(sourceId), fileName), {
        ...http,
        headers,
      });
      await db.all(
        `INSERT OR REPLACE INTO raw_artifacts VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?::TIMESTAMPTZ)`,
        [
          runId,
          sourceId,
          url,
          path.relative(config.dataDir, res.filePath),
          res.bytes,
          res.sha256,
          res.status,
          res.etag,
          res.lastModified,
          res.contentType,
          res.fetchedAt,
        ],
      );
      return res;
    },
    async previousArtifact(sourceId, url) {
      return db.one<{ sha256: string; etag: string | null }>(
        `SELECT sha256, etag FROM raw_artifacts WHERE source_id = ? AND url = ? AND run_id <> ?
         ORDER BY fetched_at DESC LIMIT 1`,
        [sourceId, url, runId],
      );
    },
    async getWatermark(sourceId) {
      const row = await db.one<{ watermark: string }>(
        `SELECT watermark FROM source_watermarks WHERE source_id = ?`,
        [sourceId],
      );
      return row?.watermark;
    },
    async setWatermark(sourceId, value) {
      await db.all(`INSERT OR REPLACE INTO source_watermarks VALUES (?, ?, ?)`, [
        sourceId,
        value,
        runId,
      ]);
    },
  };
}
