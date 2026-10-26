---
id: A-12
type: user-story
title: Run incremental refreshes and keep run history
parent: FEAT-A12
vision: VIS-A
ard: ARD-A
eval_point: A3
priority: P1
moscow: Must
branch: 012-incremental-runs
spec: specs/012-incremental-runs/
depends_on: [A-11]
size_days: 1.5
agents:
  design: [oracle, machamp]
  builder: [oracle, machamp]   # AGENT-MAP: oracle (runs), machamp (scheduler)
  reviewers: [oracle, machamp, porygon]
  verify: "immutability check"
skills: [use-oracle, build-batch-workflows, durable-workflow-builder, monitoring-oracle-ingestion, unify-metrics, apply-engineering-guidelines]
ui: false
status: Merged
merged_into: A-11
merged_on: 2026-10-21
gate: G4
qc_testability_signoff: false
created: 2026-10-19
---

# A-12 Run incremental refreshes and keep run history

> **Merged on 2026-10-21 into [A-11 Publish the full county by CID and keep it current with incremental runs](../A-11-publish-and-runs.md).** Kept for history only: do not plan, build or gate this file. Its ACs are now AC-7 to AC-12 there, each tagged with its old ID.

| Field | Value |
| --- | --- |
| Evaluation point | A3 (primary) · A4 |
| Demo line(s) | D-7 (new CID, old CID intact), D-2 (run history) |
| Agents | design `oracle`, `machamp` · builder `oracle` (runs), `machamp` (scheduler) · reviewers `oracle`, `machamp`, `porygon` · verify immutability check (source: [AGENT-MAP.md](../../assessment-guide/AGENT-MAP.md) § 4) |
| Depends on | A-11 |
| Size | 1.5 days (Run 2 and Run 3 on different days) |
| Branch | `012-incremental-runs`, merged into `feature/oracle-pipeline` |

## Context

The README requires ongoing, incremental ingestion with visible run history (AC-14 to AC-16) and new CIDs on republish without mutating old ones (AC-31, D-7). The **Oracle operator** needs runs that pick up only what changed; the **evaluator** checks that Run 2 and Run 3 are windowed and that Run 1's CIDs still resolve.

Fact (live 2026-10-19): the City of Austin re-stamped **every** row's `:updated_at` (2,380,725 rows, 12:22–12:43 UTC), so a `:updated_at` window alone can return the full dataset. The delta must come from content digests (A-06 AC-5).

## Description

As the **Oracle operator**, I want **Run 2 and Run 3 on later days to load only new and changed records and publish them as new immutable snapshots linked to the previous run**, so that **the data stays current and every past snapshot stays fetchable**.

When done: each run reads per-source watermarks (Socrata `:updated_at` plus content digest, TCAD supplemental export date, BBB harvest date) with `(path, artifact hash)` watermarks so corrected files reload; loads are idempotent and single-writer; tombstones remove stale rows. Each run publishes new CIDs for changed groups, a manifest whose `previousManifestCid` links back, and a new entry in `runs/index.json`. Run 2 covers Austin permits since Run 1's watermark and the TCAD supplemental export if newer; Run 3 covers the next window plus a BBB refresh. `machamp` adds the CDK EventBridge Scheduler, created **DISABLED**, targeting a Fargate task running the kit AWS batch mode end to end (AD-15, AD-26).

**Overrides applied (ARD § 15, AD-30):** no IPNS re-pointing. The new manifest links `previousManifestCid`, and `runs/index.json` gets the new run (AD-03).

**Independent test:** the immutability check (`checks.md` § 6.2): `runs/index.json` has ≥ 3 runs with distinct manifest CIDs, each manifest links the one before, and `verify-manifest runs/{run1}/manifest.json` still passes after Run 3.

## Acceptance Criteria

1. **AC-1** · **Given** Run 1's Austin watermark, **When** Run 2 runs on a later day, **Then** its manifest `sources[]` entry for Austin permits shows the watermark used, records read, and `delta {added, changed, removed}` computed from content digests, and only changed rows are written. ☐ testable
2. **AC-2** · **Given** Run 2 published, **When** the run chain is read, **Then** Run 2's manifest CID differs from Run 1's, `previousManifestCid` equals Run 1's manifest CID, both are in `runs/index.json`, and every changed directory has a new CID with its own CAR. ☐ testable
3. **AC-3** (scale) · **Given** Run 3 has finished, **When** `verify-manifest` runs on Run 1's manifest, **Then** every Run 1 artifact still fetches from ipfs.io and dweb.link with matching size and SHA-256, and `runs/index.json` lists ≥ 3 runs on ≥ 3 different days. ☐ testable
4. **AC-4** · **Given** the same inputs, **When** a run is repeated, **Then** it writes 0 rows and produces the same CIDs (idempotency). ☐ testable
5. **AC-5** (missing data) · **Given** a source with no change in the window (for example no newer TCAD supplemental export, or a BBB refresh blocked by 403), **When** the run finishes, **Then** that source's delta is `{0, 0, 0}` with the reason ("no newer export", "blocked · 403") in `limitations`, and its group keeps the previous CID instead of a new empty one. ☐ testable
6. **AC-6** · **Given** the CDK app, **When** `cdk synth` runs, **Then** a CDK assertion confirms the EventBridge schedule state is `DISABLED`, the target is the Fargate batch task, there is no Query DB connection string in `apps/` or `infra/`, and the scheduler costs $0 while disabled. ☐ testable

## Edge cases (at least two)

- Austin re-stamps every `:updated_at` again → re-stamp detected; delta from digests; limitation recorded (A-06 AC-5).
- A source row is deleted upstream → `source_removed` tombstone; counted in `removed`.
- A run fails mid-publish → no manifest is written; the next run starts from the last committed watermark; the failed attempt is logged, not listed as a run.
- Run 3 lands less than a day after Run 2 → still valid if the window is non-empty; the "different days" check uses UTC dates.

## Requirements

| REQ | Requirement | Traces to |
| --- | --- | --- |
| FR-001 | System MUST window each run from per-source watermarks and digests | AC-1 |
| FR-002 | System MUST publish new immutable CIDs and link the run chain | AC-2 |
| FR-003 | System MUST keep every previous CID fetchable | AC-3 |
| FR-004 | System MUST be idempotent | AC-4 |
| FR-005 | System MUST record zero deltas with reasons | AC-5 |
| FR-006 | System MUST define the scheduler in CDK, disabled by default | AC-6 |
| NFR-001 | ≥ 3 runs on ≥ 3 days; permits ≤ 7 days behind source at demo time; re-load writes 0 rows | AC-3, AC-4 |
| NFR-002 | $0 idle cost: scheduler `DISABLED` (NFR-02) | AC-6 |

## Prototype reference

Not a UI story. Run history and the compare view are `design/prototype/Runs1440.dc.html`, `design/prototype/RunsCompare1440.dc.html` and `design/prototype/RunChain.dc.html` (built in A-13).

## Demo Script

1. Presenter: "Show that a later incremental publish produced a new CID without mutating the previous one." → Expected: Run 3 vs Run 2: distinct manifest CIDs linked by `previousManifestCid`, both in run history, the old manifest still resolves on ipfs.io and dweb.link, CAR available; IPNS not used (AD-03).

## Out of scope

- Enabling the schedule (a consumer opts in to paying).
- Admin start/stop buttons (AD-12, built last).

## Evidence to capture

- `docs/evidence/A-12-runs.md`: the three runs with timestamps, sources, deltas, limitations.
- `docs/evidence/A-12-immutability.md`: immutability check output after Run 3.
- `testplans/A-12-test-cases.md` results, `docs/reviews/CR-A-12.md`.

---

## Gate G4: Story ready for planning

| # | Criterion | Status |
| --- | --- | --- |
| G4-1 | Front matter complete (parent FEAT, eval point, branch, priority, **agents and skills from AGENT-MAP.md**) | ☐ |
| G4-2 | "As a / I want / So that" stated, with an independent test | ☐ |
| G4-3 | Every AC is Given / When / Then, and its testable box is ticked | ☐ |
| G4-4 | One scale AC and one missing-data or error AC | ☐ |
| G4-5 | At least two edge cases | ☐ |
| G4-6 | Every requirement traces to an AC; NFRs have thresholds | ☐ |
| G4-7 | Prototype screen linked (UI stories) | ☐ |
| G4-8 | Dependencies done, or stubbed with **real** sample data | ☐ |
| G4-9 | No `[NEEDS CLARIFICATION]` left | ☐ |
| G4-10 | AI pre-check (`developmentsupport-g4-precheck`): PASS | ☐ |

**Decision:** ☐ Ready ☐ Returned, reason: {…} · {date}
