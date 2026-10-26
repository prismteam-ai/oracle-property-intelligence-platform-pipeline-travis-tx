---
id: ERR-15
type: defect
feature: FEAT-A03
story: A-03
test_case: A-03-TC-032
ac_reference: A-03-AC-5
severity: High
status: Closed
found_by: hosted Playwright
found_date: 2026-10-21
fix_branch: 003-walking-skeleton
fix_commit: a1fd50a6f644f9e1f8bc40f8021ddb63d87f390f
retest_date: 2026-10-21
closed_date: 2026-10-21
---

# ERR-15: Filebase fallback – table-part reads fail with net::ERR_FAILED (the gateway's 429 has no CORS headers)

## Brief description

When the CID copy is aborted, returns 500, or is slower than 4 s, the page correctly reads the manifest from the Filebase gateway. Then a DuckDB XHR for a table part (`HEAD` or a range `GET` on `https://ipfs.filebase.io/ipfs/<cid>`) fails with `net::ERR_FAILED` and no response headers. The Permits page shows "Invalid Error: NetworkError: Failed to execute 'send' on 'XMLHttpRequest' …". A `curl` with the same Origin and Range gets 206 with `Access-Control-Allow-Origin: *`, so the failure looked like a CORS or redirect problem.

## Related requirement

- **Story:** A-03 · **AC:** A-03-AC-5 · **Requirement:** FR-005 (labelled fallback) · **Test case:** A-03-TC-032 (copy aborted), A-03-TC-033 (copy 500), A-03-TC-034 (copy slower than 4 s)

## Environment

| Item | Value |
| --- | --- |
| URL | https://003-walking-skeleton.d2lx0utip89u18.amplifyapp.com/permits |
| Build | `1380ad3` (Amplify branch preview `003-walking-skeleton`) |
| Data snapshot | manifest `bafkreiasycmsr2qdlxqcfg3yc2conpn3jxmohz7gs55hkseipplhpqsk5i` |
| Browser / OS / device | Chromium 156 (Playwright, headless) · macOS · desktop 1280 |
| Role | anonymous (public page) |

## Preconditions and test data

- Every request to the CID copy host (`CID_COPY_HOST` = `d2xsqoqv09bd0q.cloudfront.net`) is aborted with a Playwright route. The gateway is the real `ipfs.filebase.io` (no route).

## Steps to reproduce

1. Abort every request to the CID copy host.
2. Open https://003-walking-skeleton.d2lx0utip89u18.amplifyapp.com/permits.
3. Observe the error banner instead of rows labelled `fallback · ipfs.filebase.io`.

## Expected result

The manifest and every table part come from `https://ipfs.filebase.io/ipfs/<cid>`. The rows render with the `fallback · ipfs.filebase.io` chip next to the engine line.

## Actual result

`fallback.spec.ts:121`: "the Permits page shows an error banner: Invalid Error: … Range request for https://ipfs.filebase.io/ipfs/bafkreia52c73… failed with error: NetworkError …" (TC-032, TC-034) and "Opening file 'https://ipfs.filebase.io/ipfs/bafkreiczy73…' failed …" (TC-033). Which part fails changes between runs, and some runs pass.

## Impact and severity

- **Impact:** the labelled fallback (AC-5, demo D-2) fails, so the read path has no working second host.
- **Severity:** High because three P1 hosted cases fail and the fallback is an acceptance criterion.

## Suggested investigation area

Chrome net-log of the failing XHR: status line and headers of the response the page never sees.

## Evidence

- [x] Hosted Playwright `tests/e2e/playwright-report/batch1.log` / `batch3.log` (TC-032…034)
- [x] Investigation 2026-10-21, headless Chromium against the real gateway (copy aborted, no route on the gateway), Chrome `--log-net-log`. The failing request was `HEAD /ipfs/bafkreiczy73rm3llnuf6622dd5l7yx2x5va7hlg5le4y3tqv6vxw23varu` (no preflight needed). The gateway answered `HTTP/1.1 429` with only `date`, `content-type: text/html` and `server: Filebase`, and no `Access-Control-Allow-Origin`. Chromium therefore blocks the response and reports `net::ERR_FAILED` with no headers. There is no redirect, the URL form is path style, and preflights for `range` return 204 with `Range` allowed. In the same runs the page sent about 92 gateway requests per load (DuckDB's HEAD, GET 0-0, HEAD 0-, GET 0-n for each of 23 parts, all sequential).
- [x] Gateway budget measured with curl 2026-10-21. After 2 minutes idle, a back-to-back burst got 65 answers of 206 before the 429s began (another run, not idle: 50). After that, one request per second was answered 206 on 59 of 60 requests. So the bucket holds about 50–65 requests and refills at about 1 request per second or faster.
- [x] Dev check after the fix, local production build with the copy aborted: a fresh load reads the manifest and 23 parts with 24 gateway GETs (`206` with Range) and shows rows with the `fallback · ipfs.filebase.io` chip in 1.4–1.7 s. The gateway still throttles loads repeated back to back beyond its budget (2 of 5 consecutive loads in about 60 s passed). That is the public gateway's own per-IP limit, not something the page can fix; the page then names the part and host in the error banner.
- [x] Hosted re-test: PASS in hosted run 2 (build `fbdb68b`)

## Resolution

| Field | Value |
| --- | --- |
| Root cause | Not CORS configuration, a redirect or the HEAD request as such. The Filebase public gateway rate-limits per client IP and sends its HTTP 429 without CORS headers, so the browser hides the 429 as `net::ERR_FAILED`. DuckDB-WASM's synchronous XHR file system sent about 92 requests per load to the gateway, over its burst budget of about 50, and does not retry. |
| Fix | Table parts are no longer read by DuckDB over HTTP. The page reads each part once from the host that served the manifest (`apps/web/src/data/fetch-parts.ts`, ERR-16): one ranged GET per part, at most 3 in flight on the gateway (16 on the copy), so a load needs 24 gateway requests, within the burst. A dropped request (how a CORS-less 429 reaches the page: a `TypeError`), a 429 or a 5xx is retried after 1, 2, 4 and 8 s. The bytes must match the manifest size and raw-leaves CID. A part that still fails ends the load with a `PartReadError` naming the part, the CID and the host. The URL stays the path form `https://ipfs.filebase.io/ipfs/<cid>`, which is what the gateway serves directly with no redirect, and what `fallback.spec.ts` expects. `reliableHeadRequests: false` remains for runs too large to prefetch. Commit: _(filled after commit)_ on `003-walking-skeleton`. |
| Tests | `apps/web/test/read-path-defects.test.ts` › "ERR-15: Filebase fallback reads survive the gateway's CORS-less 429 (TC-032…034)": "reads from the path-style gateway URL https://ipfs.filebase.io/ipfs/<cid> (no subdomain redirect)"; "retries a dropped request (a 429 without CORS reaches the page as a TypeError) and a 429 status, then succeeds"; "gives up after the retries with a PartReadError naming the part and the host"; "never sends more than PART_CONCURRENCY.fallback requests to the gateway at once"; "rejects bytes that do not hash to the manifest CID, without retrying". `apps/web/test/duckdb-config.test.ts` › "reads the parts from the host that served the manifest, registers them and binds them by name; stages in order". Red before the fix: `src/data/fetch-parts.ts` did not exist. |
| Re-test | TC-032, TC-033 and TC-034 PASS in hosted run 2 (build `fbdb68b`, 2026-10-21), each run on its own with about 90 s between them (starts 16:23:36Z, 16:25:16Z, 16:26:54Z) |
| Status | ☒ Closed (2026-10-21) ☐ Reopened · Re-tested: PASS in hosted run 2 (build `fbdb68b`, 2026-10-21) |
