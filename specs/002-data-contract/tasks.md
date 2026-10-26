---

description: "Task list for A-02 Freeze the property-intelligence data contract"
---

# Tasks: Freeze the property-intelligence data contract

**Input**: Design documents from `/specs/002-data-contract/` (plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md, agent-design.md)

**Prerequisites**: plan.md, spec.md, agent-design.md (mew + oracle), PO decisions D-1 to D-4 (run-log.md)

**Tests**: MANDATORY (constitution X, XXI, XXII). Test tasks come first in every phase and must fail before the implementation tasks run. The story ends with the Phase Z tasks below.

**Builder**: every implementation task is delegated to the `soofi-xyz-team-kit:oracle` subagent (constitution XV), marked **[oracle]**. It loads `use-oracle` and `apply-engineering-guidelines`. Track A also uses `build-county-transform`, `county-seed-data` and `county-permit-adapter`, plus the lexicon references loaded at A-1.

**Organization**: the work is in the three tracks of walkthrough § 3a. **Track B** (US3, profile) and **Track C** (US4, gazetteer) start right after Setup and never wait for Track A. **Track A** (US1 carriers, US2 views, US5 sample) starts its captures at once too. Only its permit transform (T049) waits for Track B's classifier (T021).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: US1 carriers · US2 views · US3 profile · US4 gazetteer · US5 sample (spec.md user stories)
- Paths are repository-relative, per plan.md § Project Structure

---

## Phase 1: Setup (shared, all tracks)

**Purpose**: the smallest pnpm workspace (research R-11). No Turborepo and no app folders.

- [X] T001 [oracle] Create root `package.json` (private, `"type": "module"`, engines node ≥ 22, scripts `test`, `test:coverage`, `typecheck`, `lint`, `format:check`) with devDependencies `vitest` ^5, `@vitest/coverage-v8` ^5, `typescript` ~6, `typescript-7` (`npm:typescript@^7`), `tsx` ^4, `eslint` ^10, `typescript-eslint` ^8, `prettier` ^3, and `elephant-cli` pinned to `github:elephant-xyz/elephant-cli#44bb182b9f7f904662e9b33e1fde70bdeab62322`
- [X] T002 [oracle] Create `pnpm-workspace.yaml` (packages: `packages/*`, `profiles/*`, `pipeline/publish`), `tsconfig.base.json` (strict, `noUncheckedIndexedAccess`, ESM, NodeNext) and `vitest.config.ts` (`test.projects`; vitest.workspace was removed in Vitest 4) in the repository root
- [X] T003 [P] [oracle] Create `eslint.config.js` and `.prettierrc.json` at the root, with the `no-restricted-imports` rules from ARD § 4: ban `pg`, `postgres` and `@duckdb/*` in `packages/*/src/**` and `pipeline/publish/src/**`; ban `openai`, `@anthropic-ai/sdk` and `@aws-sdk/client-bedrock-runtime` everywhere
- [X] T004 [P] [oracle] Add to `.gitignore`: `pipeline/data/` (confirm present), `pipeline/data/raw/census/`, `**/*.parquet` with the single exception `!contract/v1/sample.parquet` (ARD deviation D-07), and `coverage/`
- [X] T005 [oracle] Run `pnpm install`; confirm `pnpm exec elephant-cli export-tables --help` prints the options (pinned build, not Homebrew); record the lockfile in git

**Checkpoint**: the workspace installs and the pinned CLI runs. Tracks A, B and C can start.

---

## Phase 2: Foundational (contract schemas; Track A only, does not block B or C)

**Purpose**: `packages/contract` (FR-010), used by the pilot manifest, the views and the sample. Tracks B and C do not import it.

### Tests (write first, must fail) ⚠️

- [X] T006 [P] Test `packages/contract/test/provenance.test.ts`. The missing-reason enum is exactly: "`no_lexicon_carrier`, `not_in_export`, `source_missing`, `no_coordinates`, `no_roof_date`, `basis_unmatched`, `no_dated_sale`, `no_owner_record`, `no_mailing_address`, `zip_not_zcta`, `not_open`, `not_closed`, `contractor_unresolved`, `bbb_blocked`, `bbb_not_found`, `needs_review`, `first_run`, `out_of_scope`". `Provenance` rejects null `cid`/`table`/`table_cid`/`run_id`/`manifest_cid`/`as_of`.
- [X] T007 [P] Test `packages/contract/test/manifest.test.ts`. `RunManifestV1` rejects: a non-CIDv1 value (a `Qm…` v0), a gateway URL anywhere, a `directory` artifact without `carCid`, and any IPNS field. It requires `sources[].captured_at` and `profiles[] {name, version, sha256, path, gitCommit}`. Each `coverage` count needs `derivation` ∈ `published_rows|capture_receipt|aggregate_match`. `RunsIndexV1` orders `runs[]` by `finishedAt`.
- [X] T008 [P] Test `packages/contract/test/columns.test.ts`.
  - The four view column lists equal data-model.md § Views (mew § B.2–B.6 with the D-4 adjustments).
  - `ALIASES` holds exactly `issue_date → permit_issue_date` and `final_date → completion_date`.
  - No column named `status_raw`, `expiry_date`, `contractor_name_raw`, `bbb_rating`, `bbb_url`, `description` or `work_class_raw`.
  - Every CID column ends in `_cid`.
  - Enums:
    - `roof_age_basis` ∈ {`permit`, `new_construction`, `built_year`, `unknown`}
    - `roof_age_confidence` ∈ {`high`, `medium`, `low`, `none`}
    - `bbb_status` ∈ {`rated`, `not_found`, `blocked`, `not_checked`}
    - `status_class` ∈ {`open`, `stalled`, `closed`}
    - `owner_area_class` ∈ {`in_county`, `regional`, `out_of_area`, `unknown`}
    - `coordinate_source` ∈ {`gis_centroid`, `permit_point`, `none`}
    - `tenure_basis` ∈ {`sale_date`, `unknown`}
    - `contractor_resolution` ∈ {`resolved`, `unresolved`}

### Implementation

- [X] T009 [oracle] Create `packages/contract/package.json` (`@countylens/contract`, depends only on `zod` ^4) and `packages/contract/src/index.ts`
- [X] T010 [P] [oracle] Implement `packages/contract/src/provenance.ts` (`Provenance`, `MissingReason`, `Missing {field, reason}`)
- [X] T011 [P] [oracle] Implement `packages/contract/src/manifest.ts` and `packages/contract/src/runs-index.ts` (`RunManifestV1` per contracts/manifest.md with refinements; `RunsIndexV1`)
- [X] T012 [oracle] Implement `packages/contract/src/columns.ts` (the single column list with name, type, meaning, source class.property or derivation, missing reason, `ALIASES`) and `packages/contract/src/rows.ts` (Zod row schemas generated from `columns.ts` for `v_property`, `v_roofing_permit`, `v_contractor`, `v_run`). Green T006–T008.

**Checkpoint**: the contract schemas are green. Track A can build the manifest and the views.

---

## Phase 3: Track B: User Story 3, roofing and status profile (Priority: P1) — starts after Phase 1

**Goal**: a versioned `travis-austin@1.0.0` profile that classifies reroofs and status words, digested and stamped (FR-003, FR-004, FR-005, FR-009; AC-3, AC-4, AC-5).

**Independent Test**: the PO marks ≥ 24/25 sampled permits right, with ≤ 1 `needs_review` and 0 solar/PV/RTU accepted. The full-dataset candidate count equals include − excluded − trade − needs_review, measured in one run, with 0 Auxiliary Power candidates.

### Tests for User Story 3 (write first, must fail) ⚠️

- [X] T013 [P] [US3] Test `profiles/travis-austin@1.0.0/test/classify-permit.test.ts`, with real Austin descriptions from oracle § E.1 as fixtures:
  - REROOF, RE-ROOF and ROOF REPLACE on BP → Roofing/Replacement;
  - `work_class = 'Auxiliary Power'` → not roofing, even with "ROOF" in the text;
  - SOLAR, PV, PHOTOVOLTAIC, RTU/RTUS and ROOF-MOUNTED → excluded with a reason id;
  - "OPPORTUNITY" is **not** RTU, and "ROOF DECKING" inside a reroof is **not** a roof deck;
  - EP/MP/PP with an include term → not Roofing (`trade_permit`, D-4b);
  - `work_class = 'Roof'` with no include term → `needs_review`;
  - exclude > trade permit > include.
- [X] T014 [P] [US3] Test `profiles/travis-austin@1.0.0/test/classify-status.test.ts`:
  - Active, Pending, Pending Permit, On Hold, Suspended, Inactive Pending Revision and Re Review → `open`;
  - Expired and Expired - License → `stalled` with `improvement_status = null` (D-4a), never Completed or Cancelled;
  - Final and Closed → `closed`/`Completed`;
  - VOID, Withdrawn, any `Cancelled*`, Aborted, Denied but Closed, Revoked and Rejected → `exclude`;
  - an unseen word (e.g. "Archived") → `needs_review`.
- [X] T015 [P] [US3] Test `profiles/travis-austin@1.0.0/test/digest.test.ts`. `digest()` = SHA-256 of the canonical form (Zod-parse, recursively sorted keys, `JSON.stringify(...) + "\n"`) and equals the committed `DIGEST`. Changing any rule without a version bump fails. `expectations.json` is outside the digest.
- [X] T016 [P] [US3] Test `profiles/travis-austin@1.0.0/test/generators.test.ts`. `toSoqlInclude()` produces the exact SoQL predicate for the three include terms. `toSqlStatusMap()` produces a `VALUES` table with a digest header equal to `packages/query-core/generated/travis-austin@1.0.0.status-map.sql`. Every class in `published_encoding` is in {open, stalled, closed}.
- [X] T017 [P] [US3] Test `profiles/travis-austin@1.0.0/test/measure.test.ts` (unit, with a fake Socrata client). The candidates = include − excluded − trade − needs_review assertion holds. Fetched rows ≠ count gives one re-measure, then a stop with a reason. A 403 stops with a `blocked` receipt. The 3 SoQL Auxiliary Power permit numbers equal the classifier's `aux_power` set.
- [X] T018 [P] [US3] Test `profiles/travis-austin@1.0.0/test/sample.test.ts`. Ranking by `sha256(seed + "\n" + permit_number)` is deterministic and independent of input order. Exactly 25 rows are drawn. The seed, population count, `captured_at` and the sha256 of the sorted key list are recorded.

### Implementation for User Story 3

- [X] T019 [US3] [oracle] Create `profiles/travis-austin@1.0.0/package.json` (`@countylens/profile-travis-austin`, `zod`) and `profiles/travis-austin@1.0.0/rules.json`: `roofing.include` [REROOF, RE-ROOF, ROOF REPLACE], token-aware `roofing.exclude` (ids `aux_power`, `solar_pv`, `rtu`, `roof_mounted`, `roof_deck`), `trade_permit` (BP only), `needs_review`, `status_map` (AD-08 lists, `Cancelled*` prefix), `published_encoding` (closed→Completed; Active→Permitted; Pending/Pending Permit/Re Review→Planned; On Hold/Suspended/Inactive Pending Revision→OnHold; stalled→null; exclude and needs_review → not emitted), `sample_population`, and a `jurisdictions` map (`austin`)
- [X] T020 [US3] [oracle] Implement `profiles/travis-austin@1.0.0/index.ts`: Zod schema for `rules.json`, `digest()`, the `PROFILE {name, version, sha256}` constant. Write `DIGEST` and `CHANGELOG.md`. Green T015.
- [X] T021 [US3] [oracle] Implement `classifyPermit()` and `classifyStatus()` in `profiles/travis-austin@1.0.0/index.ts`. Every result carries `PROFILE.sha256`. Green T013, T014. **Track A's T049 depends on this task.**
- [X] T022 [US3] [oracle] Implement `toSoqlInclude()` and `toSqlStatusMap()`, and generate `packages/query-core/generated/travis-austin@1.0.0.status-map.sql` with a digest header. Green T016.
- [X] T023 [US3] [oracle] Implement `profiles/travis-austin@1.0.0/scripts/measure.ts` (research R-09):
  1. count include + total;
  2. key-page the include set (≤ 50,000 per page, ≤ 1 request/s, receipts with sha256, stop on 403);
  3. classify locally and re-count in the same run;
  4. write `profiles/travis-austin@1.0.0/expectations.json` (`measured_at`, `dataset_rows`, `include_matches`, `excluded{by id}`, `trade_permits`, `needs_review`, `candidates`, `rules_sha256`, `query_urls`).

  Green T017. Then run it live (AC-5) and record the counts in run-log.md.
- [X] T024 [US3] [oracle] Implement `profiles/travis-austin@1.0.0/scripts/sample.ts` (research R-10): population = description or work class mentioning ROOF; seed `travis-austin@1.0.0/AC-3/2026-10-21`; 25 smallest digests. Write `docs/evidence/A-02-classifier-review.md` with columns permit, work_class, status, description, verdict, reason and PO ✔/✘. Green T018. Then run it live.
- [X] T025 [US3] 🛑 **D-7**: show the 25-permit table to the PO. Pass = ≥ 24 right, ≤ 1 `needs_review`, 0 solar/PV/RTU accepted. On a fail: adjust `rules.json`, bump to `1.0.1` (DIGEST, CHANGELOG), draw a new seed, ask again. Record the answers word for word in run-log.md.

**Checkpoint**: the profile is green, AC-5 is measured, and AC-3 is reviewed.

---

## Phase 4: Track A: User Story 1, pilot run and carrier verdicts (Priority: P1) 🎯 MVP

**Goal**: a real local pilot export for `county` and `property_improvement`, and a verdict for each of the nine AC-1 fields (FR-001, FR-011; AC-1).

**Independent Test**: `docs/decisions/0002-lexicon-carriers.md` has 9 verdicts. Each "carrier" cites a schema-cache entry and a pilot row `{table, cid}`; each "no carrier" names its fallback and a drafted request.

### Tests for User Story 1 (write first, must fail) ⚠️

- [X] T031 [P] [US1] Test `pipeline/publish/test/sequence.test.ts`. `runSequence()` spawns, per group and in this exact order: `validate <dir>` → `hash <dir> --output-zip --output-csv --output-car` → `validate <car>` → `export-tables <car> --output --part-size 1g --output-json`. There is no `--atlas-page` and no upload. A non-zero exit stops the sequence. Argv, exit code, stdout roots and output sha256 values are recorded.
- [X] T032 [P] [US1] Test `pipeline/publish/test/cid.test.ts`. The JCS serialization matches the RFC 8785 vectors. `cidOfBytes()` (ipfs-unixfs-importer, cidVersion 1, rawLeaves true) gives `bafkrei…` for < 256 KiB. CIDs are compared by multihash digest across raw, dag-pb and dag-json.
- [X] T033 [P] [US1] Test `pipeline/publish/test/manifest.test.ts` (fixture CLI outputs). `buildManifest()` reads only CLI outputs and capture receipts (no `pg`). Part CIDs come from the `CountyTables` block in `tables.car`, are re-derived from each file, and a mismatch fails. The output parses with `RunManifestV1`, with `runId: "travis-pilot-20261020"`, `previousManifestCid: null` and the "pilot: local, unpublished" limitation.
- [X] T034 [P] [US1] Test `pipeline/oracle-runtime/test/pilot/capture-austin.test.ts`. The fixed slice per D-3 is: 42 issued 2026-09-01…30 with an include term; 5 Expired by oracle § B's rule (`status_current='Expired' AND permittype='BP' AND tcad_id IS NOT NULL ORDER BY issue_date DESC, permit_number LIMIT 5`); 3 older Final BP reroofs by the same ordering rule on `status_current='Final'` before 2025-10-20. Captures are one GET per permit, ≤ 1 request/s. Receipts hold url, method, multiValueQueryString, status, bytes, sha256 and captured_at. A 403 or challenge → `blocked` receipt and stop.
- [X] T035 [P] [US1] Test `pipeline/oracle-runtime/test/pilot/capture-tcad-subset.test.ts`, on a fixture of the pretty-printed array format. Only records whose `geoID` equals a wanted `tcad_id` as a string are parsed. Exactly one residential `pID` → matched; zero → `no_tcad_geoid`; more than one → `ambiguous_geoid`; all are kept and counted. A null `tcad_id` → unmatched. The receipt has the zip sha256, entry name, record ordinals and per-record sha256.
- [X] T036 [P] [US1] Test `pipeline/oracle-runtime/test/transforms/tcad-county.test.ts`:
  - the county group layout per oracle § A.2;
  - every entity has `source_http_request` + `request_identifier` (`pID` as printed);
  - every entity is linked;
  - `confidentialCode` owners have name and mailing suppressed before validate, and are counted;
  - `structure.roof_date` comes only from the vendored estimator ledger;
  - the seed files and `property.json` are byte-identical to the PI group's.
- [X] T037 [P] [US1] Test `pipeline/oracle-runtime/test/transforms/austin-property-improvement.test.ts`:
  - permits are emitted with `improvement_type`/`improvement_action`/`improvement_status` from the profile only;
  - Expired → `improvement_status` null;
  - an **assertion fails if any emitted permit's class is outside {open, stalled, closed}** (D-4a guard);
  - excluded and needs_review permits are not emitted and are counted;
  - `request_identifier` = `permit_number` as printed;
  - `property_has_property_improvement` links to the same property CID as the county group;
  - no description, work class, status word, expiry or contractor name is written.
- [X] T038 [P] [US1] Test `pipeline/oracle-runtime/test/roof-age/vendored.test.ts`. The SHA-256 of `kit/use-oracle/runtime/src/roof-age/estimator.ts` equals its `VENDORED.md` row. With the Travis roof-age profile, a Final BP reroof with `completed_date` gives anchor `permit_terminal_date`/high, an Active replacement never resets roof age (P0-8), and `as_of` = run `finishedAt`.
- [X] T039 [P] [US1] Test `pipeline/oracle-runtime/test/transforms/lexicon-manifest.test.ts`. The Seed, County and Property Improvement data-group schema CIDs are read from `https://lexicon.elephant.xyz/api/manifest` (fixture), never hardcoded. A fetch failure stops the run.

### Implementation for User Story 1

- [X] T040 [US1] [oracle] Create `pipeline/publish/package.json` (`@countylens/publish`; deps `@countylens/contract`, `multiformats`, `ipfs-unixfs-importer`, `zod`) and implement `pipeline/publish/src/jcs.ts` and `pipeline/publish/src/cid.ts`. Green T032.
- [X] T041 [US1] [oracle] Implement `pipeline/publish/src/sequence.ts`, which spawns `elephant-cli` from the workspace pin in the fixed order. Green T031.
- [X] T042 [US1] [oracle] Implement `pipeline/publish/src/manifest.ts` (`buildManifest()`, which reads `tables.car` blocks and receipts only). Green T033.
- [X] T043 [P] [US1] [oracle] Vendor `skills/use-oracle/runtime/src/roof-age/estimator.ts` (kit 0.99.1) unmodified into `pipeline/oracle-runtime/kit/use-oracle/runtime/src/roof-age/`, add its SHA-256 row to `pipeline/oracle-runtime/kit/VENDORED.md`, and implement `pipeline/oracle-runtime/travis/roof-age/travis-roof-age-profile.ts`. Green T038.
- [X] T044 [P] [US1] [oracle] Implement `pipeline/oracle-runtime/travis/transforms/lexicon-manifest.ts`. Green T039.
- [X] T045 [US1] [oracle] Implement `pipeline/oracle-runtime/travis/pilot/capture-austin.ts` (reusing `travis/lib/source-client.ts` for backoff and the stop on 403). The slice query's include predicate comes from `toSoqlInclude()` in `profiles/travis-austin@1.0.0`, with no term literal in this file (**depends on T022**). Green T034.
- [X] T046 [P] [US1] [oracle] Implement `pipeline/oracle-runtime/travis/pilot/capture-tcad-subset.ts` (reusing `travis/lib/zip-entry.ts` streaming). Green T035.
- [X] T047 [US1] [oracle] Implement `pipeline/oracle-runtime/travis/pilot/build-seed.ts` (county-seed-data contract: `parcel_id` = `pID`, extra `geo_id`) and `pipeline/oracle-runtime/travis/transforms/shared-seed.ts` (one builder for the seed files and `property.json`, used by both groups)
- [X] T048 [US1] [oracle] Implement `pipeline/oracle-runtime/travis/transforms/tcad-county.ts` (build-county-transform custom-code mode, output contract). Green T036.
- [X] T049 [US1] [oracle] Implement `pipeline/oracle-runtime/travis/transforms/austin-property-improvement.ts`, which uses `classifyPermit`/`classifyStatus` from `profiles/travis-austin@1.0.0` (**depends on T021**). Green T037.
- [X] T050 [US1] [oracle] Implement `pipeline/oracle-runtime/travis/pilot/run-pilot.ts`, which runs, in order:
  1. lexicon manifest;
  2. captures;
  3. TCAD subset;
  4. seed;
  5. classification ledger;
  6. roof-age ledger;
  7. both transforms;
  8. `runSequence()` for `county`, then `property_improvement`;
  9. `buildManifest()`.

  Output goes to `pipeline/data/pilot/travis-pilot-20261020/`. `ELEPHANT_IPFS_GATEWAYS` stays unset, and nothing is uploaded.
- [X] T051 [US1] [oracle] Run the pilot live. If `validate` reports errors, fix the transform until it is clean; never skip validation. Record in run-log.md, for each of the 8 CLI commands: argv, exit code, the printed CAR and tables root CIDs, both `tables-export.json` SHA-256 values, the `hash.csv` `dataGroupCid`, the elephant-cli commit, the matched/unmatched/ambiguous counts and the manifest CID. Commit the exact manifest bytes to `contract/v1/pilot-manifest.json`.
- [X] T052 [US1] Test `packages/query-core/test/carriers.test.ts` (write first, must fail). It parses `docs/decisions/0002-lexicon-carriers.md` and asserts:
  - exactly 9 fields, each with one verdict ∈ {`carrier`, `no_carrier`, `no_carrier_not_emitted`};
  - each `carrier` has a class.property, a `~/.elephant-cli/schema-cache` reference and a pilot row `{table, cid}` that exists in the pilot Parquet (when `PILOT_DIR` is set) with a non-null value;
  - each `no_carrier*` has a fallback (AD-24 or AD-25) and a drafted request.
- [X] T053 [US1] [oracle] Write `docs/decisions/0002-lexicon-carriers.md` (ADR format):
  - re-check each of mew's § A.2 verdicts against the populated `~/.elephant-cli/schema-cache/` and against `DESCRIBE` of each pilot table;
  - cite one pilot row per carrier;
  - include mew's § A.3 drafted requests (status: drafted, not filed; D-1);
  - list the sources used (live MCP down; the lexicon manifest and schema cache live);
  - copy the used class schemas (public lexicon) from the cache to `packages/query-core/test/fixtures/schemas/`, with their CIDs, for T057.

  Any carrier that is not emitted becomes `no_carrier_not_emitted`. Green T052.
- [X] T054 [US1] 🛑 **D-8**: ask the PO whether to file the drafted lexicon extension requests outside the repo (recommended: draft only, revisit at release). Record the answer word for word in run-log.md and in the ADR.

**Checkpoint**: a real pilot export exists and AC-1 has its verdicts.

---

## Phase 5: Track A: User Story 2, the four views (Priority: P1)

**Goal**: `views.sql` over the pilot tables with exactly the frozen columns, plus missing reasons (FR-002, FR-007, FR-009; AC-2, AC-7).

**Independent Test**: `PILOT_DIR=… pnpm vitest packages/query-core` is green over the pilot tables.

### Tests for User Story 2 (write first, must fail) ⚠️

- [X] T055 [P] [US2] Test `packages/query-core/test/no-text-classification.test.ts`. `views.sql` contains no `LIKE`, `ILIKE`, `regexp_*`, `SIMILAR TO` or `~` operator, no profile term literal (REROOF, RE-ROOF, ROOF REPLACE, SOLAR, PV, RTU, ROOF-MOUNTED) and no `now()`/`current_date`. No profile term literal appears in source code outside `profiles/`: the scan covers `packages/*/src/**`, `packages/query-core/views.sql`, `pipeline/publish/src/**` and `pipeline/oracle-runtime/travis/**`, excluding `**/test/**` fixtures (FR-009). `structure.roof_age_years` is never referenced.
- [X] T056 [P] [US2] Test `packages/query-core/test/derive.test.ts`, table-driven (mew § B.5 and data-model.md § Derivation rules):
  - `roof_age_years`, for full and year-only `roof_date`, gives 0 at the same year;
  - basis/confidence: permit/high · new_construction/medium · built_year/low · unknown/none;
  - tenure: no date → `unknown`, `is_long_tenure` null, `no_dated_sale`; 11 years → true; exactly 10 → false;
  - `owner_area_class`/`owner_is_out_of_area` for all four classes;
  - `open_days` = as_of − issue_date only for open/stalled, else null with `not_open`, and always ≥ 0;
  - `status_class` from the generated status map, with null status + issue date → `stalled`.
- [X] T057 [P] [US2] Test `packages/query-core/test/views.shape.test.ts` (in-memory DuckDB with empty typed tables built from the committed class-schema snapshot in `packages/query-core/test/fixtures/schemas/`, written by T053). All four views compile. `DESCRIBE` of each view equals `@countylens/contract` `columns.ts` (names, order, types). `bindManifest()` creates empty typed relations for tables the export did not emit (oracle R10).
- [X] T058 [P] [US2] Test `packages/query-core/test/views.pilot.test.ts`, gated on `PILOT_DIR` and skipped with an explicit message when it is absent:
  - every view row parses with the Zod row schemas;
  - 0 nulls in `cid`, `table`, `table_cid`, `run_id`, `manifest_cid`, `as_of`;
  - for every row and nullable column, the value is non-null **or** `missing` contains that field (SC-007);
  - `v_property` count = distinct `cid` in the county `property` table (mew M4);
  - `contractor_company_cid` is non-null iff `contractor_resolution = 'resolved'`;
  - every `v_roofing_permit` row has `bbb_status = 'not_checked'` with a reason;
  - each Expired pilot permit has `status_class = 'stalled'` and `missing` containing `status_raw/no_lexicon_carrier`, and is never Completed or Cancelled;
  - no trade sub-permit is in `v_roofing_permit`;
  - `table_cid` equals the re-derived raw-leaves CID of its part.

### Implementation for User Story 2

- [X] T059 [US2] [oracle] Implement `packages/query-core/src/derive.ts` (one exported function per derived column, used to generate the SQL expressions and to unit-test them). Green T056.
- [X] T060 [US2] [oracle] Write `packages/query-core/views.sql`. The four views are over `export-tables` output only. Property comes from the county group (deduplicated by `cid`), permits from the property_improvement group. Joins go only through relationship tables (`from_cid`/`to_cid`). `v_roofing_permit` filters on `improvement_type = 'Roofing' AND improvement_action = 'Replacement'`. The `missing` list is built per row. The provenance columns are bound from the manifest. Green T055.
- [X] T061 [US2] [oracle] Implement `packages/query-core/src/bind-manifest.ts` (`bindManifest(manifest, tablesDir, engine)` with `as_of` = `finishedAt`, `captured_at` from `sources[]`, `profile_version`/`profile_sha256` from `profiles[]`, the part-file → `table_cid` map and empty typed relations for absent tables) and `packages/query-core/src/index.ts` (the `QueryEngine` interface; no engine import in `src`). Add `@duckdb/node-api` as a devDependency of `packages/query-core` only. Green T057.
- [X] T062 [US2] [oracle] Run `PILOT_DIR=pipeline/data/pilot/travis-pilot-20261020 pnpm vitest packages/query-core`. Fix the views until T058 is green. Record the frozen column list per view in run-log.md.

**Checkpoint**: the views are frozen against the pilot export (AC-2, AC-7).

---

## Phase 6: Track C: User Story 4, place gazetteer (Priority: P2) — starts after Phase 1

**Goal**: `travis-places@1.0.0` from public Census files, with source stamps and `out_of_scope` (FR-006; AC-6).

**Independent Test**: Pflugerville, Manor, Lakeway and 78753 return Census points with URL, file date and SHA-256. 99999 returns `out_of_scope`. Round Rock carries `partial_in_travis`.

### Tests for User Story 4 (write first, must fail) ⚠️

- [X] T026 [P] [US4] Test `packages/query-core/test/gazetteer.test.ts`:
  - "Pflugerville" → `{status:'found', kind:'place', geoid:'4857176', point:{lat:30.447765, lon:-97.602116}}` with `source.url`, `source.file_date`, `source.sha256` and `gazetteer.sha256`;
  - "Manor", "Lakeway" and "78753" → found;
  - "Pflugerville city" (LSAD) and case variants → found;
  - "99999" and "Georgetown" → `{status:'out_of_scope'}` with no point;
  - "Round Rock", "Cedar Park" and "Leander" → `partial_in_travis: true`.
- [X] T027 [P] [US4] Test `packages/query-core/test/owner-area.test.ts`. `ownerArea()`: a Travis ZCTA → `in_county`; a Williamson/Hays/Bastrop/Caldwell/Burnet/Blanco ZCTA → `regional`; any other US ZCTA → `out_of_area`; a non-ZCTA ZIP → `unknown` with reason `zip_not_zcta`; missing → `unknown` with reason `no_mailing_address`.
- [X] T028 [P] [US4] Test `packages/query-core/test/gazetteer-digest.test.ts`. `DIGEST` = SHA-256 of the JCS form of `{version, places, zctas, owner-area, sources}`, and the committed value matches. `sources.json` has url, Last-Modified, retrieved_at, bytes and sha256 per file.

### Implementation for User Story 4

- [X] T029 [US4] [oracle] Implement `packages/query-core/scripts/build-gazetteer.ts`. Download into `pipeline/data/raw/census/` (gitignored): `2024_Gaz_place_national.zip`, `2024_Gaz_zcta_national.zip`, `rel2020/zcta520/tab20_zcta520_county20_natl.txt` and `codes2020/place_by_cou/st48_tx_place_by_county2020.txt`. Use one identified request each and stop on 403. Filter by Travis (FIPS 48453; ZCTA `AREALAND_PART > 0`), mark `partial_in_travis`, and write `packages/query-core/gazetteer/travis-places@1.0.0/{sources,places,zctas,owner-area}.json` and `DIGEST`.
- [X] T030 [US4] [oracle] Implement `packages/query-core/gazetteer/travis-places@1.0.0/index.ts`: `lookup()`, `ownerArea()` and `GAZETTEER {version, sha256}`, with Zod-validated JSON and `out_of_scope` never carrying a point. Run T029 live, then green T026–T028.

**Checkpoint**: the gazetteer is green and committed.

---

## Phase 7: Track A: User Story 5, 20 sample rows for Task B (Priority: P2)

**Goal**: `contract/v1/sample.parquet` + `README.md` (FR-008; AC-8).

**Independent Test**: `duckdb -c "SELECT count(*) FROM 'contract/v1/sample.parquet'"` prints 20, with 0 null provenance, ≥ 1 stalled reroof and ≥ 1 property with a roof age.

### Tests for User Story 5 (write first, must fail) ⚠️

- [X] T063 [P] [US5] Test `packages/query-core/test/sample.test.ts`:
  - `contract/v1/sample.parquet` has exactly 20 rows, each one `v_roofing_permit` row joined to its `v_property` columns (prefixed per `columns.ts`);
  - 0 nulls in `source_url`, `captured_at`, `table`, `table_cid`, `run_id`, `manifest_cid`;
  - ≥ 1 row with `status_class = 'stalled'`;
  - ≥ 1 row with non-null `roof_age_years`;
  - `manifest_cid` = the CID recomputed from `contract/v1/pilot-manifest.json` bytes;
  - every column is documented in `contract/v1/README.md`, and every no-carrier field is listed there with its reason.

### Implementation for User Story 5

- [X] T064 [US5] [oracle] Implement `packages/query-core/scripts/cut-sample.ts`. It selects 20 rows from the bound pilot views by a recorded deterministic rule: all stalled rows first, then rows with roof age, then by `permit_cid`. It writes `contract/v1/sample.parquet` and `contract/v1/columns.json` (from `columns.ts`). It never reads the Query DB or raw captures.
- [X] T065 [US5] [oracle] Write `contract/v1/README.md`:
  - every column (name, type, meaning, source class.property or derivation, missing reason), generated from `columns.ts`;
  - every no-carrier gap and its fallback;
  - the D-4a "empty status means stalled" rule;
  - the pilot CIDs as "real content addresses of unpublished local files, replaced in A-03";
  - how to recompute `manifest_cid`;
  - the change rule (additive in v1, otherwise `contract/v2`);
  - "never published to IPFS or shown on the hosted site".

  Green T063.

**Checkpoint**: Task B can build against `contract/v1`.

---

## Phase 8: Polish & Cross-Cutting Concerns

- [X] T066 [P] [oracle] Run `pnpm lint`, `pnpm format:check` and `pnpm typecheck` at the root and in `pipeline/oracle-runtime`; fix all findings
- [X] T067 [P] [oracle] Write `docs/reports/A-02-unit-test-report.md` from `../assessment-guide/templates/unit-test-report.md` with the real `pnpm vitest --coverage` output
- [X] T068 Run the quickstart.md steps 1–9 and record any deviation in run-log.md

---

## Phase Z: Prove on the hosted runtime (mandatory, always last)

**Purpose**: Constitution I, XVI, XXII. The story is not done until these pass.

- [X] TZ01 Run the reviewer agents from the story front matter (`oracle`, `donphan`) read-only; record scores in docs/reviews/CR-A-02.md (each ≥ 75 or justified)
- [X] TZ02 N/A: Project story, no hosted runtime until A-03 (G4 C-04 exception; hosted proof in A-13 and A-15)
- [X] TZ03 N/A: Project story, no hosted runtime until A-03 (G6 C-05/C-09 exception; the test cases run from a terminal at the repo root and use Vitest instead of Playwright)
- [X] TZ04 N/A: Project story, no hosted runtime until A-03 (`ui: false`)
- [X] TZ05 Run the story's independent test (`agents.verify`): `docs/decisions/0002-lexicon-carriers.md` has a verdict for every field; `PILOT_DIR=pipeline/data/pilot/travis-pilot-20261020 pnpm vitest packages/query-core` passes; `duckdb -c "SELECT count(*) FROM 'contract/v1/sample.parquet'"` returns 20; plus `pnpm vitest --coverage` ≥ 80% on `packages/query-core` and `packages/contract` (NFR-002)
- [X] TZ06 Write docs/reports/A-02-test-report.md, docs/evidence/A-02.md, the docs/traceability.md row and one docs/kit-usage.md line

---

## Dependencies & Execution Order

### Phase dependencies

- **Phase 1 Setup** → blocks everything.
- **Track B (Phase 3)** and **Track C (Phase 6)**: start after Phase 1. They need nothing from Phase 2 or Track A.
- **Phase 2 Foundational**: after Phase 1. Needed by Track A only (T033, T057, T063).
- **Track A US1 (Phase 4)**: tests T031–T039 and implementation T040–T048 start after Phase 1/2, in parallel with B and C. **T049 waits for T021** (the profile classifier) and **T045 waits for T022** (`toSoqlInclude()`). T050–T054 follow T049.
- **Track A US2 (Phase 5)**: after T051 (the pilot export) and T022 (the generated status map). T055–T057 can be written as soon as Phase 2 is done.
- **Track A US5 (Phase 7)**: after T062.
- **Phase 8 (Polish), then Phase Z**: after all tracks. Phase numbers follow priority (P1 before P2); the tracks run in parallel regardless of phase number.

### Critical path

T001 → T005 → T019 → T021 → T049 → T050 → T051 → T053 → T060 → T062 → T064 → T065 → TZ05.

### Parallel opportunities

- After T005, the three tracks run at once:
  - Track B: T013–T018 tests in parallel, then T019–T024.
  - Track C: T026–T028 in parallel, then T029–T030.
  - Track A: T006–T008 and T031–T039 tests in parallel; T043–T046 in parallel.
- T055–T057 are written in parallel with the pilot run.

### Parallel example: start of Stage 5

```text
oracle subagent 1 (Track B): T013–T018 failing, then T019–T024
oracle subagent 2 (Track C): T026–T028 failing, then T029–T030
oracle subagent 3 (Track A): T006–T012, then T031–T048 (T049 after T021)
```

---

## Implementation Strategy

1. **MVP = US1 + US3** (a real pilot export plus carrier verdicts, and the profile it depends on). That settles mew R1/R2 and the classification first.
2. Then US2 (views frozen against the export), then US5 (sample for Task B). US4 (gazetteer) runs alongside the whole time.
3. Commit as `A-02: …` after each green task group. Stop before Phase Z (Stage 6 runs it).

## Notes

- `[oracle]` = delegated to the `soofi-xyz-team-kit:oracle` builder subagent. Test tasks are written first and shown failing.
- The 🛑 tasks (T025 D-7, T054 D-8) stop for the PO.
- Never: upload, `--atlas-page`, Query DB reads, Homebrew elephant-cli, retry after a 403.

## Phase 9: Convergence

- [X] T069 [oracle] Add a `missing` list to `v_run` in `packages/query-core/views.sql` (at least `previous_manifest_cid → first_run` when `previousManifestCid` is null), update `packages/contract/src/columns.ts` (V_RUN), `contract/v1/columns.json` and `contract/v1/README.md`, and include `v_run` in the SC-007 no-blank loop of `packages/query-core/test/views.pilot.test.ts` (test first) per FR-007, SC-007 (partial)
- [X] T070 [oracle] Add a `limitations VARCHAR[]` column to `v_run` from the manifest's top-level `limitations[]` in `packages/query-core/views.sql` / `src/bind-manifest.ts`, with the column in `columns.ts`, `columns.json` and the README (test first) per spec Key Entities "Run view row … limitations" (partial)
- [X] T071 [oracle] Add `packages/query-core/gazetteer/**/*.ts` to the coverage include in `vitest.config.ts` so NFR-002 measures the gazetteer code, and record the figure in `docs/reports/A-02-unit-test-report.md` per NFR-002, SC-008 (partial)
