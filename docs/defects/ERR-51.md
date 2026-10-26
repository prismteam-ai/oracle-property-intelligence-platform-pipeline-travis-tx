---
id: ERR-22
type: defect
kind: product defect
feature: FEAT-A13
story: A-13
test_case: A-13-TC-042
ac_reference: A-13-AC-13
severity: Medium
status: Closed (fixed, re-tested PASS on hosted build 34c8eaf, 2026-10-22)
found_by: hosted Playwright run (general phase)
found_date: 2026-10-22
fix_branch: 013-explorer-and-pages
fix_commit: a285dbe
retest_date: 2026-10-22
---

# ERR-22: Help · MCP – search_properties has no [data-schema] marker

## Brief description

First hosted run of A-13 against the preview (build `641bc25`). This is a **product defect**.

## Related requirement

- **Story:** A-13 · **AC:** A-13-AC-13 · **Requirement:** FR-023 · **Test case:** A-13-TC-042

## Environment

| Item | Value |
| --- | --- |
| URL | https://013-explorer-and-pages.d2lx0utip89u18.amplifyapp.com |
| Build | `641bc25` (preview build) |
| Data snapshot | manifest `bafkreiasycmsr2qdlxqcfg3yc2conpn3jxmohz7gs55hkseipplhpqsk5i` |
| Browser / OS / device | Playwright Chromium (desktop; 390 for the touch-target cases) |

## Steps to reproduce

Run `tests/e2e/A-13-*.spec.ts` case `@scenario:A-13-TC-042` with RUNTIME_URL set to the preview.

## Expected result

Inside each [data-tool], [data-schema] (search_properties) or [data-schema-pending] (the other five) is visible.

## Actual result

Locator `[data-tool] [data-schema], [data-schema-pending]` found no element for search_properties: the real parameter list had no marker.

## Root cause

HelpMcp.tsx marked only the pending lines; the real input list carried no data-schema hook.

## Fix

HelpMcp.tsx: the search_properties input list now carries data-schema.

## Regression test

apps/web/test/help-mcp.test.tsx (search_properties: data-schema inside its data-tool, no pending marker)

## Resolution

| Field | Value |
| --- | --- |
| Root cause | HelpMcp.tsx marked only the pending lines; the real input list carried no data-schema hook. |
| Fix | uncommitted on `013-explorer-and-pages` (parent commits) |
| Re-test | pending: hosted re-run on the next preview build |
| Status | Fixed, re-test pending (hosted) |
