// A-07 T015 (Track A): the crosswalk negative finding (D-10, specs/007-enrich-reconcile/
// research.md). Stage 3's `oracle` design consult checked the full column list of Austin's
// Issued Construction Permits dataset (Socrata `3syk-w9eu`) for any field that crosswalks a
// permit's printed contractor name to a Texas Comptroller taxpayer number: only name, trade,
// phone and address fields are printed, no license/tax/registry identifier. The only other
// candidate is the City of Austin ROW Contractor Registry, published as a PDF with its own
// city licence number -- a different identifier namespace from the Comptroller taxpayer
// number, so it does not crosswalk either. This file records that negative finding and keeps
// the `resolved` code path provable against a labelled fixture (AC-2's fixture-fallback
// clause), never a live match this run.
export interface CrosswalkNegativeFinding {
  dataset: string;
  datasetUrl: string;
  foundCrosswalk: false;
  citation: string;
}

export const CROSSWALK_NEGATIVE_FINDING: Readonly<CrosswalkNegativeFinding> = Object.freeze({
  dataset: "3syk-w9eu",
  datasetUrl: "https://data.austintexas.gov/resource/3syk-w9eu.json",
  foundCrosswalk: false,
  citation:
    "Austin Issued Construction Permits (3syk-w9eu) column list checked against the TX " +
    "Comptroller Active Franchise Tax Permit Holders registry (9cir-efmm): the permit dataset " +
    "prints only contractor name, trade, phone and address fields, no licence/tax/registry " +
    "identifier. The City of Austin ROW Contractor Registry (a PDF, with its own city licence " +
    "number) is a different identifier namespace and does not crosswalk either. D-10: no " +
    "identifier crosswalk exists between Austin permits and the Comptroller this run.",
});

/** permitKey -> Comptroller taxpayer number. */
export type CrosswalkIndex = ReadonlyMap<string, string>;

export interface CrosswalkEntry {
  permitKey: string;
  taxpayerNumber: string;
}

export function buildCrosswalkIndex(entries: readonly CrosswalkEntry[]): CrosswalkIndex {
  return new Map(entries.map((e) => [e.permitKey, e.taxpayerNumber]));
}

/**
 * The crosswalk the resolver actually runs with in production: empty, per the negative
 * finding above. A fixture index (crosswalk.test.ts, resolver.test.ts) proves the `resolved`
 * code path exists without claiming a live match.
 */
export const LIVE_CROSSWALK: CrosswalkIndex = buildCrosswalkIndex([]);
