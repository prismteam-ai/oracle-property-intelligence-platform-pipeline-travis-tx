---
id: QC-TC-A-04
type: test-cases
title: "Load the county backbone: TCAD properties and owners, coordinates, and permits from every jurisdiction"
parent: [FEAT-A04, FEAT-A05, FEAT-A06]
story: stories/A-04-property-backbone.md
spec: specs/004-property-backbone/spec.md # FR/NFR numbers below are the spec's (FR-001…FR-026, NFR-001…NFR-006)
plan: specs/004-property-backbone/plan.md
tasks: specs/004-property-backbone/tasks.md # read only for the T0nn mapping in § 2 / § 7, after the cases were drafted from the ACs
owner: HebaGaber # QC Lead
status: In Review # Draft → In Review → Approved
gate: G6
version: v0.3
created: 2026-10-21
updated: 2026-10-21
runtime_url: "not applicable: pipeline-only story (ui: false); see § 3.1"
reviewed_code: "TBD (set to the branch SHA when the cases run)"
qc_signoff: false
---

# Test Cases: A-04 Load the county backbone (TCAD properties and owners, coordinates, permits)

> **v0.1, 2026-10-21.** Drafted with `developmentsupport-testcases` from the story's Given / When / Then ACs (AC-1 … AC-17), its edge cases and its Requirements table. `tasks.md` was **not** read.
>
> **v0.2, 2026-10-21.** Updated to the PO's Round 1 decisions (§ 0). TC-003 and TC-021 became negative cases expected to PASS; TC-005 one expected outcome; TC-033 added (condo / shared-geoID rule).
>
> **v0.3, 2026-10-21.** Aligned with the final spec, plan, data model and contracts (plan § "Names fixed with the test plan", differences 1–4): (1) GIS mode is the `mode` field of `pipeline/oracle-runtime/travis/gis/runner-config.json`, push-triggered (TC-020, § 3.3); (2) the D-7 limitation text is the plan's (§ 3.5, TC-005, TC-014); (3) no Socrata app token, D-8 (TC-041, § 3.2); (4) extra closed values `ambiguous_geoid`, `ambiguous_address`, `centroid`, `export_point`, `permit_point` and the new column `link_rule` (§ 3.4, TC-022, TC-042, TC-043, TC-044); CLI flags per `contracts/cli.md` (§ 3.3); § 2 re-mapped to the spec's FR numbers and the task IDs. Column and value names also aligned with `data-model.md` (`record_sha256`, `coordinate_sha256`, `permit_far_from_gis`, `foreign_mailing`, `profile_main` / `largest_main_improvement`, `permit_source_rows`, `backbone_runs`). TC-018 added for FR-025 (one run at a time, one writer). **52 cases** (49 functional + 3 NF).
>
> This is a **pipeline-only** story. No case opens a browser. Every case starts from a terminal at the repo root on branch `004-property-backbone` and gives the exact command and the exact expected output. Counts that move with the sources are given as measured and marked **(re-measured at run time)**: the case compares against the value captured in the run's own receipt or report, never against a hard-coded figure, and the snapshot figure is what the case expects on that snapshot.

## 0. Round 1 decisions (PO, 2026-10-21)

| Decision                 | What the cases expect                                                                                                                                                                                                                                                                                                                                                | Cases                                          |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| **D-1** coverage target  | 99% of the **441,961 R** accounts = **≥ 437,542** with coordinates. The **51,285** non-land accounts (P 39,536 + MH 11,744 + MN 5) are counted separately with `coordinate_reason = non_land_account`. Condo / shared-geoID units get the building's point by `coordinate_rule = condo_building_point`.                                                              | TC-023, TC-033                                 |
| **D-5** load denominator | All **493,246** accounts load with `prop_type`; AC-2 reconciles against N = 493,246. Coverage runs over R only; the County group emits R only.                                                                                                                                                                                                                       | TC-005, TC-006, TC-023                         |
| **D-7** confidentiality  | The JSON export has **no §25.025 owner marker**. Owner fields are redacted **before `validate`** on every account with any `sales[].confidentialCode` / `confidentialSale` (**15,410** R accounts on the snapshot). They are **loaded and counted in `loaded`** (no `confidential` class); the limitation text of § 3.5 is recorded; the grep check for names stays. | TC-005, TC-014, TC-015                         |
| **D-4** anchors          | geoID `0208011301` is not in the export: permit **1982-012866 BP** is the documented **negative** (`unmatched_reason = no_tcad_geoid`, kept and counted; `open_days` still computed). **0223120506 → pID 221829** is the primary positive. A second positive `{ANCHOR2}` is picked in the pilot (§ 5) and logged.                                                    | TC-001, TC-003, TC-021, TC-022, TC-043, TC-046 |
| **D-2** GIS venue        | Fetch-only workflow on a GitHub-hosted US runner, **push-triggered** (mode in `runner-config.json`): pilot push, then full push, then `if: false`. Never from the laptop.                                                                                                                                                                                            | TC-020, TC-NF-03                               |
| **D-8** app token        | **No** Socrata app token; Austin ≤ 1 request/s.                                                                                                                                                                                                                                                                                                                      | TC-041, TC-053                                 |
| **D-9** names            | Public names from `contract/v1`: `gis_centroid`, `latitude` / `longitude`, `no_coordinates`, `needs_review`, `out_of_scope`. Internal reasons (`no_gis_feature`, `gis_null_geometry`, `no_permit_point`, `non_land_account`, `no_issue_date`), the `permit_point` fallback and the owner-area class (AC-3) are checked **in the Query DB only**.                     | TC-010, TC-011, TC-024, TC-025, TC-050         |
| **NFR-002** etiquette    | GIS concurrency **≤ 2**; Austin **≤ 1 request/s**; backoff base **1 s**, cap **60 s**, **5** attempts, **full jitter** (wait k uniform in [0, min(60 s, 1 s × 2^(k−1))]); **stop on the first 403**, no retry; no new TCAD download without a stop.                                                                                                                  | TC-016, TC-017, TC-026, TC-028, TC-041, TC-053 |
| Austin re-count          | 2026-10-21T18:54:53Z: **2,381,226** rows, **63,021** without `tcad_id`.                                                                                                                                                                                                                                                                                              | TC-040, TC-041                                 |

## 1. Feature overview

A-04 (merged parts A-04, A-05, A-06) loads the three layers every lead depends on into the internal Query DB on the local kit stack (Restate + Postgres): every TCAD 2026 certified-roll account with owner, mailing, situs, year built and sale date (part A-04); a labelled coordinate on each property from the Travis County GIS parcel layer, then the export point, the condo building rule and the Austin permit point as fallbacks (part A-05); and every City of Austin permit from Socrata `3syk-w9eu`, linked to properties, classified only by the frozen A-02 profile, plus a documented absence for every other jurisdiction (part A-06). Publication is A-11; nothing in A-04 is published.

## 2. Requirement mapping

Spec numbering: FR-001…FR-017 match AC-1…AC-17 one to one; FR-018…FR-026 are the edge cases and project rules; NFR-001…NFR-006. Task IDs from `tasks.md` (mapping only; the cases were drafted from the ACs).

| Requirement     | Summary                                                                                                                                                                                                                                                                                                                                                | Covered by (TC)                                | Implemented by (tasks)                   |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------- | ---------------------------------------- |
| AC-1 / FR-001   | Pilot transform with provenance; 221829 + `{ANCHOR2}`; 0208011301 negative; key as printed                                                                                                                                                                                                                                                             | TC-001, TC-002, TC-003, TC-004                 | T020, T022, T027, T028, T062, T063, T081 |
| AC-2 / FR-002   | Roll reconciliation; confidential inside `loaded`; all four types                                                                                                                                                                                                                                                                                      | TC-005, TC-006                                 | T025, T026, T076, T084                   |
| AC-3 / FR-003   | Owner area class with list SHA-256 (Query DB)                                                                                                                                                                                                                                                                                                          | TC-010, TC-011                                 | T023                                     |
| AC-4 / FR-004   | `tenure_basis = unknown`; roof-age basis `unknown`                                                                                                                                                                                                                                                                                                     | TC-012, TC-013                                 | T022, T023                               |
| AC-5 / FR-005   | Conservative §25.025 redaction before validate; limitations; no name anywhere                                                                                                                                                                                                                                                                          | TC-014, TC-015                                 | T021, T066                               |
| AC-6 / FR-006   | Stop on 403 / SHA mismatch, `waiting_human`, nothing loaded as complete                                                                                                                                                                                                                                                                                | TC-016, TC-017                                 | T003, T020, T026                         |
| AC-7 / FR-007   | GIS centroid by TCAD id with provenance; runner only; GIS never the population                                                                                                                                                                                                                                                                         | TC-020, TC-021, TC-022, TC-032                 | T041, T042, T043, T044, T071, T072, T077 |
| AC-8 / FR-008   | 2,000 per page; ≥ 99% of R both ways; non-land separate; condo rule; throughput                                                                                                                                                                                                                                                                        | TC-020, TC-023, TC-033, TC-NF-01               | T011, T024, T044, T045, T079, T080       |
| AC-9 / FR-009   | `permit_point` fallback (Query DB only)                                                                                                                                                                                                                                                                                                                | TC-024                                         | T044                                     |
| AC-10 / FR-010  | No point → null, one internal reason, public `no_coordinates`, never geocoded                                                                                                                                                                                                                                                                          | TC-025                                         | T027, T044 **Amended 2026-10-25 (PO decision, ADR 0004):** one narrow exception, an exact and unique match of the situs to the City of Austin public address-point layer may give a point (rule `address_point`, lowest priority, never over a GIS point); nothing else is ever turned into a point and no geocoding service is used. |
| AC-11 / FR-011  | GIS backoff, resume, `blocked`                                                                                                                                                                                                                                                                                                                         | TC-026, TC-027, TC-028                         | T041, T043                               |
| AC-12 / FR-012  | Austin backfill = source count at watermark; digest + URL; outside Travis counted                                                                                                                                                                                                                                                                      | TC-040, TC-041, TC-NF-01                       | T050, T051, T053, T074                   |
| AC-13 / FR-013  | ≥ 97% linked; address hash only when `tcad_id` null; shared geoID never silently linked                                                                                                                                                                                                                                                                | TC-042, TC-043, TC-044                         | T054, T078, T085                         |
| AC-14 / FR-014  | Profile-only classification; status split vs baseline; 1982-012866 BP                                                                                                                                                                                                                                                                                  | TC-045, TC-046, TC-047                         | T055, T056, T085                         |
| AC-15 / FR-015  | Every jurisdiction: count + total + time, or limitation with evidence URL                                                                                                                                                                                                                                                                              | TC-048, TC-049                                 | T056                                     |
| AC-16 / FR-016  | `open_days` from real dates; re-stamp detection                                                                                                                                                                                                                                                                                                        | TC-050, TC-051, TC-052                         | T052, T055, T082                         |
| AC-17 / FR-017  | 429/5xx backoff, resume, no skipped page, ≤ 50,000 rows, ≤ 1 req/s, no token                                                                                                                                                                                                                                                                           | TC-041, TC-053, TC-054                         | T050, T051                               |
| FR-018          | Several improvements → one property, children, year-built rule                                                                                                                                                                                                                                                                                         | TC-007                                         | T022                                     |
| FR-019          | Same situs kept; supplemental export not mixed in                                                                                                                                                                                                                                                                                                      | TC-008, TC-009                                 | T022, T026                               |
| FR-020          | Interior point; split parcels; far permit point flagged                                                                                                                                                                                                                                                                                                | TC-029, TC-030, TC-031                         | T040, T044                               |
| FR-021          | Upsert by permit number + jurisdiction; `source_removed` tombstones                                                                                                                                                                                                                                                                                    | TC-055, TC-056                                 | T052, T053                               |
| FR-022          | Austin-issued permits elsewhere stay Austin-issued                                                                                                                                                                                                                                                                                                     | TC-049                                         | T054, T056                               |
| FR-023          | Include + exclude → profile decides; else `needs_review`                                                                                                                                                                                                                                                                                               | TC-047                                         | T055                                     |
| FR-024          | Publish nothing; Query DB internal; local table export never uploaded                                                                                                                                                                                                                                                                                  | TC-NF-02, TC-023                               | T012, T045, T079                         |
| FR-025          | One ingest run at a time; one writer; backfill and TCAD run never concurrent                                                                                                                                                                                                                                                                           | TC-018                                         | T008, T009, T010, T074, T076             |
| FR-026          | Frozen `contract/v1` public names; internal reasons never public                                                                                                                                                                                                                                                                                       | TC-023, TC-025, TC-033, TC-050                 | T027, T044, T053                         |
| NFR-001         | Difference < 2% of N, 0 unexplained                                                                                                                                                                                                                                                                                                                    | TC-005                                         | T026, T084                               |
| NFR-002         | Etiquette numbers (UA, GIS ≤ 2, Austin ≤ 1 req/s, backoff, stop on 403)                                                                                                                                                                                                                                                                                | TC-016, TC-017, TC-026, TC-028, TC-041, TC-053 | T003, T026, T041, T050                   |
| NFR-003         | Coverage ≥ 99% of R (≥ 437,542) both ways                                                                                                                                                                                                                                                                                                              | TC-023                                         | T044, T045, T080                         |
| NFR-004         | GIS concurrency ≤ 2; backoff                                                                                                                                                                                                                                                                                                                           | TC-026, TC-028                                 | T041                                     |
| NFR-005         | ≥ 97% of Austin roofing permits matched                                                                                                                                                                                                                                                                                                                | TC-042                                         | T054, T085                               |
| NFR-006         | ≤ 50,000 rows per page, no token, ≤ 1 req/s, backoff on 429/5xx                                                                                                                                                                                                                                                                                        | TC-041, TC-053                                 | T050                                     |
| Security rule   | Query DB never exported or reachable (P0-1)                                                                                                                                                                                                                                                                                                            | TC-NF-02                                       | T012                                     |
| Harness rule    | GIS never called from the laptop (ARD § 8)                                                                                                                                                                                                                                                                                                             | TC-NF-03                                       | T041, T042                               |
| Edge cases      | Several improvements TC-007 · same situs TC-008 · supplemental TC-009 · abroad / no ZIP TC-011 · L-shaped TC-031 · split parcel TC-029 · condo TC-033 · far permit point TC-030 · new status TC-056 · upstream delete TC-055 · Austin-issued elsewhere TC-049 · "REROOF AND SOLAR" TC-047 · restart mid-run TC-027, TC-054 · export SHA differs TC-016 | —                                              | —                                        |
| Negative anchor | geoID 0208011301 not on the roll; permit 1982-012866 BP (D-4)                                                                                                                                                                                                                                                                                          | TC-003, TC-021, TC-043, TC-046                 | T054, T062                               |

## 3. Assumptions

### 3.1 G6 exceptions C-05 and C-09 (the single record of both; accepted for this story)

- **C-05 (start from the hosted URL):** A-04 has no UI and publishes nothing (A-11 publishes, A-13 shows it). Every case instead starts with step 0: _in a terminal at the repo root, run `git rev-parse --abbrev-ref HEAD` → `004-property-backbone`_, then gives one exact command per step. localhost is never evidence for a hosted claim; no case here makes a hosted claim.
- **C-09 (Playwright mapping):** each case maps to one named Vitest test (`-t "A-04-TC-nnn"`) in `pipeline/oracle-runtime` or `pipeline/local-stack`, to a `backbone` / `elephant-cli` / `gh` command, or to a read-only SQL / Restate / `grep` check, instead of a Playwright spec. § 7 names the automation for every case.

### 3.2 Side-effect classes (every case is marked with one)

| Mark                 | Meaning                                                                                                                                                                                                                                                                                              |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **read-only**        | Reads files, the Query DB in a read-only session, or Restate state. Writes nothing outside a temp dir.                                                                                                                                                                                               |
| **writes local**     | Writes `pipeline/data/` and/or the local Query DB / Restate state. No source is called; the TCAD input is the export already on disk.                                                                                                                                                                |
| **calls Austin**     | Requests `data.austintexas.gov` (Socrata `3syk-w9eu`) with the project User-Agent and **no app token** (D-8), at ≤ 1 request/s.                                                                                                                                                                      |
| **runner calls GIS** | The Travis County GIS layer is requested **only** from the US GitHub Actions runner (ARD § 8; D-2: pilot push, then full push). The laptop only commits and pushes `runner-config.json`, then downloads and reads the runner's artifact. **No case calls GIS from the laptop** (TC-NF-03 proves it). |

`elephant-cli validate` fetches lexicon schemas from an IPFS gateway; that is the only other network use and touches no county source. Nothing is uploaded.

### 3.3 Fixed commands and helpers (from `contracts/cli.md` and `contracts/gis-runner.md`)

`BB` below stands for `npm --prefix pipeline/oracle-runtime run backbone --`; `E` for `~/.local/share/elephant-cli-main/node_modules/.bin/elephant-cli` (pinned GitHub main build, 44bb182). Cases write the commands out in full.

| Name                                | Exact command                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vitest case                         | `(cd pipeline/oracle-runtime && npx vitest run {file} -t "A-04-TC-nnn")`; local-stack cases `(cd pipeline/local-stack && npx vitest run {file} -t "A-04-TC-nnn")`                                                                                                                                                                                                                                                                                                                                                                |
| Pilot seed                          | `BB pilot --select` → writes `pipeline/data/seeds/travis-a04-pilot.csv`                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Pilot run                           | `BB pilot --seed pipeline/data/seeds/travis-a04-pilot.csv` → last line `job_id=travis-a04-pilot-<yyyymmddhhmm>`                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Full county                         | `BB ingest --track appraisal` → last line `job_id=travis-a04-<yyyymmddhhmm>`                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| County group                        | `BB ingest --write-group --job {JOB_ID}` (R only, `gis_centroid` geometry only)                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Join proof                          | `BB ingest --join-proof --job {JOB_ID} --seed {SEED}` → last line `join_proof=pass\|fail matched=<n> disagreements=<n>`                                                                                                                                                                                                                                                                                                                                                                                                          |
| GIS capture (US runner only)        | set `"mode": "pilot"` (then `"full"`) in `pipeline/oracle-runtime/travis/gis/runner-config.json`; `git commit -m "A-04: GIS runner pilot" pipeline/oracle-runtime/travis/gis/runner-config.json` (then `… full`); `git push`; `gh run list --workflow a04-gis-capture.yml --branch 004-property-backbone --limit 1 --json databaseId,status,conclusion`; `gh run watch {RUN_ID} --exit-status`; `gh run download {RUN_ID} -D pipeline/data/raw/gis/us-runner-{RUN_ID}`. There is no `workflow_dispatch` and no `-f mode=` input. |
| Coordinates                         | `BB coords --gis-artifact pipeline/data/raw/gis/us-runner-{RUN_ID_GH}` (import, offline) · `BB coords --assemble-only` (after `permits --link`) · `BB coords --coverage --tables pipeline/data/runs/{JOB_ID}/tables` → last line `coverage_public=<p> coverage_qdb=<q> permit_point=<n>`                                                                                                                                                                                                                                         |
| Permits                             | `BB permits --mode pilot` (one page) · `BB permits --mode backfill` · `BB permits --mode incremental` · `BB permits --link` (link + classify)                                                                                                                                                                                                                                                                                                                                                                                    |
| Local table export (never uploaded) | `E validate pipeline/data/runs/{JOB_ID}/groups/county` → `E hash pipeline/data/runs/{JOB_ID}/groups/county --output-car pipeline/data/runs/{JOB_ID}/county.car -o pipeline/data/runs/{JOB_ID}/hashed.zip -c pipeline/data/runs/{JOB_ID}/hash.csv` → `E validate pipeline/data/runs/{JOB_ID}/county.car` → `E export-tables pipeline/data/runs/{JOB_ID}/county.car --output pipeline/data/runs/{JOB_ID}/tables --part-size 48m`                                                                                                   |
| Report (read-only)                  | `BB report --job {JOB_ID} --json`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Query DB, read-only                 | `qdb_ro() { docker compose -f pipeline/local-stack/docker-compose.yml exec -T postgres psql -U postgres -d elephant -At -F '\|' -v ON_ERROR_STOP=1 -c 'SET default_transaction_read_only = on' -c "$1"; }` (any write fails with `cannot execute … in a read-only transaction`; the connection string is never printed)                                                                                                                                                                                                          |
| Restate state (read-only)           | `restate sql "{query}"` (kit `monitoring-county-ingestion`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

Placeholders: `{JOB_ID}` = the TCAD job (pilot or full) from the last line `job_id=…`; `{PERMITS_JOB_ID}` = the `permits --mode backfill` job; `{LINK_JOB_ID}` = the `permits --link` job; `{RUN_ID_PILOT}` / `{RUN_ID_GH}` = the GitHub run ids of the pilot / full GIS push; `{SEED}` = the join-proof seed recorded in run-log.md. The report's `coordinates` / `gis` / `permits` / `jurisdictions` sections use the latest complete jobs after `{JOB_ID}` and print them in `source_jobs`. Exit codes: 0 ok · 2 `blocked` · 3 `waiting_human` · 4 disk guard · 64 usage · 1 other.

### 3.4 Names (from `data-model.md`)

- Published-view names come from `contract/v1/columns.json`: `v_property.request_identifier` (TCAD pID as printed, P0-5), `latitude`, `longitude`, `coordinate_source` ∈ {`gis_centroid`, `permit_point`, `none`}, `tenure_basis` ∈ {`sale_date`, `deed_date`, `unknown`}, `is_long_tenure`, `roof_age_basis`, `owner_area_class`, `owner_is_out_of_area`, `area_list_sha256`; reasons from `missingReasons` (`no_dated_sale`, `no_coordinates`, `owner_confidential`, `source_missing`, `needs_review`, `not_open`, `not_in_export`, `out_of_scope`, …).
- **D-9:** the internal reasons and the `permit_point` fallback are asserted **only in the Query DB**; in public rows they surface as `no_coordinates` / `needs_review` / `out_of_scope` / `not_in_export`.
- Query DB tables: `parcels`, `parcel_geoids`, `property_structures`, `roll_reconciliation`, `gis_pages`, `gis_features`, `permit_source_rows`, `property_improvements`, `backbone_runs`, `capture_receipts`, `watermarks`, `source_tombstones`, `source_limitations`, `loader_merges`.
- Closed lists the cases read:

| Column                                                                           | Values                                                                                                                           |
| -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `parcels.prop_type`                                                              | `R`, `P`, `MH`, `MN`                                                                                                             |
| `roll_reconciliation.class`                                                      | `loaded`, `dead`, `invalid`, `transform_failure` (no `confidential` class)                                                       |
| `parcels.owner_redaction_rule`                                                   | `sales_confidential_code`                                                                                                        |
| `parcels.owner_missing_reason`                                                   | `owner_confidential`, `no_dated_sale`, `no_owner_record`, `owner_unparsed`                                                       |
| `parcels.year_built_rule`                                                        | `profile_main`, `largest_main_improvement`, `none`                                                                               |
| `parcels.roof_age_basis` / `roof_age_reason`                                     | `unknown` / `no_roof_date`                                                                                                       |
| `parcels.tenure_basis` / `tenure_missing_reason`                                 | `sale_date`, `deed_date`, `unknown` / `no_dated_sale`                                                                                       |
| `parcels.owner_area_class`                                                       | `in_county`, `regional`, `out_of_area`, `unknown`                                                                                |
| `parcels.owner_area_evidence`                                                    | `travis_zcta`, `regional_zcta`, `us_zcta_outside`, `foreign_mailing`, `no_zip`, `zip_not_zcta`                                   |
| `parcels.coordinate_rule`                                                        | `centroid`, `interior_point`, `centroid_outside_polygon`, `largest_area`, `export_point`, `condo_building_point`, `permit_point` |
| `parcels.coordinate_reason`                                                      | `no_gis_feature`, `gis_null_geometry`, `no_permit_point`, `non_land_account`                                                     |
| `parcels.coordinate_review_flag`, `property_improvements.coordinate_review_flag` | `permit_far_from_gis` or null                                                                                                    |
| `property_improvements.link_method`                                              | `tcad_id`, `address_hash` or null                                                                                                |
| `property_improvements.link_rule`                                                | `geoid_unique_r`, `geoid_plus_address`, `address_sig_v1` (null when unmatched)                                                   |
| `property_improvements.unmatched_reason`                                         | `no_tcad_id`, `no_tcad_geoid`, `address_unmatched`, `ambiguous_geoid`, `ambiguous_address`                                       |
| `property_improvements.status_class`                                             | `open`, `stalled`, `closed`, `exclude`, `needs_review`                                                                           |
| `property_improvements.open_days_reason`                                         | `no_issue_date`, `not_open`                                                                                                      |
| `source_tombstones.reason`                                                       | `source_removed`                                                                                                                 |
| `backbone_runs.status`                                                           | `running`, `waiting_human`, `blocked`, `complete`, `failed`                                                                      |

- **Key:** Austin `tcad_id` carries the TCAD **geoID** (10 digits); the property key is the TCAD **pID** (integer, 6–7 digits). The link resolves geoID → pID through `parcel_geoids`.

### 3.5 Exact texts (the build emits them verbatim; plan § "Names fixed with the test plan")

- Bulk re-stamp limitation: `source bulk re-stamp; delta by content digest`.
- Confidential count limitation: `Confidential owner records redacted (Texas Tax Code §25.025): {n}`.
- Confidential-rule limitation (D-7): `source export carries no §25.025 marker; conservative suppression on sale-confidentiality codes`.
- Blocked Austin / GIS state on 403 (NFR-002): receipt `outcome: "blocked"`, `http_status: 403`; no further request to that host in the run; CLI exit 2.
- Blocked or unverified TCAD state: `backbone_runs.status = waiting_human` (CLI exit 3); an export SHA-256 different from the A-01 receipt stops with `export_sha256_mismatch`; a 403 on the one identified download gives receipt `outcome: "blocked"`, `http_status: 403`.
- GIS give-up: `blocked.json` / receipt `outcome: "blocked"` with `blocked_at` (UTC ISO-8601), no `complete.json`, and the report limitation `gis: blocked at {ts}; coverage not complete`.
- Records-request limitation per jurisdiction: `{Jurisdiction}: no public permit history captured (records request, not filed); evidence {evidence_url}`.

## 4. Scope

- **In scope:** 25-parcel pilot and full-county TCAD ingest on the local stack; roll reconciliation; out-of-area, tenure and roof-age-basis derivation; §25.025 redaction; stop on 403; GIS paging (runner), coordinate assembly, fallbacks, gap report, coverage both ways over a local (never uploaded) table export; Austin full backfill, incremental, linking, profile classification, jurisdictions, re-stamp detection, backoff and resume, tombstones; one run at a time.
- **Out of scope:** publication, the manifest CID and the hosted UI (A-11, A-13); contractor identity, BBB, merges and roof age from permits (A-07); address geocoding (never); the map view. **Amended 2026-10-25 (PO decision, ADR 0004):** one narrow exception, an exact and unique match of the situs to the City of Austin public address-point layer may give a point (rule `address_point`, lowest priority, never over a GIS point); nothing else is ever turned into a point and no geocoding service is used.

## 5. Test data

All real, Travis County. No synthetic record is presented as real; Vitest fake servers and in-test fixtures (`test/fixtures/a04/`) are labelled "synthetic test input" and are test inputs only.

| Data                                 | Snapshot (re-measured at run time)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TCAD 2026 certified JSON export      | `pipeline/data/raw/tcad/2026_20Certified_20JSON_20SUPP_200_2007182026.zip`, SHA-256 `6f7a758568fd03fa200e996d2756559eb53e13241238a004cbadac09ff4c2346`, captured 2026-10-19T21:33:41.241Z (`pipeline/docs/travis-sources.yaml`). **N = 493,246** accounts: R 441,961 · P 39,536 · MH 11,744 · MN 5. R sharing a geoID: 11,589 on 1,164 geoIDs.                                                                                                                                                                                                                                                                                                                                                             |
| Thresholds                           | 2% of N = 9,864.92 → difference **< 9,865**, 0 unexplained. Coverage **99% of R** = **≥ 437,542** of 441,961; non-land 51,285.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Confidential (D-7)                   | No owner-level §25.025 marker. Accounts with any `sales[].confidentialCode` = **15,410** R accounts (scanned 2026-10-21).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Gazetteer                            | `packages/query-core/gazetteer/travis-places@1.0.0`, `DIGEST` `0f4c08a8bda573737adecc7d62e84d629aadc5005b987f2f787e4fd31ab5d17f` (= `GAZETTEER_SHA256`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Anchor parcels                       | **Primary positive:** geoID `0223120506` → pID **221829** (`LOT 6 BLK 3 HILL SUBD`, R, year built 1941). **Documented negative (D-4):** geoID `0208011301`, **0 occurrences in the export** (scanned 2026-10-21). **Second positive (D-4, T062):** the first Austin reroof permit on the `permits --mode pilot` page (ordered by `permit_number`) whose `tcad_id` resolves to exactly one R geoID with a GIS feature in the pilot push; its geoID `{ANCHOR2}`, pID `{ANCHOR2_PID}` and permit `{ANCHOR2_PERMIT}` are written to `specs/004-property-backbone/run-log.md` as one line `ANCHOR2 geoID=<geoID> pID=<pID> permit=<permit>` before any case below runs; the placeholders are filled from there. |
| Anchor permits                       | `1982-012866 BP`: `Suspended`, issued 1982-06-23, `tcad_id` 0208011301, `AUSTIN FULL PURPOSE`, no latitude/longitude. `2000-000025 BP`: `Re Review`, issued 2000-01-05, `tcad_id` 0223120506.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Austin `3syk-w9eu`                   | **2,381,226** rows, **63,021** without `tcad_id` (2026-10-21T18:54:53Z). Reroof candidates 22,084, 508 without `tcad_id` (2026-10-19).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Status baseline (2026-10-19)         | open **129** (Active 125, Suspended 2, Re Review 1, Pending Permit 1) · stalled **2,213** · closed **17,251** · exclude **2,491**.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Link threshold                       | ≥ 97% of the run's reroof candidates; on 22,084 → **≥ 21,422** linked.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| GIS `TCAD_PARCELS`                   | **373,683** features (US runner, 2026-10-20T07:31:05Z); roll − GIS = 119,563. At 2,000 per page → **187** pages.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Jurisdictions                        | 23: Austin supported; **22** records request (none filed, PO 2026-10-20).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Austin-issued elsewhere (2026-10-21) | Lakeway FP **6,827** · Bee Cave FP **4,822** · Pflugerville FP **1,117** + ETJ **592**.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Profile                              | `travis-austin@1.0.0`, rules SHA-256 `c8fd15cf8deb654c2959d7cca3b05560bc9830de2518c56a092bd87bdf53dfa6`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Data snapshot                        | No manifest CID: A-04 publishes nothing. The snapshot is named by the TCAD export SHA-256, the Austin watermark, the GIS run id + artifact SHA-256 and `{JOB_ID}`, all recorded in `docs/evidence/A-04.md`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

## 6. Environment, risks and dependencies

- macOS terminal at the repo root, branch `004-property-backbone`, local stack up (`docker compose -f pipeline/local-stack/docker-compose.yml up -d`; `npm --prefix pipeline/local-stack run migrate`; `npm --prefix pipeline/local-stack start` on :9080), Node ≥ 22, `restate` CLI, `gh` authenticated on the fork, DuckDB CLI 1.5.6, ≥ 20 GiB free. No AWS resource is used.
- **GIS** never answers from the laptop (A-01 evidence `docs/evidence/blocked/tcad_gis-20261020T072223Z.md`); runner paging is PO-approved (D-2).
- The Austin backfill (≈ 48 pages) and the full TCAD ingest are long-running and never run at the same time (FR-025); TC-005 / TC-006 / TC-040 read their terminal state.

## 7. Coverage matrix

| TC ID         | Title                                                                                         | Priority | Tags                       | Side effects        | Requirement(s)                                 | Tasks                        | Automation                                                   |
| ------------- | --------------------------------------------------------------------------------------------- | -------- | -------------------------- | ------------------- | ---------------------------------------------- | ---------------------------- | ------------------------------------------------------------ |
| A-04-TC-001   | 25-parcel pilot: owner, mailing, situs, year built, provenance (221829 + `{ANCHOR2}`)         | P1       | @pipeline @demo            | writes local        | AC-1, FR-001                                   | T027, T062, T063             | Pilot commands + `qdb_ro`                                    |
| A-04-TC-002   | Pilot County group validates; transform coverage lists every mapped field                     | P1       | @pipeline                  | writes local (temp) | AC-1, FR-001                                   | T027, T063                   | `elephant-cli validate` + Vitest `tcad-backbone.test.ts`     |
| A-04-TC-003   | Negative anchor: geoID 0208011301 not on the roll → no property invented                      | P1       | @negative @missing-data    | read-only           | AC-1, FR-001, D-4                              | T054, T062                   | `qdb_ro`                                                     |
| A-04-TC-004   | Key is the pID as printed; 0223120506 → 221829; join proof both ways                          | P1       | @pipeline                  | read-only           | AC-1, FR-001, P0-5                             | T022, T028, T081             | `qdb_ro` + `ingest --join-proof`                             |
| A-04-TC-005   | Full roll reconciles: difference < 9,865, 0 unexplained; confidential in `loaded`             | P1       | @scale @pipeline           | writes local        | AC-2, FR-002, NFR-001                          | T025, T026, T076, T084       | Full-county command + `qdb_ro` + report                      |
| A-04-TC-006   | `monitoring-county-ingestion`: run complete, seed = sum of classes                            | P1       | @scale                     | read-only           | AC-2, FR-002                                   | T008, T026, T076             | `restate sql` + `qdb_ro`                                     |
| A-04-TC-007   | Several improvements → one property, children kept                                            | P2       | @edge                      | read-only           | FR-018                                         | T022                         | Vitest `tcad-backbone.test.ts` + `qdb_ro`                    |
| A-04-TC-008   | Two accounts with the same situs → both kept                                                  | P2       | @edge                      | read-only           | FR-019                                         | T022                         | Vitest `tcad-backbone.test.ts` + `qdb_ro`                    |
| A-04-TC-009   | Supplemental export during the run is not mixed in                                            | P2       | @edge                      | read-only           | FR-019                                         | T026                         | Vitest `tcad-backbone.test.ts`                               |
| A-04-TC-010   | Out-of-area owner: regional / out_of_area with list SHA-256                                   | P1       | @pipeline                  | read-only           | AC-3, FR-003                                   | T023                         | Vitest `owner-area.test.ts` + `qdb_ro`                       |
| A-04-TC-011   | Abroad or missing ZIP → out_of_area only with evidence, else unknown                          | P1       | @negative @missing-data    | read-only           | AC-3, FR-003                                   | T023                         | Vitest `owner-area.test.ts` + `qdb_ro`                       |
| A-04-TC-012   | No sale date → tenure_basis unknown, never tenure > 10                                        | P1       | @missing-data              | read-only           | AC-4, FR-004                                   | T023                         | Vitest `tenure.test.ts` + `qdb_ro`                           |
| A-04-TC-013   | No year built → roof_age_basis unknown with reason                                            | P1       | @missing-data              | read-only           | AC-4, FR-004                                   | T022                         | Vitest `tenure.test.ts` + `qdb_ro`                           |
| A-04-TC-014   | Sales confidentiality code → owner redacted before validate; loaded; limitations              | P1       | @security @pipeline        | writes local (temp) | AC-5, FR-005                                   | T021                         | Vitest `confidential.test.ts`                                |
| A-04-TC-015   | Confidential name in no output (grep check)                                                   | P1       | @security @negative        | read-only           | AC-5, FR-005                                   | T021, T066                   | `grep` + `qdb_ro`                                            |
| A-04-TC-016   | Export mismatch / injected 403 → `waiting_human`, nothing loaded as complete                  | P1       | @negative @error @security | writes local (temp) | AC-6, FR-006, NFR-002                          | T020, T026                   | Vitest `workflow.blocked-a04.test.ts`, `probes/tcad.test.ts` |
| A-04-TC-017   | Source etiquette: one User-Agent, GIS ≤ 2 / Austin ≤ 1 req/s, stop on first 403               | P1       | @security                  | writes local (temp) | AC-6, FR-006, NFR-002                          | T003, T026                   | Vitest `workflow.blocked-a04.test.ts`                        |
| A-04-TC-018   | One ingest run at a time; one writer into the Query DB                                        | P1       | @negative @harness         | writes local (temp) | FR-025                                         | T008, T009, T010, T074, T076 | Vitest `cli.test.ts`, `loader.test.ts` + `qdb_ro`            |
| A-04-TC-020   | GIS paged on the US runner (pilot push, then full), ≤ 2,000 per page, ≤ 2 concurrent          | P1       | @scale                     | runner calls GIS    | AC-7, AC-8, FR-007, FR-008                     | T041, T042, T071, T072       | `git push` + `gh run` + Vitest `gis-artifact.test.ts`        |
| A-04-TC-021   | Negative anchor: 0208011301 gets no coordinate and no property                                | P1       | @negative @missing-data    | read-only           | AC-7, FR-007, D-4                              | T045, T054                   | `qdb_ro` + report                                            |
| A-04-TC-022   | 221829 and `{ANCHOR2_PID}`: gis_centroid with layer URL, time, digest                         | P1       | @pipeline                  | writes local        | AC-7, FR-007                                   | T043, T044, T077             | Coordinates commands + `qdb_ro`                              |
| A-04-TC-023   | Coverage ≥ 437,542 of 441,961 R both ways; non-land separate; gap by reason                   | P1       | @scale @missing-data       | writes local        | AC-8, FR-008, FR-010, FR-024, FR-026, NFR-003  | T027, T044, T045, T079, T080 | `qdb_ro` + local table export + `coords --coverage` + report |
| A-04-TC-024   | No GIS feature + permit point → permit_point with permit URL (Query DB)                       | P1       | @pipeline                  | read-only           | AC-9, FR-009                                   | T044                         | Vitest `coordinates.test.ts` + `qdb_ro`                      |
| A-04-TC-025   | No GIS feature, no permit point → null with reason, never geocoded                            | P1       | @missing-data @negative    | read-only           | AC-10, FR-010, FR-026                          | T027, T044                   | Vitest `coordinates.test.ts` + `qdb_ro` + `grep` **Amended 2026-10-25 (PO decision, ADR 0004):** one narrow exception, an exact and unique match of the situs to the City of Austin public address-point layer may give a point (rule `address_point`, lowest priority, never over a GIS point); nothing else is ever turned into a point and no geocoding service is used. |
| A-04-TC-026   | GIS timeout → backoff 1 s / 60 s / 5 / full jitter → blocked; 403 → stop                      | P1       | @error @negative           | writes local (temp) | AC-11, FR-011, NFR-002, NFR-004                | T041, T043                   | Vitest `gis-adapter.test.ts`, `gis-artifact.test.ts`         |
| A-04-TC-027   | GIS restart → resume from the last completed page                                             | P1       | @error                     | writes local (temp) | AC-11, FR-011                                  | T041                         | Vitest `gis-adapter.test.ts`                                 |
| A-04-TC-028   | GIS page size ≤ 2,000 and concurrency ≤ 2 under load                                          | P1       | @perf                      | writes local (temp) | AC-11, FR-011, NFR-004                         | T041                         | Vitest `gis-adapter.test.ts`                                 |
| A-04-TC-029   | Split parcel → one point by the recorded rule, others counted                                 | P2       | @edge                      | read-only           | FR-020                                         | T040, T045                   | Vitest `coordinates.test.ts` + report                        |
| A-04-TC-030   | Permit point > 0.5 mi from GIS → GIS kept, permit flagged                                     | P2       | @edge                      | read-only           | FR-020                                         | T044                         | Vitest `coordinates.test.ts` + `qdb_ro`                      |
| A-04-TC-031   | L-shaped lot → interior point, rule recorded                                                  | P2       | @edge                      | read-only           | FR-020                                         | T040                         | Vitest `coordinates.test.ts`                                 |
| A-04-TC-032   | GIS is compared with the roll, never the population                                           | P1       | @negative                  | read-only           | AC-7, FR-007                                   | T044, T045                   | `qdb_ro` + report                                            |
| A-04-TC-033   | Condo / shared-geoID units → building's point by `condo_building_point`                       | P1       | @edge                      | read-only           | AC-8, FR-008, FR-026                           | T044, T045                   | Vitest `coordinates.test.ts` + `qdb_ro` + report             |
| A-04-TC-040   | Austin full backfill = source count at watermark; digest + URL per row                        | P1       | @scale @pipeline           | calls Austin        | AC-12, FR-012                                  | T050, T051, T053, T074       | Permits backfill + report + `qdb_ro`                         |
| A-04-TC-041   | ≤ 50,000 rows per page, no app token, keyset by `:id`, ≤ 1 req/s                              | P1       | @pipeline                  | writes local (temp) | AC-12, AC-17, FR-012, FR-017, NFR-002, NFR-006 | T050                         | Vitest `permits-backfill.test.ts`                            |
| A-04-TC-042   | ≥ 97% of reroof candidates linked; unmatched kept with reason                                 | P1       | @scale                     | read-only           | AC-13, FR-013, NFR-005                         | T054, T078, T085             | `qdb_ro`                                                     |
| A-04-TC-043   | 2000-000025 BP → 221829; `{ANCHOR2_PERMIT}` → `{ANCHOR2_PID}`; 1982-012866 BP `no_tcad_geoid` | P1       | @pipeline @missing-data    | read-only           | AC-13, FR-013                                  | T054, T062, T078             | `qdb_ro`                                                     |
| A-04-TC-044   | No tcad_id → address-hash fallback (AD-16); shared geoID rule                                 | P1       | @pipeline                  | read-only           | AC-13, FR-013                                  | T054                         | Vitest `permit-link.test.ts`                                 |
| A-04-TC-045   | status_class counts vs the 2026-10-19 baseline                                                | P1       | @pipeline                  | read-only           | AC-14, FR-014                                  | T055, T056                   | Report + `qdb_ro`                                            |
| A-04-TC-046   | 1982-012866 BP: Suspended → open, open_days = as_of − 1982-06-23                              | P1       | @pipeline @demo            | read-only           | AC-14, FR-014, FR-016                          | T055, T078                   | `qdb_ro`                                                     |
| A-04-TC-047   | "REROOF AND SOLAR" → the A-02 profile decides (`solar_pv`)                                    | P1       | @edge                      | read-only           | AC-14, FR-014, FR-023                          | T055                         | Vitest `profile-edge.test.ts` + `grep`                       |
| A-04-TC-048   | Austin count with total + timestamp; 22 records-request listed                                | P1       | @pipeline                  | read-only           | AC-15, FR-015                                  | T056                         | Report                                                       |
| A-04-TC-049   | Austin-issued in Lakeway / Bee Cave / Pflugerville stay Austin-issued                         | P1       | @edge                      | read-only           | AC-15, FR-015, FR-022                          | T054, T056                   | `qdb_ro` + report                                            |
| A-04-TC-050   | No issue_date → open_days null (`no_issue_date`), not 0                                       | P1       | @missing-data              | read-only           | AC-16, FR-016, FR-026                          | T055                         | Vitest `open-days.test.ts` + `qdb_ro`                        |
| A-04-TC-051   | Bulk re-stamp → only content-changed rows written, limitation                                 | P1       | @error @edge               | writes local (temp) | AC-16, FR-016                                  | T052                         | Vitest `permits-incremental.test.ts`                         |
| A-04-TC-052   | Real incremental run after the backfill                                                       | P2       | @pipeline                  | calls Austin        | AC-16, FR-016                                  | T052, T053, T082             | Permits incremental + `qdb_ro` + report                      |
| A-04-TC-053   | 429 / 5xx → backoff 1 s / 60 s / 5 / full jitter, no skipped page; 403 → stop                 | P1       | @error @negative           | writes local (temp) | AC-17, FR-017, NFR-002, NFR-006                | T050                         | Vitest `permits-backfill.test.ts`                            |
| A-04-TC-054   | Stop → resume from the last committed page                                                    | P1       | @error                     | writes local (temp) | AC-17, FR-017                                  | T051                         | Vitest `permits-backfill.test.ts`                            |
| A-04-TC-055   | Upstream delete → `source_removed` tombstone; re-key is not a tombstone                       | P2       | @edge                      | writes local (temp) | FR-021                                         | T052, T053                   | Vitest `permits-incremental.test.ts`                         |
| A-04-TC-056   | New status in a later page → upsert by permit number + jurisdiction                           | P2       | @edge                      | writes local (temp) | FR-021                                         | T052, T053                   | Vitest `permits-incremental.test.ts`                         |
| A-04-TC-NF-01 | Page count, duration, throughput recorded for `docs/source-limits.md`                         | P1       | @perf @docs                | read-only           | AC-8, AC-12, FR-008, FR-012                    | T011, T045, T056, T087       | Vitest `source-limits.test.ts`                               |
| A-04-TC-NF-02 | Query DB never exported; nothing uploaded; no connection string in `apps/` / `infra/`         | P1       | @security                  | read-only           | FR-024, P0-1, P0-2                             | T012                         | `grep` + `bash scripts/grep-gates.sh`                        |
| A-04-TC-NF-03 | No GIS request ever left the laptop                                                           | P1       | @security @harness         | read-only           | FR-007, ARD § 8                                | T041, T042                   | `grep` over receipts and code                                |

Vitest files are under `pipeline/oracle-runtime/test/travis/a04/` unless another path is given (`test/probes/`, `pipeline/local-stack/test/`).

## 8. Functional test cases

Every case's step 0 is: **in a terminal at the repo root, run `git rev-parse --abbrev-ref HEAD`** → prints exactly `004-property-backbone` (any other output stops the case). `qdb_ro` is defined as in § 3.3.

### Part A-04: TCAD property and owner backbone

#### A-04-TC-001: 25-parcel pilot: owner, mailing, situs, year built, provenance (happy path)

- **Priority / tags:** P1 · `@pipeline @demo` · **writes local**
- **Maps to:** AC-1, FR-001 · demo D-3 · tasks T027, T062, T063
- **Preconditions:** local stack up and migrated; `permits --mode pilot` done and the `ANCHOR2 …` line in run-log.md (§ 5, T062). geoID 0208011301 is not on the roll and is not a seed row (TC-003).
- **Steps:** 0. `git rev-parse --abbrev-ref HEAD` → `004-property-backbone`.
  1. **Run** `npm --prefix pipeline/oracle-runtime run backbone -- pilot --select` → exit 0.
  2. **Run** `wc -l < pipeline/data/seeds/travis-a04-pilot.csv` and `grep -c -E "^(221829|{ANCHOR2_PID})," pipeline/data/seeds/travis-a04-pilot.csv`.
  3. **Run** `npm --prefix pipeline/oracle-runtime run backbone -- pilot --seed pipeline/data/seeds/travis-a04-pilot.csv` → last line `job_id=travis-a04-pilot-…`, exit 0.
  4. **Run** `qdb_ro "SELECT count(*), count(*) FILTER (WHERE owner_name IS NOT NULL OR owner_missing_reason IS NOT NULL), count(*) FILTER (WHERE property_structure_built_year IS NOT NULL OR year_built_missing_reason IS NOT NULL), count(source_url), count(captured_at), count(record_sha256) FROM parcels WHERE job_id = '{JOB_ID}'"`.
  5. **Run** `qdb_ro "SELECT request_identifier, owner_name IS NOT NULL OR owner_missing_reason = 'owner_confidential', owner_mailing_postal_code IS NOT NULL OR owner_redacted, situs_address IS NOT NULL, property_structure_built_year, source_url, captured_at, length(record_sha256) FROM parcels WHERE job_id = '{JOB_ID}' AND request_identifier IN ('221829','{ANCHOR2_PID}') ORDER BY 1"`.
  6. **Run** `grep -c -E "^.*ANCHOR2 geoID=[0-9]{10} pID=[0-9]{1,7} permit=" specs/004-property-backbone/run-log.md`.
- **Expected result:** step 2 prints `26` (header + 25) and `2`. Step 4 prints `25|25|25|25|25|25`. Step 5 prints two rows; the 221829 row is exactly `221829|t|t|t|1941|https://traviscad.org/wp-content/largefiles/2026%20Certified%20JSON%20SUPP%200%2007182026.zip|2026-10-19 21:33:41.241+00|64`; the `{ANCHOR2_PID}` row is `{ANCHOR2_PID}|t|t|t|{year}|` + the same URL and capture time + `|64`. Step 6 prints `1`.

#### A-04-TC-002: Pilot County group validates; transform coverage lists every mapped field

- **Priority / tags:** P1 · `@pipeline` · **writes local (temp)**
- **Maps to:** AC-1, FR-001 · tasks T027, T063
- **Steps:** 0. `git rev-parse --abbrev-ref HEAD` → `004-property-backbone`.
  1. **Run** `ls pipeline/data/runs/{JOB_ID}/groups/county | grep -c '\.zip$'`.
  2. **Run** `~/.local/share/elephant-cli-main/node_modules/.bin/elephant-cli validate pipeline/data/runs/{JOB_ID}/groups/county -o "$TMPDIR/a04-tc002-errors.csv"`; then `echo $?`.
  3. **Run** `(cd pipeline/oracle-runtime && npx vitest run test/travis/a04/tcad-backbone.test.ts -t "A-04-TC-002")`.
- **Expected result:** step 1 prints the number of R accounts in the pilot seed (P / MH / MN rows are `out_of_scope` and not emitted). Step 2 reports 0 errors and `echo` prints `0`. Step 3 prints `✓ A-04-TC-002` and `1 passed`: one `<pID>.zip` per R property, geometry only when `coordinate_source = gis_centroid`, never a permit point, no redacted owner field in any zip; every export field the transform maps (owner name, mailing address, situs, year built, improvements, sale date, geometry) appears in the coverage report with `extracted: true`; a field removed from a copy of the map makes the test fail naming that field.

#### A-04-TC-003: Negative anchor: geoID 0208011301 not on the roll → no property invented (negative, D-4)

- **Priority / tags:** P1 · `@negative @missing-data` · **read-only**
- **Maps to:** AC-1, FR-001, D-4 · tasks T054, T062
- **Steps:** 0. `git rev-parse --abbrev-ref HEAD` → `004-property-backbone`.
  1. **Run** `qdb_ro "SELECT count(*) FROM parcels WHERE geo_id = '0208011301'"`.
  2. **Run** `qdb_ro "SELECT count(*) FROM parcel_geoids WHERE geo_id = '0208011301'"`.
  3. **Run** `qdb_ro "SELECT permit_number, request_identifier IS NULL, unmatched_reason FROM property_improvements WHERE tcad_id = '0208011301' AND permit_number = '1982-012866 BP'"`.
- **Expected result (PASS):** step 1 prints `0` and step 2 prints `0`; step 3 prints exactly `1982-012866 BP|t|no_tcad_geoid` (kept and counted, unmatched with its reason).

#### A-04-TC-004: Key is the pID as printed; 0223120506 → 221829; join proof both ways

- **Priority / tags:** P1 · `@pipeline` · **read-only**
- **Maps to:** AC-1, FR-001, P0-5 · tasks T022, T028, T081
- **Steps:** 0. `git rev-parse --abbrev-ref HEAD` → `004-property-backbone`.
  1. **Run** `qdb_ro "SELECT request_identifier, geo_id, prop_type FROM parcels WHERE geo_id = '0223120506'"`.
  2. **Run** `qdb_ro "SELECT count(*) FROM parcels WHERE request_identifier !~ '^[1-9][0-9]{0,6}$'"`.
  3. **Run** `npm --prefix pipeline/oracle-runtime run backbone -- ingest --join-proof --job {JOB_ID} --seed {SEED}` (full-county job).
- **Expected result:** step 1 prints exactly `221829|0223120506|R`. Step 2 prints `0` (every key is the pID as printed, never padded or the geoID). Step 3's last line is `join_proof=pass matched={m} disagreements=0` with `m` ≥ 1 (1,000-row geoID → pID proof plus 1,000-row reverse proof; the seed is the one in run-log.md).

#### A-04-TC-005: Full roll reconciles: difference < 9,865, 0 unexplained; confidential in `loaded` (scale)

- **Priority / tags:** P1 · `@scale @pipeline` · **writes local**
- **Maps to:** AC-2, FR-002, NFR-001, D-5, D-7 · tasks T025, T026, T076, T084
- **Preconditions:** no other `backbone_runs` row is `running` (TC-018).
- **Steps:** 0. `git rev-parse --abbrev-ref HEAD` → `004-property-backbone`.
  1. **Run** `npm --prefix pipeline/oracle-runtime run backbone -- ingest --track appraisal` → last line `job_id=travis-a04-…`, exit 0.
  2. **Run** `qdb_ro "SELECT class, count(*) FROM roll_reconciliation WHERE job_id = '{JOB_ID}' GROUP BY class ORDER BY class"`.
  3. **Run** `qdb_ro "SELECT count(DISTINCT request_identifier) FROM parcels WHERE job_id = '{JOB_ID}'"`.
  4. **Run** `qdb_ro "SELECT prop_type, count(*) FROM parcels WHERE job_id = '{JOB_ID}' GROUP BY prop_type ORDER BY prop_type"`.
  5. **Run** `qdb_ro "SELECT prop_type, count(*) FROM parcels WHERE job_id = '{JOB_ID}' AND owner_redacted AND owner_redaction_rule = 'sales_confidential_code' GROUP BY 1 ORDER BY 1"`.
  6. **Run** `npm --prefix pipeline/oracle-runtime run backbone -- report --job {JOB_ID} --json | jq -r '.roll | [.n, .loaded, .difference, .unexplained] | @tsv'`.
  7. **Run** `npm --prefix pipeline/oracle-runtime run backbone -- report --job {JOB_ID} --json | jq -r '.limitations[]' | grep -E "§25.025"`.
- **Expected result (one outcome):** step 2 lists only classes from {`dead`, `invalid`, `loaded`, `transform_failure`} (any other class, including `confidential` or `unexplained`, fails the case); their sum = **493,246** (N, re-measured from the same file). Step 3 = the `loaded` count. N − `loaded` < **9,865**. Step 4 prints exactly four rows `MH|…`, `MN|…`, `P|…`, `R|…`, each equal to the export count of that type (MH 11,744, MN 5, P 39,536, R 441,961) minus that type's `dead` + `invalid` + `transform_failure`. Step 5 prints `R|15410` (re-measured; plus a row per other type only if the export holds codes on it): the confidential accounts are **in** `loaded`. Step 6 prints `493246\t{loaded}\t{N − loaded}\t0`. Step 7 prints exactly the two lines `Confidential owner records redacted (Texas Tax Code §25.025): {n}` (n = step 5 total) and `source export carries no §25.025 marker; conservative suppression on sale-confidentiality codes`.

#### A-04-TC-006: `monitoring-county-ingestion`: run complete, seed = sum of classes

- **Priority / tags:** P1 · `@scale` · **read-only**
- **Maps to:** AC-2, FR-002 · verify `monitoring-county-ingestion` · tasks T008, T026, T076
- **Steps:** 0. `git rev-parse --abbrev-ref HEAD` → `004-property-backbone`.
  1. **Run** `restate sql "SELECT status FROM sys_invocation WHERE target_service_name = 'TcadBackbone' AND target_service_key = '{JOB_ID}'"`.
  2. **Run** `qdb_ro "SELECT status, as_of IS NOT NULL, export_sha256 FROM backbone_runs WHERE job_id = '{JOB_ID}'"`.
  3. **Run** `qdb_ro "SELECT sum(c) FROM (SELECT count(*) c FROM roll_reconciliation WHERE job_id = '{JOB_ID}') s"` and `qdb_ro "SELECT value->>'mergedCount' FROM watermarks WHERE track = 'tcad' AND job_id = '{JOB_ID}'"`.
- **Expected result:** step 1 prints `completed`. Step 2 prints `complete|t|6f7a758568fd03fa200e996d2756559eb53e13241238a004cbadac09ff4c2346`. Step 3 prints **493,246** (seed count, re-measured) and a `mergedCount` equal to the `loaded` class of TC-005.

#### A-04-TC-007: Several improvements → one property, children kept (edge)

- **Priority / tags:** P2 · `@edge` · **read-only**
- **Maps to:** FR-018 · tasks T022
- **Steps:** 0. `git rev-parse --abbrev-ref HEAD` → `004-property-backbone`.
  1. **Run** `(cd pipeline/oracle-runtime && npx vitest run test/travis/a04/tcad-backbone.test.ts -t "A-04-TC-007")` (synthetic test input: one export-shaped record with three improvements and `imprvActualYearBuilt = 0`).
  2. **Run** `qdb_ro "SELECT p.request_identifier, count(s.*), p.year_built_rule FROM parcels p JOIN property_structures s ON s.request_identifier = p.request_identifier WHERE p.job_id = '{JOB_ID}' GROUP BY 1,3 HAVING count(s.*) > 1 ORDER BY 1 LIMIT 1"`.
- **Expected result:** step 1 `✓ A-04-TC-007`: one `parcels` row, three `property_structures` rows, year built = the largest-living-area main residential improvement's year, `year_built_rule = largest_main_improvement`. Step 2 prints one row `{pID}|{n ≥ 2}|{rule}` with `rule` ∈ {`profile_main`, `largest_main_improvement`}.

#### A-04-TC-008: Two accounts with the same situs → both kept (edge)

- **Priority / tags:** P2 · `@edge` · **read-only**
- **Maps to:** FR-019 · tasks T022
- **Steps:** 0. `git rev-parse --abbrev-ref HEAD` → `004-property-backbone`.
  1. **Run** `(cd pipeline/oracle-runtime && npx vitest run test/travis/a04/tcad-backbone.test.ts -t "A-04-TC-008")`.
  2. **Run** `qdb_ro "SELECT situs_address::text, count(*), count(DISTINCT request_identifier) FROM parcels WHERE job_id = '{JOB_ID}' AND situs_address IS NOT NULL GROUP BY 1 HAVING count(*) > 1 ORDER BY 1 LIMIT 1"`.
- **Expected result:** step 1 `✓ A-04-TC-008` (two synthetic accounts, one situs → two rows, no merge). Step 2 prints one row where the two counts are equal and ≥ 2.

#### A-04-TC-009: Supplemental export during the run is not mixed in (edge)

- **Priority / tags:** P2 · `@edge` · **read-only**
- **Maps to:** FR-019 · tasks T026
- **Steps:** 0. `git rev-parse --abbrev-ref HEAD` → `004-property-backbone`.
  1. **Run** `(cd pipeline/oracle-runtime && npx vitest run test/travis/a04/tcad-backbone.test.ts -t "A-04-TC-009")` (puts a second export file `…SUPP 1…` in the input dir mid-run; synthetic test input).
  2. **Run** `qdb_ro "SELECT count(DISTINCT export_sha256), min(export_sha256) FROM parcels WHERE job_id = '{JOB_ID}'"`.
- **Expected result:** step 1 `✓ A-04-TC-009`: the supplemental file is refused and contributes 0 rows. Step 2 prints exactly `1|6f7a758568fd03fa200e996d2756559eb53e13241238a004cbadac09ff4c2346`.

#### A-04-TC-010: Out-of-area owner: regional / out_of_area with list SHA-256

- **Priority / tags:** P1 · `@pipeline` · **read-only**
- **Maps to:** AC-3, FR-003, AD-26 · Query DB only (D-9: public views carry `not_in_export`) · tasks T023
- **Steps:** 0. `git rev-parse --abbrev-ref HEAD` → `004-property-backbone`.
  1. **Run** `(cd pipeline/oracle-runtime && npx vitest run test/travis/a04/owner-area.test.ts -t "A-04-TC-010")` (mailing ZIPs 78701 → `in_county`, 78665 (regional list, Williamson; 78664 is a Travis ZCTA → `in_county`) → `regional`, 10001 → `out_of_area`).
  2. **Run** `qdb_ro "SELECT owner_area_class, owner_is_out_of_area, count(*), count(DISTINCT area_list_sha256) FROM parcels WHERE job_id = '{JOB_ID}' GROUP BY 1,2 ORDER BY 1,2"`.
  3. **Run** `qdb_ro "SELECT DISTINCT area_list_sha256 FROM parcels WHERE job_id = '{JOB_ID}'"` and `cat packages/query-core/gazetteer/travis-places@1.0.0/DIGEST`.
- **Expected result:** step 1 `✓ A-04-TC-010` with those three classes and `owner_is_out_of_area` `false` / `true` / `true`. Step 2 rows only `in_county|f|…|1`, `out_of_area|t|…|1`, `regional|t|…|1`, `unknown||…|1`. Step 3 prints the same 64-hex value twice: `0f4c08a8bda573737adecc7d62e84d629aadc5005b987f2f787e4fd31ab5d17f`.

#### A-04-TC-011: Abroad or missing ZIP → out_of_area only with evidence, else unknown (negative)

- **Priority / tags:** P1 · `@negative @missing-data` · **read-only**
- **Maps to:** AC-3, FR-003 · Query DB only (D-9) · tasks T023
- **Steps:** 0. `git rev-parse --abbrev-ref HEAD` → `004-property-backbone`.
  1. **Run** `(cd pipeline/oracle-runtime && npx vitest run test/travis/a04/owner-area.test.ts -t "A-04-TC-011")`: (a) `addrCountry = CANADA`, no US ZIP → `out_of_area`, `owner_area_evidence = foreign_mailing`; (b) ZIP null, country null → `unknown`, `owner_is_out_of_area` null, evidence `no_zip`; (c) ZIP `ABCDE` → `unknown`, evidence `zip_not_zcta`; (d) a redacted owner → `unknown`.
  2. **Run** `qdb_ro "SELECT count(*) FROM parcels WHERE job_id = '{JOB_ID}' AND owner_area_class = 'out_of_area' AND owner_area_evidence IS NULL"`.
  3. **Run** `qdb_ro "SELECT count(*) FROM parcels WHERE job_id = '{JOB_ID}' AND owner_mailing_postal_code IS NULL AND owner_mailing_country IS NULL AND owner_area_class <> 'unknown' AND owner_area_evidence IS DISTINCT FROM 'foreign_mailing'"`.
- **Expected result:** step 1 `✓ A-04-TC-011` (four sub-cases). Steps 2 and 3 print `0` and `0`. (Step 3 excludes accounts classified `out_of_area` with evidence `foreign_mailing`: the rule also accepts the international-address flag when no ZIP and no country value exist; 243 such accounts on 2026-10-22.)

#### A-04-TC-012: No sale date → tenure_basis unknown, never tenure > 10 (missing data)

- **Priority / tags:** P1 · `@missing-data` · **read-only**
- **Maps to:** AC-4, FR-004 · tasks T023
- **Steps:** 0. `git rev-parse --abbrev-ref HEAD` → `004-property-backbone`.
  1. **Run** `(cd pipeline/oracle-runtime && npx vitest run test/travis/a04/tenure.test.ts -t "A-04-TC-012")`.
  2. **Run** `qdb_ro "SELECT tenure_basis, count(*) FILTER (WHERE is_long_tenure), count(*) FILTER (WHERE tenure_years IS NOT NULL), count(*) FILTER (WHERE tenure_missing_reason = 'no_dated_sale'), count(*) FROM parcels WHERE job_id = '{JOB_ID}' AND last_ownership_transfer_date IS NULL GROUP BY 1"`.
- **Expected result:** step 1 `✓ A-04-TC-012`: a record with no `sales[].saleDt` gives `tenure_basis = unknown`, `tenure_years` null, `is_long_tenure` null (never `true`), reason `no_dated_sale`; `as_of` = run `finishedAt`. Step 2 prints exactly one row `unknown|0|0|{n}|{n}` (on the full roll `n` = 317,819 accounts without a dated sale, re-measured 2026-10-22).

#### A-04-TC-013: No year built → roof_age_basis unknown with reason (missing data)

- **Priority / tags:** P1 · `@missing-data` · **read-only**
- **Maps to:** AC-4, FR-004 · tasks T022
- **Steps:** 0. `git rev-parse --abbrev-ref HEAD` → `004-property-backbone`.
  1. **Run** `(cd pipeline/oracle-runtime && npx vitest run test/travis/a04/tenure.test.ts -t "A-04-TC-013")`.
  2. **Run** `qdb_ro "SELECT roof_age_basis, roof_age_reason, year_built_missing_reason, count(*) FROM parcels WHERE job_id = '{JOB_ID}' AND property_structure_built_year IS NULL GROUP BY 1,2,3"`.
- **Expected result:** step 1 `✓ A-04-TC-013`: no year in `propertyProfile[0]` (0 = missing) nor in the improvements → year null, `year_built_missing_reason = source_missing`, `roof_age_basis = unknown`, `roof_age_reason = no_roof_date`. Step 2 prints exactly one row `unknown|no_roof_date|source_missing|{n}` (R with no year built 52,521 on the snapshot, plus non-R, re-measured).

#### A-04-TC-014: Sales confidentiality code → owner redacted before validate; loaded; limitations (security, D-7)

- **Priority / tags:** P1 · `@security @pipeline` · **writes local (temp)**
- **Maps to:** AC-5, FR-005, P0-15 · tasks T021
- **Steps:** 0. `git rev-parse --abbrev-ref HEAD` → `004-property-backbone`.
  1. **Run** `(cd pipeline/oracle-runtime && npx vitest run test/travis/a04/confidential.test.ts -t "A-04-TC-014")` (synthetic test input shaped like the export: one record with `sales[].confidentialCode = "Q"`, one with `"O"`, one with a `Q` code on an older sale only, one with `confidentialSale: true`, and one control with no code; sentinel owner `ZZCONFIDENTIALSENTINEL` on the four coded records, `ZZCONTROLOWNER` on the control).
- **Expected result:** `✓ A-04-TC-014`: (a) the recorded step order is `redact → map → store → validate`; (b) the files handed to `validate` carry no `person_*`, `company_*` or `mailing_address_*` for the four coded records, and the control keeps its owner; (c) the run's limitations contain exactly `Confidential owner records redacted (Texas Tax Code §25.025): 4` and `source export carries no §25.025 marker; conservative suppression on sale-confidentiality codes`; (d) all five are `roll_reconciliation.class = loaded` (no `confidential` class), the four with `owner_redacted = true`, `owner_redaction_rule = sales_confidential_code`, `owner_missing_reason = owner_confidential`; (e) the temp output dir path is written to `pipeline/oracle-runtime/test/.out/A-04-TC-014.path`.

#### A-04-TC-015: Confidential name in no output (grep check)

- **Priority / tags:** P1 · `@security @negative` · **read-only**
- **Maps to:** AC-5, FR-005 · tasks T021, T066
- **Steps:** 0. `git rev-parse --abbrev-ref HEAD` → `004-property-backbone`.
  1. **Run** TC-014 first (it leaves its temp output dir path in `pipeline/oracle-runtime/test/.out/A-04-TC-014.path`).
  2. **Run** `grep -r -l -a ZZCONFIDENTIALSENTINEL "$(cat pipeline/oracle-runtime/test/.out/A-04-TC-014.path)" pipeline/data/artifacts pipeline/data/runs docs 2>/dev/null | wc -l`.
  3. **Run** `qdb_ro "SELECT count(*) FROM parcels WHERE job_id = '{JOB_ID}' AND owner_redacted AND (owner_name IS NOT NULL OR owner_mailing_postal_code IS NOT NULL OR payload_redacted::text ~* 'ownerName|addrLine')"`.
- **Expected result:** step 2 prints `0` (the sentinel is in no transform output, validate input, log or report); step 3 prints `0`.
- **Live check with real names (T066, lead):** `scripts/verify-batched.sh <names-file>` prints hits per table. Read it as follows: the redacted account's own rows, the County group files, the archives and every log must show **0**; a name that TCAD also publishes on other, uncoded accounts (here one company name on 170 other accounts) is reported as a *shared public name* with its count and is not a failure. Raw Austin permit payloads (`permit_source_rows`) are internal source data and may contain applicant names. Result on 2026-10-22: see the run-log analysis row.

#### A-04-TC-016: Export mismatch / injected 403 → `waiting_human`, nothing loaded as complete (negative)

- **Priority / tags:** P1 · `@negative @error @security` · **writes local (temp)**
- **Maps to:** AC-6, FR-006, NFR-002 · tasks T020, T026
- **Steps:** 0. `git rev-parse --abbrev-ref HEAD` → `004-property-backbone`.
  1. **Run** `(cd pipeline/oracle-runtime && npx vitest run test/probes/tcad.test.ts -t "A-04-TC-016")` (synthetic zip whose SHA-256 differs from the A-01 receipt).
  2. **Run** `(cd pipeline/oracle-runtime && npx vitest run test/travis/a04/workflow.blocked-a04.test.ts -t "A-04-TC-016")` (export missing → stop; then the durable promise is resolved and the fake TCAD host answers 403 to the one download).
- **Expected result:** step 1 `✓ A-04-TC-016`: the run stops with `export_sha256_mismatch`, the export is re-hashed only when `{size, mtime, inode}` changed. Step 2 `✓ A-04-TC-016`: before any request `backbone_runs.status = waiting_human` (CLI exit 3) and the request log is empty; after resolve exactly **one** request with the project User-Agent; on its 403 one receipt `outcome: "blocked"`, `http_status: 403`, URL and UTC time; status `waiting_human` again; no retry; 0 `parcels` rows and 0 `roll_reconciliation` rows for the run's `job_id`; the Loader watermark unchanged; the report does not say `complete`.

#### A-04-TC-017: Source etiquette: one User-Agent, GIS ≤ 2 / Austin ≤ 1 req/s, stop on first 403

- **Priority / tags:** P1 · `@security` · **writes local (temp)**
- **Maps to:** AC-6, FR-006, NFR-002 · tasks T003, T026
- **Steps:** 0. `git rev-parse --abbrev-ref HEAD` → `004-property-backbone`.
  1. **Run** `(cd pipeline/oracle-runtime && npx vitest run test/travis/a04/workflow.blocked-a04.test.ts -t "A-04-TC-017")`.
- **Expected result:** `✓ A-04-TC-017`: (a) after the first 403 the request log has **0** further requests to that host (TCAD, GIS and Austin fakes each tested), receipt `outcome: "blocked"`, `http_status: 403`; (b) every request carries the single project User-Agent from `source-client.ts`; no proxy, header rotation or challenge solving; (c) `HOST_POLICY`: max in-flight GIS requests = **2** with a config value of 5; TCAD concurrency 1; (d) Austin request start times ≥ **1,000 ms** apart; (e) a 429 in a separate run is retried with full-jitter backoff (base 1 s, cap 60 s, 5 attempts) as contrast.

#### A-04-TC-018: One ingest run at a time; one writer into the Query DB (negative)

- **Priority / tags:** P1 · `@negative @harness` · **writes local (temp)**
- **Maps to:** FR-025, P0-10 · tasks T008, T009, T010, T074, T076
- **Steps:** 0. `git rev-parse --abbrev-ref HEAD` → `004-property-backbone`.
  1. **Run** `(cd pipeline/oracle-runtime && npx vitest run test/travis/a04/cli.test.ts -t "A-04-TC-018")` (fake `BackboneReport/running` returns job `travis-a04-202610220100`).
  2. **Run** `(cd pipeline/local-stack && npx vitest run test/loader.test.ts -t "A-04-TC-018")`.
  3. **Run** `qdb_ro "SELECT count(*) FROM backbone_runs a JOIN backbone_runs b ON a.job_id < b.job_id AND a.track IN ('appraisal','permits') AND b.track IN ('appraisal','permits') AND a.mode IN ('full','backfill','incremental') AND b.mode IN ('full','backfill','incremental') AND tstzrange(a.started_at, a.finished_at) && tstzrange(b.started_at, b.finished_at)"`.
- **Expected result:** step 1 `✓ A-04-TC-018`: `ingest --track appraisal` exits **1** and stderr names `travis-a04-202610220100`; no Restate call is sent. Step 2 `✓ A-04-TC-018`: no module in `pipeline/local-stack/services` other than the Loader (and `migrate.ts`) opens a write transaction (static scan); a repeated merge of the same `(track, artifact_sha256)` writes 0 rows. Step 3 prints `0` (the Austin backfill / incremental and the full TCAD run never overlapped).

### Part A-05: Coordinates

#### A-04-TC-020: GIS paged on the US runner (pilot push, then full), ≤ 2,000 per page, ≤ 2 concurrent (scale)

- **Priority / tags:** P1 · `@scale` · **runner calls GIS** (PO-approved, D-2; never from the laptop)
- **Maps to:** AC-7, AC-8, FR-007, FR-008, D-2 · tasks T041, T042, T071, T072
- **Steps:** 0. `git rev-parse --abbrev-ref HEAD` → `004-property-backbone`.
  1. **Run** `(cd pipeline/oracle-runtime && npx vitest run test/travis/a04/gis-artifact.test.ts -t "A-04-TC-020 workflow")` (offline parse of `.github/workflows/a04-gis-capture.yml` and `runner-config.json`).
  2. **Set** `"mode": "pilot"` in `pipeline/oracle-runtime/travis/gis/runner-config.json`; **run** `git commit -m "A-04: GIS runner pilot" pipeline/oracle-runtime/travis/gis/runner-config.json && git push`.
  3. **Run** `gh run list --workflow a04-gis-capture.yml --branch 004-property-backbone --limit 1 --json databaseId,status,conclusion` → take `databaseId` as `{RUN_ID_PILOT}`; `gh run watch {RUN_ID_PILOT} --exit-status` → exit 0; `gh run download {RUN_ID_PILOT} -D pipeline/data/raw/gis/us-runner-{RUN_ID_PILOT}`.
  4. **Run** `(cd pipeline/oracle-runtime && GIS_ARTIFACT=pipeline/data/raw/gis/us-runner-{RUN_ID_PILOT} npx vitest run test/travis/a04/gis-artifact.test.ts -t "A-04-TC-020 pilot")`.
  5. **Set** `"mode": "full"`; **run** `git commit -m "A-04: GIS runner full" pipeline/oracle-runtime/travis/gis/runner-config.json && git push`; then step 3's commands for `{RUN_ID_GH}` into `pipeline/data/raw/gis/us-runner-{RUN_ID_GH}`.
  6. **Run** `(cd pipeline/oracle-runtime && GIS_ARTIFACT=pipeline/data/raw/gis/us-runner-{RUN_ID_GH} npx vitest run test/travis/a04/gis-artifact.test.ts -t "A-04-TC-020 full")`.
- **Expected result:** step 1 `✓`: `on.push.branches = [004-property-backbone]`, `paths` = the workflow file + `runner-config.json`, no `workflow_dispatch`, `permissions: {contents: read}`, no `secrets.` reference, no DB / `DATABASE_URL` / upload step, `upload-artifact` `retention-days: 7`, `outFields` holds no owner or address field. Step 3 lists exactly one run for the push with `conclusion: "success"`. Step 4 `✓` (passes before step 5 starts; the full push never runs without a passing pilot): `egress.txt` = `loc=US`; `meta.json`, `count.json`, `ids.json` present; one page with receipt URL, UTC time and SHA-256. Step 6 `✓ A-04-TC-020 full`: `egress.txt` = `loc=US`; `complete.json` present with `mode: "full"`; features = the layer count at capture (**373,683** on 2026-10-20, re-measured); pages = ceil(count / `bulkPageSize`) (**187** at 2,000); every page ≤ 2,000 objectIds; the union of page objectIds = `ids.json` (none missing, none twice); max concurrent requests ≤ 2; one receipt per page with URL, UTC time, SHA-256 equal to the page file.

#### A-04-TC-021: Negative anchor: 0208011301 gets no coordinate and no property (negative, D-4)

- **Priority / tags:** P1 · `@negative @missing-data` · **read-only**
- **Maps to:** AC-7, FR-007, D-4 · tasks T045, T054
- **Steps:** 0. `git rev-parse --abbrev-ref HEAD` → `004-property-backbone`.
  1. **Run** `qdb_ro "SELECT count(*) FROM parcels WHERE geo_id = '0208011301'"`.
  2. **Run** `qdb_ro "SELECT latitude IS NULL, longitude IS NULL FROM property_improvements WHERE permit_number = '1982-012866 BP'"`.
  3. **Run** `npm --prefix pipeline/oracle-runtime run backbone -- report --job {JOB_ID} --json | jq -c '[.coordinates.anchors[] | select(.geo_id == "0208011301")][0] | {on_roll, coordinate_source}'`.
- **Expected result (PASS):** step 1 prints `0`; step 2 prints `f|f` (re-measured 2026-10-22: Austin's own row for this permit now carries a point, 30.2716 / -97.7474, which is attached to no parcel because the geoID is on no 2026 account; the earlier plan expected `t|t`); step 3 prints exactly `{"on_roll":false,"coordinate_source":null}`.

#### A-04-TC-022: 221829 and `{ANCHOR2_PID}`: gis_centroid with layer URL, time, digest

- **Priority / tags:** P1 · `@pipeline` · **writes local**
- **Maps to:** AC-7, FR-007 · tasks T043, T044, T077
- **Steps:** 0. `git rev-parse --abbrev-ref HEAD` → `004-property-backbone`.
  1. **Run** `npm --prefix pipeline/oracle-runtime run backbone -- coords --gis-artifact pipeline/data/raw/gis/us-runner-{RUN_ID_GH}` → exit 0 (offline).
  2. **Run** `npm --prefix pipeline/oracle-runtime run backbone -- permits --link` then `npm --prefix pipeline/oracle-runtime run backbone -- coords --assemble-only` → both exit 0.
  3. **Run** `qdb_ro "SELECT request_identifier, coordinate_source, coordinate_rule IN ('centroid','interior_point','centroid_outside_polygon','largest_area'), latitude BETWEEN 30.0 AND 30.7, longitude BETWEEN -98.2 AND -97.3, coordinate_source_url LIKE 'https://gis.traviscountytx.gov/server1/rest/services/CIPStoryMap/Main_Location_Map2/MapServer/6/query?%', coordinate_captured_at IS NOT NULL, length(coordinate_sha256) FROM parcels WHERE request_identifier IN ('221829','{ANCHOR2_PID}') ORDER BY 1"`.
- **Expected result:** step 3 prints exactly two rows, `221829|gis_centroid|t|t|t|t|t|64` and `{ANCHOR2_PID}|gis_centroid|t|t|t|t|t|64` (point inside Travis County's bounding box, from a GIS feature, provenance = the GIS page that held it).

#### A-04-TC-023: Coverage: 99% of ordinary land parcels, condo-coded accounts separate, both ways (scale, missing data; PO exception D-17)

- **Priority / tags:** P1 · `@scale @missing-data` · **writes local** (local table export, never uploaded)
- **Maps to:** AC-8, FR-008, FR-010, FR-024, FR-026, NFR-003, DEC-A-04-coverage-exception · tasks T027, T044, T045, T079, T080
- **Preconditions:** the full-county `{JOB_ID}` is loaded, coordinates assembled, the County group hashed and exported (10 batches), tables combined.
- **Steps:** 0. `git rev-parse --abbrev-ref HEAD` → `004-property-backbone`.
  1. **Run** `qdb_ro "SELECT CASE WHEN state_cd IN ('A4','F4','O1') THEN 'condo-coded' ELSE 'ordinary' END grp, count(*), count(*) FILTER (WHERE coordinate_source = 'gis_centroid') gis, count(*) FILTER (WHERE coordinate_source IN ('gis_centroid','permit_point')) with_permit, count(*) FILTER (WHERE coordinate_source = 'none') nopoint FROM parcels WHERE prop_type = 'R' GROUP BY 1 ORDER BY 1"`.
  2. **Run** `qdb_ro "SELECT coordinate_rule, coalesce(coordinate_reason,'-'), count(*) FROM parcels WHERE prop_type = 'R' GROUP BY 1,2 ORDER BY 3 DESC"`.
  3. **Run** `qdb_ro "SELECT prop_type, coordinate_source, count(*) FROM parcels WHERE prop_type <> 'R' GROUP BY 1,2 ORDER BY 1"`.
  4. **Run** `npm --prefix pipeline/oracle-runtime run backbone -- coords --coverage --tables <combined parts of batches b01–b10>` (the combined parts come from the ten `export-tables` runs; never uploaded).
- **Expected result (D-17, PO exception):** step 1: `condo-coded|70609|…` and `ordinary|371352|{gis}|…`, with `{gis}` ≥ **367,639** (99.00% of 371,352; measured 369,990 = 99.63%); the condo-coded group is reported on its own (measured 20,071 public = 28.43%, 24,566 incl. permit points = 34.79%); all R: 441,961 at 88.26% public and 89.28% incl. permit points. Step 2: every no-point row carries a reason (`no_gis_feature`, `no_permit_point`); no row without a reason. Step 3: P 39,536, MH 11,744, MN 5 all `none` (out of scope, counted separately). Step 4 prints `v_property rows=441961 distinct_property_cid=441961 qdb_r_accounts=441961 explained_difference=0`, `coverage_gate=PASS` and `coverage_public=0.8826 coverage_qdb=0.8928` (equal to step 1 within 0.0005). Numbers are re-measured at run time.

#### A-04-TC-024: No GIS feature + permit point → permit_point with permit URL (Query DB)

- **Priority / tags:** P1 · `@pipeline` · **read-only**
- **Maps to:** AC-9, FR-009 · tasks T044
- **Steps:** 0. `git rev-parse --abbrev-ref HEAD` → `004-property-backbone`.
  1. **Run** `(cd pipeline/oracle-runtime && npx vitest run test/travis/a04/coordinates.test.ts -t "A-04-TC-024")`.
  2. **Run** `qdb_ro "SELECT p.request_identifier, p.coordinate_source, p.coordinate_rule, p.coordinate_source_url LIKE 'https://data.austintexas.gov/resource/3syk-w9eu.json%' FROM parcels p WHERE p.job_id = '{JOB_ID}' AND p.coordinate_source = 'permit_point' ORDER BY 1 LIMIT 1"`.
- **Expected result:** step 1 `✓ A-04-TC-024` (no feature, no real export point, no condo building point, a linked permit with lat/lon → `permit_point`; its County-group row has no geometry and reads `none` / `no_coordinates`). Step 2 prints one row `{pID}|permit_point|permit_point|t`.

#### A-04-TC-025: No GIS feature, no permit point → null with reason, never geocoded (missing data)

- **Priority / tags:** P1 · `@missing-data @negative` · **read-only**
- **Maps to:** AC-10, FR-010, FR-026 · tasks T027, T044
- **Steps:** 0. `git rev-parse --abbrev-ref HEAD` → `004-property-backbone`.
  1. **Run** `(cd pipeline/oracle-runtime && npx vitest run test/travis/a04/coordinates.test.ts -t "A-04-TC-025")` (`fetch` is spied; static scan for a geocoder import).
  2. **Run** `qdb_ro "SELECT count(*) FROM parcels WHERE job_id = '{JOB_ID}' AND ((latitude IS NULL) <> (coordinate_source = 'none') OR (latitude IS NULL) <> (coordinate_reason IS NOT NULL) OR (latitude IS NULL) <> (longitude IS NULL))"`.
  3. **Run** `grep -r -i -E "geocod|nominatim|maps\.googleapis|findAddressCandidates" pipeline/oracle-runtime/travis | wc -l`.
- **Expected result:** step 1 `✓ A-04-TC-025`: `latitude` / `longitude` null, `coordinate_source = none`, exactly one Query DB reason of `no_gis_feature` / `gis_null_geometry` / `no_permit_point`; the County-group record carries `no_coordinates` and none of the internal reason names; 0 fetch calls. Steps 2 and 3 print `0` and `0`.

#### A-04-TC-026: GIS timeout → backoff 1 s / 60 s / 5 attempts / full jitter → blocked; 403 → stop (error)

- **Priority / tags:** P1 · `@error @negative` · **writes local (temp)**
- **Maps to:** AC-11, FR-011, NFR-002, NFR-004 · tasks T041, T043
- **Steps:** 0. `git rev-parse --abbrev-ref HEAD` → `004-property-backbone`.
  1. **Run** `(cd pipeline/oracle-runtime && npx vitest run test/travis/a04/gis-adapter.test.ts -t "A-04-TC-026")` (fake ArcGIS server never answers page 3; fake timers; seeded RNG).
  2. **Run** `(cd pipeline/oracle-runtime && npx vitest run test/travis/a04/gis-artifact.test.ts -t "A-04-TC-026 import")` (artifact without `complete.json`).
- **Expected result:** step 1 `✓ A-04-TC-026`: 5 attempts on page 3 with 4 waits, wait k uniform in [0, min(60 s, 1 s × 2^(k−1))] = [0, 1 s], [0, 2 s], [0, 4 s], [0, 8 s] (bounds asserted; not all at the bound); then `blocked.json` and a receipt `outcome: "blocked"` with `blocked_at`; no `complete.json`; pages 1–2 kept. A separate run where page 3 answers 403 makes **exactly one** request to page 3 and no further request. Step 2 `✓`: import status `blocked`; the report limitation is exactly `gis: blocked at {ts}; coverage not complete`; no coverage figure reported as complete.

#### A-04-TC-027: GIS restart → resume from the last completed page

- **Priority / tags:** P1 · `@error` · **writes local (temp)**
- **Maps to:** AC-11, FR-011 · tasks T041
- **Steps:** 0. `git rev-parse --abbrev-ref HEAD` → `004-property-backbone`.
  1. **Run** `(cd pipeline/oracle-runtime && npx vitest run test/travis/a04/gis-adapter.test.ts -t "A-04-TC-027")` (kills the fetch after page 4 of 10 is checkpointed, restarts with the same `checkpoints/`).
- **Expected result:** `✓ A-04-TC-027`: the first network request after restart is page 5's `objectIds=` query; pages 1–4 get receipts `outcome: "skipped_checkpoint"` and are not requested again; the snapshot / objectIds digests are re-checked; final feature count = the fake total; no duplicate object ids.

#### A-04-TC-028: GIS page size ≤ 2,000 and concurrency ≤ 2 under load (NFR)

- **Priority / tags:** P1 · `@perf` · **writes local (temp)**
- **Maps to:** AC-11, FR-011, NFR-004 · tasks T041
- **Steps:** 0. `git rev-parse --abbrev-ref HEAD` → `004-property-backbone`.
  1. **Run** `(cd pipeline/oracle-runtime && npx vitest run test/travis/a04/gis-adapter.test.ts -t "A-04-TC-028")` (fake server, 400 pages, 200 ms latency, records in-flight count; `maxRecordCount` 2,000).
- **Expected result:** `✓ A-04-TC-028`: every `objectIds=` request holds ≤ 2,000 ids (and ≤ `maxRecordCount` when lower); only those requests carry `returnGeometry=true`, `outSR=4326`, `geometryPrecision=7`; maximum in-flight count is exactly 2; a config `bulkConcurrency` of 5 is clamped to 2.

#### A-04-TC-029: Split parcel → one point by the recorded rule, others counted (edge)

- **Priority / tags:** P2 · `@edge` · **read-only**
- **Maps to:** FR-020 · tasks T040, T045
- **Steps:** 0. `git rev-parse --abbrev-ref HEAD` → `004-property-backbone`.
  1. **Run** `(cd pipeline/oracle-runtime && npx vitest run test/travis/a04/coordinates.test.ts -t "A-04-TC-029")`.
  2. **Run** `npm --prefix pipeline/oracle-runtime run backbone -- report --job {JOB_ID} --json | jq -c '.coordinates.multi_feature'`.
- **Expected result:** step 1 `✓ A-04-TC-029`: one pID with 3 features → one point from the largest area (tie → lowest OBJECTID), `coordinate_rule = largest_area`, 2 extra features counted. Step 2 prints `{"pids":{n},"extra_features":{m},"rule":"largest_area"}` (re-measured).

#### A-04-TC-030: Permit point > 0.5 mi from GIS → GIS kept, permit flagged (edge)

- **Priority / tags:** P2 · `@edge` · **read-only**
- **Maps to:** FR-020 · tasks T044
- **Steps:** 0. `git rev-parse --abbrev-ref HEAD` → `004-property-backbone`.
  1. **Run** `(cd pipeline/oracle-runtime && npx vitest run test/travis/a04/coordinates.test.ts -t "A-04-TC-030")` (GIS point and a permit point 0.6 mi apart; 0.4 mi as contrast).
  2. **Run** `qdb_ro "SELECT count(*) FROM parcels WHERE job_id = '{JOB_ID}' AND coordinate_review_flag = 'permit_far_from_gis' AND coordinate_source <> 'gis_centroid'"`.
- **Expected result:** step 1 `✓ A-04-TC-030`: at 0.6 mi `coordinate_source = gis_centroid` kept and `coordinate_review_flag = permit_far_from_gis` on the parcel and on the permit's `property_improvements` row; at 0.4 mi no flag. Step 2 prints `0`.

#### A-04-TC-031: L-shaped lot → interior point, rule recorded (edge)

- **Priority / tags:** P2 · `@edge` · **read-only**
- **Maps to:** FR-020 · tasks T040
- **Steps:** 0. `git rev-parse --abbrev-ref HEAD` → `004-property-backbone`.
  1. **Run** `(cd pipeline/oracle-runtime && npx vitest run test/travis/a04/coordinates.test.ts -t "A-04-TC-031")`.
- **Expected result:** `✓ A-04-TC-031`: for L- and U-shaped polygons whose centroid lies outside, the point is inside the polygon (polylabel, 1e-7°) and `coordinate_rule = interior_point`; when no interior point can be computed, `coordinate_rule = centroid_outside_polygon`; a convex polygon gives `coordinate_rule = centroid`.

#### A-04-TC-032: GIS is compared with the roll, never the population (negative)

- **Priority / tags:** P1 · `@negative` · **read-only**
- **Maps to:** AC-7, FR-007, A-01 preflight rule · tasks T044, T045
- **Steps:** 0. `git rev-parse --abbrev-ref HEAD` → `004-property-backbone`.
  1. **Run** `qdb_ro "SELECT count(*) FROM parcels p WHERE p.job_id = '{JOB_ID}' AND NOT EXISTS (SELECT 1 FROM roll_reconciliation r WHERE r.job_id = '{JOB_ID}' AND r.request_identifier = p.request_identifier AND r.class = 'loaded')"`.
  2. **Run** `npm --prefix pipeline/oracle-runtime run backbone -- report --job {JOB_ID} --json | jq '.coordinates.gis_features_without_roll_account'`.
- **Expected result:** step 1 prints `0` (no property created from a GIS feature); step 2 prints an integer ≥ 0 (counted, not loaded).

#### A-04-TC-033: Condo / shared-geoID units → building's point by `condo_building_point` (edge, D-1)

- **Priority / tags:** P1 · `@edge` · **read-only**
- **Maps to:** AC-8, FR-008, FR-026, D-1 · tasks T044, T045
- **Steps:** 0. `git rev-parse --abbrev-ref HEAD` → `004-property-backbone`.
  1. **Run** `(cd pipeline/oracle-runtime && npx vitest run test/travis/a04/coordinates.test.ts -t "A-04-TC-033")` (synthetic test input: three R units with no own feature sharing one geoID with exactly one candidate point; a second geoID with two distinct candidate points).
  2. **Run** `qdb_ro "SELECT coordinate_source, count(*) FROM parcels WHERE job_id = '{JOB_ID}' AND coordinate_rule = 'condo_building_point' GROUP BY 1"`.
  3. **Run** `npm --prefix pipeline/oracle-runtime run backbone -- report --job {JOB_ID} --json | jq -c '.coordinates.condo_building_point'`.
- **Expected result:** step 1 `✓ A-04-TC-033`: all three units get exactly the building's point, `coordinate_source = gis_centroid`, `coordinate_rule = condo_building_point`, provenance = the building feature's page URL, time and digest; the geoID with two candidates gives no point and `coordinate_reason = no_gis_feature`, never a neighbour's. Step 2 prints one row `gis_centroid|{n}` (re-measured). Step 3 prints `{"accounts":{n},"buildings":{b ≥ 1},"rule":"condo_building_point"}`.

#### A-04-TC-034: Condo unit with no polygon → exact, unique City of Austin address point, `address_point` (edge, ADR 0004, A-11 Run 3)

- **Priority / tags:** P1 · `@edge` · **read-only**
- **Maps to:** AC-8, FR-008, FR-010, D-1 · A-11 Run 3 gap 4 (ERR-65)
- **Steps:**
  1. **Run** `(cd pipeline/oracle-runtime && npx vitest run test/travis/a11)` (synthetic input: normalisation, unique / ambiguous / outside-county / no-match / no-address matching, never over a GIS centroid, an export point or a condo building point, `geometryFor`, the loader's politeness).
  2. **Run** `(cd pipeline/local-stack && npx vitest run test/tracks/address-points.test.ts)`.
  3. **Run** `(cd pipeline/oracle-runtime && npm run address-point-evidence -- <accounts.jsonl>)` over a read-only export of `parcels`.
- **Expected result:** a unit with no GIS feature takes the building's single address point with `coordinate_source = address_point`, `coordinate_rule = address_point` and the layer record as provenance; two distinct points give no point and `address_point_ambiguous`; a point outside the Travis County box gives no point and `address_point_outside_county`; a GIS centroid is never replaced; a permit point is still never written as geometry. Step 3 reports 43,955 new points, coverage 98.20% (434,016 of 441,961) and the distance distribution against GIS centroids (median 5.8 m, p90 19.6 m); see `specs/011-publish-and-runs/run3-address-point-evidence.md`. TC-025 still holds: nothing is sent to a free-text lookup service.

### Part A-06: Permits from every jurisdiction

#### A-04-TC-040: Austin full backfill = source count at watermark; digest + URL per row (scale)

- **Priority / tags:** P1 · `@scale @pipeline` · **calls Austin** (no app token, ≤ 1 req/s)
- **Maps to:** AC-12, FR-012 · tasks T050, T051, T053, T074
- **Preconditions:** no TCAD full run `running` (TC-018).
- **Steps:** 0. `git rev-parse --abbrev-ref HEAD` → `004-property-backbone`.
  1. **Run** `npm --prefix pipeline/oracle-runtime run backbone -- permits --mode backfill` → last line `job_id=travis-a04-permits-backfill-…`, exit 0.
  2. **Run** `npm --prefix pipeline/oracle-runtime run backbone -- report --job {JOB_ID} --json | jq -c '.permits | {source_total_at_watermark, captured_at_watermark, above_watermark, outside_travis, watermark}'`.
  3. **Run** `qdb_ro "SELECT count(*), count(DISTINCT row_id), count(content_sha256), count(page_sha256) FROM permit_source_rows WHERE source = 'austin-3syk-w9eu' AND job_id = '{PERMITS_JOB_ID}'"`.
  4. **Run** `qdb_ro "SELECT count(*) = count(source_url), count(*) = count(payload_sha256), count(*) FILTER (WHERE in_travis IS NOT TRUE) FROM property_improvements WHERE source = 'austin-3syk-w9eu'"`.
- **Expected result:** step 2: `captured_at_watermark` = `source_total_at_watermark` (Socrata `count(*)` where `:updated_at ≤ W`; **2,381,226** total at 2026-10-21T18:54:53Z, re-measured), `watermark` a UTC timestamp. Step 3 prints four equal numbers = `captured_at_watermark` + `above_watermark`. Step 4 prints `t|t|{o}` with `o` = `outside_travis` of step 2 (counted, not dropped).

#### A-04-TC-041: ≤ 50,000 rows per page, no app token, keyset by `:id`, ≤ 1 req/s

- **Priority / tags:** P1 · `@pipeline` · **writes local (temp)**
- **Maps to:** AC-12, AC-17, FR-012, FR-017, NFR-002, NFR-006, D-8 · tasks T050
- **Steps:** 0. `git rev-parse --abbrev-ref HEAD` → `004-property-backbone`.
  1. **Run** `(cd pipeline/oracle-runtime && npx vitest run test/travis/a04/permits-backfill.test.ts -t "A-04-TC-041")` (fake Socrata server).
- **Expected result:** `✓ A-04-TC-041`: every request has `$select=*,:id,:updated_at,:created_at`, `$order=:id`, `$limit=50000`; the next page uses `$where=:id > '{last id}'`; **no** `X-App-Token` header and no `$$app_token` parameter on any request; every request carries the project User-Agent; request start times are ≥ 1,000 ms apart incl. retries; on the 2026-10-21T18:54:53Z count (2,381,226 rows) that is ceil(2,381,226 / 50,000) = **48** pages.

#### A-04-TC-042: Reroof candidates linked: measured rate reported, every unmatched kept with its reason (scale; PO exception D-18)

- **Priority / tags:** P1 · `@scale` · **read-only**
- **Maps to:** AC-13, FR-013, NFR-005, AD-16, DEC-A-04-permit-match-rate · tasks T054, T078, T085
- **Steps:** 0. `git rev-parse --abbrev-ref HEAD` → `004-property-backbone`.
  1. **Run** `qdb_ro "SELECT count(*), count(request_identifier), round(avg((request_identifier IS NOT NULL)::int),4) FROM property_improvements WHERE source = 'austin-3syk-w9eu' AND reroof_match"`.
  2. **Run** `qdb_ro "SELECT roofing_verdict, count(*), count(request_identifier), round(100.0*count(request_identifier)/count(*),2) FROM property_improvements WHERE source = 'austin-3syk-w9eu' GROUP BY 1 ORDER BY 1"`.
  3. **Run** `qdb_ro "SELECT link_method, link_rule, stale_tcad_id, coalesce(unmatched_reason,'(linked)'), count(*) FROM property_improvements WHERE source = 'austin-3syk-w9eu' AND reroof_match GROUP BY 1,2,3,4 ORDER BY 5 DESC"`.
  4. **Run** `qdb_ro "SELECT count(*) FROM property_improvements WHERE request_identifier IS NULL AND unmatched_reason IS NULL"`.
- **Expected result (D-18, PO exception to the 97% target):** step 1 `{total}|{linked}|{rate}` with total 22,084 and rate ≥ **0.8800** (measured 2026-10-22: 22,084 | 19,599 | 0.8875); step 2: `roofing` 19,031 | 16,816 | 88.36 (re-measured at run time, floor 88.0). Step 3: linked rows only `tcad_id|geoid_unique_r|f|`, `tcad_id|geoid_plus_address|f|` or `address_hash|address_sig_v1|f/t|`; unlinked rows only `no_tcad_geoid`, `ambiguous_geoid`, `no_tcad_id`, `address_unmatched`, `ambiguous_address`. Step 4 prints **0** (every unmatched permit has a reason). The report (`backbone report --job … --json`, `permits` section) states the rate with the link job id and the watermark.

#### A-04-TC-043: 2000-000025 BP → 221829; `{ANCHOR2_PERMIT}` → `{ANCHOR2_PID}`; 1982-012866 BP `no_tcad_geoid`

- **Priority / tags:** P1 · `@pipeline @missing-data` · **read-only**
- **Maps to:** AC-13, FR-013, D-4 · tasks T054, T062, T078
- **Steps:** 0. `git rev-parse --abbrev-ref HEAD` → `004-property-backbone`.
  1. **Run** `qdb_ro "SELECT permit_number, tcad_id, request_identifier, link_method, link_rule, unmatched_reason FROM property_improvements WHERE permit_number IN ('2000-000025 BP','1982-012866 BP','{ANCHOR2_PERMIT}') ORDER BY 1"`.
- **Expected result:** exactly three rows: `1982-012866 BP|0208011301||||no_tcad_geoid` (kept, counted, no link; the address fallback is not tried because `tcad_id` is not null), `2000-000025 BP|0223120506|221829|tcad_id|geoid_unique_r|` and `{ANCHOR2_PERMIT}|{ANCHOR2}|{ANCHOR2_PID}|tcad_id|geoid_unique_r|`.

#### A-04-TC-044: No tcad_id → address-hash fallback (AD-16); shared geoID rule

- **Priority / tags:** P1 · `@pipeline` · **read-only**
- **Maps to:** AC-13, FR-013 · tasks T054
- **Steps:** 0. `git rev-parse --abbrev-ref HEAD` → `004-property-backbone`.
  1. **Run** `(cd pipeline/oracle-runtime && npx vitest run test/travis/a04/permit-link.test.ts -t "A-04-TC-044")`.
- **Expected result:** `✓ A-04-TC-044` (synthetic test input): (a) `tcad_id` null, `address:v1` signature equal to exactly one R situs → `link_method = address_hash`, `link_rule = address_sig_v1`; (b) two R situs with that signature → unmatched `ambiguous_address`; (c) no matching situs → `address_unmatched`; (d) no usable address → `no_tcad_id`; (e) `tcad_id` = one R geoID → `tcad_id` / `geoid_unique_r`; (f) shared geoID with exactly one situs match → `tcad_id` / `geoid_plus_address`, with zero or several → `ambiguous_geoid`; (g) `tcad_id` `0208011301` not on the roll → `no_tcad_geoid` and the address signature is not computed; (h) unmatched with `original_zip` outside Travis ZCTAs → `in_travis = false`, kept.

#### A-04-TC-045: status_class counts vs the 2026-10-19 baseline

- **Priority / tags:** P1 · `@pipeline` · **read-only**
- **Maps to:** AC-14, FR-014 · tasks T055, T056
- **Steps:** 0. `git rev-parse --abbrev-ref HEAD` → `004-property-backbone`.
  1. **Run** `npm --prefix pipeline/oracle-runtime run backbone -- report --job {JOB_ID} --json | jq -c '.permits | {status_class_vs_baseline, profile_sha256, reroof_candidates}'`.
  2. **Run** `qdb_ro "SELECT status_class, status_raw, count(*) FROM property_improvements WHERE source = 'austin-3syk-w9eu' AND reroof_match AND status_class = 'open' GROUP BY 1,2 ORDER BY 2"`.
  3. **Run** `qdb_ro "SELECT count(DISTINCT profile_sha256), min(profile_sha256) FROM property_improvements WHERE status_class IS NOT NULL"`.
- **Expected result:** step 1: `status_class_vs_baseline` has `open`, `stalled`, `closed`, `exclude`, each `{run, baseline}` with baselines **129 / 2,213 / 17,251 / 2,491**; the run counts plus any `needs_review` sum to `reroof_candidates`; `profile_sha256` = `c8fd15cf8deb654c2959d7cca3b05560bc9830de2518c56a092bd87bdf53dfa6`. Step 2 prints the open split of the run: on the 2026-10-21 backfill `open|Active|121`, `open|Pending Permit|1`, `open|Re Review|1`, `open|Suspended|2` (the 2026-10-19 baseline snapshot had Active 125; four Active permits were closed in between; closed 17,255 vs baseline 17,251), so the deltas are printed, not asserted, and the sum still equals the candidates. Step 3 prints `1|c8fd15cf8deb654c2959d7cca3b05560bc9830de2518c56a092bd87bdf53dfa6`.

#### A-04-TC-046: 1982-012866 BP: Suspended → open, open_days = as_of − 1982-06-23

- **Priority / tags:** P1 · `@pipeline @demo` · **read-only**
- **Maps to:** AC-14, FR-014, FR-016 · demo D-9 · tasks T055, T078
- **Steps:** 0. `git rev-parse --abbrev-ref HEAD` → `004-property-backbone`.
  1. **Run** `qdb_ro "SELECT i.status_raw, i.status_class, i.issue_date, i.open_days, i.open_days = (r.as_of - DATE '1982-06-23'), i.request_identifier IS NULL, i.unmatched_reason FROM property_improvements i JOIN backbone_runs r ON r.job_id = '{LINK_JOB_ID}' WHERE i.permit_number = '1982-012866 BP'"`.
- **Expected result:** exactly `Suspended|open|1982-06-23|{d}|t|t|no_tcad_geoid` (`open_days` computed from `issue_date` although unmatched; `as_of` = the `--link` run's `finishedAt` date); with `as_of` 2026-10-21, `d` = **16,191**; with `as_of` 2026-10-22 (the date of the 2026-10-22 link job), `d` = **16,192** (`as_of` is the run date).

#### A-04-TC-047: "REROOF AND SOLAR" → the A-02 profile decides (edge)

- **Priority / tags:** P1 · `@edge` · **read-only**
- **Maps to:** AC-14, FR-014, FR-023 · tasks T055
- **Steps:** 0. `git rev-parse --abbrev-ref HEAD` → `004-property-backbone`.
  1. **Run** `(cd pipeline/oracle-runtime && npx vitest run test/travis/a04/profile-edge.test.ts -t "A-04-TC-047")` (calls `profiles/travis-austin@1.0.0` through `classify-run.ts` with `{permittype: "BP", work_class: "Remodel", description: "REROOF AND SOLAR"}`, and an undecidable description).
  2. **Run** `grep -r -l -E "REROOF|RE-ROOF" pipeline/oracle-runtime/travis/permits pipeline/oracle-runtime/travis/adapters/socrata/socrata-pages.ts --include='*.ts' | wc -l`.
- **Expected result:** step 1 `✓ A-04-TC-047`: `{ roofing: "not_roofing", reason: "solar_pv", profile: "travis-austin@1.0.0", profile_sha256: "c8fd15cf8deb654c2959d7cca3b05560bc9830de2518c56a092bd87bdf53dfa6" }`; the undecidable one → `status_class = needs_review`; `Expired` never relabelled. Step 2 prints `0` (no roofing term list in A-04 code).

#### A-04-TC-048: Austin count with total + timestamp; 22 records-request listed

- **Priority / tags:** P1 · `@pipeline` · **read-only**
- **Maps to:** AC-15, FR-015 · tasks T056
- **Steps:** 0. `git rev-parse --abbrev-ref HEAD` → `004-property-backbone`.
  1. **Run** `npm --prefix pipeline/oracle-runtime run backbone -- report --job {JOB_ID} --json | jq -c '.jurisdictions | {supported: [.supported[] | {key, eq: (.captured == .source_total), captured_at}], absent: (.absent | length)}'`.
  2. **Run** `npm --prefix pipeline/oracle-runtime run backbone -- report --job {JOB_ID} --json | jq -r '.limitations[]' | grep -c -E '^.+: no public permit history captured \(records request, not filed\); evidence https://'`.
- **Expected result:** step 1 prints `{"supported":[{"key":"austin","eq":true,"captured_at":"{UTC ISO-8601}"}],"absent":22}`. Step 2 prints `22` (one per records-request jurisdiction in `pipeline/docs/travis-sources.yaml`, each with its evidence URL; 1 + 22 = 23).

#### A-04-TC-049: Austin-issued in Lakeway / Bee Cave / Pflugerville stay Austin-issued (edge)

- **Priority / tags:** P1 · `@edge` · **read-only**
- **Maps to:** AC-15, FR-015, FR-022 · tasks T054, T056
- **Steps:** 0. `git rev-parse --abbrev-ref HEAD` → `004-property-backbone`.
  1. **Run** `qdb_ro "SELECT located_jurisdiction, issuing_jurisdiction, count(*) FROM property_improvements WHERE located_jurisdiction IN ('LAKEWAY FULL PURPOSE','BEE CAVE FULL PURPOSE','PFLUGERVILLE FULL PURPOSE','PFLUGERVILLE ETJ') GROUP BY 1,2 ORDER BY 1"`.
  2. **Run** `npm --prefix pipeline/oracle-runtime run backbone -- report --job {JOB_ID} --json | jq -c '[.jurisdictions.absent[] | select(.key=="lakeway" or .key=="bee_cave" or .key=="pflugerville") | {key, own_permits_captured}]'`.
- **Expected result:** step 1 prints only `issuing_jurisdiction = austin`: `BEE CAVE FULL PURPOSE|austin|4822`, `LAKEWAY FULL PURPOSE|austin|6827`, `PFLUGERVILLE ETJ|austin|592`, `PFLUGERVILLE FULL PURPOSE|austin|1117` (2026-10-21, re-measured). Step 2 prints three entries, each with `"own_permits_captured":false`.

#### A-04-TC-050: No issue_date → open_days null (`no_issue_date`), not 0 (missing data)

- **Priority / tags:** P1 · `@missing-data` · **read-only**
- **Maps to:** AC-16, FR-016, FR-026 · tasks T055
- **Steps:** 0. `git rev-parse --abbrev-ref HEAD` → `004-property-backbone`.
  1. **Run** `(cd pipeline/oracle-runtime && npx vitest run test/travis/a04/open-days.test.ts -t "A-04-TC-050")`.
  2. **Run** `qdb_ro "SELECT count(*), count(open_days), count(*) FILTER (WHERE open_days_reason = 'no_issue_date') FROM property_improvements WHERE source = 'austin-3syk-w9eu' AND issue_date IS NULL AND status_class IN ('open','stalled')"`.
  3. **Run** `qdb_ro "SELECT count(*) FROM property_improvements WHERE (open_days = 0 AND issue_date IS NULL) OR (status_class NOT IN ('open','stalled') AND (open_days IS NOT NULL OR open_days_reason <> 'not_open'))"`.
- **Expected result:** step 1 `✓ A-04-TC-050`: an `Active` permit with no `issue_date` → `open_days` null, Query DB reason `no_issue_date`, public `needs_review`; a `closed` permit → null, `not_open`; a `Suspended` 1982-06-23 permit → `open_days` = as_of − 1982-06-23. Step 2 prints `{n}|0|{n}`; step 3 prints `0`.

#### A-04-TC-051: Bulk re-stamp → only content-changed rows written, limitation (error, edge)

- **Priority / tags:** P1 · `@error @edge` · **writes local (temp)**
- **Maps to:** AC-16, FR-016 · tasks T052
- **Steps:** 0. `git rev-parse --abbrev-ref HEAD` → `004-property-backbone`.
  1. **Run** `(cd pipeline/oracle-runtime && npx vitest run test/travis/a04/permits-incremental.test.ts -t "A-04-TC-051")` (fake Socrata: all 1,000 rows re-stamped within 21 min, as on 2026-10-19 12:22–12:43 UTC; 3 rows with changed content).
- **Expected result:** `✓ A-04-TC-051`: re-stamp detected (window ≥ 50% of the total, or ≥ 90% of window rows within 6 h); full page-through; 1,000 digests compared (digest excludes `:`-fields, `:@computed_region_*`, `issued_in_last_30_days`, `day_issued`); exactly **3** rows written; delta `added 0, changed 3, removed 0`; limitations contain exactly `source bulk re-stamp; delta by content digest`.

#### A-04-TC-052: Real incremental run after the backfill

- **Priority / tags:** P2 · `@pipeline` · **calls Austin**
- **Maps to:** AC-16, FR-016 · tasks T052, T053, T082
- **Steps:** 0. `git rev-parse --abbrev-ref HEAD` → `004-property-backbone`.
  1. **Run** `npm --prefix pipeline/oracle-runtime run backbone -- permits --mode incremental` → last line `job_id=travis-a04-permits-incremental-…` (= `{INC_JOB_ID}`), exit 0.
  2. **Run** `qdb_ro "SELECT count(*) FROM property_improvements WHERE source = 'austin-3syk-w9eu' AND updated_in_job = '{INC_JOB_ID}' AND content_sha256 IS NOT DISTINCT FROM previous_content_sha256"`.
  3. **Run** `npm --prefix pipeline/oracle-runtime run backbone -- report --job {JOB_ID} --json | jq -c '{restamp: .permits.restamp, tombstones: .permits.tombstones, lim: [.limitations[] | select(. == "source bulk re-stamp; delta by content digest")] | length}'`.
- **Expected result:** step 2 prints `0` (no row rewritten without a content change). Step 3 prints `restamp.detected` `true` or `false`, `rows_written` ≥ 0, and `lim` = `1` when `detected` is `true`, else `0`.

#### A-04-TC-053: 429 / 5xx → backoff 1 s / 60 s / 5 / full jitter, no skipped page; 403 → stop (error)

- **Priority / tags:** P1 · `@error @negative` · **writes local (temp)**
- **Maps to:** AC-17, FR-017, NFR-002, NFR-006 · tasks T050
- **Steps:** 0. `git rev-parse --abbrev-ref HEAD` → `004-property-backbone`.
  1. **Run** `(cd pipeline/oracle-runtime && npx vitest run test/travis/a04/permits-backfill.test.ts -t "A-04-TC-053")` (fake Socrata answers 429, then 503 twice, on page 3; fake timers; seeded RNG).
- **Expected result:** `✓ A-04-TC-053`: waits uniform in [0, min(60 s, 1 s × 2^(k−1))] (bounds asserted); request starts stay ≥ 1,000 ms apart; the same cursor is re-requested; page 3 is fetched on attempt 4 and committed; pages are contiguous by `:id` (no gap); a page failing all 5 attempts stops the run `failed` without advancing the watermark; a 403 on any page makes exactly one request, receipt `outcome: "blocked"`, `http_status: 403`, CLI exit **2**, no further request.

#### A-04-TC-054: Stop → resume from the last committed page

- **Priority / tags:** P1 · `@error` · **writes local (temp)**
- **Maps to:** AC-17, FR-017 · tasks T051
- **Steps:** 0. `git rev-parse --abbrev-ref HEAD` → `004-property-backbone`.
  1. **Run** `(cd pipeline/oracle-runtime && npx vitest run test/travis/a04/permits-backfill.test.ts -t "A-04-TC-054")` (kills the workflow after page 5 is committed and page 6 is in flight; journal replay).
- **Expected result:** `✓ A-04-TC-054`: the first request after restart is `$where=:id > '{last id of page 5}'`; pages 1–5 are not refetched; page 6 is committed once; each `ctx.run` result holds only `{lastId, sha256, rows, maxUpdatedAt}`; total rows = the fake total; 0 duplicated and 0 skipped rows.

#### A-04-TC-055: Upstream delete → `source_removed` tombstone; re-key is not a tombstone (edge)

- **Priority / tags:** P2 · `@edge` · **writes local (temp)**
- **Maps to:** FR-021 · tasks T052, T053
- **Steps:** 0. `git rev-parse --abbrev-ref HEAD` → `004-property-backbone`.
  1. **Run** `(cd pipeline/oracle-runtime && npx vitest run test/travis/a04/permits-incremental.test.ts -t "A-04-TC-055")` (the fake key set drops one `:id` + permit number between two runs, and moves another permit number to a new `:id`).
- **Expected result:** `✓ A-04-TC-055`: one `source_tombstones` row with `reason = source_removed`, the permit number and `first_missing_at`; that permit row has `tombstoned = true` and is not deleted; the re-keyed permit gets no tombstone; delta `removed 1`.

#### A-04-TC-056: New status in a later page → upsert by permit number + jurisdiction (edge)

- **Priority / tags:** P2 · `@edge` · **writes local (temp)**
- **Maps to:** FR-021 · tasks T052, T053
- **Steps:** 0. `git rev-parse --abbrev-ref HEAD` → `004-property-backbone`.
  1. **Run** `(cd pipeline/oracle-runtime && npx vitest run test/travis/a04/permits-incremental.test.ts -t "A-04-TC-056")` (same permit `Active` on page 2, `Final` on page 7).
- **Expected result:** `✓ A-04-TC-056`: one `property_improvements` row for that `(permit_number, issuing_jurisdiction)` with `status_raw = Final`, `status_class = closed`, `previous_content_sha256` = the page-2 digest; both source rows kept in `permit_source_rows` and both page digests in the receipts.

## 9. NFR and harness cases

#### A-04-TC-NF-01: Page count, duration, throughput recorded for `docs/source-limits.md`

- **Priority / tags:** P1 · `@perf @docs` · **read-only**
- **Maps to:** AC-8, AC-12, FR-008, FR-012 · tasks T011, T045, T056, T087
- **Steps:** 0. `git rev-parse --abbrev-ref HEAD` → `004-property-backbone`.
  1. **Run** `(cd pipeline/oracle-runtime && npx vitest run test/travis/a04/source-limits.test.ts -t "A-04-TC-NF-01")`.
  2. **Run** `npm --prefix pipeline/oracle-runtime run backbone -- report --job {JOB_ID} --json | jq -c '{gis: (.gis | {pages, duration_s, features_per_s}), austin: .permits.throughput}'`.
  3. **Run** `grep -c -E "^\| (GIS|Austin)" docs/source-limits.md`.
- **Expected result:** step 1 `✓ A-04-TC-NF-01`: `throughputRow` returns pages, `duration_s`, `rows_per_s` (2 decimals) and the markdown row for GIS and Austin inputs; a missing field fails naming it. Step 2 prints numbers > 0 for every field (GIS pages = TC-020's page count). Step 3 prints ≥ `2` (one GIS and one Austin row, equal to step 2's values).

#### A-04-TC-NF-02: Query DB never exported; nothing uploaded; no connection string in `apps/` / `infra/`

- **Priority / tags:** P1 · `@security` · **read-only**
- **Maps to:** FR-024, P0-1, P0-2, constitution § 8.1 · tasks T012
- **Steps:** 0. `git rev-parse --abbrev-ref HEAD` → `004-property-backbone`.
  1. **Run** `grep -r -E "postgres(ql)?://|DATABASE_URL|5432" apps infra packages --include='*.ts' --include='*.json' --include='*.env*' | wc -l`.
  2. **Run** `git ls-files | grep -E "\.(sql|csv|parquet|dump|car)$" | grep -i -E "querydb|parcels|property_improvements|tables/|county\.car" | wc -l`.
  3. **Run** `grep -r -n -E "elephant-cli[^\n]*upload|\bupload\b.*(ipfs|pinata|filebase)" pipeline/oracle-runtime/travis --include='*.ts' | wc -l`.
  4. **Run** `bash scripts/grep-gates.sh; echo $?`.
- **Expected result:** steps 1–3 print `0`, `0`, `0`; step 4 ends with `0`.

#### A-04-TC-NF-03: No GIS request ever left the laptop

- **Priority / tags:** P1 · `@security @harness` · **read-only**
- **Maps to:** FR-007, ARD § 8 · tasks T041, T042
- **Steps:** 0. `git rev-parse --abbrev-ref HEAD` → `004-property-backbone`.
  1. **Run** `grep -r -l "gis.traviscountytx.gov" pipeline/data/artifacts pipeline/data/runs 2>/dev/null | wc -l`.
  2. **Run** `cat pipeline/data/raw/gis/us-runner-*/*/egress.txt | grep '^loc=' | sort -u`.
  3. **Run** `grep -r -l "gis.traviscountytx.gov" pipeline/oracle-runtime/travis --include='*.ts' | grep -v -E "travis/(gis/runner-fetch|discovery/probes/arcgis|lib/source-client)\.ts$" | wc -l`.
- **Expected result:** step 1 prints `0` (no laptop-written receipt or output names the GIS host; GIS receipts exist only in the runner artifacts under `pipeline/data/raw/gis/`); step 2 prints exactly `loc=US` (the runner's `egress.txt` also carries a Cloudflare `colo=` line, which is not filtered here); step 3 prints `0` (only the runner fetch, the A-01 probe and the shared host-policy table in `lib/source-client.ts` name the host; the table sets concurrency limits and sends no request). Wording fixed after ERR-21 (2026-10-22).

## 10. Edge cases (index)

- One account, several improvements → TC-007. Same situs → TC-008. Supplemental export → TC-009. Abroad / missing ZIP → TC-011.
- L-shaped lot → TC-031. Split parcel → TC-029. Condo / shared geoID → TC-033. Permit point > 0.5 mi → TC-030.
- Negative anchor geoID 0208011301 / permit 1982-012866 BP (D-4) → TC-003, TC-021, TC-043, TC-046.
- New status in a later page → TC-056. Upstream delete → TC-055. Austin-issued in Lakeway / Bee Cave / Pflugerville → TC-049. "REROOF AND SOLAR" → TC-047.
- Restart mid-run → TC-027 (GIS), TC-054 (Austin). Export SHA-256 differs → TC-016. Two runs at once → TC-018.

## 11. Gap-linked cases (expected to fail until fixed)

None.

## 12. Execution log (filled in Phase 9, T086)

| TC ID       | Run date | Build (sha) | Result | Evidence | Defect |
| ----------- | -------- | ----------- | ------ | -------- | ------ |
| A-04-TC-001 |          |             |        |          |        |

---

## Gate G6: Test Case Approval

| #    | Criterion                                                      | Status                                                           |
| ---- | -------------------------------------------------------------- | ---------------------------------------------------------------- |
| G6-1 | Every AC and every FR maps to at least one TC (§ 2 and § 7)    | ☐ (spec FR-001…FR-026, NFR-001…NFR-006)                          |
| G6-2 | Happy, negative, edge and missing-data paths covered           | ☐                                                                |
| G6-3 | NFRs have test cases with measurable pass criteria             | ☐                                                                |
| G6-4 | Every case is a complete sequence starting from the hosted URL | ☐ exception C-05, see § 3.1                                      |
| G6-5 | Negative cases state the exact message or rejection behavior   | ☐ fixed texts in § 3.5                                           |
| G6-6 | Test data and environment documented, with real records        | ☐ real snapshot § 5; no manifest CID (nothing published in A-04) |
| G6-7 | Every TC traces to the story and a requirement                 | ☐                                                                |
| G6-8 | AI pre-check (`developmentsupport-g6-precheck`): PASS          | ☐ see `docs/gates/G6-A-04-precheck.md`                           |

**Decision:** ☐ Approved ☐ Returned · {date}

## Open questions

None for the PO. Q-1 … Q-7 of v0.1 were closed by Round 1 (2026-10-21); S-1 … S-3 of v0.2 are closed by the spec (FR-001, FR-002, FR-013) and the plan's "Names fixed with the test plan".
