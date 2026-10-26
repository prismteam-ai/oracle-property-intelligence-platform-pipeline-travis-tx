---
id: CR-A-02
type: code-review-log
story: A-02
branch: 002-data-contract
reviewed_commit: cb1e32a (run 1); fixes in fa190b0, clean pilot re-run in f3ddcbe
tools: [/code-review, soofi-xyz-team-kit:oracle, soofi-xyz-team-kit:donphan]
created: 2026-10-21
---

# Code Review Log: A-02 Freeze the property-intelligence data contract

Scope: `git diff feature/oracle-pipeline...HEAD`. Reviewers:
- `/code-review` (medium effort; findings not verified by the tool).
- The kit reviewer agents `soofi-xyz-team-kit:oracle` and `soofi-xyz-team-kit:donphan`, both read-only (constitution XVI, pass mark 75/100).

## Runs

| Run | Tool | Effort | Date | Commit | Findings | Score |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `/code-review` | medium | 2026-10-21 | `cb1e32a` | 10 | n/a |
| 1 | `soofi-xyz-team-kit:oracle` (read-only) | n/a | 2026-10-21 | `cb1e32a` | 10 (2 Major, 8 Minor) | **80 / 100** (pass) |
| 1 | `soofi-xyz-team-kit:donphan` (read-only) | n/a | 2026-10-21 | `cb1e32a` | 10 (5 Major, 5 Minor) | **76 / 100** (pass) |

The PO approved the fix/defer split at D-9 (2026-10-21): "Approve split (Recommended)". Rule: fix anything that touches names, provenance, missing-data reasons or correctness; defer the rest with a target story.

## Findings

CR-n = `/code-review` · OR-n = oracle reviewer · DP-n = donphan reviewer.

| # | Severity | File:line | Finding | Resolution | Commit |
| --- | --- | --- | --- | --- | --- |
| OR-F1 | Major | `pipeline/oracle-runtime/travis/transforms/tcad-county.ts:228` | Roof dates derived from Austin permits were published with TCAD provenance, and the estimator's confidence and caveat were lost | Fixed: `structure.roof_date` is written only for TCAD-field anchors; the permit-anchored age comes from published permit rows in the view; a test compares the view with the estimator ledger | `fa190b0` |
| OR-F2 | Major | `tcad-county.ts:257` | `sales[].confidentialSale` was ignored; unknown `confid*` keys were accepted silently | Fixed: suppress the owner on `confidentialSale` and fail closed on unmodelled `confid*` keys (P0-15; PO decision "Yes, hide owner") | `fa190b0` |
| DP-1 | Major | `tcad-county.ts:234`, `views.sql:178` | Missing owners all got `no_owner_record`, hiding the real cause | Fixed: separate reasons `no_dated_sale`, `owner_unparsed`, `owner_confidential`, `no_owner_record`, each counted in manifest coverage. **Deferred** to A-04: linking owners without a dated sale | `fa190b0` |
| DP-2 | Major | `rules.json:103`, `derive.ts:217`, `views.sql:275` | "Empty status = stalled" applied to every jurisdiction; wrong reason `no_lexicon_carrier` | Fixed: the rule applies to `austin` only (others → `needs_review`); new reason `enum_lacks_value` | `fa190b0` |
| DP-3 | Major | `contract/v1/pilot-manifest.json` | AD-24 five-state contractor totals were missing from coverage | Fixed: `contractor_{resolved,candidate,ambiguous,conflicting,unresolved}` added (derivation `aggregate_match`), with a test | `fa190b0` |
| DP-4 | Major | `views.sql:192`, `bind-manifest.ts:207` | Contractor path tested only on empty stubs; `min(to_cid)` silently picked one contractor | Fixed: more than one edge → `unresolved` plus `needs_review`, never a pick, with an in-memory fixture test. **Deferred** to A-07: a real export fixture with a contractor edge | `fa190b0` |
| DP-5 | Major | `contract/v1/README.md` | Travis location path differs from the kit MCP bbox recipe | Fixed: README documents property_has_parcel → parcel_has_geometry, no situs/ZIP/mailing, no tax; A-15 tool spec to follow | `fa190b0` |
| CR-1 | High | `packages/query-core/views.sql:209` | `status_class` could be NULL with no `missing` entry | Fixed: `missing {status_class, needs_review}` whenever it can't be derived | `fa190b0` |
| CR-2 | Medium | `views.sql:61` | person × company cross join repeated owner names | Fixed: persons and companies are aggregated separately; 2 + 2 test | `fa190b0` |
| CR-3 | Medium | `views.sql:227` | `v_roofing_permit` did not deduplicate permits or edges | Fixed: one row per permit cid and per edge (QUALIFY); duplicate-part test | `fa190b0` |
| CR-4 | Medium | `profiles/travis-austin@1.0.0/index.ts:267` | A missing permittype counts as a trade permit | **Deferred** to A-06: it changes classification and needs profile 1.0.1, a re-measure and a new review. In the pilot, all 50 captured permits have a permittype | — |
| CR-5 | Medium | `pipeline/publish/src/manifest.ts:186` | `localeCompare` sort could change the manifest CID across machines | Fixed: code-unit order; test with '/' vs '_' names | `fa190b0` |
| CR-6 | Low | `views.sql:185, 291, 359` | False `missing source_url` when the fallback URL is used | Fixed: entry removed; fallback documented in the README | `fa190b0` |
| CR-7 | Low | `views.sql:21` | lat and lon could come from different geometry rows | Fixed: both are taken from one geometry row; test | `fa190b0` |
| CR-8 | Low | `packages/query-core/src/bind-manifest.ts:139` | `area_list_sha256` fell back to the bundled gazetteer digest | Fixed: `travis-places@1.0.0` is in manifest `profiles[]`; the binder throws if it's absent (= OR-F5) | `fa190b0` |
| CR-9 | Low | `pipeline/publish/src/jcs.ts:5` | A second RFC 8785 implementation exists | **Deferred** to A-03: one shared canonicalizer in `@countylens/contract` | — |
| CR-10 | Low | `pipeline/publish/src/manifest.ts:178` | Each Parquet part is read twice | **Deferred** to A-03: one streaming pass for CID and SHA-256 (matters at 1 GB parts) | — |
| OR-F3 | Minor | `tcad-county.ts:267` | Ownership is inferred from the latest dated sale | Accepted as a documented assumption (README, ADR-0002); **deferred** to A-04 for a mismatch test | `fa190b0` |
| OR-F4 | Minor | `views.sql:76` | `captured_at` is source-level, not per permit | Accepted: documented in the README as the source-level capture time | `fa190b0` |
| OR-F5 | Minor | `bind-manifest.ts:136` | The binder didn't check the profile digest against the manifest | Fixed: it throws on a mismatch (with CR-8) | `fa190b0` |
| OR-F6 / DP-m6 | Minor | `views.sql:238` | Hard-coded `'Cancelled'` filter in SQL | Fixed: removed; exclude permits are never emitted (test kept) | `fa190b0` |
| OR-F7 | Minor | `shared-seed.ts:126` | Deprecated `property_type` values are still written | **Deferred** to A-04 (full TCAD transform): map to the current enum before A-03/A-04 publishes | — |
| OR-F8 | Minor | `rules.json` `stalled_rule` | Expired depends on a convention | Accepted (PO D-4a); stated plainly in the README for raw-table consumers; R1/R2 lead the drafted requests | `fa190b0` |
| OR-F9 | Minor | `run-pilot.ts:400`, `sequence.ts:216` | Dirty-tree gitCommit; naive hash.csv split; hard-coded deltas | Fixed: dirty-tree limitation line and a real CSV parse. **Deferred** to A-12: derive deltas once `previousManifestCid` is set | `fa190b0` |
| OR-F10 | Minor | ARD AD-25 vs ADR-0002 | AD-25 says requests are "filed"; D-1/D-8 say draft only | Recorded in ARD § 13 as deviation D-08 (ARD 0.2.2) | `aef8951` |
| DP-m7 | Minor | `derive.ts:130` | `status_class` silently empty | Fixed with CR-1 | `fa190b0` |
| DP-m8 | Minor | `bind-manifest.ts` | `area_list_sha256` fallback | Fixed with CR-8 | `fa190b0` |
| DP-m9 | Minor | `contract/v1/README.md` | The pilot is skewed to open permits | Fixed: README says it is a schema contract, not a distribution | `fa190b0` |
| DP-m10 | Minor | ADR-0002 | `permit_close_date` / `final_inspection_date` always empty | Fixed: ADR records whether Austin carries them | `fa190b0` |

## Constitution and architecture check

| Rule | Result | Note |
| --- | --- | --- |
| Zod on every input; no `any` | ✅ | Socrata, TCAD, Census, lexicon manifest, profile, gazetteer and manifest inputs |
| LLM calls only through the Vercel AI SDK | n/a | No LLM in A-02 |
| Powertools logger, tracer and metrics in every Lambda | n/a | No Lambda in A-02 |
| No secrets or PII in code or logs | ✅ | Confidential owners suppressed before validate (fail closed) |
| P0 rules in `docs/architecture-constitution.md` | ✅ | No upload, no Query DB, CIDv1, no text classification in views (grep gate), one Parquet in git (D-07) |

**Open Critical findings:** 0.
