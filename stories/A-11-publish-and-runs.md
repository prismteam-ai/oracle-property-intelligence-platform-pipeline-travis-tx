---
id: A-11
type: user-story
title: Publish the full county by CID and keep it current with incremental runs
parts: [A-11, A-12]
parent: [FEAT-A11, FEAT-A12]
vision: VIS-A
ard: ARD-A
eval_point: A4
priority: P1
moscow: Must
branch: 011-publish-and-runs
spec: specs/011-publish-and-runs/
depends_on: [A-02, A-03, A-04, A-07]
size_days: 2.5
agents:
  design: [oracle, machamp]
  builder: [oracle, machamp]   # AGENT-MAP: oracle (runs, publication), machamp (scheduler)
  reviewers: [oracle, donphan, machamp, porygon]
  verify: "`verify-manifest` on 2 gateways (Run 1); immutability check after Run 3"
skills: [use-oracle, build-batch-workflows, durable-workflow-builder, monitoring-oracle-ingestion, unify-metrics, apply-engineering-guidelines]
ui: false
status: Done
gate: G4
qc_testability_signoff: true
created: 2026-10-19
merged: 2026-10-21
---

# A-11 Publish the full county by CID and keep it current with incremental runs

> **Merged story (2026-10-21).** This story combines two earlier stories: **A-11** (full-county publication, Run 1) and **A-12** (incremental runs and run history). The original files are in [stories/merged/](merged/). They are kept only as history; this file is the one to build from. Each AC below says which part it came from, e.g. "(was A-12 AC-3)".

| Field | Value |
| --- | --- |
| Evaluation point | A4 (primary) · A3 · A1 |
| Demo line(s) | D-5 (artifact manifest), D-6 (two independent gateways), D-7 (new CID, old CID intact), D-2 (run history) |
| Agents | design `oracle`, `machamp` · builder `oracle` (runs, publication), `machamp` (scheduler) · reviewers `oracle`, `donphan`, `machamp`, `porygon` · verify `verify-manifest` on 2 gateways (Run 1) and the immutability check after Run 3 (source: [AGENT-MAP.md](../../assessment-guide/AGENT-MAP.md) § 4) |
| Depends on | A-07 (merged: contractor identity, BBB, business and places, reconcile and roof age) |
| Size | 2.5 days, including calendar waits: Run 2 and Run 3 must land on later UTC dates than Run 1 |
| Branch | `011-publish-and-runs`, merged into `feature/oracle-pipeline` |

## Milestones inside this story

| # | Milestone | Came from | Done when |
| --- | --- | --- | --- |
| M1 | **Run 1**: full county published and verified | A-11 | `verify-manifest runs/{run1}/manifest.json` prints `ALL ARTIFACTS VERIFIED` on ipfs.io and dweb.link |
| M2 | **Run 2**: first windowed refresh, on a later UTC date | A-12 | new manifest CID, `previousManifestCid` = Run 1's |
| M3 | **Run 3**: second windowed refresh, on a third UTC date, plus a BBB refresh | A-12 | immutability check passes: ≥ 3 runs, ≥ 3 UTC dates, Run 1 still verifies |

Run 2 and Run 3 are calendar waits, not work. They run unattended while other work (scheduler CDK, tests, reviews, or another story's session) carries on.

## Context

The README's durability rule is that CIDs, not URLs, are the data's identity, and that a **third party with only the CIDs** can fetch everything after the candidate's environment is gone (AC-26 to AC-34). The **evaluator** opens the manifest and fetches an artifact from two public gateways this environment does not operate.

The README also requires ongoing, incremental ingestion with visible run history (AC-14 to AC-16) and new CIDs on republish without mutating old ones (AC-31, D-7). The **Oracle operator** needs runs that pick up only what changed. The **evaluator** checks that Run 2 and Run 3 are windowed and that Run 1's CIDs still resolve.

Fact (live 2026-10-19): the City of Austin re-stamped **every** row's `:updated_at` (2,380,725 rows, 12:22–12:43 UTC), so a `:updated_at` window alone can return the full dataset. The delta must come from content digests (part A-06 AC-5, now in story A-04).

## Description

As an **independent retriever and the Oracle operator**, I want **every Run 1 artifact for Travis County published as CIDv1 with a manifest and CARs, and Run 2 and Run 3 on later days to load only new and changed records and publish them as new immutable snapshots linked to the previous run**, so that **anyone can fetch and check the exact bytes without depending on Oracle, Filebase or the candidate's laptop, the data stays current, and every past snapshot stays fetchable**.

When done:

- **Publication (Run 1, from A-11).** Every data group goes through the fixed sequence validate → hash → validate CAR → `export-tables --atlas-page` → upload CAR → upload tables with readback (P0-2). `runs/{runId}/manifest.json` (`oracle-travis-run-manifest.v1`) and `runs/index.json` are committed and uploaded. CARs are attached to a GitHub Release (≤ 2 GB per asset) and pinned on Filebase plus a second independent pin (AD-22). The CID-copy uploader writes the S3 + CloudFront copy only after a size + SHA-256 match (AD-02).
- **Incremental runs (Run 2 and Run 3, from A-12).** Each run reads per-source watermarks (Socrata `:updated_at` plus content digest, TCAD supplemental export date, BBB harvest date) with `(path, artifact hash)` watermarks so corrected files reload. Loads are idempotent and single-writer, and tombstones remove stale rows. Each run publishes new CIDs for changed groups, a manifest whose `previousManifestCid` links back, and a new entry in `runs/index.json`. Run 2 covers Austin permits since Run 1's watermark and the TCAD supplemental export if newer. Run 3 covers the next window plus a BBB refresh.
- **Scheduler (from A-12).** `machamp` adds the CDK EventBridge Scheduler, created **DISABLED**, targeting a Fargate task running the kit AWS batch mode end to end (AD-15, AD-26).

**Overrides applied (ARD § 15, AD-30):** no `coverage.json`, `merge_stats.json` or sample extracts. Counts go in the manifest `coverage` section with `derivation` labels (AD-04, AD-28). The manifest lists only elephant-cli artifacts (CARs, table parts, the tables directory with its CAR) (AD-01). No IPNS field and no IPNS re-pointing: each new manifest links `previousManifestCid`, and `runs/index.json` gets the new run (AD-03). Atlas: if access exists, open the Atlas PR; otherwise `docs/atlas-pr.md` records it as a known gap ("public by CID; Atlas registration pending", P0-4).

**Independent test:**
1. After Run 1: `npx tsx scripts/verify-manifest.ts runs/{runId}/manifest.json` prints `ALL ARTIFACTS VERIFIED`.
2. After Run 3: the immutability check (`checks.md` § 6.2). `runs/index.json` has ≥ 3 runs with distinct manifest CIDs, each manifest links the one before, and `verify-manifest runs/{run1}/manifest.json` still passes.

## Acceptance Criteria

**Publication and Run 1 (part A-11)**

1. **AC-1** (was A-11 AC-1) · **Given** the reconciled Travis County data groups from A-04 and A-07 (originally parts A-04 to A-10), **When** publication runs, **Then** each group passes the six steps in order (a test asserts the order and that no step is skipped), and the run fails before writing the manifest if any upload readback fails. ☐ testable
2. **AC-2** (was A-11 AC-2) · **Given** the Run 1 manifest, **When** it is validated with `RunManifestV1`, **Then** every artifact has a CIDv1 (`bafy…`), name, codec (`file` or `directory`), size and SHA-256, every directory has a `carCid`, no gateway URL is stored, and `previousManifestCid` is null for Run 1. ☐ testable
3. **AC-3** (scale; was A-11 AC-3) · **Given** the full-county manifest, **When** `verify-manifest` fetches every file artifact from ipfs.io **and** dweb.link, **Then** every size and SHA-256 matches, the script exits 0 and prints `ALL ARTIFACTS VERIFIED`; artifacts over 50 MB are verified by the CLI (NFR-06). ☐ testable
4. **AC-4** (was A-11 AC-4) · **Given** the manifest `coverage` section, **When** it is read, **Then** it contains the published row count per table (`published_rows`), each source's capture-time total (`capture_receipt`: for example Austin permits and Comptroller Travis records at their watermarks, and the TCAD certified roll count), and merge and contractor-state aggregates (`aggregate_match`), and no count is computed from Query DB rows directly. ☐ testable
5. **AC-5** (missing data / error; was A-11 AC-5) · **Given** a gateway that returns 429, 504 or times out, **When** `verify-manifest` runs, **Then** it retries with backoff, reports that artifact as `unverified` with the gateway's response, exits non-zero, and never reports `ALL ARTIFACTS VERIFIED` without a digest match on both gateways. ☐ testable
6. **AC-6** (was A-11 AC-6) · **Given** the CARs, **When** the release step runs, **Then** each CAR is attached to a GitHub Release (or split if over 2 GB), pinned on Filebase and on the second pin, and the release URL is recorded in `docs/evidence/A-11-manifest.md`. ☐ testable

**Incremental runs, run history and scheduler (part A-12)**

7. **AC-7** (was A-12 AC-1) · **Given** Run 1's Austin watermark, **When** Run 2 runs on a later day, **Then** its manifest `sources[]` entry for Austin permits shows the watermark used, records read, and `delta {added, changed, removed}` computed from content digests, and only changed rows are written. ☐ testable
8. **AC-8** (was A-12 AC-2) · **Given** Run 2 published, **When** the run chain is read, **Then** Run 2's manifest CID differs from Run 1's, `previousManifestCid` equals Run 1's manifest CID, both are in `runs/index.json`, and every changed directory has a new CID with its own CAR. ☐ testable
9. **AC-9** (scale; was A-12 AC-3) · **Given** Run 3 has finished, **When** `verify-manifest` runs on Run 1's manifest, **Then** every Run 1 artifact still fetches from ipfs.io and dweb.link with matching size and SHA-256, and `runs/index.json` lists ≥ 3 runs on ≥ 3 different UTC dates. ☐ testable
10. **AC-10** (was A-12 AC-4) · **Given** the same inputs, **When** a run is repeated, **Then** it writes 0 rows and produces the same CIDs (idempotency). ☐ testable
11. **AC-11** (missing data; was A-12 AC-5) · **Given** a source with no change in the window (for example no newer TCAD supplemental export, or a BBB refresh blocked by 403), **When** the run finishes, **Then** that source's delta is `{0, 0, 0}` with the reason ("no newer export", "blocked · 403") in `limitations`, and its group keeps the previous CID instead of a new empty one. ☐ testable
12. **AC-12** (was A-12 AC-6) · **Given** the CDK app, **When** `cdk synth` runs, **Then** a CDK assertion confirms the EventBridge schedule state is `DISABLED`, the target is the Fargate batch task, there is no Query DB connection string in `apps/` or `infra/`, and the scheduler costs $0 while disabled. ☐ testable

## Edge cases (at least two)

From A-11 (publication):
- A table part over the gateway's single-response limit → the CLI does a ranged fetch and hashes the stream.
- dweb.link redirects to a subdomain gateway URL → follow the redirect; the bytes still match.
- Filebase plan too small for the measured size (RISK-02) → Starter plan for a month or a kubo node; recorded in the manifest limitations, run not published half-pinned.
- An artifact's CID copy already exists in S3 → uploader refuses to overwrite; checks it matches instead.

From A-12 (incremental runs):
- Austin re-stamps every `:updated_at` again → re-stamp detected; delta from digests; limitation recorded (part A-06 AC-5, now in story A-04).
- A source row is deleted upstream → `source_removed` tombstone; counted in `removed`.
- A run fails mid-publish → no manifest is written; the next run starts from the last committed watermark; the failed attempt is logged, not listed as a run.
- Run 3 lands less than a day after Run 2 → still valid if the window is non-empty; the "different days" check uses UTC dates.

## Requirements

| REQ | Requirement | Traces to |
| --- | --- | --- |
| FR-001 | System MUST publish only elephant-cli output in the fixed order with readback (was A-11 FR-001) | AC-1 |
| FR-002 | System MUST write a schema-valid manifest with CIDv1, size, codec, SHA-256 and CAR per directory (was A-11 FR-002) | AC-2 |
| FR-003 | System MUST verify every artifact on two independent public gateways (was A-11 FR-003) | AC-3, AC-5 |
| FR-004 | System MUST carry counts in the manifest coverage section with derivation labels (was A-11 FR-004) | AC-4 |
| FR-005 | System MUST keep three copies: Filebase, second pin, GitHub Release CARs (was A-11 FR-005) | AC-6 |
| FR-006 | System MUST window each run from per-source watermarks and digests (was A-12 FR-001) | AC-7 |
| FR-007 | System MUST publish new immutable CIDs and link the run chain (was A-12 FR-002) | AC-8 |
| FR-008 | System MUST keep every previous CID fetchable (was A-12 FR-003) | AC-9 |
| FR-009 | System MUST be idempotent (was A-12 FR-004) | AC-10 |
| FR-010 | System MUST record zero deltas with reasons (was A-12 FR-005) | AC-11 |
| FR-011 | System MUST define the scheduler in CDK, disabled by default (was A-12 FR-006) | AC-12 |
| NFR-001 | 100% CIDv1; 6/6 CAR checks; 100% artifacts verified on both gateways (NFR-06) (was A-11 NFR-001) | AC-2, AC-3 |
| NFR-002 | ≥ 3 runs on ≥ 3 UTC dates; permits ≤ 7 days behind source at demo time; re-load writes 0 rows (was A-12 NFR-001) | AC-9, AC-10 |
| NFR-003 | $0 idle cost: scheduler `DISABLED` (NFR-02) (was A-12 NFR-002) | AC-12 |

## Prototype reference

Not a UI story. The manifest and verify screens are `design/prototype/DataManifest1440.dc.html` and `design/prototype/DataVerify1440.dc.html`. Run history and the compare view are `design/prototype/Runs1440.dc.html`, `design/prototype/RunsCompare1440.dc.html` and `design/prototype/RunChain.dc.html`. All are built in A-13.

## Demo Script

1. Presenter: "Show the published artifact manifest for this run." → Expected: every artifact with CID, size, name, codec and SHA-256; gateway URLs derived from CIDs; no IPNS (AD-03).
2. Presenter: "Retrieve one published artifact by CID from a public gateway that this environment does not operate, then again from a second independent public gateway." → Expected: both fetches succeed and match the manifest size and digest; the CLI output is shown for larger artifacts.
3. Presenter: "Show that a later incremental publish produced a new CID without mutating the previous one." → Expected: Run 3 vs Run 2: distinct manifest CIDs linked by `previousManifestCid`, both in run history, the old manifest still resolves on ipfs.io and dweb.link, CAR available; IPNS not used (AD-03).

## Out of scope

- The hosted Manifest, Verify, Runs and Compare screens (A-13).
- Atlas merge (pending access).
- Enabling the schedule (a consumer opts in to paying).
- Admin start/stop buttons (AD-12, part A-17, now in story A-16).

## Evidence to capture

- `docs/evidence/A-11.md`: the story's evidence index, linking the four files below.
- `docs/evidence/A-11-manifest.md`: Run 1 manifest CID, artifact count and total size, release URL.
- `docs/evidence/A-11-gateways.md`: full `verify-manifest` output for Run 1.
- `docs/evidence/A-11-runs.md`: the three runs with timestamps, sources, deltas, limitations.
- `docs/evidence/A-11-immutability.md`: immutability check output after Run 3.
- `testplans/A-11-test-cases.md` results, `docs/reviews/CR-A-11.md`.

---

## Gate G4: Story ready for planning

| # | Criterion | Status |
| --- | --- | --- |
| G4-1 | Front matter complete (parent FEAT, eval point, branch, priority, **agents and skills from AGENT-MAP.md**) | ☑ |
| G4-2 | "As a / I want / So that" stated, with an independent test | ☑ |
| G4-3 | Every AC is Given / When / Then, and its testable box is ticked | ☑ |
| G4-4 | One scale AC and one missing-data or error AC | ☑ |
| G4-5 | At least two edge cases | ☑ |
| G4-6 | Every requirement traces to an AC; NFRs have thresholds | ☑ |
| G4-7 | Prototype screen linked (UI stories) | ☑ N/A, `ui: false` |
| G4-8 | Dependencies done, or stubbed with **real** sample data | ☑ A-02/A-03/A-04/A-07 all merged, status Done |
| G4-9 | No `[NEEDS CLARIFICATION]` left | ☑ |
| G4-10 | AI pre-check (`developmentsupport-g4-precheck`): PASS | ☑ with 2 recorded exceptions: C-04 (no hosted UI, `ui: false` — proof is public IPFS + AWS + PR) and C-11 (2.5-day size is calendar wait, not compressible work; AC-9 needs ≥3 UTC dates) — see `docs/gates/G4-A-11-precheck.md` |

**Decision:** ☑ Ready ☐ Returned, reason: {…} · 2026-10-23
