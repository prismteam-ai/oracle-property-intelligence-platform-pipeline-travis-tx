---
id: ERR-30
type: defect
kind: product defect
feature: FEAT-A13
story: A-13
test_case: A-13-TC-039
ac_reference: A-13-AC-6
severity: Medium
status: Closed (fixed, re-tested PASS on hosted build 34c8eaf, 2026-10-22)
found_by: hosted Playwright run (general phase)
found_date: 2026-10-22
fix_branch: 013-explorer-and-pages
fix_commit: a285dbe
retest_date: 2026-10-22
---

# ERR-30: Explore · SQL – mistyped keyword gets the read-only refusal, not 'message · Try: fix'

## Brief description

First hosted run of A-13 against the preview (build `641bc25`). This is a **product defect**.

## Related requirement

- **Story:** A-13 · **AC:** A-13-AC-6 · **Requirement:** FR-017 · **Test case:** A-13-TC-039

## Environment

| Item | Value |
| --- | --- |
| URL | https://013-explorer-and-pages.d2lx0utip89u18.amplifyapp.com |
| Build | `641bc25` (preview build) |
| Data snapshot | manifest `bafkreiasycmsr2qdlxqcfg3yc2conpn3jxmohz7gs55hkseipplhpqsk5i` |
| Browser / OS / device | Playwright Chromium (desktop; 390 for the touch-target cases) |

## Steps to reproduce

Run `tests/e2e/A-13-*.spec.ts` case `@scenario:A-13-TC-039` with RUNTIME_URL set to the preview.

## Expected result

One line `{message} · Try: {fix}` for `SELEC count(*) FROM v_property`.

## Actual result

"Read-only: only SELECT, WITH, DESCRIBE and SHOW run here".

## Root cause

readOnlyRefusal refused every first word outside the allowlist, so a typo never reached the engine's error path.

## Fix

readOnlyRefusal returns `Syntax error near "SELEC" · Try: SELECT` when the first word is within edit distance 2 of SELECT/WITH/DESCRIBE/SHOW and not at least as close to a write/IO keyword; all other unknown words keep the refusal. Nothing runs.

## Regression test

apps/web/test/explore-sql.test.tsx (typo cases + refuse/allow cases), apps/web/test/review-a-units.test.ts unchanged

## Resolution

| Field | Value |
| --- | --- |
| Root cause | readOnlyRefusal refused every first word outside the allowlist, so a typo never reached the engine's error path. |
| Fix | uncommitted on `013-explorer-and-pages` (parent commits) |
| Re-test | pending: hosted re-run on the next preview build |
| Status | Fixed, re-test pending (hosted) |
