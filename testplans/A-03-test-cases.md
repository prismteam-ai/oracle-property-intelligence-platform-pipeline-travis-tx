---
id: QC-TC-A-03
type: test-cases
title: Publish one month of Austin roofing permits by CID and show them in the hosted UI
parent: FEAT-A03
story: stories/A-03-walking-skeleton.md
spec: specs/003-walking-skeleton/spec.md
owner: HebaGaber             # QC Lead
status: Approved             # Draft → In Review → Approved (PO 🛑 D-7, 2026-10-21 11:00)
gate: G6
version: v1.1
created: 2026-10-21
updated: 2026-10-21          # v1.0 PO decisions D-2 / D-4 / D-5; v1.1 requirements-quality review refinements (no AC meaning changed)
runtime_url: "RUNTIME_URL = the Amplify branch URL for 003-walking-skeleton, or https://countylens.aldarraj.com (never localhost)"
reviewed_code: "TBD (set when the build is deployed)"
qc_signoff: true             # G6 approved by the PO 2026-10-21 11:00, run-log.md ("Approve (Recommended)")
---

# Test Cases: A-03 Publish one month of Austin roofing permits by CID and show them in the hosted UI

> **v1.0, 2026-10-21** (checked against the final story incl. its PO amendments and the final spec). Drafted with `developmentsupport-testcases` from the G4-approved story's Given / When / Then ACs, edge cases, requirements and the PO decisions (D-1, then D-2 / D-4 / D-5 of 2026-10-21), **not** from `tasks.md`. FR numbers are the spec's (`specs/003-walking-skeleton/spec.md` FR-001 … FR-013, mapping re-checked against the final spec).
>
> Every case maps one-to-one to one automated test tagged `@scenario:A-03-TC-nnn` run by Playwright (`npx playwright test -g "A-03-TC-nnn"` with `RUNTIME_URL` set). Every case starts from `RUNTIME_URL`: UI cases open a page; published-data cases first open `{RUNTIME_URL}/runs` and take the manifest CID and `runId` from it; build-time cases (order, labels, CDK) first open `{RUNTIME_URL}/build.json` and run their Vitest/CDK suite at that deployed `sha` (the Playwright spec `build-checks.spec.ts` spawns it and asserts its result). Cases assert against the run's **manifest** at run time, never a hard-coded count.
>
> **v1.1, 2026-10-21** (after the PO's G6 approval, 🛑 D-7 11:00): refinements from the requirements-quality checklists (`specs/003-walking-skeleton/checklists/`), no AC meaning changed. TC-004 extended to `car` artifacts; TC-003 reads the two manifest `limitations` notes; TC-010 reads the CID from `data-cid` and checks the publication-state text; TC-012 names the `Permits published` label and the single page; TC-013 is now required by FR-002; TC-021/TC-022 read visible text; TC-023 excludes font hosts; TC-024 names the progress bar's accessible name and the skeleton rule; TC-025 drops the BBB step (BBB is A-08, not an AC-3 column); TC-031 asserts the derivation label; TC-040 compares the manifest bytes on both gateways; TC-044 names the overwrite identity; TC-050 reads the region from config and checks the three metrics and the IDs-and-counts rule; TC-053 names the throttle values; TC-060 fixes the unset text; TC-NF-02 single page; TC-NF-03 adds radius, the token-mapping method and the light theme; TC-NF-05 adds the warm-up rule. New: TC-006 (capture stops on 403), TC-014 (run index unreadable or empty), TC-029 (empty state). **Independence from `tasks.md`**: v1.0's two assertions beyond the spec (TC-013 groups + CIDs; TC-025 BBB state) are resolved by FR-002 and by removing the step; no case asserts beyond spec v1.1.

## 1. Feature overview

A-03 is the walking skeleton: one real month (September 2026) of Austin reroof permits goes source → kit runtime → `elephant-cli` → IPFS (CIDv1) → hosted CountyLens site, where a Runs page and a Permits list read the published CIDs through DuckDB-WASM in the browser. It proves the zero-idle-cost read path (decision `docs/decisions/0001-read-path.md`), the honest missing-data display and the observability baseline before the full county is added.

## 2. Requirement mapping

| Source | Reference | Covered by |
| --- | --- | --- |
| Acceptance criterion | A-03-AC-1 | TC-001, TC-002, TC-003, TC-004, TC-005, TC-006, TC-044 |
| Acceptance criterion | A-03-AC-2 | TC-010, TC-011, TC-012, TC-013, TC-014, TC-NF-03 |
| Acceptance criterion | A-03-AC-3 | TC-020, TC-021, TC-022, TC-023, TC-025, TC-026, TC-027, TC-NF-03 |
| Acceptance criterion | A-03-AC-4 | TC-024, TC-028, TC-NF-01, TC-NF-02, TC-NF-05, TC-NF-06 |
| Acceptance criterion | A-03-AC-5 | TC-022, TC-030, TC-031, TC-032, TC-033, TC-034 |
| Acceptance criterion | A-03-AC-6 | TC-040, TC-041, TC-042, TC-043 |
| Acceptance criterion | A-03-AC-7 | TC-050, TC-051, TC-052, TC-053, TC-NF-04 |
| Functional requirement | FR-001 (publish sequence, manifest, limitations notes) | TC-001, TC-002, TC-003, TC-004, TC-005 |
| Functional requirement | FR-002 (Runs page, groups + CIDs, publication state, index error) | TC-010, TC-011, TC-012, TC-013, TC-014 |
| Functional requirement | FR-003 (Permits over DuckDB-WASM) | TC-020, TC-021, TC-023, TC-026 |
| Functional requirement | FR-004 (read-path measurement) | TC-026, TC-028, TC-NF-01, TC-NF-02, TC-NF-05, TC-NF-06 |
| Functional requirement | FR-005 (labels, no-tcad_id, fallback) | TC-022, TC-030, TC-031, TC-032, TC-033, TC-034 |
| Functional requirement | FR-006 (verify-manifest) | TC-040, TC-041, TC-042, TC-043 |
| Functional requirement | FR-007 (observability, budget) | TC-050, TC-051, TC-052, TC-NF-04 |
| Functional requirement | FR-008 (progress bar, skeletons, empty state) | TC-024, TC-029 |
| Functional requirement | FR-009 (counts from manifest, derivation labels, count mismatch) | TC-011, TC-012, TC-029, TC-031 |
| Functional requirement | FR-010 (hosted URL in evidence) | TC-060, TC-061 |
| Functional requirement | FR-011 (missing-reason labels) | TC-022, TC-025, TC-027 |
| Functional requirement | FR-012 (fast copy = CLI output only) | TC-020, TC-044, TC-NF-05 |
| Functional requirement | FR-013 (public, read-only) | TC-010, TC-020 |
| Functional requirement | FR-014 (capture stops on the first 403 / challenge) | TC-006 |
| NFR | NFR-001 | TC-024, TC-NF-01, TC-NF-02, TC-NF-05, TC-NF-06 |
| NFR | NFR-002 (budget alert part) | TC-052 |
| NFR | NFR-003 | TC-NF-03 |
| NFR | NFR-004 | TC-050, TC-051, TC-052, TC-NF-04 |
| Harness rule | Playwright refuses localhost | TC-060 |
| Edge case | Fewer than 42 survive the profile | TC-012 |
| Edge case | Amplify certificate pending | TC-061 |
| Edge case | Account concurrency limit 10 | TC-053 |
| Edge case | DuckDB-WASM loading state | TC-024 |
| Edge case | `runs/index.json` missing, invalid or empty | TC-014 |
| Edge case | `permits_emitted` = 0 (empty state) | TC-029 |
| Edge case | Source answers 403 or a challenge | TC-006 |

## 3. Assumptions

- The run published by A-03 is the latest entry in `runs/index.json`; its `runs/{runId}/manifest.json` is the oracle for every count. Coverage values are objects with a `count` (e.g. `coverage.permits_emitted.count`), as in `contract/v1/pilot-manifest.json`.
- Source display names come from a fixed UI map of manifest `sources[].name`: `austin-3syk-w9eu` → "City of Austin Issued Construction Permits (3syk-w9eu)"; `tcad-2026-certified-json` → the TCAD 2026 certified export, shown with its id `tcad-2026-certified-json`.
- Missing-reason labels are the 21 approved strings in the spec's **Missing-reason labels** table (PO 2026-10-21). "Contractor not printed on permit" replaces the `source_missing` label for contractor fields only. "No TCAD id on source record" labels the Runs-page count `permits_no_tcad_geoid`.
- "The CID copy" is the S3 + CloudFront copy of the published CIDs (AD-02); its host is read from the deployed config (`CID_COPY_HOST`). The fallback is the Filebase gateway (`FILEBASE_GATEWAY_HOST`, from config).
- The Runs page calls the CountyLens API once per load: `GET /api/trpc/runs.summary`; the response carries `x-correlation-id` and `x-trace-id` headers.
- AC-4 (decision `docs/decisions/0001-read-path.md`, D-4): first load and COUNT / listing run in the browser on the hosted Permits page; radius and roof-age run through the Lambda DuckDB fallback over a private (non-CloudFront) copy of the full Austin Parquet as captured (2,380,939 rows on 2026-10-21; 2,380,725 on 2026-10-19). Table parts are written with part size `48m`.
- Exact rejection texts (fixed by this test plan; the build must emit them verbatim): localhost guard → `RUNTIME_URL must be a hosted URL, not localhost: {value}`; unset guard → `RUNTIME_URL is not set; set it to the hosted URL`; gateway allowlist → `Refused gateway {host}: verify-manifest only uses {PINATA_GATEWAY_HOST}, {FILEBASE_GATEWAY_HOST}`; fallback label → the word `fallback` followed by ` · ` and the gateway host from config (`fallback · ipfs.filebase.io`); both-hosts-down state → `Data could not be reached from the CID copy or the Filebase gateway`.
- Exact UI texts (v1.1; identical to `specs/003-walking-skeleton/plan.md` § "Fixed texts and config keys", changed in both or not at all): published-count label `Permits published`; coverage label `No TCAD id on source record`; derivation labels (AD-28) `published_rows` → `Counted from published rows`, `capture_receipt` → `From the capture receipt`, `aggregate_match` → `From the run's internal match (not recomputable from public data)`; publication state `Public by CID · Atlas registration pending` (the phrase `published to Atlas` never appears); run index unreadable → `Run index could not be read from this site`; run index empty → `No runs published yet`; empty Permits list → `No permits published in this run`; count mismatch → `Row count does not match the manifest: {rows} listed, {count} published`; engine failure → `Query engine could not start`; permit rows unreadable (ERR-11) → `Permit rows could not be read from this run` (detail to `console.error` only); progress bar accessible names `Loading run` (Runs) and `Loading permits` (Permits) with `aria-valuetext` = the stage text; engine line `DuckDB-WASM in your browser · read-only`; manifest limitation notes `sources[0].limitations` ∋ `Comptroller baseline not loaded (A-07)` and `sources[1].limitations` ∋ `Confidential owner records redacted (Texas Tax Code §25.025): {n}`; verify success `ALL ARTIFACTS VERIFIED`.
- CID display: the visible text is middle-truncated (`bafy…q4xa`); the full CID is the element's `data-cid` attribute and what the copy button copies. Cases read `data-cid` or the clipboard, never the visible text.
- Config key names (`CID_COPY_HOST`, `FILEBASE_GATEWAY_HOST`, `PINATA_GATEWAY_HOST`, `READPATH_PRIVATE_PREFIX`) are the test harness's names; if the plan names them differently, only the lookup changes, not the case.
- Region: never a literal in a case or in the harness; `tests/e2e/lib/aws.ts` reads it from the `assess` profile configuration (P0-18).
- Identities: AWS reads and the bench use profile `assess`; the TC-044 overwrite attempt uses the uploader's own profile `assess-cid-writer`, which holds no Delete or ACL rights (contracts/storage.md), so the attempt cannot damage the copy.
- Warm-up rule (TC-NF-05; also TC-NF-02 and the warm calls of TC-NF-04): one untimed warm-up invocation per query precedes the 20 timed runs, so all 20 are warm; timings are `queryDurationMs` (engine init `initMs` excluded); the cold start is TC-NF-04's own measurement.
- Theme and breakpoints: light theme only (`colorScheme: 'light'`); cards below 600 px, the data table from 600 px; paged at 200 rows per page since A-11 (PO 2026-10-25), no sorting or sticky header in A-03; tests read the total from the range line (`permits-range`, `data-total`) and walk pages for audits.
- `verify-manifest` (D-4) fetches only from the Pinata public gateway and the Filebase gateway, through a host allowlist; ipfs.io and dweb.link were retired on 2026-09-21 (429 + `Sunset` header).

## 4. Scope

- **In scope:** the publication sequence and manifest; table part size; Runs page; Permits list over DuckDB-WASM with HTTP range reads; missing-data labels; no-`tcad_id` count; Filebase fallback (error, non-200, slow); loading state; responsive 390/768/1440; read-path timings (browser and Lambda fallback); API observability and CDK assertions; `verify-manifest` and its host allowlist; the Playwright localhost guard.
- **Out of scope:** full-county data, coverage page, verify button (A-04 to A-13); admin sign-in and run controls (AD-12); the $0.00 idle-cost proof (A-16).

## 5. Test data

- Source: City of Austin Issued Construction Permits, Socrata `3syk-w9eu`, September 2026 issue dates, reroof description terms. Re-measured 2026-10-20T23:46Z: **42** match the terms; profile `travis-austin@1.0.0` accepts **38** (4 trade sub-permits rejected, D-4b); of the 38, **1** has no `tcad_id` (not published, counted as `permits_no_tcad_geoid`) and **0** lack `contractor_company_name`. Expected published count on that snapshot: 37, but **every assertion reads the manifest**.
- Parcels: TCAD 2026 certified JSON export `tcad-2026-certified-json` (subset matched by the slice's permits).
- Scale data: the full-size Parquet of the Austin permit table, **2,380,939 rows** as captured 2026-10-21 (2,380,725 on 2026-10-19; the case asserts the count in the capture receipt, never a hard-coded figure), placed for TC-NF-05 only in a private S3 prefix that CloudFront does not serve, and deleted afterwards.
- Data snapshot: manifest CID of the A-03 run = `{MANIFEST_CID}` (filled in when published; recorded in `docs/evidence/A-03.md`). The A-02 pilot CID in `contract/v1/README.md` is unpublished and is **not** used.
- Reference row for row-level checks: the first row of the Permits list sorted by permit number ascending (picked at run time, not hard-coded).

## 6. Environment, risks and dependencies

- `RUNTIME_URL` = Amplify branch URL for `003-walking-skeleton`, or `https://countylens.aldarraj.com`. Never localhost (TC-060). No test user (no sign-in in A-03).
- Published-data, build-time and AWS cases: started from `RUNTIME_URL` (manifest CID from `/runs`, deployed `sha` from `/build.json`), run by Playwright from the repo root, AWS profile `assess` (`assess-cid-writer` for the TC-044 overwrite attempt), region from the profile configuration (never a literal in a case), `elephant-cli` from the pinned GitHub main build.
- Public gateways (Pinata, Filebase) may be slow or rate-limit; TC-040 retries per artifact with backoff before failing and records each gateway response.
- TC-NF-05 creates a temporary private object; the case itself deletes it and proves the deletion.

## 7. Coverage matrix

| TC ID | Title | Priority | Tags | Type | Requirement(s) | Test (`@scenario:` tag) |
| --- | --- | --- | --- | --- | --- | --- |
| A-03-TC-001 | Publication steps run in the fixed order | P1 | @pipeline | CLI | AC-1, FR-001 | `tests/e2e/build-checks.spec.ts @scenario:A-03-TC-001` (runs Vitest `publish-order.test.ts` at the deployed SHA) |
| A-03-TC-002 | Skipping or reordering a step fails the run | P1 | @pipeline @negative | CLI | AC-1, FR-001 | `tests/e2e/build-checks.spec.ts @scenario:A-03-TC-002` (runs Vitest `publish-order.test.ts` at the deployed SHA) |
| A-03-TC-003 | Manifest lists every artifact with CIDv1, name, codec, size, SHA-256 | P1 | @pipeline | CLI | AC-1, FR-001 | `tests/e2e/manifest.spec.ts @scenario:A-03-TC-003` |
| A-03-TC-004 | Each tables directory and each CAR artifact has a carCid | P1 | @pipeline | CLI | AC-1, FR-001 | `tests/e2e/manifest.spec.ts @scenario:A-03-TC-004` |
| A-03-TC-005 | Every table part ≤ 50.3 MB (part size 48m) | P1 | @pipeline | CLI | AC-1, AC-4, FR-001 | `tests/e2e/manifest.spec.ts @scenario:A-03-TC-005` |
| A-03-TC-006 | Capture stops on the first 403 or challenge (blocked receipt, exit 2) | P1 | @pipeline @negative @security | CLI | AC-1, FR-014 | `tests/e2e/build-checks.spec.ts @scenario:A-03-TC-006` (runs Vitest `socrata-adapter.test.ts` in `pipeline/oracle-runtime` at the deployed SHA) |
| A-03-TC-010 | Runs page shows the run (demo D-2) | P1 | @smoke @demo | UI | AC-2, FR-002, FR-013 | `runs.spec.ts @scenario:A-03-TC-010` |
| A-03-TC-011 | Runs lists both sources with their `records`, Austin first | P1 | @demo | UI | AC-2, FR-002, FR-009 | `runs.spec.ts @scenario:A-03-TC-011` |
| A-03-TC-012 | Published count = `permits_emitted` on Runs and Permits | P1 | @edge | UI | AC-2, FR-002, FR-009, edge 1 | `runs.spec.ts @scenario:A-03-TC-012` |
| A-03-TC-013 | Run publishes the county and property_improvement groups | P2 | @integration | UI | AC-2, FR-002 | `runs.spec.ts @scenario:A-03-TC-013` |
| A-03-TC-014 | Run index missing, invalid or empty → explicit error state | P1 | @negative @error @edge | UI | AC-2, FR-002 | `runs.spec.ts @scenario:A-03-TC-014` |
| A-03-TC-020 | Permits list shows every published permit via DuckDB-WASM (demo D-1, D-4) | P1 | @smoke @demo | UI | AC-3, FR-003, FR-012, FR-013 | `permits.spec.ts @scenario:A-03-TC-020` |
| A-03-TC-021 | Each row shows the contract columns and provenance | P1 | @demo | UI | AC-3, FR-003 | `permits.spec.ts @scenario:A-03-TC-021` |
| A-03-TC-022 | Every `missing` reason shows its approved label, never a blank | P1 | @missing-data | UI | AC-3, AC-5, FR-005, FR-011 | `permits.spec.ts @scenario:A-03-TC-022` |
| A-03-TC-023 | Engine line exact; no database server called | P1 | @demo | UI | AC-3, FR-003 | `permits.spec.ts @scenario:A-03-TC-023` |
| A-03-TC-024 | DuckDB loading shows a progress bar, no empty-table flash | P1 | @edge | UI | AC-4, FR-008, edge 4 | `permits.spec.ts @scenario:A-03-TC-024` |
| A-03-TC-025 | Contractor via contractor_resolution with its label | P1 | @missing-data | UI | AC-3, FR-011 | `permits.spec.ts @scenario:A-03-TC-025` |
| A-03-TC-026 | Table parts read with HTTP 206 range requests | P1 | @perf | UI | AC-3, AC-4, FR-003 | `permits.spec.ts @scenario:A-03-TC-026` |
| A-03-TC-027 | Label map covers every reason in `missingReasons` (unit) | P1 | @missing-data @unit | Unit | AC-3, FR-011 | `tests/e2e/build-checks.spec.ts @scenario:A-03-TC-027` (runs Vitest `missing-labels.test.ts` at the deployed SHA) |
| A-03-TC-028 | DuckDB-WASM binary transferred compressed | P2 | @perf | UI | AC-4, FR-004 | `permits.spec.ts @scenario:A-03-TC-028` |
| A-03-TC-029 | Empty state when `permits_emitted` is 0; count mismatch otherwise (unit) | P1 | @edge @missing-data @unit | Unit | FR-008, FR-009 | `tests/e2e/build-checks.spec.ts @scenario:A-03-TC-029` (runs Vitest `permits-state.test.ts` at the deployed SHA) |
| A-03-TC-030 | No-tcad_id permit is not published | P1 | @missing-data | UI | AC-5, FR-005 | `permits.spec.ts @scenario:A-03-TC-030` |
| A-03-TC-031 | Runs shows `permits_no_tcad_geoid` labelled "No TCAD id on source record" | P1 | @missing-data | UI | AC-5, FR-005, FR-009 | `runs.spec.ts @scenario:A-03-TC-031` |
| A-03-TC-032 | CID copy request aborted → Filebase, labelled "fallback" | P1 | @negative @error | UI | AC-5, FR-005 | `fallback.spec.ts @scenario:A-03-TC-032` |
| A-03-TC-033 | CID copy returns 500 → Filebase, labelled "fallback" | P1 | @negative @error | UI | AC-5, FR-005 | `fallback.spec.ts @scenario:A-03-TC-033` |
| A-03-TC-034 | CID copy slower than 4 s → Filebase, labelled "fallback" | P1 | @negative @edge | UI | AC-5, FR-005 | `fallback.spec.ts @scenario:A-03-TC-034` |
| A-03-TC-040 | verify-manifest via Pinata + Filebase prints ALL ARTIFACTS VERIFIED | P1 | @pipeline @demo | CLI | AC-6, FR-006 | `tests/e2e/verify-manifest.spec.ts @scenario:A-03-TC-040` |
| A-03-TC-041 | verify-manifest fails on a size or SHA-256 mismatch | P2 | @pipeline @negative | CLI | AC-6, FR-006 | `tests/e2e/verify-manifest.spec.ts @scenario:A-03-TC-041` |
| A-03-TC-042 | verify-manifest refuses non-allowlisted hosts | P1 | @pipeline @negative | CLI | AC-6, FR-006 | `tests/e2e/verify-manifest.spec.ts @scenario:A-03-TC-042` |
| A-03-TC-043 | CAR artifacts verified through their `carCid` bytes | P1 | @pipeline | CLI | AC-6, FR-006 | `tests/e2e/verify-manifest.spec.ts @scenario:A-03-TC-043` |
| A-03-TC-044 | CID copy holds byte-identical CLI output only | P1 | @pipeline @security | CLI | AC-1, FR-012 | `tests/e2e/cid-copy.spec.ts @scenario:A-03-TC-044` |
| A-03-TC-050 | One `runs.summary` call → headers, log line, trace with `duckdb.query`, metric | P1 | @observability | UI + AWS | AC-7, FR-007, NFR-004 | `observability.spec.ts @scenario:A-03-TC-050` |
| A-03-TC-051 | Trace ID recorded in evidence | P2 | @observability | CLI | AC-7, FR-007 | `observability.spec.ts @scenario:A-03-TC-051` |
| A-03-TC-052 | CDK assertions: retention 14/30, DLQ alarms with OK actions → SNS email, $10 budget, X-Ray | P1 | @infra | CLI | AC-7, FR-007, NFR-002, NFR-004 | `tests/e2e/build-checks.spec.ts @scenario:A-03-TC-052` (runs `infra/test/stacks.test.ts` at the deployed SHA) |
| A-03-TC-053 | No reserved concurrency (account limit 10); stage throttle 10 rps / burst 20 | P2 | @infra @edge | CLI | AC-7, FR-007, edge 3 | `tests/e2e/build-checks.spec.ts @scenario:A-03-TC-053` (runs `infra/test/api.test.ts` at the deployed SHA) |
| A-03-TC-060 | Playwright config refuses localhost | P1 | @harness @negative | CLI | FR-010 | `tests/e2e/config-guard.spec.ts @scenario:A-03-TC-060` |
| A-03-TC-061 | Evidence names the hosted URL used | P2 | @edge | UI | FR-010, edge 2 | `runs.spec.ts @scenario:A-03-TC-061` |
| A-03-TC-NF-01 | Browser first load ≤ 60 s with a progress bar (full county; 8 s on the pilot — PO revision 2026-10-24, A-11 Run 2: 24–28 s home, ~45 s GitHub runner; optimization carried to A-16 #11) | P1 | @perf | UI | AC-4, FR-004, NFR-001 | `perf.spec.ts @scenario:A-03-TC-NF-01` |
| A-03-TC-NF-02 | COUNT and listing p95 < 3 s in the browser (20 runs) | P1 | @perf | UI | AC-4, FR-004, NFR-001 | `perf.spec.ts @scenario:A-03-TC-NF-02` |
| A-03-TC-NF-03 | Runs and Permits at 390/768/1440 with Atlas tokens only | P1 | @responsive | UI | AC-2, AC-3, NFR-003 | `responsive.spec.ts @scenario:A-03-TC-NF-03` (smeargle) |
| A-03-TC-NF-04 | API warm p95 < 1 s (30 calls); cold start incl. DuckDB init < 3 s | P1 | @perf @observability | UI + AWS | AC-7, FR-007, NFR-004 | `observability.spec.ts @scenario:A-03-TC-NF-04` |
| A-03-TC-NF-05 | Radius and roof-age p95 < 3 s via Lambda DuckDB on a private full-size copy | P1 | @perf @security | AWS | AC-4, FR-004, FR-012, NFR-001 | `tests/e2e/lambda-fallback.perf.spec.ts @scenario:A-03-TC-NF-05` |
| A-03-TC-NF-06 | Decision record holds the spike's full-size measurements | P1 | @perf @docs | CLI | AC-4, FR-004, NFR-001 | `tests/e2e/read-path-record.spec.ts @scenario:A-03-TC-NF-06` |

## 8. Functional test cases

### Pipeline (AC-1)

#### A-03-TC-001: Publication steps run in the fixed order (happy path)

- **Priority / tags:** P1 · `@pipeline`
- **Maps to:** AC-1, FR-001
- **Preconditions:** `pnpm install` done; `RUNTIME_URL` set.
- **Steps:**
  0. **Open** `{RUNTIME_URL}/build.json`; **read** `sha`; **run** `git checkout {sha}` at the repo root (the tests below run against the deployed code).
  1. **Run** `npx playwright test -g "A-03-TC-001"` (spawns `pnpm vitest run -t "A-03-TC-001"`). → the publish orchestrator runs with a recording step runner.
  2. **Verify** the recorded step list per data group. → exactly `validate → hash (CAR output) → validate CAR → export-tables → upload (with readback)`, each once, in that order.
- **Expected result:** `✓ A-03-TC-001`; the recorded sequence equals the five steps above for `county` and for `property_improvement`; no step missing or duplicated.

#### A-03-TC-002: Skipping or reordering a step fails the run (negative)

- **Priority / tags:** P1 · `@pipeline @negative`
- **Maps to:** AC-1, FR-001
- **Steps:**
  0. **Open** `{RUNTIME_URL}/build.json`; **read** `sha`; **run** `git checkout {sha}` at the repo root (the tests below run against the deployed code).
  1. **Run** `npx playwright test -g "A-03-TC-002"` (spawns `pnpm vitest run -t "A-03-TC-002"`), which (a) makes `validate CAR` fail and (b) calls `upload` before `export-tables`.
  2. **Verify** (a): the run stops at `validate CAR`; `export-tables` and `upload` are never called; no `runs/{runId}/manifest.json` is written.
  3. **Verify** (b): the orchestrator rejects the call with an out-of-order error naming both steps; nothing is uploaded.
- **Expected result:** both sub-cases exit non-zero with an error naming the failed or out-of-order step; no artifact is published; no manifest is written.

#### A-03-TC-003: Manifest lists every artifact (happy path)

- **Priority / tags:** P1 · `@pipeline`
- **Maps to:** AC-1, FR-001
- **Preconditions:** the A-03 run is published; `runs/{runId}/manifest.json` downloaded by CID.
- **Steps:**
  0. **Open** `{RUNTIME_URL}/runs` in a private window; **copy** the manifest CID and `runId` shown on the run card (the cases below fetch `runs/{runId}/manifest.json` by that CID).
  1. **Run** `npx playwright test -g "A-03-TC-003"`.
  2. **Verify** every `artifacts[]` entry has `cid` matching `^b[a-z2-7]+$` (CIDv1 base32), `name`, `codec`, `size` > 0 and a 64-hex `sha256`.
  3. **Verify** every file in the `export-tables` output has exactly one artifact entry, and no artifact comes from outside the `elephant-cli` output.
  4. **Verify** `sources[0].limitations` (Austin) contains exactly `Comptroller baseline not loaded (A-07)` and `sources[1].limitations` (TCAD) contains one entry matching `^Confidential owner records redacted \(Texas Tax Code §25\.025\): \d+$` (FR-001; P0-15).
- **Expected result:** all entries complete; artifact count equals the output file count; no CIDv0 (`Qm…`) anywhere; both limitation notes present with their exact wording.

#### A-03-TC-004: Each tables directory and each CAR artifact has a carCid

- **Priority / tags:** P1 · `@pipeline`
- **Maps to:** AC-1, FR-001 (D-5 / AM-05 additive `carCid`)
- **Steps:**
  0. **Open** `{RUNTIME_URL}/runs` in a private window; **copy** the manifest CID and `runId` shown on the run card (the cases below fetch `runs/{runId}/manifest.json` by that CID).
  1. **Run** `npx playwright test -g "A-03-TC-004"`.
  2. **Verify** each `kind: "directory"` artifact `tables/county` and `tables/property_improvement` has a `carCid` that is a CIDv1 (`bafkrei…`, raw codec) of the matching `car/*.car` file bytes.
  3. **Verify** each `kind: "car"` artifact also has a `carCid` that is the raw-leaves CIDv1 of its own `.car` file bytes, so TC-043's per-`carCid` byte check covers every CAR and cannot pass vacuously.
- **Expected result:** two directory entries and two car entries, each with a CIDv1 `carCid`; a missing `carCid` fails with the artifact name.

#### A-03-TC-006: Capture stops on the first 403 or challenge (negative, build-time)

- **Priority / tags:** P1 · `@pipeline @negative @security`
- **Maps to:** AC-1 ("captured through the kit runtime"), FR-014, Task A addendum A6, P0-7
- **Steps:**
  0. **Open** `{RUNTIME_URL}/build.json`; **read** `sha`; **run** `git checkout {sha}` at the repo root (the tests below run against the deployed code).
  1. **Run** `npx playwright test -g "A-03-TC-006"` (spawns `(cd pipeline/oracle-runtime && npx vitest run test/travis/socrata-adapter.test.ts -t "A-03-TC-006")` against a fake Socrata server).
  2. **Verify** (a): the fake server answers HTTP 403 on the third per-permit GET → the adapter writes a receipt with `outcome: "blocked"` for that request, makes no further request (the request log stops at 3), and the run exits with code 2.
  3. **Verify** (b): the fake server answers a 200 HTML bot-challenge page instead → the same `blocked` receipt, stop and exit 2.
  4. **Verify** (c): the blocked request is not retried; the `User-Agent` of every request is identical (no rotation); nothing is written under `groups/`; a 429 in a separate run **is** retried with backoff (contrast case, so the stop is specific to 403 / challenge).
- **Expected result:** `blocked` receipt, exit code 2, three requests in the log, one `User-Agent`, no retry of the blocked request, no group output; the contrast case retries only on 429.

#### A-03-TC-005: Every table part ≤ 50.3 MB (part size 48m)

- **Priority / tags:** P1 · `@pipeline`
- **Maps to:** AC-1, AC-4 (D-4), FR-001
- **Steps:**
  0. **Open** `{RUNTIME_URL}/runs` in a private window; **copy** the manifest CID and `runId` shown on the run card (the cases below fetch `runs/{runId}/manifest.json` by that CID).
  1. **Run** `npx playwright test -g "A-03-TC-005"` (reads the run manifest and the export-tables invocation log).
  2. **Verify** export-tables was invoked with part size `48m`.
  3. **Verify** every `kind: "table"` artifact (`tables/**/part-*.parquet`) has `size` ≤ 50,331,648 bytes (50.3 MB = 48 MiB).
- **Expected result:** all table parts within the limit; an oversized part fails the test naming the part and its size.

### Runs page (AC-2, AC-5)

#### A-03-TC-010: Runs page shows the run (happy path, demo D-2)

- **Priority / tags:** P1 · `@smoke @demo`
- **Maps to:** AC-2, FR-002, FR-013 · demo lines D-1, D-2
- **Preconditions:** the A-03 run is published and listed in `runs/index.json`.
- **Steps:**
  1. **Open** `{RUNTIME_URL}/runs` in a private window. → the Runs page loads (title "Runs"), no sign-in prompt.
  2. **Verify** in the network log that `runs/index.json` and the latest `runs/{runId}/manifest.json` load with status 200.
  3. **Verify** the run card shows the run ID equal to manifest `runId`.
  4. **Verify** start and finish equal manifest `startedAt` and `finishedAt`, rendered in UTC with a "UTC" suffix.
  5. **Verify** the manifest CID element's `data-cid` attribute equals the CIDv1 of the fetched manifest and starts with `b`; its visible text is the middle-truncated form (`bafy…q4xa`, Atlas § 3); pressing its copy button puts the full CID on the clipboard (Playwright `clipboard-read` permission).
  6. **Verify** the publication-state pill reads exactly `Public by CID · Atlas registration pending` and the page text nowhere contains `published to Atlas` (P0-4).
- **Expected result:** run ID, UTC start/finish and manifest CID match the manifest; the full CID is copyable (clipboard) and present in `data-cid`; the publication state is the fixed text; no run controls shown.

#### A-03-TC-011: Runs lists both sources with their `records`, Austin first

- **Priority / tags:** P1 · `@demo`
- **Maps to:** AC-2, FR-002, FR-009
- **Steps:**
  1. **Open** `{RUNTIME_URL}/runs` in a private window.
  2. **Read** the "Sources" list of the run.
  3. **Verify** item 1 reads exactly "City of Austin Issued Construction Permits (3syk-w9eu)" and shows a record count equal to `manifest.sources[0].records` (name `austin-3syk-w9eu`).
  4. **Verify** item 2 contains "TCAD 2026 certified export" and `tcad-2026-certified-json` and a record count equal to `manifest.sources[1].records`.
  5. **Verify** the number of listed sources equals `manifest.sources.length` (2), each with its `captured_at`.
- **Expected result:** two sources in that order, each with its own `records` count and capture time from the manifest; no source invented, omitted or reordered.

#### A-03-TC-012: Published count = `permits_emitted` on Runs and Permits (edge)

- **Priority / tags:** P1 · `@edge`
- **Maps to:** AC-2, FR-002, FR-009, edge case 1
- **Steps:**
  1. **Open** `{RUNTIME_URL}/runs` in a private window.
  2. **Read** the published row count on the run card: the coverage row labelled exactly `Permits published` (its helper text reads `Counted from published rows`, derivation `published_rows`).
  3. **Verify** it equals `manifest.coverage.permits_emitted.count`.
  4. **Open** `{RUNTIME_URL}/permits`, wait for the list and read the **total** from the range line (`permits-range`, `data-total`; the page shows 200 rows at a time, the DOM holds only the current page). → equals the same manifest value, and the first page shows `min(200, total)` rows.
- **Expected result:** both counts equal `coverage.permits_emitted.count` (37 expected on the 2026-10-20 snapshot: 42 matched, 38 accepted, 1 without `tcad_id`); the published count is never shown as 42 or 38 or as a source `records` value and is never confused with a source `records` line (different label, different element); no placeholder rows.

#### A-03-TC-013: Run publishes the county and property_improvement groups

- **Priority / tags:** P2 · `@integration`
- **Maps to:** AC-2, FR-002 (v1.1: FR-002 requires the groups and their tables CIDs on the Runs page)
- **Steps:**
  1. **Open** `{RUNTIME_URL}/runs` in a private window.
  2. **Verify** the run lists the data groups `county` and `property_improvement`, each with its tables CID (`data-cid`) equal to the manifest directory artifact `cid`.
- **Expected result:** both groups shown with their CIDv1 roots; no other group.

#### A-03-TC-014: Run index missing, invalid or empty → explicit error state (negative, edge)

- **Priority / tags:** P1 · `@negative @error @edge`
- **Maps to:** AC-2, FR-002
- **Steps:**
  1. **Route** `**/runs/index.json` to `route.fulfill({ status: 404 })`; **open** `{RUNTIME_URL}/runs` in a private window. → an error banner reads exactly `Run index could not be read from this site`; no run card, no empty card.
  2. **Repeat** with `route.fulfill({ status: 200, body: '{not json' })` and with `{"foo":1}` (schema mismatch). → the same text.
  3. **Repeat** with `{"runs":[]}`. → the banner reads exactly `No runs published yet`.
  4. **Verify** in every case the app bar and the navigation still work (the Permits destination is reachable) and no placeholder run is shown.
- **Expected result:** the two exact texts for their cases; never a blank page, an empty card or a placeholder run.

#### A-03-TC-031: Runs shows `permits_no_tcad_geoid` (missing data)

- **Priority / tags:** P1 · `@missing-data`
- **Maps to:** AC-5, FR-005, FR-009
- **Steps:**
  1. **Open** `{RUNTIME_URL}/runs` in a private window.
  2. **Find** the coverage line labelled exactly "No TCAD id on source record".
  3. **Verify** its number equals `manifest.coverage.permits_no_tcad_geoid.count`.
  4. **Verify** its derivation helper text is visible (not a tooltip) and reads exactly `From the run's internal match (not recomputable from public data)` (manifest `derivation: "aggregate_match"`, AD-28); the `Permits published` row's helper text reads `Counted from published rows`.
- **Expected result:** "No TCAD id on source record" with the manifest count (1 on the 2026-10-20 snapshot) and its derivation label; shown as "0" with the label when the count is 0, never blank or hidden.

### Permits list (AC-3, AC-5)

#### A-03-TC-020: Permits list via DuckDB-WASM (happy path, demo D-1/D-4)

- **Priority / tags:** P1 · `@smoke @demo`
- **Maps to:** AC-3, FR-003, FR-012, FR-013 · demo lines D-1, D-4
- **Steps:**
  1. **Open** `{RUNTIME_URL}/permits` in a private window. → progress bar, then the table; no sign-in prompt.
  2. **Verify** Parquet requests go to `CID_COPY_HOST`, addressed by CIDs listed in the manifest.
  3. **Verify** the row count equals `manifest.coverage.permits_emitted.count`.
  4. **Verify** every row's `issue_date` is in 2026-09-01 … 2026-09-30.
- **Expected result:** every published September 2026 reroof permit listed once; data read in the browser from the CID copy; no "fallback" label.

#### A-03-TC-021: Contract columns and provenance per row

- **Priority / tags:** P1 · `@demo`
- **Maps to:** AC-3, FR-003
- **Steps:**
  1. **Open** `{RUNTIME_URL}/permits` in a private window and wait for the table.
  2. **Verify** the headers: permit number, `improvement_status`, status class, issue date, contractor (`contractor_resolution`), provenance.
  3. **Verify** status class is one of `open`, `stalled`, `closed`, or shows the label "Needs review: could not be derived".
  4. **Open** the provenance of the reference row (the Atlas § 8 provenance line: body-small, `description` icon). → source URL as a link (host `data.austintexas.gov`), capture time (= manifest `sources[0].captured_at`), table CID (`data-cid` in manifest `artifacts[]`), run ID (= manifest `runId`).
- **Expected result:** all four provenance fields present on every row as visible text and consistent with the manifest.

#### A-03-TC-022: Every `missing` reason shows its approved label (missing data)

- **Priority / tags:** P1 · `@missing-data`
- **Maps to:** AC-3, AC-5, FR-005, FR-011
- **Test data:** the approved label table in `specs/003-walking-skeleton/spec.md` § "Missing-reason labels" (21 reasons), used verbatim as the expected-string fixture.
- **Steps:**
  1. **Open** `{RUNTIME_URL}/permits` in a private window and wait for the table.
  2. **For every row**, read its `missing` list (row detail / data attribute) and **verify** each `{field, reason}` renders exactly the approved label for that reason (e.g. `no_lexicon_carrier` → "No place for this field in the published data model"; `contractor_unresolved` → "Contractor not matched to a company"; `enum_lacks_value` → "Status has no matching value (e.g. Expired)").
  3. **Verify** a contractor field with reason `source_missing` shows "Contractor not printed on permit", and any non-contractor field with `source_missing` shows "Not on the source record".
  4. **Verify** every row shows "No place for this field in the published data model" for `status_raw` and `expiry_date`; a stalled row (if present) shows "Status has no matching value (e.g. Expired)" for `improvement_status`.
  5. **Verify** no displayed cell is empty, `null`, `undefined`, `NaN`, a raw reason code, or `—` without a label.
- **Expected result:** every reason in every row shows its exact approved string; zero blank cells; no raw codes visible.

#### A-03-TC-023: Engine line exact; no database server

- **Priority / tags:** P1 · `@demo`
- **Maps to:** AC-3, FR-003
- **Steps:**
  1. **Open** `{RUNTIME_URL}/permits` in a private window and wait for the table.
  2. **Verify** the engine line text equals exactly "DuckDB-WASM in your browser · read-only".
  3. **Verify** no request during load goes to the CountyLens API or any database host; data requests are only Parquet / manifest GETs by CID (requests to the font hosts `fonts.googleapis.com` / `fonts.gstatic.com` and to the app's own static assets are outside this assertion).
- **Expected result:** exact engine text; only static GETs observed for data.

#### A-03-TC-024: Loading state shows a progress bar, no empty-table flash (edge)

- **Priority / tags:** P1 · `@edge`
- **Maps to:** AC-4 (progress bar), FR-008, edge case 4
- **Steps:**
  1. **Delay** the CID copy route by 2 s (Playwright `route` delay, under the 4 s fallback threshold).
  2. **Open** `{RUNTIME_URL}/permits` in a private window.
  3. **Verify** a progress bar (`role="progressbar"`, accessible name `Loading permits`, `aria-valuetext` = the stage text) is visible before any table renders.
  4. **Record** every DOM state until rows appear (MutationObserver): skeleton rows, if present, sit inside a `role="status" aria-busy="true"` container and are not a `<table>` and carry no data cells.
- **Expected result:** the progress bar shows until rows render; no zero-row table, no "No permits published in this run" empty state at any point; no "fallback" label (2 s < 4 s).

#### A-03-TC-025: Contractor via contractor_resolution with its label

- **Priority / tags:** P1 · `@missing-data`
- **Maps to:** AC-3, FR-011
- **Steps:**
  1. **Open** `{RUNTIME_URL}/permits` in a private window and wait for the table.
  2. **Verify** each row's contractor cell shows `contractor_resolution` (`resolved` or `unresolved`).
  3. **For an unresolved row**, verify the cell shows the Not-available pill with the text `unresolved` and, beside it as visible text, "Contractor not matched to a company" (reason `contractor_unresolved` on `contractor_company_cid`). *(v1.1: the BBB state check was removed; `bbb_status` is not an AC-3 / FR-003 column and BBB is A-08.)*
  4. **Verify** no raw contractor name is shown as if resolved (`contractor_name_raw` shows "No place for this field in the published data model").
  5. **If** a row has reason `source_missing` on a contractor field, verify it shows "Contractor not printed on permit" (0 such rows on the 2026-10-20 snapshot; the label is also asserted in TC-027).
- **Expected result:** every row shows a resolution state and, when not resolved, the exact approved label; resolution comes only from the published edge.

#### A-03-TC-026: Table parts read with HTTP 206 range requests

- **Priority / tags:** P1 · `@perf`
- **Maps to:** AC-3, AC-4, FR-003
- **Steps:**
  1. **Open** `{RUNTIME_URL}/permits` in a private window; record every network response for `*.parquet` / table-part CIDs on `CID_COPY_HOST`.
  2. **Verify** each table-part request carries a `Range: bytes=…` header and the response status is `206` with a `Content-Range` header.
  3. **Verify** no table-part response is a whole-file `200`.
- **Expected result:** all table-part reads are 206 range responses; zero whole-file 200s (DuckDB-WASM HTTP range reads enabled).

#### A-03-TC-027: Label map covers every reason in `missingReasons` (unit)

- **Priority / tags:** P1 · `@missing-data @unit`
- **Maps to:** AC-3, FR-011
- **Steps:**
  0. **Open** `{RUNTIME_URL}/build.json`; **read** `sha`; **run** `git checkout {sha}` at the repo root (the tests below run against the deployed code).
  1. **Run** `npx playwright test -g "A-03-TC-027"` (spawns `pnpm vitest run -t "A-03-TC-027"`; loads `contract/v1/columns.json` → `missingReasons` and the UI label map).
  2. **Verify** every reason in `missingReasons` (21 today) has a non-empty label equal to the spec table string, and the map has no reason absent from `missingReasons`.
  3. **Verify** the contractor override maps `source_missing` → "Contractor not printed on permit" for contractor fields only, and the Runs label for `permits_no_tcad_geoid` is "No TCAD id on source record".
  4. **Verify** adding a fake reason to a copy of `missingReasons` makes the check fail naming that reason.
- **Expected result:** 21/21 reasons labelled with the approved strings; a missing label fails the test with the reason code.

#### A-03-TC-028: DuckDB-WASM binary transferred compressed

> 2026-10-21 note (plan R2 fallback, same intent: a compressed WASM transfer): the first deploy showed Amplify rejects a `Content-Encoding` custom header (read-only), so Brotli with `Content-Encoding: br` was replaced by a build-time `duckdb-eh-<hash>.wasm.gz` (gzip -9) that the engine gunzips with `DecompressionStream`; the raw `.wasm` is not deployed.

- **Priority / tags:** P2 · `@perf`
- **Maps to:** AC-4, FR-004 (0001 Findings 1–2)
- **Steps:**
  1. **Open** `{RUNTIME_URL}/permits` in a private window; record every request and the transfer size of the DuckDB-WASM `.wasm.gz`.
  2. **Verify** the `.wasm.gz` was fetched with status 200 or 304 and its response body is under 12 MB.
  3. **Verify** no request for an uncompressed `.wasm` was made.
- **Expected result:** the DuckDB-WASM binary is transferred compressed (`.wasm.gz`, < 12 MB); a request for a raw `.wasm` or a transfer of 12 MB or more fails the test naming the file.

#### A-03-TC-029: Empty state when `permits_emitted` is 0; count mismatch otherwise (unit, edge)

- **Priority / tags:** P1 · `@edge @missing-data @unit`
- **Maps to:** FR-008, FR-009
- **Steps:**
  0. **Open** `{RUNTIME_URL}/build.json`; **read** `sha`; **run** `git checkout {sha}` at the repo root (the tests below run against the deployed code).
  1. **Run** `npx playwright test -g "A-03-TC-029"` (spawns `pnpm vitest run apps/web/test/permits-state.test.ts -t "A-03-TC-029"`; in-test manifest, no fixture data shipped).
  2. **Verify** (a): with `coverage.permits_emitted.count` = 0 and a query returning 0 rows, the Permits page renders the empty state with the headline exactly `No permits published in this run`, the run ID and the manifest CID; no table, no progress bar, no error banner.
  3. **Verify** (b): with `coverage.permits_emitted.count` = 3 and 0 rows, the page renders the error banner exactly `Row count does not match the manifest: 0 listed, 3 published` and **not** the empty state.
  4. **Verify** (c): the empty state is never rendered while the engine is loading (FR-008).
- **Expected result:** the empty state only for a true manifest 0; any other zero is the count-mismatch error; both texts exact.

#### A-03-TC-030: No-tcad_id permit is not published (missing data)

- **Priority / tags:** P1 · `@missing-data`
- **Maps to:** AC-5, FR-005
- **Test data:** the permit number(s) without `tcad_id` from the run's capture receipt (1 on 2026-10-20).
- **Steps:**
  1. **Open** `{RUNTIME_URL}/permits` in a private window and wait for the table.
  2. **Search / filter** for that permit number.
  3. **Verify** it is absent from the list.
- **Expected result:** not listed; its exclusion shows only in the Runs count (TC-031).

#### A-03-TC-032: CID copy request aborted → Filebase fallback (error)

- **Priority / tags:** P1 · `@negative @error`
- **Maps to:** AC-5, FR-005
- **Steps:**
  1. **Abort** every request to `CID_COPY_HOST` (`page.route('**://{CID_COPY_HOST}/**', r => r.abort())`).
  2. **Open** `{RUNTIME_URL}/permits` in a private window.
  3. **Verify** Parquet / manifest requests now go to `FILEBASE_GATEWAY_HOST` by the same CIDs.
  4. **Verify** the table renders the row count `coverage.permits_emitted.count` and a visible "fallback" label naming `FILEBASE_GATEWAY_HOST`.
  5. **Also abort** `FILEBASE_GATEWAY_HOST` and reload. → an error state reads exactly `Data could not be reached from the CID copy or the Filebase gateway`.
- **Expected result:** data read through Filebase, labelled "fallback"; with both hosts down, an explicit error state, never a blank page or empty table.

#### A-03-TC-033: CID copy returns 500 → Filebase fallback (error)

- **Priority / tags:** P1 · `@negative @error`
- **Maps to:** AC-5, FR-005
- **Steps:**
  1. **Fulfil** every request to `CID_COPY_HOST` with status 500 (`route.fulfill({ status: 500 })`).
  2. **Open** `{RUNTIME_URL}/permits` in a private window.
  3. **Verify** the same CIDs are then requested from `FILEBASE_GATEWAY_HOST` and return 200/206.
- **Expected result:** table renders `coverage.permits_emitted.count` rows labelled "fallback"; the 500 is not shown as data.

#### A-03-TC-034: CID copy slower than 4 s → Filebase fallback (edge)

- **Priority / tags:** P1 · `@negative @edge`
- **Maps to:** AC-5, FR-005
- **Steps:**
  1. **Delay** every response from `CID_COPY_HOST` by 5 s (`route` handler waits 5,000 ms, then continues).
  2. **Open** `{RUNTIME_URL}/permits` in a private window.
  3. **Verify** a request to `FILEBASE_GATEWAY_HOST` starts between 4.0 s and 5.0 s after the CID copy request.
- **Expected result:** the page switches to Filebase after the 4 s timeout and labels the result "fallback"; rows equal `coverage.permits_emitted.count`.

### verify-manifest (AC-6)

#### A-03-TC-040: verify-manifest via Pinata + Filebase prints ALL ARTIFACTS VERIFIED (happy path)

- **Priority / tags:** P1 · `@pipeline @demo`
- **Maps to:** AC-6, FR-006
- **Steps:**
  0. **Open** `{RUNTIME_URL}/runs` in a private window; **copy** the manifest CID and `runId` shown on the run card (the cases below fetch `runs/{runId}/manifest.json` by that CID).
  1. **Run** `npx tsx scripts/verify-manifest.ts runs/{runId}/manifest.json`.
  1b. **Verify** the script first fetched the manifest itself by its CID from both gateways and printed a `manifest` line per gateway with a byte-for-byte match against `runs/{runId}/manifest.json` (AM-05).
  2. **Verify** each artifact line shows the CID and a size and SHA-256 match for the Pinata public gateway and for the Filebase gateway.
  3. **Verify** no request went to `CID_COPY_HOST`, ipfs.io or dweb.link (request log of the script).
  4. **Verify** the last line is exactly `ALL ARTIFACTS VERIFIED` and the exit code is 0.
- **Expected result:** every manifest artifact fetched from both allowlisted gateways; sizes and SHA-256 equal the manifest; `ALL ARTIFACTS VERIFIED`.

#### A-03-TC-041: verify-manifest fails on a mismatch (negative)

- **Priority / tags:** P2 · `@pipeline @negative`
- **Maps to:** AC-6, FR-006
- **Steps:**
  0. **Open** `{RUNTIME_URL}/runs` in a private window; **copy** the manifest CID and `runId` shown on the run card (the cases below fetch `runs/{runId}/manifest.json` by that CID).
  1. **Copy** the manifest to a temp file and change one artifact's `sha256` (and, separately, one `size`).
  2. **Run** `npx tsx scripts/verify-manifest.ts {temp manifest}`.
- **Expected result:** a line naming the artifact and the mismatched field; `ALL ARTIFACTS VERIFIED` is **not** printed; exit code ≠ 0.

#### A-03-TC-042: verify-manifest refuses non-allowlisted hosts (negative)

- **Priority / tags:** P1 · `@pipeline @negative`
- **Maps to:** AC-6, FR-006
- **Steps:**
  0. **Open** `{RUNTIME_URL}/runs` in a private window; **copy** the manifest CID and `runId` shown on the run card (the cases below fetch `runs/{runId}/manifest.json` by that CID).
  1. **Run** `npx tsx scripts/verify-manifest.ts runs/{runId}/manifest.json --gateway {host}` once each for the CloudFront CID copy host, `w3s.link`, `ipfs.io` and `dweb.link` (or the equivalent config override).
  2. **Verify** each run exits non-zero before any network request, with exactly `Refused gateway {host}: verify-manifest only uses {PINATA_GATEWAY_HOST}, {FILEBASE_GATEWAY_HOST}`.
- **Expected result:** four refusals; no fetch made; `ALL ARTIFACTS VERIFIED` never printed.

#### A-03-TC-043: CAR artifacts verified through their `carCid` bytes

- **Priority / tags:** P1 · `@pipeline`
- **Maps to:** AC-6, FR-006
- **Steps:**
  0. **Open** `{RUNTIME_URL}/runs` in a private window; **copy** the manifest CID and `runId` shown on the run card (the cases below fetch `runs/{runId}/manifest.json` by that CID).
  1. **Run** `npx tsx scripts/verify-manifest.ts runs/{runId}/manifest.json --verbose`.
  2. **Verify** for each artifact with a `carCid`, the script fetches `/ipfs/{carCid}` (the raw `.car` file bytes) from both gateways and checks size and SHA-256 against the matching `car/*.car` artifact.
  3. **Verify** the `bagu…` dag-json root CIDs of CAR / directory artifacts are not fetched as files for the byte check.
- **Expected result:** each CAR line reports `carCid` size + SHA-256 match on both gateways; a corrupted `carCid` in a temp manifest fails with the artifact name.

#### A-03-TC-044: CID copy holds byte-identical CLI output only

- **Priority / tags:** P1 · `@pipeline @security`
- **Maps to:** AC-1, FR-012
- **Steps:**
  0. **Open** `{RUNTIME_URL}/runs` in a private window; **copy** the manifest CID and `runId` shown on the run card (the cases below fetch `runs/{runId}/manifest.json` by that CID).
  1. **Run** `npx playwright test -g "A-03-TC-044"`, which GETs every manifest artifact (by CID) from `https://{CID_COPY_HOST}`.
  2. **Verify** each object's size and SHA-256 equal the manifest entry.
  3. **Verify** a copy attempt onto an existing CID key, made with the `assess-cid-writer` profile (the uploader's identity, which holds no Delete or ACL rights), is refused: `PutObject` without `If-None-Match` → `AccessDenied` (bucket policy), with `If-None-Match: "*"` → `PreconditionFailed`; afterwards the object's ETag and SHA-256 are unchanged. A key not in any manifest (e.g. `querydb/`, `capture/`) returns 403 or 404 from `CID_COPY_HOST`.
- **Expected result:** 100% of artifacts byte-identical on the CID copy; both overwrite attempts refused with the named errors and the object unchanged; no non-manifest object is public.

### Observability and infrastructure (AC-7)

#### A-03-TC-050: One `runs.summary` call → headers, log line, trace, metric

- **Priority / tags:** P1 · `@observability`
- **Maps to:** AC-7, FR-007, NFR-004
- **Steps:**
  1. **Open** `{RUNTIME_URL}/runs` in a private window; capture the single request to `/api/trpc/runs.summary`.
  2. **Verify** exactly one such call per page load, and the response has headers `x-correlation-id` and `x-trace-id`.
  3. **Query** CloudWatch Logs (API function log group, region from config) for that `x-correlation-id`. → exactly one JSON line with Powertools keys (`level`, `message`, `service`, `timestamp`, `correlation_id`, `xray_trace_id`).
  4. **Get** the X-Ray trace by `x-trace-id` (`aws xray batch-get-traces`). → it contains a subsegment named `duckdb.query`.
  5. **Query** the metrics `QueryDurationMs`, `ItemsProcessed` and `ItemsFailed` (dimension `procedure = runs.summary`) for the API namespace in that minute. → at least one datapoint each (`ItemsFailed` is emitted as 0 on success).
  6. **Verify** the log line and the trace annotations carry identifiers and counts only: no field or annotation contains `X-Amz-Signature` (a presigned URL), a row value (owner name, address) or a credential (FR-007).
- **Expected result:** one call, both headers, one log line with the correlation ID, a trace with `duckdb.query`, datapoints for all three metrics, and no row value or presigned URL in any log field or annotation.

#### A-03-TC-051: Trace ID recorded in evidence

- **Priority / tags:** P2 · `@observability`
- **Maps to:** AC-7, FR-007
- **Steps:**
  0. **Open** `{RUNTIME_URL}/runs` and run TC-050 to obtain `x-correlation-id` and `x-trace-id`.
  1. **Open** `docs/evidence/A-03.md`.
  2. **Verify** it contains the `x-correlation-id`, `x-trace-id` and log line from TC-050.
- **Expected result:** trace ID present and resolvable with `aws xray batch-get-traces`.

#### A-03-TC-052: CDK assertions (retention, DLQ alarms, SNS email, budget, tracing)

- **Priority / tags:** P1 · `@infra`
- **Maps to:** AC-7, FR-007, NFR-002, NFR-004
- **Steps:**
  0. **Open** `{RUNTIME_URL}/build.json`; **read** `sha`; **run** `git checkout {sha}` at the repo root (the tests below run against the deployed code).
  1. **Run** `npx playwright test -g "A-03-TC-052"` (spawns `pnpm --filter infra test -t "A-03-TC-052"`).
  2. **Verify** assertions pass for: every Lambda `TracingConfig.Mode = Active`; every function log group `RetentionInDays = 14`; the API access (query) log group `RetentionInDays = 30`; every SQS queue has a `RedrivePolicy` DLQ; one CloudWatch alarm per DLQ with both `AlarmActions` and `OKActions` pointing to an SNS topic with an `email` subscription; an `AWS::Budgets::Budget` of 10 USD with a notification.
- **Expected result:** all named assertions pass; removing any one (e.g. the OK action or the budget) makes its assertion fail.

#### A-03-TC-053: No reserved concurrency (edge)

- **Priority / tags:** P2 · `@infra @edge`
- **Maps to:** AC-7, edge case 3 (AD-11)
- **Steps:**
  0. **Open** `{RUNTIME_URL}/build.json`; **read** `sha`; **run** `git checkout {sha}` at the repo root (the tests below run against the deployed code).
  1. **Run** `npx playwright test -g "A-03-TC-053"` (spawns `pnpm --filter infra test -t "A-03-TC-053"`).
- **Expected result:** no Lambda sets `ReservedConcurrentExecutions` or a `ProvisionedConcurrencyConfig`; the API stage's default route settings are `ThrottlingRateLimit: 10` and `ThrottlingBurstLimit: 20` (AD-11, FR-007).

### Harness and hosting

#### A-03-TC-060: Playwright config refuses localhost

- **Priority / tags:** P1 · `@harness @negative`
- **Maps to:** FR-010, hosted-runtime rule
- **Steps:**
  0. **Open** `{RUNTIME_URL}/build.json`; **read** `sha`; **run** `git checkout {sha}` at the repo root (the tests below run against the deployed code).
  1. **Run** `RUNTIME_URL=http://localhost:3000 npx playwright test --list`.
  2. **Run** again with `http://127.0.0.1:3000`.
  3. **Run** again with `RUNTIME_URL` unset.
- **Expected result:** the first two exit non-zero with exactly `RUNTIME_URL must be a hosted URL, not localhost: {value}` (value = the URL given); the third exits non-zero with exactly `RUNTIME_URL is not set; set it to the hosted URL`; no test runs in any of the three.

#### A-03-TC-061: Evidence names the hosted URL used (edge)

- **Priority / tags:** P2 · `@edge`
- **Maps to:** FR-010, edge case 2
- **Steps:**
  1. **Open** `{RUNTIME_URL}/build.json`. → build SHA.
  2. **Verify** `docs/evidence/A-03.md` names `RUNTIME_URL` (custom domain or Amplify branch URL) and the same build SHA.
- **Expected result:** evidence URL and SHA match the URL the tests ran against.

### NFR cases (AC-4, AC-7)

#### A-03-TC-NF-01: Browser first load ≤ 8 s with a progress bar

- **Priority / tags:** P1 · `@perf`
- **Maps to:** AC-4, FR-004, NFR-001
- **Steps:**
  1. **Open** `{RUNTIME_URL}/permits` in a fresh private window (no cache), 5 times.
  2. **Measure** from navigation start to first rendered row; verify `role="progressbar"` was visible in between.
- **Expected result:** all 5 cold loads ≤ 8,000 ms with a progress bar; timings saved to evidence.

#### A-03-TC-NF-02: COUNT and listing p95 < 3 s in the browser (20 runs)

- **Priority / tags:** P1 · `@perf`
- **Maps to:** AC-4, FR-004, NFR-001
- **Steps:**
  1. **Open** `{RUNTIME_URL}/permits` in a private window; wait for DuckDB ready.
  2. **Run** one untimed warm-up of each query, then 20 times each through the page's query hook: the COUNT query and the listing query (all rows, sorted by permit number; the page then shows 200 at a time). Time each with `performance.now()`.
  3. **Compute** p50 and p95 per query.
- **Expected result:** each p95 < 3,000 ms; the 40 timings saved to evidence and to `docs/decisions/0001-read-path.md`.

#### A-03-TC-NF-03: Responsive 390 / 768 / 1440, Atlas tokens only

- **Priority / tags:** P1 · `@responsive`
- **Maps to:** AC-2, AC-3, NFR-003
- **Steps:**
  1. **Open** `{RUNTIME_URL}/runs` and `{RUNTIME_URL}/permits` at widths 390, 768 and 1440, light theme (`colorScheme: 'light'`; dark theme is A-13).
  2. **Verify** no horizontal page scroll (`scrollWidth ≤ innerWidth`); tap targets ≥ 48 px at 390.
  3. **Verify** computed colours, font families, spacing (margin, padding, gap) and border radii come only from Atlas tokens: smeargle builds the allowed value set once per width from the `:root` custom properties of `tokens.css` (plus `0`, `auto`, `inherit`, `transparent`, `currentColor`) and lists every `getComputedStyle` value outside the set with its selector and property (method: plan § "Atlas element map", token check).
  4. **Capture** screenshots per width.
  5. **Verify** the Permits list shows cards at 390 and the data table at 768 and 1440 (switch at 600 px); the first provenance line on each page is inside the first viewport at 390.
- **Expected result:** six screenshots, no overflow, zero non-token values, cards / table per width.

#### A-03-TC-NF-04: API warm p95 < 1 s (30 calls), cold start < 3 s

- **Priority / tags:** P1 · `@perf @observability`
- **Maps to:** AC-7, FR-007, NFR-004
- **Steps:**
  1. **Force** a cold start (publish a new function version), then open `{RUNTIME_URL}/runs` once; read the X-Ray `Initialization` segment plus the DuckDB init subsegment for that `x-trace-id`.
  2. **Call** `/api/trpc/runs.summary` 30 more times warm from the hosted page context; compute p95 from response timings.
- **Expected result:** cold start incl. DuckDB init < 3,000 ms; warm p95 < 1,000 ms over 30 calls; both values in `docs/evidence/A-03.md`.

#### A-03-TC-NF-05: Radius and roof-age p95 < 3 s via Lambda DuckDB on a private full-size copy

- **Priority / tags:** P1 · `@perf @security`
- **Maps to:** AC-4, FR-004, FR-012, NFR-001
- **Test data:** the full-size Austin Parquet as captured (2,380,939 rows on 2026-10-21; 2,380,725 on 2026-10-19).
- **Steps:**
  0. **Open** `{RUNTIME_URL}/runs` in a private window; **copy** the manifest CID and `runId` shown on the run card (the cases below fetch `runs/{runId}/manifest.json` by that CID).
  1. **Upload** the Parquet to the private, non-CloudFront S3 prefix named by config (`READPATH_PRIVATE_PREFIX`), profile `assess`, region from config.
  2. **Verify** it is not public: `curl -I https://{CID_COPY_HOST}/{private key}` → 403 or 404; any public CountyLens API route given that key → a 4xx with no data (400 for a non-CID input, 403 or 404 otherwise).
  3. **Run** `aws lambda invoke` on the query function: one untimed warm-up invocation per query, then 20 timed invocations for the radius query (bounding box + haversine, centre 30.2672, -97.7431, 1 mi) and 20 for the roof-age filter (≥ 15 years), so all timed runs are warm; record each duration from the response's `queryDurationMs` (engine init `initMs` excluded; also present as the function's log field).
  4. **Compute** p50 and p95 per query.
  5. **Delete** the private object; `aws s3api head-object` → 404.
- **Expected result:** radius p95 < 3,000 ms and roof-age p95 < 3,000 ms; private file never reachable publicly (403/404 from the CID copy; a 4xx with no data from the API); file deleted afterwards and the `head-object` 404 recorded in `docs/evidence/A-03.md`; invocations are direct (`aws lambda invoke`), never through the public API; the 40 timings in `docs/decisions/0001-read-path.md` and evidence.

#### A-03-TC-NF-06: Decision record holds the spike's full-size measurements

- **Priority / tags:** P1 · `@perf @docs`
- **Maps to:** AC-4, FR-004, NFR-001
- **Steps:**
  0. **Open** `{RUNTIME_URL}/build.json`; **read** `sha`; **run** `git checkout {sha}` at the repo root (the tests below run against the deployed code).
  1. **Run** `npx playwright test -g "A-03-TC-NF-06"` (parses `docs/decisions/0001-read-path.md`).
  2. **Verify** it records, for the full Austin table (2,380,939 rows captured 2026-10-21) and 20 timed runs each: p50 and p95 for COUNT, radius (bounding box + haversine) and roof-age through the CID copy and through Filebase; the first-load time; the gateway legs; the Filebase plan limits; the projected full-county size; the chosen part size `48m`.
  3. **Verify** every query with p95 ≥ 3,000 ms in the browser is listed as switched to the Lambda DuckDB fallback (radius and roof-age), and the browser keeps first load, COUNT, small reads and free-form SQL.
- **Expected result:** all named measurements present with numeric values; every browser p95 ≥ 3 s has a recorded switch; a missing field fails the test naming it.

## 9. Edge cases

- Fewer than 42 permits survive the profile → counts come from the manifest (TC-012).
- Amplify certificate pending on `countylens.aldarraj.com` → Amplify branch URL used; evidence names it (TC-061).
- Account concurrency limit 10 → no reserved concurrency (TC-053).
- DuckDB-WASM initialising → progress bar, no empty-table flash (TC-024).
- `permits_no_tcad_geoid` count is 0 → label still shown with "0" (TC-031).
- CID copy aborted, 500, or no first byte within 4 s → Filebase, labelled "fallback" (TC-032, TC-033, TC-034); both unreachable → explicit error state (TC-032).
- verify-manifest pointed at a retired or non-independent host → refused (TC-042).
- `runs/index.json` missing, invalid or empty → `Run index could not be read from this site` / `No runs published yet` (TC-014).
- `permits_emitted` = 0 → `No permits published in this run`; any other zero → the count-mismatch banner (TC-029).
- Source answers 403 or a bot challenge → `blocked` receipt, exit 2, nothing published (TC-006).

## 10. Gap-linked cases (expected to fail until fixed)

None at drafting time.

## 11. Execution log (filled in Phase 5)

| TC ID | Run date | Build (sha) | Result | Evidence | Defect |
| --- | --- | --- | --- | --- | --- |
| A-03-TC-001 | | | | | |

---

## Gate G6: Test Case Approval

| # | Criterion | Status |
| --- | --- | --- |
| G6-1 | Every AC and every FR maps to at least one TC (§ 2 and § 7) | ☑ (spec FR-001 … FR-013, final) |
| G6-2 | Happy, negative, edge and missing-data paths covered | ☑ |
| G6-3 | NFRs have test cases with measurable pass criteria | ☑ |
| G6-4 | Every case is a complete sequence starting from the hosted URL | ☑ (step 0 = `/runs` manifest CID or `/build.json` sha for non-UI cases) |
| G6-5 | Negative cases state the exact message or rejection behavior | ☑ label wording (spec table); localhost-guard, allowlist and both-down texts fixed in § 3 |
| G6-6 | Test data and environment documented, with real records | ☑ real 2026-10-20 snapshot counts; manifest CID `{MANIFEST_CID}` is filled at publish (cases read it at run time) |
| G6-7 | Every TC traces to the story and a requirement | ☑ |
| G6-8 | AI pre-check (`developmentsupport-g6-precheck`): PASS | ☑ run 2 PASS, `docs/gates/G6-A-03-precheck.md` |

**Decision:** ☑ Approved ☐ Returned · 2026-10-21 11:00 (PO, round R5, 🛑 D-7: "Approve (Recommended)"; `specs/003-walking-skeleton/run-log.md` 11:00). v1.1 refinements of 2026-10-21 change no AC meaning and add TC-006, TC-014 and TC-029 under the same approval; the PO sees them at round R6.

## Open questions

Resolved 2026-10-21: A-1 (labels: spec table approved), A-2 (`permits_emitted`), A-3 (AC-4 split: browser first load + COUNT/listing on hosted Permits; radius + roof-age via Lambda DuckDB on a private copy), A-4 (`permits_no_tcad_geoid`, after profile acceptance), A-5 (Runs calls `/api/trpc/runs.summary`).

Also resolved 2026-10-21 (v1.0): A-6 (TC-011 asserts the text contains "TCAD 2026 certified export" and `tcad-2026-certified-json`, the spec's wording); A-7 (exact rejection texts fixed in § 3); A-8 (config key names are harness names, § 3).

None open.

## Full-county adaptation (2026-10-24, A-11 Run 2, PO approved: "Yes, adapt them (Recommended)"; paging added 2026-10-25)

These cases were written for A-03's pilot (~38 permits, all issued September 2026). From Run 2 the hosted page lists the full county (15,025 roofing permits across decades). Each case keeps its intent; only pilot-specific facts and checks that do not scale changed (`tests/e2e/permits.spec.ts`, `tests/e2e/perf.spec.ts`, `tests/e2e/lib/perf.ts`):

| Case | Pilot expectation | Full-county expectation |
| --- | --- | --- |
| A-03-TC-020 | every row issued in 2026-09 | every row's `issue_date` is a valid ISO date not after the run's `as_of` (manifest `finishedAt`); row count still exactly `permits_emitted` |
| A-03-TC-020, 021, 022, 025 | full per-row assertions on every row | after paging (PO 2026-10-25) the DOM holds one page of 200 rows: the row count is the range line's total (`data-total`) and the first page has `min(200, total)` rows; per-row assertions run on the current page, and the audits walk pages (first page, every 97th row's page, the page of named permit `2003-012717 BP`) instead of one in-page pass over every row |
| A-03-TC-012 | step 4 navigates the same tab from Runs to Permits and counts the rows | step 4 navigates the same tab again (the fresh-context variant of 2026-10-25 is reverted: the stall was DOM size, not the tab) and reads the total from the range line (`data-total` = `permits_emitted`) |
| A-03-TC-030 | `NO_TCAD_PERMIT_NUMBERS` lists every unlinked permit (1) | it lists a sample (≥ 1, never more than `permits_no_tcad_geoid`, Run 2: 275,764); each listed permit is absent from the list and the page |
| A-03-TC-NF-03 | Atlas audit of every element at 390/768/1440 | the `test.fixme` is removed by the paging change (the page holds at most 200 rows, so the audit is fast again); `smeargle` on Permits and Runs stays in A-16 item 12 |
| A-03-TC-NF-01 | each cold first load ≤ 8 s | ≤ 60 s at full-county scale (Run 2: 24–28 s home, ~45 s GitHub runner) for now; measure again after paging, then tighten (A-16 item 11) |
| A-03-TC-040…043 (verify-manifest), TC-034 | verify-manifest re-reads every artifact from both gateways; TC-034 timing slack 100 ms | the hosted run verifies the manifest plus a very small sample of artifacts (PO 2026-10-25); the full verification is an operator tool (Run 1 took about two hours locally). Measured on the deployed paged page (2026-10-25, laptop): TC-032 42 s, TC-033 29 s, TC-034 19–27 s, TC-NF-01 cold first load 12–16 s each (20 loads about 5 min), TC-NF-02 3.9 min; no sample cut needed there. TC-034's timing slack widened to 500 ms (measured 3,808 ms against the 4 s timeout). TC-NF-05 stays @needs-aws and is excluded in CI |

**Root cause and paging (PO 2026-10-25).** Measured on the live Run 2 page: 15,025 table rows were about 947,000 DOM elements and about 390 MB; on slow CI browsers the page froze after the "Listing permits" stage (the screen recording stops, no console error). That explained the full-county symptoms of TC-012, TC-020 and TC-NF-01, the TC-NF-03 audit that ran for minutes, the parallel-worker cancellations and the trace-snapshot starvation. The Permits page is now paged (200 rows per page, range line, Previous / Next page), and the tests read the total from the range line and walk pages.

Result against the hosted preview (Run 2, one worker, before paging): all 9 Permits cases pass in ~11 min (before: TC-020 failed on the month filter; TC-021 alone took 7.6 min in CI).
