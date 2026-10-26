# CR-A-11-porygon-fix: Run 2 correction manifest counts and coverage

Reviewer: Porygon. Read-only review. Scope: `runs/travis-full-run2-20261024/manifest.json` vs Run 1, `pipeline/publish/src/run-manifest.ts`, `manifest.ts`, `identity-gate.ts`, commit `0cd4fe5`, `publish-run2-dryrun.log`.

**Score: 80/100 (pass bar 75). No blocking finding.**

## Findings (by severity)

1. **Medium: a stale, false limitation ships in Run 2's manifest.** `runs/travis-full-run2-20261024/manifest.json` `limitations[1]` reads "property_improvement published scope is roofing-classified, decided-status permits only (17387 rows), not all 2007514 linked permits". Run 2 publishes 15,025. Cause: `run-manifest.ts:221` copies every base limitation except the "DRAFT" one, so Run 1's row-count text travels unchanged. The same manifest also says "15,025" in `permits_emitted` and in the correction note, so a reader sees two different published counts in one document. Because the manifest is immutable once its CID is published, this must be fixed before the real publish (it is not yet in `runs/index.json`). Fix: rewrite or drop count-bearing base limitations (or derive them from `emitted.total`), and add a test that no carried limitation contains the base's `permits_emitted` count.
2. **Low: the Run 1 card on the Runs page is unchanged.** `apps/web/src/routes/Runs.tsx:45` shows only `permits_emitted` and `permits_no_tcad_geoid`. Run 1 will keep showing "17,387 permits" with no sign that its permits never joined and that 2,362 of them were trade sub-permits. `runs/index.json` has no "superseded" marker, and Run 2's `limitations` and `previousManifestCid` are not shown on the page. Scenario: a viewer compares Run 1 (17,387) with Run 2 (15,025) and reads it as a loss of 2,362 permits. Mitigation: show the correction note, or a superseded flag, on the card. Run 2's own card is accurate.
3. **Low: `permits_trade_sub_permit` is a count of rows that are in no table.** Its derivation is `aggregate_match`. The count 2,362 comes from `reexport-permits --compare-run` against Run 1, not from published rows. The note says so ("counted by reexport-permits --compare-run"), which is honest. Nothing in the code checks it: the `coverageOverrides` path in `run-manifest.ts:170-194` accepts any number.
4. **Low: `permits_no_tcad_geoid` note is wrong.** The note says "all captured Austin permits", but 275,764 is only the no-geoid bucket (see the reconciliation below). Carried unchanged from Run 1.
5. **Info: `noteSuffix` keeps "(PO 2026-10-23)".** The correct reference for the roofing-only rule is the 2026-10-24 decision. Harmless.

## What reconciles (verified)

- **Permit totals:** 15,025 + 2,362 = 17,387. The trade breakdown 940 + 807 + 615 = 2,362 matches the run-log entry.
- **Per-batch sums:**
  - Run 2: 2764 + 2488 + 2730 + 3484 + 3559 = 15,025.
  - Run 1: 7834 + 9553 = 17,387.
  - `run-manifest.ts:104-121` recomputes the total from the export summaries.
  - `manifest.ts:468-473` checks it against the published rows.
- **Contractor states:** `contractor_unresolved` is 15,025, resolved and candidate are 0, and the note text uses 15025. The override fired correctly, because `run-manifest.ts:171-181` refuses stale keys when the count changes.
- **Carried link-exclusion keys are still valid.** They count Austin permits that never reached a TCAD property, and Run 2 did not recapture. The five keys sum to 275,764 + 31,824 + 29,475 + 89 + 36,560 = 373,712. Adding the 2,007,514 linked permits gives 2,381,226, which equals the Austin `records` figure in the source block. The five keys therefore reconcile exactly with captured totals. This closes A-16 item #6 arithmetically, but only by my inference. No code asserts it, so I recommend a manifest-level check of linked + unlinked = source records.
- **Sources:** `delta` is 0/0/0, and watermark, records and captured_at are identical to Run 1 (enforced at `run-manifest.ts:229-242`).
- **Artifacts:** 15 CARs = 10 county + 5 permits, and 225 table parts. The county batches are skipped in the dry run because they are already served.
- **Identity gate** (`identity-gate.ts:101-138`): the dry-run log shows PASS with v_roofing_permit = meta.permit = permits_emitted = 15,025 and 0 of 10,792 unmatched. It uses NOT EXISTS (null-safe), requires `meta.permit` to be non-empty, and compares against `permits_emitted`. It cannot pass if the roofing-only rule fails, because trade rows would give a count mismatch, as the pilot showed.

## Still un-reconciled

- About 1,990,127 linked permits (2,007,514 − 15,025 − 2,362) are non-roofing or undecided. They have no coverage key.
- The 2,362 cannot be recomputed from the published data alone. It is trusted from the compare-run.
