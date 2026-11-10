import { createHash } from "node:crypto";
import type {
  ArchiveIndex,
  CaptureQuery,
  FetchedSnapshot,
  SnapshotFetcher,
} from "../application/bbb-ports.js";
import type { ArchiveCapture } from "../domain/bbb-profile.js";
import { SourceRequestError } from "./source-request-error.js";

const WAYBACK_URL = "https://web.archive.org";
const CDX_PATH = "/cdx/search/cdx";
const SUCCESSFUL_CAPTURES = "statuscode:200";
const CAPTURE_FIELDS = "original,timestamp";
const RAW_SNAPSHOT_SUFFIX = "id_";

export interface WaybackCdxIndexConfig {
  userAgent: string;
  fetch: typeof fetch;
}

export class WaybackCdxIndex implements ArchiveIndex {
  constructor(private readonly config: WaybackCdxIndexConfig) {}

  async captures({ state, categories, since }: CaptureQuery): Promise<ArchiveCapture[]> {
    const captures: ArchiveCapture[] = [];
    for (const category of categories) {
      const url = new URL(CDX_PATH, WAYBACK_URL);
      url.searchParams.set("url", `bbb.org/us/${state}/`);
      url.searchParams.set("matchType", "prefix");
      url.searchParams.set("output", "json");
      url.searchParams.set("fl", CAPTURE_FIELDS);
      url.searchParams.append("filter", SUCCESSFUL_CAPTURES);
      url.searchParams.append(
        "filter",
        `original:.*/profile/${category}/[^/?]+-[0-9]{4}-[0-9]+/?$`,
      );
      if (since !== undefined) url.searchParams.set("from", since);

      const response = await this.config.fetch(url, {
        headers: { "user-agent": this.config.userAgent },
      });
      const body = await response.text();
      if (!response.ok) throw new SourceRequestError(url.toString(), response.status);
      if (!body.trim()) continue;

      const [, ...rows] = JSON.parse(body) as [string, string][];
      for (const [originalUrl, timestamp] of rows) captures.push({ originalUrl, timestamp });
    }
    return captures;
  }
}

export interface WaybackSnapshotFetcherConfig {
  userAgent: string;
  minIntervalMs: number;
  fetch: typeof fetch;
  sleep: (milliseconds: number) => Promise<void>;
  now: () => Date;
}

export class WaybackSnapshotFetcher implements SnapshotFetcher {
  private lastRequestAt: number | undefined;

  constructor(private readonly config: WaybackSnapshotFetcherConfig) {}

  async fetch({ originalUrl, timestamp }: ArchiveCapture): Promise<FetchedSnapshot> {
    await this.waitForTurn();
    const url = `${WAYBACK_URL}/web/${timestamp}${RAW_SNAPSHOT_SUFFIX}/${originalUrl}`;
    const response = await this.config.fetch(url, {
      headers: { "user-agent": this.config.userAgent },
    });
    const body = await response.text();
    if (!response.ok) throw new SourceRequestError(url, response.status);
    return {
      body,
      receipt: {
        url,
        fetchedAt: this.config.now().toISOString(),
        httpStatus: response.status,
        bytes: Buffer.byteLength(body),
        sha256: createHash("sha256").update(body).digest("hex"),
      },
    };
  }

  private async waitForTurn(): Promise<void> {
    if (this.lastRequestAt !== undefined) {
      const wait = this.lastRequestAt + this.config.minIntervalMs - this.config.now().getTime();
      if (wait > 0) await this.config.sleep(wait);
    }
    this.lastRequestAt = this.config.now().getTime();
  }
}
