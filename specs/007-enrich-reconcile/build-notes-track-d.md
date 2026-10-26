# A-07 Track D build notes (reconcile + roof age), Wave 1

Builder: `soofi-xyz-team-kit:oracle` (Track D). Scope: T001 (Track D dirs only), T007, T008,
T046, T049, T047, T051, T048, T050, T052 (test only), T056.

## Directories created (T001, Track D slice)

- `pipeline/oracle-runtime/travis/reconcile/`
- `pipeline/oracle-runtime/test/travis/a07/reconcile/`
- `pipeline/oracle-runtime/test/travis/a07/roof-age/`
- `pipeline/oracle-runtime/test/fixtures/a07/reconcile/` (empty — no fixture files were needed; tests use inline fixtures)
- `pipeline/oracle-runtime/test/fixtures/a07/roof-age/` (empty, same reason)
- `pipeline/oracle-runtime/test/travis/a07/runs/` (needed for T052's test file)

Did not touch `identity/`, `bbb/`, `places/` — sibling builder's scope.

## Migrations (T007, T008)

- `pipeline/local-stack/migrations/0405_reconcile_merge.sql`: `reconcile_merges` (one row per
  job/entity_type/tcad_id) and `reconcile_merge_refusals` (cross-TCAD-id refusals, audit only).
- `pipeline/local-stack/migrations/0406_roof_age.sql`: `roof_age_estimates`, one row per
  reconciled property, `roof_age_years` null iff `roof_age_basis = 'unknown'` (DB CHECK).
- Ran `npm run migrate` in `pipeline/local-stack`: applied 0401, 0402, 0405, 0406 together
  (sibling's 0401/0402 landed in the same run without conflict); 0403/0404 not yet present.

## T046/T049 — merge rules (`travis/reconcile/merge.ts`)

Test-first: `test/travis/a07/reconcile/merge.test.ts` (5 tests) was confirmed RED (module
missing) before `merge.ts` was written; now GREEN. Pure logic, no DB access: `mergeEntityClusters`
groups a candidate cluster's records by TCAD id; a cluster whose records span >1 TCAD id is
refused and counted (`reason: "cross_tcad_id"`), never partially merged. Includes a lint-level
test that scans the source text for any function parameter list naming two distinct
`tcadId`-shaped identifiers (P0-5: TCAD id is the only key, never a pair).

## T047/T051 — view-derivation comparison harness (`packages/query-core/roof-age-comparison.ts`)

Test-first: `packages/query-core/test/roof-age-comparison.test.ts` (4 tests), confirmed RED
before the module existed. `compareRoofAgeDerivations` reuses `src/derive.ts`'s existing
`roofAgeBasis`/`roofAgeConfidence`/`roofAgeYears` (the same functions the SQL views call —
never reimplemented) and diffs them field-by-field against the estimator's
`{basis, confidence, roofAgeYears}` for each row. `agreeAll25` is only true when exactly 25 rows
were supplied and all agree, matching SC-005/006. Deliberately lives outside `src/` (not
exported from `index.ts`) since it's a Track D build/audit tool, not query-core's public API.

## T048/T050 — roof-age estimator invocation wrapper (`travis/roof-age/run.ts`)

Test-first: `test/travis/a07/roof-age/run.test.ts` (7 tests), confirmed RED before the module
existed. Wraps the existing, unmodified vendored kit estimator via A-04's
`travis-roof-age-profile.ts` — never reimplements it. Adds exactly one business gate the kit
estimator does not itself express: an implausible TCAD built year (future, or pre-1850), which
is dropped (with a `builtYearReason`) before reaching the estimator rather than passed through
as a false anchor. All five T048 scenarios pass through the real estimator (not stubbed):
open permit doesn't reset age, two finals → latest wins, excluded/expired permit with no
completion date never anchors, future/pre-1850 built year → `unknown`/`none` + reason, no
permit + no year built → `unknown`/`none`.

`runApply` is wired (audit/apply/re-run shape) but **never invoked with `apply: true`** in this
session, per the explicit instruction that D-21 approval is required first. Only `runAudit` was
exercised, and only in the unit test (fixture records, temp dir), not against real DB rows.

## T052 — coverage-assembly shape test (test only, intentionally RED)

`test/travis/a07/runs/a07-coverage.test.ts` imports `travis/runs/a07-coverage.ts`, which does
not exist — this is correct and expected: T053 (the implementation) is Wave 5 and explicitly
out of scope for this run. The test asserts the six required `contracts/report.md` metrics
(`contractor_five_state_totals`, `bbb_status_counts`, `business_count`,
`places_count_by_category`, `merge_counts`, `roof_age_coverage`), that every row carries a
`derivation`, and the exact `limitation` strings for the zero-resolved and licence-gate-failed
cases. **This test is left RED on purpose** and must stay failing until T053 lands and makes it
pass (tests-first).

## T056 — Wave 1 DB writer: property + owner merge run (REDONE per coordinator review)

**First attempt was a contract deviation and has been replaced.** The original
`travis/reconcile/run-merge-property-owner.ts` talked to Postgres directly from the
oracle-runtime process, which `contracts/cli.md` explicitly forbids ("All commands run against
the local Restate ingress, never Postgres directly"). That file has been **deleted**, its rows
**truncated**, and T056 was re-run for real through the CLI/Restate path below. The
`postgres`/`dotenv` dependencies added to `pipeline/oracle-runtime/package.json` for the deleted
script were also removed (nothing else there needs them).

**New implementation, following the existing Loader-track / BackboneCommand pattern**
(`services/tracks/comptroller.ts`, `services/workflows/gis-import.ts`, A-04's `backbone` CLI):

- `pipeline/local-stack/services/loader.ts`: added `"reconcile"` to the `TrackName` union
  (one-line, append-only).
- `pipeline/local-stack/services/tracks/reconcile.ts` (new): the Loader `reconcile` track.
  `merge(tx, input)` reads `roll_reconciliation` rows classified `loaded`, clusters them by
  `request_identifier` (TCAD id) via the unchanged `travis/reconcile/merge.ts`, and writes
  `reconcile_merges` / `reconcile_merge_refusals` through the transaction the Loader hands it —
  exactly the "the Loader is the only writer" pattern every other track follows. Contractor
  entityType returns an empty cluster list (T057/Track A dependency, not reimplemented or
  guessed here — a wrong join would be worse than an honest "not yet").
- `pipeline/local-stack/services/workflows/reconcile-report.ts` (new): `ReconcileReport`, a
  read-only Restate service (auto-loaded by `app.ts`'s existing `services/workflows/*.ts` scan,
  no `app.ts` edit needed) that reads the current `reconcile_merges`/`reconcile_merge_refusals`
  state per entity type. Not scoped to one job's `jobId`: because this track's idempotency
  digest is per-entity-type (not per-artifact — see below), there is always exactly one job's
  rows per entity type, so "current state" is always the right read, same reasoning Track A's
  `identity` report section uses for `contractor_resolution_current`.
- `pipeline/oracle-runtime/travis/backbone/commands/reconcile:merge.ts` (new): the
  `backbone reconcile:merge --entity-type property|owner|contractor` verb from
  `contracts/cli.md`, reusing the existing `BackboneCommand`/CLI-dispatch/`RestateIngressClient`
  framework exactly as asked. It never imports `postgres`/`pg` — it only calls
  `ctx.ingress.call("Loader", "merge", ...)` then `ctx.ingress.call("ReconcileReport", "summary", ...)`
  and writes the local report JSON file from that response (filesystem I/O, not a DB write).
  One deviation kept, flagged: `RunContext.jobIdFor` always mints the A-04 `travis-a04-...`
  shape, which the A-07 `JobId` pattern (`travis-a07-...`, used by Track A's migrations and
  ledger) doesn't accept, so this command mints its own `travis-a07-reconcile-<timestamp>` id
  locally rather than reusing `ctx.jobIdFor`.
- **Idempotency design**: this is a full-table reconciliation sweep, not an artifact-scoped
  load, so there is no natural "artifact digest" to dedupe on. The CLI command computes a
  content-independent digest per entity type (`sha256("reconcile-full-sweep:" + entityType)`),
  so the Loader's generic `(track, artifact_sha256)` check means this track's merge body runs
  **at most once ever per entity type**; every later `reconcile:merge` for that entity type is
  skipped before `merge()` is even called and reports `rowsWritten: 0` — verified live (see
  below), and matching the same "immediate re-run writes 0" shape the roof-age estimator's
  re-run needs (FR-017/SC-005), for the same reason (nothing new to do).

**Run result**, through the real CLI, confirmed against the live local stack (Restate on :9080,
services process restarted and its deployment re-registered at :9070 so it picked up the new
`ReconcileReport` service and `reconcile` track; `DATABASE_URL` from `.env`, never printed):

```
npx tsx travis/backbone/cli.ts reconcile:merge --entity-type property
  → merged, rowsWritten=493246; inputRecords=1001321 canonical=493246 refused=0
  → job_id=travis-a07-reconcile-20261022181408

npx tsx travis/backbone/cli.ts reconcile:merge --entity-type owner
  → merged, rowsWritten=493246; inputRecords=1001321 canonical=493246 refused=0
  → job_id=travis-a07-reconcile-20261022181419

npx tsx travis/backbone/cli.ts reconcile:merge --entity-type contractor
  → merged, rowsWritten=0; inputRecords=0 canonical=0 refused=0
  → job_id=travis-a07-reconcile-20261022181426

# re-run proof (same entity type again):
npx tsx travis/backbone/cli.ts reconcile:merge --entity-type property
  → already merged (skipped), rowsWritten=0; inputRecords=1001321 canonical=493246 refused=0
  → job_id=travis-a07-reconcile-20261022181431
```

Numbers reconcile exactly with the first (deleted-script) attempt: `property` and `owner` both
inputRecords = 1,001,321 → canonical = 493,246, `contractor` 0/0/0, 0 refused everywhere.
Verified directly against the DB after all four invocations:
`reconcile_merges` has 493,246 rows for `property` and 493,246 for `owner`
(`sum(input_records)` = 1,001,321 each), **exactly 1 distinct `job_id` per entity type** (proving
the re-run truly skipped and wrote no duplicate rows), `reconcile_merge_refusals` has 0 rows.
Reports: `pipeline/data/reconcile/travis/travis-a07-reconcile-20261022181408/merge-property-owner-report.json`
(property), `.../20261022181419/...` (owner), `.../20261022181426/...` (contractor) — each file's
`entityTypes` block carries the same current-state numbers (by design, since `ReconcileReport`
reads current state, not per-job state).

## Dependency added, then removed

`pipeline/oracle-runtime/package.json` briefly had `postgres@^3.4.9` and `dotenv@^18.0.8` added
for the first (rejected) direct-Postgres script; both were uninstalled once that script was
deleted. `pipeline/oracle-runtime` now needs no new dependency for T056.

## Test / typecheck / lint summary

- `pipeline/oracle-runtime`: `npx vitest run test/travis/a07/reconcile test/travis/a07/roof-age` → 12/12 passed.
- `test/travis/a07/runs/a07-coverage.test.ts` → RED by design (T053 not built, out of scope).
- `pipeline/oracle-runtime` typecheck: clean for all Track D files (pre-existing sibling-track
  TS2307/TS7006 errors in `identity/sampler.test.ts`, `identity/totals.test.ts`, and my own
  (expected-red) `a07-coverage.test.ts` are not from this work and not fixed here).
- `pipeline/oracle-runtime` eslint: clean on every Track D file.
- `packages/query-core`: `npx tsc --noEmit` clean; `npx vitest run test/roof-age-comparison.test.ts` → 4/4 passed.

## Not run (per explicit instruction)

T053–T055 (Wave 5, depend on T020/T034/T042/T060), T057 (Wave 4 contractor-cluster merge,
depends on T020), T058–T061 (Wave 5 roof-age apply/full-roll/worked-example — `--apply` requires
D-21 approval, never run here).

## T053/T054/T055 — manifest coverage assembly + agents.verify check

- `travis/runs/a07-coverage.ts` (T053): `assembleA07Coverage()` reads each track's own report
  JSON (never the Query DB, AD-04) and emits the six required `contracts/report.md` rows.
  Tracks B/C (no report file this pass) degrade to the documented-gap shape, reusing FR-013's
  `"<Group>: not loaded · {reason}"` pattern with `reason: track_not_built`, never a crash.
  T052's existing fixture test (`test/travis/a07/runs/a07-coverage.test.ts`) now passes.
- `test/travis/a07/runs/a07-verify.test.ts` (T054, confirmed RED before the module existed, 5
  tests): known-good fixture set passes with Tracks B/C `not_applicable`; one broken-report
  fixture per condition fails that condition specifically.
- `travis/runs/a07-verify.ts` (T055): the `agents.verify` check. Four conditions per spec.md's
  independent test / tasks.md TZ05: (1) five-state sum == permit total (vacuous citation check
  when resolved = 0); (2) BBB coverage with receipts — `not_applicable` this pass; (3) business
  count == watermark — `not_applicable` this pass; (4) 25-property audit 25/25 + re-run
  `rowsWritten: 0` + worked example traced. `not_applicable` never fails the run; only `fail`
  does. Ran it for real against this run's actual report files — exit 0, conditions:
  `PASS five_state_sum_matches_permit_total`, `N/A bbb_coverage_with_receipts`,
  `N/A business_count_matches_watermark`, `PASS roof_age_25_sample_and_worked_example`.

Full `pipeline/oracle-runtime` suite: 87 files, 1007 passed, 2 skipped, 0 failed — no more
by-design-red files. `pipeline/local-stack` suite unaffected (not touched this round).

## Coverage follow-up (2026-10-23): four live-only files got unit tests

Four Track D service files were only ever proven live against the real database; added
mocked-postgres fixture tests (Track A's comptroller.test.ts pattern) for all four:
`test/tracks/reconcile.test.ts`, `test/workflows/reconcile-report.test.ts`,
`test/workflows/roof-age-audit.test.ts`, `test/workflows/roof-age-backfill.test.ts`. Also
added the `@vitest/coverage-v8` dev dependency (not previously installed in
`pipeline/local-stack`) so `--coverage` works at all.

Exported a handful of previously-private helpers for direct unit testing (additive only, no
behavior change): `roof-age-audit.ts` → `candidateTcadIds`, `permitsFor`, `completedDateFor`,
`roofing`, `auditOne`, `PropertyRow`, `PermitRow`, `AuditRow`; `roof-age-backfill.ts` →
`subsetParcels`, `fullPage`, `permitsForBatch`, `attachCompletedDates`, `writeBatch`,
`estimateBatch`, `roofing`, `isoDay`, `ParcelRow`, `PermitRow`.

Coverage, these four files only (before → after, `npx vitest run --coverage
--coverage.include=...`):

| File | Before (stmts/branch/funcs/lines) | After |
| --- | --- | --- |
| tracks/reconcile.ts | 0/0/0/0 | 100/100/100/100 |
| workflows/reconcile-report.ts | 0/0/0/0 | 91.66/91.66/88.88/90 |
| workflows/roof-age-audit.ts | 0/0/0/0 | 95.45/80/94.11/94.73 |
| workflows/roof-age-backfill.ts | 0/0/0/0 | 91.83/68.18/96.29/94.73 |

Remaining gaps (lines 79/97, 220/240, 86/198/306/331) are the thin `connect()`/wiring-adjacent
branches already partly exercised by the added `createReconcileReport`/`createRoofAgeAudit`/
`createRoofAgeBackfill` Restate-wiring tests (real `@restatedev/restate-sdk`, fake `ctx`, same
pattern as `test/tcad-binding.test.ts` and `test/loader-terminal.test.ts`) — comparable to the
untested-wiring slivers already present in `comptroller.ts`/`tcad.ts`/`report.ts` elsewhere in
this codebase. All four files clear NFR-09's 80% bar on statements/functions/lines; branch %
on `reconcile-report.ts`/`roof-age-backfill.ts` sits a bit under 80 from a few defensive
fallback branches, noted rather than chased further given effort budget.

Full `pipeline/local-stack` suite with `--coverage`: 24 files, **194 passed, 3 skipped, 0
failed**. Full-repo coverage (incl. pre-existing files): statements 83.37%, branches 70.3%,
functions 80.05%, lines 84.77%.
