---
id: PLAN-A-04
type: implementation-plan
parent: A-04
parts: [A-04, A-05, A-06]
spec: specs/004-property-backbone/spec.md
design: specs/004-property-backbone/agent-design.md
tests: testplans/A-04-test-cases.md
decisions: [specs/004-property-backbone/run-log.md (Round 1), docs/decisions/DEC-A-01-parcel-gap-exception.md, docs/decisions/0002-lexicon-carriers.md, docs/decisions/DEC-A-04-gis-runner.md (written in Phase 7)]
gate: G5
created: 2026-10-21
---

# Implementation Plan: Load the county backbone: TCAD properties and owners, coordinates, and permits from every jurisdiction

**Branch**: `004-property-backbone` | **Date**: 2026-10-21 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification `specs/004-property-backbone/spec.md` (Round 1 applied, no markers); technical direction from [agent-design.md](agent-design.md) (oracle, word for word, plus the Stage 0 lead notes) and the PO's Round 1 decisions ([run-log.md](run-log.md) 22:22–22:33). The fixed command, table, column and reason names come from `testplans/A-04-test-cases.md` v0.2 § 3.3–3.5 so the G6 cases run unchanged (exceptions listed in § "Names fixed with the test plan").

## Summary

Load all 493,246 accounts of the TCAD 2026 certified JSON export (A-01 file, SHA-256 `6f7a7585…4c2346`, re-hashed only when its size/mtime/inode summary changes) into the internal Query DB on the local Restate + Postgres stack, through the kit runtime's seams: stream the 3.5 GB entry once, check the record key inventory, **redact owner fields on every account with a sale-confidentiality code before anything is stored or validated** (D-7), map to the frozen `contract/v1` names, reconcile the loaded count to N with every difference classified (dead, invalid, transform failure; confidential accounts loaded and counted). Coordinates come from the Travis County GIS layer, paged **only on a GitHub-hosted US runner** by a fetch-only workflow (D-2) whose artifact the laptop imports offline; then the TCAD export point, then the condo / shared-geoID building rule `condo_building_point`, then the Austin permit point (Query DB only, D-9); everything else gets one internal reason. Austin permits (`3syk-w9eu`, 2.38 M rows) are backfilled by keyset pages of ≤ 50,000 rows at ≤ 1 request/s with no app token (D-8) in a durable Restate workflow, with per-row content digests, a re-stamp detector, key-set-diff tombstones, linking by geoID (address hash only when `tcad_id` is null), and classification only through the frozen profile `travis-austin@1.0.0`. The other 22 jurisdictions are listed as records request with their evidence URLs. A-04 publishes nothing: the coverage SQL runs over `v_property` bound to a **local** `elephant-cli export-tables` run of the County group (R accounts only, D-5), never uploaded.

## PO decisions carried into this plan (Round 1, 2026-10-21, copied from run-log.md)

| # | PO answer (word for word) | What the plan does |
| --- | --- | --- |
| D-1 | "99% of R (Recommended)" | AC-8 target = 99% of the 441,961 R accounts (≥ 437,542). The 51,285 non-land accounts (P/MH/MN) are counted separately with `coordinate_reason = non_land_account`. Condo / shared-geoID units get their building's point by `coordinate_rule = condo_building_point` (research R-05). Only frozen-contract `missing` reasons and `coordinate_source` values reach public rows. |
| D-5 | "Load all, measure R (Recommended)" | All 493,246 accounts load into `parcels` with `prop_type` (AC-2 denominator N). The coverage check and the County group cover R only; P/MH/MN are `out_of_scope` and not emitted. |
| D-7 | "Conservative rule + limitation (Recommended)" | No §25.025 owner flag exists in the JSON (full key scan) and no legacy data is on disk. Owner fields are redacted before validate on every account with any `sales[].confidentialCode` / `confidentialSale` (15,410 R): `owner_redacted = true`, `owner_redaction_rule = sales_confidential_code`, `owner_missing_reason = owner_confidential`. The property is loaded and counted, not subtracted. Limitations: `Confidential owner records redacted (Texas Tax Code §25.025): {n}` and `source export carries no §25.025 marker; conservative suppression on sale-confidentiality codes`. No confidential name in any output, log or evidence. |
| D-4 | "Keep as negative + add a real one (Recommended)" | geoID `0208011301` is not in the export: permit 1982-012866 BP stays the documented negative (`unmatched_reason = no_tcad_geoid`, kept and counted; `open_days` still computed). A second real anchor is picked in the pilot from Austin reroof permits whose `tcad_id` resolves (T062, logged in run-log.md). `0223120506` → pID 221829. |
| D-2 | "US GitHub runner, 2 pushes (Recommended)" | New `.github/workflows/a04-gis-capture.yml`: `on.push` to `004-property-backbone` with a `paths` filter (the workflow file and `travis/gis/runner-config.json`), `permissions: contents: read`, no secrets, egress country logged (`loc=` only), minimal `outFields` (IDs + geometry), artifact upload, never the Query DB. **Mode is the `mode` field of the pushed `runner-config.json`** (`"pilot"` on push 1, `"full"` on push 2), not a `-f mode=` dispatch input (see § "Names fixed with the test plan"). `if: false` after the full run; `docs/decisions/DEC-A-04-gis-runner.md`. |
| D-8 | "No token now (Recommended)" | No Socrata app token; ≤ 1 request/s; ✋ A-2 (token in `~/.config/assessment/`) only if 429s persist past the backoff budget. |
| D-9 | "Contract wins names, oracle mechanics (Recommended)" (all 15 oracle rows accepted; D-6 = reuse travis-places@1.0.0 gazetteer) | Frozen `contract/v1` + profile win on names and classification; oracle's design wins on mechanics. Disagreements #1–#15 are all applied (table below). Never geocode; a shared geoID is never silently linked. |
| NFR-002 | "Walkthrough numbers (Recommended)" | GIS concurrency ≤ 2; Austin ≤ 1 request/s; backoff 1 s base / 60 s cap / 5 attempts / full jitter; stop on the first 403 with no retry; no new TCAD download without a stop. |
| D-3 G4 | "Ready (Recommended)" | Story G4 approved 2026-10-21 22:30. |
| D-10 / D-11 | "Approve if PASS (Recommended)" | G5 / G6 recorded "Approved under Round 1 conditional approval" if the pre-checks PASS with only the § 1 exceptions. |
| Build order | "G-FIX first, then 3 parallel (Recommended)" | Phase 1 G-FIX (all three A-01 fixes + every shared seam), then ONE wave G-TCAD ‖ G-GIS ‖ G-PERMITS with disjoint files (§ "Build-wave file ownership"). |
| D-13 / D-14 / D-15 | "Approve if 7 conditions hold (Recommended)" ×2, "Approve if conditions hold (Recommended)" | Push, Austin backfill and TCAD full run start only if all seven pilot conditions hold (tasks Phase 6, T067). |
| Disk | "Delete after re-capture (Recommended)" | The spike pages `pipeline/data/raw/austin-full/` and `austin-parquet/` (≈ 5.1 GB) are deleted after the new backfill is captured and the spike baseline diff is recorded (T083). |

### Oracle disagreements (agent-design.md) as applied

| # | Applied as |
| --- | --- |
| 1 | `no_gis_feature`, `gis_null_geometry`, `no_permit_point`, `non_land_account`, `no_issue_date` are internal Query DB / report reasons; public rows use `no_coordinates` / `needs_review` / `out_of_scope`. |
| 2 | `permit_point` lives in `parcels` only; the County group never writes a permit point as geometry, so the public row reads `none` / `no_coordinates`. The Query DB vs public coverage difference = permit-point count (reported). |
| 3 | Confidential accounts loaded and counted (D-5/D-7). |
| 4 | AC-3 proved in the Query DB; v1 public `owner_area_class = unknown`, `not_in_export`. |
| 5 | No undated `sales_history`; owners without a dated sale stay in the Query DB with `no_dated_sale`. |
| 6 | County group emits R only; MH stay `out_of_scope` (PO may revisit at A-11). |
| 7 | Coordinate rank: GIS feature → export point → `condo_building_point` → `permit_point` → reason. |
| 8 | A4 meaning: `shared-seed.ts` `STATE_CODES` is extended only with a cited official PTD/TCAD code table; the condo rule does not depend on A4 (it uses the shared geoID, research R-05). |
| 9 | Kit ArcGIS adapter vendored unmodified with its imports + `@dsnp/parquetjs`; geometry through the injected `options.client`. |
| 10 | Spike pages are a fixture and digest baseline only; the backfill of record is re-captured. |
| 11 | `parcels.payload_redacted` + `record_sha256` of the original bytes. |
| 12 | Story order (permits before the Comptroller) accepted: no contractor row is written (Complexity Tracking). |
| 13 | `.gitignore` gets `pipeline/data` and `pipeline/local-stack/data` without trailing slash. |
| 14 | Reuse `packages/query-core/gazetteer/travis-places@1.0.0` (`ownerArea`, `GAZETTEER_SHA256`); no new list. |
| 15 | "R7 join proof" = 1,000-row geoID → pID proof plus 1,000-row reverse proof (seeded, exact strings, 0 disagreements). |

### Stage 0 export facts used by the design

- `geometry` is a non-empty `"[lat, lon]"` string on every record (R 441,961), against `with_geometry_point 380,461` in `travis-sources.yaml:68`. **T024 determines and records the definition** (e.g. placeholder `[0, 0]`, out-of-county or duplicate points) as `export_point_kind`; only `real` export points rank 2.
- Year built: `propertyProfile[0].imprvActualYearBuilt` (0 = missing), else `valuations[].details["cost-local"].improvements[]` (no main flag: the rule is "largest living area among residential main-improvement types"). R with no year built: 52,521.
- Sale date: `sales[].saleDt` (latest dated sale); none on 317,818 (R 266,553). Mailing: `owners[].addrZip`, `addrCountry`, `addrInternational`.
- Key `pID` distinct on all 493,246 records; R accounts sharing a geoID: 11,589 on 1,164 geoIDs; P accounts have an empty geoID.

## Technical Context

**Language/Version**: TypeScript 6.0 (`tsc` 7 for typecheck), Node.js 22, ES modules. Vendored kit files stay `.mjs` and unmodified (ARD D-03).

**Primary Dependencies**: Restate SDK 1.17 (single instance in `pipeline/local-stack`, type-only in `oracle-runtime`), `postgres` 3.4 (local-stack only), `stream-json` (export stream), `zod` 4 (strict export record schema, CLI args, runner config, report JSON), `p-limit`, `@dsnp/parquetjs` (pulled in by the vendored kit `backfill-inputs.mjs`), the vendored kit `permits/adapters/arcgis-feature-service.mjs` + `core/address-signature.mjs`, `profiles/travis-austin@1.0.0`, `packages/query-core` (`views.sql`, `bindManifest` with `partUrl`, gazetteer), `elephant-cli` pinned 44bb182 at `~/.local/share/elephant-cli-main` (validate / hash / export-tables only, no upload), DuckDB CLI 1.5.6 (local coverage SQL).

**Storage**: Local Postgres (`elephant` DB in `pipeline/local-stack/docker-compose.yml`) = the internal Query DB, migrations in `pipeline/local-stack/migrations/`. Captures under gitignored `pipeline/data/` (`raw/tcad/`, `raw/gis/us-runner-<run>/`, `artifacts/permits/travis/<jobId>/raw/pages/`, `runs/<jobId>/groups/county/`). Nothing in git except code, tests, small synthetic fixtures (labelled as test inputs) and docs.

**Testing**: Vitest in `pipeline/oracle-runtime` (all A-04 cases under `test/travis/a04/`, named `A-04-TC-nnn` as the G6 matrix requires; offline: `test/setup-no-network.ts` blocks the network) and in `pipeline/local-stack` (`test/`, SQL builders pure; DB integration tests run only when `QDB_TEST_URL` is set, against a throwaway schema). `elephant-cli validate` on the pilot and County group output; read-only `qdb_ro` and `restate sql` checks; the run report JSON.

**Target Platform**: Operator macOS (local stack) plus one GitHub-hosted `ubuntu-latest` US runner for GIS fetch only.

**Project Type**: Data pipeline (vendored kit runtime + Travis adapters, durable workflows, internal Query DB). No UI, no AWS.

**Performance Goals**: Austin backfill ≈ 48 pages, 25–45 min at ≤ 1 req/s; TCAD full load 30–60 min + per-pID zips 15–30 min; GIS full ≈ 187 pages at concurrency 2, 20–40 min on the runner; local validate → hash → export-tables of the County group 2–5 h (measure one 10k chunk first and project).

**Constraints**: NFR-002 etiquette (above; a missing or mismatched export stops the run in `WAITING_HUMAN` before any TCAD request); one ingest run at a time and one writer into the Query DB (P0-10); disk guard stops every step below 5 GiB free (24 GiB free at start; peak 15–20 GB); no source call from any test; no GIS request from the laptop; Query DB never exported, published or reachable from the runner (P0-1).

**Scale/Scope**: 493,246 accounts (R 441,961 · P 39,536 · MH 11,744 · MN 5); 373,683 GIS features; 2,381,226 Austin rows (22,084 reroof candidates); 23 jurisdictions.

## Kit Agent Ownership *(mandatory, constitution XIII–XVII)*

Copied from the story front matter (`stories/A-04-property-backbone.md`) and [agent-design.md](agent-design.md).

| Role | Agent(s) | Skills loaded | What it decided (cite agent-design.md) |
|------|----------|---------------|----------------------------------------|
| Design consult | `oracle` | county-seed-data, county-appraisal-onboarding, build-county-transform, county-ingest-run, use-oracle, query-db-loading-matching, county-permit-adapter, durable-workflow-builder, apply-engineering-guidelines | § 0 facts 1–10 (adapter not vendored; frozen `v_property` cannot show `permit_point`; closed reason list; mailing ZIP `not_in_export`; gazetteer exists; no Query DB schema; gitignore symlinks; A4 conflict); § 1 TCAD (key, mapping, year-built rule, redact-after-parse, reconciliation taxonomy, R-only emission, join proof, Restate fan-out, CR2-10); § 2 GIS (runner, injected geometry client, points, ranking, resume); § 3 permits (keyset pages, journal-replay resume, watermark count, content digest, re-stamp rule, tombstones, linking table, classification); § 4 G-FIX seams; § 5 run order; § 6 disk budget; disagreements #1–#15. |
| Builder G-FIX | `oracle` | durable-workflow-builder, query-db-loading-matching + apply-engineering-guidelines | A-01 fixes CR2-8, OR-N8, CR2-9; shared seams (§ 4). |
| Builder G-TCAD | `oracle` | county-seed-data, county-appraisal-onboarding, build-county-transform, county-ingest-run + apply-engineering-guidelines | AC-1 to AC-6 (§ 1). |
| Builder G-GIS | `oracle` | use-oracle, query-db-loading-matching + apply-engineering-guidelines | AC-7 to AC-11 (§ 2). |
| Builder G-PERMITS | `oracle` | county-permit-adapter, county-ingest-run, durable-workflow-builder + apply-engineering-guidelines | AC-12 to AC-17 (§ 3). |
| Reviewer(s) | `oracle`, `donphan` | — | oracle: kit patterns and seams (no vendored edit, Restate durability, single writer, StopOnBlocked, profile-only classification, redaction before validate, P0-1/5/7/9/10/15). donphan: counts and data honesty (roll reconciliation, coverage both ways, per-jurisdiction counts vs source totals, status split vs baseline, gap by reason, frozen public names). Each scores 0–100 (≥ 75) in `docs/reviews/CR-A-04.md` (TZ01). |
| Verify | `monitoring-county-ingestion` | monitoring-county-ingestion | Run complete; roll count matches (seed = ready + dead + invalid; loaded = N − dead/invalid, < 2%, 0 unexplained); coverage SQL ≥ 0.99 over R both ways; per-jurisdiction counts = source totals at the watermark (TZ05). Pipeline-only story: no hosted URL (G4/G6/G7 exceptions). |

Why G-FIX loads `durable-workflow-builder` and `query-db-loading-matching` (the walkthrough lists "none extra"): G-FIX now owns the Restate auto-registration and the single-writer `Loader` (oracle § 4, durable-workflow-builder patterns 8–9 and rule 3; query-db-loading-matching watermark/tombstone tables), which the walkthrough did not yet assign to it.

**Patterns the code must show** (from the builder's answer):

| Pattern | Group | Where |
| --- | --- | --- |
| Vendored kit files unmodified, hash rows in VENDORED.md, a test re-hashes them | G-FIX | `pipeline/oracle-runtime/kit/VENDORED.md`, `test/kit/vendored-a04.test.ts` |
| Restate auto-registration of every `services/workflows/*.ts` exporting `createService(restate)` | G-FIX | `pipeline/local-stack/services/app.ts` |
| `Loader` virtual object keyed `travis`, single writer, plug-in tracks, raised `inactivityTimeout` / `abortTimeout`, merge idempotency by `(track, artifact sha256)` | G-FIX | `pipeline/local-stack/services/loader.ts`, `services/tracks/*.ts` |
| Watermarks, tombstones, receipts, limitations tables; ordered migrations | G-FIX | `migrations/0000_core.sql`, `services/migrate.ts` |
| `CountyIngest`-style `TcadBackbone` workflow keyed `travis-a04-<jobId>` fanning out to `TcadChunk` children (~10k records), backpressure window, durable promise for `WAITING_HUMAN` | G-TCAD | `travis/tcad/workflow.ts`, `services/workflows/tcad-backbone.ts` |
| Strict export record schema + full key inventory (unknown key ⇒ run fails) | G-TCAD | `travis/tcad/key-inventory.ts`, `export-stream.ts` |
| Redaction immediately after parse, before mapping, storage and `validate` | G-TCAD | `travis/tcad/redact.ts` |
| Key = `String(pID)` as printed; geoID kept as a string with leading zeros | G-TCAD | `travis/tcad/fields.ts` |
| `ON CONFLICT (request_identifier) DO UPDATE … WHERE record_sha256 IS DISTINCT FROM excluded.record_sha256` (re-load writes 0 rows) | G-TCAD | `services/tracks/tcad.ts` |
| One `<pID>.zip` per County property; validate a directory of zips | G-TCAD | `travis/tcad/write-group.ts` |
| Fetch-only US-runner workflow; kit adapter with injected geometry client; snapshot/drift refusal kept; checkpoints + `actions/cache` resume; `complete.json` only on success | G-GIS | `.github/workflows/a04-gis-capture.yml`, `travis/gis/{runner-fetch,geometry-client}.ts` |
| Pure geometry: shoelace centroid with holes, point-in-polygon, polylabel interior point | G-GIS | `travis/gis/points.ts` |
| Coverage refused as complete without `complete.json` | G-GIS | `travis/gis/import.ts`, `services/workflows/gis-import.ts` |
| Keyset pages `$select=*,:id,:updated_at,:created_at`, `$order=:id`, `$where=:id > '<last>'`, `$limit=50000`; one `ctx.run` per page returning only `{lastId, sha256, rows, maxUpdatedAt}` | G-PERMITS | `travis/adapters/socrata/socrata-pages.ts`, `travis/permits/workflow.ts` |
| Content digest = SHA-256 of JCS without `:`-fields, `:@computed_region_*`, `issued_in_last_30_days`, `day_issued` | G-PERMITS | `travis/permits/content-digest.ts` |
| Re-stamp rule (window ≥ 50% of total, or ≥ 90% of window rows within 6 h) | G-PERMITS | `travis/permits/restamp.ts` |
| Key-set diff → `source_removed` tombstone; re-key ≠ tombstone | G-PERMITS | `travis/permits/keyset-diff.ts` |
| Classification only via `profiles/travis-austin@1.0.0` with its SHA-256 stamped; no reroof terms in adapters | G-PERMITS | `travis/permits/classify-run.ts` |
| Source client for every request: one UA, backoff 1 s / 60 s / 5 / full jitter, StopOnBlocked | all | `travis/lib/source-client.ts` |

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design (below the tables). Every ❌ or exception has a row in Complexity Tracking.*

| # | Article | Check for this plan | Status |
|---|---------|---------------------|--------|
| I | Outcome first | Pipeline-only story: publishes nothing, deploys nothing. Proof is in the PR (monitoring report, reconciliation, coverage SQL both ways, per-jurisdiction counts, receipts, test output); it shows live on the hosted Coverage page and Lead finder after A-11/A-13. All data is real Travis County data. Gate exception G4 C-04 / G7 C-04, C-07 (walkthrough § 1). | ✅ (exception, CT-1) |
| II | TypeScript everywhere | All new code TS; vendored kit `.mjs` as provided (D-03); no Python written (the kit readiness validator is not run in A-04). | ✅ |
| III | AWS, CDK only, region from config | No AWS resource in A-04. The GIS runner is a GitHub-hosted runner, not an AWS resource. | N/A |
| IV | Turborepo monorepo | `pipeline/oracle-runtime` and `pipeline/local-stack` stay npm projects outside the pnpm graph (A-02 R-11); `packages/query-core` and `profiles/*` imported by relative path as in A-03 (`run-month.ts`). | ✅ |
| V | Zod on every input | Zod: strict TCAD record schema, CLI args (`backbone` verbs), `runner-config.json`, GIS page bodies, Socrata page rows, report JSON, Loader track inputs. No `any` (ESLint rule from A-03 applies). | ✅ |
| VI | Vercel AI SDK | No LLM call. | N/A |
| VII | Queued external boundaries | Every source fetch: bounded concurrency (GIS ≤ 2, Austin 1 at ≤ 1 req/s), idempotent keys (page key / `:id` cursor / pID), backoff with full jitter, StopOnBlocked. Locally the Restate workflows give durability and retries; `blocked` receipts are the dead-letter record. The GIS runner job is outside Restate (fetch-only, checkpoints + cache resume). | ✅ (CT-2) |
| VIII | Observability | No Lambda. Structured JSON logs via `travis/lib/log.ts` with job_id, counts and durations only; no owner name, payload or connection string in any log (redaction before logging; TC-015 grep). | ✅ |
| IX | Alerting | No deployed component; `WAITING_HUMAN` and `blocked` are surfaced by `monitoring-county-ingestion` and the run report. | N/A |
| X | Quality gates in CI | `ci.yml` `oracle-runtime` job (Vitest, ESLint, Prettier, `tsc`) plus a new `local-stack` step (typecheck + Vitest); gitleaks; CI green on the pushed branch is required (G7 C-02 is not an exception). Playwright N/A (no hosted surface). Tests first (tasks). | ✅ |
| XI | Data honesty | Every row carries source URL, capture time, digest (`record_sha256` / page sha256 / `payload_sha256`) and `job_id`; every missing value has a reason (internal + frozen public); no geocoding; no invented sale or coordinate; assumptions in research.md. | ✅ **Amended 2026-10-25 (PO decision, ADR 0004):** one narrow exception, an exact and unique match of the situs to the City of Austin public address-point layer may give a point (rule `address_point`, lowest priority, never over a GIS point); nothing else is ever turned into a point and no geocoding service is used. |
| XII | No secrets | No secret used (no app token, no runner secret). The Query DB URL is read from env and never printed; `qdb_ro` uses `docker compose exec`. gitleaks in CI. | ✅ |
| XIII | Owner agents named | Story front matter lists design / builder / reviewers / verify / skills (AGENT-MAP § 4 row A-04). | ✅ |
| XIV | Owner designs it | [agent-design.md](agent-design.md) holds oracle's answer word for word; this section cites it. | ✅ |
| XV | Owner builds it | Each of the four groups runs as a `soofi-xyz-team-kit:oracle` builder subagent with its skills + apply-engineering-guidelines; patterns above mapped to paths. | ✅ |
| XVI | Owner reviews it | `oracle` and `donphan` score read-only in `docs/reviews/CR-A-04.md`, threshold 75 (TZ01). | ✅ |
| XVII | Toolchain matches router | oracle (build), donphan (review), monitoring-county-ingestion (verify) as in AGENT-MAP; `docs/kit-usage.md` line in close-out. | ✅ |
| XVIII | Gates | G4 approved (D-3); G5 (this plan + tasks) and G6 (`testplans/A-04-test-cases.md`) before `/speckit-implement`; G7 before merge. | ✅ |
| XIX | Traceability | Front matter on every artifact; commits `A-04: …`. | ✅ |
| XX | Branching | Work on `004-property-backbone`, merged `--no-ff` into `feature/oracle-pipeline` after G7; never `main`. | ✅ |
| XXI | Specs before code | No `[NEEDS CLARIFICATION]` left; GWT ACs; every task writes its failing test first. | ✅ |
| XXII | Independent tests | Test cases from the ACs (G6 draft written without tasks.md). They start from a terminal at the repo root (Vitest, run commands, `qdb_ro`) instead of the hosted URL: G6 exceptions C-05 / C-09. | ✅ (exception, CT-1) |
| XXIII | Defects are records | Every failing case → `docs/defects/ERR-{n}.md` (next ERR-21). | ✅ |
| A1 | Kit runtime, never reimplemented | Kit `use-oracle` runtime + stage skills extended through seams; ArcGIS adapter and address signature vendored unmodified (disagreement #9); Socrata grown by a new module beside A-03's (AD-17). | ✅ (CT-5) |
| A2 | Public data only from `elephant-cli` | Nothing uploaded. The local `validate → hash → export-tables` run of the County group is only for the coverage SQL; Query DB never exported. | ✅ |
| A3 | CIDv1 | No CID published in A-04; local `hash` output is CIDv1 by the CLI. | N/A |
| A4 | Manifest per run | A-04 writes no manifest; it writes the run's source limitations that A-11 copies into the manifest. | N/A |
| A5 | Contractor identity official only | No contractor row written; contractor fields stay in the raw payload (AD-06; disagreement #12). | ✅ (CT-4) |
| A6 | Source terms | Stop on 403 / challenge with a `blocked` receipt and no retry; no CAPTCHA or bot-check bypass; no IP / UA rotation; GIS from a US runner only because of a geo-block (ARD § 8), never after a 403. | ✅ |
| A7 | Zero idle cost | Nothing deployed; the runner workflow is disabled (`if: false`) after the full run. | ✅ |
| A8 | Kit-bundled skills only | Skills from `soofi-xyz-team-kit/skills/`; never `../skills`. | ✅ |

### ARD P0 rules (docs/architecture-constitution.md § 12)

| P0 | How this plan keeps it | Status |
| --- | --- | --- |
| 1 Access boundary | Query DB local only; never exported, published, or reachable from the runner (the workflow has no DB step and no secret); `qdb_ro` read-only; the local `export-tables` output is never uploaded; no connection string in `apps/` or `infra/` (TC-NF-02). | ✅ |
| 2 Only `elephant-cli`, in order | Local run uses validate → hash → validate CAR → export-tables, no step skipped; no upload. | ✅ |
| 3 CIDv1, immutable | No publication. | N/A |
| 4 No county pointer / "published to Atlas" | No publication; evidence text checked by the A-03 grep gate. | ✅ |
| 5 Key exactly as printed | `request_identifier = String(pID)`; geoID never normalised; 1,000-row join proof both ways. | ✅ |
| 6 Contractor identity official or nothing | No contractor identity in A-04. | ✅ |
| 7 Source terms | NFR-002; StopOnBlocked on every client; TC-016/017/026/053. | ✅ |
| 8 Roof age only from the kit estimator | Not derived in A-04 beyond `roof_age_basis = unknown` + reason for no year built (A-07 owns roof age). | ✅ |
| 9 Classification only in profiles | `classify-run.ts` imports the profile; CI grep gate for reroof terms in adapters (A-03) extended to `travis/permits/`, `travis/adapters/socrata/socrata-pages.ts`; Expired never relabelled. | ✅ |
| 10 One stack per run | Local Restate + Postgres only; one ingest run at a time; Loader is the only writer; runs sequenced in tasks Phase 8. | ✅ |
| 11 Provenance; missing says why | See XI; permit point never mislabelled publicly (disagreement #2). | ✅ |
| 12 No synthetic data on the hosted site | No hosted change; test fixtures labelled synthetic and never in `pipeline/data/`. | ✅ |
| 13 Free-form SQL only in the browser | No agent/MCP change. | N/A |
| 14 Verify gateways | No verify in A-04. | N/A |
| 15 TCAD confidentiality | D-7 conservative rule, redaction before storage and validate; grep proof (TC-015). | ✅ |
| 16 Zod on public endpoints | No public endpoint. | N/A |
| 17 No captures / Parquet / DB URLs in git | `.gitignore` fix (disagreement #13); GIS artifact minimal fields only; gitleaks. | ✅ |
| 18 TS, CDK, AI SDK only | TS only; no IaC; GitHub workflow YAML is CI config, not IaC. | ✅ |
| 19 Nothing bills while idle | Nothing deployed. | ✅ |
| 20 Only the hosted URL counts; never merge the PR | Pipeline-only exception (CT-1); PR never merged. | ✅ |

**Post-design re-check (after Phase 1):** unchanged, all ✅ / N/A with the exceptions CT-1…CT-8 below. The design adds no new violation: the runner artifact holds IDs and geometry only (no owner field), the `report` verb reads the Query DB through a Restate handler and prints counts only, and the County group zips go only to the local CLI.

## Names fixed with the test plan (G6 v0.2 § 3.3–3.5)

The build uses these names verbatim: CLI `npm --prefix pipeline/oracle-runtime run backbone -- pilot|ingest|coords|permits|report` (flags as in test plan § 3.3); seed `pipeline/data/seeds/travis-a04-pilot.csv`; workflow file `.github/workflows/a04-gis-capture.yml`; artifact folder `pipeline/data/raw/gis/us-runner-{RUN_ID_GH}`; job id `travis-a04-…` printed as `job_id=…` on the last line; tables `parcels`, `property_structures`, `roll_reconciliation`, `property_improvements`, `source_tombstones`; columns and values as in [data-model.md](data-model.md) (all test-plan § 3.4 names); `qdb_ro` helper; texts `source bulk re-stamp; delta by content digest`, `Confidential owner records redacted (Texas Tax Code §25.025): {n}`, `gis: blocked at {ts}; coverage not complete`, `{Jurisdiction}: no public permit history captured (records request, not filed); evidence {evidence_url}`.

**Differences the test plan must take (one edit, reported to the lead):**

1. **GIS mode:** D-2 makes the workflow **push-triggered** (a `workflow_dispatch` input needs the file on the default branch, which `main` never gets). The mode is the `mode` field of `pipeline/oracle-runtime/travis/gis/runner-config.json` (`"pilot"` / `"full"`), committed and pushed; there is no `-f mode=` input. TC-020 step 1/3 become "set `mode`, commit, push; `gh run list --workflow a04-gis-capture.yml --branch 004-property-backbone`".
2. **D-7 limitation text:** the Round 1 text `source export carries no §25.025 marker; conservative suppression on sale-confidentiality codes` (lead instruction) replaces test plan § 3.5's `TCAD JSON export carries no §25.025 owner flag; owner fields redacted on every account with a sales confidentiality code`.
3. **Extra closed values** beyond § 3.4: `unmatched_reason` also has `ambiguous_geoid` (shared geoID, no unique situs match) and `ambiguous_address`; `coordinate_rule` also has `centroid` (single feature, centroid inside), `export_point` and `permit_point`; `link_rule` (new column) carries oracle's detail `geoid_unique_r` / `geoid_plus_address` / `address_sig_v1` beside `link_method` ∈ {`tcad_id`, `address_hash`}.
4. **App token:** TC-041 and § 3.2 "calls Austin … with app token" must read "no app token" (D-8).

## Build-wave file ownership

Paths under `pipeline/oracle-runtime/` are written `rt/…`, under `pipeline/local-stack/` `ls/…`. Each file has exactly one owner; cross-group use is by import or SQL read only (columns fixed in data-model.md). Synthetic fixtures live in the owner's own folder.

| Group | Phase / wave | Owns (creates or edits) |
| --- | --- | --- |
| **G-FIX** | Phase 1 (wave 0, alone) | `rt/travis/lib/source-client.ts`, `rt/test/source-client.test.ts` (CR2-8, OR-N8) · `rt/travis/discovery/probes/arcgis.ts`, `rt/travis/discovery/record-gis-runner.ts`, `rt/test/probes/arcgis.test.ts`, `rt/test/record-gis-runner.test.ts` (CR2-9) · `rt/travis/backbone/{cli,restate-client,run-context,disk-guard,source-limits}.ts`, `rt/test/travis/a04/{cli,source-limits,hygiene}.test.ts` · `rt/kit/VENDORED.md`, `rt/kit/use-oracle/runtime/src/permits/{adapters/arcgis-feature-service,contracts,backfill-inputs,normalization,http,errors}.mjs`, `rt/kit/use-oracle/runtime/src/core/address-signature.mjs` (+ any file they import, vendored unmodified), `rt/test/kit/vendored-a04.test.ts` · `rt/package.json`, `rt/package-lock.json` · `ls/services/{app,loader,migrate,report}.ts`, `ls/migrations/0000_core.sql`, `ls/test/{app-registration,loader,migrate,report}.test.ts`, `ls/vitest.config.ts`, `ls/package.json`, `ls/package-lock.json` · `.gitignore` · `.github/workflows/ci.yml` · `scripts/grep-gates.sh`, `scripts/test/gates.test.ts` (reroof-term and Query-DB gates extended to the new paths) |
| **G-TCAD** | Phase 2 (build wave) | `rt/travis/tcad/{export-stream,key-inventory,redact,fields,year-built,tenure,owner-area,account-class,export-point,geometry-census,reconcile,write-group,join-proof,pilot-select,workflow}.ts` · `rt/travis/backbone/commands/{pilot,ingest}.ts` · edits `rt/travis/transforms/{tcad-county,shared-seed}.ts`, `rt/travis/pilot/{build-seed,capture-tcad-subset}.ts`, `rt/travis/discovery/probes/tcad.ts` (CR2-10) · `ls/services/workflows/tcad-backbone.ts`, `ls/services/tracks/tcad.ts`, `ls/services/report-sections/tcad.ts`, `ls/migrations/0101_tcad.sql` · tests `rt/test/travis/a04/{tcad-backbone,owner-area,tenure,confidential,workflow.blocked-a04,join-proof,pilot-select}.test.ts`, `rt/test/probes/tcad.test.ts`, `rt/test/transforms/tcad-county.test.ts`, `rt/test/fixtures/a04/tcad/**`, `ls/test/tracks/tcad.test.ts` |
| **G-GIS** | Phase 3 (build wave) | `.github/workflows/a04-gis-capture.yml` · `rt/travis/gis/{runner-config.json,runner-fetch,geometry-client,points,import,assemble-coordinates,coverage-report,workflow}.ts` · `rt/travis/backbone/commands/coords.ts` · `ls/services/workflows/gis-import.ts`, `ls/services/tracks/gis.ts`, `ls/services/report-sections/gis.ts`, `ls/migrations/0201_gis.sql` · tests `rt/test/travis/a04/{gis-adapter,gis-artifact,coordinates,coverage-report}.test.ts`, `rt/test/fixtures/a04/gis/**`, `ls/test/tracks/gis.test.ts` |
| **G-PERMITS** | Phase 4 (build wave) | `rt/travis/adapters/socrata/socrata-pages.ts` (new), edit `rt/travis/adapters/socrata/austin-3syk-w9eu.ts` · `rt/travis/permits/{content-digest,restamp,keyset-diff,link,classify-run,open-days,jurisdictions-report,workflow}.ts` · `rt/travis/backbone/commands/permits.ts` · `ls/services/workflows/austin-permits.ts`, `ls/services/tracks/permits.ts`, `ls/services/report-sections/permits.ts`, `ls/migrations/0301_permits.sql` · tests `rt/test/travis/a04/{permits-backfill,permits-incremental,permit-link,profile-edge,open-days,jurisdictions}.test.ts`, `rt/test/fixtures/a04/permits/**`, `ls/test/tracks/permits.test.ts` |
| Lead (not a builder) | Phases 5–9, Z | `pipeline/data/**` (gitignored runs), the **values** of `mode`, `outFields` and `bulkPageSize` in `rt/travis/gis/runner-config.json` at push time and the job's `if: false` in `a04-gis-capture.yml` after the full run (after the build wave), `docs/decisions/DEC-A-04-gis-runner.md`, `docs/evidence/A-04.md`, `docs/source-limits.md`, `pipeline/docs/travis-sources.yaml` re-counts, `docs/reviews/CR-A-04.md`, `docs/reports/A-04-*.md`, `docs/traceability.md`, `docs/kit-usage.md`, `specs/004-property-backbone/run-log.md` |

Seams G-FIX fixes before the wave (signatures in [contracts/](contracts/)): `createService(restate)` per workflow file; `LoaderTrack` (`{ name, migrate?: never, merge(sql, input) }`) per track file; `ReportSection` (`{ key, build(sql, jobId) }`) per report-section file; `BackboneCommand` (`{ verb, args: ZodSchema, run(ctx) }`) per `travis/backbone/commands/*.ts`; `RunContext` (`jobId`, `asOf`, receipts writer, limitation writer, disk guard); `throughputRow()` for `docs/source-limits.md`.

## Architecture (this story)

```text
TCAD export zip (local, sha256 summary) ─► export-stream ─► key-inventory (strict) ─► redact ─► fields/year-built/tenure/owner-area
                                                              │                                     │
                                                              └─ TcadBackbone ─► TcadChunk ×~50 ────┴─► chunk.ndjson.gz ─► Loader(travis).tcad ─► parcels, property_structures, roll_reconciliation
US runner (push, mode=pilot|full) ─► kit arcgis adapter + geometry-client ─► pages + receipts + checkpoints ─► artifact (IDs + geometry)
        gh run download ─► pipeline/data/raw/gis/us-runner-<id> ─► GisImport (needs complete.json) ─► Loader.gis ─► gis_pages, gis_features
Austin 3syk-w9eu ─► AustinPermits (one ctx.run per keyset page, ≤ 1 req/s) ─► raw pages + receipts ─► Loader.permits ─► property_improvements
                     incremental: watermark + restamp detector + content digest + keyset-diff ─► source_tombstones
link (geoID → pID; address hash when tcad_id is null or on no roll account) ─► classify (profile) ─► open_days
assemble-coordinates (GIS → export point → condo_building_point → permit_point → reason) ─► parcels.coordinate_*
write-group (R only, gis_centroid geometry only) ─► elephant-cli validate → hash → validate CAR → export-tables (local, never uploaded)
   ─► DuckDB: views.sql bound to local parts ─► SELECT avg((latitude IS NOT NULL)::int) FROM v_property   ‖  Query DB count
backbone report ─► BackboneReport handler ─► report-sections/{tcad,gis,permits} ─► JSON (counts only)
```

## Project Structure

### Documentation (this feature)

```text
specs/004-property-backbone/
├── spec.md · agent-design.md · run-log.md · checklists/requirements.md
├── plan.md              # this file
├── research.md          # Phase 0
├── data-model.md        # Phase 1 (Query DB tables, report JSON, artifacts)
├── quickstart.md        # Phase 1
├── contracts/
│   ├── cli.md           # backbone verbs, flags, exit codes, last-line job_id
│   ├── gis-runner.md    # a04-gis-capture.yml, runner-config.json, artifact layout
│   ├── seams.md         # createService, LoaderTrack, ReportSection, BackboneCommand, RunContext
│   └── report.md        # backbone report --json schema
└── tasks.md             # /speckit-tasks
```

### Source Code (repository root)

```text
.github/workflows/{ci.yml, a04-gis-capture.yml}
pipeline/oracle-runtime/
├── kit/VENDORED.md · kit/use-oracle/runtime/src/{permits/**, core/address-signature.mjs}   # vendored, unmodified
├── travis/
│   ├── backbone/{cli,restate-client,run-context,disk-guard,source-limits}.ts · commands/{pilot,ingest,coords,permits}.ts
│   ├── tcad/{export-stream,key-inventory,redact,fields,year-built,tenure,owner-area,account-class,export-point,geometry-census,reconcile,write-group,join-proof,pilot-select,workflow}.ts
│   ├── gis/{runner-config.json,runner-fetch,geometry-client,points,import,assemble-coordinates,coverage-report,workflow}.ts
│   ├── permits/{content-digest,restamp,keyset-diff,link,classify-run,open-days,jurisdictions-report,workflow}.ts
│   ├── adapters/socrata/{socrata,austin-3syk-w9eu,socrata-pages}.ts
│   └── lib/source-client.ts · discovery/{probes/arcgis,probes/tcad,record-gis-runner}.ts · transforms/{tcad-county,shared-seed}.ts · pilot/{build-seed,capture-tcad-subset}.ts
└── test/travis/a04/*.test.ts · test/fixtures/a04/{tcad,gis,permits}/** · test/kit/vendored-a04.test.ts
pipeline/local-stack/
├── migrations/{0000_core,0101_tcad,0201_gis,0301_permits}.sql
├── services/{app,loader,migrate,report}.ts · workflows/{tcad-backbone,gis-import,austin-permits}.ts · tracks/{tcad,gis,permits}.ts · report-sections/{tcad,gis,permits}.ts
└── test/{app-registration,loader,migrate,report}.test.ts · test/tracks/{tcad,gis,permits}.test.ts
```

**Structure Decision**: Workflow factories and all pure logic live in `pipeline/oracle-runtime/travis/<part>/` (tested offline, SDK type-only, as A-01's `createTravisDiscovery`); `pipeline/local-stack/services/` holds the thin Restate bindings, the Loader tracks (the only code holding a Postgres client) and the report sections. The CLI talks only to the Restate ingress (`RESTATE_INGRESS_URL`, default `http://localhost:8080`), never to Postgres.

## Risks

| # | Risk | Mitigation / fallback | Owner |
| --- | --- | --- | --- |
| R1 | R coverage < 99% if the condo rule cannot be proven (~59.7k R without an own point if the export geometry is mostly placeholder) | T024 measures the export-point definition first; `condo_building_point` uses the shared geoID's GIS / export point (R-05); D-17 stop with the gap by reason if still short. Never geocode. | G-TCAD, G-GIS |
| R2 | GIS field names unprobed; 2,000 objectIds in a GET may give 414/404 | Pilot push reads layer metadata first; lower `bulkPageSize` (≤ 2,000) rather than POST; recorded in DEC-A-04-gis-runner.md. | G-GIS |
| R3 | 97% link rate missed (508 no `tcad_id`, shared geoIDs, `no_tcad_geoid`) | Address hash (only when `tcad_id` null) carries the margin; D-18 stop with unmatched by reason. | G-PERMITS |
| R4 | Rows inserted during paging below the cursor; `:id` not stable across a dataset replace | Start/end totals + key-set diff; re-key recorded, not tombstoned. | G-PERMITS |
| R5 | Local County-group validate/hash/export-tables takes > 5 h or fills the disk | Measure one 10k chunk and project (T079); disk guard 5 GiB; spike data deleted first (T083 order: after re-capture, before the County group). | Lead |
| R6 | A new confidentiality key appears in a later export | Strict key inventory fails the run (no silent pass). | G-TCAD |
| R7 | Public fork: runner artifacts downloadable by any GitHub user | Minimal `outFields` (OBJECTID, pID field, geoID field) + geometry only; 7-day retention; never owner columns. | G-GIS |
| R8 | Fixes after the pilots change code the full run uses | Rule from walkthrough E2: no TCAD full run on old code; the lead delays the queued run until fixes are merged and says which. | Lead |

## Complexity Tracking

| ID | Violation / deviation | Why Needed | Simpler Alternative Rejected Because |
|----|-----------|------------|-------------------------------------|
| CT-1 | Articles I / XXII and ARD P0-20: proof is not on the hosted URL (G4 C-04, G6 C-05/C-09, G7 C-04/C-07; Phase Z TZ02–TZ04 N/A) | A-04 publishes and deploys nothing; A-11 publishes, A-13 shows it. | Publishing in A-04 would pull A-11 forward and publish an unreviewed full county. Recorded once per gate report. |
| CT-2 | Article VII: the GIS runner job is outside Restate (no DLQ) | D-2: the GIS host is reachable only from a US runner; the job is fetch-only and resumes from checkpoints via `actions/cache`; a give-up writes a `blocked` receipt (the dead-letter record) and no `complete.json`. | Running Restate on the runner would need the Query DB or state there (P0-1). |
| CT-3 | Kit rule "preserve full source_payload" bent: the Query DB stores the **redacted** TCAD payload plus `record_sha256` of the original bytes (disagreement #11) | AC-5: no confidential owner name may reach the Query DB. The raw export zip on disk stays the source of truth for provenance. | Storing the full payload would put confidential names in the DB. |
| CT-4 | Kit county-ingest-run order (official registry before permit harvest) not followed (disagreement #12) | Contractor identity is A-07; A-04 writes no contractor row (AD-06), so the rule's purpose is kept. | Loading the Comptroller now pulls A-07 forward without changing A-04's output. |
| CT-5 | New runtime dependency `@dsnp/parquetjs` and six vendored kit files + address signature (disagreement #9) | The kit ArcGIS adapter imports `backfill-inputs.mjs`, which loads parquetjs at import; vendoring unmodified keeps A1. | Re-writing the adapter in TS would reimplement the kit (A1). |
| CT-6 | Story size 2.5 days > 1.5-day ceiling | PO story merge (feature-list amendment 0.2.1); accepted at G4. | Splitting again undoes the PO merge. |
| CT-7 | G-FIX builder loads durable-workflow-builder + query-db-loading-matching (walkthrough: "none extra") | G-FIX owns the Restate registration and the single-writer Loader. | Without them the shared seams would not follow the kit patterns. |
| CT-8 | The TCAD export point is published as `gis_centroid` (rank 2) | Frozen by A-02 (`contract/v1/README.md` "Coordinates come from `geometry` (`coordinate_source = gis_centroid`)"); `coordinate_rule = export_point` keeps the distinction in the Query DB. | A new public value needs `contract/v2` (a stop). |
