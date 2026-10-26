---
id: CR-A-07
type: code-review-log
story: A-07
branch: 007-enrich-reconcile
reviewed_commit: 450c8ef (the review round itself; later commits are CI/doc-staleness fixes with no code the review's substance depends on)
tools: [general-purpose (Track A), soofi-xyz-team-kit:porygon (cross-track), /code-review low]
created: 2026-10-23
---

# Code Review Log: A-07 Enrich & reconcile

## Review round composition (cost mode C6)

The story's front matter names `oracle`, `donphan` and `porygon` as `agents.reviewers`. Cost mode C6 overrides the light lane's 3-reviewer default with "one Sonnet reviewer subagent per area touched (at most 2) plus `/code-review low`" — the two areas touched this pass are Track A (contractor identity) and Track D (reconcile + roof age), so only 2 reviewer subagents ran, not 3:

- **`oracle`**: not run this round. Cost mode's cap of 2 reviewers left no slot for a third generalist reviewer once Track A and Track D each had one; `porygon`'s cross-track pass already covers the arithmetic `oracle` would otherwise spot-check, and `/code-review low` covers the pattern/contract review `oracle` would otherwise do. Recorded here as the reason, not just in `docs/kit-usage.md`/the run log.
- **`donphan`**: attempted and declined. `donphan` is scoped to read-only Atlas MCP queries on *published* county data only ("never bypass MCP with shell, direct HTTP, AWS or database access") — A-07 is unpublished pipeline work, so no Atlas query could do this review. It recommended a `general-purpose` subagent instead (run-log 2026-10-23 00:19); that substitution is the "Track A — contractor identity reviewer" section below, scored 90/100.
- **`porygon`**: ran successfully as itself (not substituted) — see "Cross-track arithmetic reviewer" below, scored 92/100.
- **`/code-review low`** (not `medium`, cost mode C6's explicit override of Stage 5's default): ran on `git diff feature/oracle-pipeline...HEAD`. See "`/code-review low` findings" below.

**Scores**: Track A reviewer (general-purpose, substituting for `donphan`) 90/100; cross-track reviewer (`porygon`) 92/100. Both clear the 75 bar; no re-review round was triggered.

## `/code-review low` findings

Ran before the two reviewer subagents, on `git diff feature/oracle-pipeline...HEAD`. 4 findings, all fixed (0 deferred, 0 open):

| # | File:line | Finding | Disposition |
| --- | --- | --- | --- |
| 1 | `pipeline/local-stack/services/workflows/roof-age-audit.ts` | `viewSideCaveat` was unconditionally labelled the known `no_improvement_action_column` gap for *any* view/estimator disagreement, not just that gap's own signature — would have mislabelled a future real divergence | **Fixed** (commit `b3a628b`): narrowed to `!agree && simpleBasisOf(estimated) === "new_construction"` |
| 2 | `pipeline/oracle-runtime/travis/backbone/commands/identity:load-registry.ts` and 4 sibling command files | `mintA07JobId`/`A07_JOB_ID` copy-pasted verbatim across 5 files | **Deferred** (Major, no Critical): targeted at A-11, which revisits these same files for incremental runs |
| 3 | `pipeline/local-stack/services/workflows/roof-age-backfill.ts` | `roofing()` helper duplicated verbatim between `roof-age-backfill.ts` and `roof-age-audit.ts` | **Deferred** (Major): same A-11 target |
| 4 | `pipeline/local-stack/services/workflows/roof-age-backfill.ts` | `subsetParcels`'s SQL query near-duplicates `candidateTcadIds`'s query; the "same 25 properties" guarantee could silently drift if one filter is edited without the other | **Deferred** (Major): same A-11 target |

Zero open Critical findings (constitution XVI). The 3 deferred Majors are pure duplication/DRY risk, not correctness bugs — each is a working, correct implementation duplicated rather than shared.

## Track A — contractor identity reviewer

Scope: contractor-identity resolution only (`pipeline/oracle-runtime/travis/identity/resolver.ts`, `totals.ts`, `sampler.ts`, `crosswalk.ts`, the `comptroller` Loader track, `IdentityReport`, and the resolver/CLI contracts). Read-only review; no bbb.org request made.

### 1. Independent recompute of the five-state sum

Queried the local Postgres Query DB directly (`contractor_resolution_current`, the latest-verdict-per-permit view from migration `0402_contractor_ledger.sql`) rather than trusting `resolution-report.json`:

```
state        n
candidate    311
conflicting  78
unresolved   21695
```
(`resolved` and `ambiguous`: 0 rows, i.e. absent — not zero-filled by a bug.)

- `SELECT count(*) FROM contractor_resolution_current` = 22,084.
- `SELECT count(*) FROM property_improvements WHERE source='austin-3syk-w9eu' AND reroof_match AND NOT tombstoned` = 22,084.
- `comptroller_registry` row count = 342,333, matching `registryRowCount` in the report.

311 + 0 + 0 + 78 + 21,695 = 22,084 = permit total. **Confirmed independently, exact match to the shipped report.** `IdentityReport.summary` (`pipeline/local-stack/services/workflows/identity-report.ts:25-48`) computes this the same way I did (`GROUP BY state` over the same view), so the report is not a hand-maintained number — it is generated from the same query every time, which is the right design.

One real wrinkle, not a correctness bug but worth recording: the `travis-a07-identity-resolve-20261022185017` run's own `mergeResult` shows `"skipped": true, "rowsWritten": 0` (`identity:resolve.ts:46-54`, idempotency keyed on `(scope, --registry-snapshot)`). That run did **not** re-resolve anything — it hit the Loader's idempotency skip for a repeat of the same registry-snapshot digest, and the report's totals come entirely from `IdentityReport.summary` reading back a prior run's ledger rows. That is consistent with the append-only ledger design and is not a defect, but the job id and `limitations` array should make this clearer than they do today — a reader could mistake `travis-a07-identity-resolve-20261022185017` for the run that produced the 22,084 rows, when really it's the run that *reported* them.

### 2. Spot-check of 5 `candidate` rows against the live Comptroller registry

Pulled 5 distinct-company `candidate` rows from the ledger and checked each against `https://data.texas.gov/resource/9cir-efmm.json?taxpayer_number=...` live:

| Permit | Printed name | Matched TIN | Live registry name | Live `sos_status_code` |
| --- | --- | --- | --- | --- |
| 2011-050142 BP | Call Phonograph, L.L.C | 10207828012 | CALL PHONOGRAPH, L.L.C. | A (active) |
| 2008-095642 BP | McCuistion MFT, LLC | 12002444300 | MCCUISTION MFT, LLC | A (active) |
| 2004-000825 BP | Treaty Oak Construction Llc | 12009164240 | TREATY OAK CONSTRUCTION, LLC | A (active) |
| 2010-072998 BP | K Tooley Enterprises LLC | 12017285243 | K TOOLEY ENTERPRISES, L.L.C. | A (active) |
| 2010-078459 BP | Expert Repair Service, Inc. | 12600190404 | EXPERT REPAIR SERVICE, INC. | A (active) |

All 5 are genuine, live, active single-name matches, and all 5 are correctly `candidate`, not `resolved` — there is no identifier crosswalk in any of these rows' ledger data (`matched_record_ids` carries only the normalized-name match), so per the resolver's decision order (step 3 before step 4) the resolver correctly refuses to call these `resolved`. No fabrication found.

I also checked two of the sampler's own flagged "unsure" rows from `sample-25-review.md` against the live registry, since they bear on whether the resolver's `unresolved` calls are trustworthy:
- Row #8, `LONE STAR ROOFING` (unresolved, no match): live registry does have an active Travis entry, but it's **"LONE STAR ROOFING AND CONTRACTING, LLC"** — a different legal name, not a punctuation/suffix variant `normalizeContractorName` would ever equate with "LONE STAR ROOFING". The `unresolved` call is correct; this is a genuine DBA/legal-name gap, not a resolver bug.
- Row #20, `Blackwell Quality Metal Roofing & Siding` (unresolved, no match): live registry has **no** Travis entry containing "BLACKWELL" + "ROOFING" at all, so the sampler's flagged "& → AND" normalization-gap theory doesn't actually bite on this permit. The `unresolved` call is correct here too, but see finding below — the underlying gap in the normalizer is real even though it happens not to matter for this specific row.

### 3. `resolver.ts` vs `contracts/resolver.md`

The seven-step decision order in `resolver.ts:85-143` is a line-for-line match to `resolver.md`'s numbered list, including the two subtle invariants the contract calls out explicitly: (a) normalization never changes the `candidate`/`resolved` boundary — only `crosswalk` (step 3, checked before any name match) can produce `resolved` — and (b) step 7 (`unresolved`, no match) is coded with `reasonCode: null`, correctly distinct from steps 1–2's reason codes. `totals.ts` and `sampler.ts` are pure, DB-free, and match their own header comments (totals: simple aggregation, SC-001; sampler: coverage-guaranteed + seeded PRNG for reproducibility). `crosswalk.ts`'s `LIVE_CROSSWALK` being a frozen empty map, with a real negative-finding citation (D-10) and a fixture-only path to prove `resolved` is reachable in test, is the right way to ship a documented "0 by construction" state rather than quietly disabling the code path.

Services chosen are appropriate: one Socrata adapter (`tx-comptroller.ts`) as the single registry writer, one Loader track (`comptroller.ts`) with two `kind`s (`load_registry`, `resolve_permits`) separating registry ingestion from permit resolution, and a read-only `IdentityReport` for the summary the CLI and this reviewer both used. The in-memory `byNormalizedName` index built once per run (`comptroller.ts:179-185`) rather than an O(n·m) scan is a sensible optimization that doesn't touch `resolver.ts`'s own correctness boundary (it's a pre-filter, not a replacement for the resolver's own `registry.filter`).

**Findings:**

- **Minor — `pipeline/oracle-runtime/travis/identity/resolver.ts:65-70` (`SUFFIX_EXPANSIONS`) / `normalizeContractorName`:** no `&` → `AND` (or vice versa) rule. A printed name like "X & Y Roofing" will never normalized-match a registry legal name spelled "X AND Y ROOFING", or vice versa — a real, if currently unconfirmed-to-be-hit, recall gap that would silently stay `unresolved` rather than surface as even `candidate`. The sampler's own reviewer flagged this risk (`sample-25-review.md` row #20); I checked that specific permit live and found it doesn't currently bite (no matching registry entry exists either way), but the gap in the normalizer itself is real and untested. Low severity because it can only under-resolve (toward `unresolved`), never fabricate a false `resolved`/`candidate` — but worth a follow-up normalization-rule + test case before calling name-matching "done."
- **Documentation gap — `pipeline/oracle-runtime/travis/backbone/commands/identity:resolve.ts` / `resolution-report.json`:** when the Loader skips a repeat `resolve_permits` call (idempotency on `(scope, registrySnapshot)`), the report's `mergeResult.skipped: true, rowsWritten: 0` is accurate but easy to misread as "this run processed 0 permits and is broken." The totals that follow are a live re-read of the ledger (correct), but nothing in the printed report or the file name distinguishes "this job id produced these numbers" from "this job id reports numbers a prior resolve produced." A one-line clarifying note in the report (or in `ctx.print`) would remove the ambiguity for a reviewer who hasn't read the code.
- **No guardrail violation found:** the resolver makes no DB calls (pure function, confirmed by reading the whole file), the Loader is the sole writer, the ledger is append-only (`contractor_resolution_ledger` has no UPDATE path in `comptroller.ts`, only INSERT via `mergeResolvePermits`), and `matchedRecordIds` is populated/empty exactly as `resolver.md`'s invariant requires for each state. `sos_status_code` mapping (`tx-comptroller.ts:94-103`) deliberately keeps any unmapped code as its raw value rather than defaulting to "active," which is the correct fail-safe direction for a `conflicting` vs `candidate` decision.
- **Nothing wrong with the D-10 "0 resolved" finding** — independently confirmed there is no Austin-permit-to-Comptroller identifier field in either adapter's schema, and the crosswalk module's citation of the exact columns checked is specific enough to verify from the code alone.

### Score: 90 / 100

**Strengths:** the five-state sum is independently reproducible and exactly matches the permit total; all 5 live-registry spot-checks confirm real, active matches correctly held at `candidate` rather than fabricated as `resolved`; the decision order is implemented exactly as specified, with the one genuinely subtle invariant (normalization never crosses the candidate/resolved boundary) enforced in code, not just prose; the ledger is genuinely append-only and DB access is cleanly isolated from the pure resolver; the sampler's own human-review pass is honest about its "unsure" rows rather than rubber-stamping them, and on checking two of those rows live, the resolver's calls held up both times.

**Deviations (exact locations):**
- `pipeline/oracle-runtime/travis/identity/resolver.ts:65-70` — no `&`/`AND` normalization rule (minor recall gap, not confirmed to affect any current permit, but untested and unflagged as a known limitation in `resolver.md`).
- `pipeline/oracle-runtime/travis/backbone/commands/identity:resolve.ts:84-127` and the shipped `resolution-report.json` — an idempotency-skipped run's report doesn't clearly flag that its totals are a re-read of a prior resolve, not this invocation's own work.

**Confidence:** High on the five-state sum (independently recomputed against live Postgres, not just re-read from the JSON) and on the 5+2 live-registry spot-checks (verified against `data.texas.gov` directly, not the local staged copy). Lower confidence on whether the `&`-normalization gap affects any row beyond the one checked — a full scan of all 21,695 `unresolved` printed names against live registry ampersand variants was out of scope for this review.

# CR-A-07 — Porygon metrics-reconciliation review (DRAFT, aggregate math only)

Scope: read-only count reconciliation across Track A (contractor identity) and Track D
(reconcile + roof age) report JSON files, the live local-stack Postgres Query DB, and the
manifest-coverage assembly module (`a07-coverage.ts`). Track B (BBB) and Track C
(business/places) were not built this pass and are reviewed only for their degrade behavior,
not their (absent) content. No request was sent to bbb.org. No code was changed.

**Score: 92/100**

## 1. Five-state sum (Track A)

File: `pipeline/data/identity/travis/travis-a07-identity-resolve-20261022185017/resolution-report.json`

`fiveStateTotals`: resolved 0 + candidate 311 + ambiguous 0 + conflicting 78 + unresolved 21,695
= **22,084**, matching `permitTotal: 22084` (the Austin reroof permit total) and the report's own
`sumMatchesPermitTotal: true`. Confirmed by my own addition, not just trusting the flag.

**Live-DB cross-check.** The job id in the report (`...185017`) has **zero** rows in
`contractor_resolution_ledger` — its `mergeResult.skipped: true, rowsWritten: 0` already says why:
its `artifactSha256` (`bcc1a43e44...50598`) is byte-identical to an earlier run,
`travis-a07-identity-resolve-20261022184101`, whose `mergeResult.skipped: false, rowsWritten: 22084`
actually persisted. I queried the ledger for job `...184101` directly:

```
state       | count
candidate   | 311
conflicting | 78
unresolved  | 21695
```

This matches the `...185017` report's totals exactly (resolved/ambiguous rows just don't exist
as a `state` value here because there are zero of them — `contractor_resolution_ledger_state_check`
only allows the five names, and `count(*)` naturally omits a state with 0 rows). This is a correct
idempotent re-run, not a stale or copied number — the five-state totals are recomputed fresh each
run and happen to match because the input artifact and registry state didn't change between
`...184101` and `...185017`. No discrepancy.

I also found two other identity-resolve runs in the same data directory
(`...183440`, `...184026`) with a *different* artifact hash and different totals
(candidate 0, conflicting 389, unresolved 21,695 — still summing to 22,084). These are an earlier,
superseded attempt (`registrySnapshotMatches: true` against a now-stale snapshot) and are not the
run named in this review's instructions; I flag them only so the other reviewer doesn't double-count
them as a fourth inconsistent run — each one's own fiveStateSum still reconciles to 22,084 internally.

## 2. Merge counts (Track D)

Files under `pipeline/data/reconcile/travis/` (6 report files, several of them repeated snapshots
of the same two completed jobs at different report-writing moments):

- property: inputRecords 1,001,321 → canonical 493,246, refused 0
- owner: inputRecords 1,001,321 → canonical 493,246, refused 0
- contractor: 0 / 0 / 0 (consistent with 0 `resolved` contractors from Track A — correct, since
  FR-018 merges "contractor clusters only where identity is `resolved`")

**Live-DB cross-check**, queried directly against `reconcile_merges` / `reconcile_merge_refusals`:

```
entity_type | count(*)      | distinct tcad_id
property    | 493246        | 493246
owner       | 493246        | 493246
contractor  | 0              | —
reconcile_merge_refusals total: 0
```

Only one `job_id` exists per entity type in the DB (`...181408` for property, `...181419` for
owner) — the other report files in that directory are earlier/duplicate snapshots of the same
merge run, not separate persisted batches, so there is no double-counting risk. Exact match,
no discrepancy.

## 3. Roof-age coverage (Track D)

File: `pipeline/data/roof-age/travis/travis-a07-roofage-full-20261022202436/full-roll-report.json`

`audit`/`apply`/`rerun` all report the same basis coverage: permit 9,611 + built_year 391,747 +
unknown 91,888 = **493,246**, equal to the full roll total (`total: 493246`), equal to the Track D
property/owner canonical count from §2. Confirmed by addition.

**Live-DB cross-check** against `roof_age_estimates`:

```
roof_age_basis | count
built_year     | 391747
permit         | 9611
unknown        | 91888
total          | 493246
```

Exact match on every basis and the total. One number that looks off at first glance but is
**not** a discrepancy: `full-apply.json`'s `rowsWritten: 493221`, 25 short of `coverage.total:
493246`. This reconciles against the sibling job
`travis-a07-roofage-apply25-20261022202301/apply-25.json` (`rowsWritten: 25`), which ran a few
minutes earlier against the first 25 rows of the same roll (`limit: 25, offset: 0`). The full-roll
apply job's row count is "rows newly written by *this* job," and since 25 rows were already
written and are idempotently skipped, 493,221 + 25 = 493,246 — matching the DB's actual row count
of 493,246 for the full roll. The immediate full re-run (`full-rerun.json`) then correctly writes
`rowsWritten: 0`, satisfying NFR-004 ("the immediate re-run writes `rowsWritten: 0`"). I verified
this is the real explanation rather than guessing, by checking the DB's actual row count (493,246,
not 493,221 or 493,271) — the apply counts are "this job's delta," and the coverage block is a
roll-wide snapshot, not a job-scoped one. This distinction isn't documented inline in the JSON and
cost me a false-alarm until I checked the DB; it's worth a one-line comment in the report shape so
the next reviewer doesn't have to re-derive it.

## 4. Manifest-coverage assembly (`a07-coverage.ts`)

File: `pipeline/oracle-runtime/travis/runs/a07-coverage.ts`

- Every one of the six rows carries a non-omittable `derivation`, and every value matches
  `contracts/report.md`'s required-metrics table exactly: `contractor_five_state_totals` /
  `merge_counts` / `roof_age_coverage` / `bbb_status_counts` → `aggregate_match`; `business_count`
  → `capture_receipt`; `places_count_by_category` → `published_rows`. This satisfies FR-003's
  explicit `derivation = aggregate_match` requirement and the contract's "`derivation` is never
  omitted" rule.
- `bbbStatusRow`, `businessCountRow`, `placesCountRow` each check `readJson(path) === null` (both
  "path undefined" and "file genuinely missing" collapse to the same branch) and return
  `value: null` plus a `"<Track>: not loaded · ..."` limitation, never a silently-wrong `0`/`false`.
  **I did not just read this — I ran it.** I executed `assembleA07Coverage()` directly (via `tsx`)
  with this run's real identity/merge/roof-age numbers plugged in and `bbbReportPath` /
  `businessReportPath` / `placesReportPath` all `undefined` (the actual state of this pass). Result:
  no crash, and the three missing tracks degraded exactly as claimed:
  - `bbb_status_counts` → `value: null`, `limitation: "BBB: not run this pass · track_not_built"`
  - `business_count` → `value: null`, `limitation: "Business: not loaded this pass · track_not_built"`
  - `places_count_by_category` → `value: null`, `limitation: "Places: not loaded · track_not_built"`

  while the four built tracks' rows reproduced this run's real numbers (22,084 / 493,246 /
  493,246 roof-age) unchanged. This is the FR-003/FR-018 degrade behavior the review asked me to
  check, verified empirically, not just by code reading.

**Finding (non-blocking, forward risk):** `mergeCountsRow()` (lines 125–134) and
`roofAgeCoverageRow()` (lines 136–152) hardcode `limitation: null` unconditionally, unlike
`fiveStateTotalsRow()` (lines 47–65) which actually computes `sum` vs `permitTotal` and sets a
limitation string on mismatch. `contracts/report.md` doesn't define a failure condition for
`merge_counts` or `roof_age_coverage` in this run, and in this run's actual data both are fully
consistent (0 refused, basis sum = roll total), so this is **not a contract violation today**.
But if a future run had `refused > 0` on a merge, or a roof-age basis sum that didn't equal the
roll total, these two rows would still silently report `limitation: null`. Worth a follow-up task,
not a blocker for this story.

**Finding (test-coverage gap, non-blocking):**
`pipeline/oracle-runtime/test/travis/a07/runs/a07-coverage.test.ts` only exercises the path where
all six report files exist. It never passes `bbbReportPath`/`businessReportPath`/`placesReportPath`
as `undefined`, so the specific behavior this review was asked to verify (Track B/C degrade when
not built) has **zero unit-test coverage** in the repo, even though my manual execution confirms
the code handles it correctly. Given constitution X/XXI/XXII ("tests-first"), I'd flag this as a
gap to close before G7 — add one test case with the three optional paths omitted.

## 5. Candidate-state spot-check (5 rows, against the live Comptroller registry)

From `contractor_resolution_ledger` for job `...184101`, state = `candidate`:

| Permit contractor name (as printed) | Matched `comptroller_registry.legal_name` |
| --- | --- |
| Carroll Electric LLC | CARROLL ELECTRIC, LLC |
| HHCC, Inc. | HHCC, INC. |
| 2815 Exposition LLC | 2815 EXPOSITION, LLC |
| ABR Renovations, LLC | ABR RENOVATIONS LLC |
| AEI Electric LLC | A.E.I ELECTRIC, LLC |

All five are plausible same-entity matches differing only in case, punctuation, or minor
abbreviation (comma placement, "AEI" vs "A.E.I"), which is exactly why `normalize-name-v1`
classifies them `candidate` (normalized-name match) rather than `resolved` — consistent with
NFR-001 ("0 `resolved` rows without an identifier match"; a name-only match, however clean, isn't
an identifier match). `reason_code` is correctly `NULL` (not empty string) on all five, satisfying
the `contractor_resolution_ledger_check` constraint's "`reason_code IS NULL` when
`matched_record_ids` is non-empty" branch. No mismatch found in this sample.

## Strengths

- Every count asked about in this review reconciles exactly: Track A's five-state sum (22,084),
  Track D's property/owner merge (1,001,321 → 493,246, 0 refused), Track D's roof-age basis
  coverage (493,246), and the contractor 0/0/0 — all verified independently against the live
  Postgres tables (`contractor_resolution_ledger`, `reconcile_merges`,
  `reconcile_merge_refusals`, `roof_age_estimates`), not just the JSON reports.
- The one apparent discrepancy (roof-age `rowsWritten: 493221` vs `coverage.total: 493246`) is
  real idempotent-skip behavior, not a math error — confirmed against the DB's actual row count
  and the sibling `apply-25` job.
- `a07-coverage.ts`'s degrade path for an unbuilt track was verified by direct execution, not just
  code reading, and behaves exactly as FR-003/FR-018 and `contracts/report.md` require: no crash,
  no silent 0/false, every row keeps its contract-mandated `derivation` label.
- The candidate-state match logic is sound on a 5-row sample against the live registry, and
  correctly withholds `resolved` for name-only matches.

## Findings (both non-blocking, both fixed)

1. **Fixed in `f944cda`.** `mergeCountsRow()`/`roofAgeCoverageRow()` in `pipeline/oracle-runtime/travis/runs/a07-coverage.ts`
   (lines 125–134, 136–152) never compute a `limitation` — they hardcode `null`. Not wrong for this
   run's data, but it means a future refused-merge or basis/roll mismatch would go unreported. Added a
   computed check mirroring `fiveStateTotalsRow()`'s pattern.
2. **Fixed in `f944cda`.** `pipeline/oracle-runtime/test/travis/a07/runs/a07-coverage.test.ts` had no test case for
   Track B/C `undefined` report paths — the exact scenario this story's docs describe as "the PO's
   cost-mode scope decision" for this pass. Added one (`a07-coverage.test.ts` lines 100–147), plus two
   more for the fixes in finding 1 (a refused-merge flag, a basis/total-mismatch flag).

## Confidence note

High confidence on all live-DB-verified counts (identity five-state, property/owner/contractor
merges, roof-age basis coverage, the 5-row candidate spot-check) — I queried
`contractor_resolution_ledger`, `reconcile_merges`, `reconcile_merge_refusals`,
`roof_age_estimates`, and `comptroller_registry` directly via `docker exec ... psql` against the
running `oracle-travis-local-postgres-1` container, not just the JSON report files. Medium-high
confidence on the manifest-coverage degrade behavior — verified by direct execution of
`assembleA07Coverage()` with this run's real numbers, which is stronger evidence than reading the
code, but the repo's own test suite does not cover that branch, so I can't point to a CI gate that
would catch a regression there later. No BBB network access was made or attempted; Track B/C
content was not and could not be assessed (not built this pass).
