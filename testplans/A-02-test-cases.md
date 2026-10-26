---
id: QC-TC-A-02
type: test-cases
title: Freeze the property-intelligence data contract
parent: FEAT-A02
story: stories/A-02-data-contract.md
spec: specs/002-data-contract/spec.md
owner: HebaGaber             # QC Lead
status: Approved              # Draft → In Review → Approved
gate: G6
version: 0.2.2
created: 2026-10-21
runtime_url: "none: Project story (G4 C-04 exception); every case runs from a terminal at the repo root on branch 002-data-contract"
reviewed_code: 9fcffcf
qc_signoff: true
---

# Test Cases: A-02 Freeze the property-intelligence data contract

> Drafted with `developmentsupport-testcases` from the story's Given / When / Then ACs and the spec's FR numbering, **not** from `tasks.md`. A-02 has no hosted runtime until A-03 (G4 C-04 exception), so each case starts in a terminal at the repository root on branch `002-data-contract` and names the exact command and the exact expected output. Each case maps to one automated Vitest test titled with its TC ID (Vitest instead of Playwright: G6 C-09 exception). The commands are the ones fixed by the story's independent test and by the spec-level quickstart.

## 1. Feature overview

A-02 freezes `contract/v1`, which the CRM (Task B), the explorer, the agent and the MCP all read. It contains:
- the lexicon carrier verdict for each needed field;
- four DuckDB views with exact lexicon names over a real local pilot export;
- a versioned roofing and status profile;
- a Travis place gazetteer;
- 20 real sample rows.

The value validated: consumers build against names and meanings that will not change under them, and every gap says why.

## 2. Requirement mapping

| Source | Reference | Covered by |
| --- | --- | --- |
| Acceptance criterion | A-02-AC-1 | TC-001, TC-002, TC-003, TC-004, TC-005 |
| Acceptance criterion | A-02-AC-2 | TC-008, TC-009, TC-010 |
| Acceptance criterion | A-02-AC-3 | TC-012, TC-013, TC-014, TC-015 |
| Acceptance criterion | A-02-AC-4 | TC-016, TC-017, TC-018 |
| Acceptance criterion | A-02-AC-5 | TC-019, TC-NF-03 |
| Acceptance criterion | A-02-AC-6 | TC-020, TC-021, TC-022, TC-023 |
| Acceptance criterion | A-02-AC-7 | TC-024 |
| Acceptance criterion | A-02-AC-8 | TC-025, TC-026, TC-027 |
| Functional requirement | FR-001 (carrier verdicts) | TC-001, TC-002, TC-003, TC-004, TC-005 |
| Functional requirement | FR-002 (four views, AD-07 names, derived columns) | TC-008, TC-009, TC-010 |
| Functional requirement | FR-003 (reroof profile, 25-permit review) | TC-012, TC-013, TC-014, TC-015 |
| Functional requirement | FR-004 (status map, Expired never relabelled) | TC-016, TC-017, TC-018, TC-030 |
| Functional requirement | FR-005 (full-dataset count, SHA-256 stamp) | TC-019, TC-NF-03 |
| Functional requirement | FR-006 (gazetteer) | TC-020, TC-021, TC-022, TC-023 |
| Functional requirement | FR-007 (missing reason, never blank) | TC-024 |
| Functional requirement | FR-008 (20 sample rows, git only) | TC-025, TC-026, TC-027 |
| Functional requirement | FR-009 (no text classification in views) | TC-011 |
| Functional requirement | FR-010 (shared schemas) | TC-028 |
| Functional requirement | FR-011 (local pilot, no upload, pilot manifest) | TC-006, TC-007, TC-029 |
| NFR | NFR-001 (≥ 24/25, ≤ 5% needs_review, 0 solar/PV/RTU) | TC-012 (= TC-NF-01) |
| NFR | NFR-002 (≥ 80% coverage) | TC-NF-02 |

## 3. Assumptions

- The pilot run `travis-pilot-20261020` has been produced locally in `pipeline/data/pilot/travis-pilot-20261020/` (gitignored). Its slice is PO decision D-3: 42 Austin reroofs issued 2026-09, 5 Expired BP reroofs, 3 older Final BP reroofs, and their TCAD parcels.
- `PILOT_DIR=pipeline/data/pilot/travis-pilot-20261020` is set for the cases that read the pilot tables.
- The PO decisions D-1 to D-4 in `specs/002-data-contract/run-log.md` stand:
  - requests drafted only;
  - local pilot manifest;
  - Expired → published empty status, read as `stalled`;
  - BP-only reroofs;
  - mew's names;
  - the sample Parquet in git (ARD D-07).
- Austin `3syk-w9eu` changes daily, so every count is re-measured at run time and compared within that one run.

## 4. Scope

- **In scope:** the carrier record, the pilot export and manifest, the views and their columns, the profile (classification, status, scale count, review), the gazetteer, missing reasons, the sample file and README, and the shared schemas.
- **Out of scope:** the hosted UI, agent and MCP (A-03, A-13 to A-15); full-county ingestion (A-04 to A-10); publishing to IPFS (A-03, A-11).

## 5. Test data

- **Austin dataset `3syk-w9eu`** (`https://data.austintexas.gov/resource/3syk-w9eu.json`). Baselines:
  - 2026-10-19: 2,380,725 rows · 22,084 description matches for REROOF / RE-ROOF / ROOF REPLACE · 52 `work_class = 'Roof'`.
  - 2026-10-20: 2,380,939 rows.
  - Re-measured at run time.
- **Pilot permits:**
  - Expired BP reroofs: `2026-034767 BP`, `2026-029405 BP`, `2026-022834 BP`, `2026-022879 BP`, `2026-024100 BP`.
  - The null-`tcad_id` permit: `2026-122340 BP`.
  - Trade sub-permits in the September slice: 2 EP, 1 MP, 1 PP.
- **TCAD 2026 certified export** `2026 Certified JSON SUPP 0 07182026.zip`, entry `Travis-protaxExport-20260719.json`, key `pID`.
- **Census 2024 Gazetteer:**
  - Pflugerville city: GEOID **4857176**, internal point **30.447765, −97.602116**.
  - Also used: Manor, Lakeway and ZIP 78753 (found); ZIP 99999 and Georgetown (out of scope); Round Rock, Cedar Park and Leander (straddle the county line).
- **Data snapshot:** the pilot manifest `contract/v1/pilot-manifest.json` (local CIDv1, unpublished; recorded in the execution log).

## 6. Environment, risks and dependencies

- Terminal at the repo root on `002-data-contract`; Node ≥ 22, pnpm 10, DuckDB CLI. elephant-cli is pinned to commit 44bb182 (never Homebrew).
- The live lexicon MCP tools were failing on 2026-10-20. The verdicts use the live lexicon manifest and the CLI's schema cache (TC-005).
- A 403 from Austin or Census stops the run (TC-029). It is recorded, never retried under another identity.

## 7. Coverage matrix

| TC ID | Title | Priority | Tags | Type | Requirement(s) | Automated test |
| --- | --- | --- | --- | --- | --- | --- |
| A-02-TC-001 | Carrier record has a verdict for all 9 fields | P1 | @smoke | Doc/contract | AC-1, FR-001 | `a02.acceptance › "A-02-TC-001 …"` |
| A-02-TC-002 | Each carrier verdict cites a live schema entry and a pilot row | P1 | @integration | Data | AC-1, FR-001 | `"A-02-TC-002 …"` |
| A-02-TC-003 | Each no-carrier field has a fallback and a drafted (not filed) request | P1 | @missing-data | Doc | AC-1, FR-001 | `"A-02-TC-003 …"` |
| A-02-TC-004 | A carrier not emitted by the export → "no carrier (not emitted)" | P2 | @edge | Data | AC-1, FR-001 | `"A-02-TC-004 …"` |
| A-02-TC-005 | Lexicon tools down: verdicts cite the schema cache, never memory | P2 | @edge @error | Doc | AC-1, FR-001 | `"A-02-TC-005 …"` |
| A-02-TC-006 | Pilot: 8 CLI steps exit 0, clean validation, no upload | P1 | @integration | CLI | FR-011 | `"A-02-TC-006 …"` |
| A-02-TC-007 | Pilot manifest CID recomputes from the committed bytes | P1 | @integration | Data | FR-011, AC-8 | `"A-02-TC-007 …"` |
| A-02-TC-008 | Four views compile; columns equal the frozen list | P1 | @smoke | Data | AC-2, FR-002 | `"A-02-TC-008 …"` |
| A-02-TC-009 | Enum columns hold only their frozen values | P1 | @validation | Data | AC-2, FR-002 | `"A-02-TC-009 …"` |
| A-02-TC-010 | No-carrier fields are not columns | P2 | @negative | Data | AC-2, AC-7, FR-002 | `"A-02-TC-010 …"` |
| A-02-TC-011 | No text classification in views.sql | P1 | @negative | Static | FR-009 | `"A-02-TC-011 …"` |
| A-02-TC-012 | 25-permit classifier review by the PO | P1 | @demo | Manual + data | AC-3, FR-003, NFR-001 | `profile › "A-02-TC-012 …"` (sheet) |
| A-02-TC-013 | Auxiliary Power permit with "ROOF" is not roofing | P1 | @negative | Unit (real row) | AC-3, FR-003 | `"A-02-TC-013 …"` |
| A-02-TC-014 | Trade sub-permit with a re-roof term is not Roofing | P2 | @negative | Unit (real row) | AC-3, FR-003 | `"A-02-TC-014 …"` |
| A-02-TC-015 | Token-aware excludes: "OPPORTUNITY", "roof decking" | P2 | @edge | Unit (real rows) | AC-3, FR-003 | `"A-02-TC-015 …"` |
| A-02-TC-016 | Every AD-08 status word maps to its class | P1 | @validation | Unit | AC-4, FR-004 | `"A-02-TC-016 …"` |
| A-02-TC-017 | Unknown status word → needs_review | P1 | @negative | Unit | AC-4, FR-004 | `"A-02-TC-017 …"` |
| A-02-TC-018 | Expired pilot permit is stalled and never relabelled | P1 | @demo @missing-data | Data | AC-4, FR-004 | `"A-02-TC-018 …"` |
| A-02-TC-019 | Full-dataset reroof count equals matches minus excludes | P1 | @scale | Data (live) | AC-5, FR-005 | `profile › "A-02-TC-019 …"` |
| A-02-TC-020 | Gazetteer: Pflugerville, Manor, Lakeway, 78753 found with source | P1 | @smoke | Unit | AC-6, FR-006 | `"A-02-TC-020 …"` |
| A-02-TC-021 | Gazetteer: ZIP 99999 and Georgetown → out_of_scope | P1 | @negative | Unit | AC-6, FR-006 | `"A-02-TC-021 …"` |
| A-02-TC-022 | Gazetteer: straddling places flagged partial_in_travis | P2 | @edge | Unit | AC-6, FR-006 | `"A-02-TC-022 …"` |
| A-02-TC-023 | Gazetteer digest recomputes; sources stamped | P2 | @integration | Unit | AC-6, FR-006 | `"A-02-TC-023 …"` |
| A-02-TC-024 | No blanks: every empty value has a reason | P1 | @missing-data | Data | AC-7, FR-007 | `"A-02-TC-024 …"` |
| A-02-TC-025 | Sample file has exactly 20 rows | P1 | @smoke @demo | Data | AC-8, FR-008 | `duckdb` + `"A-02-TC-025 …"` |
| A-02-TC-026 | Sample rows: full provenance, ≥ 1 stalled, ≥ 1 roof age | P1 | @missing-data | Data | AC-8, FR-008 | `"A-02-TC-026 …"` |
| A-02-TC-027 | README documents every column and every gap | P2 | @doc | Doc | AC-8, FR-008 | `"A-02-TC-027 …"` |
| A-02-TC-028 | Schemas accept pilot rows, reject CIDv0 and gateway URLs | P1 | @validation @negative | Unit | FR-010 | `"A-02-TC-028 …"` |
| A-02-TC-029 | A 403 stops the capture with a blocked receipt | P2 | @error | Unit | FR-011, edge | `"A-02-TC-029 …"` |
| A-02-TC-030 | No excluded or needs_review permit is published | P1 | @negative | Data | FR-004, D-4a | `"A-02-TC-030 …"` |
| A-02-TC-NF-01 | Classifier accuracy ≥ 24/25, ≤ 1 needs_review, 0 solar/PV/RTU | P1 | @nfr | Manual + data | NFR-001 | = TC-012 |
| A-02-TC-NF-02 | Unit-test coverage ≥ 80% on query-core and contract | P1 | @nfr | Coverage | NFR-002 | `pnpm vitest --coverage` |
| A-02-TC-NF-03 | Profile SHA-256 stamped on every classification | P1 | @nfr | Data | AC-5, FR-005 | `"A-02-TC-NF-03 …"` |

Automated test titles live in `packages/query-core/test/acceptance/a02.acceptance.test.ts` (and `profiles/travis-austin@1.0.0/test/acceptance.test.ts` for the profile cases). Run one with `PILOT_DIR=pipeline/data/pilot/travis-pilot-20261020 pnpm vitest run -t "A-02-TC-0nn"`.

## 8. Functional test cases

Every case starts with: **Open** a terminal at the repository root and run `git branch --show-current`. Expected: `002-data-contract`. This is "step 0" below.

### A-02-TC-001: Carrier record has a verdict for all 9 fields (happy path)

- **Priority / tags:** P1 · `@smoke` · **Maps to:** AC-1, FR-001 · demo D-9, D-11
- **Preconditions:** step 0; the pilot has run.
- **Steps:**
  1. **Run** `grep -cE '^\| [1-9] +\| ' docs/decisions/0002-lexicon-carriers.md` → `9` (one row per field, numbered 1–9).
  2. **Run** `pnpm vitest run -t "A-02-TC-001"`.
- **Expected result:** exactly 9 field rows. Each has exactly one verdict ∈ {`carrier`, `no_carrier`, `no_carrier_not_emitted`}, and no field is missing or duplicated. Vitest: `1 passed`.

### A-02-TC-002: Each carrier verdict cites a live schema entry and a pilot row (integration)

- **Priority / tags:** P1 · `@integration` · **Maps to:** AC-1, FR-001
- **Test data:** expected carrier: owner sale date = `sales_history.ownership_transfer_date`.
- **Steps:**
  1. Step 0. **Open** `docs/decisions/0002-lexicon-carriers.md`. **Read** the owner sale date row → class.property `sales_history.ownership_transfer_date`, a schema source (the CLI schema cache with its CID), and a pilot row `{table: sales_history, cid: bafy…}`.
  2. **Run** `duckdb -c "SELECT cid, ownership_transfer_date FROM read_parquet('$PILOT_DIR/tables/county/sales_history/*.parquet') WHERE cid = '<cid from step 1>'"`.
- **Expected result:** one row, with the cited `cid` and a non-null `ownership_transfer_date` in `YYYY-MM-DD` form. Every `carrier` row in the record passes the same check (Vitest `"A-02-TC-002"`: 1 passed).

### A-02-TC-003: Each no-carrier field has a fallback and a drafted, unfiled request (missing data)

- **Priority / tags:** P1 · `@missing-data` · **Maps to:** AC-1, FR-001
- **Steps:**
  1. Step 0. **Open** the carrier record. **Read** the `status_raw` row.
  2. **Run** `pnpm vitest run -t "A-02-TC-003"`.
- **Expected result:**
  - `status_raw`: `no carrier`; fallback `AD-25: field not published, the UI shows the reason` (reason `no_lexicon_carrier`); a drafted extension request for `property_improvement.permit_status_text` with status **drafted (not filed; PO decision D-1)**.
  - Every other `no carrier` row has a fallback and a drafted request too.
  - Per-permit contractor state names fallback **AD-24** (`resolved`/`unresolved` per row plus five-state totals).
  - No row says "filed" unless D-8 changed it.

### A-02-TC-004: A carrier that the export does not emit → "no carrier (not emitted)" (edge)

- **Priority / tags:** P2 · `@edge` · **Maps to:** AC-1, FR-001, story edge case 2
- **Steps:**
  1. Step 0. **Run** `pnpm vitest run -t "A-02-TC-004"`. The test takes each `carrier` row, runs `DESCRIBE` on the cited pilot table, and also uses a fixture whose table lacks the property.
- **Expected result:** for the pilot, every `carrier` property is a column of its table. For the fixture without the column, the checker returns `no carrier (not emitted by the export)`, and the field does not appear in any view.

### A-02-TC-005: Lexicon tools down: verdicts cite the schema cache, never memory (edge, error)

- **Priority / tags:** P2 · `@edge @error` · **Maps to:** AC-1, FR-001, story edge case 1
- **Steps:**
  1. Step 0. **Open** the carrier record § Sources.
- **Expected result:** the record states that the live MCP schema tools returned "Internal error" on 2026-10-20. Every verdict names its source: the CLI schema cache (`~/.elephant-cli/schema-cache/<cid>.json`) or the live lexicon manifest, plus the pilot export. No verdict cites "memory", "assumed" or an unnamed source.

### A-02-TC-006: Pilot: 8 CLI steps exit 0, clean validation, no upload (integration)

- **Priority / tags:** P1 · `@integration` · **Maps to:** FR-011
- **Steps:**
  1. Step 0. **Run** `ls $PILOT_DIR/reports/` → `county-errors.csv`, `county-car-errors.csv`, `county-hash.csv`, `county-tables-export.json`, and the same four for `property_improvement`.
  2. **Run** `for f in $PILOT_DIR/reports/*errors.csv; do wc -l < "$f"; done` → `1` for each file (header only).
  3. **Run** `shasum -a 256 $PILOT_DIR/reports/*-tables-export.json` → two digests, equal to those in `specs/002-data-contract/run-log.md`.
  4. **Run** `grep -E "upload|--atlas-page" specs/002-data-contract/run-log.md`.
- **Expected result:**
  - All 8 recorded commands have exit code 0, and the error CSVs have no data rows.
  - Each `tables-export.json` lists a `property` table, and the property_improvement one lists `property_improvement` with rows ≥ 1.
  - No upload or `--atlas-page` command was ever run.
  - The recorded `countyRoot` equals the root printed by `hash`.

### A-02-TC-007: Pilot manifest CID recomputes from the committed bytes (integration)

- **Priority / tags:** P1 · `@integration` · **Maps to:** FR-011, AC-8
- **Steps:**
  1. Step 0. **Run** `pnpm vitest run -t "A-02-TC-007"`. It hashes `contract/v1/pilot-manifest.json` as a raw-leaves CIDv1.
- **Expected result:**
  - The CID starts with `bafkrei` and equals the `manifest_cid` in `contract/v1/sample.parquet` and in run-log.md.
  - The manifest parses as `RunManifestV1`, with `runId = "travis-pilot-20261020"` and `previousManifestCid = null`.
  - A limitation contains "pilot: local, unpublished".
  - Every `table` artifact CID equals the re-derived CID of its Parquet part.

### A-02-TC-008: Four views compile; columns equal the frozen list (happy path)

- **Priority / tags:** P1 · `@smoke` · **Maps to:** AC-2, FR-002 · demo D-4, D-12
- **Steps:**
  1. Step 0. **Run** `PILOT_DIR=pipeline/data/pilot/travis-pilot-20261020 pnpm vitest packages/query-core`.
- **Expected result:**
  - All test files pass, 0 failed, and `v_property`, `v_roofing_permit`, `v_contractor` and `v_run` all compile.
  - For each view, `DESCRIBE` equals `contract/v1/columns.json` (names, order, types). That includes `roof_age_years`, `roof_age_basis`, `tenure_years`, `tenure_basis`, `owner_is_out_of_area`, `owner_area_class`, `coordinate_source`, `issue_date`, `final_date`, `open_days`, `contractor_company_cid` and `bbb_status`.

### A-02-TC-009: Enum columns hold only their frozen values (validation)

- **Priority / tags:** P1 · `@validation` · **Maps to:** AC-2, FR-002
- **Steps:**
  1. Step 0. **Run** `pnpm vitest run -t "A-02-TC-009"`. It runs `SELECT DISTINCT` per enum column over the pilot views.
- **Expected result:** each distinct value set is a subset of:
  - `roof_age_basis` ⊆ {`permit`, `new_construction`, `built_year`, `unknown`}
  - `roof_age_confidence` ⊆ {`high`, `medium`, `low`, `none`}
  - `bbb_status` ⊆ {`rated`, `not_found`, `blocked`, `not_checked`}
  - `status_class` ⊆ {`open`, `stalled`, `closed`}
  - `owner_area_class` ⊆ {`in_county`, `regional`, `out_of_area`, `unknown`}
  - `coordinate_source` ⊆ {`gis_centroid`, `permit_point`, `none`}
  - `tenure_basis` ⊆ {`sale_date`, `unknown`}
  - `contractor_resolution` ⊆ {`resolved`, `unresolved`}

### A-02-TC-010: No-carrier fields are not columns (negative)

- **Priority / tags:** P2 · `@negative` · **Maps to:** AC-2, AC-7, FR-002
- **Steps:**
  1. Step 0. **Run** `grep -cE '"(status_raw|expiry_date|contractor_name_raw|bbb_rating|bbb_url|description|work_class_raw)"' contract/v1/columns.json` → `0`.
- **Expected result:** `0`. None of these is a view column in v1; each appears only as a `missing` entry with reason `no_lexicon_carrier` (TC-024).

### A-02-TC-011: No text classification in views.sql (negative)

- **Priority / tags:** P1 · `@negative` · **Maps to:** FR-009
- **Steps:**
  1. Step 0. **Run** `grep -inE "\b(i?like|similar to|regexp_[a-z_]+)\b|~|now\(\)|current_date|reroof|re-roof|roof replace|solar|photovoltaic|\brtu\b" packages/query-core/views.sql`.
  2. **Run** `pnpm vitest run -t "A-02-TC-011"`.
- **Expected result:** step 1 prints nothing (exit 1, no lines). Vitest: 1 passed. The views filter roofing only by `improvement_type = 'Roofing'` and `improvement_action = 'Replacement'`.

### A-02-TC-012: 25-permit classifier review by the PO (happy path, NFR-001)

- **Priority / tags:** P1 · `@demo` · **Maps to:** AC-3, FR-003, NFR-001
- **Test data:** population = Austin permits whose description or work class mentions ROOF, re-counted live (65,437 on 2026-10-20). Seed `travis-austin@1.0.0/AC-3/2026-10-21` (recorded).
- **Steps:**
  1. Step 0. **Run** `pnpm --filter ./profiles/travis-austin@1.0.0 sample` → `docs/evidence/A-02-classifier-review.md` is written with 25 rows (permit, work_class, status, description, verdict, reason), plus the seed, the population count, `captured_at` and the key-list SHA-256.
  2. The **PO marks** each row ✔ or ✘ in the sheet.
  3. **Count** the ✔ marks, the `needs_review` verdicts, and the solar/PV/RTU rows with verdict `roofing`.
- **Expected result:** ✔ ≥ 24 of 25; `needs_review` ≤ 1; 0 solar/PV/RTU accepted as roofing. Re-running step 1 with the same seed and population gives the same 25 permit numbers. On a fail: profile version bumped, new seed, re-review.

### A-02-TC-013: Auxiliary Power permit with "ROOF" is not roofing (negative)

- **Priority / tags:** P1 · `@negative` · **Maps to:** AC-3, FR-003
- **Test data:** one real Austin row picked at run time with `work_class = 'Auxiliary Power'` and "ROOF" in the description (10,322 such rows on 2026-10-20). Its permit number is recorded in the execution log.
- **Steps:**
  1. Step 0. **Run** `pnpm vitest run -t "A-02-TC-013"`.
- **Expected result:** the verdict is `not_roofing` with reason `aux_power`, never Roofing. No candidate in the AC-5 measurement has `work_class = 'Auxiliary Power'`.

### A-02-TC-014: Trade sub-permit with a re-roof term is not Roofing (negative)

- **Priority / tags:** P2 · `@negative` · **Maps to:** AC-3, FR-003, D-4b
- **Test data:** the September 2026 pilot EP permit `2026-089033 EP`, whose description mentions a full roof replacement.
- **Steps:**
  1. Step 0. **Run** `pnpm vitest run -t "A-02-TC-014"`.
- **Expected result:** the verdict is `not_roofing`, reason `trade_permit`. In the pilot's `property_improvement` table, that permit's `improvement_type` is its trade (`Electrical`, `MechanicalHVAC` or `Plumbing`), never `Roofing`, and it is absent from `v_roofing_permit`.

### A-02-TC-015: Token-aware excludes (edge)

- **Priority / tags:** P2 · `@edge` · **Maps to:** AC-3, FR-003
- **Test data:** real include-term rows whose description contains "OPPORTUNITY" (matches `%RTU%` naively), and one with "roof decking".
- **Steps:**
  1. Step 0. **Run** `pnpm vitest run -t "A-02-TC-015"`.
- **Expected result:** both stay `roofing` (no exclude reason). A real row with the token `RTU` or `SOLAR` is excluded with reason `rtu` / `solar_pv`. A real row with `work_class = 'Roof'` and no include term is `needs_review`.

### A-02-TC-016: Every AD-08 status word maps to its class (validation)

- **Priority / tags:** P1 · `@validation` · **Maps to:** AC-4, FR-004
- **Steps:**
  1. Step 0. **Run** `pnpm vitest run -t "A-02-TC-016"`.
- **Expected result:**
  - Active, Pending, Pending Permit, On Hold, Suspended, Inactive Pending Revision, Re Review → `open`.
  - Expired, Expired - License → `stalled`.
  - Final, Closed → `closed`.
  - VOID, Withdrawn, Cancelled, Cancelled - Duplicate (any `Cancelled*`), Aborted, Denied but Closed, Revoked, Rejected → `exclude`.
  - Every status word in the 22,084 include set (Final, VOID, Expired, Active, Withdrawn, Cancelled, Suspended, Re Review, Pending Permit on 2026-10-19) has a mapping.

### A-02-TC-017: Unknown status word → needs_review (negative)

- **Priority / tags:** P1 · `@negative` · **Maps to:** AC-4, FR-004, story edge case 3
- **Steps:**
  1. Step 0. **Run** `pnpm vitest run -t "A-02-TC-017"` (inputs "Archived" and "In Review").
- **Expected result:** both give `needs_review`, never a guessed class. A `needs_review` permit is not published (TC-030).

### A-02-TC-018: Expired pilot permit is stalled and never relabelled (missing data)

- **Priority / tags:** P1 · `@demo @missing-data` · **Maps to:** AC-4, FR-004 · demo D-11
- **Test data:** the 3 published Expired BP reroofs `2026-029405 BP`, `2026-022834 BP`, `2026-022879 BP` (issued March 2026). The other 2 Expired pilot permits are not published: `2026-034767 BP` (ambiguous_geoid) and `2026-024100 BP` (no_tcad_geoid). Test-data update v0.2.1, 2026-10-21, after the pilot; the AC is unchanged.
- **Steps:**
  1. Step 0. **Run** `pnpm vitest run -t "A-02-TC-018"`. It reads the `v_roofing_permit` row with `permit_number = '2026-029405 BP'`.
- **Expected result:**
  - `improvement_status` is null, never `Completed` or `Cancelled`; `status_class = 'stalled'`; `open_days` = `as_of − issue_date` ≥ 0 when the permit has no `final_date`; with a plausible `final_date` it is null with reason `not_open`, and with a `final_date` before `issue_date` or after `as_of` it is null with reason `needs_review` (ERR-70; pinned by query-core `test/open-days-finished.test.ts` and `test/derive.test.ts`).
  - `missing` contains `{field: "status_raw", reason: "no_lexicon_carrier"}` and `{field: "expiry_date", reason: "no_lexicon_carrier"}`.
  - `source_url` is the Socrata record URL showing "Expired".
  - The same holds for all 3 published Expired pilot permits.

### A-02-TC-019: Full-dataset reroof count equals matches minus excludes (scale)

- **Priority / tags:** P1 · `@scale` · **Maps to:** AC-5, FR-005
- **Test data:** live `3syk-w9eu`. Baseline 2,380,725 rows and 22,084 matches on 2026-10-19.
- **Steps:**
  1. Step 0. **Run** `pnpm --filter ./profiles/travis-austin@1.0.0 measure`.
  2. **Run** `cat profiles/travis-austin@1.0.0/expectations.json`.
- **Expected result:** `expectations.json` holds `measured_at` (today), `dataset_rows` (≥ 2,380,939), `include_matches` (≥ 22,084, the live value) and `excluded {aux_power, solar_pv, rtu, roof_mounted, roof_deck}`, `trade_permits`, `needs_review` and `candidates`. Also:
  - `candidates = include_matches − Σexcluded − trade_permits − needs_review`, exactly, from one run;
  - the fetched include rows = the live `count(*)`;
  - candidates with `work_class = 'Auxiliary Power'` = 0, and the full ROOF ∧ Auxiliary Power count (10,322 on 2026-10-20) is recorded as excluded or non-matching;
  - `rules_sha256` = the content of `profiles/travis-austin@1.0.0/DIGEST`.

### A-02-TC-020: Gazetteer: Pflugerville, Manor, Lakeway, 78753 found with source (happy path)

- **Priority / tags:** P1 · `@smoke` · **Maps to:** AC-6, FR-006
- **Steps:**
  1. Step 0. **Run** `pnpm vitest run -t "A-02-TC-020"`.
- **Expected result:**
  - "Pflugerville" → `{status:'found', kind:'place', geoid:'4857176', point:{lat:30.447765, lon:-97.602116}}`.
  - "Manor", "Lakeway" and "78753" → `found`, each with the Census internal point from the 2024 Gazetteer files.
  - Each result carries `source.url` (census.gov file URL), `source.file_date` (Last-Modified, e.g. 2024-08-30), `source.sha256`, and `gazetteer.version = "travis-places@1.0.0"` with its SHA-256.

### A-02-TC-021: Gazetteer: ZIP 99999 and Georgetown → out_of_scope (negative)

- **Priority / tags:** P1 · `@negative` · **Maps to:** AC-6, FR-006
- **Steps:**
  1. Step 0. **Run** `pnpm vitest run -t "A-02-TC-021"`.
- **Expected result:** "ZIP 99999", "99999" and "Georgetown" (Williamson County) → `{status:'out_of_scope'}` with **no** `point` field. No nearest or guessed point is returned.

### A-02-TC-022: Gazetteer: straddling places flagged partial_in_travis (edge)

- **Priority / tags:** P2 · `@edge` · **Maps to:** AC-6, FR-006, story edge case 4
- **Steps:**
  1. Step 0. **Run** `pnpm vitest run -t "A-02-TC-022"`.
- **Expected result:** "Round Rock", "Cedar Park" and "Leander" → `found` with `partial_in_travis: true`, and `counties` lists 48453 plus Williamson (48491).

### A-02-TC-023: Gazetteer digest recomputes; sources stamped (integration)

- **Priority / tags:** P2 · `@integration` · **Maps to:** AC-6, FR-006
- **Steps:**
  1. Step 0. **Run** `cat packages/query-core/gazetteer/travis-places@1.0.0/DIGEST`.
  2. **Run** `pnpm vitest run -t "A-02-TC-023"`.
- **Expected result:** the recomputed SHA-256 equals `DIGEST`. `sources.json` lists each Census file with url, Last-Modified, retrieved_at, bytes and sha256. No raw Census file is committed (`git ls-files pipeline/data/raw/census` prints nothing).

### A-02-TC-024: No blanks: every empty value has a reason (missing data)

- **Priority / tags:** P1 · `@missing-data` · **Maps to:** AC-7, FR-007
- **Steps:**
  1. Step 0. **Run** `pnpm vitest run -t "A-02-TC-024"`. It checks every row and every nullable column of the four pilot views.
- **Expected result:**
  - For each row and column, the value is non-null, **or** the row's `missing` contains `{field: <column>, reason: <enum value>}`.
  - Every `v_roofing_permit` row has `bbb_status = 'not_checked'` and `bbb_status_reason` ∈ {`contractor_unresolved`, `no_lexicon_carrier`}.
  - The contractor reads "not published · no lexicon carrier" (reason `no_lexicon_carrier`).
  - A property without a dated sale has `tenure_basis = 'unknown'` and `is_long_tenure` null with reason `no_dated_sale`. It is never "long tenure".
  - A closed permit has `open_days` null with reason `not_open`; so does an open or stalled permit with a plausible `final_date` (ERR-70).

### A-02-TC-025: Sample file has exactly 20 rows (happy path)

- **Priority / tags:** P1 · `@smoke @demo` · **Maps to:** AC-8, FR-008
- **Steps:**
  1. Step 0. **Run** `duckdb -c "SELECT count(*) FROM 'contract/v1/sample.parquet'"`.
- **Expected result:** the output table shows `20`. `git ls-files '*.parquet'` lists only `contract/v1/sample.parquet` (ARD D-07).

### A-02-TC-026: Sample rows: full provenance, ≥ 1 stalled, ≥ 1 roof age (missing data)

- **Priority / tags:** P1 · `@missing-data` · **Maps to:** AC-8, FR-008
- **Steps:**
  1. Step 0. **Run** `duckdb -c "SELECT count(*) FILTER (WHERE source_url IS NULL OR captured_at IS NULL OR \"table\" IS NULL OR table_cid IS NULL OR run_id IS NULL OR manifest_cid IS NULL) AS null_prov, count(*) FILTER (WHERE status_class='stalled') AS stalled, count(*) FILTER (WHERE roof_age_years IS NOT NULL) AS with_roof_age, count(DISTINCT run_id) AS runs FROM 'contract/v1/sample.parquet'"`.
- **Expected result:** `null_prov = 0`, `stalled ≥ 1`, `with_roof_age ≥ 1`, `runs = 1` (`travis-pilot-20261020`). Each row is one roofing permit with its property's columns.

### A-02-TC-027: README documents every column and every gap (documentation)

- **Priority / tags:** P2 · `@doc` · **Maps to:** AC-8, FR-008
- **Steps:**
  1. Step 0. **Run** `pnpm vitest run -t "A-02-TC-027"`.
- **Expected result:** every column of `sample.parquet` (`DESCRIBE`) appears in the `contract/v1/README.md` column table with type, meaning, source and missing reason. Every no-carrier field from the carrier record appears in its gaps section with the fallback. The README also states:
  - the "empty status means stalled" rule;
  - that the pilot CIDs are unpublished local content addresses, replaced in A-03;
  - how to recompute `manifest_cid`;
  - the v1/v2 change rule;
  - "never published to IPFS or shown on the hosted site".

### A-02-TC-028: Schemas accept pilot rows, reject CIDv0 and gateway URLs (validation, negative)

- **Priority / tags:** P1 · `@validation @negative` · **Maps to:** FR-010
- **Steps:**
  1. Step 0. **Run** `pnpm vitest run -t "A-02-TC-028"`.
- **Expected result:**
  - The row schemas parse 100% of pilot view rows and `contract/v1/pilot-manifest.json`.
  - `RunManifestV1` rejects a manifest with a `Qm…` (CIDv0) artifact CID, error path `artifacts.0.cid`.
  - A `sources.0.url` or artifact field holding `https://ipfs.io/ipfs/bafy…` → parse fails with an issue at that field's path, message starting "gateway URLs are derived, never stored".
  - A `directory` artifact without `carCid` → parse fails with an issue at path `artifacts.<n>.carCid`, message starting "directory artifacts need carCid".
  - A top-level `ipns` field → parse fails with an `unrecognized_keys` issue naming `ipns` at the root.

### A-02-TC-029: A 403 stops the capture with a blocked receipt (error handling)

- **Priority / tags:** P2 · `@error` · **Maps to:** FR-011, edge case "Austin or Census answers 403"
- **Steps:**
  1. Step 0. **Run** `pnpm vitest run -t "A-02-TC-029"` (a stubbed source answers 403 on a later permit GET; the test uses the 4th).
- **Expected result:** the capture stops after the 403. One receipt has `status: 403` and `outcome: blocked`, with no retry and no changed user agent. No group directory or CLI step runs afterwards, and the run reports it as blocked with the URL.

### A-02-TC-030: No excluded or needs_review permit is published (negative)

- **Priority / tags:** P1 · `@negative` · **Maps to:** FR-004, D-4a
- **Steps:**
  1. Step 0. **Run** `pnpm vitest run -t "A-02-TC-030"`. It compares the pilot `property_improvement` table with the classification of the captured permits.
- **Expected result:** every published permit's class is ∈ {`open`, `stalled`, `closed`}. Every published row with a null `improvement_status` has a non-null `permit_issue_date` and an Expired source word in its capture. A capture classed `exclude` or `needs_review` has no row in the export, and is counted in the pilot manifest `coverage`.

### A-02-TC-NF-02: Unit-test coverage ≥ 80% on query-core and contract (NFR)

- **Priority / tags:** P1 · `@nfr` · **Maps to:** NFR-002
- **Steps:**
  1. Step 0. **Run** `pnpm vitest run --coverage packages/query-core packages/contract`.
- **Expected result:** the coverage summary shows ≥ 80% statements, branches, functions and lines for each of `packages/query-core/src` and `packages/contract/src`.

### A-02-TC-NF-03: Profile SHA-256 stamped on every classification (NFR)

- **Priority / tags:** P1 · `@nfr` · **Maps to:** AC-5, FR-005 (AD-26)
- **Steps:**
  1. Step 0. **Run** `pnpm vitest run -t "A-02-TC-NF-03"`.
- **Expected result:** the DIGEST recomputed from `rules.json` equals `profiles/travis-austin@1.0.0/DIGEST`. That value is in:
  - every classification result;
  - `expectations.json` `rules_sha256`;
  - the pilot manifest `profiles[]` (`travis-austin`, `1.0.0`);
  - every `v_roofing_permit` row's `profile_sha256`.

## 9. Edge cases

- The live lexicon tools are down → verdicts from the schema cache and the pilot export, never memory (TC-005).
- A carrier exists but is not emitted → "no carrier (not emitted)" (TC-004).
- A new status word → `needs_review`, not published, profile version bumped when mapped (TC-017, TC-030).
- A place straddles the county line → `partial_in_travis` (TC-022).
- A permit with a null `tcad_id` (`2026-122340 BP`) → kept unmatched with a reason, counted, never linked to a guessed parcel (checked in TC-006's run log counts).
- The dataset grows between count and fetch → re-measured in one run; never compared with yesterday's number (TC-019).

## Changes

- **0.2.2 (2026-10-21, after the Stage 6 run; expected-value wording only, no AC change):** TC-001 grep matches the numbered verdict rows and the verdict spellings `no_carrier`/`no_carrier_not_emitted`; TC-014 names the real EP permit; TC-020 version string `travis-places@1.0.0`; TC-029 stub blocks a later (4th) GET.
- **0.2.1 (2026-10-21):** TC-018 uses the 3 published Expired permits.

## 10. Gap-linked cases (expected to fail until fixed)

| TC ID | Asserts | Gap | Defect |
| --- | --- | --- | --- |
| A-02-TC-004 | a carrier the export does not emit becomes `no_carrier_not_emitted` | no automated checker (rule applied by hand) | ERR-9 |

## 11. Execution log (filled in Stage 6)

| TC ID | Run date | Build (sha) | Result | Evidence | Defect |
| --- | --- | --- | --- | --- | --- |
| A-02-TC-001 … NF-03 | | | | `docs/reports/A-02-test-report.md` | |

---

## Gate G6: Test Case Approval

| # | Criterion | Status |
| --- | --- | --- |
| G6-1 | Every AC and every FR maps to at least one TC (§ 2 and § 7) | ☑ |
| G6-2 | Happy, negative, edge and missing-data paths covered | ☑ |
| G6-3 | NFRs have test cases with measurable pass criteria | ☑ |
| G6-4 | Every case is a complete sequence starting from the hosted URL | ☑ |
| G6-5 | Negative cases state the exact message or rejection behavior | ☑ |
| G6-6 | Test data and environment documented, with real records | ☑ |
| G6-7 | Every TC traces to the story and a requirement | ☑ |
| G6-8 | AI pre-check (`developmentsupport-g6-precheck`): PASS | ☑ |

**Decision:** ☑ Approved ☐ Returned · HebaGaber (QC Lead) · 2026-10-21 (G6 run 2 PASS; C-05 and C-09 exceptions: Project story, terminal start, Vitest instead of Playwright)
