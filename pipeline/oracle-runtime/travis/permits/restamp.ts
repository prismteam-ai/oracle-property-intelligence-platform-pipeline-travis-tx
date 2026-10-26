// A-04 T052 (AC-16): the source-wide re-stamp detector (agent-design § 3). On 2026-10-19
// 12:22–12:43 UTC the Austin dataset moved `:updated_at` on every row within 21 minutes, so an
// incremental window `:updated_at > W` would have re-read everything as "changed".
//
// Rule: the incremental window is a re-stamp when
//   window count ≥ 50% of the dataset total            (reason `window_share`), or
//   ≥ 90% of the window rows fall inside one 6 h span  (reason `window_concentrated`).
// The 6 h span is measured on the hourly `:updated_at` histogram: the largest sum over 6
// consecutive hour buckets (bucket starts within [t, t + 6 h)).
// Response (workflow.ts): page the whole dataset by `:id`, compare content digests, write only
// the changed rows, and record the limitation RESTAMP_LIMITATION verbatim.

export const RESTAMP_WINDOW_SHARE = 0.5;
export const RESTAMP_CONCENTRATION_SHARE = 0.9;
export const RESTAMP_SPAN_HOURS = 6;
export const RESTAMP_LIMITATION = "source bulk re-stamp; delta by content digest";
export const RESTAMP_LIMITATION_CODE = "source_bulk_restamp";

export interface HourCount {
  /** Bucket start (`YYYY-MM-DDTHH:00:00…`, built from the (day, hour) group of the histogram query). */
  hour: string;
  n: number;
}

export interface RestampInput {
  total: number;
  windowCount: number;
  hours: readonly HourCount[];
}

export interface RestampVerdict {
  detected: boolean;
  reasons: ("window_share" | "window_concentrated")[];
  total: number;
  windowCount: number;
  windowShare: number;
  maxShareIn6h: number;
  rule: string;
}

const HOUR_MS = 3_600_000;

const bucketMs = (hour: string): number => {
  const iso = /[zZ]|[+-]\d{2}:?\d{2}$/.test(hour) ? hour : `${hour}Z`;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) throw new Error(`restamp: bad hour bucket ${hour}`);
  return t;
};

export function detectRestamp(input: RestampInput): RestampVerdict {
  const { total, windowCount } = input;
  const windowShare = total > 0 ? windowCount / total : 0;
  const buckets = input.hours
    .map((h) => ({ t: bucketMs(h.hour), n: h.n }))
    .sort((a, b) => a.t - b.t);
  const inHours = buckets.reduce((s, b) => s + b.n, 0);
  let best = 0;
  for (let i = 0, j = 0, sum = 0; i < buckets.length; i += 1) {
    const end = (buckets[i] as { t: number }).t + RESTAMP_SPAN_HOURS * HOUR_MS;
    while (j < buckets.length && (buckets[j] as { t: number }).t < end) {
      sum += (buckets[j] as { n: number }).n;
      j += 1;
    }
    best = Math.max(best, sum);
    sum -= (buckets[i] as { n: number }).n;
  }
  const denominator = Math.max(windowCount, inHours);
  const maxShareIn6h = denominator > 0 ? best / denominator : 0;
  const reasons: RestampVerdict["reasons"] = [];
  if (windowCount > 0 && windowShare >= RESTAMP_WINDOW_SHARE) reasons.push("window_share");
  if (windowCount > 0 && maxShareIn6h >= RESTAMP_CONCENTRATION_SHARE) {
    reasons.push("window_concentrated");
  }
  return {
    detected: reasons.length > 0,
    reasons,
    total,
    windowCount,
    windowShare,
    maxShareIn6h,
    rule: `window >= ${RESTAMP_WINDOW_SHARE * 100}% of total or >= ${RESTAMP_CONCENTRATION_SHARE * 100}% of window rows within ${RESTAMP_SPAN_HOURS} h`,
  };
}
