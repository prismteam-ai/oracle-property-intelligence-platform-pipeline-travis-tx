# Tasks: A-16 cost, admin, prototype parity, full-county index

**Input**: [spec.md](spec.md), [plan.md](plan.md), [agent-design.md](agent-design.md) · **Tests**: written first in every group (constitution X) · **Test cases**: `testplans/A-16-test-cases.md`

Format: `[ID] [P?] [Group] Description — files — AC / Closure ID`. `[P]` = can run in parallel with the other tasks of the same phase. Groups own disjoint files (plan.md § Project Structure, updated below); a builder never edits another group's file.

**Group ownership (final):**

- **G1 metagross · infra + API:** `infra/src/api-stack.ts`, `ops-stack.ts`, `web-stack.ts`, `data-stack.ts`, `config.ts`, `infra/test/*` (except `admin-queue.test.ts`), `apps/api/src/trpc.ts`, `context.ts`, `routers/admin.ts`, `routers/index.ts`, `apps/api/package.json`.
- **G2a metagross · admin + Coverage + Runs pages:** `apps/web/src/auth/*`, `routes/AdminSignIn.tsx`, `Activity.tsx`, `Coverage*.tsx`, `Runs*.tsx`, `Runs.shared.tsx`, `data/run-loader.ts`, `content/*`, `scripts/build-cost-limits.mjs`, `packages/shared/src/routes.ts`, `routes/route-list.ts`, `tests/e2e/A-16-admin.spec.ts`, `tests/e2e/A-16-cost.spec.ts`, `tests/e2e/lib/auth.ts`, `playwright.config.ts`.
- **G2b metagross · parity on every other page + speed:** `apps/web/src/routes/{Hub,Explore*,PropertyDrawer,DataCatalog,DataManifest,DataVerify,HelpMcp,Legal*,ComingSoon,Permits*}.tsx` and their `.module.css`, shared `components/*` and shell, `engine/load-permits.ts`, `routes/ExploreSql.engine.ts`, `tests/e2e/responsive.spec.ts`, `tests/e2e/lib/a13-fixtures.ts`, `tests/e2e/A-13*.spec.ts`, `tests/e2e/A-14*.spec.ts` (unparking only), `tests/e2e/A-16-parity.spec.ts`, `tests/e2e/A-16-county.spec.ts`.
- **G3 machamp · contract, queue, bridge, pipeline closures:** `packages/contract/src/{run-command,live-run,index}.ts`, `infra/src/admin-queue.ts`, `infra/test/admin-queue.test.ts`, `pipeline/bridge/*`, `pipeline/local-stack/scripts/run-lock.ts`, `batch-hash-validate-export.sh`, `pipeline/oracle-runtime/travis/permits/write-group.ts`, `run-manifest.ts`, `pipeline/publish/src/manifest.ts`.
- **G4 machamp · per-run Explore index + agent/MCP read path:** `pipeline/publish/src/explore-index.ts`, `pipeline/publish/scripts/build-explore-index.ts`, `pipeline/publish/test/explore-index.test.ts`, `apps/api/src/engine/**`, `apps/api/src/routers/explore.ts`, `apps/api/src/agent/**`, `apps/api/src/mcp/**`.
- **Me (main session):** `tests/e2e/A-16-closure.spec.ts`, `docs/**`, `specs/016-*/**`, `stories/A-16-*`, `docs/decisions/0001-read-path.md` amendment, `docs/architecture-constitution.md` amendment rows.

---

## Phase 1 · Wave 1: frozen interfaces (≈10 min, before any group builds)

- [x] T001 [G3] `RunCommandV1`, `LiveRunV1` strict Zod schemas + fixtures + tests — `packages/contract/src/run-command.ts`, `live-run.ts`, `index.ts` — AC-7, AC-9 — done `ffc86fe`
- [x] T002 [P] [G1] Admin router I/O schemas (`admin.me`, `admin.run.start/stop/retry`, `admin.activity.summary`) and env-name constants (`VITE_COGNITO_USER_POOL_ID`, `VITE_COGNITO_USER_POOL_CLIENT_ID`, `COUNTYLENS_ADMIN_QUEUE_URL`, `EXPLORE_INDEX_PREFIX`) and `EXPLORE_SEARCH_THROTTLE` — `apps/api/src/routers/admin.ts` (schemas only), `infra/src/config.ts` — AC-6, AC-8 — done `3e435b5`
- [x] T003 [P] [G4] Index schema + key layout `private/explore-index/<manifestCid>/` + `IndexDescriptor` Zod (manifest CID, part CIDs + SHA-256, `viewsSha256`) — `pipeline/publish/src/explore-index.ts` — AC-13 — done `a137d5e`
- [x] T004 [P] [G2a] Routes `/admin/sign-in`, `/activity` and the `cost-limits.generated.json` row schema — `packages/shared/src/routes.ts`, `apps/web/src/content/cost-limits.schema.ts` — AC-4, AC-6 — done `6f966ff`
- [x] T005 [Me] ADR-0001 read-path amendment (private derived per-run index built only from published CIDs; PO option a, 2026-10-26) — `docs/decisions/0001-read-path.md`, `docs/architecture-constitution.md` — AC-13 — done `21aaa32`, accepted `ffc86fe`; constitution row AM-11 (0.2.6)

**Checkpoint:** commit `A-16: wave 1 frozen interfaces`; all groups rebase on it.

## Phase 2 · Wave 2: build in parallel (tests first)

### G4 · index (critical path) — AC-13, A13-1, A13-8, A14-1, A14-4, A14-5, A14-8

- [x] T010 [G4] Tests: fixture run → each index file's schema equals `DESCRIBE` of the bound view; `EXCEPT ALL` parity 0; SHA mismatch and unbound batch are hard stops; existing index is a no-op — `pipeline/publish/test/explore-index.test.ts`; `index.json` also records raw-table permit count vs `v_roofing_permit` count (A14-7) — done `a137d5e`
- [x] T011 [G4] Build CLI ported from Task B `BuildIndex`/`fetchPart`/`plan` (`--manifest --source cidcopy|local --upload --verify`), `index.json` written last, `If-None-Match` upload — `pipeline/publish/scripts/build-explore-index.ts` — done `a137d5e`
- [x] T012 [G4] Tests then reader: verify `index.json` (manifest CID, `viewsSha256`), download to `/tmp`, views over `read_parquet`, single in-flight cold load, `index_not_built` / `index_stale` — `apps/api/src/engine/explore-index.ts`, `duckdb-node.ts` `bind()` — done `0d71919`
- [x] T013 [G4] Tests then map `index_not_built`/`index_stale` to a typed tRPC error, agent tool error and MCP `isError` with reason; out-of-area filter returns "owner area not published in this run" — `apps/api/src/routers/explore.ts`, `agent/tools.ts`, `mcp/tools.ts` — done `0d71919`
- [x] T014 [G4] Tests then A14-5: structured empty outcomes (`empty_in_scope`, `field_not_published`) from tool filters/results, not question wording (Task B pattern) — `apps/api/src/agent/citations.ts`, `ask.ts` — done `0d71919`
- [x] T015 [P] [G4] Tests then A14-8 (part): MCP per-call deadline below the Lambda timeout; runs-index cache (60 s); A14-6 (part): distinct `run_lookup_failed` reason — `apps/api/src/mcp/*`, `apps/api/src/agent/*` — done `0d71919`
- [x] T016 [G4] Build + upload the Run 2 index (and Run 3 with `--source local` if its publish lands) with `pipeline/publish/scripts/build-explore-index.ts --verify`; record timings in `docs/evidence/A-16.md` — done `8565350` (Run 1 and Run 2 indexes, merge `28ae25c`; Run 3 index `a33279c`)

### G1 · infra + API — AC-2, AC-6, AC-8, AC-10, AC-11, A13-6, A14-3

- [x] T020 [G1] Tests first: `infra/test/idle-cost.test.ts` (scheduler DISABLED; 0 Secrets Manager secret/RDS/KMS key/WAF/hosted zone/provisioned or reserved concurrency; log retention 14 d, access/query log 30 d; budget 10; no literal region outside `config.ts`; `AllowAdminCreateUserOnly`; queue RedrivePolicy + DLQ alarm; no queue resource policy; no SQS→Lambda event source; grep gate for DB connection strings in `apps/` + `infra/`) — done `3e435b5`
- [x] T021 [G1] Cognito pool (self sign-up off, email alias, SRP client, no secret, `admin` group) in `CountyLensApi`; Amplify env vars — `infra/src/api-stack.ts`, `web-stack.ts` — done `3e435b5`
- [x] T022 [G1] API timeout 29 → 15 s, memory 1,769 MB, `EXPLORE_INDEX_PREFIX` env + GetObject on `private/explore-index/*` and `live/live.json` for API/agent/MCP roles; `ANY /trpc/explore.search` route with `EXPLORE_SEARCH_THROTTLE`; Lambda p95 duration alarm → Ops topic — `api-stack.ts`, `ops-stack.ts` — done `3e435b5`
- [x] T023 [G1] Instantiate `AdminQueue` (G3 construct) in `api-stack.ts`; API role `sqs:SendMessage` only — done `3e435b5`
- [x] T024 [G1] Tests then `adminProcedure` (`aws-jwt-verify`, access token, `admin` group; 401 before 403; log without token); `admin.me`, `admin.run.start/stop/retry` (send `RunCommandV1`, reject while `live.json` running), `admin.runs.live`, `admin.activity.summary` (Logs Insights, 5-min cache, query strings returned) — `apps/api/src/trpc.ts`, `context.ts`, `routers/admin.ts`, `routers/index.ts` — done `3e435b5`

### G3 · queue + bridge + pipeline closures — AC-7, AC-9, AC-11, A11-1, A11-6, A11-10

- [x] T030 [G3] Tests then `AdminQueue` construct: queue (SSE-SQS, visibility 120 s, retention 15 min, wait 20 s), DLQ (maxReceiveCount 3, 14 d), DLQ alarm → topic prop — `infra/src/admin-queue.ts`, `infra/test/admin-queue.test.ts` — done `2801ce2`
- [x] T031 [G3] Tests then bridge loop with a fake SQS client: long poll, validate, idempotency file, expiry check, reject second Start, Stop between atomic steps, `live.json` heartbeat every 30 s — `pipeline/bridge/src/{loop,idempotency,live,stop}.ts` — done `2801ce2`
- [x] T032 [G3] Tests (dry-run on the Run 3 manifest asserts the `gate` step runs) then runner: AustinPermits incremental via Restate ingress (keyed by command ID) → link/re-export → permit batches → `build-run-manifest.ts` → `publish-run.ts` gated steps; `mode: dry_run` passes `--dry-run` — `pipeline/bridge/src/runner.ts` — A11-1 — done `2801ce2` (live run on hold, see TZ05)
- [x] T033 [P] [G3] A11-10(b) atomic stale-lock takeover + test — `run-lock.ts`, `batch-hash-validate-export.sh` — done `0f05f50`
- [x] T034 [P] [G3] A11-10(c) coordinate flag, A11-10(d) coverage overrides on unchanged count, A11-6 exclusion-key reconciliation + tests — `write-group.ts`, `run-manifest.ts`, `pipeline/publish/src/manifest.ts` — done `553918a`
- [x] T035 [G3] Bridge README (start command, profile `assess`, kill switch) — `pipeline/bridge/README.md` — done `2801ce2`

### G2a · admin + Coverage + Runs pages — AC-4, AC-5, AC-6, AC-7, AC-9, AC-10, AC-12 (these pages), A13-3

- [x] T039 [G2a] Tests first: `tests/e2e/lib/auth.ts` (credentials from `~/.config/assessment/countylens-test.env`, `storageState` gitignored) and `tests/e2e/A-16-admin.spec.ts` + `A-16-cost.spec.ts` cases for AC-4..AC-10 + AC-12 (these pages); credentials env names as in `testplans/A-16-test-cases.md` — done `6f966ff`
- [x] T040 [G2a] Tests then `scripts/build-cost-limits.mjs` (prebuild): parse `docs/cost.md` + `docs/source-limits.md` → `cost-limits.generated.json`; fails on a row without a date or a zero where the doc says not available; drift test — done `6f966ff`
- [x] T041 [G2a] Coverage · Cost and Limits sections in `apps/web/src/routes/Coverage.tsx` + `CoverageCostLimits.tsx` per `Coverage{390,768,1440}` / `CoverageStates` boards: gross vs credits, as-of, source, "not available · reason", TCAD "blocked" row — done `6f966ff`
- [x] T042 [G2a] Auth copied from Task B (`config`, `signIn`, `signOut`, `session`, `identity`, `RequireSession`), page `AdminSignIn` per `AdminSignIn*` boards ("code sent" state Justified), "Sign-in is not available right now, try later" — done `6f966ff`
- [x] T043 [G2a] Runs admin controls in `apps/web/src/routes/Runs.tsx` + `RunsAdmin.tsx` per `RunsAdmin1440` (+ 768/390 by the Runs boards): Start / Stop / Retry, "Signed in as admin", states from `admin.runs.live` (Running · started, Bridge offline · command expired at, A run is already running, stopped by admin) — done `6f966ff`
- [x] T044 [G2a] Activity page `apps/web/src/routes/Activity.tsx` per `Activity*` / `ActivityStates` boards; each number links to its Logs Insights query — done `6f966ff`
- [x] T045 [G2a] Tests (LCP case TC-NF) then A13-3 LCP: run list from `runs/index.json` first, manifest after — `Runs.shared.tsx`, `data/run-loader.ts` — done `6f966ff` (Catalog and Manifest LCP still over target: A13-3 Exception, TC-081 re-parked `0a2f0ed`)
- [x] T046 [G2a] Parity fixes for Coverage, Runs, Runs · Compare, Runs · Log from the matrix — `apps/web/src/routes/{Coverage,Runs,RunsCompare,RunsLog}.tsx` + `.module.css` — done `6f966ff`

### G2b · parity on every other page + speed — AC-12, A11-9, A11-11, A11-12, A13-2, A13-7, A13-8

- [x] T050 [G2b] Parity fixes from `docs/evidence/A-16-prototype-parity.md` in the G2b files listed above (`apps/web/src/routes/*.tsx` + `.module.css`, `components/*`), family by family: Shell/Hub/Welcome → Explore + drawer + filters + Search → ExploreQ AI/SQL states → Data ×3 → Help MCP → Legal ×3 → Coming soon / UserSignIn; Atlas tokens and components only — done `898e075` (G2b merge; final hosted parity fixes `9834159`)
- [x] T051 [G2b] Tests (unit: only named views bound) then A13-2 SQL panel: bind only the views a query names, memoised — `ExploreSql.engine.ts`; A13-7 copy items (SQL progress `role="status"` note, Retry on the engine-error banner, Catalog "unclassified table parts (N)", accessible name + inset focus ring on `<main>`) — done `0e0b78f`; Exception: the PO later removed the Explore SQL tab and its hosted tests (`eb9f6d5`, `fa09e69`), so `ExploreSql.engine.ts` no longer exists
- [x] T052 [G2b] Tests (unit: fallback over the cap throws `TooLargeOnFallback`) then A11-9 `TooLargeOnFallback` typed error + message; A11-11 first paint from the first page of parts, rest after; tighten the 60 s limit to measured p95 × 2 — `engine/load-permits.ts`, `Permits.page.tsx`, `tests/e2e/lib/perf.ts` — done `7b966c6` (60 s limit kept until a hosted measurement exists, A11-11 closure row)
- [x] T053 [G2b] Remove `parkGap` calls once T016 is live on the preview — `tests/e2e/lib/a13-fixtures.ts`, A-14 spec skips — done `68a7701`; Exception: recorded parks kept (A-13 TC-053, A-13 TC-081, A-03 TC-034)

### Closure tasks added after `/speckit-analyze` (H4)

- [x] T036 [G3] Tests then A11-16: `verify-manifest --sample` exit code, `openDaysReason` default, timeouts on untimed downloads; A11-17 R4–R6: `deferredGateways` in car-file receipts, receipt re-check after taking the lock, real exit codes in worker scripts — `pipeline/publish/scripts/*`, `pipeline/publish/src/*` (not `explore-index.ts`) — done `0f3f7c5`
- [x] T025 [G1] A14-3/A14-6: wire the agent 80% spend alarm to the Ops topic; alarm on account concurrent executions ≥ 8; note the quota-increase option — `infra/src/ops-stack.ts` — done `3e435b5`
- [ ] T026 [G2b] T053 also covers the A-14 spec skips; G2b owns those edits — `tests/e2e/A-14*.spec.ts` — Exception: no A-16 parks were found in `tests/e2e/A-14*.spec.ts` and A-16 did not edit them; their remaining skips depend on the live G2 answer, the MCP token or the extra-ask budget switch
- [ ] T072 [Me] A11-4 fresh sample verify log of Run 1 and Run 2 (operator tool, small sample per PO 2026-10-25); A11-10(a) and A11-8 minors written as Exceptions; A13-5 county counts: Closed if Run 3 publishes them, else Exception; A11-14 county CARs attached to the newest Release; A11-17 R10–R11 labels/docs — `docs/evidence/A-16.md`, `docs/sources.md` — Exception: closure rows written (`421d0da`); no fresh Run 1/Run 2 sample verify log (A11-4 Exception: hosted TC-040 sample check is the proof), A11-14 CARs moved to the PO second-pin session, A11-17 R10–R11 left for the release sweep, `docs/sources.md` not changed
- [ ] T073 [Me] A14-4 golden queries G1–G6 rerun on the full county after T016 — `docs/evidence/A-16.md`, `docs/reports/A-16-test-report.md` — Exception: six-case grader not run on the full county (unsigned Run 3 manifest fetch returned 403); README prompts D-10/D-11 answered on Run 3 instead (A-16-TC-035, `1b7f627`)

### G5 · second copy + independent gateways (AM-10, branch `016b-second-copy-and-gateways`) — A11-3, A11-14

- [x] T074 [Me] AM-10 in `docs/architecture-constitution.md` § 16 (draft 2026-10-26; ✋ PO approves the wording, then version bump)
- [x] T075 [P] [metagross] `packages/shared/src/urls.ts`: gateway name `orbitor`, host key `ORBITOR_GATEWAY_HOST` / `VITE_ORBITOR_GATEWAY_HOST` (default `ipfs.orbitor.dev`), tests
- [x] T076 [metagross] Verify page (`apps/web/src/data/verify-lane.ts`, `VerifyLane.tsx`, `DataVerify.tsx`, `DataManifest.tsx`, `RunsCompare.tsx`): independent lanes Pinata + orbitor; Filebase as a labelled fallback lane that never counts as independent; a "Stored on" line (Filebase pin, Pinata copy, GitHub Release backup) with provenance; tests (after T075)
- [x] T077 [P] [metagross] `infra/src/web-stack.ts`: `VITE_ORBITOR_GATEWAY_HOST` env var on the Amplify app, tests (after T075)
- [x] T078 [P] [oracle] `scripts/verify-manifest.ts`: `GATEWAYS` = Pinata + orbitor, Filebase fallback reported separately; a JSON evidence file option; tests
- [x] T079 [P] [oracle] `pipeline/publish/scripts/pinata-copy.ts` (+ `src/pinata-pin.ts` `cidVersion: 1`): upload manifests and a chosen set of table files, compare each CID with the manifest, unpin a mismatch, stop at the quota budget, write a receipt per file under `specs/016-cost-and-admin/pinata-receipts/<runId>/`; fake-fetch tests, no real network
- [x] T080 [Me] After Run 3.1 publishes: run T079 on Run 3.1 (manifest first, stop on mismatch), then T078 on the same set; evidence in `docs/evidence/A-16.md`, $0 row in `docs/cost.md`, A11-3 / A11-14 rows in the Closure table, PR known-gap wording

## Phase 3 · Finalise docs (Me, parallel with Phase 2)

- [ ] T070 [Me] Read the bill again after the deploy, ✋ PO takes the Cost Explorer screenshot (`docs/evidence/img/A-16-billing.png`), finalise `docs/cost.md` (FR-001: Part 2 rows after deploy, older `assessment usd` budget note, shared-account upper bound) and `docs/source-limits.md` (FR-003: TCAD 403 and Bedrock 10 rpm evidence links or "no evidence file" marked) — `docs/cost.md`, `docs/source-limits.md` — Exception: `docs/cost.md` Part 2 rows done (`8c649d0`) and `docs/source-limits.md` marks "no evidence file" (`d3ce6d3`); the Cost Explorer screenshot `docs/evidence/img/A-16-billing.png` is a PO action still pending
- [x] T071 [P] [Me] Parity inventory (smeargle, read-only, started in wave 1 on 2026-10-26) moved into the repo — `docs/evidence/A-16-prototype-parity.md`, `docs/evidence/img/A-16-parity-*.png` — done `b0f3676` (after-fix images `a1dbcbb`)

## Phase 4 · Batches, deploy, hosted proof (TZ)

- [x] TZ01 [Me] Batch 1 push (web parity + Coverage + docs): local CI checks (`pnpm check`, `pnpm format:check`, `scripts/grep-gates.sh`, stylelint, bundle gate) → `git push origin 016-cost-and-admin` → Amplify preview `/build.json` = head → smoke on the preview; then 🛑 PO OK → laptop `cdk deploy` (profile `assess`, `CountyLensApi` → `CountyLensWeb` → `CountyLensOps`) → smoke `admin.me` 401 and `explore.search` on Run 2 at once; ✋ PO creates the admin and a non-admin Cognito user (commands pre-filled in `docs/evidence/A-16.md`) — done `7a0b460`
- [x] TZ02 [Me] Batch 2 push (admin UI/API, index read path, speed, parity rest) → preview; one review round in parallel while it builds: `/code-review medium` + `metagross`, `machamp`, `audino` read-only, each ≥ 75 — `docs/reviews/CR-A-16.md` — done `0c9173a`
- [ ] TZ03 [Me] Hosted Playwright on the preview: `tests/e2e/A-16-{admin,cost,county,parity,closure}.spec.ts` (one test per `testplans/A-16-test-cases.md` UI case), unparked A-13/A-14 cases, `tests/e2e/responsive.spec.ts`; index p95 20 cold + 20 warm — `docs/reports/A-16-test-report.md`, screenshots `docs/evidence/img/A-16-TC-{nnn}-{step}.png` — Exception: `tests/e2e/A-16-parity.spec.ts` was not written; parity cases TC-023..033 passed by hosted review (`docs/evidence/A-16-prototype-parity.md`, `9834159`); `A-16-{admin,cost,county,closure}.spec.ts` exist and pass (27 passed, 5 skipped on `871664d`, report `25326bf`); index p95 measured as 20 warm calls per search (A-16-TC-034), not 20 cold
- [x] TZ04 [Me] `smeargle` at 390/768/1440 on every page family (AC-12) after the fixes — `docs/evidence/A-16-prototype-parity.md`, `docs/evidence/A-16-smeargle.md` — done `9834159` (smeargle re-check `a1dbcbb`); results kept in `docs/evidence/A-16-prototype-parity.md`, no separate `A-16-smeargle.md`
- [ ] TZ05 [Me] Independent test = story `agents.verify`: `docs/cost.md` + billing evidence; ✋ PO starts local stack + bridge; admin Start (`dry_run`) → SQS message ID → bridge log → Restate workflow ID → Runs page "Running"; non-admin 403; bridge stopped → expired; DLQ alarm email — `docs/evidence/A-16.md` § Part 2 — Exception: `docs/cost.md` done, billing screenshot pending (PO); live bridge test (Start, Stop, expiry, DLQ email) on hold by the PO until Run 3.1 is done; non-admin 403 passed (A-16-TC-016)
- [ ] TZ06 [Me] Fixes (`docs/defects/ERR-75+`), `/speckit-converge` once, evidence `docs/evidence/A-16.md` (§ Closure = story Closure table), statuses (story Done, `docs/traceability.md` A-16 rows + gate log, `docs/feature-list.md`, `docs/decisions/DEC-A-13-explore-full-county.md` + `DEC-A-14-agent-mcp-full-county.md` closed/superseded, `docs/pr-body.md` Known gaps), one `docs/kit-usage.md` line (agents and skills used in A-16), G7 pre-check `docs/gates/G7-A-16-precheck.md` → 🛑 G7 → `git merge --no-ff` → `bash scripts/progress.sh` → push — Exception: in progress, G7 pending (ERR-75..78 recorded, evidence and closure table written; `/speckit-converge`, statuses, G7 and merge not done)

## Dependencies

T001–T005 → everything. T030 → T023. T011 → T016 → T053, TZ03. T024 + T042 → T043, T044. T071 (smeargle matrix) → T046, T050. TZ01 needs T039–T041 and T050 (first families) for the push, and T020–T023, T030 for the deploy. TZ05 needs TZ01 and T031–T032. Tests precede implementation in every group (T010→T011, T012, T013…; T020→T021–T024; T030, T031 first; T039→T040–T046).
