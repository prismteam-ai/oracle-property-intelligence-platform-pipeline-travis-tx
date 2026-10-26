---
id: ERR-75
type: defect
feature: FEAT-A17
story: A-16
test_case: smoke after the A-16 deploy (`admin.me` signed out); unit pin in apps/api/test (error shape)
ac_reference: AC-8 (refusal logged without the token; nothing internal exposed)
severity: Medium
status: Closed 2026-10-26: CountyLensApi redeployed (191 s, PO-approved); GET /trpc/admin.me signed out answers 401 with no `stack` in the body
found_by: Claude (main session) for HebaGaber
found_date: 2026-10-26
fix_branch: 016-cost-and-admin
fix_commit: 814dbb6
retest_date: 2026-10-26
closed_date: 2026-10-26
---

# ERR-75: tRPC error responses carried a server stack trace

## Brief description

The first smoke after the A-16 deploy (`GET /trpc/admin.me` signed out) answered the correct 401, but the JSON error body included `data.stack` with internal file paths (`/apps/api/src/handlers/trpc.ts:249`, node_modules paths). Present since A-03: `initTRPC.create()` defaults `isDev` to `NODE_ENV !== "production"`, and the Lambdas do not set `NODE_ENV`, so every tRPC error in production carried its stack.

## Impact

No secret or token was exposed (the stack holds code paths only), but internal structure leaks to any caller, and the evaluator would see it on any error state.

## Fix

`apps/api/src/trpc.ts`: `initTRPC.context<Context>().create({ isDev: false })`, so error bodies never include `stack`. A unit test asserts no `stack` field on a refused admin call.

## Re-test

After the next `CountyLensApi` deploy: `GET /trpc/admin.me` signed out → 401 with no `stack` in the body.
