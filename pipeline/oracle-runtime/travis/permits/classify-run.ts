// A-04 T055 (AC-14, FR-014, FR-023): classification of one Austin row, ONLY through the frozen
// profile travis-austin@1.0.0 (P0-9). This file holds no term list: the profile's
// classifyPermit / classifyStatus / hasIncludeTerm decide, and their verdict is passed on as
// is, with the profile id and SHA-256 stamped on every result.
// - include + exclude (a second-trade term in the same description): the profile's exclude rules win (precedence in rules.json);
// - an undecidable row → `needs_review` (the profile's own value), never guessed;
// - the source status word is kept verbatim in `statusRaw` (Expired stays Expired, class
//   `stalled`); the expiry date stays in the Query DB (no lexicon carrier).
import {
  PROFILE,
  PROFILE_ID,
  classifyPermit,
  classifyStatus,
  digest,
  hasIncludeTerm,
  type PermitClassification,
  type StatusClass,
} from "../../../../profiles/travis-austin@1.0.0/index.js";

export const PROFILE_SHA256 = PROFILE.sha256;
export { PROFILE_ID };
export type { StatusClass };

export interface RunClassification {
  /** The profile's permit verdict, unchanged. */
  permit: PermitClassification;
  /** The profile's include terms match the description (a candidate for the profile's rules). */
  includeTerm: boolean;
  statusRaw: string | null;
  statusClass: StatusClass;
  profile: string;
  profileSha256: string;
}

const text = (v: unknown): string | null => (typeof v === "string" ? v : null);

/** Classifies one source row (Socrata omits null fields; every field but the number is optional). */
export function classifyRun(row: Readonly<Record<string, unknown>>): RunClassification {
  const permitNumber = text(row.permit_number) ?? "";
  const status = classifyStatus(text(row.status_current));
  const permit = classifyPermit({
    permit_number: permitNumber === "" ? "(none)" : permitNumber,
    permittype: text(row.permittype),
    work_class: text(row.work_class),
    status_current: text(row.status_current),
    description: text(row.description),
  });
  return {
    permit,
    includeTerm: hasIncludeTerm(text(row.description)),
    statusRaw: status.status_word,
    statusClass: status.class,
    profile: PROFILE_ID,
    profileSha256: PROFILE_SHA256,
  };
}

/** Recomputes the profile digest and refuses a profile whose rules drifted from its stamp. */
export function verifyProfile(): string {
  const actual = digest();
  if (actual !== PROFILE_SHA256) {
    throw new Error(
      `profile ${PROFILE_ID} digest ${actual} differs from the stamped ${PROFILE_SHA256}`,
    );
  }
  return actual;
}

/** The 2026-10-19 status split of the profile's candidates (test plan § 5). */
export const STATUS_BASELINE_2026_10_19 = Object.freeze({
  open: 129,
  stalled: 2213,
  closed: 17251,
  exclude: 2491,
});

type Baselined = keyof typeof STATUS_BASELINE_2026_10_19;

/** This run's counts against the baseline, with deltas (needs_review is reported apart). */
export function statusVsBaseline(
  counts: Partial<Record<StatusClass, number>>,
): Record<Baselined, { run: number; baseline: number; delta: number }> {
  const keys = Object.keys(STATUS_BASELINE_2026_10_19) as Baselined[];
  return Object.fromEntries(
    keys.map((k) => {
      const run = counts[k] ?? 0;
      const baseline = STATUS_BASELINE_2026_10_19[k];
      return [k, { run, baseline, delta: run - baseline }];
    }),
  ) as Record<Baselined, { run: number; baseline: number; delta: number }>;
}
