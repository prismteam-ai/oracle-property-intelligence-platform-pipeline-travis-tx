---
id: QC-RPT-A-04
type: test-execution-report
feature: FEAT-A04
story: A-04
test_cases: testplans/A-04-test-cases.md
runtime_url: "not applicable: pipeline-only story (ui: false); see testplans/A-04-test-cases.md § 3.1"
build: "e48ec93 (branch 004-property-backbone, clean working tree at the start)"
data_snapshot: "TCAD export SHA-256 6f7a758568fd03fa200e996d2756559eb53e13241238a004cbadac09ff4c2346; GIS runner run 39684063596 (373,683 features)"
owner: HebaGaber             # QC Lead
status: Final                # FINAL 2026-10-22: every case has a result; 0 FAIL (ERR-22, ERR-23 re-tested PASS)
gate: G7
created: 2026-10-22
signed_off_date:
---

# QC Test Report: A-04 Load the county backbone (FINAL, 2026-10-22)

**FINAL (2026-10-22: second pass plus re-tests of the two failed cases).** Every case now has a result. Pass 1 ran what needed no database; pass 2 ran the PENDING-DB, PENDING-NETWORK and PASS-PARTIAL steps against the live local stack (Docker Postgres, Restate, services on :9080), read-only except the two Austin cases. Austin was called only by TC-040 (two `count(*)` requests, 2 s apart) and TC-052 (one incremental run, which failed on its second request; ERR-22). GIS, TCAD and `gis.traviscountytx.gov` were not requested; no ingest, write-group, hash or export ran. Database reads used the plan's read-only `qdb_ro` (via `docker exec`, `default_transaction_read_only = on`), never listing owner names. TC-004 also ran the 10-minute join proof once (ERR-23). The second pass had two FAIL (TC-004 on the CLI output, TC-052 on the live Austin call); both were fixed (ERR-23, ERR-22) and re-tested PASS the same day, and TC-023 step 4 was re-run on the rebuilt tables. Nine PASS-WITH-NOTE cases differ from the plan only by a stale expected value or a step not repeatable here (reason in each row).

**Status words.** PASS: every step ran and met the expected result. PASS-WITH-NOTE: the case intent holds; a plan value is stale or one step could not be repeated (stated in the row). FAIL: the product did not meet the expected result (defect filed). In pass 1 a PASS-PARTIAL meant offline steps passed and database or network steps were open; none remain.

**How cases ran.** One command at a time. Both Vitest packages ran once with `-t "A-04-TC-" --reporter=json` and each test was mapped to its case by the id in its name (a test whose title names two cases counts for both). TC-020 was re-run with `GIS_ARTIFACT` set to the stored runner artifact. File-only checks (TC-015 step 2, TC-025 step 3, TC-047 step 2, TC-NF-02, TC-NF-03) ran as the plan's exact shell commands from the repo root, step 0 `git rev-parse --abbrev-ref HEAD` printing `004-property-backbone`.

## Summary

| Item | Value |
| --- | --- |
| Environment | local terminal, branch `004-property-backbone`, commit `e48ec93`, 2026-10-22 (pass 1 on `40fa2e2`); no hosted runtime (pipeline-only story, C-05 exception) |
| Total TC in plan | 52 (49 functional + 3 NF) |
| Counts | PASS 43 · PASS-WITH-NOTE 9 · FAIL 0 · still pending 0 (total 52) (second pass: 40 · 10 · 2; TC-004, TC-052 re-tested PASS and TC-023, whose only note was step 4, now PASS) |
| Passed / failed / pending | 52 (43 + 9 with a note) / 0 / 0 |
| Pass rate | 52 of 52 = 100% (9 with a note) |
| Open Critical defects | 0 (ERR-21 Low, ERR-22 High and ERR-23 Medium all Re-tested) |
| Unit test report | `docs/reports/A-04-unit-test-report.md` |
| Code review log | `docs/reviews/CR-A-04.md` |
| Playwright run | not applicable (no UI); C-09 maps each case to a named Vitest test or shell command |

## Results

| TC ID | AC | Type | Status | Evidence pointer |
| --- | --- | --- | --- | --- |
| A-04-TC-001 | AC-1 | Happy path | PASS-WITH-NOTE | Unit steps unchanged. Pilot job already run (not re-run: no ingest). Steps 2, 4, 5, 6 run on the 25 seed pIDs in the live `parcels`: seed 26 lines, anchors in seed `2`, ANCHOR2 log line `1`; `25\|25\|25\|25\|25\|25`; 221829 row `t\|t\|t\|1941\|<TCAD URL>\|2026-10-19 21:33:41.241+00\|64` as expected. Note: ANCHOR2 105471 has no year built (`year_built_missing_reason = source_missing`, rule `none`), so its year cell is empty where the plan says `{year}`; the case allows year or reason. |
| A-04-TC-002 | AC-1 | Happy path | PASS | Vitest TC-002 3 passed (first pass). Steps 1-2 on the pilot County group `travis-a04-pilot-20261021223504`: 22 zips = 22 R accounts of the 25-row seed; `elephant-cli validate` ends `Properties processed: 22, succeeded: 22, failed: 0`. |
| A-04-TC-003 | AC-1 | Negative | PASS | `parcels` 0, `parcel_geoids` 0, permit `1982-012866 BP\|t\|no_tcad_geoid`. |
| A-04-TC-004 | AC-1 | Happy path | PASS | Re-test 2026-10-22 after fix commits `be805f8` and `79e21d0` (`callLong` polls `/restate/invocation/<svc>/<key>/<handler>/<idem>/output`): live CLI join proof, seed 2026, job `travis-a04-20261022052658`, 12:34:48-12:50:44Z, printed `join_proof=pass matched=906 disagreements=0 no_tcad_geoid=93 ambiguous_geoid=1 reverse_checked=1000 reverse_disagreements=0` (ERR-23 Re-tested). First run (before the fix): steps 1-2 PASS: `221829\|0223120506\|R`; 0 keys outside `^[1-9][0-9]{0,6}$`. Step 3: CLI printed `backbone: ingest failed: fetch failed` after about 5 min (exit 1, no `join_proof=` line) although the workflow completed; result read from the Restate journal of `inv_1eeWoWwOOvDp0v41Yud8lfe5M4KZHXor7j`: `sampled 1000, matched 906, no_tcad_geoid 93, ambiguous_geoid 1, disagreements 0, reverse_checked 1000, reverse_disagreements 0, pass true` (9 min 39 s). Product result was correct, CLI output wrong: ERR-23 (now fixed). |
| A-04-TC-005 | AC-2 | Scale | PASS-WITH-NOTE | Step 1 (the ingest) is job `travis-a04-20261022052658`, not re-run. Steps 2-7: classes only `loaded 493246`; 493,246 distinct pIDs; types MH 11,744 / MN 5 / P 39,536 / R 441,961; redacted `R\|15410`; report roll `n 493246, loaded 493246, difference 0, unexplained 0`; limitations hold both §25.025 lines (count 15410). Note: the CLI prints a trailing `job_id=…` line after the JSON, so the plan's `report --json \| jq` pipe stops with a parse error at the last line unless it is stripped. |
| A-04-TC-006 | AC-2 | Scale | PASS | `restate sql`: 242 `TcadBackbone` invocations of the key, all `completed`. `backbone_runs`: `complete\|t\|6f7a7585…2346`. Seed sum 493246, `mergedCount` 493246. |
| A-04-TC-007 | AC-2/FR-018 | Edge | PASS | Vitest 1 passed. Live: `100008\|2\|profile_main`. |
| A-04-TC-008 | FR-019 | Edge | PASS | Vitest 1 passed. Live: one situs shared by 2 accounts, 2 distinct pIDs (`2\|2`). |
| A-04-TC-009 | FR-019 | Edge | PASS | Vitest 1 passed. Live: `1\|6f7a758568fd03fa200e996d2756559eb53e13241238a004cbadac09ff4c2346`. |
| A-04-TC-010 | AC-3 | Happy path | PASS | Vitest 2 passed. Live: `in_county\|f\|393747\|1`, `out_of_area\|t\|57379\|1`, `regional\|t\|8707\|1`, `unknown\|\|33413\|1`; one `area_list_sha256` = DIGEST `0f4c08a8…d5f17f`. |
| A-04-TC-011 | AC-3 | Negative / missing data | PASS-WITH-NOTE | Vitest 4 passed. Step 2 `0`. Step 3 printed `243` (plan: 0): all 243 are `out_of_area` with evidence `foreign_mailing`, R accounts with no ZIP and no `owner_mailing_country` value because the rule also accepts `addrInternational` (`owner-area.ts` header). Evidence is present, so the AC (out_of_area only with evidence) holds; the plan's step 3 predicate is too narrow. |
| A-04-TC-012 | AC-4 | Missing data | PASS-WITH-NOTE | Vitest 2 passed. Live: one row `unknown\|0\|0\|317819\|317819` (plan figure 317,818 is marked re-measured; off by one). |
| A-04-TC-013 | AC-4 | Missing data | PASS | Vitest 4 passed. Live: one row `unknown\|no_roof_date\|source_missing\|92113`. |
| A-04-TC-014 | AC-5 | Security | PASS | `confidential.test.ts` -t TC-014: 2 passed (step order, redaction, limitations). |
| A-04-TC-015 | AC-5 | Security / negative | PASS | Step 2 `0` (first pass). Step 3 `0` for the plan predicate; also `0` for `payload_redacted::text ~* 'ownerName\|addrLine'` on the 15,410 redacted accounts. |
| A-04-TC-016 | AC-6 | Negative / error | PASS | `probes/tcad.test.ts` + `workflow.blocked-a04.test.ts` -t TC-016: 6 passed. |
| A-04-TC-017 | AC-6 | Security | PASS | `workflow.blocked-a04.test.ts` -t TC-017: 5 passed. |
| A-04-TC-018 | FR-025 | Negative / harness | PASS | Vitest 7 passed (first pass). Step 3 overlapping appraisal/permits runs `0`. |
| A-04-TC-020 | AC-7/8 | Scale | PASS-WITH-NOTE | Workflow tests 5 passed and runner-artifact tests 9 passed (first pass). `gh run list -R HebaGaber/…` (the plain command targets the upstream repo and returns 404): runs 39683448743, 39684063596 (full, 373,683 features) and 39685884714 all `success`; 39682166613 earlier `failure`. Pushes (steps 2, 5) not repeated by design. |
| A-04-TC-021 | AC-7 | Negative | PASS-WITH-NOTE | Step 1 `0`. Step 3 `{on_roll:false, coordinate_source:null}` (report anchors). Step 2 printed `f\|f` (plan: `t\|t`): Austin's own row for permit 1982-012866 BP now carries lat/lon 30.2716 / -97.7474 (zip 78701); the plan assumed none (2026-10-19 note). No parcel exists or receives it, so the case intent holds; the plan's step 2 is stale. |
| A-04-TC-022 | AC-7 | Happy path | PASS | Live: `105471\|gis_centroid\|t\|t\|t\|t\|t\|64` and `221829\|gis_centroid\|t\|t\|t\|t\|t\|64`. |
| A-04-TC-023 | AC-8 | Scale / missing data | PASS | Steps 1-3 live: `condo-coded\|70609\|20071\|24566\|46043`, `ordinary\|371352\|369990\|370027\|1325` (99.63%); R reasons all present (`no_gis_feature` 46,945, `no_permit_point` 423, 0 no-point rows without a reason); P 39,536 / MH 11,744 / MN 5 all `none`. Report: 441,961 R, 394,593 with point (0.8928). Step 4 re-run on the rebuilt tables (after the address fix and the nine-batch rebuild, 2026-10-22): v_property rows 441,961 = distinct property_cid 441,961 = Query DB R accounts 441,961, explained_difference 0, coverage_gate PASS, coverage_public 0.8826, coverage_qdb 0.8928, permit_point 4,532: PASS. |
| A-04-TC-024 | AC-9 | Happy path | PASS | Vitest 1 passed. Live: `1000046\|permit_point\|permit_point\|t`. |
| A-04-TC-025 | AC-10 | Missing data / negative | PASS | Vitest 1 passed. Live step 2 `0`; geocoder grep `0`. |
| A-04-TC-026 | AC-11 | Error / negative | PASS | `gis-adapter.test.ts`, `gis-artifact.test.ts`, local-stack `tracks/gis.test.ts` -t TC-026: 5 passed. |
| A-04-TC-027 | AC-11 | Error | PASS | `gis-adapter.test.ts` -t TC-027: 2 passed. |
| A-04-TC-028 | AC-11 | Performance | PASS | `gis-adapter.test.ts` -t TC-028: 2 passed. |
| A-04-TC-029 | FR-020 | Edge | PASS | Vitest 2 passed. Report: `{pids:917, rule:largest_area, extra_features:1082}`. |
| A-04-TC-030 | FR-020 | Edge | PASS | Vitest 1 passed. Live step 2 `0`; flag set on 43 parcels and 586 permit rows. |
| A-04-TC-031 | FR-020 | Edge | PASS | `coordinates.test.ts` -t TC-031: 3 passed. |
| A-04-TC-032 | AC-7 | Negative | PASS | Step 1 `0`. Report `gis_features_without_roll_account` 6192 (counted, not loaded). |
| A-04-TC-033 | AC-8 | Edge | PASS | Vitest 1 passed. Live: `gis_centroid\|9600`; report `{rule:condo_building_point, accounts:9600, buildings:648}` (same content, key order differs from the plan text). |
| A-04-TC-040 | AC-12 | Scale | PASS | Step 1 (backfill) not re-run. Austin `count(*)` where `:updated_at` <= watermark 2026-10-21T14:42:23.154Z: 2,381,226; total now: 2,381,226 (HTTP 200 x2, 2 s apart). Report: `source_total_at_watermark = captured_at_watermark = 2381226`, `above_watermark 0`, `outside_travis 84035`. `permit_source_rows` `2381226\|2381226\|2381226\|2381226`; `property_improvements` `t\|t\|84035`. |
| A-04-TC-041 | AC-12/17 | Pipeline | PASS | `permits-backfill.test.ts` -t TC-041: 2 passed. |
| A-04-TC-042 | AC-13 | Scale | PASS | Reroof candidates `22084\|19599\|0.8875`; roofing `19031\|16816\|88.36`; linked methods only `tcad_id/geoid_unique_r` 19,497, `tcad_id/geoid_plus_address` 29, `address_hash/address_sig_v1` 73; unlinked only `no_tcad_geoid` 1,601, `ambiguous_geoid` 405, `no_tcad_id` 262, `address_unmatched` 217; step 4 `0`. |
| A-04-TC-043 | AC-13 | Pipeline / missing data | PASS | `1982-012866 BP\|0208011301\|\|\|\|no_tcad_geoid`; `2000-000025 BP\|0223120506\|221829\|tcad_id\|geoid_unique_r\|`; `2025-063927 BP\|0107070206\|105471\|tcad_id\|geoid_unique_r\|`. |
| A-04-TC-044 | AC-13 | Pipeline | PASS | `permit-link.test.ts` -t TC-044: 12 passed. |
| A-04-TC-045 | AC-14 | Pipeline | PASS-WITH-NOTE | Report: run vs baseline open 125 / 129, stalled 2,213 / 2,213, closed 17,255 / 17,251, exclude 2,491 / 2,491 (sum 22,084 = candidates); one profile SHA `c8fd15cf…dfa6`. Open split is `Active 121`, `Pending Permit 1`, `Re Review 1`, `Suspended 2` (plan on the baseline snapshot: Active 125): 4 Active permits moved to closed between 2026-10-19 and the 2026-10-21 backfill; the plan figure belongs to the older snapshot. |
| A-04-TC-046 | AC-14/16 | Pipeline | PASS-WITH-NOTE | `Suspended\|open\|1982-06-23\|16192\|t\|t\|no_tcad_geoid`, `as_of` 2026-10-22 (plan 16,191 is for as_of 2026-10-21). |
| A-04-TC-047 | AC-14 | Edge | PASS | `profile-edge.test.ts` -t TC-047: 6 passed (step 1). Step 2 grep for REROOF/RE-ROOF in permits code + socrata-pages.ts printed `0`. |
| A-04-TC-048 | AC-15 | Pipeline | PASS | Report: supported `austin` `eq true` captured_at 2026-10-21T22:32:10.129Z (2,381,226 = 2,381,226); `absent` 22; 22 limitation lines with evidence URL. |
| A-04-TC-049 | AC-15/FR-022 | Edge | PASS | `BEE CAVE FULL PURPOSE\|austin\|4822`, `LAKEWAY FULL PURPOSE\|austin\|6827`, `PFLUGERVILLE ETJ\|austin\|592`, `PFLUGERVILLE FULL PURPOSE\|austin\|1117`; report `own_permits_captured:false` for bee_cave, lakeway, pflugerville. |
| A-04-TC-050 | AC-16 | Missing data | PASS-WITH-NOTE | Vitest 5 passed. Live step 2 `0\|0\|0` (no open or stalled permit lacks an issue date in this data, so the check is vacuous live; the unit test carries the case); step 3 `0`. |
| A-04-TC-051 | AC-16 | Error / edge | PASS | `permits-incremental.test.ts` -t TC-051: 6 passed. |
| A-04-TC-052 | AC-16 | Pipeline | PASS | Re-test 2026-10-22 after fix commit `be805f8`: real incremental run, job `travis-a04-permits-incremental-20261022122922`, status complete, pages 1, rows 0, written 0, watermark 2026-10-21T14:42:23.154Z, re-stamp detected false (no row newer than the watermark). The hour-bucket SoQL was verified live with 3 requests: HTTP 400 for `date_trunc_ymdh`; HTTP 200 with two buckets of the 2026-10-21 re-stamp (hour 13 = 1,420,983 rows, hour 14 = 960,243 rows). ERR-22 Re-tested. First run (before the fix): `permits --mode incremental` (job `travis-a04-permits-incremental-20261022122136`): `status=failed pages=0 rows=0`, `histogram error (HTTP 400, 1 attempt(s))`, exit 1. Socrata: `No such function 'date_trunc_ymdh'`. The count request before it was HTTP 200. Nothing written. ERR-22 (now fixed). |
| A-04-TC-053 | AC-17 | Error / negative | PASS | `permits-backfill.test.ts` -t TC-053: 4 passed. |
| A-04-TC-054 | AC-17 | Error | PASS | `permits-backfill.test.ts` -t TC-054: 1 passed. |
| A-04-TC-055 | FR-021 | Edge | PASS | `permits-incremental.test.ts` + local-stack `tracks/permits.test.ts` -t TC-055: 3 passed. |
| A-04-TC-056 | FR-021 | Edge | PASS | `permits-incremental.test.ts` + local-stack `tracks/permits.test.ts` -t TC-056: 3 passed. |
| A-04-TC-NF-01 | AC-8/12 | Performance | PASS | `source-limits.test.ts` -t TC-NF-01: 3 passed. |
| A-04-TC-NF-02 | FR-024 | Security | PASS | Steps 1-3 each printed `0`; step 4 `bash scripts/grep-gates.sh` printed `grep-gates: OK (5 gates ...)`, exit 0. |
| A-04-TC-NF-03 | Harness rule (ARD § 8) | grep over receipts and code | PASS | step 1 = 0; step 2 = `loc=US`; step 3 = 0 (after the ERR-21 wording fix) | 0; exactly `loc=US`; 0 |

## Non-functional results

| TC ID | NFR | Tool | Result | Actual | Threshold |
| --- | --- | --- | --- | --- | --- |
| A-04-TC-NF-01 | Throughput recording (NFR-006) | Vitest `source-limits.test.ts` | PASS | 3 passed | page count, duration, throughput recorded |
| A-04-TC-NF-02 | Security (P0-1, P0-2) | grep + `scripts/grep-gates.sh` | PASS | 0 / 0 / 0, gates OK | all 0, exit 0 |
| A-04-TC-NF-03 | Harness rule (ARD § 8) | grep over receipts and code | PASS | step 1 = 0; step 2 = `loc=US`; step 3 = 0 (after the ERR-21 wording fix) | 0; exactly `loc=US`; 0 |
| TC-020 runner artifact | NFR-004 / AC-8 | Vitest on stored artifact | PASS | 187 pages, 373,683 features, 2,000 per page, concurrency 2, loc=US | pages = ceil(count/2,000); concurrency <= 2 |

## Defects

| ERR | TC | Severity | Status | Cause | Fix commit |
| --- | --- | --- | --- | --- | --- |
| ERR-21 | A-04-TC-NF-03 | Low | Re-tested, PASS (steps 2-3 pass with the fixed wording) | Test-plan wording written before `source-client.ts` gained its policy table and the runner logged `colo=` | test-plan wording fix (no code change) |
| ERR-22 | A-04-TC-052 | High | Re-tested, PASS (live incremental run `travis-a04-permits-incremental-20261022122922`: complete, rows 0, re-stamp false) | The hourly `:updated_at` histogram used `date_trunc_ymdh`, which Socrata does not have (HTTP 400); the offline fake server accepted any query | `be805f8`: day + hour-of-day buckets (`date_trunc_ymd(to_floating_timestamp(...))`, `date_extract_hh`); strict fake Austin rejects unknown functions |
| ERR-23 | A-04-TC-004 | Medium | Re-tested, PASS (live CLI join proof: `join_proof=pass matched=906 disagreements=0 ...`) | `ingest --join-proof` made one HTTP call that the client dropped after about 5 min | `be805f8` (`callLong` send + poll), `79e21d0` (poll path `/restate/invocation/<svc>/<key>/<handler>/<idem>/output`, verified live) |

Details: `docs/defects/ERR-21.md`, `ERR-22.md`, `ERR-23.md`.

## Live numbers (measured 2026-10-22 on the local stack, job `travis-a04-20261022052658`)

| Item | Expected (plan) | Measured |
| --- | --- | --- |
| N accounts / loaded / unexplained | 493,246 / 493,246 / 0 | 493,246 / 493,246 / 0 (R 441,961 · P 39,536 · MH 11,744 · MN 5) |
| Redacted R accounts (D-7) | 15,410 | 15,410 |
| Anchors | 221829 (0223120506); 105471 (0107070206, permit 2025-063927 BP); 0208011301 absent | all as expected (0 rows for 0208011301) |
| Permits rows / linked | 2,381,226 / 2,007,514 | 2,381,226 / 2,007,514; Austin live count at watermark 2,381,226 (same today) |
| Outside Travis | counted | 84,035 |
| Roofing permits linked | 19,031 / 16,816 (88.36%) | 19,031 / 16,816 (88.36%) |
| Reroof candidates linked | 22,084 / 19,599 | 22,084 / 19,599 (0.8875) |
| Ordinary parcels with public point | 371,352 -> 369,990 (99.63%) | 371,352 -> 369,990 (99.63%) |
| Condo-coded with public point | 70,609 -> 20,071 | 70,609 -> 20,071 (24,566 with permit points) |
| All R, public / with permit points | 390,061 (88.26%) / 394,593 (89.28%) | 390,061 / 394,593 |
| 1982-012866 BP | Suspended, open, no_tcad_geoid, open_days about 16,19x | Suspended, open, no_tcad_geoid, 16,192 (as_of 2026-10-22) |
| 2000-000025 BP | -> 221829 | -> 221829 (tcad_id, geoid_unique_r) |
| Status classes vs 2026-10-19 baseline | open 129, stalled 2,213, closed 17,251, exclude 2,491 | open 125, stalled 2,213, closed 17,255, exclude 2,491 (4 Active moved to closed) |
| Open split (TC-045) | Active 125 / Pending Permit 1 / Re Review 1 / Suspended 2 | Active 121 / 1 / 1 / 2 |
| Join proof (seed 2026) | pass, 0 disagreements | pass: matched 906, no_tcad_geoid 93, ambiguous_geoid 1, disagreements 0, reverse 1,000 / 0 (CLI re-test 12:34:48-12:50:44Z; the first run took 9 min 39 s) |
| No year built (all accounts) | 52,521 R + non-R (plan note) | 92,113 |
| No dated sale | 317,818 | 317,819 |
| Incremental run (TC-052) | complete | complete after the fix: pages 1, rows 0, written 0, re-stamp false (first run failed with HTTP 400, ERR-22) |

## Sign-off

**Decision:** pending QC Lead. Every case has a result: 43 PASS, 9 PASS-WITH-NOTE, 0 FAIL. ERR-22 and ERR-23 are fixed and re-tested PASS (TC-052, TC-004), ERR-21 is re-tested. The plan values that moved with the sources (TC-021 step 2, TC-045 open split, TC-046 day count, TC-011 step 3, TC-012 count) are listed in the rows for a v0.4 plan edit.
