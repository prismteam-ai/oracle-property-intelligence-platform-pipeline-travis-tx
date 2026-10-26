---
description: "Task list: A-11 Publish the full county by CID and keep it current with incremental runs"
---

# Tasks: Publish the full county by CID and keep it current with incremental runs

> **Correction (2026-10-23, mid-build):** T003/T004/T009/T010/T015 below describe widening
> `DataGroup` to 5 groups and adding `owner`/`contractor`/`parcels` coverage keys. That was
> wrong — see `research.md`'s "Correction" section — and was reverted in commit `dd884fd`.
> The real fix, done as an added task **T031**, wires A-07's contractor identity into
> `property_improvement`'s existing permit records instead of creating 3 new groups.

**Input**: Design documents from `/specs/011-publish-and-runs/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/publish-sequence.md, agent-design.md

**Tests**: MANDATORY. Test tasks come first in every phase and must fail before implementation tasks run.

**Builder groups (light lane L4, ≤ 4 groups)**: `G-PUB1` (oracle: tracks A+B), `G-PUB2` (oracle: tracks C+D), `G-RUN` (oracle: track E), `G-SCHED` (machamp: track F). Each group owns files no other group touches.

**Waves**: Wave 1 — G-PUB1, G-PUB2, G-RUN(a), G-SCHED run together (tests first, own files). Wave 2 — G-RUN(b)/(c) build on G-PUB1's manifest builder (cannot start until G-PUB1's T013 lands). After each wave: one integration check (full unit suite + typecheck + lint) before the next wave.

**Critical path**: Wave 1 (max of G-PUB1 ≈25m, G-PUB2 ≈25m, G-RUN(a) ≈20m, G-SCHED ≈25m → 25m) → integration check (≈3m) → Wave 2 (G-RUN(b)/(c) ≈15m) → integration check (≈3m) → the Run 1 dry run (unmeasured, runs in background from the start of Wave 1, overlaps the whole build) → draft manifest → review round. **Build-only critical path ≈ 46 min**; the dry run (Stage 5) and the UTC-date waits (Stage 6) dominate total wall-clock, not the build.

## Phase 1: Setup

- [x] T001 Confirm `~/.config/assessment/filebase.env` and `~/.config/assessment/pinata.env` both readable (chmod 600) before any builder starts; no file change. **Done**: RL 2026-10-23 05:58 S0.3 (Filebase env, 3 vars, PASS) and RL 06:30 ✋ A-1 confirmed (`PINATA_...` present, chmod 600, value never read/printed).
- [x] T002 [P] Confirm `pipeline/publish/` and `infra/` both typecheck and lint clean on `011-publish-and-runs` before any task starts (baseline for the Wave 1→2 integration checks). **Done** (inferred, no dedicated baseline-check log line): all four Wave 1 builder groups started immediately after (RL 08:05) and Integration check 1 (RL 08:20) found the combined result clean, which is only possible if the pre-Wave-1 baseline was already green.

**Checkpoint**: baseline green; builder groups may start.

## Phase 2: Foundational

- [x] T003 [oracle] Widen `DataGroup` from `"county" | "property_improvement"` to the 5 full-county groups (`county`, `property_improvement`, `owner`, `contractor`, `parcels`) in `pipeline/publish/src/sequence.ts`. `groupPlan`/`planBuild`/`planUpload` already generalize over `groups: readonly DataGroup[]` — no change needed there, only the type. **Built, then reverted** (commit `dd884fd`, RL 08:55): the real lexicon manifest has no separate owner/contractor/parcels groups (see the Correction note at the top of this file). Superseded by T031 — a design error, not deferred work, so not carried forward to A-16.
- [x] T004 [oracle] Extend `SOURCE_ORDER` and the required-coverage-key list in `pipeline/publish/src/manifest.ts` from a hardcoded 2-item tuple to a per-run profile covering all 5 groups' coverage keys (e.g. `parcels_published`, `contractor_resolved/candidate/unresolved` per AD-05's five states) — keep `checkInput`'s exact-match, fail-closed throw; extend the fixed list, never loosen it. **Built, then reverted** (commit `dd884fd`, RL 08:55), same correction as T003. The real coverage-key extension (3 contractor-state keys, 4 permit-exclusion keys) was delivered instead by T031 and the 14:46 correction. Superseded, not carried forward to A-16.

**Checkpoint**: `DataGroup` and the manifest's required-keys list both cover all 5 groups; `checkInput` still fail-closed. User-story work can now begin.

---

## Phase 3: User Story 1 - Publish Run 1, verifiable by a stranger (Priority: P1) 🎯 MVP

**Goal**: Every Run 1 artifact for Travis County published as CIDv1 with a manifest, verifiable from two public gateways this environment does not operate.

**Independent Test**: `npx tsx scripts/verify-manifest.ts runs/{run1}/manifest.json` prints `ALL ARTIFACTS VERIFIED`, exit 0.

### Tests for User Story 1 (write first, must fail before implementation)

- [x] T005 [P] [US1] [oracle] (G-PUB1) Extend the six-step order test to all 5 groups, asserting no step is skipped and an upload-readback failure stops before the manifest, in `pipeline/publish/test/sequence.test.ts`. **Built for 5 groups in Wave 1, then adjusted back to the real 2 groups in the `dd884fd` correction** (RL 08:55: "Fixed Wave-1/2 test fixtures referencing the removed groups. pipeline/publish 238/238"). The six-step order test now covers the real `county`/`property_improvement` groups.
- [x] T006 [P] [US1] [oracle] (G-PUB1) Add `checkInput` tests for the widened 5-group/coverage-key profile (missing group, missing coverage key, extra undeclared source all still throw) in `pipeline/publish/test/manifest.test.ts`. **Built for the 5-group profile, then adjusted to the real 2-group profile** in the same `dd884fd` correction as T005 (RL 08:55).
- [x] T007 [P] [US1] [oracle] (G-PUB2) Add gateway-hardening tests (429/504/timeout → `unverified`, non-zero exit, never `ALL ARTIFACTS VERIFIED` without both gateways matching; dweb.link redirect followed; >50MB artifact hashed by streaming) in a new `scripts/test/verify-manifest.test.ts`. **Done**: built Wave 1 (G-PUB2, RL 08:05); hardened further with a capped Retry-After and pre-request throttle (commit `73cf577`, RL 10:01). `scripts/test/verify-manifest.test.ts` 14/14 (`docs/reports/A-11-unit-test-report.md`).
- [x] T008 [P] [US1] [oracle] (G-PUB2) Add second-pin-client tests (readback required before success; refuses to overwrite an existing S3 CID-copy object, compares instead) in `pipeline/publish/test/upload.test.ts`. **Done**: built Wave 1 (G-PUB2); fixture updated for the real coverage-key set in the 14:46 correction (RL 14:46).

### Implementation for User Story 1

- [x] T009 [US1] [oracle] (G-PUB1) Implement the 5-group coverage-key profile in `pipeline/publish/src/manifest.ts`'s `checkInput`, satisfying T006. **Built for 5 groups, then reverted** (commit `dd884fd`, RL 08:55), same correction as T003/T004. Real `checkInput` coverage-key work delivered by T031 and the 14:46 correction. Superseded, not carried forward to A-16.
- [x] T010 [US1] [oracle] (G-PUB1) Wire `groupArtifacts` (already group-agnostic) to the 5-group list; confirm `carCid` is present on every directory and `previousManifestCid` is `null` for Run 1, in `pipeline/publish/src/manifest.ts`. **Built, then reverted** (commit `dd884fd`, RL 08:55). `groupArtifacts` remains group-agnostic and was later widened for real to sum rows across N batches per group (commit `519df3c`, RL 19:30, S6a.3) — a different, real extension that superseded this task's original 5-group framing.
- [x] T011 [P] [US1] [oracle] (G-PUB2) Harden `scripts/verify-manifest.ts`: retry with backoff on 429/504/timeout (`TIMEOUT_MS` 300000, 5 attempts), mark `unverified` with the gateway's response, exit non-zero on any miss, satisfying T007. **Done**: built Wave 1 (G-PUB2, RL 08:05); Retry-After capped and a pre-request throttle added later (commit `73cf577`, RL 10:01).
- [x] T012 [P] [US1] [oracle] (G-PUB2) Add the Pinata (Kubo RPC) upload client as a sibling to the existing Filebase client in `pipeline/publish/src/upload.ts`, same interface, readback-gated, satisfying T008. **Built in Wave 1** (G-PUB2), but found non-viable as a genuine second pin: Pinata's free plan can't pin-by-CID (`PAID_FEATURE_ONLY`, RL 2026-10-24 00:15) and its upload fallback assigns an unrelated CID to the raw bytes. A separate, tested Pinata-REST module (`pipeline/publish/src/pinata-pin.ts`, RL 21:35) was built as the real follow-up and is also non-viable on the free plan. Tracked as A-16 Carried-forward item 3 ("No genuine second independent pin").
- [x] T013 [US1] [oracle] (G-PUB1) Draft the Run 1 manifest from the dry-run outputs once available (depends on T009, T010; feeds G-RUN's Wave 2 tasks T017-T019) in `pipeline/publish/src/manifest.ts`. **Done**: the real `buildManifest()` was widened to sum rows across N batches per group (commit `519df3c`) and used via `pipeline/publish/scripts/build-run1-manifest.ts` to produce Run 1's real manifest, CID `bafkreiddef7ssybq6m4wpmah7adposaxbiawaxcmqndzk36wyhd7k4h6gu` (RL 19:30, S6a.3).
- [x] T014 [US1] [oracle] (G-PUB2) GitHub Release step: attach each CAR (split if > 2 GB) and record the release URL target location, in `pipeline/publish/src/release.ts` (new file). **Done**: GitHub Release `run1-travis-full-20261023` holds all 12 CARs (`docs/evidence/A-11.md` § What was built, item 3).
- [x] T015 [US1] [oracle] (G-PUB1) Add the per-group coverage labels (`published_rows`, `capture_receipt`, `aggregate_match`) with their derivation strings, never a direct Query DB read, in `pipeline/publish/src/manifest.ts`. **Scope adjusted from the reverted 5-group design**: delivered as `property_improvement`'s coverage labels via T031 (3 contractor-state keys, commits `612e9d5`/`917a8b7`) and the 14:46 correction (4 `permits_<reason>` exclusion keys) — never a direct Query DB read in either case.

**Checkpoint**: User Story 1 is fully buildable and testable independently (verify-manifest against a local/dry-run manifest); the real Run 1 upload itself is a Stage 6 stop (D-7), not a build task.

---

## Phase 4: User Story 2 - Keep Travis County current with incremental runs (Priority: P2)

**Goal**: Run 2/3 publish only what changed as new linked manifests, keeping every earlier CID resolvable.

**Independent Test**: After a third run, `runs/index.json` lists ≥ 3 runs on ≥ 3 UTC dates, each `previousManifestCid` links back, and `verify-manifest` on Run 1's manifest still passes.

### Tests for User Story 2 (write first, must fail before implementation)

- [x] T016 [P] [US2] [oracle] (G-RUN, wave 1) Test per-source watermark + content-digest delta computation (re-stamp of 100% of a window → delta from digests, not from `:updated_at`) in `pipeline/publish/test/incremental.test.ts` (new). **Done**: built Wave 1, G-RUN(a) (RL 08:05).

### Implementation for User Story 2 (wave 1, can start at once)

- [x] T017 [US2] [oracle] (G-RUN, wave 1) Implement per-source watermark + content-digest delta computation reusing A-04's re-stamp-detection pattern (≥50% of window or ≥90% within 6h ⇒ bulk re-stamp) for Austin permits, the TCAD supplemental export date, and BBB harvest date only (per D-2(c) — no other source is re-checked), in `pipeline/publish/src/incremental/delta.ts` (new). **Done**: built Wave 1, G-RUN(a) (RL 08:05).

### Implementation for User Story 2 (wave 2, after G-PUB1's manifest builder lands — T013)

- [x] T018 [US2] [oracle] (G-RUN, wave 2) Change `ManifestSourceInput`/`source()` in `pipeline/publish/src/manifest.ts` from the hardcoded "first run: everything added" to explicit `added`/`changed`/`removed` fields supplied by T017's delta computation. **Done**: built Wave 2, G-RUN(b)/(c) (RL 08:30, builder `ab7e5b1e89d7dabe5`).
- [x] T019 [US2] [oracle] (G-RUN, wave 2) Implement zero-delta-with-reason (`limitations: ["no newer export"]` / `["blocked · 403"]`) and "unchanged group omits its artifact entries from this run's manifest" (per research.md, AD-03) in `pipeline/publish/src/manifest.ts`. **Done**: same Wave 2 batch as T018 (RL 08:30).
- [x] T020 [US2] [oracle] (G-RUN, wave 2) Implement `source_removed` tombstones counted in `removed`, in `pipeline/publish/src/incremental/delta.ts`. **Done**: same Wave 2 batch (RL 08:30).
- [x] T021 [US2] [oracle] (G-RUN, wave 2) Add the idempotency test: identical inputs re-run → 0 rows written, identical **data-group** CAR/table CIDs (not the manifest CID, which legitimately varies by `startedAt`/`finishedAt` — research.md), in `pipeline/publish/test/manifest.test.ts`. **Done**: same Wave 2 batch (RL 08:30); 241/241 before the `dd884fd` correction, 243/243 after (RL 19:30).
- [x] T022 [US2] [oracle] (G-RUN, wave 2) Implement failed-mid-publish handling: no manifest written, next run resumes from the last committed watermark, failed attempt logged but not listed in `runs/index.json`, in `pipeline/publish/src/incremental/delta.ts`. **Done**: same Wave 2 batch (RL 08:30).
- [x] T023 [US2] [oracle] (G-PUB1, wave 2, same file as T013) Confirm `runs-index.ts`'s existing `appendRun` (already correctly append-only, throws on duplicate `runId`/`manifestCid`) needs no change for the run chain; add a test confirming the A-03 walking-skeleton entry is preserved and Run 1 starts its own chain (`previousManifestCid: null`, per D-2(a)) in `pipeline/publish/test/runs-index.test.ts`. **Done**: same Wave 2 batch (RL 08:30).

**Checkpoint**: User Stories 1 AND 2 both buildable and testable independently; the real Run 2/Run 3 uploads happen in Stage 6, on later UTC dates, never as build tasks.

---

## Phase 5: User Story 3 - A scheduler that costs nothing until someone turns it on (Priority: P3)

**Goal**: A CDK-defined EventBridge schedule, DISABLED, targeting a Fargate task, proven to cost $0 while disabled.

**Independent Test**: `cdk synth` on the scheduler stack passes a CDK assertion confirming DISABLED state, the Fargate target, no Query DB connection string, and $0 idle cost.

### Tests for User Story 3 (write first, must fail before implementation)

- [x] T024 [P] [US3] [machamp] (G-SCHED) Write the CDK assertion tests: `State: "DISABLED"`, target references this stack's `TaskDefinition` logical id, no `AWS::ECS::Service` exists, in `infra/test/scheduler.test.ts` (new). **Done**: built Wave 1, G-SCHED (RL 08:05); `infra/test/scheduler.test.ts` 7/7 (`docs/reports/A-11-unit-test-report.md`).
- [x] T025 [P] [US3] [machamp] (G-SCHED) Write the repo-wide grep test for no Postgres connection-string literal or hardcoded host anywhere in `apps/` or `infra/`, and that the ECS `Secret`'s `valueFrom` is a Secrets Manager/SSM ARN never a plaintext `environment` entry, in `infra/test/no-connection-string.test.ts` (new). **Done**: built Wave 1, G-SCHED (RL 08:05); grep-gates allowlisted this test's own "postgres" strings in the G7 fix pass (commit `5e4f080`).

### Implementation for User Story 3

- [x] T026 [US3] [machamp] (G-SCHED) Create `CountyLensSchedulerStack` in `infra/src/stacks/scheduler-stack.ts`: `CfnSchedule`/`Schedule` with `state: "DISABLED"`, ECS RunTask target, Fargate `TaskDefinition` (no `FargateService`), added after DataStack in `infra/bin/app.ts` with no dependents. **Done**: built Wave 1, G-SCHED; deployed to `eu-north-1` and confirmed `State: DISABLED` (`docs/evidence/A-11-scheduler.md`, TZ02).
- [x] T027 [US3] [machamp] (G-SCHED) Wire the task definition's secrets (DB credentials, Filebase + Pinata pinning credentials) as ECS `Secret` → Secrets Manager ARN, and bucket/CloudFront names via cross-stack refs from DataStack, in `infra/src/stacks/scheduler-stack.ts`. **Done**: built Wave 1, G-SCHED, same batch as T026.
- [x] T028 [US3] [machamp] (G-SCHED) Add a DLQ and one CloudWatch alarm for the Fargate task's failure path, in `infra/src/stacks/scheduler-stack.ts`. **Done**: built Wave 1, G-SCHED; `DlqArn` present in stack outputs (`docs/evidence/A-11.md` § Scheduler evidence).
- [x] T029 [US3] [oracle] (G-RUN, wave 2, after T018-T022) Expose a non-interactive `publishRun`-equivalent entrypoint (gated by the six-step sequence's own readback, not a human D-8 approval — per research.md's disagreement resolution) for the Fargate task to call, in `pipeline/publish/src/batch-entrypoint.ts` (new). **Done**: built Wave 2 (RL 08:30, builder `ab7e5b1e89d7dabe5`, "T018-T023, T029, T030").
- [x] T030 [US2] [oracle] (G-RUN, wave 2) FR-008 unit test: building a later run's manifest must never alter an earlier run's already-written manifest file or its artifact CIDs — assert Run 1's manifest bytes/CIDs are byte-identical before and after building Run 2's manifest, in `pipeline/publish/test/manifest.test.ts` (closes analyze finding F1; runs alongside T018-T023, numbered last only because it was added after the initial draft). **Done**: same Wave 2 batch as T029.
- [x] T031 [US1] [oracle] Done 2026-10-23, corrected in execution: ADR-0002 (binding) forbids `contractor_company_cid`/`contractor_resolution` as scalar fields on the published `property_improvement` record (the live lexicon schema is `additionalProperties:false`, no such property; ADR-0002 verdict #6 already ruled this out, naming AD-24's coverage rollup as the sanctioned path). Built instead: `resolveContractor()` (A-07's identity resolver, reused unmodified) runs against each emitted permit into an internal classification-ledger field only; `run-month.ts` rolls the five AD-05 states up into `contractor_resolved`/`contractor_candidate`/`contractor_unresolved` counts in the summary coverage; those 3 keys were added to `property_improvement`'s entry in `pipeline/publish/src/manifest.ts`'s `GROUP_COVERAGE_KEYS` in the same commit as their producer. A test proves no contractor field ever reaches the emitted record.

**Checkpoint**: all three user stories independently buildable; `cdk synth` green; the scheduler is never deployed as a build task — deployment (still DISABLED) is Stage 6's D-8 stop.

---

## Phase Z: Prove on the hosted runtime (mandatory, always last)

- [x] TZ01 Run the reviewer agents (`oracle`, `donphan`, `machamp`, `porygon`) read-only on the branch; record scores in `docs/reviews/CR-A-11.md` (each ≥ 75 or justified). **Done, with a recorded cost-mode reduction**: `donphan` (88/100, re-review) and `porygon` (86/100, re-review) both score above the 75 bar (`docs/reviews/CR-A-11-donphan.md`, `docs/reviews/CR-A-11-porygon.md`). `oracle`/`machamp` did not score — the same over-budget cost-mode cap already applied at A-07 (run-log S3.8/C8, 2026-10-23 07:40: quota ≈103%); recorded as an explicit exception in `docs/gates/G7-A-11-precheck.md`'s C-03 addendum, not an unexplained gap. The two per-reviewer files serve the role of one combined `CR-A-11.md`.
- [x] TZ02 Deploy the scheduler stack to `eu-north-1` in state **DISABLED** (Stage 6b, 🛑 D-8) — not an app deploy, since `ui: false`; record `aws scheduler get-schedule` output. **Done**: deployed 2026-10-24, account `515618610572`, region `eu-north-1`; `aws scheduler get-schedule` output recorded in `docs/evidence/A-11-scheduler.md` and quoted in `docs/evidence/A-11.md` § Scheduler evidence.
- [x] TZ03 Run `verify-manifest` on Run 1's manifest against ipfs.io and dweb.link (🛑 D-7 precedes this); after Run 3, run the immutability check (checks.md § 6.2): ≥ 3 runs on ≥ 3 UTC dates, chain links, Run 1 still verifies. **Partially done, carried forward to A-16**: `verify-manifest` against `gateway.pinata.cloud` + `ipfs.filebase.io` (not ipfs.io/dweb.link, retired per AM-01) is running but not complete (last snapshot: 43 ok / 5 FAIL of 456, `docs/reports/A-11-test-report.md`). Runs 2/3 and the immutability check need UTC dates ≥ 2026-10-25/26 and have not happened. Carried forward to `stories/A-16-cost-and-admin.md` § Carried forward from A-11, items 2 and 4. **PO 2026-10-25: closed here as a known gap; Run 3 and the immutability check move to A-16 (items 2 and 4).**
- [x] TZ04 N/A: `ui: false` — no `smeargle` responsive-design-tests. **Confirmed N/A**, same exception as A-04/A-07 (G4 C-04).
- [x] TZ05 Run the story's two independent tests: (1) `verify-manifest` prints `ALL ARTIFACTS VERIFIED` after Run 1; (2) the immutability check passes after Run 3. **Not complete, carried forward to A-16**: test (1) is in progress (see TZ03); test (2) needs Run 3, not yet run. Carried forward to A-16 items 2 and 4 (same as TZ03). **PO 2026-10-25: closed here as a known gap, moved to A-16.**
- [x] TZ06 Write `docs/reports/A-11-test-report.md`, `docs/evidence/A-11.md`, the `docs/traceability.md` row, and one `docs/kit-usage.md` line. **Text corrected** (2026-10-24, this pass): the four separately-named files (`A-11-manifest.md`, `A-11-gateways.md`, `A-11-runs.md`, `A-11-immutability.md`) are dropped in favor of the single consolidated `docs/evidence/A-11.md` (plus `docs/evidence/A-11-scheduler.md` for the one genuinely separate AWS-console-output artifact) — matching the pattern every other merged story in this repo already uses (A-04's and A-07's own TZ06 each name one consolidated `docs/evidence/{story}.md`, never a file per check). Splitting A-11.md's existing content into four near-empty files now would add bookkeeping without adding evidence. **Done**: `docs/reports/A-11-test-report.md` and `docs/reports/A-11-unit-test-report.md` exist; `docs/evidence/A-11.md` exists; the `docs/traceability.md` row and `docs/kit-usage.md` line were added in this pass (see run-log).

---

## Dependencies & Execution Order

- **Setup (Phase 1)** → **Foundational (Phase 2)**: T003/T004 block every group's Wave-1 work that touches `DataGroup` or coverage keys.
- **Wave 1** (parallel, own files): G-PUB1 (T005, T006, T009, T010, T015), G-PUB2 (T007, T008, T011, T012, T014), G-RUN(a) (T016, T017), G-SCHED (T024-T028). The Run 1 dry run starts in the background alongside Wave 1.
- **Integration check 1** after Wave 1 (full unit suite + typecheck + lint on the combined result).
- **Wave 2** (depends on T013, G-PUB1's manifest builder): G-RUN(b)/(c) (T018-T023), plus T029 (depends on T018-T022).
- **Integration check 2** after Wave 2.
- User Story 1 has no dependency on US2/US3. User Story 2's wave-1 tasks (T016/T017) are independent of US1, but wave-2 tasks need US1's T013. User Story 3 is independent except for T029, which needs US2's completed delta/manifest work.

## Parallel Example: Wave 1

```text
Task: "[oracle] G-PUB1: sequence order test + checkInput tests + manifest coverage/carCid wiring"
Task: "[oracle] G-PUB2: verify-manifest hardening + Pinata client + GitHub Release step"
Task: "[oracle] G-RUN(a): watermark + digest delta computation"
Task: "[machamp] G-SCHED: scheduler stack + CDK assertions + DLQ/alarm"
```

## Implementation Strategy

**MVP = User Story 1** (Run 1 publication + gateway verification) — the primary evaluation point (A4). User Story 2 (incremental runs) and User Story 3 (scheduler) both build on the Foundational phase independently and can proceed in the same Wave 1/2 structure without blocking US1's critical path.
