// The Travis/Austin roof-age profile for the vendored kit estimator (T043, oracle § A.1
// step 5). It maps only terms that profiles/travis-austin@1.0.0 emits, never source text,
// so every classification word stays in that digested profile (FR-009, AD-26):
//   travis_status_class: open | stalled | closed | exclude   (classifyStatus().class)
//   travis_roof_class:   roofing_replacement | not_roofing   (classifyPermit().roofing)
// A needs_review permit carries no mappable term, so the estimator classifies it
// needs_review and never accepts it. Open and stalled replacements never reset roof age
// (P0-8): the estimator only anchors on completed work with a terminal date.
import {
  compileRoofAgeProfile,
  estimateRoofAge,
  type CompiledRoofAgeProfile,
  type RoofAgeEstimate,
  type RoofAgePermitEvidence,
  type RoofAgeProfile,
} from "../../kit/use-oracle/runtime/src/roof-age/estimator.js";

export const TRAVIS_ROOF_AGE_SOURCE = "austin_3syk_w9eu";
export const TRAVIS_ROOF_AGE_PROFILE_VERSION = "travis-austin-roof-profile-v1";

export const TRAVIS_ROOF_AGE_PROFILE = {
  version: TRAVIS_ROOF_AGE_PROFILE_VERSION,
  sources: [
    {
      sourceSystem: TRAVIS_ROOF_AGE_SOURCE,
      statusMappings: [
        { field: "travis_status_class", value: "closed", status: "completed" },
        { field: "travis_status_class", value: "open", status: "open" },
        { field: "travis_status_class", value: "stalled", status: "other" },
        { field: "travis_status_class", value: "exclude", status: "other" },
      ],
      workMappings: [
        {
          field: "travis_roof_class",
          value: "roofing_replacement",
          classification: "primary_roof_replacement",
        },
        { field: "travis_roof_class", value: "not_roofing", classification: "other" },
      ],
    },
  ],
} as const satisfies RoofAgeProfile;

let compiled: CompiledRoofAgeProfile | undefined;

export function compiledTravisRoofAgeProfile(): CompiledRoofAgeProfile {
  compiled ??= compileRoofAgeProfile(TRAVIS_ROOF_AGE_PROFILE as unknown as RoofAgeProfile);
  return compiled;
}

/** One permit of the property, as the classification ledger records it. */
export interface TravisRoofPermit {
  permit_number: string;
  /** classifyStatus().class from profiles/travis-austin@1.0.0. */
  status_class: "open" | "stalled" | "closed" | "exclude" | "needs_review";
  /** classifyPermit().roofing from profiles/travis-austin@1.0.0. */
  roofing: "roofing" | "not_roofing" | "needs_review";
  /** Austin issue_date (YYYY-MM-DD or a Socrata timestamp), or null. */
  issue_date: string | null;
  /** Austin completed_date (YYYY-MM-DD or a Socrata timestamp), or null. */
  completed_date: string | null;
}

export interface RoofAgeLedgerRow {
  pID: string;
  as_of: string;
  /** structure.roof_date: the permit anchor date, the built year as "YYYY", or null. */
  roof_date: string | null;
  estimate: RoofAgeEstimate;
  profile: { version: string; sha256: string };
}

function isoDate(value: string | null): string | null {
  if (value === null) return null;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(value);
  return m ? (m[1] as string) : null;
}

function dateEvidence(value: string | null): RoofAgePermitEvidence["completionDate"] {
  const iso = isoDate(value);
  return iso === null
    ? { value: null, evidenceState: "confirmed_empty" }
    : { value: iso, evidenceState: "confirmed_present" };
}

function evidence(p: TravisRoofPermit): RoofAgePermitEvidence {
  const status =
    p.status_class === "needs_review"
      ? []
      : [{ field: "travis_status_class", value: p.status_class }];
  const work =
    p.roofing === "roofing"
      ? [{ field: "travis_roof_class", value: "roofing_replacement" }]
      : p.roofing === "not_roofing"
        ? [{ field: "travis_roof_class", value: "not_roofing" }]
        : [];
  // A needs_review word has no mapping: an unmapped placeholder term makes the estimator
  // classify the permit needs_review, which it never accepts.
  const unmapped = [{ field: "travis_unmapped", value: "needs_review" }];
  const issue = isoDate(p.issue_date);
  return {
    sourceSystem: TRAVIS_ROOF_AGE_SOURCE,
    sourceRecordId: p.permit_number,
    statusEvidence: status.length > 0 ? status : unmapped,
    workEvidence: work.length > 0 ? work : unmapped,
    completionDate: dateEvidence(p.completed_date),
    // Austin 3syk-w9eu publishes no separate close date.
    closeDate: { value: null, evidenceState: "unavailable" },
    chronologyStartDate:
      issue === null ? null : { value: issue, evidenceState: "confirmed_present" },
  };
}

export interface TravisRoofAgeInput {
  pID: string;
  /** Run finishedAt; its UTC date is the estimator's asOfDate (never today). */
  finishedAt: string;
  /** TCAD propertyProfile[].imprvActualYearBuilt, or null. */
  builtYear: number | null;
  permits: TravisRoofPermit[];
}

export function estimateTravisRoofAge(input: TravisRoofAgeInput): RoofAgeLedgerRow {
  const asOf = isoDate(input.finishedAt);
  if (asOf === null) throw new Error(`finishedAt is not an ISO timestamp: ${input.finishedAt}`);
  const profile = compiledTravisRoofAgeProfile();
  const estimate = estimateRoofAge(
    {
      asOfDate: asOf,
      builtYear:
        input.builtYear === null
          ? null
          : {
              year: input.builtYear,
              evidenceState: "confirmed_present",
              sourceSystem: "tcad_2026_certified_json",
              sourceRecordId: input.pID,
              field: "propertyProfile.imprvActualYearBuilt",
            },
      permits: input.permits.map(evidence),
      // The pilot captured a slice of Austin permits, not each parcel's full history.
      historicalCoverage: { state: "partial", caveats: ["partial_history"] },
    },
    profile,
  );
  const anchor = estimate.anchor;
  const roofDate =
    anchor === null
      ? null
      : anchor.type === "permit_terminal_date"
        ? anchor.date
        : String(anchor.year);
  return {
    pID: input.pID,
    as_of: asOf,
    roof_date: roofDate,
    estimate,
    profile: { version: profile.version, sha256: profile.sha256 },
  };
}
