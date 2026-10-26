// T021: Socrata probes for Austin "Issued Construction Permits" (3syk-w9eu) and the TX
// Comptroller "Active Franchise Tax Permit Holders" (9cir-efmm). Research R7, FR-001e,
// FR-002, FR-004c.
//
// - Counts are server-side `count(*)` queries, never paging to count.
// - Throughput: 3 consecutive full pages of 50,000 rows with a stable `$order=:id`, read
//   one after another (each awaited before the next starts); median rows per minute.
// - Every response is Zod-parsed through the source client; a challenge page fails the
//   parse and stops the source (`blocked`), it is never read as 0 rows.
// - StopOnBlocked: after a blocked or failed capture nothing more is asked of that source.
import { z } from "zod";
import type { CaptureReceipt } from "../../lib/source-client.js";
import type { Measurement } from "../catalog.schema.js";
import { MeasurementError, measureThroughput, type PageTiming } from "../measure.js";
import {
  missingReason,
  notAskedMeasurement,
  nullMeasurement,
  rateLimitsObserved,
  stopsSource,
  type ProbeDeps,
  type ProbeOutcome,
} from "./common.js";

export const AUSTIN_PERMITS_RESOURCE = "https://data.austintexas.gov/resource/3syk-w9eu.json";
export const COMPTROLLER_RESOURCE = "https://data.texas.gov/resource/9cir-efmm.json";
/** County-code column of 9cir-efmm. To confirm at the live run (T048). */
export const COMPTROLLER_COUNTY_FIELD = "taxpayer_county_code";
/** Travis County in the Comptroller's county numbering. */
export const TRAVIS_COUNTY_CODE = "227";
export const PAGE_SIZE = 50_000;
export const THROUGHPUT_PAGES = 3;

const COUNT_METHOD = "count(*)";

const CountString = z.union([z.string().regex(/^\d+$/), z.int().nonnegative()]);
const CountResponse = z.tuple([z.looseObject({ count: CountString })]);
const GroupResponse = z.array(
  z.looseObject({ jurisdiction: z.string().optional(), count: CountString }),
);
const PageResponse = z.array(z.record(z.string(), z.unknown()));

export interface LocatedElsewhere {
  jurisdiction: string;
  value: number;
  source_url: string;
  captured_at: string;
}

export interface ThroughputMeasured {
  rows_per_minute_median: number;
  pages_read: number;
  page_size: number;
  window_start: string;
  window_end: string;
  app_token_used: boolean;
  rate_limits_observed: string;
}

interface PagedOutcome {
  throughput: ThroughputMeasured | null;
  throughput_missing_reason: string | null;
  pages: PageTiming[];
}

export interface AustinPermitsProbe extends ProbeOutcome, PagedOutcome {
  url: string;
  denominator: Measurement;
  tcad_id_null_count: Measurement;
  /** Every `jurisdiction` group with its count (internal; the catalog keeps the subset below). */
  jurisdiction_counts: LocatedElsewhere[];
  /** Austin-issued records whose `jurisdiction` is not Austin (FR-004c). */
  located_in_other_jurisdictions: LocatedElsewhere[];
  app_token_used: boolean;
  rate_limits_observed: string;
}

export interface ComptrollerProbe extends ProbeOutcome, PagedOutcome {
  url: string;
  travis_coded_rows: Measurement;
  statewide_rows: Measurement;
  app_token_used: boolean;
  rate_limits_observed: string;
}

/** A SoQL query URL: `$` keys kept literal, values percent-encoded. */
export function soqlUrl(resource: string, params: Record<string, string>): string {
  const query = Object.entries(params)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join("&");
  return query.length > 0 ? `${resource}?${query}` : resource;
}

function toInt(v: string | number): number {
  return typeof v === "number" ? v : Number(v);
}

/** One server-side count. Returns the receipt and the value or null with its reason. */
async function count(
  deps: ProbeDeps,
  resource: string,
  where: string | null,
): Promise<{ measurement: Measurement; receipt: CaptureReceipt }> {
  const params: Record<string, string> = { $select: COUNT_METHOD };
  if (where !== null) params.$where = where;
  const url = soqlUrl(resource, params);
  const { receipt, data } = await deps.client.capture({
    url,
    schema: CountResponse,
    accept: "application/json",
    useAppToken: true,
  });
  if (stopsSource(receipt) || data === null) {
    return {
      receipt,
      measurement: nullMeasurement(url, receipt.captured_at, missingReason(receipt), COUNT_METHOD),
    };
  }
  return {
    receipt,
    measurement: {
      value: toInt(data[0].count),
      source_url: url,
      captured_at: receipt.captured_at,
      method: COUNT_METHOD,
      ...(where === null ? {} : { query: `$where=${where}` }),
    },
  };
}

/** Reads `pages` consecutive pages one after another and measures the median rate. */
async function readPages(
  deps: ProbeDeps,
  resource: string,
  pageSize: number,
  pages: number,
  receipts: CaptureReceipt[],
): Promise<PagedOutcome & { stopped: CaptureReceipt | null }> {
  const timings: PageTiming[] = [];
  for (let i = 0; i < pages; i += 1) {
    const offset = i * pageSize;
    const url = soqlUrl(resource, {
      $order: ":id",
      $limit: String(pageSize),
      $offset: String(offset),
    });
    const started = deps.now();
    const { receipt, data } = await deps.client.capture({
      url,
      schema: PageResponse,
      accept: "application/json",
      useAppToken: true,
    });
    const ended = deps.now();
    receipts.push(receipt);
    if (stopsSource(receipt) || data === null) {
      return {
        throughput: null,
        throughput_missing_reason: missingReason(receipt),
        pages: timings,
        stopped: receipt,
      };
    }
    timings.push({
      offset,
      rows: data.length,
      started_at: started.toISOString(),
      ended_at: ended.toISOString(),
    });
  }
  try {
    const t = measureThroughput(timings, pageSize);
    return {
      throughput: {
        ...t,
        app_token_used: receipts.some((r) => r.app_token_used),
        rate_limits_observed: rateLimitsObserved(receipts),
      },
      throughput_missing_reason: null,
      pages: timings,
      stopped: null,
    };
  } catch (error) {
    if (!(error instanceof MeasurementError)) throw error;
    return {
      throughput: null,
      throughput_missing_reason: `throughput not measurable: ${error.message}`,
      pages: timings,
      stopped: null,
    };
  }
}

export interface PagingOptions {
  pageSize?: number;
  pages?: number;
}

const AUSTIN_PATTERN = /AUSTIN/i;

export async function probeAustinPermits(
  deps: ProbeDeps,
  opts: PagingOptions = {},
): Promise<AustinPermitsProbe> {
  const pageSize = opts.pageSize ?? PAGE_SIZE;
  const pages = opts.pages ?? THROUGHPUT_PAGES;
  const resource = AUSTIN_PERMITS_RESOURCE;
  const receipts: CaptureReceipt[] = [];
  const groupUrl = soqlUrl(resource, {
    $select: `jurisdiction,${COUNT_METHOD}`,
    $group: "jurisdiction",
    $limit: String(PAGE_SIZE),
  });

  const result = (
    stopped: CaptureReceipt | null,
    parts: Partial<AustinPermitsProbe>,
  ): AustinPermitsProbe => {
    const notAsked = (url: string): Measurement => {
      if (!stopped) throw new Error(`socrata: ${url} has no measurement and no stop receipt`);
      return notAskedMeasurement(url, stopped, COUNT_METHOD);
    };
    return {
      status: stopped ? "blocked" : "available",
      receipts,
      blocked_receipt: stopped,
      url: resource,
      denominator: parts.denominator ?? notAsked(soqlUrl(resource, { $select: COUNT_METHOD })),
      tcad_id_null_count:
        parts.tcad_id_null_count ??
        notAsked(soqlUrl(resource, { $select: COUNT_METHOD, $where: "tcad_id IS NULL" })),
      jurisdiction_counts: parts.jurisdiction_counts ?? [],
      located_in_other_jurisdictions: parts.located_in_other_jurisdictions ?? [],
      throughput: parts.throughput ?? null,
      throughput_missing_reason:
        parts.throughput_missing_reason ??
        (stopped ? `not measured: source stopped earlier (${missingReason(stopped)})` : null),
      pages: parts.pages ?? [],
      app_token_used: receipts.some((r) => r.app_token_used),
      rate_limits_observed: rateLimitsObserved(receipts),
    };
  };

  const total = await count(deps, resource, null);
  receipts.push(total.receipt);
  if (stopsSource(total.receipt)) {
    return result(total.receipt, { denominator: total.measurement });
  }

  const nulls = await count(deps, resource, "tcad_id IS NULL");
  receipts.push(nulls.receipt);
  if (stopsSource(nulls.receipt)) {
    return result(nulls.receipt, {
      denominator: total.measurement,
      tcad_id_null_count: nulls.measurement,
    });
  }

  const groups = await deps.client.capture({
    url: groupUrl,
    schema: GroupResponse,
    accept: "application/json",
    useAppToken: true,
  });
  receipts.push(groups.receipt);
  if (stopsSource(groups.receipt) || groups.data === null) {
    return result(groups.receipt, {
      denominator: total.measurement,
      tcad_id_null_count: nulls.measurement,
    });
  }
  const jurisdictionCounts: LocatedElsewhere[] = groups.data
    .filter((g): g is typeof g & { jurisdiction: string } => typeof g.jurisdiction === "string")
    .map((g) => ({
      jurisdiction: g.jurisdiction,
      value: toInt(g.count),
      source_url: groupUrl,
      captured_at: groups.receipt.captured_at,
    }));

  const paged = await readPages(deps, resource, pageSize, pages, receipts);
  return result(paged.stopped, {
    denominator: total.measurement,
    tcad_id_null_count: nulls.measurement,
    jurisdiction_counts: jurisdictionCounts,
    located_in_other_jurisdictions: jurisdictionCounts.filter(
      (g) => !AUSTIN_PATTERN.test(g.jurisdiction),
    ),
    throughput: paged.throughput,
    throughput_missing_reason: paged.throughput_missing_reason,
    pages: paged.pages,
  });
}

export async function probeComptroller(
  deps: ProbeDeps,
  opts: PagingOptions = {},
): Promise<ComptrollerProbe> {
  const pageSize = opts.pageSize ?? PAGE_SIZE;
  const pages = opts.pages ?? THROUGHPUT_PAGES;
  const resource = COMPTROLLER_RESOURCE;
  const travisWhere = `${COMPTROLLER_COUNTY_FIELD}='${TRAVIS_COUNTY_CODE}'`;
  const receipts: CaptureReceipt[] = [];

  const done = (
    stopped: CaptureReceipt | null,
    travis: Measurement,
    statewide: Measurement,
    paged: PagedOutcome | null,
  ): ComptrollerProbe => ({
    status: stopped ? "blocked" : "available",
    receipts,
    blocked_receipt: stopped,
    url: resource,
    travis_coded_rows: travis,
    statewide_rows: statewide,
    throughput: paged?.throughput ?? null,
    throughput_missing_reason:
      paged?.throughput_missing_reason ??
      (stopped ? `not measured: source stopped earlier (${missingReason(stopped)})` : null),
    pages: paged?.pages ?? [],
    app_token_used: receipts.some((r) => r.app_token_used),
    rate_limits_observed: rateLimitsObserved(receipts),
  });

  const travis = await count(deps, resource, travisWhere);
  receipts.push(travis.receipt);
  const statewideUrl = soqlUrl(resource, { $select: COUNT_METHOD });
  if (stopsSource(travis.receipt)) {
    return done(
      travis.receipt,
      travis.measurement,
      notAskedMeasurement(statewideUrl, travis.receipt, COUNT_METHOD),
      null,
    );
  }
  const statewide = await count(deps, resource, null);
  receipts.push(statewide.receipt);
  if (stopsSource(statewide.receipt)) {
    return done(statewide.receipt, travis.measurement, statewide.measurement, null);
  }
  const paged = await readPages(deps, resource, pageSize, pages, receipts);
  return done(paged.stopped, travis.measurement, statewide.measurement, paged);
}
