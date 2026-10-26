# ERR-67: tables upload fails with "Upload failed: fetch failed"

| Field  | Value                                                                                        |
| ------ | -------------------------------------------------------------------------------------------- |
| Found  | 2026-10-25, Run 3 public upload (`publish-run.ts --step filebase`)                           |
| Story  | A-11 (Run 3)                                                                                 |
| Status | Closed 2026-10-25: all 15 tables and 15 CAR uploads of Run 3 have receipts (elephant-cli with the fetch retry wrapper); the cause is a Filebase `dag/import` fault, outside this repo |

## What happened

- `county-b01-car` (385 MB) uploaded on the first attempt.
- `county-b01-tables` (21 Parquet parts, 94 MB) failed four attempts in a row with `Upload failed: fetch failed`, on a slow (about 0.5 MB/s) and unstable uplink. Run 1 had the same failure on several tables uploads and only passed on later attempts; its upload took about 5 hours.
- A raised gateway wait (`--timeout 900`) did not help: a manual run still failed after 12 minutes. The 300 s readback wait was not the cause.
- Direct uploads of the same 21 parts to the same endpoint (`rpc.filebase.io/api/v0/add`, same query) all answered HTTP 200 in 4 to 24 s each. The endpoint and the data were fine.

## Cause

elephant-cli 1.58.1 (`services/car-import.service.js`, `importTables`) sends one plain `fetch` per part and one `dag/import`, with no timeout or retry of its own, and reports any failure as `fetch failed` (the underlying `cause` is dropped). One stalled or reset request out of 22 fails the whole attempt, and the next attempt re-sends every part. The exact network cause per failure was not visible before this fix.

## Fix

- PO decision (2026-10-25): keep elephant-cli as the uploader. A custom tables uploader was written and reverted (`444d0f8`, `5afc61d`, reverted in `ce2695c`).
- `pipeline/publish/scripts/fetch-retry.ts` is loaded into the elephant-cli process with `NODE_OPTIONS="--import <tsx loader> --import <fetch-retry.ts>"`. It does not change elephant-cli's logic or checks. For a request whose body can be re-sent (FormData, Blob, bytes, string, none) and that has no AbortSignal of its own, it retries that one request on a network error, its own per-request timeout (120 s plus size at 256 KiB/s), or HTTP 429/5xx, up to 6 tries with backoff (2 s doubling, at most 60 s), and logs the real cause, for example `TypeError UND_ERR_HEADERS_TIMEOUT: fetch failed`. Requests with their own signal (elephant-cli's gateway polling) and streaming bodies pass through untouched. Headers (the bearer token) and query values are never logged.
- Tests: `pipeline/publish/test/fetch-retry.test.ts` (local HTTP server only): 503 then ok with the same FormData body, reset connection, own timeout, 401 not retried, tries exhausted, caller signal passed through, body sizes, cause text.

## Follow-up

- Report the missing per-request retry and the dropped error cause to the elephant-cli maintainers (needs PO approval to post).
- Story A-16: run the publish from a machine with a faster, steadier uplink.
