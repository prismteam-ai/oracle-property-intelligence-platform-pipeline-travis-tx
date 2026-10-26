# Implementation Plan: Prove zero idle cost, let the operator run the pipeline, match the prototype, and close the carried gaps

**Branch**: `016-cost-and-admin` | **Date**: 2026-10-26 | **Spec**: [spec.md](spec.md) | **Story**: `stories/A-16-cost-and-admin.md` | **Design**: [agent-design.md](agent-design.md)

## Summary

A-16 is the last Task A story. It proves zero idle cost from the real bill and shows it on Coverage (Part 1), adds an operator sign-in copied from Task B with a pull-only command queue and laptop bridge (Part 2), and closes the carried gaps (Part 3): every page matches its CountyLens prototype board at 390/768/1440 (AC-12), and Explore, the agent and MCP answer on the full county from a per-run index ported from Task B's `BuildIndex` (AC-13). Each carried item ends Closed or as a PO-approved exception (AC-14, Closure table in the story).

The whole story runs in one session (PO target: 3 hours) as four parallel builder groups with disjoint files, pushed in two batches, each checked on the Amplify preview before the next.

## Technical Context

**Language/Version**: TypeScript (Node 22) everywhere; no Python (constitution).
**Primary Dependencies**: existing tRPC API, React web app with Atlas tokens, DuckDB (WASM in the browser, node in Lambda and on the laptop), AWS CDK v2; new: `amazon-cognito-identity-js` (web sign-in, copied from Task B), `aws-jwt-verify` (API), `@aws-sdk/client-sqs`, `@aws-sdk/client-cloudwatch-logs`.
**Storage**: CID-copy S3 bucket (adds private prefixes `index/{runId}/` and `live/`), existing DynamoDB tables; no new database.
**Testing**: Vitest (unit, contract), `cdk synth` assertions (`infra/test/`), Playwright on the hosted preview / production, smeargle parity run.
**Target Platform**: Amplify static hosting + API Gateway HTTP API + Lambda in `eu-north-1`; the bridge runs on the operator laptop.
**Performance Goals**: Explore p95 < 3 s on the full county; Activity p95 < 3 s cached; command pickup ≤ 60 s.
**Constraints**: $0 idle (constitution A7, P0-19); no inbound path to the laptop (ARD § 2.2, P0-1); Query DB never exposed; publish only through the gated path; account Lambda concurrency 10.
**Scale/Scope**: 441,961 properties, 15,025 permits per run; ~25 routes × 3 widths for parity.

## Kit Agent Ownership *(mandatory, constitution XIII–XVII)*

| Role | Agent(s) | Skills loaded | What it decided (cite agent-design.md) |
|------|----------|---------------|----------------------------------------|
| Design consult | `metagross` (sign-in, infra, Coverage, Activity, web speed), `machamp` (queue + bridge; per-run index), `smeargle` (parity inventory) | `build-frontend-backends`, `build-batch-workflows`, `responsive-design-tests` + `apply-engineering-guidelines` | metagross §1–6: copy Task B auth, pool in `CountyLensApi`, `adminProcedure` with `aws-jwt-verify` (not an HTTP authorizer, `/trpc` is shared), timeout 15 s, `explore.search` route throttle, duration alarm, `idle-cost.test.ts`, build-time cost JSON. machamp (queue) §1–5: `RunCommandV1`/`LiveRunV1`, queue + DLQ (3) + one alarm, bridge reusing the gated publish, A11-6/10b/10c/10d closures. machamp (index): see agent-design.md § index. smeargle: parity matrix. |
| Builder | G1 `metagross` (infra + API), G2a `metagross` (admin, Coverage, Runs pages), G2b `metagross` (parity on every other page + speed), G3 `machamp` (contract, queue construct, bridge, pipeline closures), G4 `machamp` (index build + index read path in query-core/explore/agent/MCP tools) | same + `apply-engineering-guidelines`, `frontend-bug-fix` (G2) | See Project Structure: each group owns files no other group touches. |
| Reviewer(s) | `metagross`, `machamp`, `audino` | — | Score the branch 0–100 (≥ 75) in `docs/reviews/CR-A-16.md`; plus `/code-review medium`. |
| Verify | `docs/cost.md` + billing evidence; Playwright admin sign-in + Start reaches the bridge; non-admin 403; parity matrix; Explore/agent/MCP on the full county | — | Hosted only. |

**Patterns the code must show:**
- `adminProcedure` is the only gate on `admin.*`; 401 before 403; the token never logged — `apps/api/src/trpc.ts`.
- The API can only send to the queue; the bridge only receives/deletes; no SQS→Lambda trigger — `infra/src/admin-queue.ts`.
- The bridge publishes only via `scripts/publish-run.ts` steps including `gate` and `gate-remote` — `pipeline/bridge/src/runner.ts`.
- The index is built only from CIDs in the run manifest and records them in its header; the API never reads the Query DB — `pipeline/publish/src/explore-index.ts`, `apps/api/src/engine/explore-index.ts`.
- Cost numbers reach the page only from `docs/cost.md` / `docs/source-limits.md` through the generated JSON; a test fails on drift — `scripts/build-cost-limits.mjs`.

## Constitution Check

| # | Article | Check for this plan | Status |
|---|---------|---------------------|--------|
| I | Outcome first | Every AC verified on the hosted preview/production; CDK assertions in CI; bridge cases observed through the hosted Runs page | ✅ |
| II–IV | Stack | TypeScript, CDK only, five stacks kept (pool and queue in existing stacks), region from config | ✅ |
| V–VI | Contracts and LLM | New `.strict()` Zod contracts `RunCommandV1`, `LiveRunV1`, admin router I/O, index row schema; agent stays on the Vercel AI SDK `getModel()` | ✅ |
| VII–IX | Operations | DLQ alarm + Lambda duration alarm to the Ops SNS topic; Powertools logging; refusal logs without tokens | ✅ |
| X | Quality gates | Tests first per group; unit + synth + hosted Playwright + smeargle | ✅ |
| XI | Data honesty | Cost page shows gross vs credits and "not available · reason"; index answers say "index not available for this run" instead of timing out; parity differences recorded with reasons | ✅ |
| XII | Secrets | Test user credentials in `~/.config/assessment/countylens-test.env`; no secrets in git; Cognito users created by the operator via CLI | ✅ |
| XIII–XVII | Owner agents | agent-design.md filled; builders and reviewers above | ✅ |
| XVIII–XXIII | Delivery | G4 PASS (2026-10-26); G5/G6 together; branch `016-cost-and-admin`; defects from ERR-75 | ✅ |
| Addendum A6, A7 | Source terms, zero idle | Bridge respects existing source pacing (Austin ≥ 1 s per page); Cognito/SQS/SNS per-request only; no WAF (MCP 503 stays an exception, PO 2026-10-26) | ✅ |

## Project Structure

### Documentation (this feature)

```text
specs/016-cost-and-admin/
├── spec.md, plan.md, tasks.md, agent-design.md, run-log.md
├── checklists/requirements.md
testplans/A-16-test-cases.md
docs/cost.md, docs/source-limits.md
docs/evidence/A-16.md, A-16-prototype-parity.md, img/A-16-*
docs/reviews/CR-A-16.md, docs/reports/A-16-test-report.md
```

### Source Code (builder groups, disjoint files)

The authoritative file ownership per group (G1, G2a, G2b, G3, G4, Me) is the "Group ownership (final)" list at the top of [tasks.md](tasks.md); this plan does not repeat it, so the two cannot disagree.

**Frozen first (wave 1, before groups start):** admin router Zod I/O and `RunCommandV1`/`LiveRunV1` in `packages/contract` (G3 writes, G1/G2a read); env names `VITE_COGNITO_USER_POOL_ID`, `VITE_COGNITO_USER_POOL_CLIENT_ID`, `COUNTYLENS_ADMIN_QUEUE_URL`, `EXPLORE_INDEX_PREFIX`, `COUNTYLENS_TEST_USERNAME/PASSWORD`; routes `/admin/sign-in`, `/activity`; `cost-limits.generated.json` row schema; `EXPLORE_SEARCH_THROTTLE`; the index layout `private/explore-index/<manifestCid>/` and `IndexDescriptor` (G4 writes, G1 grants read).

### Data flow

1. **Cost and limits:** Cost Explorer + CloudFormation (read by the operator) → `docs/cost.md`, `docs/source-limits.md` → `scripts/build-cost-limits.mjs` at web build → `cost-limits.generated.json` → Coverage · Cost and Limits.
2. **Admin command:** browser (Cognito access token) → `/trpc` `admin.run.start` → `adminProcedure` (JWT + `admin` group) → SQS `countylens-admin-commands` (`RunCommandV1`) → bridge on the laptop (long poll, outbound only) → Restate `AustinPermits` → gated `publish-run.ts` → bridge writes `live/live.json` → API `admin.runs.live` → Runs page.
3. **Full-county read:** published parts on the CloudFront CID copy → laptop `build-explore-index.ts` (SHA-256 checked against the manifest) → `private/explore-index/<manifestCid>/` (4 Parquet + `index.json`) → Lambda `bind()` (verify `index.json`, `/tmp` cache) → `explore.search`, agent tools, MCP tools.
4. **Activity:** query log group (30 d) → Logs Insights from `admin.activity.summary` (5-min cache) → Activity page with query links.

### Integration points

- Cognito user pool (new, `CountyLensApi`); SQS queue + DLQ + alarm (new, `AdminQueue` construct in `CountyLensApi`, alarm to the `CountyLensOps` topic); S3 CID-copy bucket (new private prefixes); CloudWatch Logs Insights (existing query log); Restate ingress on the laptop (existing local stack); Amplify env vars (new pool IDs).
- Task B code copied, not linked: `roofing-crm` auth files and `BuildIndex` logic, adapted and owned here.

### Test approach

- **Unit/contract (Vitest, per group, tests first):** Zod contracts, `adminProcedure` 401/403, bridge loop with a fake SQS client, index build parity (`EXCEPT ALL` = 0) and reader stale/not-built, cost JSON drift, pipeline closures.
- **Infra (`cdk synth` assertions, CI):** `idle-cost.test.ts` (AC-2, AC-11), `admin-queue.test.ts`, updated `api.test.ts`.
- **Hosted (Playwright on the Amplify preview, then production):** `tests/e2e/A-16.spec.ts` one test per `testplans/A-16-test-cases.md` UI case; unparked A-13/A-14 cases; responsive suite; index p95 with 20 cold + 20 warm calls.
- **Parity:** smeargle at 390/768/1440 on every page family → `docs/evidence/A-16-prototype-parity.md`.
- **Bridge:** one real dry-run Start through SQS observed on the hosted Runs page, plus the offline/expired case.

### Order and pushes

1. Wave 1 (≈10 min): frozen contracts committed.
2. Wave 2: G1–G4 in parallel worktrees. Batch 1 push ≈ +30 min: parity fixes, Coverage · Cost and Limits, docs (web only). One laptop CDK deploy (PO OK) with G1 + G3 infra.
3. Batch 2 push: admin UI/API, index read path, speed items. Index built for the latest published run and uploaded.
4. Hosted tests on the preview; review round in parallel while the preview builds; fixes; G7.

## Complexity Tracking

| Item | Why Needed | Simpler Alternative Rejected Because |
|------|------------|---------------------------------------|
| Cognito pool in `CountyLensApi`, not a sixth stack (deviation from AD-23's rationale) | The API stack already owns the JWT audience and the Web stack already depends on it; no new dependency edge | A sixth stack adds cross-stack exports and a deploy order for one resource |
| `adminProcedure` with `aws-jwt-verify` instead of an HTTP API authorizer | `/trpc` is one route shared with public procedures | An authorizer on the route would lock the public API |
| AC-1 from the last billed days, Part 2 resources from pricing | PO 2026-10-26: one 3-hour session | A quiet day + 24 h Cost Explorer lag does not fit; recorded gate exception |
| Index is a private derived file (PO option a), not a published artifact | 5–7 h vs 1.5–2 days; built only from published CIDs and records them, so it is verifiable and rebuildable | Publishing a new artifact needs a new run and contract change |
| Task B's lockout Lambda not copied | Cognito's own throttling is enough for one operator; saves a Lambda and a table | Copying it adds idle-free but extra moving parts for no rubric value |
