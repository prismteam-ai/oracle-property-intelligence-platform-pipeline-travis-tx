// A-07 T022 (Track A, NFR-001): the 25-row contractor sampler and evidence skeleton. Pure
// functions over a batch of ledger rows (T020's resolution run output); no DB access here.
// The sample must (a) record the random seed used, so a reviewer can reproduce it, and
// (b) guarantee every *non-empty* ledger state is represented -- an expected-empty state
// (this run: `resolved`, per D-10) is simply absent, not an error.
import type { LedgerRow, RegistryRecord, ResolverState } from "./resolver.js";

export interface SampleOptions {
  seed: number;
  /** Default 25 (NFR-001). */
  size?: number;
}

export interface SampleResult {
  sample: LedgerRow[];
  seed: number;
}

const STATE_ORDER: readonly ResolverState[] = [
  "resolved",
  "candidate",
  "ambiguous",
  "conflicting",
  "unresolved",
];

/** A small deterministic PRNG (mulberry32): same seed -> same sequence, every run, every machine. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return (): number => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Samples up to `size` ledger rows: first one row from each non-empty state (coverage
 * guarantee), then fills the remainder uniformly at random from the whole ledger, never
 * repeating a `permitKey`. Fewer than `size` rows available is not an error -- the sample is
 * simply as large as the ledger allows.
 */
export function sampleContractorLedger(
  rows: readonly LedgerRow[],
  options: SampleOptions,
): SampleResult {
  const size = options.size ?? 25;
  const rnd = mulberry32(options.seed);
  const byState = new Map<ResolverState, LedgerRow[]>();
  for (const r of rows) {
    const bucket = byState.get(r.state);
    if (bucket) bucket.push(r);
    else byState.set(r.state, [r]);
  }

  const picked: LedgerRow[] = [];
  const pickedKeys = new Set<string>();
  const pickOneFrom = (candidates: readonly LedgerRow[]): LedgerRow | undefined => {
    const available = candidates.filter((c) => !pickedKeys.has(c.permitKey));
    if (available.length === 0) return undefined;
    return available[Math.floor(rnd() * available.length)];
  };
  const take = (row: LedgerRow): void => {
    picked.push(row);
    pickedKeys.add(row.permitKey);
  };

  for (const state of STATE_ORDER) {
    const bucket = byState.get(state);
    if (bucket === undefined || bucket.length === 0) continue;
    const chosen = pickOneFrom(bucket);
    if (chosen !== undefined) take(chosen);
  }
  while (picked.length < size) {
    const chosen = pickOneFrom(rows);
    if (chosen === undefined) break;
    take(chosen);
  }

  return { sample: picked.slice(0, size), seed: options.seed };
}

/** One row of the human-reviewed 25-row table (D-14's review round). */
export interface EvidenceSkeletonRow {
  permitKey: string;
  printedName: string | null;
  state: ResolverState;
  reasonCode: string | null;
  matchedCompanies: Array<{
    taxpayerNumber: string;
    legalName: string;
    sosStatusCode: string;
    sourceUrl: string;
  }>;
  /** Filled in by the builder during review; left blank for the human reviewer to complete. */
  verdict: string;
  /** True only for a row the builder is not confident calling (surfaced for the review round). */
  unsure: boolean;
}

/** The per-entity GET the matched company record cites (never the bulk dataset landing page). */
export const comptrollerRecordUrl = (taxpayerNumber: string): string =>
  `https://data.texas.gov/resource/9cir-efmm.json?taxpayer_number=${encodeURIComponent(taxpayerNumber)}`;

/**
 * Builds one evidence-skeleton row from a ledger row plus the registry records it names
 * (looked up by the caller, which holds the live registry; this function stays DB-free).
 */
export function buildEvidenceSkeletonRow(
  row: LedgerRow,
  registryByTaxpayerNumber: ReadonlyMap<string, RegistryRecord>,
): EvidenceSkeletonRow {
  const matchedCompanies = row.matchedRecordIds.map((id) => {
    const r = registryByTaxpayerNumber.get(id);
    return {
      taxpayerNumber: id,
      legalName: r?.legalName ?? "(not found in the loaded registry)",
      sosStatusCode: r?.sosStatusCode ?? "unknown",
      sourceUrl: comptrollerRecordUrl(id),
    };
  });
  return {
    permitKey: row.permitKey,
    printedName: row.rawContractorName,
    state: row.state,
    reasonCode: row.reasonCode,
    matchedCompanies,
    verdict: "",
    unsure: false,
  };
}

export function buildEvidenceSkeleton(
  sample: readonly LedgerRow[],
  registryByTaxpayerNumber: ReadonlyMap<string, RegistryRecord>,
): EvidenceSkeletonRow[] {
  return sample.map((row) => buildEvidenceSkeletonRow(row, registryByTaxpayerNumber));
}
