// A-07 T018 (Track A): five-state totals per contracts/report.md's `contractor_five_state_
// totals` manifest-coverage metric (FR-003, SC-001). Pure aggregation over a batch of ledger
// rows (the resolver's output, T014); no DB access here. The five-state sum is required to
// equal the permit total exactly — the caller (the resolution run, T020) hands one ledger row
// per permit, so an empty or partial batch is the caller's concern, not this function's.
import type { LedgerRow, ResolverState } from "./resolver.js";

export const FIVE_STATES: readonly ResolverState[] = [
  "resolved",
  "candidate",
  "ambiguous",
  "conflicting",
  "unresolved",
];

export type FiveStateTotals = Record<ResolverState, number>;

export interface ManifestCoverageContribution<T> {
  metric: string;
  value: T;
  derivation: "published_rows" | "capture_receipt" | "aggregate_match";
  limitation: string | null;
}

function emptyTotals(): FiveStateTotals {
  return { resolved: 0, candidate: 0, ambiguous: 0, conflicting: 0, unresolved: 0 };
}

export function computeFiveStateTotals(
  rows: readonly LedgerRow[],
): ManifestCoverageContribution<FiveStateTotals> {
  const value = emptyTotals();
  for (const row of rows) value[row.state] += 1;
  return {
    metric: "contractor_five_state_totals",
    value,
    derivation: "aggregate_match",
    limitation: null,
  };
}
