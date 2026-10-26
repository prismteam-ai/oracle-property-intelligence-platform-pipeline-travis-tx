---
id: ERR-32
type: defect
kind: product defect
feature: FEAT-A13
story: A-13
test_case: A-13-TC-072, A-13-TC-080
ac_reference: A-13-AC-13
severity: High
status: Closed (fixed, re-tested PASS on hosted build 34c8eaf, 2026-10-22)
found_by: hosted Playwright run (general phase)
found_date: 2026-10-22
fix_branch: 013-explorer-and-pages
fix_commit: a285dbe
retest_date: 2026-10-22
---

# ERR-32: Touch targets under 48 px and form controls with UA font (390 and 1440)

## Brief description

First hosted run of A-13 against the preview (build `641bc25`). This is a **product defect**.

## Related requirement

- **Story:** A-13 · **AC:** A-13-AC-13 · **Requirement:** FR-018 · **Test case:** A-13-TC-072, A-13-TC-080

## Environment

| Item | Value |
| --- | --- |
| URL | https://013-explorer-and-pages.d2lx0utip89u18.amplifyapp.com |
| Build | `641bc25` (preview build) |
| Data snapshot | manifest `bafkreiasycmsr2qdlxqcfg3yc2conpn3jxmohz7gs55hkseipplhpqsk5i` |
| Browser / OS / device | Playwright Chromium (desktop; 390 for the touch-target cases) |

## Steps to reproduce

Run `tests/e2e/A-13-*.spec.ts` case `@scenario:A-13-TC-072` with RUNTIME_URL set to the preview.

## Expected result

Every target is at least 48 x 48 px at 390; computed fonts come from the Atlas tokens.

## Actual result

Checkboxes input 20x20 (filter sheet, More sheet context), Hub footer links Privacy 46x48 and Terms 40x48, Data · Manifest "Copy CID" 35x48 (31 times), explore @ 1440 checkbox font-family Arial and font-size 13.3333px.

## Root cause

CSS: native checkbox size, flex shrink on the Copy CID button, links without a min-width, checkboxes without `font: inherit`.

## Fix

FilterSheet.module.css .box (48 px hit area, drawn 20 px box, font: inherit), CidDisplay .copy, Hub .link, DataManifest .actionLink, AppShell .titleLink, Provenance .link (min sizes var(--space-9)). The token audit flagged only the two checkboxes (UA font): a real violation, so the audit is unchanged.

## Regression test

apps/web/test/touch-targets.test.ts (source-level, jsdom computes no layout); hosted TC-072 / TC-080 re-test

## Resolution

| Field | Value |
| --- | --- |
| Root cause | CSS: native checkbox size, flex shrink on the Copy CID button, links without a min-width, checkboxes without `font: inherit`. |
| Fix | uncommitted on `013-explorer-and-pages` (parent commits) |
| Re-test | pending: hosted re-run on the next preview build |
| Status | Fixed, re-test pending (hosted) |
