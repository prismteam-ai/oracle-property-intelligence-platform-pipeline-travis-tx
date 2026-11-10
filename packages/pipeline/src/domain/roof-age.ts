import { Confidence } from "./confidence.js";
import { isPlausibleDate, isPlausibleYear, wholeYearsBetween, yearOf } from "./iso-date.js";
import { PermitState } from "./permit-state.js";
import { RoofWork } from "./roof-work.js";

export enum RoofAnchor {
  CompletedReplacement = "completed_replacement",
  NewConstruction = "new_construction",
  YearBuilt = "year_built",
}

export interface RoofPermitEvidence {
  permitNumber: string;
  work: RoofWork;
  state: PermitState;
  completedDate: string | undefined;
}

export interface RoofAgeInput {
  asOf: string;
  yearBuilt: number | undefined;
  permits: readonly RoofPermitEvidence[];
}

export interface RoofAgeEstimate {
  anchor: RoofAnchor;
  anchorDate: string;
  anchorPermitNumber?: string;
  estimatedAgeYears: number;
  confidence: Confidence;
}

interface Candidate {
  sortKey: string;
  estimate: RoofAgeEstimate;
}

const PERMIT_ANCHORS: Partial<Record<RoofWork, { anchor: RoofAnchor; confidence: Confidence }>> = {
  [RoofWork.Replacement]: { anchor: RoofAnchor.CompletedReplacement, confidence: Confidence.High },
  [RoofWork.NewConstruction]: { anchor: RoofAnchor.NewConstruction, confidence: Confidence.Medium },
};
const YEAR_ONLY_SORT_SUFFIX = "-00-00";

export function estimateRoofAge({
  asOf,
  yearBuilt,
  permits,
}: RoofAgeInput): RoofAgeEstimate | undefined {
  const candidates: Candidate[] = permits.flatMap((permit) => {
    const rule = PERMIT_ANCHORS[permit.work];
    const date = permit.completedDate;
    if (!rule || permit.state !== PermitState.Completed || !date || !isPlausibleDate(date, asOf)) {
      return [];
    }
    return [
      {
        sortKey: date,
        estimate: {
          ...rule,
          anchorDate: date,
          anchorPermitNumber: permit.permitNumber,
          estimatedAgeYears: wholeYearsBetween(date, asOf),
        },
      },
    ];
  });

  if (yearBuilt !== undefined && isPlausibleYear(yearBuilt, asOf)) {
    candidates.push({
      sortKey: `${yearBuilt}${YEAR_ONLY_SORT_SUFFIX}`,
      estimate: {
        anchor: RoofAnchor.YearBuilt,
        anchorDate: String(yearBuilt),
        estimatedAgeYears: yearOf(asOf) - yearBuilt,
        confidence: Confidence.Low,
      },
    });
  }

  return candidates.reduce<Candidate | undefined>(
    (best, candidate) => (best === undefined || outranks(candidate, best) ? candidate : best),
    undefined,
  )?.estimate;
}

const CONFIDENCE_RANK: Record<Confidence, number> = {
  [Confidence.High]: 3,
  [Confidence.Medium]: 2,
  [Confidence.Low]: 1,
};

function outranks(candidate: Candidate, best: Candidate): boolean {
  if (candidate.sortKey !== best.sortKey) return candidate.sortKey > best.sortKey;
  const rankDifference =
    CONFIDENCE_RANK[candidate.estimate.confidence] - CONFIDENCE_RANK[best.estimate.confidence];
  if (rankDifference !== 0) return rankDifference > 0;
  return (candidate.estimate.anchorPermitNumber ?? "") < (best.estimate.anchorPermitNumber ?? "");
}
