// A-04 T055 (AC-16, FR-016, FR-026): days a permit has been open.
//   open_days = as_of − issue_date   for status classes `open` and `stalled`;
//   no usable issue_date → null with the internal reason `no_issue_date` (public `needs_review`),
//   never 0;  every other class → null with `not_open`.
// `as_of` is the run's finishedAt date, handed in by the caller (never now() here).
import type { StatusClass } from "./classify-run.js";

export type OpenDaysReason = "no_issue_date" | "not_open";

export interface OpenDays {
  openDays: number | null;
  reason: OpenDaysReason | null;
}

const DATE = /^(\d{4})-(\d{2})-(\d{2})/;
const DAY_MS = 86_400_000;

function utcDay(value: string): number | null {
  const m = DATE.exec(value);
  if (!m) return null;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const back = new Date(t).toISOString().slice(0, 10);
  return back === value.slice(0, 10) ? t : null;
}

export function openDays(input: {
  statusClass: StatusClass;
  issueDate: string | null | undefined;
  asOf: string;
}): OpenDays {
  const asOf = /^\d{4}-\d{2}-\d{2}$/.test(input.asOf) ? utcDay(input.asOf) : null;
  if (asOf === null)
    throw new Error(`open days: as_of must be the run's YYYY-MM-DD date, got ${input.asOf}`);
  if (input.statusClass !== "open" && input.statusClass !== "stalled") {
    return { openDays: null, reason: "not_open" };
  }
  const issued = input.issueDate ? utcDay(input.issueDate) : null;
  if (issued === null) return { openDays: null, reason: "no_issue_date" };
  return { openDays: Math.round((asOf - issued) / DAY_MS), reason: null };
}

/** The frozen contract/v1 reason for an internal open-days reason (D-9). */
export function publicOpenDaysReason(
  reason: OpenDaysReason | null,
): "needs_review" | "not_open" | null {
  return reason === "no_issue_date" ? "needs_review" : reason;
}
