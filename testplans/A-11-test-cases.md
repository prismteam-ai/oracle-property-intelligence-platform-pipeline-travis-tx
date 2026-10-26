---
id: QC-TC-A-11
type: test-cases
title: Publish the full county by CID and keep it current with incremental runs
parent: FEAT-A11, FEAT-A12
story: stories/A-11-publish-and-runs.md
spec: specs/011-publish-and-runs/spec.md
owner: Claude (drafted) / user (QC Lead, approves)
status: Approved
gate: G6
version: 0.1
created: 2026-10-23
runtime_url: N/A — ui:false; "runtime" here is the public IPFS network (ipfs.io, dweb.link) plus AWS (`aws scheduler get-schedule`), per the G4/G6 exception recorded below
reviewed_code: 011-publish-and-runs @ HEAD
qc_signoff: true
---

# Test Cases: A-11 Publish the full county by CID and keep it current with incremental runs

> **Gate exception (G6 C-05/C-09, recorded once per the walkthrough's own gate-exception table):** this story has `ui: false` and no hosted-UI surface. Every case below starts from a terminal at the repo root on branch `011-publish-and-runs` instead of a hosted URL, and proves itself on the public IPFS network (two independent public gateways this environment does not operate) and in AWS, not via Playwright.

## 1. Feature overview

Publishes the full Travis County dataset as CIDv1-addressed CARs and tables with a verifiable manifest (Run 1), then runs two later incremental refreshes (Run 2, Run 3) that publish only what changed as new linked manifests, plus a CDK-defined scheduler that stays disabled throughout. Validates the durability promise: a stranger with only the manifest's CIDs can fetch and verify every byte.

## 2. Requirement mapping

| Source | Reference | Covered by |
| --- | --- | --- |
| Acceptance criterion | AC-1 | A-11-TC-001, A-11-TC-002 |
| Acceptance criterion | AC-2 | A-11-TC-003, A-11-TC-004 |
| Acceptance criterion | AC-3 | A-11-TC-005 |
| Acceptance criterion | AC-4 | A-11-TC-006 |
| Acceptance criterion | AC-5 | A-11-TC-007 |
| Acceptance criterion | AC-6 | A-11-TC-008, A-11-TC-009 |
| Acceptance criterion | AC-7 | A-11-TC-010 |
| Acceptance criterion | AC-8 | A-11-TC-011 |
| Acceptance criterion | AC-9 | A-11-TC-012 |
| Acceptance criterion | AC-10 | A-11-TC-013 |
| Acceptance criterion | AC-11 | A-11-TC-014, A-11-TC-015 |
| Acceptance criterion | AC-12 | A-11-TC-016, A-11-TC-017 |
| Functional requirement | FR-001–FR-011 | all of the above (1:1 with the AC each FR traces to, per spec.md) |
| NFR | NFR-001 (100% CIDv1, 6/6 CAR checks, 100% verified) | A-11-TC-NF-01 |
| NFR | NFR-002 (≥3 runs/≥3 dates, ≤7 days behind, re-load 0 rows) | A-11-TC-NF-02 |
| NFR | NFR-003 ($0 idle) | A-11-TC-NF-03 |

## 3. Assumptions

- Tests run against the real public gateways (ipfs.io, dweb.link) and the real Filebase/Pinata pins — never mocked, per constitution and P0-14.
- "Real denominators" are re-measured at run time from the capture receipts, not hard-coded: as of the A-01/A-04/A-07 evidence (2026-10-19/2026-10-22), TCAD certified roll 493,246 accounts, Austin permits 2,380,725–2,381,226 rows (watermark-dependent), Comptroller 342,334 Travis records, contractor ledger 22,084 rows. The Austin re-stamp fact (every row's `:updated_at` changed 2026-10-19 12:22–12:43 UTC) is historical context for the digest-delta design, not a condition re-created in these tests.
- Run 2 and Run 3 happen on later UTC dates than Run 1 (calendar waits, not test setup); cases for AC-7–AC-11 are written to run once those runs exist.

## 4. Scope

- **In scope:** the publication sequence and manifest (Run 1), gateway verification, durability copies, incremental deltas and run chain (Run 2/Run 3), idempotency, zero-delta handling, the disabled scheduler.
- **Out of scope:** the hosted Manifest/Verify/Runs/Compare UI (A-13, not built yet), Atlas registration (pending access, P0-4), enabling the schedule (never done in this story).

## 5. Test data

- TCAD certified roll: 493,246 accounts (capture 2026-10-19T21:33:41Z, re-verify against Run 1's actual `capture_receipt`).
- Austin permits: watermark-dependent, ~2,380,725–2,381,226 rows; re-stamp window 2026-10-19 12:22–12:43 UTC (historical, used to design the digest-delta test, not re-triggered).
- Contractor ledger: 22,084 Austin reroof permits (five-state: candidate 311, conflicting 78, unresolved 21,695, resolved 0 as of A-07's evidence; re-measure at Run 1 time).
- Data snapshot: Run 1's manifest CID (recorded once published, in `docs/evidence/A-11-manifest.md`); this test plan references `runs/{run1}/manifest.json`, `runs/{run2}/manifest.json`, `runs/{run3}/manifest.json` by run slot, not by a CID fixed in advance.

## 6. Environment, risks and dependencies

- No `RUNTIME_URL` (ui:false). Commands run from the repo root on `011-publish-and-runs`, with `~/.config/assessment/filebase.env` and `~/.config/assessment/pinata.env` loaded.
- Known gap: Atlas registration pending (P0-4) — not a defect, recorded in `docs/atlas-pr.md`.
- Risk: gateway 429s are expected and not a failure in themselves (A-11-TC-007); only a verification that doesn't retry/backoff correctly, or that reports success without both gateways matching, is a failure.

## 7. Coverage matrix

| TC ID | Title | Priority | Tags | Type | Requirement(s) | Automation |
| --- | --- | --- | --- | --- | --- | --- |
| A-11-TC-001 | Six-step sequence runs in fixed order, no step skipped | P1 | `@smoke @demo` | CLI | AC-1, FR-001 | Vitest `pipeline/publish/test/sequence.test.ts` |
| A-11-TC-002 | Upload readback failure stops the run before the manifest | P1 | `@negative` | CLI | AC-1, FR-001 | Vitest `pipeline/publish/test/sequence.test.ts` |
| A-11-TC-003 | Run 1 manifest validates with RunManifestV1 (CIDv1, carCid, previousManifestCid null) | P1 | `@smoke @demo` | CLI | AC-2, FR-002 | Vitest `pipeline/publish/test/manifest.test.ts` |
| A-11-TC-004 | A CIDv0 or a stored gateway URL is rejected; a directory without carCid is rejected | P2 | `@negative` | CLI | AC-2, FR-002 | Vitest `pipeline/publish/test/manifest.test.ts` |
| A-11-TC-005 | verify-manifest prints ALL ARTIFACTS VERIFIED on both real gateways | P1 | `@smoke @demo` | CLI, live | AC-3, FR-003, NFR-001 | manual + `scripts/verify-manifest.ts` run |
| A-11-TC-006 | Coverage section carries published_rows / capture_receipt / aggregate_match with derivation labels | P1 | `@demo` | CLI | AC-4, FR-004, XI | Vitest `pipeline/publish/test/manifest.test.ts` |
| A-11-TC-007 | A gateway 429/504/timeout is retried, marked unverified, exits non-zero | P2 | `@negative` | CLI, live | AC-5, FR-003 | manual + Vitest `scripts/test/verify-manifest.test.ts` |
| A-11-TC-008 | Every CAR is on a GitHub Release, Filebase, and Pinata | P1 | `@smoke @demo` | CLI, live | AC-6, FR-005 | manual (Stage 6 D-7/D-9 evidence) |
| A-11-TC-009 | A CAR over 2GB is split; an existing S3 CID-copy object is refused, compared instead | P2 | `@edge` | CLI | AC-6, FR-005 | Vitest `pipeline/publish/test/upload.test.ts` |
| A-11-TC-010 | Run 2's manifest records the Austin watermark, records read, and a digest-based delta | P1 | `@demo` | CLI, live | AC-7, FR-006 | Vitest `pipeline/publish/test/incremental.test.ts` + manual Run 2 evidence |
| A-11-TC-011 | Run 2's manifest CID differs, previousManifestCid = Run 1's, both in runs/index.json | P1 | `@demo` | CLI, live | AC-8, FR-007 | manual Run 2 evidence |
| A-11-TC-012 | After Run 3, Run 1 still verifies on both gateways; runs/index.json has ≥3 runs on ≥3 UTC dates | P1 | `@smoke @demo` | CLI, live | AC-9, FR-008, NFR-002 | manual immutability check (checks.md § 6.2) |
| A-11-TC-013 | A repeated run writes 0 rows and reproduces the same data-group CIDs | P1 | `@demo` | CLI | AC-10, FR-009, NFR-002 | Vitest `pipeline/publish/test/manifest.test.ts` |
| A-11-TC-014 | No newer TCAD supplemental export → {0,0,0} "no newer export", previous CID kept | P2 | `@negative @edge` | CLI | AC-11, FR-010 | Vitest `pipeline/publish/test/incremental.test.ts` |
| A-11-TC-015 | BBB harvest blocked by 403 → {0,0,0} "blocked · 403", previous CID kept, no retry | P2 | `@negative` | CLI, live | AC-11, FR-010 | Vitest + manual BBB evidence |
| A-11-TC-016 | cdk synth confirms the schedule is DISABLED, Fargate-targeted, no Query DB connection string, $0 idle | P1 | `@smoke @demo` | CDK | AC-12, FR-011, NFR-003 | Vitest `infra/test/scheduler.test.ts` |
| A-11-TC-017 | cdk synth with the schedule ENABLED fails the assertion | P2 | `@negative` | CDK | AC-12, FR-011 | Vitest `infra/test/scheduler.test.ts` |
| A-11-TC-NF-01 | 100% of artifacts CIDv1, 6/6 CAR checks, 100% verified on both gateways | P1 | `@perf` | CLI, live | NFR-001 | manual (Run 1 evidence) |
| A-11-TC-NF-02 | ≥3 runs/≥3 UTC dates; permits ≤7 days behind source at demo time; re-load writes 0 rows | P1 | `@perf` | CLI, live | NFR-002 | manual (Run 3 evidence) |
| A-11-TC-NF-03 | Scheduler costs $0 while disabled (no always-on resource) | P1 | `@perf` | CDK | NFR-003 | Vitest `infra/test/scheduler.test.ts` |

## 8. Functional test cases

### A-11-TC-001: Six-step sequence runs in fixed order (happy path)

- **Priority / tags:** P1 · `@smoke @demo`
- **Maps to:** AC-1, FR-001 · demo line D-5
- **Preconditions:** local Restate + Postgres stack up; reconciled data groups from A-04/A-07 present.
- **Test data:** the `county` data group (493,246 TCAD parcels, re-measured at run time).
- **Steps:**
  1. **Run** `validate pipeline/data/travis/county` → exits 0, no lexicon errors.
  2. **Run** `hash pipeline/data/travis/county --output-car travis-county.car ...` → prints the CAR root CID.
  3. **Run** `validate travis-county.car` → prints 6/6 CAR checks passed.
  4. **Run** `export-tables travis-county.car --part-size 48m --atlas-page travis --county travis --state TX --fips 48453 ...` → prints the tables directory CID and part count.
  5. **Run** `upload travis-county.car --api https://rpc.filebase.io` → prints the readback-confirmed CID.
  6. **Run** `upload {tables-dir} --api https://rpc.filebase.io` → prints the readback-confirmed CID.
- **Expected result:** all 6 steps complete in order with matching CIDs at each boundary; a test (`sequence.test.ts`) asserts the step order was never reordered or skipped.

### A-11-TC-002: Upload readback failure stops the run before the manifest (negative)

- **Priority / tags:** P1 · `@negative`
- **Maps to:** AC-1, FR-001
- **Steps:**
  1. **Simulate** a readback mismatch on the `upload` step for one group (test harness forces a hash mismatch response).
  2. **Verify** the run halts immediately after that step.
  3. **Verify** `runs/{runId}/manifest.json` is **not** written.
- **Expected result:** no manifest file exists for the failed attempt; the failure is logged (not silently swallowed); the next invocation starts the group over, not from a partial manifest.

### A-11-TC-003: Run 1 manifest validates with RunManifestV1 (happy path)

- **Priority / tags:** P1 · `@smoke @demo`
- **Maps to:** AC-2, FR-002 · demo line D-5
- **Steps:**
  1. **Run** `npx tsx -e "import {RunManifestV1} from './packages/contract'; RunManifestV1.parse(require('./runs/{run1}/manifest.json'))"` (or the equivalent Vitest assertion).
  2. **Verify** every artifact has a CIDv1 (`^b[a-z2-7]{50,}$`), a `name`, a `codec` (`file`/`directory`), a `size`, and a `sha256`.
  3. **Verify** every directory entry has its own `carCid`.
  4. **Verify** no field in the manifest contains a gateway URL string.
  5. **Verify** `previousManifestCid` is `null`.
- **Expected result:** schema validation passes with zero errors; manual grep for `http` in the manifest returns no matches.

### A-11-TC-004: A CIDv0 or stored gateway URL is rejected (negative)

- **Priority / tags:** P2 · `@negative`
- **Maps to:** AC-2, FR-002
- **Steps:**
  1. **Construct** a manifest fixture with one artifact CID rewritten to CIDv0 form (`Qm...`).
  2. **Validate** it with `RunManifestV1`.
  3. **Repeat** with a fixture containing a `gatewayUrl` field on one artifact.
  4. **Repeat** with a fixture where one directory entry is missing `carCid`.
- **Expected result:** all three fixtures fail schema validation with a specific error naming the offending field; none is silently accepted.

### A-11-TC-005: verify-manifest prints ALL ARTIFACTS VERIFIED (happy path, live)

- **Priority / tags:** P1 · `@smoke @demo`
- **Maps to:** AC-3, FR-003, NFR-001 · demo line D-6
- **Steps:**
  1. **Run** `npx tsx scripts/verify-manifest.ts runs/{run1}/manifest.json`.
  2. **Verify** every file artifact is fetched from `https://ipfs.io` **and** `https://dweb.link`.
  3. **Verify** every size and SHA-256 matches on both gateways.
- **Expected result:** prints `ALL ARTIFACTS VERIFIED`, exit code 0. Evidence saved to `docs/evidence/A-11-gateways.md` with the full CLI output.

### A-11-TC-006: Coverage section carries labelled counts (happy path)

- **Priority / tags:** P1 · `@demo`
- **Maps to:** AC-4, FR-004, XI
- **Steps:**
  1. **Open** `runs/{run1}/manifest.json`, read `coverage`.
  2. **Verify** `published_rows` has an entry per table with a row count.
  3. **Verify** `capture_receipt` has an entry per source (Austin permits, TCAD roll, Comptroller) with its capture-time total.
  4. **Verify** `aggregate_match` has the merge/contractor-state totals.
  5. **Verify** no count field can be traced to a live Query DB read (grep the manifest-builder source for any DB client usage in this path — none expected).
- **Expected result:** every count is present with its `derivation` label; e.g. `capture_receipt.tcad_roll = 493246, derivation: "capture_receipt"`.

### A-11-TC-007: Gateway rate-limit/timeout is retried and marked unverified (negative, live)

- **Priority / tags:** P2 · `@negative`
- **Maps to:** AC-5, FR-003
- **Steps:**
  1. **Run** `verify-manifest` against a manifest referencing an artifact whose CID is deliberately wrong (simulating a miss) or during a known high-429 window.
  2. **Verify** the script retries with backoff (honours `Retry-After`, up to 5 attempts).
  3. **Verify** the artifact is marked `unverified` in the output, with the gateway's response recorded.
  4. **Verify** the script exits non-zero and never prints `ALL ARTIFACTS VERIFIED`.
- **Expected result:** exact failure line naming the artifact and gateway response; no false "verified" claim.

### A-11-TC-008: Three durable copies exist (happy path, live)

- **Priority / tags:** P1 · `@smoke @demo`
- **Maps to:** AC-6, FR-005 · demo line D-5
- **Steps:**
  1. **Check** the GitHub Release on the fork for Run 1's tag; verify every CAR is attached as an asset.
  2. **Check** Filebase pin status for each CAR CID.
  3. **Check** Pinata pin status for each CAR CID.
- **Expected result:** all three copies confirmed; release URL recorded in `docs/evidence/A-11-manifest.md`.

### A-11-TC-009: Oversized CAR is split; existing S3 object is refused not overwritten (edge)

- **Priority / tags:** P2 · `@edge`
- **Maps to:** AC-6, FR-005
- **Steps:**
  1. **Simulate** a CAR fixture over 2GB (or unit-test the split-threshold logic directly).
  2. **Verify** the release step splits it into ≤2GB parts.
  3. **Simulate** an S3 CID-copy upload where the destination key already exists with matching size+SHA-256.
  4. **Verify** the uploader refuses to overwrite and instead confirms the match.
- **Expected result**: split parts each ≤2GB; the existing-object case logs "already present, verified match", no write performed.

### A-11-TC-010: Run 2's manifest records watermark, records read, and digest-based delta (happy path, live)

- **Priority / tags:** P1 · `@demo`
- **Maps to:** AC-7, FR-006 · demo line D-7
- **Preconditions:** Run 1 published; today's UTC date is later than Run 1's `finishedAt` date.
- **Steps:**
  1. **Run** the incremental runner for Austin permits.
  2. **Verify** `runs/{run2}/manifest.json`'s `sources[]` entry for `austin_permits` shows the watermark used and `records` read.
  3. **Verify** `delta.added`/`changed`/`removed` were computed by comparing content digests, not `:updated_at` alone.
  4. **Verify** only rows whose digest differs from the last-loaded digest were written.
- **Expected result:** delta counts are non-trivial but well under the full dataset size (a delta near 100% would indicate the re-stamp wasn't caught — that's A-11-TC-010a, a stop condition, not a pass).

### A-11-TC-011: Run chain links correctly (happy path, live)

- **Priority / tags:** P1 · `@demo`
- **Maps to:** AC-8, FR-007 · demo line D-7
- **Steps:**
  1. **Compare** Run 1's and Run 2's manifest CIDs — must differ.
  2. **Verify** Run 2's `previousManifestCid` equals Run 1's manifest CID.
  3. **Verify** both runs appear in `runs/index.json`.
  4. **Verify** every changed group in Run 2 has a new CID with its own CAR; unchanged groups are absent from Run 2's `groups[]` (per research.md).
- **Expected result:** chain is unbroken and every new CID is genuinely new (no collision with Run 1's).

### A-11-TC-012: Run 1 still verifies after Run 3; ≥3 runs on ≥3 UTC dates (happy path, live)

- **Priority / tags:** P1 · `@smoke @demo`
- **Maps to:** AC-9, FR-008, NFR-002 · demo line D-7
- **Preconditions:** Run 3 published, on a third distinct UTC date.
- **Steps:**
  1. **Run** `npx tsx scripts/verify-manifest.ts runs/{run1}/manifest.json` again, after Run 3.
  2. **Verify** it still prints `ALL ARTIFACTS VERIFIED` against both gateways.
  3. **Open** `runs/index.json`; verify ≥3 entries with distinct manifest CIDs and ≥3 distinct UTC dates (from `finishedAt`).
- **Expected result:** full immutability check (checks.md § 6.2) passes; evidence in `docs/evidence/A-11-immutability.md`.

### A-11-TC-013: Repeated run is idempotent (happy path)

- **Priority / tags:** P1 · `@demo`
- **Maps to:** AC-10, FR-009, NFR-002
- **Steps:**
  1. **Run** the incremental runner a second time with no new upstream data since the last run.
  2. **Verify** 0 rows are written.
  3. **Verify** the **data-group** CAR/table CIDs produced are identical to the previous run's (not the manifest CID — see research.md: the manifest legitimately differs by `startedAt`/`finishedAt`).
  4. **Verify** this proof is recorded in `docs/evidence/A-11-runs.md`, and is **not** added as a new entry in `runs/index.json` (per D-2(b)).
- **Expected result:** `rowsWritten: 0`; identical data CIDs; no new run-history entry.

### A-11-TC-014: No newer TCAD supplemental export (negative/edge)

- **Priority / tags:** P2 · `@negative @edge`
- **Maps to:** AC-11, FR-010
- **Steps:**
  1. **Check** the TCAD supplemental export page at Run 2/3 time for a newer export than Run 1's recorded date.
  2. **If none newer:** run the incremental runner anyway.
  3. **Verify** that source's delta is `{0,0,0}` with `limitations: ["no newer export"]`.
  4. **Verify** the `county`/TCAD group keeps its previous CID — no new, empty CID is published.
- **Expected result:** exact limitation string recorded; no silent omission, no empty new CID.

### A-11-TC-015: BBB harvest blocked by 403 (negative)

- **Priority / tags:** P2 · `@negative`
- **Maps to:** AC-11, FR-010
- **Steps:**
  1. **Attempt** the BBB refresh for Run 3.
  2. **On a 403/challenge:** verify the harvest stops immediately (no retry with another identity or network, per P0-7).
  3. **Verify** the source's delta is `{0,0,0}` with `limitations: ["blocked · 403"]`.
  4. **Verify** the contractor group keeps its previous CID.
- **Expected result:** exact "blocked · 403" string; evidence receipt saved (same pattern as `docs/evidence/blocked/bbb-*.md`).

### A-11-TC-016: cdk synth confirms the schedule is DISABLED (happy path)

- **Priority / tags:** P1 · `@smoke @demo`
- **Maps to:** AC-12, FR-011, NFR-003 · demo line D-2
- **Steps:**
  1. **Run** `cd infra && npx cdk synth`.
  2. **Run** the Vitest CDK-assertion suite (`infra/test/scheduler.test.ts`).
  3. **Verify** `AWS::Scheduler::Schedule` has `State: "DISABLED"`.
  4. **Verify** the target references the Fargate `TaskDefinition` logical id.
  5. **Grep** `apps/` and `infra/` source for any Postgres connection-string literal — none found.
  6. **Verify** no `AWS::ECS::Service` exists in the synthesized template (no always-on resource).
- **Expected result:** all assertions pass; synth succeeds with no errors.

### A-11-TC-017: cdk synth with the schedule ENABLED fails the assertion (negative)

- **Priority / tags:** P2 · `@negative`
- **Maps to:** AC-12, FR-011
- **Steps:**
  1. **Modify** a test fixture to set `state: "ENABLED"`.
  2. **Run** the CDK-assertion suite against that fixture.
- **Expected result:** the assertion fails, proving the test actually checks the state rather than always passing.

## 9. Edge cases

- A table part exceeds a single gateway response's size limit → ranged fetch, streamed hash, still matches (covered implicitly by A-11-TC-005 at full scale; add a dedicated fixture test for parts >50MB per NFR-06).
- dweb.link redirects to a subdomain gateway URL → followed; bytes still match (covered by A-11-TC-005/A-11-TC-007's live run).
- A record present in a previous run but absent from a later capture → `source_removed` tombstone, counted in `removed` (dedicated unit test in `pipeline/publish/test/incremental.test.ts`, not separately listed above — covered by T020 in tasks.md).
- Run 3 lands less than 24 hours after Run 2 but on a different UTC date → still valid (covered by A-11-TC-012's date-distinctness check).

- Contractor name and BBB search link (FR-012, ERR-66; Run 3 correction): unit-tested in `pipeline/oracle-runtime/test/travis/permits/bbb-search-url.test.ts` (clerk-marker stripping, placeholders N/A, OWNER, SELF give no name, URL encoding of ampersands, plus signs, quotes and unicode, long names), `test/travis/permits/write-group.test.ts` and `test/transforms/austin-property-improvement.test.ts` (company file, `property_improvement_has_contractor` edge and root key; no person, phone, address, city or registry id; person-only permit publishes nothing), `packages/query-core/test/derive.test.ts` (SQL macro `bbb_search_url` equals the TypeScript builder; a printed name never resolves) and `views.fixture.test.ts` (DuckDB: printed company unresolved with `bbb_status = blocked` and a link, registry id resolved, no name gives no link with `contractor_unresolved` and `source_missing`). Still to add after the Run 3 publish: a Playwright case that the Permits drawer shows "Search BBB for this contractor" and "BBB rating not published (BBB blocked the lookup)", and a manual check that a human clicked one example link (the URL shape is unverified).

## 10. Gap-linked cases (expected to fail until fixed)

| TC ID | Asserts | Gap | Defect |
| --- | --- | --- | --- |
| — | — | none identified yet | — |

## 11. Execution log (filled in Phase 5)

| TC ID | Run date | Build (sha) | Result | Evidence | Defect |
| --- | --- | --- | --- | --- | --- |
| (all) | — | — | Not yet run | — | — |

---

## Gate G6: Test Case Approval

| # | Criterion | Status |
| --- | --- | --- |
| G6-1 | Every AC and every FR maps to at least one TC (§ 2 and § 7) | ☑ |
| G6-2 | Happy, negative, edge and missing-data paths covered | ☑ |
| G6-3 | NFRs have test cases with measurable pass criteria | ☑ |
| G6-4 | Every case is a complete sequence starting from the hosted URL | ☑ **exception recorded**: starts from a terminal at repo root instead, `ui: false` |
| G6-5 | Negative cases state the exact message or rejection behavior | ☑ |
| G6-6 | Test data and environment documented, with real records | ☑ |
| G6-7 | Every TC traces to the story and a requirement | ☑ |
| G6-8 | AI pre-check (`developmentsupport-g6-precheck`): PASS | pending |

**Decision:** ☑ Approved · 2026-10-23 (exceptions C-05/C-09 recorded, matching G4's C-04)
