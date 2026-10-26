---
id: QC-RPT-A-02
type: test-execution-report
feature: FEAT-A02
story: A-02
test_cases: testplans/A-02-test-cases.md
runtime_url: "N/A: Project story, no hosted runtime until A-03"
build: f3ddcbe
data_snapshot: "bafkreibkonskeytl2lqmaoethxvhegzjkwbeon4couanb4x26ng23cs3ka (local pilot manifest contract/v1/pilot-manifest.json, unpublished; recomputed with pipeline/publish/src/cid.ts cidOfFile)"
owner: HebaGaber             # QC Lead
status: Signed Off              # Draft → Complete → Signed Off
gate: G7
created: 2026-10-21
signed_off_date: 2026-10-21
---

# QC Test Report: A-02 Freeze the property-intelligence data contract

Every case in `testplans/A-02-test-cases.md` (v0.2.1, 33 cases: TC-001 to TC-030 and TC-NF-01 to NF-03) was run from the repository root on branch `002-data-contract` (step 0 `git branch --show-current` → `002-data-contract` for every case), at build `f3ddcbe`, with `PILOT_DIR=pipeline/data/pilot/travis-pilot-20261020` set. No code, test, spec or test-plan file was changed.

**How each case was run.** Every case was first run as `pnpm vitest run -t "A-02-TC-0nn"`. Only 13 cases have a test with that title (TC-008, 009, 010, 011, 018, 024, 025, 026, 027, 028 (2 tests), 030, NF-03), all in `packages/query-core/test/acceptance/a02.acceptance.test.ts`; each gave `1 passed` (TC-028: `2 passed`). For the other 20 cases `-t` matched nothing (`379 skipped`). For those, the evidence column names the test that covers the case (`file › title`), which ran in the full verbose run `PILOT_DIR=… pnpm vitest run --reporter=verbose` (24 files, **379 passed**, 0 failed), plus the case's own manual steps (grep, `duckdb` v1.5.6 at `/opt/homebrew/bin/duckdb`, `cat`, and short `pnpm exec tsx` calls to the repo's own functions). TC-029 also ran in the runtime package: `cd pipeline/oracle-runtime && npx vitest run test/pilot/capture-austin.test.ts -t "403"` gave 1 passed.

**Live measure and sample were not re-run.** As instructed, `pnpm --filter ./profiles/travis-austin@1.0.0 measure` (TC-019) and `… sample` (TC-012 / NF-01) were **not** run again, so this QC run made no Austin or Census requests. Their Stage 5 outputs are the evidence: `profiles/travis-austin@1.0.0/expectations.json` (measured 2026-10-20T21:33Z, committed in `0421ac2`) and `docs/evidence/A-02-classifier-review.md` (captured 2026-10-20T21:34Z, PO review D-7).

## Summary

| Item | Value |
| --- | --- |
| Environment | N/A: Project story, no hosted runtime until A-03 · terminal at repo root on `002-data-contract`, macOS, Node 22.23.3, Vitest 5.0.5, DuckDB CLI 1.5.6 · build `f3ddcbe` · 2026-10-21 |
| Total TC executed | 33 (30 functional + 3 NFR) |
| Passed / failed / blocked | **33 / 0 / 0** (run 1: 32 / 1 / 0; TC-004 re-tested after ERR-9 fix `c18f125`) |
| Pass rate | **100%** (33 of 33) |
| Open Critical defects | **0** (ERR-9 Low, Closed) |
| Unit test report | `docs/reports/A-02-unit-test-report.md` |
| Code review log | `docs/reviews/CR-A-02.md` |
| Playwright run | N/A: Vitest instead of Playwright (G6 C-09 exception) |
| Full suite at run time | root `PILOT_DIR=… pnpm vitest run`: 24 files, 379 passed; `PILOT_DIR=… pnpm vitest packages/query-core`: 12 files, 211 passed |

## Results

"Covering test" means the case has no test under its TC title; the named test was used instead. All named tests passed.

| TC ID | AC | Type | Result | Defect | Evidence |
| --- | --- | --- | --- | --- | --- |
| A-02-TC-001 | AC-1 | Doc / smoke | PASS (see Note 1) | — | Plan grep → `0` (it misses the record's leading `#` column). Same grep allowing `\| n \|` and the verdict column → `9`; rows 1–9 = the 9 fields, verdicts 8 `no_carrier` + 1 `carrier`, no duplicates. Covering test `carriers.test.ts › has exactly the nine AC-1 fields, each with one verdict` ✓ |
| A-02-TC-002 | AC-1 | Integration | PASS | — | Record row 9: `sales_history.ownership_transfer_date`, schema cache `bafkreifxchneb27…gku.json` (file exists, 2,984 B), pilot row `{table: sales_history, cid: baguqeeratr5…bxljh7a}`. `duckdb … WHERE cid = 'baguqeeratr5…bxljh7a'` → 1 row, `1993-12-17`. Covering test `carriers.test.ts › each carrier's pilot row exists in the pilot Parquet with a non-null value` ✓ |
| A-02-TC-003 | AC-1 | Missing data | PASS (see Note 2) | — | `status_raw`: `no_carrier`, fallback "AD-25: Expired published as `improvement_status` null (D-4a); reason `no_lexicon_carrier`", request R1 `property_improvement.permit_status_text`. Status line: "drafted, not filed (PO decision D-1) … D-8 … Not filed". `grep -i filed` → only that line. Contractor state → AD-24 (`resolved`/`unresolved` + five-state totals, R4). All 8 no-carrier rows have a fallback and R1–R6. Covering test `carriers.test.ts › every no-carrier verdict names its fallback (AD-24 or AD-25) and a drafted request` ✓ |
| A-02-TC-004 | AC-1 | Edge | PASS (re-test 2026-10-21, run 1 FAIL) | ERR-9 (Closed) | Re-test: `PILOT_DIR=… pnpm vitest run -t "A-02-TC-004"` → 6 passed (`carrier-emission.test.ts`: ADR carriers present, view-sourced properties present, fixture table without the property → `no_carrier_not_emitted`, `not_in_export` list not stale). Run 1: Pilot half holds: the only carrier (`ownership_transfer_date`) is a column of `county/sales_history` (`carriers.test.ts › each carrier's pilot row exists…` ✓). Fixture half is missing: no test or checker takes a fixture table without the property and returns `no carrier (not emitted by the export)`; `git grep no_carrier_not_emitted` finds only the verdict list in `carriers.test.ts`. Nearest behaviour: `views.shape.test.ts › fails loudly when an emitted table lacks a column the views read` (throws, does not mark the field). The real-data case is handled by hand: ADR-0002 Decision 3 marks `address` fields `no_carrier_not_emitted`, and `columns.test.ts › address-only fields are not v1 columns; each is listed as not_in_export` ✓ |
| A-02-TC-005 | AC-1 | Edge / error | PASS | — | ADR-0002 § Sources: live MCP tools "**Failed** on 2026-10-20 ("Internal error")… Not used". Each of the 9 rows cites `~/.elephant-cli/schema-cache/<cid>.json` (all 4 cited files exist), plus the live lexicon manifest (sha256 `7084b933…0640`) and the pilot export. `grep -iE "memory\|assumed"` → no verdict hit (the only "Assumption" is the owner-linkage rule in #9, not a verdict source) |
| A-02-TC-006 | FR-011 | Integration | PASS (see Note 3) | — | `ls $PILOT_DIR/reports/` lists the 8 files (+ `sequence.json`, `submit_errors.csv`, `transform-counts.json`). Each `*errors.csv` → `1` line. `shasum`: county `6f16dda9…9c3b`, PI `af7caa18…cdf5`; equal to `reports/sequence.json`, **not** to the run-log values `d989414c…639c` / `72715bf7…084b` (pre-D-9 run). `sequence.json`: 8 steps, all `exitCode 0`, `ok: true`, cli `44bb182b`. `grep -E "upload\|--atlas-page"` run-log → nothing; sequence.json → 0. Tables: county `property` 22 rows; PI `property` 22, `property_improvement` 43. `countyRoot` = hash `carRoot` for both groups (`baguqeerarr6…cssytha`, `baguqeeral3h…zaqq`) |
| A-02-TC-007 | FR-011, AC-8 | Integration | PASS | — | `pnpm exec tsx` with `pipeline/publish/src/cid.ts cidOfFile` → `bafkreibkonskeytl2lqmaoethxvhegzjkwbeon4couanb4x26ng23cs3ka` (starts `bafkrei`) = sample `manifest_cid` (duckdb DISTINCT, 1 value) = run log 02:07. `runId travis-pilot-20261020`, `previousManifestCid null`, limitation "pilot: local, unpublished; …". 23 of 23 `table` artifact CIDs re-derive from their Parquet parts, 0 mismatches. Covering tests `sample.test.ts › manifest_cid = the CID recomputed…`, `views.pilot.test.ts › table_cid equals the re-derived raw-leaves CID of its part`, `manifest.test.ts › accepts the pilot shape` ✓ |
| A-02-TC-008 | AC-2 | Smoke | PASS | — | `PILOT_DIR=… pnpm vitest packages/query-core` → 12 files, 211 passed. `-t "A-02-TC-008"` 1 passed. `views.shape.test.ts › {v_property, v_roofing_permit, v_contractor, v_run} compiles and DESCRIBE equals columns.ts` 4 ✓. All 12 named columns are in `contract/v1/columns.json` |
| A-02-TC-009 | AC-2 | Validation | PASS | — | `-t "A-02-TC-009"` → 1 passed (`enum columns hold only their frozen values`) |
| A-02-TC-010 | AC-2, AC-7 | Negative | PASS | — | `grep -cE '"(status_raw\|expiry_date\|contractor_name_raw\|bbb_rating\|bbb_url\|description\|work_class_raw)"' contract/v1/columns.json` → `0`. Sample rows list each as `{field, reason: no_lexicon_carrier}`. `-t` 1 passed |
| A-02-TC-011 | FR-009 | Static | PASS | — | Plan grep on `views.sql` → no output, exit 1. `-t` 1 passed. Roofing filter `views.sql:308` `pm.improvement_type = 'Roofing' AND pm.improvement_action = 'Replacement'` |
| A-02-TC-012 | AC-3, NFR-001 | Manual + data | PASS (see Note 4) | — | Not re-run (instruction); sheet `docs/evidence/A-02-classifier-review.md`: seed `travis-austin@1.0.0/AC-3/2026-10-21`, population 65,437, keys sha256 `8c729882…4090`, 25 rows. Count: ✔ 24, ✘ 1 (row 11 `1985-021419 BP`, VOID), `needs_review` 0, solar/PV/aux rows 2, 3, 7, 8 all `not roofing`. PO D-7 "Yes, only row 11". Same-seed redraw: covered by `sample.test.ts › drawSample › is deterministic and independent of input order` ✓ |
| A-02-TC-013 | AC-3 | Negative (real row) | PASS | — | Covering test `classify-permit.test.ts › work_class Auxiliary Power is never roofing, even with ROOF in the text` ✓: real row `2021-068116 EP` → `not_roofing` / `aux_power`. `expectations.json` `aux_power_check.candidates_with_aux_power` = 0; `measure.test.ts › … 0 aux candidates` ✓ |
| A-02-TC-014 | AC-3 | Negative (real row) | PASS (see Note 5) | — | `tsx classifyPermit` on the pilot capture `2026-089033 EP` ("…full roof replacement") → `not_roofing trade_permit`; pilot PI table: `2026-089033 EP` `Electrical`, `2026-038825 MP` `MechanicalHVAC`, no trade permit typed `Roofing`. `views.pilot.test.ts › no trade sub-permit is in v_roofing_permit` ✓; `classify-permit.test.ts › 2026-131973 EP with an include term → trade_permit` ✓ |
| A-02-TC-015 | AC-3 | Edge (real rows) | PASS (see Note 6) | — | Covering tests ✓: `"OPPORTUNITY" is not RTU` (`2025-154701 BP` → roofing); `"roof decking" inside a reroof is not a roof deck` (5 rows → roofing); `… → excluded (rtu)` (3 rows) and `(solar_pv)` (3 rows); `work_class Roof with no include term → needs_review` |
| A-02-TC-016 | AC-4 | Validation | PASS | — | Covering test `classify-status.test.ts` (all 25 cases ✓): 7 open words, Expired / Expired - License → stalled, Final / Closed → closed, VOID, Withdrawn, Cancelled, Cancelled - …, Aborted, Denied but Closed, Revoked, Rejected → exclude. `tsx classifyStatus("Cancelled - Duplicate")` → `exclude`. All 9 words of the 2026-10-19 include set are mapped; `expectations.json` `candidates_by_status_class.needs_review` = 0 |
| A-02-TC-017 | AC-4 | Negative | PASS | — | `tsx classifyStatus`: "Archived" and "In Review" → `class: needs_review`, `emit: false`, `improvement_status: null`. `classify-status.test.ts › an unseen word (…) → needs_review, not emitted` ✓ (6 inputs) |
| A-02-TC-018 | AC-4 | Missing data | PASS | — | `-t "A-02-TC-018"` → 1 passed. Sample rows `2026-022834 BP`, `2026-022879 BP`, `2026-029405 BP`: `status_class stalled`, `improvement_status` null, `open_days` 229 / 229 / 223 (as_of 2026-10-20T22:00Z − issue date), `missing` has `status_raw` and `expiry_date` with `no_lexicon_carrier`; `source_url` = `…/3syk-w9eu.json?permit_number=…`; captured `status_current` = `Expired` for all 3 |
| A-02-TC-019 | AC-5 | Scale (live) | PASS (see Note 4) | — | Not re-run (instruction). `cat expectations.json`: `measured_at 2026-10-20T21:33:32Z`, `dataset_rows 2,380,939`, `include_matches 22,084` (= recount, = `fetched_rows`), `excluded {aux_power 3, solar_pv 21, rtu 10, roof_mounted 0, roof_deck 4}`, `trade_permits 3,015`, `needs_review 0`, `candidates 19,031` = 22,084 − 38 − 3,015 − 0 ✓. `candidates_with_aux_power 0`, `roof_mentions_aux_power 10,322`. `rules_sha256` = `DIGEST` = `c8fd15cf…dfa6`. `measure.test.ts` 6 ✓ |
| A-02-TC-020 | AC-6 | Smoke | PASS (see Note 7) | — | `tsx lookup`: Pflugerville → `found`, place, GEOID `4857176`, (30.447765, −97.602116); Manor `4846440`, Lakeway `4840984`, 78753 zcta (30.383591, −97.673349), all `found`. Each has `source.url` (census.gov 2024 Gazetteer zip), `source.file_date 2024-08-30T18:40:4xZ`, `source.sha256`, `gazetteer {version: "travis-places@1.0.0", sha256 0f4c08a8…}`. `gazetteer.test.ts` Pflugerville / Manor / Lakeway / ZCTA ✓ |
| A-02-TC-021 | AC-6 | Negative | PASS | — | `tsx lookup`: "ZIP 99999", "99999", "Georgetown" → `{status: out_of_scope}`, no `point` key. `gazetteer.test.ts › returns out_of_scope with no point for …` 5 ✓ |
| A-02-TC-022 | AC-6 | Edge | PASS | — | `tsx lookup`: Round Rock, Cedar Park, Leander → `found`, `partial_in_travis: true`, `counties ["48453","48491"]`. `gazetteer.test.ts › keeps the county-line place …` 3 ✓ |
| A-02-TC-023 | AC-6 | Integration | PASS | — | `cat DIGEST` → `0f4c08a8…d17f`; `gazetteer-digest.test.ts › DIGEST = sha256 of JCS(…)` ✓ (recomputed = DIGEST). `sources.json`: 4 Census files, each with url, last_modified, retrieved_at, bytes, sha256. `git ls-files pipeline/data/raw/census` → nothing |
| A-02-TC-024 | AC-7 | Missing data | PASS (see Note 8) | — | `-t "A-02-TC-024"` → 1 passed. Sample: every row `bbb_status not_checked`, `bbb_status_reason contractor_unresolved`; `contractor_name_raw` / `bbb_rating` / `bbb_url` → `no_lexicon_carrier`; 6 rows `tenure_basis unknown` with `is_long_tenure` null; closed rows `open_days` null with `{open_days, not_open}` |
| A-02-TC-025 | AC-8 | Smoke / demo | PASS | — | `duckdb -c "SELECT count(*) FROM 'contract/v1/sample.parquet'"` → `20`. `git ls-files '*.parquet'` → only `contract/v1/sample.parquet`. `-t` 1 passed |
| A-02-TC-026 | AC-8 | Missing data | PASS | — | Plan query → `null_prov 0`, `stalled 3`, `with_roof_age 20`, `runs 1` (`travis-pilot-20261020`). `-t` 1 passed |
| A-02-TC-027 | AC-8 | Doc | PASS | — | `-t "A-02-TC-027"` → 1 passed (every sample column, every gap and the five statements in `contract/v1/README.md`); also `sample.test.ts › README documents every column and every no-carrier field with its reason` ✓ |
| A-02-TC-028 | FR-010 | Validation / negative | PASS | — | `-t "A-02-TC-028"` → 2 passed (`RunManifestV1 accepts the pilot manifest and rejects CIDv0, gateway URLs, a bare directory and ipns`; `the row schemas parse 100% of pilot view rows`) |
| A-02-TC-029 | FR-011 | Error | PASS (see Note 9) | — | `cd pipeline/oracle-runtime && npx vitest run test/pilot/capture-austin.test.ts -t "403"` → `captureAustin › stops on a 403 with a blocked receipt and makes no further request` 1 passed: `status: blocked`, the last call is the blocked permit (no retry), last receipt `{status: 403, outcome: "blocked"}`. `run-pilot.ts:240-241` returns `{ok: false, stage: "austin"}` before any group or CLI step (code read; no test asserts it). `measure.test.ts › a 403 stops with a blocked receipt and no further request` and `… identified User-Agent, no app token` ✓ |
| A-02-TC-030 | FR-004 | Negative | PASS | — | `-t "A-02-TC-030"` → 1 passed (43 published permits all open/stalled/closed in the ledger; each null-status row has an issue date and an `Expired` capture; no exclude/needs_review permit published; manifest `coverage` counts match) |

## Non-functional results

| TC ID | NFR | Tool | Result | Actual | Threshold |
| --- | --- | --- | --- | --- | --- |
| A-02-TC-NF-01 | NFR-001 classifier accuracy | PO review sheet `docs/evidence/A-02-classifier-review.md` (= TC-012; not re-drawn) | PASS | ✔ **24/25**; `needs_review` 0/25; solar/PV/RTU accepted 0 | ≥ 24/25; ≤ 1 `needs_review`; 0 solar/PV/RTU |
| A-02-TC-NF-02 | NFR-002 unit-test coverage | `PILOT_DIR=… pnpm vitest run --coverage packages/query-core packages/contract` (15 files, 267 passed) | PASS (see Note 10) | `packages/query-core/src` 96.81 / 93.45 / 100 / 98.57 % (stmts / branches / funcs / lines); `packages/contract/src` 100 / 100 / 100 / 100 % (103/103, 42/42, 18/18, 97/97) | ≥ 80% each, each package |
| A-02-TC-NF-03 | AC-5, FR-005 profile digest stamp | `-t "A-02-TC-NF-03"` (1 passed) + `cat` / `duckdb` | PASS | `DIGEST` = `PROFILE.sha256` = `classifyStatus().profile_sha256` = `expectations.json rules_sha256` = manifest `profiles[travis-austin 1.0.0].sha256` = all 20 sample `profile_sha256` = `c8fd15cf8deb654c2959d7cca3b05560bc9830de2518c56a092bd87bdf53dfa6` | every classification and every permit row stamped |

## Defects

| ERR | TC | Severity | Status | Fix commit |
| --- | --- | --- | --- | --- |
| ERR-9 | A-02-TC-004 | Low | Closed (`c18f125`, re-tested PASS 2026-10-21). Was: The fixture check is missing: nothing takes a table without the cited property and returns `no carrier (not emitted by the export)` with the field left out of every view. The pilot half passes, and real data is handled by hand (ADR-0002 Decision 3 for `address`). The fix is either a small checker plus a fixture test, or a test-plan change approved by the PO that limits TC-004 to the pilot check and the ADR-0002 rule | — |

## Notes

Expected values that are out of date or did not match the plan's wording. Each was judged by what its AC means; none hides a product failure except ERR-9.

1. **TC-001 step 1 grep (test-plan step defect).** `^\| (printed contractor name|…) \|` matches 0 lines, because the carrier table starts with a `#` column (`| 1   | printed contractor name     | no_carrier |`). The verdicts are spelled `carrier`, `no_carrier` and `no_carrier_not_emitted` (ADR-0002 § Verdicts), not `no carrier`. With the column allowed, the count is 9. Fix the grep in test plan v0.2.2. Read literally, step 1's `→ 9` fails.
2. **TC-003 fallback wording.** The plan expects "AD-25: field not published, the UI shows the reason" for `status_raw`. The record says "AD-25: Expired published as `improvement_status` null (D-4a); reason `no_lexicon_carrier`", which reflects PO decision D-4a. Same fallback, same reason.
3. **TC-006 digests out of date (D-9 re-run).** The run log holds the first pilot's `tables-export.json` digests (`d989414c…639c`, `72715bf7…084b`, row 10-21 01:11). The files on disk come from the D-9 re-run (row 10-21 02:07): `6f16dda9…9c3b` and `af7caa18…cdf5`. They match `reports/sequence.json`. The files embed `exportedAt`, so their digests change on every run (`docs/evidence/A-02.md` says so), while the tables roots stay stable. The 02:04 and 02:07 run-log rows do not record the new digests, although `docs/evidence/A-02.md` says "the values per run are in the run log". That is an evidence gap to close in the run log.
4. **TC-012 / NF-01 and TC-019 not re-run (instruction).** The plan expects `measured_at` = today and a same-seed redraw. The committed outputs are from 2026-10-20T21:33Z / 21:34Z (Stage 5). They were judged as committed, so no new Austin traffic was made. Redraw determinism is covered by the unit test.
5. **TC-014 test data.** The pilot EP is `2026-089033 EP`, and its text is "full roof replacement" (include term ROOF REPLACE), not "re-roof". The unit-test EP with "Re-roofing", `2026-131973 EP`, is not a pilot permit. Same AC.
6. **TC-015 "real row" for needs_review.** On 2026-10-21 every `work_class = 'Roof'` row is an EP sign permit, so the test uses the real `2025-061893` description with `permittype` set to BP (the test comment says so). A real EP row would give `trade_permit`.
7. **TC-020 version string.** `gazetteer.version` is `"travis-places@1.0.0"`, not `1.0.0`. It carries version 1.0.0 and its SHA-256.
8. **TC-024 display text.** "not published · no lexicon carrier" is UI text that A-02 does not render. The data carries the reason (`contractor_name_raw` → `no_lexicon_carrier`). The plan's `bbb_status_reason ∈ {contractor_unresolved, no_lexicon_carrier}` holds: all rows are `contractor_unresolved`.
9. **TC-029 details.** The stub blocks the 4th permit GET (`SEPT[3]`), not the 2nd. "No CLI step afterwards" is confirmed by reading the code (`run-pilot.ts:240-241`); no test asserts it. The run's reason names the permit, and the URL is in the blocked receipt.
10. **NF-02 report display.** The text coverage table hides fully covered files, so `packages/contract/src` (100%) and several 100% query-core files do not show in it. The per-directory figures above come from `--coverage.reporter=json-summary` written to a scratch directory. Also, the gazetteer code `packages/query-core/gazetteer/travis-places@1.0.0/index.ts` is outside the coverage `include` glob (`packages/*/src/**`), so it is not counted in query-core coverage. It is exercised by `gazetteer.test.ts` (18 tests ✓).
11. **Test titles.** The plan says "each case maps to one automated Vitest test titled with its TC ID". Only 13 of the 33 cases have one, and the other 20 ran through the covering tests named above. Retitle or add tests, or amend § 7 of the plan.
12. **TC-002 CID prefix.** The cited `sales_history` row CID is `baguqeera…` (dag-json CIDv1), not `bafy…` as the plan's placeholder suggests. It is still CIDv1.
13. **Working tree.** The tree was not clean at the start: `docs/reviews/CR-A-02.md` was already modified. During the run other sessions changed `specs/002-data-contract/run-log.md` and `tasks.md`, and added `docs/evidence/A-02.md` and `docs/reports/A-02-unit-test-report.md`. None of those is a test input except the run log, and the values used from it (manifest CID, D-decisions) are in the committed `HEAD` copy. This QC run changed nothing except this report.

## Sign-off

**Decision:** ☐ Validated (counts toward G7) ☐ Returned, reason: {…} · {date}
