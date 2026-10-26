---
id: ERR-16
type: defect
feature: FEAT-A03
story: A-03
test_case: A-03-TC-024
ac_reference: A-03-AC-4
severity: Medium
status: Closed
found_by: hosted Playwright
found_date: 2026-10-21
fix_branch: 003-walking-skeleton
fix_commit: a1fd50a6f644f9e1f8bc40f8021ddb63d87f390f
retest_date: 2026-10-21
closed_date: 2026-10-21
---

# ERR-16: Permits load – with a 2 s delay on each CID-copy request the page never finishes

## Brief description

TC-024 delays every CID-copy response by 2 s. That is below the 4 s first-byte fallback threshold, so the copy stays the host. The Permits page then shows its progress bar for the whole 120 s test budget and never renders rows. A copy that is slow but working should still give a usable page.

## Related requirement

- **Story:** A-03 · **AC:** A-03-AC-4 (progress bar until rows) · **Requirement:** FR-008, NFR-001 · **Test case:** A-03-TC-024

## Environment

| Item | Value |
| --- | --- |
| URL | https://003-walking-skeleton.d2lx0utip89u18.amplifyapp.com/permits |
| Build | `1380ad3` (Amplify branch preview `003-walking-skeleton`) |
| Data snapshot | manifest `bafkreiasycmsr2qdlxqcfg3yc2conpn3jxmohz7gs55hkseipplhpqsk5i` |
| Browser / OS / device | Chromium 156 (Playwright, headless) · macOS · desktop 1280 |
| Role | anonymous (public page) |

## Preconditions and test data

- A Playwright `context.route` on the CID copy host (`CID_COPY_HOST`) waits 2 s, then continues each request.

## Steps to reproduce

1. Route every request to the CID copy host through a 2 s delay.
2. Open https://003-walking-skeleton.d2lx0utip89u18.amplifyapp.com/permits.
3. Wait up to 120 s for the permit rows.

## Expected result

The progress bar shows while the page loads, then the rows render (count = `permits_emitted`) without the "fallback" label, well within the test budget.

## Actual result

`permits.spec.ts › A-03-TC-024` fails after 2.1 min: "the Permits list, an error banner or the empty state". Only the progress bar is ever shown.

## Impact and severity

- **Impact:** a degraded but working CID copy makes the Permits page unusable; the hosted case fails.
- **Severity:** Medium because the copy is normally fast. The same request chain is also the main cost of ERR-17 (first load) and the trigger of ERR-15 (fallback).

## Suggested investigation area

How many requests one load makes to the copy, and whether they are sequential (`apps/web/src/engine/load-permits.ts`, DuckDB-WASM's HTTP file system).

## Evidence

- [x] Hosted Playwright `tests/e2e/playwright-report/batch1.log` / `batch3.log`: TC-024 failed after 2.1 min
- [x] Dev check 2026-10-21, local production build, headless Chromium, real CID copy with the same 2 s route delay: HEAD `36783c1` made 133 copy requests per load. The fix makes 24 copy requests per load (manifest plus 23 parts) and shows rows in 7.0–9.0 s (2 of 2 runs) with no fallback label.
- [x] Hosted re-test: PASS in hosted run 2 (build `fbdb68b`)

## Resolution

| Field | Value |
| --- | --- |
| Decision | **The app was wrong, not the test.** A 2 s copy is slow but working: the D-2 rule rightly keeps it as the host, so the page must still finish. It could not, because DuckDB-WASM reads each remote part with four strictly sequential synchronous XHRs from its worker (HEAD, GET 0-0, HEAD 0-, GET 0-n). That is about 92 requests for the 23 table parts, plus the copy's extra probes (133 requests per load measured), or more than 4 minutes at 2 s each. |
| Root cause | One load serialised about 133 round trips to the copy inside DuckDB's synchronous XHR file system. |
| Fix | One probe decides the host for the whole load: the manifest read by `fetchByCid` (copy, or the Filebase gateway after the 4 s first-byte rule). The page then reads each table part once from that host, with one ranged GET (`Range: bytes=0-{size-1}` → 206, as TC-026 expects) and up to 16 in parallel on the copy (`apps/web/src/data/fetch-parts.ts`). It accepts the bytes only when their raw-leaves CID equals the manifest's (constitution A3), then registers them in the engine (`registerFileBuffer`) and binds the views to the registered names. The engine makes no network request for the parts. A run whose parts total more than 16 MiB is not prefetched: DuckDB range-reads it with the ADR-0001 flags as before. Commit: _(filled after commit)_ on `003-walking-skeleton`. |
| Tests | `apps/web/test/read-path-defects.test.ts` › "ERR-16: a slow but working CID copy still finishes (TC-024, 2 s per request)": "reads each part with exactly one ranged GET (206, TC-026), in parallel on the copy"; "asks for the whole part as one range; an empty part asks for none"; "prefetches only the table parts, and nothing when they exceed PART_PREFETCH_MAX_BYTES (DuckDB range-reads them)"; "registers a part under a host-free name". `apps/web/test/duckdb-config.test.ts` › "reads the parts from the host that served the manifest, registers them and binds them by name; stages in order". Red before the fix: `src/data/fetch-parts.ts` did not exist. |
| Re-test | TC-024 PASS in hosted run 2 (build `fbdb68b`, 2026-10-21) |
| Status | ☒ Closed (2026-10-21) ☐ Reopened · Re-tested: PASS in hosted run 2 (build `fbdb68b`, 2026-10-21) |
