---
id: ERR-11
type: defect
feature: FEAT-A03
story: A-03
test_case: A-03-TC-020 (error path; fixed texts of test plan § 3)
ac_reference: A-03-AC-3
severity: Medium
status: Closed
found_by: smeargle
found_date: 2026-10-21
fix_branch: 003-walking-skeleton
fix_commit: 660f73ccfe1805673e0b0efae38c0bb002ea75b5
retest_date: 2026-10-21
closed_date: 2026-10-21
---

# ERR-11: Permits error banner – shows the raw zod validation message instead of a fixed text

## Brief description

When a listed permit row fails the contract/v1 check, the Permits error banner prints the raw zod error (JSON with `expected`, `code`, `path`, `message`). Plan § "Fixed texts and config keys" says every banner shows a fixed, plain-language text from `packages/shared`; technical detail belongs in the console. The raw text is unreadable for the evaluator and leaks internals.

## Related requirement

- **Story:** A-03 · **AC:** A-03-AC-3 · **Requirement:** FR-003, plan § "Fixed texts and config keys" (= test plan § 3) · **Test case:** A-03-TC-020 (error path)

## Environment

| Item | Value |
| --- | --- |
| URL | https://003-walking-skeleton.d2lx0utip89u18.amplifyapp.com/permits |
| Build | `1380ad3` (Amplify branch preview `003-walking-skeleton`) |
| Data snapshot | manifest `bafkreiasycmsr2qdlxqcfg3yc2conpn3jxmohz7gs55hkseipplhpqsk5i` |
| Browser / OS / device | Chromium (Playwright) · macOS · 390, 768 and 1440 px |
| Role | anonymous (public page) |

## Preconditions and test data

- Build `1380ad3`, where every row fails the check (ERR-10). After the ERR-10 fix the same path is reached by any row that does not match contract/v1.

## Steps to reproduce

1. Open https://003-walking-skeleton.d2lx0utip89u18.amplifyapp.com/permits in a private window.
2. Wait about 10 s until `section[data-route="permits"]` has `data-state="error"`.
3. Read the `role="alert"` banner text.

## Expected result

The banner shows one fixed text from `PERMITS_TEXTS` in the tone of the others (`Query engine could not start`, `Run index could not be read from this site`): `Permit rows could not be read from this run`, with Retry. The row index, field and schema message go to `console.error` only.

## Actual result

The banner shows `Permit row 0 does not match contract/v1 v_roofing_permit: [ { "expected": "object", "code": "invalid_type", "path": ["missing", 0], "message": "Invalid input: expected object, received array" }, … ]`.

## Impact and severity

- **Impact:** an evaluator who meets any row error sees raw JSON; the fixed-text contract of the plan is broken.
- **Severity:** Medium because it only shows on an error path, but that path is the one the preview currently takes.

## Suggested investigation area

`apps/web/src/routes/Permits.page.tsx` `errorText` (falls back to `error.message`); `apps/web/src/engine/permit-list.ts` throws a plain `Error`.

## Evidence

- [x] Screenshots `docs/evidence/img/A-03-smeargle-permits-{390,768,1440}.png`
- [x] Red unit run before the fix: the three ERR-11 tests below failed (`PERMITS_TEXTS.rowsUnreadable` undefined)
- [x] Hosted re-test: PASS in hosted run 2 (build `fbdb68b`)

## Resolution

| Field | Value |
| --- | --- |
| Root cause | `parsePermitRows` threw a plain `Error` carrying the zod message, and `errorText` shows any unrecognised error's message verbatim. |
| Fix | New fixed text `PERMITS_TEXTS.rowsUnreadable` = `Permit rows could not be read from this run` (`packages/shared/src/labels.ts`), added to plan § "Fixed texts and config keys" and test plan § 3 together. `parsePermitRows` throws `PermitRowsError` (`apps/web/src/engine/errors.ts`; message = the fixed text, `detail` = row, field and schema message); `errorText` maps it to the fixed text; the page logs every load failure with `console.error` (with `detail`). Commit: _(filled after commit)_ on `003-walking-skeleton`. |
| Tests | `apps/web/test/permits-state.test.ts` › "ERR-11: …" › "parsePermitRows rejects the row with the fixed rows-unreadable text, keeping the zod detail off the message" and "shows PERMITS_TEXTS.rowsUnreadable in the banner (never the zod message) and logs the detail with console.error"; `packages/shared/test/labels-extra.test.ts` › "has the rows-unreadable text (ERR-11), verbatim" and "has exactly the keys empty, countMismatch, engineFailure and rowsUnreadable". |
| Re-test | A-03-TC-020 PASS in hosted run 2 (build `fbdb68b`, 2026-10-21): the Permits page reaches `ready` with 35 rows; `smeargle` re-check 6/6 PASS |
| Status | ☒ Closed (2026-10-21) ☐ Reopened · Re-tested: PASS in hosted run 2 (build `fbdb68b`, 2026-10-21) |
