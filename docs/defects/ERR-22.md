---
id: ERR-22
type: defect
feature: FEAT-A06
story: A-04
test_case: A-04-TC-052
ac_reference: A-04-AC-16
severity: High
status: Closed
found_by: QC test runner (Claude), for HebaGaber
found_date: 2026-10-22
fix_branch: 004-property-backbone
fix_commit: be805f8
retest_date: 2026-10-22
closed_date: 2026-10-22
---

# ERR-22: Austin incremental run – re-stamp histogram query is rejected by Socrata (HTTP 400, `date_trunc_ymdh` does not exist)

## Brief description

`backbone permits --mode incremental` stops with `status=failed pages=0 rows=0` because its second request, the hourly `:updated_at` histogram used by the re-stamp detector (AC-16), is answered with HTTP 400 by `data.austintexas.gov`. The query uses `date_trunc_ymdh(:updated_at)`, a function Socrata does not have. The Vitest tests pass because they run against a fake Socrata server that accepts any query. As built, a real incremental run cannot complete, so AC-16 (incremental delta and re-stamp detection) is not met live.

## Related requirement

- **Story:** A-04 · **AC:** A-04-AC-16 · **Requirement:** FR-016, FR-021 · **Test case:** A-04-TC-052 (also affects TC-051's live behaviour)

## Environment

| Item          | Value                                                                                                  |
| ------------- | ------------------------------------------------------------------------------------------------------ |
| URL           | not applicable (pipeline-only story; local terminal; calls data.austintexas.gov, project User-Agent)   |
| Build         | branch `004-property-backbone`, working tree clean, 2026-10-22                                         |
| Data snapshot | Austin `3syk-w9eu` 2,381,226 rows; prior backfill watermark `2026-10-21T14:42:23.154Z`                 |
| Role          | n/a                                                                                                    |

## Preconditions and test data

- Local stack up, a completed backfill job in the Query DB (`travis-a04-permits-backfill-202610212201`), no run `running`.

## Steps to reproduce

1. `git rev-parse --abbrev-ref HEAD` -> `004-property-backbone`.
2. `npm --prefix pipeline/oracle-runtime run backbone -- permits --mode incremental`
3. Read `pipeline/data/artifacts/permits/travis/<job_id>/receipts.jsonl` (the `histogram` receipt).
4. Same request by hand (one request, project User-Agent, no token):
   `curl -G https://data.austintexas.gov/resource/3syk-w9eu.json --data-urlencode '$select=date_trunc_ymdh(:updated_at) AS h, count(*) AS n' --data-urlencode "\$where=:updated_at > '2026-10-21T14:42:23.154Z'" --data-urlencode '$group=date_trunc_ymdh(:updated_at)' --data-urlencode '$limit=5'`

## Expected result

TC-052 step 1: last line `job_id=travis-a04-permits-incremental-…`, exit 0; the report shows `restamp.detected` true or false.

## Actual result

- CLI: `permits incremental: status=failed pages=0 rows=0 written=0 tombstones=0 watermark_check=not_applicable`, `permits incremental: histogram error (HTTP 400, 1 attempt(s))`, job `travis-a04-permits-incremental-20261022122136`, exit 1.
- Receipt: kind `histogram`, `http_status` 400, `outcome` "error", 674 bytes. The `count` request just before it (`count(*)` where `:updated_at` > watermark) was HTTP 200.
- Manual repeat of the request, Socrata body: `query.soql.no-such-function; No such function 'date_trunc_ymdh'; arity=1`. Replacing it with `date_trunc_ymd(:updated_at)` gives `query.soql.type-mismatch ... is fixed_timestamp` (`:updated_at` is a fixed timestamp; `date_trunc_ymd` needs a floating timestamp).
- Nothing was written: 0 rows, no watermark change; the failed run is recorded as `failed` in `backbone_runs`.

## Impact and severity

- **Impact:** the incremental path (AC-16, FR-021, the re-stamp limitation of AC-16) cannot run against the real source; the delta, tombstones and `source bulk re-stamp; delta by content digest` limitation are only proven on a fake server. The backfill, link and coordinates are unaffected.
- **Severity:** High: a story feature (incremental updates) fails on the live source and no workaround exists in the CLI.

## Suggested investigation area

`buildUpdatedHistogramQuery` in `pipeline/oracle-runtime/travis/adapters/socrata/socrata-pages.ts` (lines ~108-117) and its consumer `restamp.ts`. Use functions Socrata supports for a fixed timestamp (for example `date_trunc_ymd(to_floating_timestamp(:updated_at))`, or group by a coarser/valid expression and read hourly buckets from `:updated_at` another way), and make the fake Socrata server in `permits-backfill.test.ts` / `permits-incremental.test.ts` reject unknown functions so this cannot pass offline again. Save the response body of a non-200 receipt (only the hash is kept today), which would have shown the message at once.

## Evidence

- [ ] Screenshot: not applicable
- [x] Command output above (2026-10-22), receipt file `pipeline/data/artifacts/permits/travis/travis-a04-permits-incremental-20261022122136/receipts.jsonl`
- [ ] CloudWatch: not applicable

## Resolution

| Field      | Value                                                  |
| ---------- | ------------------------------------------------------ |
| Root cause | `buildUpdatedHistogramQuery` used `date_trunc_ymdh(:updated_at)`, a function Socrata does not have; the fake Austin server in the Vitest tests accepted any query, so the offline suite could not catch it |
| Fix        | Commit `be805f8`: buckets by day plus hour of day, `date_trunc_ymd(to_floating_timestamp(:updated_at,'UTC'))` and `date_extract_hh(...)`, verified live with 3 requests (HTTP 400 for `date_trunc_ymdh`; HTTP 200 with two real buckets of the 2026-10-21 re-stamp: hour 13 = 1,420,983 rows, hour 14 = 960,243 rows); the strict fake Austin server now rejects unknown functions |
| Re-test    | A-04-TC-052, 2026-10-22: real incremental run, job `travis-a04-permits-incremental-20261022122922`, status complete, pages 1, rows 0, written 0, watermark 2026-10-21T14:42:23.154Z, re-stamp detected false (no row newer than the watermark). Fix and first live verification: run-log 15:32 row. |
| Status     | Closed (2026-10-22) after the passing re-test |
