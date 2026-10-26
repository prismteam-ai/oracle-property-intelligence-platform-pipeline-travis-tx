# Implementation Plan: Publish the full county by CID and keep it current with incremental runs

**Branch**: `011-publish-and-runs` | **Date**: 2026-10-23 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/011-publish-and-runs/spec.md`

> **Correction (2026-10-23, during Stage 5):** this plan was written for a 5-group design
> (`county`, `property_improvement`, `owner`, `contractor`, `parcels`). That was wrong — the real
> lexicon manifest only defines `county` and `property_improvement`; see `research.md`'s
> "Correction" section. The Technical Context, Kit Agent Ownership and Project Structure sections
> below still describe the 5-group version in places; the actual, corrected scope is 2 groups
> plus wiring A-07's contractor identity into `property_improvement`'s permit records.

## Summary

Extend A-03's 2-group, pilot-scale publication pipeline to the full 5-group Travis County dataset, verify it independently on two public gateways, keep three durable copies (Filebase, Pinata, GitHub Release), then run two later incremental refreshes that publish only what changed as new linked manifests — plus a CDK-defined, disabled-by-default scheduler so this can run unattended in the future. No new product surface; this is a batch/publication story (`ui: false`).

## Technical Context

**Language/Version**: TypeScript (publish code, incremental runner, CDK) — no Python, per CLAUDE.md.

**Primary Dependencies**: `elephant-cli` (pinned commit `44bb182`, never Homebrew), `packages/contract` (`RunManifestV1`, `RunsIndexV1`), AWS CDK v2 (`aws-scheduler`, `aws-ecs`), Filebase + Pinata Kubo-RPC clients.

**Storage**: Local Restate + Postgres (Runs 1-3, interactive path, AD-17); an operator-chosen private Postgres (scheduler's Fargate path, AD-26 — never the Query DB). Published output is CID-addressed CARs/tables, never a database.

**Testing**: Vitest (unit + CDK assertions via `aws-cdk-lib/assertions`), `scripts/verify-manifest.ts` against real public gateways (not mocked), `cdk synth` for the scheduler stack.

**Target Platform**: Public IPFS network (ipfs.io, dweb.link as verify targets; Filebase + Pinata as pins) + AWS `eu-north-1` (scheduler infra only; never enabled in this story).

**Project Type**: Batch/publication pipeline + CLI + infra (CDK) — no frontend (`ui: false`).

**Performance Goals**: Austin paging ≤ 50,000 rows/page with backoff on 429/5xx (measured 120,043 rows/min on 2026-10-19, re-measured at run time); source pulls never exceed polite rate (≤ 1 req/3s for BBB, etc.).

**Constraints**: No step of the 6-step sequence is ever skipped (P0-2); published CIDs never change (P0-3); Query DB never published or reachable from AWS (P0-1); no IPNS field anywhere (AD-03); scheduler $0 while disabled (NFR-003); region from config, never hard-coded, locked to `eu-north-1`.

**Scale/Scope (corrected 2026-10-23, CR-A-11-porygon finding 1):** the 2.95-3.73 GB / 2,381,226-row figure above was computed for the stale 5-group design and, separately, conflated `property_improvement`'s linked-permit-rows-read count with its published row count — both wrong. The actual 2-group scope, measured directly from Run 1's dry-run CARs: `county` is R-only (441,961 of the 493,246-parcel roll; P/MH/MN out of scope, unchanged since A-04) — 10 batched CARs totalling ≈2.25 GB. `property_improvement`'s published scope is roofing-classified, decided-status permits only (PO decision, 2026-10-23; NOT all 2,007,514 linked permits) — 17,387 rows, 2 batched CARs totalling ≈31 MB. Table-export CARs are KB-scale and negligible. **Realistic total ≈2.3 GB**, not 2.95-3.73 GB. ≥ 3 runs on ≥ 3 distinct UTC dates.

## Kit Agent Ownership *(mandatory, constitution XIII–XVII)*

| Role | Agent(s) | Skills loaded | What it decided (cite agent-design.md) |
|------|----------|---------------|----------------------------------------|
| Design consult | `oracle`, `machamp` | `use-oracle`, `build-batch-workflows`, `durable-workflow-builder`, `monitoring-oracle-ingestion`, `unify-metrics` + `apply-engineering-guidelines` | oracle: widen `DataGroup` to 5 groups, extend `checkInput` fail-closed, reuse A-04's digest/re-stamp logic for deltas, omit unchanged groups from the manifest, second pin = Pinata, Filebase sizing = measure-first. machamp: new `CountyLensSchedulerStack`, EventBridge `CfnSchedule` (DISABLED) → Fargate `RunTask` (no `FargateService`), secrets via ECS `Secret`→Secrets Manager, CDK assertions for AC-12. |
| Builder | `oracle` (publication, runner), `machamp` (scheduler) | same + `apply-engineering-guidelines` | Patterns below (Project Structure) |
| Reviewer(s) | `oracle`, `donphan`, `machamp`, `porygon` | — | donphan: published-data view matches manifest/coverage; porygon: counts agree (deltas vs source counts, coverage vs runs/index.json vs published tables); oracle/machamp: their own area at the 75+ threshold |
| Verify | `verify-manifest` on 2 gateways (Run 1); immutability check across Runs 1-3 | — | `npx tsx scripts/verify-manifest.ts` against ipfs.io + dweb.link; checks.md § 6.2 after Run 3 |

**Patterns the code must show** (from the builders' answers, each mapped to a file):
- Six-step order test, no step skipped → `pipeline/publish/test/sequence.test.ts` (extends A-03's existing order test)
- `DataGroup` widened to 5 groups, `SOURCE_ORDER`/coverage keys as a per-run profile, `checkInput` still fail-closed → `pipeline/publish/src/manifest.ts`, `src/sequence.ts`
- `ManifestSourceInput`/`source()` taking explicit `added`/`changed`/`removed` from digest comparison, not hardcoded "all new" → `pipeline/publish/src/manifest.ts`
- Unchanged group omitted from the new manifest (not repeated) → `pipeline/publish/src/manifest.ts`
- Second-pin client (Pinata, Kubo RPC) alongside the existing Filebase client → `pipeline/publish/src/upload.ts` (new sibling client, same interface)
- Non-interactive `publishRun`-equivalent entrypoint, gated by the sequence's own readback (not a human D-8 step) → `pipeline/publish/src/index.ts` (new export) or a new `src/batch-entrypoint.ts`
- `EventBridge Schedule` `state: DISABLED` → Fargate `TaskDefinition` (no `FargateService`), CDK assertions for AC-12 → new `infra/src/stacks/scheduler-stack.ts`, `infra/test/scheduler.test.ts`

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design. Mark each ✅ / ❌ / N/A; every ❌ needs a row in Complexity Tracking.*

| # | Article | Check for this plan | Status |
|---|---------|---------------------|--------|
| I | Outcome first | Proof is public: two IPFS gateways (not this environment), `aws scheduler get-schedule` showing `DISABLED`, manifests/release URLs in the PR — recorded exception per the walkthrough's own gate-exception table since `ui: false` | ✅ (exception recorded) |
| II–IV | Stack | TypeScript throughout; CDK with region read from `CDK_DEFAULT_REGION` (never hard-coded); existing Turborepo layout (`pipeline/publish`, `infra`); one upload client interface shared by Filebase and Pinata | ✅ |
| V–VI | Contracts and LLM | `RunManifestV1`/`RunsIndexV1` (Zod-validated) on every manifest write; no LLM calls in this story | ✅ / N/A |
| VII–IX | Operations | Scheduler target has a DLQ + one alarm (machamp's design); no Powertools/X-Ray applicable — no Lambda runs in this story, the scheduler never fires; documented as the G7 C-04/C-07 exception | ✅ (exception recorded) |
| X | Quality gates | Vitest (unit + CDK assertions) + `verify-manifest` against real gateways + lint/tsc in CI; no Playwright (G6 C-05/C-09 exception, `ui: false`) | ✅ (exception recorded) |
| XI | Data honesty | Coverage section labels every count's derivation; zero-delta sources carry a stated reason (`limitations[]`), never silently omitted | ✅ |
| XII | Secrets | Filebase + Pinata keys in `~/.config/assessment/*.env` (chmod 600, never git/logs); scheduler secrets via Secrets Manager ARN only | ✅ |
| XIII–XV | Owner agents | Kit Agent Ownership filled above; `agent-design.md` exists with a Disagreements table; builder patterns listed above | ✅ |
| XVI | Owner review | `oracle`, `donphan`, `machamp`, `porygon` all score the branch, 75+ threshold (C6: one Sonnet reviewer per area, ≤2, plus `/code-review low`) | ✅ (planned, Stage 5) |
| XVIII–XXIII | Delivery | G4 passed (Stage 1); G5/G6 planned this stage; branch `011-publish-and-runs`; tests-first task ordering (Stage 3 step 5); defects recorded as `docs/reviews/CR-A-11.md` | ✅ (in progress) |
| Addendum | Task A (A1–A8) | P0-1 (Query DB never published/reachable from AWS), P0-2 (no step skipped), P0-3 (CIDs never change), P0-7 (stop on BBB 403), P0-10 (local vs Fargate modes never mixed), P0-14 (verify only via ipfs.io/dweb.link, never Filebase/Pinata/S3), P0-19 (no always-on resource while disabled) — each satisfied by the designs above; AD-01/AD-02/AD-03/AD-04/AD-15/AD-17/AD-22/AD-23/AD-26/AD-28 all addressed in `agent-design.md` and `research.md` | ✅ |

No ❌ rows — Complexity Tracking is empty.

**G5 approved 2026-10-23** (`docs/gates/G5-A-11-precheck.md`, PASS, 0 real gaps).

## Project Structure

### Documentation (this feature)

```text
specs/011-publish-and-runs/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md         # Phase 1 output
├── quickstart.md         # Phase 1 output
├── contracts/
│   └── publish-sequence.md
├── agent-design.md       # Stage 3 design consult (oracle, machamp)
├── run-log.md
└── tasks.md              # Phase 2 output (/speckit-tasks)
```

### Source Code (repository root)

```text
pipeline/publish/
├── src/
│   ├── sequence.ts        # DataGroup widened to 5 groups; groupPlan/planBuild/planUpload unchanged (already group-agnostic)
│   ├── manifest.ts        # checkInput extended fail-closed to 5-group coverage keys + full source list;
│   │                      # ManifestSourceInput/source() takes explicit added/changed/removed;
│   │                      # unchanged groups omitted from a run's manifest
│   ├── upload.ts          # existing Filebase client + new Pinata (Kubo RPC) sibling client
│   ├── runs-index.ts       # unchanged (already correctly append-only)
│   ├── index.ts / batch-entrypoint.ts  # new non-interactive publishRun-equivalent for the Fargate path
│   └── incremental/        # new: per-source watermark + digest delta (Austin, TCAD supplemental, BBB only — D-2(c))
└── test/
    ├── sequence.test.ts    # order test extended to 5 groups
    ├── manifest.test.ts    # checkInput + delta + idempotency (data-group CIDs, not manifest CID — research.md)
    └── incremental.test.ts

scripts/
└── verify-manifest.ts     # already hardened for Pinata/dweb.link-equivalent gateways in A-03; re-verify at full-county scale

infra/
├── src/stacks/scheduler-stack.ts   # new: CfnSchedule (DISABLED) + Fargate TaskDefinition, no FargateService
└── test/scheduler.test.ts          # new: DISABLED state, target, no Query DB connection string, no always-on resource
```

**Structure Decision**: extend existing `pipeline/publish/` and `infra/` trees in place (no new top-level project) — this story scales and hardens A-03's code and adds one new infra stack; it does not introduce a new app or service boundary.

## Complexity Tracking

*Empty — no Constitution Check violations.*
