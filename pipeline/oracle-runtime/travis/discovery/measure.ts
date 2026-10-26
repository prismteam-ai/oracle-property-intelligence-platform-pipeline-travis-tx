// T020: median rate, projected hours and the 48-hour rule (research R7, FR-002, FR-005).
//
// - Paged sources: at least 3 consecutive full pages of at most 50,000 rows, read one
//   after another; the rate is the median of the per-page rows per minute.
// - Projected full-capture hours = denominator / median rows per minute / 60.
// - Single-file sources: the measured download rate; projected hours = download time.
// - A source projected above 48 hours must carry a decision and its reason.

export const MAX_PAGE_SIZE = 50_000;
export const MIN_PAGES = 3;
export const DECISION_THRESHOLD_HOURS = 48;
/** 1 MB = 10^6 bytes, the unit of `download_rate.megabytes_per_minute`. */
export const BYTES_PER_MB = 1_000_000;

export interface PageTiming {
  /** `$offset` of this page. */
  offset: number;
  /** Rows the page returned. */
  rows: number;
  started_at: string;
  ended_at: string;
}

export interface ThroughputResult {
  rows_per_minute_median: number;
  pages_read: number;
  page_size: number;
  window_start: string;
  window_end: string;
}

export interface DownloadRate {
  megabytes_per_minute: number;
  bytes: number;
  seconds: number;
  source_url: string;
  captured_at: string;
}

export class MeasurementError extends Error {
  override name = "MeasurementError";
}

export function median(values: readonly number[]): number {
  if (values.length === 0) throw new MeasurementError("median of an empty list");
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const hi = sorted[mid] as number;
  return sorted.length % 2 === 1 ? hi : ((sorted[mid - 1] as number) + hi) / 2;
}

function instant(iso: string, what: string): number {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) throw new MeasurementError(`${what} is not a date-time: ${iso}`);
  return t;
}

export function rowsPerMinute(page: PageTiming): number {
  const ms = instant(page.ended_at, "ended_at") - instant(page.started_at, "started_at");
  if (ms <= 0) throw new MeasurementError(`page at offset ${page.offset} has no elapsed time`);
  return page.rows / (ms / 60_000);
}

export function measureThroughput(
  pages: readonly PageTiming[],
  pageSize: number,
): ThroughputResult {
  if (!Number.isInteger(pageSize) || pageSize <= 0 || pageSize > MAX_PAGE_SIZE) {
    throw new MeasurementError(`page size ${pageSize} must be 1..${MAX_PAGE_SIZE}`);
  }
  if (pages.length < MIN_PAGES) {
    throw new MeasurementError(`need at least ${MIN_PAGES} pages, got ${pages.length}`);
  }
  pages.forEach((page, i) => {
    if (page.rows > pageSize) {
      throw new MeasurementError(`page ${i} returned ${page.rows} rows, above ${pageSize}`);
    }
    if (page.rows < pageSize) {
      throw new MeasurementError(`page ${i} is not full (${page.rows} of ${pageSize} rows)`);
    }
    const first = pages[0] as PageTiming;
    if (page.offset !== first.offset + i * pageSize) {
      throw new MeasurementError(`page ${i} offset ${page.offset} is not consecutive`);
    }
    if (i > 0) {
      const prev = pages[i - 1] as PageTiming;
      if (instant(page.started_at, "started_at") < instant(prev.ended_at, "ended_at")) {
        throw new MeasurementError(`page ${i} started before page ${i - 1} ended (parallel read)`);
      }
    }
  });
  const first = pages[0] as PageTiming;
  const last = pages[pages.length - 1] as PageTiming;
  return {
    rows_per_minute_median: median(pages.map(rowsPerMinute)),
    pages_read: pages.length,
    page_size: pageSize,
    window_start: new Date(instant(first.started_at, "started_at")).toISOString(),
    window_end: new Date(instant(last.ended_at, "ended_at")).toISOString(),
  };
}

export function projectedHours(denominator: number, rowsPerMinuteMedian: number): number {
  if (!(rowsPerMinuteMedian > 0)) {
    throw new MeasurementError(`rate ${rowsPerMinuteMedian} rows/min must be positive`);
  }
  if (!(denominator >= 0)) throw new MeasurementError(`denominator ${denominator} is negative`);
  return denominator / rowsPerMinuteMedian / 60;
}

export function exceedsDecisionThreshold(hours: number | null | undefined): boolean {
  return typeof hours === "number" && hours > DECISION_THRESHOLD_HOURS;
}

export interface DecisionFields {
  projected_full_capture_hours?: number | null | undefined;
  decision?: string | undefined;
  decision_reason?: string | undefined;
}

/** True when a source above 48 hours lacks its decision or the reason (FR-005). */
export function missingDecision(source: DecisionFields): boolean {
  if (!exceedsDecisionThreshold(source.projected_full_capture_hours)) return false;
  const has = (s: string | undefined): boolean => typeof s === "string" && s.trim().length > 0;
  return !(has(source.decision) && has(source.decision_reason));
}

export function downloadRate(input: {
  bytes: number;
  seconds: number;
  source_url: string;
  captured_at: string;
}): DownloadRate {
  if (!(input.seconds > 0)) throw new MeasurementError("download time must be positive");
  return {
    megabytes_per_minute: input.bytes / BYTES_PER_MB / (input.seconds / 60),
    bytes: input.bytes,
    seconds: input.seconds,
    source_url: input.source_url,
    captured_at: input.captured_at,
  };
}

export interface ProjectionInput {
  denominator?: { value: number | null } | undefined;
  throughput?: { rows_per_minute_median: number } | undefined;
  download_rate?: { seconds: number } | undefined;
}

/** Projected full-capture hours of a source row, or null when nothing was measured. */
export function projectedHoursForSource(source: ProjectionInput): number | null {
  if (source.download_rate) return source.download_rate.seconds / 3600;
  const denominator = source.denominator?.value;
  const rate = source.throughput?.rows_per_minute_median;
  if (typeof denominator !== "number" || typeof rate !== "number" || rate <= 0) return null;
  return projectedHours(denominator, rate);
}
