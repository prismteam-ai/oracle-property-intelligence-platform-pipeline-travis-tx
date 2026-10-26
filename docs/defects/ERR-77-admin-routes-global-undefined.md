---
id: ERR-77
type: defect
feature: FEAT-A17
story: A-16
test_case: A-13-TC-083 (a13-scan) on the 016 preview; A-16-TC-010 (admin sign-in)
ac_reference: AC-6, AC-10
severity: High
status: Fixed in code (local production build renders both routes); closes on the next preview build and hosted re-test
found_by: Claude (main session), probing the preview after CI run on d7f5c5b, for HebaGaber
found_date: 2026-10-26
fix_branch: 016-cost-and-admin
fix_commit: pending
retest_date: pending
closed_date: pending
---

# ERR-77: `/admin/sign-in` and `/activity` crashed on the hosted build ("global is not defined")

## Brief description
On the Amplify preview both admin routes rendered React Router's default error boundary: `ReferenceError: global is not defined`. `amazon-cognito-identity-js`, copied from Task B, reads Node's `global`; Task B's Vite config defines `global: "globalThis"`, ours did not. Unit tests run in Node (where `global` exists), so only the production bundle failed. A-13-TC-083 timed out waiting for the route section.

## Fix
`apps/web/vite.config.ts`: `define: { global: "globalThis" }` (the Task B setting). Local `vite build` + `vite preview`: both routes render their section; bundle gate unchanged (129.6 KB).

## Re-test
Next preview build: open `/admin/sign-in` and `/activity` at 390 px, the route section is visible, no page error; A-13-TC-083 passes.
