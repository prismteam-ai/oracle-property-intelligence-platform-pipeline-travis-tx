---
id: ERR-10
type: defect
feature: FEAT-A03
story: A-03
test_case: A-03-TC-020 (also blocks A-03-TC-021, A-03-TC-022, A-03-TC-025, A-03-TC-NF-02)
ac_reference: A-03-AC-3
severity: High
status: Closed
found_by: smeargle
found_date: 2026-10-21
fix_branch: 003-walking-skeleton
fix_commit: 660f73ccfe1805673e0b0efae38c0bb002ea75b5
retest_date: 2026-10-21
closed_date: 2026-10-21
---

# ERR-10: Permits list – every row rejected by the contract/v1 check, page never reaches ready

## Brief description

On the hosted preview the Permits page loads DuckDB-WASM, binds the run and counts the permits, then goes to `data-state="error"` about 10 s after load instead of `ready`. The page's own contract/v1 row check (`parsePermitRows`) rejects row 0 because each `missing` entry arrives as an array (`["field","reason"]`) instead of an object `{field, reason}`. No permit is ever shown, so demo lines D-1 and D-4 fail.

## Related requirement

- **Story:** A-03 · **AC:** A-03-AC-3 · **Requirement:** FR-003, FR-011 · **Test case:** A-03-TC-020 (also TC-021, TC-022, TC-025, TC-NF-02)

## Environment

| Item | Value |
| --- | --- |
| URL | https://003-walking-skeleton.d2lx0utip89u18.amplifyapp.com/permits |
| Build | `1380ad3` (Amplify branch preview `003-walking-skeleton`) |
| Data snapshot | manifest `bafkreiasycmsr2qdlxqcfg3yc2conpn3jxmohz7gs55hkseipplhpqsk5i` |
| Browser / OS / device | Chromium (Playwright) · macOS · 390, 768 and 1440 px |
| Role | anonymous (public page) |

## Preconditions and test data

- The preview serves build `1380ad3`; `/runs/index.json` points at manifest `bafkreiasycmsr2qdlxqcfg3yc2conpn3jxmohz7gs55hkseipplhpqsk5i`.
- No login; any viewport width.

## Steps to reproduce

1. Open https://003-walking-skeleton.d2lx0utip89u18.amplifyapp.com/permits in a private window.
2. Wait for the progress bar to finish (about 10 s).
3. Observe `section[data-route="permits"]`: its `data-state` and the error banner text (screenshots `docs/evidence/img/A-03-smeargle-permits-{390,768,1440}.png`).

## Expected result

`data-state` becomes `ready`; the engine line `DuckDB-WASM in your browser · read-only` is shown with one row (≥ 600 px) or card (< 600 px) per published permit, ordered by `permit_number`, as many as the manifest's `coverage.permits_emitted.count`; each absent value shows its Missing-reason label from `missing`.

## Actual result

`data-state="error"`. The banner reads: `Permit row 0 does not match contract/v1 v_roofing_permit: [ { "expected": "object", "code": "invalid_type", "path": ["missing", 0], "message": "Invalid input: expected object, received array" }, … ]`. No table or card is rendered.

## Impact and severity

- **Impact:** demo D-1/D-4 fail; the evaluator sees an error instead of the permit list.
- **Severity:** High because the main Permits page shows no data on the hosted URL.

## Suggested investigation area

`apps/web/src/engine/duckdb-wasm.ts` `arrowToRows` / `plain` (Arrow → JSON conversion of nested values); `apps/api/src/engine/duckdb-instance.ts` for the same pattern.

## Evidence

- [x] Screenshots `docs/evidence/img/A-03-smeargle-permits-390.png`, `-768.png`, `-1440.png`
- [x] Red unit run (real DuckDB-WASM, before the fix): `apps/web/test/arrow-rows-real.test.ts` 7 failed, including "the Permits list SQL over v_roofing_permit passes parsePermitRows" with the same message as the hosted banner (`path ["missing", 0] … expected object, received array`)
- [x] Playwright re-run of A-03-TC-020 on the redeployed preview: PASS in hosted run 2 (build `fbdb68b`)

## Resolution

| Field | Value |
| --- | --- |
| Root cause | `plain()` in `duckdb-wasm.ts` checked `toArray()` before `toJSON()`. An Arrow `StructRow` (each element of the `missing` LIST<STRUCT>) has both, and `StructRow.toArray()` returns its member **values** (`["status_raw","no_lexicon_carrier"]`), dropping the names. Numeric lists were also wrong (`Vector.toArray()` is a typed array, `BigInt64Array` for BIGINT, which became `{"0":…}`), and nested DATE/TIMESTAMP values stayed epoch numbers. The old unit test used hand-made `{toArray, toJSON}` objects, so it never met the real classes. |
| Fix | `arrowToRows` is now led by the Arrow type, recursively (`convert`: LIST/FixedSizeList → array via Vector iteration, nulls kept; STRUCT → object by the type's child fields via `toJSON()`; DATE → YYYY-MM-DD and TIMESTAMP → ISO 8601 at any depth; bigint → number); the untyped fallback prefers `toJSON` and turns typed arrays into arrays. The API's `@duckdb/node-api` conversion (`apps/api/src/engine/duckdb-instance.ts`) is type-led the same way (its top-level columns were already correct; nested DATE/TIMESTAMP inside a STRUCT/LIST were not). Commit: _(filled after commit)_ on `003-walking-skeleton`. |
| Tests | `apps/web/test/arrow-rows-real.test.ts` (real DuckDB-WASM node build, same apache-arrow classes as the browser): "returns a LIST<STRUCT> as an array of plain objects (StructRow has toArray and toJSON)", "returns numeric lists as plain number arrays (typed arrays, BIGINT → number, null elements kept) and nested dates per contract", "{view} (filled / nulls): every column is JSON-shaped and passes the contract/v1 row schema" for all four views, "the Permits list SQL over v_roofing_permit passes parsePermitRows (the page's own check)". `apps/api/test/duckdb-node.test.ts` › "ERR-10: openDuckDb rows over every contract/v1 column (real @duckdb/node-api)" (8 view cases + "keeps nested values JSON-shaped: STRUCT dates and timestamps per contract, BIGINT lists as numbers"). Shared fixtures: `packages/contract/test/helpers/view-row-literals.ts`. |
| Re-test | A-03-TC-020 PASS in hosted run 2 (build `fbdb68b`, 2026-10-21): the Permits page reaches `ready` with 35 rows. TC-021, TC-022, TC-025 and TC-NF-02 PASS too; `smeargle` re-check 6/6 PASS at 390 / 768 / 1440 |
| Status | ☒ Closed (2026-10-21) ☐ Reopened · Re-tested: PASS in hosted run 2 (build `fbdb68b`, 2026-10-21) |
