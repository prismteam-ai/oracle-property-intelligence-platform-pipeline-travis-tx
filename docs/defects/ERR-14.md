---
id: ERR-14
type: defect
feature: FEAT-A03
story: A-03
test_case: A-03-TC-023
ac_reference: A-03-AC-3
severity: High
status: Closed
found_by: hosted Playwright
found_date: 2026-10-21
fix_branch: 003-walking-skeleton
fix_commit: a1fd50a6f644f9e1f8bc40f8021ddb63d87f390f
retest_date: 2026-10-21
closed_date: 2026-10-21
---

# ERR-14: Permits engine – DuckDB-WASM downloads its extensions from extensions.duckdb.org

## Brief description

While the Permits page loads, DuckDB-WASM autoloads three extensions from a third-party host: `https://extensions.duckdb.org/v1.5.4/wasm_eh/{icu,json,parquet}.duckdb_extension.wasm`. TC-023 requires that data requests go only to the CID copy or gateway and the app's own static assets, and TC-028 records every request. The page therefore depends on a host the project neither controls nor declares. The three downloads are also sequential synchronous XHRs inside the engine start, which slows the first load (ERR-17).

## Related requirement

- **Story:** A-03 · **AC:** A-03-AC-3, A-03-AC-4 · **Requirement:** FR-003, FR-004 · **Test case:** A-03-TC-023 (no request to any other host), A-03-TC-028 (request log of the engine binaries)

## Environment

| Item | Value |
| --- | --- |
| URL | https://003-walking-skeleton.d2lx0utip89u18.amplifyapp.com/permits |
| Build | `1380ad3` (Amplify branch preview `003-walking-skeleton`) |
| Data snapshot | manifest `bafkreiasycmsr2qdlxqcfg3yc2conpn3jxmohz7gs55hkseipplhpqsk5i` |
| Browser / OS / device | Chromium 156 (Playwright, headless) · macOS · desktop 1280 |
| Role | anonymous (public page) |

## Preconditions and test data

- The latest run in `runs/index.json` is `travis-202609-permits-20261021t103516z` (the manifest above).

## Steps to reproduce

1. Open https://003-walking-skeleton.d2lx0utip89u18.amplifyapp.com/permits in a private window with the network log open.
2. Wait for the permit rows.
3. Filter the log by host.

## Expected result

Every request during the load goes to the app's own origin (HTML, JS, CSS, the engine `.wasm.gz`, the extensions), to the CID copy or the Filebase gateway (manifest and table parts, by CID), or to the font hosts excluded by TC-023. No request goes to `extensions.duckdb.org` or any other host.

## Actual result

`permits.spec.ts › A-03-TC-023` fails at "no request to any other host", listing:
`https://extensions.duckdb.org/v1.5.4/wasm_eh/icu.duckdb_extension.wasm`,
`…/json.duckdb_extension.wasm`, `…/parquet.duckdb_extension.wasm`. `A-03-TC-028` lists the same three URLs.

## Impact and severity

- **Impact:** demo line D-1 ("DuckDB-WASM in your browser · read-only", no server) relies on an undeclared third-party host; if that host is slow or down, the Permits page does not load.
- **Severity:** High because two P1/P2 hosted cases fail and the read path depends on a host outside the architecture (ARD AD-19: the engine is self-hosted).

## Suggested investigation area

`apps/web/src/engine/duckdb-wasm.ts` (engine start); DuckDB settings `autoinstall_known_extensions` / `autoload_known_extensions`.

## Evidence

- [x] Hosted Playwright `tests/e2e/playwright-report/batch3.log`: TC-023 and TC-028 failures with the three URLs
- [x] Dev check 2026-10-21 (local production build, headless Chromium, before/after): HEAD `36783c1` requested `extensions.duckdb.org` 3 times per load; the fix requests it 0 times (hosts: app origin, CID copy, `blob:`, font hosts)
- [x] Hosted re-test: PASS in hosted run 2 (build `fbdb68b`)

## Resolution

| Field | Value |
| --- | --- |
| Root cause | DuckDB-WASM 1.33.1-dev57.0 (DuckDB v1.5.4) does not link parquet, json or icu statically, and its default setting autoloads any missing extension from `extensions.duckdb.org`. All three are needed: `read_parquet` (parquet), `CAST(… AS JSON)` in `bindManifest` (json), and `SET TimeZone = 'UTC'` with TIMESTAMPTZ (icu). With autoload off, `SET TimeZone` fails with "Setting with name "TimeZone" is not in the catalog, but it exists in the icu extension" (checked in Chromium), so none of the three can be dropped. |
| Fix | The three official signed binaries for `v1.5.4/wasm_eh` are vendored gzip -9 compressed in `apps/web/vendor/duckdb-extensions/` (2.8 MB, against 10.4 MB raw), with their raw SHA-256 in `manifest.json`. The maintainer script `apps/web/scripts/vendor-duckdb-extensions.ts` refreshes them; neither the build nor the browser downloads anything from the extension host. Vite emits them as same-origin assets. `openEngine` downloads and gunzips them in parallel with the engine binary (the same DecompressionStream path), sends `SET autoinstall_known_extensions = false` and `SET autoload_known_extensions = false` before any other statement, and then runs `LOAD 'blob:<origin>/<id>#/<name>.duckdb_extension.wasm'`. DuckDB takes the extension name and entry point from the text after the last `/`; the fragment is not sent with the XHR. `allow_unsigned_extensions` stays off, so DuckDB still checks each signature. Files: `apps/web/src/engine/duckdb-wasm.ts`, `apps/web/vendor/duckdb-extensions/**`, `apps/web/scripts/vendor-duckdb-extensions.ts`. Commit: _(filled after commit)_ on `003-walking-skeleton`. |
| Tests | `apps/web/test/read-path-defects.test.ts` › "ERR-14: no request to extensions.duckdb.org (TC-023, TC-028)": "turns autoinstall and autoload off before any other statement, then LOADs every extension from a same-origin object URL"; "downloads the extensions in parallel with the engine binary (ERR-17), before instantiate"; "refuses to LOAD from anything but an object URL of this page"; "a missing extension asset fails the engine start with the fixed text and releases every object URL"; "the production runtime names only same-origin build assets: the engine, its worker and the vendored .wasm.gz extensions"; "the source never names the DuckDB extension host". "ERR-14: the vendored extensions are DuckDB's own binaries for the bundled engine version": "vendors exactly the engine's extensions, for the eh platform"; "each .wasm.gz gunzips to the recorded SHA-256 and size, and is WebAssembly"; "matches the newest DuckDB release named inside the bundled duckdb-eh.wasm". Red before the fix: the module exported no `ENGINE_EXTENSIONS` / `EXTENSION_SETTINGS_SQL` / `loadExtensionSql`. |
| Re-test | TC-023 and TC-028 PASS in hosted run 2 (build `fbdb68b`, 2026-10-21) |
| Status | ☒ Closed (2026-10-21) ☐ Reopened · Re-tested: PASS in hosted run 2 (build `fbdb68b`, 2026-10-21) |
