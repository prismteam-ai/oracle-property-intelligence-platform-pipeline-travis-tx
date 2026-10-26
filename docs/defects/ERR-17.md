---
id: ERR-17
type: defect
feature: FEAT-A03
story: A-03
test_case: A-03-TC-NF-01
ac_reference: A-03-AC-4
severity: High
status: Closed
found_by: hosted Playwright
found_date: 2026-10-21
fix_branch: 003-walking-skeleton
fix_commit: a1fd50a6f644f9e1f8bc40f8021ddb63d87f390f
retest_date: 2026-10-21
closed_date: 2026-10-21
---

# ERR-17: Permits first load – p50 9.5 s and p95 11.4 s against the 8 s target (NFR-01)

## Brief description

TC-NF-01 measures 20 hosted first loads of the Permits page, from navigation to rows. All 20 exceeded 8 s: p50 9,520 ms, p95 11,425 ms. DuckDB init (`countylens:duckdb:init`) p95 was 3,996 ms. NFR-001 requires a first load of 8 s or less.

## Related requirement

- **Story:** A-03 · **AC:** A-03-AC-4 · **Requirement:** NFR-001, FR-004 · **Test case:** A-03-TC-NF-01

## Environment

| Item | Value |
| --- | --- |
| URL | https://003-walking-skeleton.d2lx0utip89u18.amplifyapp.com/permits |
| Build | `1380ad3` (Amplify branch preview `003-walking-skeleton`) |
| Data snapshot | manifest `bafkreiasycmsr2qdlxqcfg3yc2conpn3jxmohz7gs55hkseipplhpqsk5i` |
| Browser / OS / device | Chromium 156 (Playwright, headless, no throttling) · macOS · desktop 1280 |
| Role | anonymous (public page) |

## Preconditions and test data

- A fresh browser context per load (cold cache), as in `perf.spec.ts`.

## Steps to reproduce

1. Run `perf.spec.ts › A-03-TC-NF-01` against the preview (20 loads, cold cache).
2. Read the per-load time to the first permit row and the `countylens:duckdb:init` measure.

## Expected result

p95 first load of 8,000 ms or less, with the progress bar shown until the rows render.

## Actual result

`perf.spec.ts:79` failed on loads 1–20 ("first load ≤ 8000 ms"): p50 9,520 ms, p95 11,425 ms. DuckDB init p95 was 3,996 ms (`tests/e2e/playwright-report/batch2.log`).

## Impact and severity

- **Impact:** NFR-001 fails on the demo page; the evaluator waits about 10 s for the Permits list.
- **Severity:** High because an NFR gate fails on every load.

## Suggested investigation area

The critical path in `apps/web/src/engine/load-permits.ts`: the engine start, then the index, then the manifest, then the bind, all in sequence.

## Evidence

- [x] Hosted Playwright `tests/e2e/playwright-report/batch2.log` (TC-NF-01)
- [x] Dev check 2026-10-21 (not evidence; hosted re-measure follows the push). Setup: local production build served from 127.0.0.1, real CID copy (CloudFront), headless Chromium without throttling, cold context per load. HEAD `36783c1`: p50 8,065 ms, max 9,005 ms (n = 5), 133 copy requests and 3 extension downloads per load, init 1.3–1.7 s. With the fix: p50 1,365 ms, max 1,456 ms (n = 10), 24 copy requests per load, init 0.76–0.87 s, COUNT about 60 ms, listing about 35 ms.
- [x] Hosted re-test (TC-NF-01): PASS in hosted run 2 (build `fbdb68b`)

## Resolution

| Field | Value |
| --- | --- |
| Root cause | (1) The critical path was strictly serial: engine chunk, then the engine binary download and compile, then the run index, the manifest, and the bind. (2) The bind went through DuckDB's synchronous XHR file system: four sequential requests per table part, about 133 round trips per load (ERR-16), which took most of the load time. (3) The three extensions were downloaded inside the engine start, one after another, from a third-party host (ERR-14). |
| Fix | (a) `createPermitsLoader` starts the engine (chunk, `.wasm.gz` download, compile, open) at the same moment as the run-index read, and waits for it only once the manifest and the parts are in hand. If the load fails earlier, the engine is closed once it has started. (b) The 23 table parts (79 KB) are read once each, in parallel, CID-verified, and registered in the engine (ERR-16), so the bind and the queries make no network request. (c) The vendored extensions (2.8 MB gz) download and gunzip in parallel with the engine binary and are LOADed from object URLs (ERR-14). The engine binary path itself is unchanged: it is fetched once, streamed through `DecompressionStream`, and compiled by the worker with `instantiateStreaming` from an `application/wasm` object URL. There is no re-instantiation, since each load opens one engine and closes it after the listing. Not done: a `<link rel=preload>` of the `.wasm.gz` in `index.html`. It would download about 7.7 MB on the Runs page too, and the engine download now overlaps the data reads anyway. Commit: `a1fd50a` on `003-walking-skeleton`. |
| Expected hosted effect | The hosted load had about 133 copy round trips (about 70 ms each, about 5–6 s in all) after a 3–4 s engine start. Now it is roughly the larger of the engine start (download of about 10.5 MB from Amplify, then compile: the hosted init p95 of about 4 s, a little less without the extension host) and the data reads (about 0.5 s), plus about 0.3 s for the bind and queries. That gives about 3–5 s, under the 8 s target. Hosted TC-NF-01 confirms. |
| Tests | `apps/web/test/read-path-defects.test.ts` › "ERR-17: the engine starts with the first data read, not before it (TC-NF-01)": "opens the engine while the run index and the manifest are still being read"; "an engine that cannot start still fails the load with EngineStartError"; "a failed manifest read reports that failure and still releases the engine once it has started"; plus "downloads the extensions in parallel with the engine binary (ERR-17), before instantiate" (ERR-14 group) and the ERR-16 group. `apps/web/test/perf-marks.test.ts` (User Timing measures unchanged). |
| Re-test | TC-NF-01 PASS in hosted run 2 (build `fbdb68b`, 2026-10-21): first load p50 3,822 / p95 4,170 ms over 20 cold loads (≤ 8,000 ms; run 1 p95 11,425 ms); DuckDB init p50 3,101 / p95 3,545 ms |
| Status | ☒ Closed (2026-10-21) ☐ Reopened · Re-tested: PASS in hosted run 2 (build `fbdb68b`, 2026-10-21) |
