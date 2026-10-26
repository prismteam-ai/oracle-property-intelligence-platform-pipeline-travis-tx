# CR-A-11 — donphan review (published-data / coverage view)

**Scope**: Run 1 dry run exported tables only — `elephant-cli export-tables` JSON per batch, cross-checked against `docs/evidence/A-04.md` and `A-07.md`'s stated denominators (county 493,246; permits linked 2,007,514/2,381,226; roofing 19,031/linked 16,816). No manifest exists yet (steps 5-6 were intentionally skipped for this dry run), so AC-4's `coverage` section (`published_rows` + `capture_receipt` + `derivation`) is **not yet produced or testable** — that proof is still ahead of G7, not reviewed here.

## Re-review (2026-10-23, after commit 4254044): Score 88/100

Checked against `specs/011-publish-and-runs/run-log.md`'s 14:46 entry, `pipeline/publish/src/manifest.ts`'s `GROUP_COVERAGE_KEYS`, and `pipeline/local-stack/scripts/run-permits-full.ts`'s logging — code, not just claims.

- **Finding 2 (coverage-key gap) resolved in code.** `GROUP_COVERAGE_KEYS['property_improvement']` (manifest.ts:60-81) now lists all 5 of `travis/permits/link.ts`'s `UnmatchedReason`s (`permits_no_tcad_geoid`, `permits_no_tcad_id`, `permits_ambiguous_geoid`, `permits_address_unmatched`, `permits_ambiguous_address`), each `aggregate_match`, plus `permits_emitted` and the 3 contractor-coverage buckets. Previously only 1 of 5 was labeled. `run-month.ts` is confirmed to supply all 4 added keys (3 as genuine zero-counts with a documented reason for that one-month flow).
- **Finding 1 (mislabeled counter) resolved in code**, and the PO's roofing-only scope decision supersedes my original "risks a confusing mismatch" framing — that denominator gap is now a settled, intended business rule, not a defect. `run-permits-full.ts` lines 54-60 and 70 now log `linked_db_rows_read=<N>` and `permits_written=<N>` as two distinct, clearly-named values (previously conflated under one `permits=` label). `plan.md`'s scale estimate was corrected to ~2.3GB total to match.
- **Finding 3 (county R-only scope) confirmed as already real**, not newly fixed: `GROUP_COVERAGE_KEYS.county = []` plus `tcad-backbone.ts`'s own `out_of_scope` tally is an enforced code path, not just a comment — my original concern that this was undocumented is addressed by the existing mechanism, which this re-review re-verified rather than took on faith.
- Nothing new looks wrong in the diffed sections. Remaining gap (not a regression, carried over from the original review): the real manifest for county/property_improvement at full batch scale, with `coverage.derivation` text rendering these keys in plain language, still hasn't been produced and reviewed end-to-end — that's test coverage ahead of G7, not a code defect, so it caps the score below 90 rather than failing it.

**New score: 88/100** (bar is 75; both original findings resolved).

## Original score: 68/100

## What I checked

Summed `tables.*.rows` across all batch `-export.json` files:

- **County** (`travis-a04-.../county-batched/tables/b01..b10-export.json`): `property`/`parcel`/`properties` = **441,961**; `address` 465,512; `structure` 441,961; `sales_history` 266,317; `company` 22,741; `person` 815; `geometry` 390,061.
- **Permits** (`travis-a11-permits-full-.../permits-batched/tables/b01-02-export.json`): `property`/`properties` = **10,867**; `property_improvement` = **17,387**; `property_has_property_improvement` = 17,387. Cross-checked against `permits-full-run.log`: `groups=10867 empty=227268 permits=2007514` — the 10,867/17,387 figures are internally consistent with that run's own totals (10,867+227,268=238,135 distinct linked pIDs, matching A-04's `pids_seen`), so nothing here is a code bug or silent truncation.

## Findings

1. **County export covers only the Real-property (R) subtype, not the full 493,246-parcel roll.** 441,961 = exactly A-04's `R` component (`493,246 = R 441,961 + P 39,536 + MH 11,744 + MN 5`). Personal, Mobile-Home and Mineral parcels (51,285 total, 10.4% of the roll) are absent from `groups/county/` and therefore from every exported table. The run-log is honest about this ("county group is R-only"), but `run-log.md`'s "**Run 1 dry run COMPLETE, both groups**" line doesn't carry that caveat forward, and nothing in `spec.md`/the story currently requires the eventual manifest's `coverage` section to say "R-only, P/MH/MN not yet captured." Without an explicit `derivation` note at manifest time, a consumer would read `published_rows.property = 441,961` next to A-04's "493,246 parcels" headline and reasonably conclude 51,285 records are simply missing/broken, not out of scope by design.

2. **`property_improvement`'s published scope is "roofing-classified, decided-status permits only," not "linked permits."** 17,387 emitted rows is in the right range for the *roofing* universe (19,031 roofing-verdict permits, 16,816 linked per A-04 line 258) — the transform (`austin-property-improvement.ts`) deliberately skips `status_exclude`/`needs_review`/`roofing_needs_review` permits, counting but never emitting them. That's correct, intentional behavior, confirmed by the transform's own `SkipReason` logic. But it is two orders of magnitude below the headline denominators the story/evidence repeatedly cite (2,007,514 linked / 2,381,226 captured). If AC-4's `capture_receipt` field is populated with the all-permits Austin total (2,381,226 or 2,007,514) next to a `published_rows.property_improvement` of ~17K with no roofing-scope `derivation` label, that reads as a massive, unexplained shortfall rather than correct-by-design filtering. This is the single highest-risk item for G7: the manifest coverage section's `derivation` text for this table needs to say explicitly "roofing-classified permits with a decided status only" and cite the 19,031/16,816 figures, not the all-permits ones.

3. **No manifest/coverage artifact exists yet to verify against AC-4.** The dry run stopped at `export-tables`; `published_rows`, `capture_receipt`, and `aggregate_match` derivation labels (FR-004, AC-4) have not been built or tested at full scale. This review can confirm the raw table row counts are internally consistent with the dry run's own logs, but cannot yet confirm the manifest will state their derivation honestly — that's the real remaining risk, not a defect found today.

4. **Minor/low-priority**: both export JSONs list `properties` and `property` as separate tables with identical row counts in every batch. Likely an elephant-cli naming artifact (plural index vs. entity table), not a defect, but worth a one-line confirmation from `oracle` that this isn't an accidental duplicate table before publish.

## Not flagged (checked, found consistent)

- Permits batching arithmetic (10,867 groups / 17,387 property_improvement rows / 227,268 empty) matches `permits-full-run.log`'s own totals exactly — no silent data loss between the full run and the batched dry-run export.
- Contractor fields correctly absent from `property_improvement` records (AD-24 rollup-only design, T031) — no contractor scalar field leaked into the published shape.

## Recommendation before G7

Do not treat the dry run's row counts as the coverage proof. Before merge, build the real manifest for at least one batch and confirm its `coverage.derivation` text calls out both gaps above (R-only county scope this run; roofing-only permit scope) in plain language, each citing the correct A-04/A-07 denominator it is a subset of — not the all-permits/all-parcel headline figures.
