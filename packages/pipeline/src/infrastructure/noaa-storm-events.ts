import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DuckDBInstance } from "@duckdb/node-api";
import type { FetchedPage, SnapshotLayer } from "../application/ports.js";
import type { SourceId } from "../domain/source-id.js";
import { latestStormEventFiles, type StormEventFile } from "../domain/storm-events.js";
import type { Bounds } from "../domain/travis-county.js";
import { SourceRequestError } from "./source-request-error.js";

const HAIL = "Hail";
const ISO_DATE = "%Y-%m-%d";
const MONTHS_DIGITS = 100;
const DOWNLOAD_PREFIX = "storm-events-";
const DOWNLOAD_FILE = "details.csv.gz";

export interface NoaaStormEventsConfig {
  id: SourceId;
  baseUrl: string;
  firstYear: number;
  bounds: Bounds;
  userAgent: string;
  fetch: typeof fetch;
  now: () => Date;
}

export class NoaaStormEvents implements SnapshotLayer {
  readonly id: SourceId;
  private files: StormEventFile[] | undefined;

  constructor(private readonly config: NoaaStormEventsConfig) {
    this.id = config.id;
  }

  async version(): Promise<string> {
    const newest = (await this.listedFiles())
      .map((file) => file.createdOn)
      .sort()
      .at(-1);
    if (newest === undefined)
      throw new Error(`No storm event files listed at ${this.config.baseUrl}`);
    return newest;
  }

  async fetchPage(afterKey: string | undefined): Promise<FetchedPage> {
    const files = await this.listedFiles();
    const index = files.findIndex((file) => afterKey === undefined || file.year > Number(afterKey));
    const file = files[index];
    if (file === undefined) throw new Error(`No storm event file after ${afterKey}`);

    const url = new URL(file.name, this.config.baseUrl).toString();
    const response = await this.get(url);
    const download = Buffer.from(await response.arrayBuffer());
    const reports = await hailReports(download, this.config.bounds);
    return {
      body: JSON.stringify(reports),
      recordCount: reports.length,
      lastKey: String(file.year),
      maxBusinessDate: undefined,
      isLastPage: index === files.length - 1,
      receipt: {
        url,
        fetchedAt: this.config.now().toISOString(),
        httpStatus: response.status,
        bytes: download.byteLength,
        sha256: createHash("sha256").update(download).digest("hex"),
      },
    };
  }

  private async listedFiles(): Promise<StormEventFile[]> {
    this.files ??= latestStormEventFiles(
      await (await this.get(this.config.baseUrl)).text(),
      this.config.firstYear,
    );
    return this.files;
  }

  private async get(url: string): Promise<Response> {
    const response = await this.config.fetch(url, {
      headers: { "user-agent": this.config.userAgent },
    });
    if (!response.ok) throw new SourceRequestError(url, response.status);
    return response;
  }
}

async function hailReports(gzip: Buffer, { south, north, west, east }: Bounds): Promise<unknown[]> {
  const dir = await mkdtemp(join(tmpdir(), DOWNLOAD_PREFIX));
  const file = join(dir, DOWNLOAD_FILE);
  try {
    await writeFile(file, gzip);
    const connection = await (await DuckDBInstance.create(":memory:")).connect();
    const number = (column: string) => `TRY_CAST(${column} AS DOUBLE)`;
    const reader = await connection.runAndReadAll(`
      SELECT EVENT_ID AS event_id, EPISODE_ID AS episode_id,
        strftime(make_date(
          CAST(BEGIN_YEARMONTH AS INTEGER) // ${MONTHS_DIGITS},
          CAST(BEGIN_YEARMONTH AS INTEGER) % ${MONTHS_DIGITS},
          CAST(BEGIN_DAY AS INTEGER)
        ), '${ISO_DATE}') AS event_date,
        BEGIN_TIME AS begin_time, CZ_TIMEZONE AS timezone, CZ_NAME AS county,
        ${number("MAGNITUDE")} AS magnitude_inches,
        ${number("BEGIN_LAT")} AS latitude, ${number("BEGIN_LON")} AS longitude,
        BEGIN_LOCATION AS location, SOURCE AS report_source
      FROM read_csv('${file.replaceAll("'", "''")}', all_varchar = true, header = true)
      WHERE EVENT_TYPE = '${HAIL}'
        AND ${number("BEGIN_LAT")} BETWEEN ${south} AND ${north}
        AND ${number("BEGIN_LON")} BETWEEN ${west} AND ${east}
      ORDER BY event_date, CAST(EVENT_ID AS BIGINT)
    `);
    connection.closeSync();
    return reader.getRowObjectsJson();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
