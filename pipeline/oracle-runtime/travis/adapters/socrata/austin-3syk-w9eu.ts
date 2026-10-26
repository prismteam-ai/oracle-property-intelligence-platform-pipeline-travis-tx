// T035: the Austin issued-construction-permits configuration of the Socrata adapter (City of
// Austin open data, dataset 3syk-w9eu). This file holds only the source coordinates and the
// month window. The list query's include predicate is the profile's generated SoQL
// (profiles/travis-austin@1.0.0 toSoqlInclude()), so no classification term lives here: the
// profile decides what is listed, and later what is published.
import { RULES, toSoqlInclude } from "../../../../../profiles/travis-austin@1.0.0/index.js";
import {
  captureSocrata,
  datasetUrl,
  type DateWindow,
  type SocrataCaptureOptions,
  type SocrataCaptureResult,
  type SocrataSource,
} from "./socrata.js";
import type { PageConfig } from "./socrata-pages.js";

export const AUSTIN_3SYK_W9EU: Readonly<SocrataSource> = Object.freeze({
  name: "austin-3syk-w9eu",
  domain: "data.austintexas.gov",
  dataset: "3syk-w9eu",
  key: RULES.dataset.key,
  dateField: "issue_date",
  watermarkField: ":updated_at",
});

// The adapter and the profile must name the same dataset; a drift is a configuration bug.
if (datasetUrl(AUSTIN_3SYK_W9EU) !== RULES.dataset.url) {
  throw new Error(
    `adapter dataset ${datasetUrl(AUSTIN_3SYK_W9EU)} differs from the profile's ${RULES.dataset.url}`,
  );
}

/**
 * Whole-request limit for one Austin bulk page: an ~88 MB answer takes 35-45 s and sometimes
 * far longer, so the client's 60 s default would cut it. A timeout is still retried at page
 * level (5 attempts, full jitter) by the workflow.
 */
export const PAGE_REQUEST_TIMEOUT_MS = 300_000;

/**
 * A-04 T050: keyset pages over the whole dataset (socrata-pages.ts). System fields come after
 * `*` (`$select=:id,*` answers 400, spike receipts). `issued_in_last_30_days` and
 * `day_issued` are calendar-derived columns: they change with the date, not with the permit,
 * so the content digest leaves them out (with every `:`-prefixed system field).
 */
export const AUSTIN_PAGES: Readonly<PageConfig> = Object.freeze({
  source: AUSTIN_3SYK_W9EU,
  select: "*,:id,:updated_at,:created_at",
  pageSize: 50_000,
  requestTimeoutMs: PAGE_REQUEST_TIMEOUT_MS,
  volatileFields: Object.freeze(["issued_in_last_30_days", "day_issued"]),
});

/** The profile's SoQL include predicate, generated from its rules (never written here). */
export const austinInclude = (): string => toSoqlInclude();

const pad = (n: number): string => String(n).padStart(2, "0");

/** The calendar month `YYYY-MM` as a half-open window of Socrata floating timestamps. */
export function monthWindow(month: string): DateWindow {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) throw new Error(`month must be YYYY-MM, got ${month}`);
  const year = Number(m[1]);
  const mon = Number(m[2]);
  if (mon < 1 || mon > 12) throw new Error(`month ${m[2]} is not 01…12`);
  const next = mon === 12 ? { y: year + 1, m: 1 } : { y: year, m: mon + 1 };
  return {
    from: `${year}-${pad(mon)}-01T00:00:00`,
    to: `${next.y}-${pad(next.m)}-01T00:00:00`,
  };
}

export type AustinMonthCaptureOptions = Omit<
  SocrataCaptureOptions,
  "source" | "window" | "include"
> & { month: string };

/** One month of Austin permits through the adapter, listed with the profile's predicate. */
export function captureAustinMonth(
  options: AustinMonthCaptureOptions,
): Promise<SocrataCaptureResult> {
  const { month, ...rest } = options;
  return captureSocrata({
    ...rest,
    source: AUSTIN_3SYK_W9EU,
    window: monthWindow(month),
    include: austinInclude(),
  });
}
