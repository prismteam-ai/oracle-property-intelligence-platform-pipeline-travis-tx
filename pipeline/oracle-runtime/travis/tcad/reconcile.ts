// A-04 T026 (AC-2, FR-002, NFR-001): the roll reconciliation. Every export record of the run
// is one of loaded / dead / invalid / transform_failure; their sum is the seed count (N for the
// full roll, the seed rows for the pilot). Confidential accounts are loaded and counted, never
// subtracted (D-7, disagreement #3). loaded = N − dead − invalid − transform_failure; the gate
// (TC-005) is difference < 2 % of N with 0 unexplained.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ChunkSummary, DeadRecord } from "./process.js";
import type { PropType } from "./account-class.js";

export interface Reconciliation {
  n: number;
  loaded: number;
  dead: number;
  invalid: number;
  transform_failure: number;
  difference: number;
  difference_pct: number;
  /** Differences with no class; always 0 when the invariant holds. */
  unexplained: number;
  redacted: number;
  by_prop_type: Partial<Record<PropType, number>>;
  within_gate: boolean;
}

/** Fraction of N the difference must stay below (TC-005: 2 % of 493,246 → < 9,865). */
export const MAX_DIFFERENCE_FRACTION = 0.02;

export function sumSummaries(parts: readonly ChunkSummary[]): ChunkSummary {
  const out: ChunkSummary = {
    records: 0,
    loaded: 0,
    dead: 0,
    invalid: 0,
    transform_failure: 0,
    redacted: 0,
    by_prop_type: {},
  };
  for (const p of parts) {
    out.records += p.records;
    out.loaded += p.loaded;
    out.dead += p.dead;
    out.invalid += p.invalid;
    out.transform_failure += p.transform_failure;
    out.redacted += p.redacted;
    for (const [t, n] of Object.entries(p.by_prop_type) as Array<[PropType, number]>) {
      out.by_prop_type[t] = (out.by_prop_type[t] ?? 0) + n;
    }
  }
  return out;
}

/** Throws unless seed = loaded + dead + invalid + transform_failure. */
export function reconcile(seed: number, parts: readonly ChunkSummary[]): Reconciliation {
  const s = sumSummaries(parts);
  const classified = s.loaded + s.dead + s.invalid + s.transform_failure;
  if (classified !== seed || s.records !== seed) {
    throw new Error(
      `roll does not reconcile: seed ${seed}, classified ${classified}, records ${s.records}`,
    );
  }
  const difference = seed - s.loaded;
  return {
    n: seed,
    loaded: s.loaded,
    dead: s.dead,
    invalid: s.invalid,
    transform_failure: s.transform_failure,
    difference,
    difference_pct: seed === 0 ? 0 : Math.round((difference / seed) * 100_000) / 1000,
    unexplained: 0,
    redacted: s.redacted,
    by_prop_type: s.by_prop_type,
    within_gate: difference < seed * MAX_DIFFERENCE_FRACTION,
  };
}

/** Keeps every dead record (ordinal, digest, size, why) in runs/<jobId>/dead.json. */
export function writeDeadRecords(runDir: string, dead: readonly DeadRecord[]): string {
  mkdirSync(runDir, { recursive: true });
  const path = join(runDir, "dead.json");
  writeFileSync(
    path,
    `${JSON.stringify(
      [...dead].sort((a, b) => a.ordinal - b.ordinal),
      null,
      2,
    )}\n`,
  );
  return path;
}
