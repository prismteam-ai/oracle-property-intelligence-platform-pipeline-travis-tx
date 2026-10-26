---
id: ERR-73
type: defect
feature: FEAT-A11
story: A-11
test_case: pipeline/local-stack test/contractor-coverage.test.ts; pipeline/publish test/run-manifest.test.ts ("a correction run can drop carried notes by prefix and replace a source's limitations")
ac_reference: A-11, A-07 AC-7
severity: Low
status: Closed - published in Run 3.1 (travis-full-run3-1-20261025)
found_by: Task A investigation of Task B's Run 3 question 4, for HebaGaber
found_date: 2026-10-26
fix_branch: 011e-run3-1-permit-contractors
fix_commit: pending
retest_date: 2026-10-26
closed_date: 2026-10-26 (Run 3.1 published)
---

# ERR-73: The Run 3 manifest says the Comptroller registry is not loaded

## Brief description

The Run 3 manifest's contractor coverage says "Comptroller registry not wired for this run (NO_REGISTRY default)" and every published permit is `unresolved` / `registry_unavailable`; the Austin source carries the fixed note "Comptroller baseline not loaded (A-07)". In fact A-07 loaded the registry into the Query DB on 2026-10-22 (342,333 rows, job `travis-a07-identity-registry-20261022184652`). The permit export simply never passed it to the resolver, and the manifest builder always wrote the fixed note.

## Impact

Counts and notes only. No published row changes: the per-permit resolution is not published (AD-24), and `contractor_resolution` is `resolved` only when the company carries a registry id, which a printed name never gets.

## Fix

- `pipeline/local-stack/scripts/contractor-coverage.ts` (new, read-only): reads the built Property Improvement group, matches each published contractor name with A-07's resolver (unchanged) against the loaded registry, and writes the five-state totals (`specs/011-publish-and-runs/run3-1/contractor-coverage.json`).
- `pipeline/publish`: a run may state `registryNote` (replaces the fixed "baseline not loaded" note), `sourceLimitations` (replaces a carried source's notes) and `dropLimitationPrefixes` (drops carried run notes the correction note restates).

## Result (Run 3.1, 15,025 published permits)

resolved 0 · candidate 130 · ambiguous 0 · conflicting 112 · unresolved 14,783 (10,473 print no contractor, 4,310 permits whose published name matches no registry legal name). Sum 15,025. `conflicting` follows the resolver: the name matches registry legal names and none of them is active.

**Not reconciled (follow-up, A-16):** the Run 3 coverage review (`docs/reviews/run3-coverage-task-a.md`) reported 375 permits matching a Comptroller name by an exact normalised-name query, and A-07's ledger 311 candidate + 78 conflicting over all 22,084 reroof permits in the Query DB. Run 3.1 counts 242 (130 + 112) over the 15,025 published permits and their published names. The populations differ (Query DB vs published permits; company names only vs company-else-person), and the review's query method is not recorded, so the gap is unexplained. Run-level counts only; no row changes.
