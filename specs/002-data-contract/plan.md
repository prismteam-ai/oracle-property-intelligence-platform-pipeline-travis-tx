# Implementation Plan: Freeze the property-intelligence data contract

**Branch**: `002-data-contract` | **Date**: 2026-10-20 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/002-data-contract/spec.md`

**Technical direction**: [agent-design.md](agent-design.md) (mew and oracle, word for word), with the PO decisions D-1 to D-4 from [run-log.md](run-log.md), copied in § PO decisions below.

## Summary

A-02 freezes `contract/v1`: the lexicon carrier verdicts, four DuckDB views, Zod schemas, the Travis/Austin roofing and status profile, the Travis place gazetteer, and 20 real sample rows. The names are frozen against a **real local pilot**: two small data groups (`county`, `property_improvement`) built by new TypeScript transforms. They go through the four `elephant-cli` steps (validate → hash with CAR → validate CAR → export-tables) with no upload, and are described by a local pilot manifest. Classification runs in the versioned profile at transform time and is published only as lexicon enum values. The views read those enums by equality, with no text matching. Work runs in three tracks: **A** pilot, carriers, views, contract and sample · **B** profile · **C** gazetteer.

## Data flow and integration points

```text
Austin 3syk-w9eu (SoQL, ≤1 req/s) ──► capture-austin ──► receipts + permit JSON ─┐
TCAD certified ZIP (A-01, streamed) ─► capture-tcad-subset (geoID = tcad_id) ─────┤
lexicon.elephant.xyz/api/manifest ──► lexicon-manifest (group schema CIDs) ───────┤
profiles/travis-austin@1.0.0 ──► classifyPermit/Status ──► classification ledger ┤
vendored roof-age estimator ──► roof-age ledger ──────────────────────────────────┤
                                                                                  ▼
          tcad-county.ts + austin-property-improvement.ts ──► groups/{county,property_improvement}
                                                                                  ▼
          elephant-cli: validate → hash --output-car → validate CAR → export-tables (no upload)
                                                                                  ▼
          tables/ + tables.car + tables-export.json ──► buildManifest() ──► pilot manifest + CIDv1
                                                                                  ▼
          query-core bindManifest() + views.sql ──► v_property / v_roofing_permit / v_contractor / v_run
                                                                                  ▼
          cut-sample ──► contract/v1/sample.parquet + README.md (git only)
Census 2024 Gazetteer + county files ──► build-gazetteer ──► travis-places@1.0.0 (git only)
```

The test approach is in Technical Context (Testing) and per phase in tasks.md: unit tests with fixtures first, then pilot-backed view tests gated on `PILOT_DIR`.

## PO decisions (copied from run-log.md)

| Stop | Question | Answer (word for word) | What it means for the plan |
|---|---|---|---|
| D-1 | AC-1 extension requests | "Drafted only (Recommended)" | Requests are drafted in `docs/decisions/0002-lexicon-carriers.md`, not filed |
| D-1 | G4 fixes 2–5 | "Apply, Ready if PASS (Recommended)" | AC-3/AC-5/AC-8/FR-003 wording as in the story |
| D-2 | Pilot `run_id`/`manifest_cid` | "Local pilot manifest (Recommended)" | `RunManifestV1` for `travis-pilot-20261020`, CIDv1 computed locally, never uploaded; committed as `contract/v1/pilot-manifest.json` |
| D-3 | Pilot slice | "42 + 5 + 3 older Final (Recommended)" | 42 Austin reroofs issued 2026-09 + 5 Expired BP reroofs (oracle § B list) + 3 older Final BP reroofs (for a non-zero roof age) + the TCAD parcels they point to (≤ 27) |
| D-4a | How Expired appears | "Empty means stalled (Recommended)" | Expired/Expired - License → published `improvement_status = null`; the view's `status_class = stalled` when status is null and the issue date is present. Excluded and needs_review permits are never emitted (transform assertion + test). The rule is in the generated status map and the README |
| D-4b | Trade sub-permits | "BP only (Recommended)" | `trade_permit` rule: `permittype ≠ BP` → never Roofing; published with its own trade `improvement_type` |
| D-4c | Names, no carrier, sample.parquet | "Yes to all three (Recommended)" | mew's names in every naming disagreement; no-carrier fields not published, reason `no_lexicon_carrier`; ARD deviation D-07 added (ARD 0.2.1) |

## Technical Context

**Language/Version**: TypeScript 6 (`tsc` 7 for typecheck, as in `pipeline/oracle-runtime`), Node ≥ 22, ESM

**Primary Dependencies**: `zod` ^4 (contract, profile, gazetteer); `@duckdb/node-api` (**test-only** devDependency of `query-core`, ARD § 9); `elephant-cli` pinned `github:elephant-xyz/elephant-cli#44bb182b9f7f904662e9b33e1fde70bdeab62322` (devDependency at the root); `multiformats` + `ipfs-unixfs-importer` (`pipeline/publish`, CID derivation); `stream-json`/the existing `zip-entry.ts` (TCAD streaming); `tsx` to run scripts

**Storage**: files only. The pilot output is in `pipeline/data/pilot/travis-pilot-20261020/` (gitignored). Committed: profile, gazetteer JSON, `contract/v1/*`. No Query DB use.

**Testing**: Vitest 5 + `@vitest/coverage-v8` (≥ 80% on `query-core` and `contract`). Pilot-backed view tests read `PILOT_DIR` and skip with an explicit message when it is absent.

**Target Platform**: the operator machine (macOS, local). No AWS in A-02.

**Project Type**: a pnpm workspace of libraries plus a pipeline CLI (no app).

**Performance Goals**: the TCAD subset scan streams the 29.9 GB entry in one pass ("minutes"); the AC-5 measurement pages about 22k rows at ≤ 50,000 per page.

**Constraints**: stop on 403; ≤ 1 request/s per permit GET; no upload; CIDv1 only; no `LIKE`/`ILIKE`/`regexp`/`~`/profile term in `views.sql`; no `pg` import in `packages/*` or `pipeline/publish`.

**Scale/Scope**: pilot of 50 permits and ≤ 27 parcels; AC-5 over the full Austin dataset (2,380,939 rows on 2026-10-20) without ingesting it.

## Kit Agent Ownership *(mandatory, constitution XIII–XVII)*

Copied from `stories/A-02-data-contract.md` and [agent-design.md](agent-design.md).

| Role | Agent(s) | Skills loaded | What it decided (cite agent-design.md) |
|------|----------|---------------|----------------------------------------|
| Design consult | `mew` | `use-neutral-lexicon` (run by the PO, A-1), `apply-engineering-guidelines` | Carrier verdicts (mew § A.2: 8 of 9 no carrier, owner sale date carried), drafted extension requests (§ A.3), the AD-07 column lists of all four views (§ B), the missing-reason enum (§ B.7), naming patterns (§ C) |
| Design consult | `oracle` | `use-oracle`, `apply-engineering-guidelines` | Pilot layout and the exact eight CLI commands (oracle § A), the slice (§ B), the local manifest and its CID (§ C), the profile and gazetteer as digested code (§ D), classification at transform time with enum-only views (§ D.3), AC-5 measurement and AC-3 sampling (§ E) |
| Builder | `oracle` | `use-oracle`, `build-county-transform`, `county-seed-data`, `county-permit-adapter`, `apply-engineering-guidelines` (track A also uses the lexicon references loaded at A-1) | Builds tracks A, B and C, tests first |
| Reviewer(s) | `oracle`, `donphan` | — | Score 0–100 (≥ 75): oracle on pipeline sequence, provenance, profile digests; donphan on published-data shape, counts, column names and missing reasons |
| Verify | Vitest on views; `contract/v1/sample.parquet` readable | — | No hosted runtime until A-03 (G4 C-04 exception): `pnpm vitest packages/query-core` over the pilot tables, `duckdb -c "SELECT count(*) FROM 'contract/v1/sample.parquet'"` = 20, the carrier record. Hosted later by A-13 and A-15 |

**Patterns the code must show** (from the builders' answers):

| Pattern | Where |
|---|---|
| Fixed order validate → hash → validate CAR → export-tables; non-zero exit stops; a test asserts the order (oracle F.1) | `pipeline/publish/src/sequence.ts`, `pipeline/publish/test/sequence.test.ts` |
| One CAR per data group; seed files in every group, byte-identical; `property.json` byte-identical in both groups (oracle A.2, R11) | `pipeline/oracle-runtime/travis/transforms/*` |
| Provenance captured, never reconstructed: per-permit GET receipts → `source_http_request` | `pipeline/oracle-runtime/travis/pilot/capture-austin.ts` |
| Key exactly as printed: `pID`; `tcad_id` = `geoID` as strings; ambiguous matches stay unlinked (oracle A.4) | `pipeline/oracle-runtime/travis/pilot/capture-tcad-subset.ts` |
| Stop on 403/challenge → `blocked` receipt | both capture scripts, via `travis/lib/source-client.ts` |
| Data-group root names from the live lexicon manifest at run time (oracle F5) | `pipeline/oracle-runtime/travis/transforms/lexicon-manifest.ts` |
| TCAD confidentiality applied before `validate` (P0-15, oracle R14) | `tcad-county.ts` |
| Classification only in the profile; published as lexicon enums; excluded/needs_review never emitted (D-4a) | `profiles/travis-austin@1.0.0/`, `austin-property-improvement.ts` |
| Profile and gazetteer digests: canonical JSON → SHA-256, `DIGEST` committed, drift test (AD-26) | `profiles/travis-austin@1.0.0/index.ts`, `packages/query-core/gazetteer/travis-places@1.0.0/index.ts` |
| Exact lexicon names; only aliases `issue_date`, `final_date` in one `ALIASES` map (mew C.2) | `packages/contract/src/columns.ts` |
| One column list → Zod row schemas, README table, view-shape test (mew C.7) | `packages/contract/src/columns.ts`, `contract/v1/README.md` |
| Views read only `export-tables` output, join only through relationship tables, filter by enum equality (mew C.6, C.9) | `packages/query-core/views.sql` |
| No `LIKE`/`ILIKE`/`regexp`/`~`/profile term in views; grep test (FR-009) | `packages/query-core/test/no-text-classification.test.ts` |
| `as_of` = manifest `finishedAt`, never `now()` | `packages/query-core/src/bind-manifest.ts` |
| Missing data says why: every row's `missing` list (mew B.1, B.7) | `views.sql`, `packages/contract/src/provenance.ts` |
| CIDs re-derived and compared by multihash digest (oracle C) | `pipeline/publish/src/manifest.ts` |

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design. Mark each ✅ / ❌ / N/A; every ❌ needs a row in Complexity Tracking.*

| # | Article | Check for this plan | Status |
|---|---------|---------------------|--------|
| I | Outcome first | No hosted runtime until A-03 (G4 C-04 exception, PO-accepted 2026-10-20). Real Travis data only: Austin `3syk-w9eu`, TCAD 2026 certified export, Census 2024 Gazetteer. Hosted proof later: A-13 (SQL panel), A-15 (MCP `get_schema`) | N/A (justified exception) |
| II–IV | Stack | All new code is TypeScript; the kit's tools (elephant-cli, the vendored estimator) run as provided. No CDK and no AWS in A-02. A minimal pnpm workspace (no Turborepo); metagross adopts it in A-03 (Complexity Tracking). No api-client yet | ✅ / ❌ (Turborepo deferred, tracked) |
| V–VI | Contracts and LLM | Zod on every external input: Socrata rows, TCAD records, Census rows, the lexicon manifest, profile and gazetteer files, `RunManifestV1`/`RunsIndexV1`/`Provenance`/view rows. No LLM call in A-02 | ✅ / N/A |
| VII–IX | Operations | Source fetches are bounded: 1 request/s, concurrency 1, backoff 1 s / 60 s / 5 attempts, stop on 403. They are one-off local scripts, not queued Lambdas, so there is no DLQ, alarm or Powertools in A-02 (no Lambda exists) | ✅ / N/A |
| X | Quality gates | Vitest, ESLint, Prettier and `tsc` run locally; no CI until A-03 (G7 C-02 exception). Playwright N/A (no hosted URL) | ✅ / N/A (justified exception) |
| XI | Data honesty | Every view row carries `source_url`, `captured_at`, `table`, `table_cid`, `run_id`, `manifest_cid` and a `missing` list with a reason for every empty or uncarried field. The pilot CIDs are labelled "local, unpublished". Assumptions are listed in spec.md | ✅ |
| XII | Secrets | No secrets needed (public Socrata without a token at ≤ 1 request/s; public Census and lexicon manifest). Captures, CARs and Parquet stay gitignored except the D-07 sample | ✅ |
| XIII–XV | Owner agents | Kit Agent Ownership filled; `agent-design.md` holds mew and oracle word for word; builder patterns are listed with paths; `/speckit-implement` delegates each group to `soofi-xyz-team-kit:oracle` | ✅ |
| XVI | Owner review | `oracle` and `donphan` score the branch read-only in `docs/reviews/CR-A-02.md`; < 75 blocks the merge (D-9) | ✅ |
| XVIII–XXIII | Delivery | G4 PASS (2026-10-20); G5 and G6 before implement; tests first and failing first; branch `002-data-contract`, merged `--no-ff` after G7; defects from ERR-9 | ✅ |
| Addendum | Task A (A1–A8) | **A1:** transforms follow `build-county-transform`/`county-seed-data`/`county-permit-adapter`; the kit estimator is vendored unmodified (SHA-256 in `VENDORED.md`). **A2:** only `elephant-cli` output shapes the contract; no Query DB; nothing uploaded. **A3:** CIDv1 everywhere; the pilot manifest CID is a raw-leaves CIDv1. **A4:** the pilot manifest lists CARs, the tables directory with its `carCid`, and part CIDs. **A5:** no contractor identity is asserted (`unresolved` by default); BBB not checked. **A6:** stop on 403, no bypass. **A7:** no cloud resources. **A8:** only the kit-bundled skills | ✅ |

**Post-design re-check (after Phase 1):** unchanged. One new P0 interaction was found and handled: the sample Parquet in git is deviation D-07 (ARD 0.2.1).

## Project Structure

### Documentation (this feature)

```text
specs/002-data-contract/
├── spec.md · run-log.md · agent-design.md
├── plan.md              # this file
├── research.md          # Phase 0
├── data-model.md        # Phase 1
├── quickstart.md        # Phase 1
├── contracts/           # Phase 1: views.md, manifest.md, profile.md, gazetteer.md
└── tasks.md             # /speckit-tasks
```

### Source Code (repository root)

```text
package.json  pnpm-workspace.yaml  tsconfig.base.json  vitest.workspace.ts   # new, minimal (no Turborepo)
packages/
├── contract/                 # FR-010 · Zod: RunManifestV1, RunsIndexV1, Provenance, view rows; columns.ts
│   ├── src/{columns,manifest,runs-index,provenance,rows,index}.ts
│   └── test/
└── query-core/               # FR-002, FR-007, FR-009 · views.sql, bindManifest(), derivations; gazetteer (FR-006)
    ├── views.sql
    ├── generated/travis-austin@1.0.0.status-map.sql
    ├── src/{bind-manifest,derive,index}.ts
    ├── gazetteer/travis-places@1.0.0/{sources,places,zctas,owner-area}.json, DIGEST, index.ts
    ├── scripts/build-gazetteer.ts
    └── test/
profiles/
└── travis-austin@1.0.0/      # FR-003–FR-005 · rules.json, expectations.json, DIGEST, index.ts, scripts/{measure,sample}.ts, CHANGELOG.md
pipeline/
├── oracle-runtime/           # existing npm package (A-01); adds:
│   ├── kit/use-oracle/runtime/src/roof-age/   # vendored estimator (unmodified) + VENDORED.md row
│   └── travis/
│       ├── pilot/{capture-austin,capture-tcad-subset,build-seed,run-pilot}.ts
│       ├── roof-age/travis-roof-age-profile.ts
│       └── transforms/{lexicon-manifest,tcad-county,austin-property-improvement,shared-seed}.ts
├── publish/                  # FR-011 · new workspace package
│   ├── src/{sequence,manifest,cid,jcs}.ts
│   └── test/
└── data/pilot/travis-pilot-20261020/   # gitignored output
contract/v1/README.md  sample.parquet  pilot-manifest.json  columns.json   # FR-008
docs/decisions/0002-lexicon-carriers.md                                      # FR-001
docs/evidence/A-02-classifier-review.md                                      # AC-3 review sheet
```

**Structure Decision**: this follows ARD AD-23's layout (`packages/{contract,query-core}`, `pipeline/{oracle-runtime,publish}`) without the app folders, which come with A-03. `pipeline/oracle-runtime` stays the existing npm package (A-01). It imports the profile through the workspace path, and the transforms live there because they extend the vendored kit runtime (A1). `profiles/` is top level because the story names `profiles/travis-austin@semver`, and both the runtime and `query-core` import it.

## Build tracks (§ 3a of the walkthrough)

| Track | FR / AC | Needs | Starts |
|---|---|---|---|
| **A** Pilot, carriers, views, contract, sample | FR-001, FR-002, FR-007, FR-008, FR-010, FR-011 (AC-1, 2, 7, 8) | the profile's `classifyPermit`/`published_encoding` for the PI transform (from B); lexicon manifest; pilot export | the workspace, contract schemas and captures at once; transforms once B's classifier exists; views after the pilot export |
| **B** Profile | FR-003, FR-004, FR-005, FR-009 (AC-3, 4, 5) | live Austin `3syk-w9eu` | at once |
| **C** Gazetteer | FR-006 (AC-6) | Census 2024 Gazetteer + county relationship files | at once |

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Art. IV: pnpm workspace without Turborepo | A-02 needs only two packages plus the profile and publish packages; the Turborepo scaffold belongs to metagross in A-03, which adopts this workspace | Scaffolding Turborepo now would pre-empt metagross's A-03 design (constitution XIV) |
| Art. I / X: no hosted runtime, no CI | Project story; the hosted site and CI arrive with A-03 (G4 C-04, G7 C-02 exceptions) | Standing up hosting in A-02 duplicates A-03 |
| P0-17: one Parquet file in git | AC-8 / ARD § 15: Task B needs 20 real rows in git | Deviation D-07 accepted by the PO (D-4c); every other Parquet file stays ignored |
| Pilot output is not published, yet rows carry CIDs | AC-8 needs non-null `table_cid`/`manifest_cid` before A-03 publishes | PO decision D-2: real local CIDv1 content addresses, labelled unpublished; replaced in A-03 |
