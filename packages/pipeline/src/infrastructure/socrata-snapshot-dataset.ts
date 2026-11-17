import { createHash } from "node:crypto";
import type { FetchedPage, SnapshotLayer } from "../application/ports.js";
import type { SourceId } from "../domain/source-id.js";
import { SourceRequestError } from "./source-request-error.js";

const ROW_ID = ":id";
const MILLISECONDS_PER_SECOND = 1_000;

interface DatasetMetadata {
  rowsUpdatedAt?: number;
}

export interface SocrataSnapshotConfig {
  id: SourceId;
  baseUrl: string;
  datasetId: string;
  columns: readonly string[];
  where: string | undefined;
  pageSize: number;
  userAgent: string;
  fetch: typeof fetch;
  now: () => Date;
}

export class SocrataSnapshotDataset implements SnapshotLayer {
  readonly id: SourceId;

  constructor(private readonly config: SocrataSnapshotConfig) {
    this.id = config.id;
  }

  async version(): Promise<string> {
    const url = new URL(`/api/views/${this.config.datasetId}.json`, this.config.baseUrl);
    const { json, status } = await this.getJson<DatasetMetadata>(url);
    if (json.rowsUpdatedAt === undefined) throw new SourceRequestError(url.toString(), status);
    return new Date(json.rowsUpdatedAt * MILLISECONDS_PER_SECOND).toISOString();
  }

  async fetchPage(afterKey: string | undefined): Promise<FetchedPage> {
    const { columns, where, pageSize, datasetId, baseUrl } = this.config;
    const url = new URL(`/resource/${datasetId}.json`, baseUrl);
    url.searchParams.set("$select", [ROW_ID, ...columns].join(", "));
    const conditions = [
      ...(where ? [`(${where})`] : []),
      ...(afterKey ? [`${ROW_ID} > '${afterKey}'`] : []),
    ];
    if (conditions.length > 0) url.searchParams.set("$where", conditions.join(" AND "));
    url.searchParams.set("$order", ROW_ID);
    url.searchParams.set("$limit", String(pageSize));

    const { body, json, status } = await this.getJson<Record<string, unknown>[]>(url);
    const lastRowId = json.at(-1)?.[ROW_ID];
    return {
      body,
      recordCount: json.length,
      lastKey: typeof lastRowId === "string" ? lastRowId : undefined,
      maxBusinessDate: undefined,
      isLastPage: json.length < pageSize,
      receipt: {
        url: url.toString(),
        fetchedAt: this.config.now().toISOString(),
        httpStatus: status,
        bytes: Buffer.byteLength(body),
        sha256: createHash("sha256").update(body).digest("hex"),
      },
    };
  }

  private async getJson<T>(url: URL): Promise<{ body: string; json: T; status: number }> {
    const response = await this.config.fetch(url, {
      headers: { "user-agent": this.config.userAgent, accept: "application/json" },
    });
    const body = await response.text();
    if (!response.ok) throw new SourceRequestError(url.toString(), response.status);
    return { body, json: JSON.parse(body) as T, status: response.status };
  }
}
