# Implementation Plan: Enrich and reconcile: contractor identity, BBB ratings, business and places data, duplicate merge and roof age

**Branch**: `007-enrich-reconcile` | **Date**: 2026-10-22 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/007-enrich-reconcile/spec.md`

## Summary

A-07 is a merged, pipeline-only story (`ui: false`) with four tracks sharing one Query DB and one manifest. **Track A** loads the Texas Comptroller's Travis franchise-tax registry (`9cir-efmm`) once and resolves every Austin reroof permit's printed contractor name against it into a five-state ledger (`resolved`/`candidate`/`ambiguous`/`conflicting`/`unresolved`) — with `resolved` expected at 0 because no official identifier crosswalk exists between Austin's permit data and the Comptroller (confirmed negative finding, D-10). **Track B** builds and tests a bounded BBB request wrapper (≤7 requests) against a local stub only — per D-2, no new request reaches bbb.org this run; every would-be `resolved` company is `blocked`, citing the two existing A-01 403 receipts. **Track C** (business records, Must; places, Could) builds only if tracks A and D merge before 2026-10-23 12:00 EEST — otherwise it is a documented gap like Track B. **Track D** merges duplicate property/owner/contractor records keyed on the TCAD id and runs the kit's roof-age estimator (dry-run → 25-audit → apply → re-run proving `rowsWritten: 0`), with the view derivation in `packages/query-core` cross-checked against the estimator for the 25 audited properties.

Technical approach: all four tracks are new TypeScript modules under `pipeline/oracle-runtime/travis/` (pure logic, SDK/network-typed, tested offline) plus thin Restate bindings and one Loader track in `pipeline/local-stack/services/` (the only code holding a Postgres client). One Query DB writer per wave. No new Python. BBB tests run against a local stub server; nothing is uploaded or published in this story (A-11 publishes).

## Technical Context

**Language/Version**: TypeScript (Node ≥ 22.18), matching A-01–A-04

**Primary Dependencies**: `@restatedev/restate-sdk` (workflow), `postgres` (Loader only), `duckdb` CLI (Overture clip), the vendored kit (`bbb-harvest`, `roof-age/estimator.ts`), `elephant-cli` (`~/.local/share/elephant-cli-main`, commit `44bb182`) for local validate/hash/export-tables — never uploaded this story

**Storage**: Postgres (Query DB, local stack only); roof-age/audit/apply reports and local CAR exports under `pipeline/data/` (gitignored); no AWS resource touched (A-07 deploys nothing)

**Testing**: Vitest (`pipeline/oracle-runtime`, `packages/query-core`), a local BBB stub server (own port per test file), labelled fixtures for the AC-2 crosswalk negative case

**Target Platform**: Local stack only (Restate + Postgres); no hosted deploy for this story

**Project Type**: Pipeline (data ingestion/reconciliation), part of the existing Turborepo monorepo — not a web-service or UI story

**Performance Goals**: BBB wrapper ≤ 7 requests at ≤ 1/3s, concurrency 1 (AC-6); Comptroller load and resolution run at A-01's measured polite rate; no new performance target beyond existing NFRs

**Constraints**: Zero requests to bbb.org under D-2; one Query DB writer per wave; TCAD id is the only merge key (P0-5); roof-age never computed outside the kit estimator; `--apply` and any upload gated behind an explicit stop

**Scale/Scope**: 342,334 Travis Comptroller records (one load); 22,084 Austin reroof candidates resolved; full TCAD roll (N from A-04) for roof-age; 25-property audit sample; at most 7 BBB requests (stub only)

## Kit Agent Ownership *(mandatory, constitution XIII–XVII)*

Copied from `stories/A-07-enrich-reconcile.md` front matter and `specs/007-enrich-reconcile/agent-design.md`.

| Role | Agent(s) | Skills loaded | What it decided (cite agent-design.md) |
|------|----------|---------------|----------------------------------------|
| Design consult | `oracle`, `mew` | `query-db-loading-matching`, `bbb-harvest`, `overture-places-ingest`, `use-oracle`, `unify-metrics` (oracle); neutral-lexicon references + live schema tools (mew) | oracle: crosswalk verdict (no official ID crosswalk on Austin permits → AC-2 fixture-only), per-track component/file layout, wave ordering, the 7-request BBB bound enforcement pattern, roof-age estimator command shape. mew: taxpayer number has no dedicated carrier (fallback `request_identifier`+`source_http_request`), no BBB rating carrier, business record = `company` class under County group, no classed places carrier (CLI export proven elsewhere), A-02's "no carrier" verdict for printed name/per-permit state reconfirmed |
| Builder | `oracle` | `query-db-loading-matching` (A, D), `bbb-harvest` (B), `overture-places-ingest` (C), `use-oracle`, `unify-metrics` (D), `use-neutral-lexicon` (A, per the story's skills list — loaded via A-1, the neutral-lexicon references `mew` used) + `apply-engineering-guidelines` | One `oracle` subagent per track (4 total), each owning its own files; resumed across waves via SendMessage instead of restarted, so the repo is read once per track |
| Reviewer(s) | `oracle`, `donphan`, `porygon` | — (read-only review, no skills loaded for review itself) | `oracle` scores pattern/contract/guardrail fit per track; `donphan` recomputes the five-state sum, BBB per-status counts/coverage%, and spot-checks 5 `candidate` rows; `porygon` (with `unify-metrics`) checks every count adds up (basis totals = N, merge canonical ≤ inputRecords, five states = permit total, business count = source count, every count carries a `derivation` label) |
| Verify | per story front matter | — | Five-state contractor counts (AD-05); BBB coverage % and 403 evidence; business and places counts + licence recorded; roof-age worked example with full lineage |

**Patterns the code must show** (from oracle's agent-design.md answer):

- Single Comptroller load, one adapter, shared by tracks A and C — `pipeline/oracle-runtime/travis/adapters/socrata/tx-comptroller.ts`
- Immutable, versioned resolver ledger (append-only, `resolverVersion` + `registrySnapshotDigest` per row) — `pipeline/oracle-runtime/travis/identity/resolver.ts`
- `contractor_not_printed` / `registry_unavailable` short-circuit before any name match — `pipeline/oracle-runtime/travis/identity/resolver.ts`
- Hard 7-request cap + 3s pacing + concurrency 1 in the BBB wrapper itself, never in the caller — `pipeline/oracle-runtime/travis/bbb/wrapper.ts`
- `BBB_TARGET=stub` config gate, asserted by a unit test and a CI grep-fail on `bbb.org` outside stub/evidence files — `pipeline/oracle-runtime/travis/bbb/config.ts`
- Polygon clip as bbox prefilter (`ST_Intersects`) then exact `ST_Within`, never bbox alone — `pipeline/oracle-runtime/travis/places/clip.ts`
- `expected_count = NULL` (never 0) when the Overture release states no estimate — `pipeline/oracle-runtime/travis/places/overture.ts`
- TCAD id as the only merge key; a lint-level test asserting no merge function accepts two TCAD ids — `pipeline/oracle-runtime/travis/reconcile/merge.ts`
- Contractor clusters merged only where ledger state = `resolved` (0 merges is a correct outcome, not a bug) — `pipeline/oracle-runtime/travis/reconcile/merge.ts`
- Roof-age estimator invoked unmodified (dry-run → audit → apply → re-run), never reimplemented in SQL/views — `pipeline/oracle-runtime/travis/roof-age/run.ts`
- Every count flows only through the A-03 manifest builder's `derivation` labels, never a direct Query DB read for publication — all track report sections

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design. Mark each ✅ / ❌ / N/A; every ❌ needs a row in Complexity Tracking.*

| # | Article | Check for this plan | Status |
|---|---------|---------------------|--------|
| I | Outcome first | A-07 deploys nothing (`ui: false`); outcome is proven in the PR by ledger counts, the BBB status table + 403 receipts, the business count + capture receipt, the 25/25 roof-age audit, the `rowsWritten: 0` re-run and the worked example — shown live only after A-11/A-13 publish (recorded exception, G4 table) | ✅ (with the recorded G4 exception) |
| II–IV | Stack | New code is TypeScript under the existing Turborepo (`pipeline/oracle-runtime`, `pipeline/local-stack`, `packages/query-core`); no CDK resource created (local stack only, no AWS this story); no new api-client needed | ✅ |
| V–VI | Contracts and LLM | Zod on every adapter input (Comptroller rows, BBB stub responses, Overture STAC/clip rows); no LLM call in this story | ✅ |
| VII–IX | Operations | Comptroller load, resolution run, Overture extract and roof-age apply all run as Restate workflows (queued, retried, observable) through the existing local-stack app; no new alarm needed (local stack only, no production boundary this story) | ✅ |
| X | Quality gates | Vitest ≥ 80% on `packages/query-core` and the profiles/resolver logic (NFR-09); no Playwright (pipeline-only, recorded G6 exception); lint/tsc in CI | ✅ (Playwright exception recorded) |
| XI | Data honesty | Every state/status/basis carries a reason when it isn't a positive match (`contractor_not_printed`, `registry_unavailable`, `no_lexicon_carrier`, `robots_disallow`, "Places: not loaded · {reason}", `unknown`/`none` roof age); coverage % is "not computable" not `0%`/`NaN` when resolved = 0 | ✅ |
| XII | Secrets | No `DATABASE_URL` printed or logged; no BBB API key exists or is requested; no secret in the lexicon-extension drafts | ✅ |
| XIII–XV | Owner agents | Kit Agent Ownership table above filled; `agent-design.md` exists with both agents' answers plus a Disagreements table; builder patterns listed above with file paths | ✅ |
| XVI | Owner review | `oracle`, `donphan`, `porygon` plus `/code-review medium` score the whole branch once (L5); re-score only reviewers under 75; the 75 threshold is the pass bar | ✅ (planned, not yet run) |
| XVIII–XXIII | Delivery | G4 passed (`status: Ready`); G5 and G6 both passed (PASS-with-exceptions, `docs/gates/{G5,G6}-A-07-precheck.md`, approved D-12/D-13); branch is `007-enrich-reconcile` (NNN-slug); tests-first build ordering in tasks.md; any defect found in review becomes a tracked row in `CR-A-07.md`, not a silent fix | ✅ (G4, G5, G6 done; G7 pending) |
| Addendum | Task A (A1–A8) | A1 PR+hosted+credentials+demo gate: N/A path recorded (pipeline-only, no hosted change until A-11/A-13). A3 real data: Comptroller/Austin/TCAD/Overture rows for every case but the AC-2 fixture (labelled). A5 no invented data: every non-match state carries a reason, never a guess. A7 one Query DB writer at a time: enforced per-wave in tasks.md. A8 light lane L1–L8: no `/speckit-checklist`, G5+G6 together, four builder groups max, one review round | ✅ |

## Project Structure

### Documentation (this feature)

```text
specs/007-enrich-reconcile/
├── spec.md · agent-design.md · run-log.md · lexicon-extension-drafts.md
├── plan.md              # this file
├── research.md          # Phase 0
├── data-model.md        # Phase 1 (ledger, company, BBB status, business, place, merge, roof-age rows)
├── quickstart.md        # Phase 1
├── contracts/
│   ├── cli.md            # EN (identity/resolve), BBB stub CLI, overture-clip, roof-age flags, exit codes
│   ├── resolver.md        # the five-state verdict shape, normalisation rule version, ledger row shape
│   ├── report.md          # manifest coverage contribution per track, derivation labels (AD-28)
│   └── estimator.md       # roof-age estimator invocation contract (flags, report JSON shape)
└── tasks.md              # /speckit-tasks (four task groups, one per track)
```

### Source Code (repository root)

```text
pipeline/oracle-runtime/travis/
├── adapters/socrata/
│   └── tx-comptroller.ts              # NEW: 9cir-efmm load, single writer, staged ON CONFLICT, :updated_at watermark, snapshot digest (A, reused by C)
├── identity/                          # NEW (Track A)
│   ├── resolver.ts                    # five-state resolver, versioned normalisation rule, ledger row shape
│   ├── crosswalk.ts                   # the negative crosswalk finding, recorded for evidence (no live effect)
│   └── totals.ts                      # five-state totals + derivation=aggregate_match for manifest coverage
├── bbb/                                # NEW (Track B)
│   ├── wrapper.ts                      # bounded request path: ≤7 requests, ≤1/3s, concurrency 1, stop-on-403
│   ├── config.ts                       # BBB_TARGET=stub gate + the bbb.org grep-fail assertion
│   └── status.ts                       # bbb_status assignment for resolved companies only
├── places/                             # NEW (Track C, builds only if A&D merge in time)
│   ├── business.ts                     # Travis business-group transform (reuses the Comptroller load)
│   ├── overture.ts                     # STAC release pin, counts-only probe, expected_count=NULL semantics
│   └── clip.ts                         # bbox ST_Intersects prefilter -> exact ST_Within polygon clip
├── reconcile/                          # NEW (Track D)
│   └── merge.ts                        # property/owner/contractor merge, TCAD id only, contractor clusters resolved-only
├── roof-age/
│   └── run.ts                          # NEW: estimator invocation wrapper (audit/apply/re-run), report paths under pipeline/data/
└── runs/
    ├── a07-coverage.ts                 # NEW: assembles all four tracks' counts for the A-03 manifest builder
    └── a07-verify.ts                   # NEW: the story's agents.verify check (Phase Z TZ05) — reads the track report JSON files, asserts the four-part independent test, exits non-zero on failure

pipeline/local-stack/
├── migrations/0401_comptroller_registry.sql, 0402_contractor_ledger.sql, 0403_bbb_status.sql,
│               0404_business_places.sql, 0405_reconcile_merge.sql, 0406_roof_age.sql   # NEW
├── services/tracks/{comptroller,identity,bbb,business-places,reconcile,roof-age}.ts     # NEW Loader tracks (one writer each)
└── report-sections/{identity,bbb,business-places,reconcile,roof-age}.ts                 # NEW report sections feeding runs/a07-coverage.ts

packages/query-core/
└── views.sql                           # EXTEND: the view-side roof_date derivation (ADR-0002 #7, already validated 22/22 in the A-02 pilot) is an INDEPENDENT CHECK, never the production source — see "Roof age never computed outside the kit estimator" note below

pipeline/oracle-runtime/test/travis/a07/
├── identity/*.test.ts · bbb/*.test.ts (stub server) · places/*.test.ts · reconcile/*.test.ts · roof-age/*.test.ts
└── test/fixtures/a07/{comptroller,bbb-stub,overture,reconcile,roof-age}/**
```

**Structure Decision**: Follows A-01–A-04's established split — pure, offline-testable logic lives in `pipeline/oracle-runtime/travis/<track>/` (new `identity/`, `bbb/`, `places/`, `reconcile/` directories; `roof-age/` and `profiles/` already exist from earlier stories and are extended, not recreated); the one Loader track per entity and its report section live in `pipeline/local-stack/services/`, the only code holding a Postgres client; the CLI/workflow layer talks only to the Restate ingress. The Comptroller adapter (`adapters/socrata/tx-comptroller.ts`) is the single shared load point for tracks A and C — no second fetch path is created.

**Architecture conformance note (resolving a G5 flag, 2026-10-22):** "Roof age never computed outside the kit estimator" (a builder pattern, above) refers to the *production* roof-age value — `roof-age/run.ts` invokes the unmodified kit estimator, and that output is what is ever written or published. `packages/query-core/views.sql`'s own `roof_date`/basis/confidence derivation is a **pre-existing, independent SQL check** from A-02 (ADR-0002 #7, already validated 22/22 in the A-02 pilot, predating this story) — it is never the source of truth, only the comparison side of the D3 harness (`tasks.md` T047 test, T051 implementation) that the 25-property audit (T053) is checked against. Extending it for this story means adding the comparison columns the harness needs, not adding new roof-age logic. This is the architecture's own documented two-sided check, not a violation of the estimator-only rule; see also the Complexity Tracking row below for the related, separately-tracked no-hosted-URL exception.

## Risks

| # | Risk | Mitigation / fallback | Owner |
| --- | --- | --- | --- |
| R1 | A reviewer mistakes 0 `resolved` / 0 contractor merges for a bug rather than the honest, expected outcome | `agent-design.md`'s "warning signs" table and the manifest limitation text both state the expected-zero outcome up front; `donphan`'s review explicitly re-derives the five-state sum rather than assuming it | oracle (reviewer) |
| R2 | The Socrata Comptroller adapter and the existing Austin-permit adapter get conflated in review as one "registry load" | Keep them as two separate adapter registrations (AD-17); name files distinctly (`adapters/socrata/tx-comptroller.ts` vs the existing `adapters/socrata/austin-3syk-w9eu.ts`) | builder (oracle) |
| R3 | Track C starts building before the A/D merge deadline is actually confirmed met, wasting build time if it slips past 2026-10-23 12:00 EEST | Track C's builder checks the merge timestamps of tracks A and D before starting any Track C task; if the deadline has passed, Track C stops and records the documented gap instead | builder (oracle), Lead |
| R4 | The roof-age estimator's view-derivation comparison (D3) disagrees with the estimator on one of the 25 audited properties, discovered only at D-21 | D3's comparison harness in `packages/query-core` runs alongside D1/D2 in wave 1, on fixtures, well before the live 25-property audit — any logic mismatch surfaces early, not at the stop | builder (oracle) |
| R5 | A unit test accidentally resolves a real bbb.org hostname instead of the stub, breaching D-2 | `bbb/config.ts`'s `BBB_TARGET=stub` gate plus a CI grep-fail on `bbb.org` outside stub-config/evidence files (oracle's own recommended pattern) | builder (oracle) |

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| No hosted-URL evidence (departs from the general P0 rule that only the hosted runtime counts as evidence) | A-07 is `ui: false`, a pipeline-only story (constitution Part 2 addendum; story front matter). It deploys nothing this run — there is no hosted surface to show these counts on until A-11 publishes and A-13 renders them. | Deploying a throwaway hosted page just to satisfy the rule was rejected: it would publish internal Query DB data (forbidden, "never publish or expose the Query DB") before A-11's actual publication step, and would need tearing down immediately after — pure overhead with no evaluator benefit. The accepted substitute evidence (ledger counts, the BBB status table and 403 receipts, the business count, the 25/25 audit, the idempotent re-run, the worked example) is recorded once in the G4 gate report (`docs/gates/G4-A-07-precheck.md`, C-04 exception) and is the same list cited in spec.md's "Gate exceptions" table. |
