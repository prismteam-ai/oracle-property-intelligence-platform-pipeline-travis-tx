// A-04 T056 (AC-15, FR-015, FR-022): the jurisdictions part of the run report. Every permit
// jurisdiction in pipeline/docs/travis-sources.yaml (`permits.jurisdictions`, 23 rows, cross-
// checked with the curated travis/profiles/jurisdictions.ts) is either
//   - supported (Austin): this run's captured count, the source total and the capture time; or
//   - absent: its class, evidence URL, `own_permits_captured = false`, the Austin-issued permits
//     located there (they stay Austin-issued), and one source limitation, verbatim:
//     `{Jurisdiction}: no public permit history captured (records request, not filed); evidence {evidence_url}`.
// No kit vendor module applies to the 22 records-request jurisdictions (A-01), so nothing is
// fetched for them.
import { matchesJurisdiction } from "../discovery/austin-issued.js";
import type { Jurisdiction } from "../discovery/catalog.schema.js";
import type { JurisdictionProfileEntry } from "../profiles/jurisdictions.js";
import type { Limitation } from "./merge-input.js";

export const RECORDS_REQUEST_CODE = "records_request_not_filed";

export const recordsRequestText = (name: string, evidenceUrl: string): string =>
  `${name}: no public permit history captured (records request, not filed); evidence ${evidenceUrl}`;

export interface SupportedRow {
  key: string;
  captured: number;
  source_total: number;
  captured_at: string | null;
}

export interface AbsentRow {
  key: string;
  name: string;
  class: string;
  evidence_url: string;
  own_permits_captured: false;
  austin_issued_located_here: number;
}

export interface JurisdictionsReport {
  supported: SupportedRow[];
  absent: AbsentRow[];
  limitations: Limitation[];
}

type CatalogRow = Pick<Jurisdiction, "jurisdiction" | "key" | "spec_class" | "evidence_url">;

const classOf = (specClass: string): string => specClass.replace(/\s+/g, "_");

/** One limitation per jurisdiction that is not supported. */
export function jurisdictionLimitations(jurisdictions: readonly CatalogRow[]): Limitation[] {
  return jurisdictions
    .filter((j) => j.spec_class !== "supported")
    .map((j) => ({
      sourceKey: `permits:${j.key}`,
      code: RECORDS_REQUEST_CODE,
      text: recordsRequestText(j.jurisdiction, j.evidence_url),
      count: null,
      evidenceUrl: j.evidence_url,
    }));
}

export function buildJurisdictionsReport(input: {
  jurisdictions: readonly CatalogRow[];
  profile: readonly Pick<JurisdictionProfileEntry, "key">[];
  austin: { captured: number; sourceTotal: number; capturedAt: string | null };
  /** Austin rows by their source `jurisdiction` column (where the permit is located). */
  located: Readonly<Record<string, number>>;
}): JurisdictionsReport {
  const keys = input.jurisdictions.map((j) => j.key).sort();
  const profileKeys = input.profile.map((p) => p.key).sort();
  if (keys.length !== profileKeys.length || keys.some((k, i) => k !== profileKeys[i])) {
    throw new Error(
      `jurisdictions: catalog has ${keys.length} rows, the profile ${profileKeys.length} (expected the same 23 keys)`,
    );
  }
  const supported: SupportedRow[] = [];
  const absent: AbsentRow[] = [];
  for (const j of input.jurisdictions) {
    if (j.spec_class === "supported") {
      supported.push({
        key: j.key,
        captured: input.austin.captured,
        source_total: input.austin.sourceTotal,
        captured_at: input.austin.capturedAt,
      });
      continue;
    }
    const here = Object.entries(input.located)
      .filter(([value]) => matchesJurisdiction(value, j.jurisdiction))
      .reduce((sum, [, n]) => sum + n, 0);
    absent.push({
      key: j.key,
      name: j.jurisdiction,
      class: classOf(j.spec_class),
      evidence_url: j.evidence_url,
      own_permits_captured: false,
      austin_issued_located_here: here,
    });
  }
  return { supported, absent, limitations: jurisdictionLimitations(input.jurisdictions) };
}
