---
id: AGD-A-01
parent: A-01
spec: specs/001-discover-sources/spec.md
created: 2026-10-19
---

# Agent design input: A-01 Discover Travis County sources and pass readiness preflight

Design agents (story front matter `agents.design`): `oracle`. Consulted read-only on 2026-10-19 with the brief below; the answer is saved word for word under its own heading. It is input to `/speckit-plan`, not a decision record.

**Brief:** "Read specs/001-discover-sources/spec.md, stories/A-01-discover-sources.md, docs/architecture-constitution.md and .specify/memory/constitution.md. Load onboard-county, county-discovery, county-readiness-preflight, bootstrap-oracle-infra and apply-engineering-guidelines. Return: components and files touched, data or contract changes, which of your patterns apply and how they must appear in the code, risks, and how to verify. Do not write code."

## PO decisions on the agent's open questions (2026-10-19, HebaGaber)

- **US geo-check workflow (Risk 6): approved.** `.github/workflows/geo-check.yml` may be added during implementation; it runs only when a saved geo-block signal exists (FR-006b), makes one identified request, and is never used for a plain 403 or challenge.
- **Push to `elephant-xyz/Counties-trasform-scripts` (Risk 7): declined.** Not done in this story; findings stay in this repo.

---

## oracle (design agent), 2026-10-19

# Oracle design consultation: A-01 Discover Travis County sources and pass readiness preflight

Read: `specs/001-discover-sources/spec.md`, `stories/A-01-discover-sources.md`, `docs/architecture-constitution.md` (ARD-A v0.2), `.specify/memory/constitution.md` (3.0.3), `../assessment-guide/reference/A-oracle.md` § 4. Skills loaded: `onboard-county`, `county-discovery`, `county-readiness-preflight`, `bootstrap-oracle-infra`, `apply-engineering-guidelines`. I also read the kit validator source (`use-oracle/scripts/validate-county-readiness.py`, kit 0.99.1), its catalog contract (`use-oracle/reference/readiness-and-completeness.md`) and the Duval example catalog.

## Components and files touched

Current state: only `pipeline/local-stack/` is tracked. It has the compose file, `services/app.ts` binding no services, and `package.json` with the Restate SDK, `postgres`, `p-limit` and `@elephant-xyz/cli#main`. `pipeline/oracle-runtime/` (AD-23) does not exist yet. `pipeline/data/` is already in the root `.gitignore`.

| Path | New/changed | Purpose |
| --- | --- | --- |
| `pipeline/docs/travis-sources.yaml` | new | The machine-readable catalog, using the kit's catalog contract. This is the validator's only input. The kit's default location is `skills/use-oracle/runtime/docs/<county>-sources.yaml`, but the validator accepts any path, so keep the story path and pass it explicitly. |
| `pipeline/docs/travis-county-findings.md` | new | The findings profile that `county-discovery` requires (appraiser portal, parcel identifier, permit portals, bulk sources, use codes, additional sources, feasibility, risks). The YAML holds the numbers and this file holds the narrative. |
| `docs/sources.md` | new | A readable summary **generated from the YAML** by a script, not written by hand, so numbers cannot drift (FR-007a). |
| `docs/evidence/A-01-readiness.json` | new | The validator's JSON report, saved as printed, with its exit code recorded next to it in `A-01.md`. |
| `docs/evidence/A-01.md`, `docs/evidence/A-01-coverage.md` | new | Exit code, YAML SHA-256, one row per source (URL, count, capture time), the blocked-source record, and the run state. |
| `pipeline/oracle-runtime/kit/use-oracle/scripts/validate-county-readiness.py` (or a similar vendored path) | new, vendored **unmodified** | Lets CI and reviewers run the gate without the operator's plugin cache. Record the kit version (0.99.1) and the file's SHA-256. It runs "as provided" under article II and D-03. |
| `pipeline/local-stack/services/discovery/` (TS) | new | The discovery workflow and probes, described below. Placing it here fits today's tree. Moving it under `pipeline/oracle-runtime` later is a plan decision; record it in Complexity Tracking if it differs from AD-23. |
| `pipeline/local-stack/services/app.ts` | changed | Binds the discovery workflow so that "stack is up" means something. |
| `pipeline/local-stack/services/lib/source-client.ts` | new | The single HTTP boundary: etiquette plus the StopOnBlocked guard. |
| `pipeline/local-stack/services/discovery/catalog.schema.ts` + `check-catalog.ts` | new | A Zod schema and a checker for the A-01 rules the kit validator does not enforce. |
| `pipeline/local-stack/services/discovery/render-sources-md.ts` | new | Generates `docs/sources.md` from the YAML. |
| `.github/workflows/geo-check.yml` | new, **only if** a geo-block signal is recorded | One `workflow_dispatch` run that makes one identified request from a US runner and saves the status, headers and body digest as an artifact. Ask the user before adding or triggering it. |
| `testplans/A-01-test-cases.md`, `docs/reviews/CR-A-01.md` | new | Gate artifacts (G6, G7). |
| Raw TCAD export | `pipeline/data/raw/tcad/` (gitignored) | Downloaded once. Only its receipt (bytes, SHA-256, URL, time, rate) is committed, and no rows. |

The probes (all TypeScript, all through `source-client.ts`):
- **Socrata `3syk-w9eu`:** `count(*)`, the `tcad_id IS NULL` count, a `jurisdiction` group-by (the Austin-issued counts located in Lakeway, Bee Cave and Pflugerville), then 3 consecutive pages of 50,000 rows ordered by `:id`.
- **Socrata `9cir-efmm`:** the statewide count and the county-code-227 count.
- **TCAD:** one download of the 2026 Certified Special Export, then a **streaming** account count and field list. Also the Export Layouts zip for the legacy-layout edge case.
- **ArcGIS `TCAD_PARCELS`:** one `returnCountOnly=true` request with a bounded timeout. No paging in A-01.
- **Census:** the incorporated-places-by-county list, with its vintage recorded.
- **Per jurisdiction:** an evidence probe of the official permit page, plus the Texas contractor-licensing evidence (TDLR, HB 3344 status).
- **BBB:** reuse the recorded 2026-10-17 challenge evidence, or at most one observation. Never solve the challenge.

## Data or contract changes

No public contract changes: no `contract/v1`, no manifest, no lexicon output, nothing published. The changes are an internal catalog plus capture receipts.

**1. Catalog keys the kit validator reads.** It fails closed on each of these:
- **Top level:** `county: Travis`, `state: TX`, `slug: travis`, `fips: "48453"` (quoted, so it stays a string), `snapshot_time`.
- **`parcel`:**
  - `canonical_source` (TCAD 2026 certified roll, never GIS), `assessed_parcel_count`, `roll_year`, `certification_date`.
  - `gis_feature_count`, `discrepancy_threshold_pct: 2.0`, `discrepancy_explanation` (required whenever the GIS and roll counts differ), and `separately_assessed_without_geometry: acknowledged|none` (required when GIS is below the roll).
  - `identifier_name` (`prop_id` or `geo_id`, exactly as printed), `identifier_proven`, `identifier_format`, `deed_or_sale_dates_present`.
- **`permits`:** `expected_jurisdiction_count`, `assumes_unified_countywide_history: false`, and `jurisdictions[]`. Each row needs `jurisdiction`, `key`, `status`, `historical_records: true|false` (required on every row), `portal_kind`, `portal`, `evidence_url`, `evidence_captured_at`, `earliest_record_date`, and `records_request` where required.
- **`destination`:** `writes_in_scope: true`, `proven: true`, and `independent_identity_sources` (at least two, genuinely independent).
- **`enrichment.bbb`:** `status: blocked` with evidence. Never set `expected_count` equal to an advertised listing total.
- **`records_request`** (complete means all of): `recipient_office`, `system_scope` (system and date range), `route: api-first|records-first`, and `request_portal_url` or `request_email`.

**2. The spec's classes must map to the validator's vocabulary.** The validator accepts only `supported, delegated, manual-only, blocked, unavailable, excluded, custodian-only`. A row with status `records request` or `no public history` counts as **unclassified, and the permit gate is BLOCKED**. Keep the spec's term in a separate `spec_class` field and set `status` as follows:

| Spec class (FR-004b) | Validator `status` | Notes |
| --- | --- | --- |
| supported | `supported` | `historical_records: true`. Use `earliest_record_date` for "supported from {year}". |
| records request: custodian only | `custodian-only` | Needs a `records_request`. |
| records request: portal is intake-only or has no history | `manual-only` | Needs a `records_request`. `historical_records: false`. If the portal is a one-stop or intake portal, set `portal_kind: application-intake` and **never** `historical_records: true`. Travis County TNR's "online permitting account system" is the likely case. |
| records request: portal blocked | `blocked` | Needs a `records_request` and the blocked evidence. |
| no public history: another body issues the permits | `delegated` | Add `issued_by: <body>`. The permits are counted under that body. |
| no public history: no records exist | `unavailable` | Include the evidence URL. |

**3. A-01-specific keys** (the validator ignores these, so the TS checker enforces them):
- A `sources[]` block, one row per A-oracle § 4 source: TCAD certified, TCAD supplemental (listed, not downloaded), TCAD GIS, Austin permits, other jurisdictions, Comptroller, BBB, Overture, and contractor licensing ("no statewide roofing licence"). Each row has `name`, `url`, `status: available|blocked`, `denominator`, `throughput`, `anti_bot`, `projected_full_capture_hours`, `decision: bulk download|ingest|runtime retrieval`, `decision_reason`, and `captured_at`.
- **Every number** is a measurement object `{value, source_url, captured_at (UTC ISO-8601)}`, plus `method`/`query` where it applies (FR-007a).
- `throughput`: `{rows_per_minute_median, pages_read, page_size, window_start, window_end, app_token_used, rate_limits_observed}`. A single-file source's measurement is its `download_rate`.
- Comptroller: two measurements, `travis_coded_rows` (the coverage denominator) and `statewide_rows` (the A-07 lookup set).
- Austin row: a `located_in_other_jurisdictions` breakdown. The matching city rows carry `austin_issued_located_here` counts that **do not** affect their own status.
- Blocked rows: `blocked_evidence {http_status | timeout_ms, captured_at, url, evidence_path, body_sha256, geo_signal: none|<quoted signal>}`.
- `census_reference {dataset, vintage, captured_at, place_count}`.

**4. Internal contracts** (not public): a capture receipt (`url, method, status, bytes, sha256, captured_at, user_agent, attempts`) and a discovery run record (`state: DISCOVERING | WAITING_HUMAN | READY`, blocker list). These match ARD § 6 "internal contracts".

## Patterns that apply (and how they must appear in the code)

1. **Use the fail-closed gate exactly as shipped.**
   - Run the vendored validator unmodified (check the SHA-256 recorded in evidence) and save its stdout as the report.
   - Treat any non-zero exit as a stop for seed, pilot and full ingest. Safe preparation continues.
   - Never add `approved_exceptions` just to turn the gate green. That needs a recorded human/PO approval with reason, canonical denominator, excluded population and coverage effect.
   - **Override the kit's "on PASS auto-advance without operator confirmation"** for this repo. Seed is story A-04 behind its own gates, so A-01 stops at the verdict.
   - Pass a **relative** catalog path: the report echoes `catalog_path`, and an absolute path would leak the local home directory.

2. **One HTTP boundary with the StopOnBlocked guard** (`source-client.ts`, ARD § 4 "External", P0-7):
   - On HTTP 403, a challenge page or a timeout, write a `blocked` receipt with **zero retries** and do not transform the body (ARD § 6). The run state becomes `WAITING_HUMAN`.
   - Only 429 and 5xx get backoff: exponential with full jitter, 1 s base, 60 s cap, 5 attempts, honoring `Retry-After`, and recording the observed limit.
   - `p-limit(2)` per source host. One constant, identified User-Agent that names the project and repo URL. Do not put the user's email in it without consent.
   - No proxy, IP, User-Agent or header rotation. Assert this in a unit test.
   - `isGeoBlock(response)` returns true **only** for an explicit signal in the saved response: a "not available in your country/region" body, a country-block error code, or a geo header. A bare 403 never qualifies (FR-006b).

3. **Zod at every boundary.** Parse Socrata, ArcGIS and Census responses and the catalog with Zod before any logic. A challenge HTML page fails the parse and becomes `blocked`, never "0 rows". There is no `any`.

4. **Durable, queued boundary** (constitution VII, Golden Path `external-dependency-boundaries`):
   - Bind a `TravisDiscovery` Restate workflow in `app.ts`. Each probe is a journaled `ctx.run` step with an idempotency key (`source:measurement:captured_date`).
   - A blocked source moves the run to `WAITING_HUMAN` through a durable promise or awakeable that a human resolves. It never blocks on a timer loop.
   - Raise the inactivity and abort timeouts for the TCAD download step (`bootstrap-oracle-infra` gotcha).
   - Locally, Restate provides the DLQ/pause behavior. Do not unset the retry policy.

5. **Measurements as specified.**
   - Socrata throughput: at least 3 **consecutive** full pages of at most 50,000 rows each, read one after another (no parallel reads), stable `$order=:id`. Record the median rows per minute, the pages read and the time window.
   - Projected hours = denominator ÷ median rate ÷ 60.
   - Any source above 48 hours must carry a decision (FR-005).
   - Counts use server-side `count(*)`, never paging to count.
   - The TCAD count comes from a streaming JSON parser over the file, never loaded fully into memory. Record bytes, SHA-256 and the download rate.

6. **GIS is not the population.** The roll is canonical. If GIS times out, record `gis_feature_count: null` with blocked evidence and the gap as `unknown` with a reason. Never use GIS as the denominator.

7. **Destination proof from two independent identities.** Example: (a) the Docker-side identity (container ID plus image digest from `docker compose ps`/`inspect`), and (b) the server-side identity from SQL inside the container (`pg_control_system()` system identifier, `current_database()`, server version), compared against each other. Values copied from `DATABASE_URL` under test do not count. Record the identity names and digests, never the URL or password (`pipeline/local-stack/.env` exists, so never print it).

8. **Golden Path and constitution.**
   - All new code is TypeScript. The only Python is the vendored kit validator.
   - Structured JSON logs with counts, durations and failures. No tokens, URLs with credentials, or PII.
   - The Socrata app token is optional, comes from the environment or SSM, and is never logged; record only `app_token_used: true|false`.
   - Powertools and PagerDuty do not apply. This is local operator code with no Lambda; say so in the plan.

9. **Data honesty.**
   - `docs/sources.md` is rendered from the YAML, so every number carries its URL and UTC time.
   - Missing values show a reason ("TCAD blocked 403 at …"), never a blank or a guess.
   - Commit no TCAD rows or sample records. Counts and field names only, since §25.025 confidential owners may be present.

## Risks

1. **Status vocabulary mismatch (high, certain if ignored).** Writing the spec's class labels into `status` blocks the permit gate. Use the mapping table above and test it.
2. **TCAD 403 (high, observed twice).** `assessed_parcel_count` missing makes the parcel gate BLOCKED and the exit 1. This is the expected AC-6 outcome, not a defect: record the blocker, a complete records request (TCAD custodian, Public Information Act route, 2026 certified plus supplemental exports, `records-first` or `api-first`) and `WAITING_HUMAN`. Do not use GIS or an approved exception to force a PASS.
3. **The validator gives false comfort when GIS is null.** A null `gis_feature_count` lets the parcel gate PASS with no gap check. FR-003b must be enforced by `check-catalog.ts`, not left to the validator.
4. **Jurisdiction count.** The Census list is the source of truth, not the 18 named leads. Expect extra incorporated places with land in Travis County that the § 4 list omits. Candidates to verify against the Census file, not assume: Point Venture, San Leanna, The Hills, Volente, and the Travis part of Elgin. CDPs such as Hudson Bend fall under unincorporated. Derive `expected_jurisdiction_count` from the file; never hard-code it.
5. **YAML parser divergence.** If PyYAML is missing, the validator uses its own simplified parser. So:
   - Use block style only (no `{}`/`[]` flow maps, anchors or multi-line scalars).
   - Quote FIPS, IDs and dates.
   - Quote any value that contains `#` (URL fragments) or starts a list item with a colon.
   - Avoid bare `yes`/`no`.
   - Run the validator both with and without PyYAML and compare.
6. **Geo-check drifting into evasion.** The US runner is allowed only with a saved explicit geo signal: one request, identified, never for a plain 403 or challenge. It needs a pushed workflow, so ask the user first.
7. **External PR from the kit flow.** `county-discovery` says to push findings to `elephant-xyz/Counties-trasform-scripts`. That is an external, hard-to-reverse action outside this story's scope. Record it as a next step and ask the user; do not do it automatically.
8. **Count drift.** The Austin count changes daily. Store it with its capture time; A-06 reconciles at its own watermark.
9. **TCAD export size.** The file may be multi-GB. Use streaming parse, gitignored storage under `pipeline/data/raw/tcad/` (align `DATA_DIR` with the story path), and long Restate step timeouts.
10. **Weak destination proof.** Two sources that both come from the same `.env` are not independent, and a reviewer will reject them.
11. **Socrata throttling without an app token.** This can lower the measured rate. Record whether a token was used and any limits observed, and re-measure with a token only within the terms.
12. **Secrets and paths in evidence.** Check that the validator JSON, logs and receipts contain no `DATABASE_URL`, token or absolute home path. Run gitleaks before committing.
13. **Over-reach on BBB.** A Playwright exploration of a Cloudflare-challenged site is not needed. Reuse the evidence or make one observation; the next step is the official API application (recorded only).

## How to verify

1. **Kit gate integrity:** `python3 <vendored>/validate-county-readiness.py --self-test` exits 0, and the vendored file's SHA-256 matches the kit 0.99.1 copy.
2. **The verdict (AC-1, AC-6):** `python3 <vendored>/validate-county-readiness.py pipeline/docs/travis-sources.yaml > docs/evidence/A-01-readiness.json; echo $?`. The pass condition is either:
   - exit 0 with `overall: PASS`, `seed_allowed: true`, `ingest_allowed: true`; or
   - exit 1 where the **only** blocked gate is `parcel`, caused by the TCAD block, with the blocker, records request, missing roll count and `WAITING_HUMAN` documented in `docs/sources.md` and `docs/evidence/A-01.md`. The permit, destination, enrichment and catalog-metadata gates must PASS either way.
3. **Parser parity:** run the same command in an environment without PyYAML; the report must be identical.
4. **`check-catalog.ts`** (Vitest plus a CLI exit code) asserts:
   - every A-oracle § 4 source is present;
   - every numeric field has `source_url` and `captured_at`;
   - every source above 48 hours has a `decision` and `decision_reason`;
   - Comptroller has both counts;
   - Austin has a count, null count, throughput (at least 3 pages, each at most 50,000 rows), projection and decision;
   - jurisdiction count equals `census_reference.place_count + 1`, with no `needs-review`;
   - each jurisdiction has one `spec_class` that maps to a valid validator `status`;
   - the Austin-issued counts are present under Austin;
   - GIS is either counted or recorded as blocked with the gap marked `unknown` and a reason.
5. **Guard unit tests (Vitest)** use synthetic fixtures (test-only, never shown on the site):
   - a 403 makes one attempt, produces a `blocked` receipt and moves to `WAITING_HUMAN`;
   - a challenge HTML page becomes `blocked`, not parsed;
   - a 429 follows the 1/2/4… s capped schedule with at most 5 attempts;
   - the User-Agent is constant across attempts and no proxy is configured;
   - a bare 403 is not a geo-block, while the geo body or header fixture is.
6. **Spot re-measurement:** an independent `count(*)` on `3syk-w9eu` and `9cir-efmm` (county 227) should land within expected drift of the catalog values. The TCAD file's SHA-256 should match the receipt.
7. **Hygiene:** `git check-ignore pipeline/data/raw/tcad/<file>` succeeds. gitleaks is clean. A grep of committed evidence finds no `postgres://`, token values, or `/Users/` paths. No TCAD rows are committed.
8. **Traceability:** pick any 3 numbers in `docs/sources.md` and trace each to its URL and capture time in under 2 minutes (SC-002). Re-render `docs/sources.md` from the YAML and confirm there is no diff.
9. **Run record:** the Restate UI or the run record shows the discovery workflow's journaled steps. A blocked source shows `WAITING_HUMAN` with zero retries on 403 or timeout (SC-005).
10. **Review:** the `oracle` reviewer scores the branch in `docs/reviews/CR-A-01.md` (at least 75). The validator exit result is the story's `verify` criterion.
