// A-07 T013 (Track A): five-state totals / manifest-contribution test (contracts/report.md,
// FR-003). Must fail before T018 (travis/identity/totals.ts) lands — T018 is a later wave
// (W2), deliberately out of scope for this builder pass, so this test is expected to stay red
// until then (module not found is an acceptable "fails first" signal here).
import { describe, expect, it } from "vitest";
import { computeFiveStateTotals } from "../../../../travis/identity/totals.js";
import type { LedgerRow } from "../../../../travis/identity/resolver.js";

const DIGEST = "c".repeat(64);
const EFFECTIVE_ON = "2026-10-22T00:00:00.000Z";

function row(state: LedgerRow["state"], permitKey: string): LedgerRow {
  return {
    permitKey,
    rawContractorName: state === "unresolved" ? null : "Some Company",
    state,
    reasonCode: state === "unresolved" ? "contractor_not_printed" : null,
    matchedRecordIds: state === "unresolved" ? [] : ["32000000000"],
    matchRule: "normalize-name-v1",
    resolverVersion: "1.0.0",
    registrySnapshotDigest: DIGEST,
    effectiveOn: EFFECTIVE_ON,
  };
}

describe("computeFiveStateTotals (SC-001, FR-003)", () => {
  it("sums every state exactly to the permit total and derives aggregate_match", () => {
    const rows: LedgerRow[] = [
      row("resolved", "p1"),
      row("candidate", "p2"),
      row("candidate", "p3"),
      row("ambiguous", "p4"),
      row("conflicting", "p5"),
      row("unresolved", "p6"),
      row("unresolved", "p7"),
    ];
    const result = computeFiveStateTotals(rows);
    expect(result.derivation).toBe("aggregate_match");
    expect(result.limitation).toBeNull();
    const sum = (Object.values(result.value) as number[]).reduce((a, b) => a + b, 0);
    expect(sum).toBe(rows.length);
    expect(result.value).toEqual({
      resolved: 1,
      candidate: 2,
      ambiguous: 1,
      conflicting: 1,
      unresolved: 2,
    });
    expect(result.metric).toBe("contractor_five_state_totals");
  });

  it("an empty permit set still sums to 0 across all five states (never a missing key)", () => {
    const result = computeFiveStateTotals([]);
    expect(result.value).toEqual({
      resolved: 0,
      candidate: 0,
      ambiguous: 0,
      conflicting: 0,
      unresolved: 0,
    });
  });
});
