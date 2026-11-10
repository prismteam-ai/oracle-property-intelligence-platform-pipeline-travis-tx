import { createHash } from "node:crypto";
import type { FetchedPage, PagedSource } from "../application/ports.js";
import { type IngestWindow, WindowKind } from "../domain/ingest-window.js";
import { isoDateOf } from "../domain/iso-date.js";
import { SourceId } from "../domain/source-id.js";
import { laterWatermark } from "../domain/watermark.js";
import { SourceRequestError } from "./source-request-error.js";

const KEY_FIELD = "permit_number";
const STATUS_DATE_FIELD = "statusdate";
const WINDOW_DATE_FIELDS = [STATUS_DATE_FIELD, "issue_date", "applieddate"] as const;

type PermitRow = Partial<Record<string, string>>;

export interface SocrataPermitSourceConfig {
  baseUrl: string;
  datasetId: string;
  pageSize: number;
  userAgent: string;
  fetch: typeof fetch;
  now: () => Date;
}

export class SocrataPermitSource implements PagedSource {
  readonly id = SourceId.AustinPermits;

  constructor(private readonly config: SocrataPermitSourceConfig) {}

  async fetchPage(window: IngestWindow, afterKey: string | undefined): Promise<FetchedPage> {
    const url = this.pageUrl(window, afterKey);
    const response = await this.config.fetch(url, {
      headers: { "user-agent": this.config.userAgent, accept: "application/json" },
    });
    const body = await response.text();
    if (!response.ok) throw new SourceRequestError(url.toString(), response.status);

    const rows = JSON.parse(body) as PermitRow[];
    return {
      body,
      recordCount: rows.length,
      lastKey: rows.at(-1)?.[KEY_FIELD],
      maxBusinessDate: latestStatusDate(rows),
      isLastPage: rows.length < this.config.pageSize,
      receipt: {
        url: url.toString(),
        fetchedAt: this.config.now().toISOString(),
        httpStatus: response.status,
        bytes: Buffer.byteLength(body),
        sha256: createHash("sha256").update(body).digest("hex"),
      },
    };
  }

  private pageUrl(window: IngestWindow, afterKey: string | undefined): URL {
    const url = new URL(`/resource/${this.config.datasetId}.json`, this.config.baseUrl);
    url.searchParams.set("$query", pageQuery(window, afterKey, this.config.pageSize));
    return url;
  }
}

function pageQuery(window: IngestWindow, afterKey: string | undefined, pageSize: number): string {
  const conditions: string[] = [];
  if (window.kind === WindowKind.Since) {
    const since = quoted(window.since);
    conditions.push(`(${WINDOW_DATE_FIELDS.map((field) => `${field} >= ${since}`).join(" OR ")})`);
  }
  if (afterKey !== undefined) conditions.push(`${KEY_FIELD} > ${quoted(afterKey)}`);

  const where = conditions.length > 0 ? ` WHERE ${conditions.join(" AND ")}` : "";
  return `SELECT *${where} ORDER BY ${KEY_FIELD} LIMIT ${pageSize}`;
}

function quoted(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function latestStatusDate(rows: PermitRow[]): string | undefined {
  return rows.reduce<string | undefined>((latest, row) => {
    const statusDate = row[STATUS_DATE_FIELD];
    return statusDate === undefined ? latest : laterWatermark(latest, isoDateOf(statusDate));
  }, undefined);
}
