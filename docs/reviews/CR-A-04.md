---
id: CR-A-04
type: code-review-log
story: A-04
branch: 004-property-backbone
reviewed_commit: 4a4910c (all three reviews; fixes follow in later commits)
tools: [soofi-xyz-team-kit:oracle, soofi-xyz-team-kit:donphan, /code-review]        # /code-review ultra once per repo before G8
created: 2026-10-22
---

# Code Review Log: A-04 Load the county backbone (TCAD · coordinates · permits)

Review round E1 (light lane): `oracle`, `donphan` (read-only, whole branch) and `/code-review medium` run in parallel on `git diff feature/oracle-pipeline...HEAD` while the Austin backfill was running. Finding ids: CR-n = `/code-review`, OR-x = oracle, DP-n = donphan. Fix owners: **F1** shared plumbing + TCAD, **F2** permits, **F3** GIS/coverage/CI/docs (disjoint files).

## Runs

| Run | Tool | Effort | Date | Commit | Findings | Score |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `soofi-xyz-team-kit:oracle` (read-only, whole branch) | n/a | 2026-10-22 | `4a4910c` | 5 Major, 12 Minor | **80 / 100** (pass) |
| 2 | `soofi-xyz-team-kit:donphan` (read-only, data contract) | n/a | 2026-10-22 | `4a4910c` | 3 Major, 5 Minor | **80 / 100** (pass) |
| 3 | `/code-review` (whole branch) | medium | 2026-10-22 | `4a4910c` | 10 | n/a |

## Findings

| # | Severity | File:line | Finding | Owner | Resolution | Commit |
| --- | --- | --- | --- | --- | --- | --- |
| OR-M1 | Major | `local-stack/services/loader.ts:213,175` | A deterministic Loader failure (Postgres 22xxx/23xxx, zod, sha mismatch) retries forever inside the exclusive `Loader` key `travis`; `failRun` queues behind it, so the run stays `running` and blocks FR-025 | F1 | Fixed (tests red→green) | `84672ce` |
| OR-M2 | Major | `oracle-runtime/travis/permits/workflow.ts:490`, `tracks/permits.ts:229` | A failed count-at-watermark check still advances the watermark and marks the run `complete`; `endTotal !== startTotal` tolerated | F2 | Fixed (no watermark advance, run `failed`, cursor kept; resume or `--fresh`) | `84672ce` |
| OR-M3 | Major | `local-stack/services/tracks/permits.ts:182,194-228` | Truncated key set can mass-tombstone permits (no guard vs `endTotal`); a reappearing permit stays `tombstoned` | F2 | Fixed (tests red→green) | `84672ce` |
| OR-M4 | Major | `travis/tcad/fields.ts`, `0102_tcad_type_rule.sql` | `improvement_fallback` publishes guessed `property_type` for 28,595 R accounts (6.5%); `VacantLand` for no-improvement parcels contradicts roofing permits (ANCHOR2) and is deprecated; not a published limitation (= DP-1, DP-2) | F1 | Lead decision 2026-10-22: no-improvement fallback → `LandParcel` (neutral, non-deprecated), improvement fallback stays `Building`; record `property_type_improvement_fallback` source limitation with counts + top state codes; A4/F4 limitation | Fixed per lead decision: no-improvement fallback `LandParcel`, improvement fallback `Building`, rule-set version stored (migration 0103), limitations `property_type_improvement_fallback` and `property_type_unverified_state_codes` (A4, F4) | `84672ce` |
| OR-M5 | Major | `travis/backbone/disk-guard.ts:4` | Disk is checked only at CLI start; a full disk during a Postgres write can corrupt the Docker volume | F1 | Fixed (tests red→green) | `84672ce` |
| OR-m1 | Minor | `travis/tcad/process.ts:99` | `dead`/`transform_failure` detail quotes raw JSON snippets (`short(e)`) into `roll_reconciliation.detail`, `dead.json`, the journal | F1 | Fixed (tests red→green) | `84672ce` |
| OR-m2 | Minor | `travis/tcad/workflow.ts`, `tcad-chunk.ts` | Unredacted `c{N}.input.ndjson.gz` written before redaction and removed only after a successful merge | F1 | Fixed (tests red→green) | `84672ce` |
| OR-m3 | Minor | `0301_permits.sql` | `permit_source_rows.payload` keeps applicant/contractor fields; no gate that they never reach other tables/reports | F2 | Fixed (tests red→green) | `84672ce` |
| OR-m4 | Minor | `services/workflows/austin-permits.ts:54` | `ctx.run(..., {maxRetryAttempts: 3})` stacks on the page loop's 5 attempts (up to 3 more 88 MB re-requests) | F2 | Fixed (tests red→green) | `84672ce` |
| OR-m5 | Minor | `travis/permits/backfill-cursor.ts` | No `--fresh`; stale cursor always resumes; no check of cursor profile/code SHA | F2 | Fixed (tests red→green) | `84672ce` |
| OR-m6 | Minor | `travis/tcad/workflow.ts` | Run marked `complete` with unexplained roll differences / invalid / transform failures | F1 | Fixed (tests red→green) | `84672ce` |
| OR-m7 | Minor | `services/workflows/tcad-backbone.ts:73` | Bare `catch {}` around the coordinate query writes the County group with every coordinate `none` on any DB error | F1 | Fixed (tests red→green) | `84672ce` |
| OR-m8 | Minor | `services/tracks/permits.ts` `mergeLink` | `permits --link` against a partially loaded `parcels` table would mark shared geoIDs `geoid_unique_r`; FR-025 index covers only full/backfill/incremental | F2 | Fixed (tests red→green) | `84672ce` |
| OR-m9 | Minor | `travis/backbone/run-context.ts` | Minute-granular job ids collide on the Restate key (= CR-10) | F1 | Fixed (tests red→green) | `84672ce` |
| OR-m10 | Minor | `contract/v1/README.md:215` | `property_type` missing reason `enum_lacks_value` vs `source_missing` | F3 | Deferred to A-07 (frozen contract; `enum_lacks_value` is used only for P/MH/MN accounts that are not published; no public record is affected) |  |
| OR-m11 | Minor | `specs/.../tasks.md`, `tracks/*.ts` doc comments | T001/T061–T067 unticked; comments say only Loader/report/migrate open DB clients | F3 | Fixed (tests red→green) | `84672ce` |
| OR-m12 | Minor | `.github/workflows/a04-gis-capture.yml` | Re-runs on any touch of the workflow/config; `if: false` is manual | F3 | Fixed (tests red→green) | `84672ce` |
| DP-1/2 | Major | (= OR-M4) | Fallback blast radius not a published limitation; VacantLand/Building semantics | F1 | see OR-M4 | |
| DP-3 | Major | `travis/gis/coverage-report.ts:32` | Coverage SQL must also print `count(*)`, `count(DISTINCT property_cid)`, QDB R count and fail unless all equal 441,961 (or the explained difference); compare the two shares with a tolerance | F3 | Fixed (tests red→green) | `84672ce` |
| DP-5 | Minor | `property_improvements` | Permit row → source page mapping: add `page_key` per row; GIS artifact receipts must carry the ArcGIS query URL | F2 (page_key), F3 (GIS) | Fixed (tests red→green) | `84672ce` |
| DP-6 | Minor | `data-model.md`, `tcad/fields.ts` | `owner_unparsed` is not on the frozen reason list (frozen: `no_owner_record`, `no_dated_sale`, `owner_confidential`); and latest-sale ≠ current owner → tenure is not fact: add a source limitation | F1 (check + limitation) | Fixed: `owner_unparsed` is on the frozen list (README line 131, pinned by a test); limitation `tenure_latest_sale_assumption` added | `84672ce` |
| DP-7 | Minor | `backbone_runs.code_sha` | Reproducibility: store a rule-set version for `property_type` on each parcel row | F1 | Fixed (tests red→green) | `84672ce` |
| DP-8 | Minor | `shared-seed.ts` | A4 → `Townhouse` unverified and deprecated: record as limitation with F4 (2,891) | F1 | Fixed (tests red→green) | `84672ce` |
| CR-1 | Major | `travis/tcad/workflow.ts:93` | A status op's Loader idempotency key is a hash of job id + op, so a repeat of the same status op is skipped and never applied (`waiting_human` → verified stays `waiting_human`; re-run of a failed job stays `failed`; `finalize`/`limitations` skipped on a same-job re-run) | F1 | Fixed (tests red→green) | `84672ce` |
| CR-2 | Major | `services/workflows/tcad-backbone.ts:168` | Workflow state `status` set to `running` once and only updated on success; a terminal failure leaves it `running` and `backbone ingest|pilot` poll forever | F1 | Fixed (tests red→green) | `84672ce` |
| CR-3 | Major | `travis/tcad/workflow.ts:329` | Data errors in the workflow body (plain `Error`, e.g. "N seed pIDs are not in the export", "record is not closed") are retried forever by Restate | F1 | Fixed (tests red→green) | `84672ce` |
| CR-4 | Major | `travis/tcad/workflow.ts:316` | `inflight` chunk promises have no rejection handler until awaited: a failing chunk can raise unhandledRejection and crash the services process while the loop is streaming | F1 | Fixed (tests red→green) | `84672ce` |
| CR-5 | Minor | `services/workflows/tcad-backbone.ts:84` | `writeGroup` stamps the County group with `new Date()` instead of the run's `as_of` (tenure/roof-age as of a different date) | F1 | Fixed (tests red→green) | `84672ce` |
| CR-6 | Minor | `services/workflows/tcad-backbone.ts:135` | `IN ${sql(ids)}` with empty ids → invalid SQL retried forever; `joinProof` does not check `jobId === ctx.key` | F1 | Fixed (tests red→green) | `84672ce` |
| CR-7 | Major | `services/tracks/tcad.ts:270` | `backbone_runs` insert violating the one-ingest-running index (23505) throws a plain Postgres error in `Loader` `ctx.run`: retried forever instead of a refusal (= OR-M1) | F1 | Fixed (tests red→green) | `84672ce` |
| CR-8 | Minor | `travis/adapters/socrata/socrata-pages.ts:276` | Structural page guards throw plain `Error` after the body was fetched: Restate re-requests the 88 MB page forever | F2 | Fixed (tests red→green) | `84672ce` |
| CR-9 | Minor | `travis/tcad/chunk.ts:103` | A re-run or retry after `cleanup-cN` reads a deleted input (ENOENT, plain Error) and retries forever, hiding the idempotent Loader skip | F1 | Fixed (tests red→green) | `84672ce` |
| CR-10 | Minor | `travis/backbone/commands/pilot.ts` (jobIdFor) | Minute-resolution job ids: two runs of a verb within one minute share a Restate key (= OR-m9) | F1 | Fixed (tests red→green) | `84672ce` |

## Constitution and architecture check

| Rule | Result | Note |
| --- | --- | --- |
| Zod on every tRPC input; no `any` | n/a | pipeline-only story; strict zod at the export parse and Loader inputs |
| LLM calls only through the Vercel AI SDK | n/a | no LLM call in A-04 |
| Powertools logger, tracer and metrics in every Lambda | n/a | no Lambda in A-04 |
| No secrets or PII in code or logs | ✅ (OR-m1, OR-m2 to harden) | confidential grep over 9 sensitive strings: 0 hits in outputs, DB and logs |
| P0 rules in `docs/architecture-constitution.md` | ✅ with the findings above | P0-5 key rules, P0-7 etiquette, P0-9 profile-only classification, P0-10 one run, P0-15 redaction verified by both reviewers |

**Open Critical findings:** 0 (no reviewer rated a Critical; the Majors above are fixed before the TCAD full run).
