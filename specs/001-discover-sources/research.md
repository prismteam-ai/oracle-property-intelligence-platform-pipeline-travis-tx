---
id: RES-A-01
parent: PLAN-A-01
---

# Research: A-01 Discover Travis County sources

Phase 0 of [plan.md](plan.md). The Technical Context has no open `NEEDS CLARIFICATION`; these entries record the decisions behind it. Sources: [agent-design.md](agent-design.md) (oracle), [spec.md](spec.md) clarifications, ARD-A v0.2, constitution 3.0.3, kit 0.99.1 (`county-readiness-preflight`, `use-oracle/reference/readiness-and-completeness.md`).

## R1. Where the new code lives

- **Decision**: `pipeline/oracle-runtime/travis/` for all probe, catalog and checker code; `pipeline/local-stack/services/app.ts` only binds the workflow.
- **Rationale**: AD-23 and the ARD module table place "vendored kit runtime + Travis adapters/profiles (new code in TS)" in `pipeline/oracle-runtime`. Using it needs no Complexity Tracking entry and gives A-04–A-09 one home for adapters.
- **Alternatives considered**: `pipeline/local-stack/services/discovery/` (oracle's suggestion; fits today's tree but departs from AD-23).

## R2. How the kit validator is run

- **Decision**: copy `use-oracle/scripts/validate-county-readiness.py` from kit 0.99.1 unmodified into `pipeline/oracle-runtime/kit/`, record its SHA-256 and source path in `kit/VENDORED.md`, run `--self-test` in CI, and call it with the relative path `pipeline/docs/travis-sources.yaml`.
- **Rationale**: CI and reviewers can run the gate without the operator's plugin cache; article II and D-03 allow the vendored runtime "as provided". A relative path keeps the home directory out of the report.
- **Alternatives considered**: calling the plugin-cache copy (not reproducible in CI); rewriting the validator in TS (reimplements the kit, breaks A1).

## R3. Spec classes vs validator statuses

- **Decision**: keep the spec's class in `spec_class` and set the validator `status` through one mapping (`status-map.ts`), tested exhaustively:

| `spec_class` | Case | `status` | Required extras |
| --- | --- | --- | --- |
| supported | records with history online | `supported` | `historical_records: true`, `earliest_record_date` |
| records request | custodian only | `custodian-only` | complete `records_request` |
| records request | portal is intake-only or has no history | `manual-only` | `records_request`, `historical_records: false`, `portal_kind: application-intake` for one-stop/intake portals |
| records request | portal blocked | `blocked` | `records_request`, `blocked_evidence` |
| no public history | another body issues the permits | `delegated` | `issued_by` |
| no public history | no records exist | `unavailable` | `evidence_url` |

- **Rationale**: the validator accepts only `supported, delegated, manual-only, blocked, unavailable, excluded, custodian-only`; anything else counts as unclassified and blocks the permit gate (oracle risk 1). `excluded` is not used (no approved exclusion).
- **Alternatives considered**: renaming the spec classes to validator words (loses the PO's plain-language classes from clarification Q1).

## R4. Where jurisdiction classifications come from

- **Decision**: a versioned TS profile `travis/profiles/jurisdictions.ts` holds one curated entry per jurisdiction (class, portal, evidence URL, records-request route, `issued_by`). The workflow probes each evidence URL through the source client and stamps `evidence_captured_at` and the HTTP status. The expected set comes from the Census probe (R6); the checker fails if the profile and the Census set differ.
- **Rationale**: classification needs judgment that a probe cannot make, but the evidence and capture time must be machine-recorded. A versioned profile follows AD-26 (profiles are code in git).
- **Alternatives considered**: hand-editing the YAML (numbers drift, no capture times); fully automatic classification (not reliable for 20+ municipal portals).

## R5. Writing YAML both validator parsers read the same way

- **Decision**: emit the catalog with the `yaml` package in block style only (no flow maps or lists, no anchors, no multi-line scalars); quote FIPS, IDs, dates and every string containing `#` or `:`; never emit bare `yes`/`no`. Parser parity is tested by running the validator with and without PyYAML and diffing the two reports. PyYAML 6.0.3 is installed in the operator's user site (2026-10-19), so `python3` uses it; `python3 -s` skips the user site and exercises the simplified fallback parser. CI installs PyYAML and runs both modes the same way.
- **Rationale**: oracle risk 5. The simplified fallback parser handles only plain block YAML.
- **Alternatives considered**: hand-written YAML (error-prone); JSON (the validator reads YAML only).

## R6. The expected jurisdiction set

- **Decision**: use the U.S. Census Bureau place-to-county relationship data together with the place class codes, keeping incorporated places (class `C*`) with land area in Travis County (county FIPS 48453), plus one row for Travis County unincorporated. Record the dataset name, vintage, URL and capture time in `census_reference`. The exact file URL is confirmed at implementation and recorded.
- **Rationale**: the spec (FR-004) names the Census list; the relationship file gives land overlap per county, which catches the Travis parts of Cedar Park, Leander, Round Rock and others. CDPs (for example Hudson Bend) are not incorporated and fall under unincorporated.
- **Alternatives considered**: the Texas Municipal League directory (not a federal reference, no land-overlap data); the 18 named leads (known to be incomplete).

## R7. Throughput measurement

- **Decision**: Socrata: server-side `count(*)` for counts; throughput from at least 3 consecutive pages of 50,000 rows with a stable `$order=:id`, read one after another; median rows per minute; projected hours = denominator ÷ median ÷ 60. Single-file sources (TCAD): download rate in MB per minute. ArcGIS: one `returnCountOnly=true` request with a 60 s timeout, no paging.
- **Rationale**: spec clarification Q3; keeps measurement well below ingestion volume.
- **Alternatives considered**: a single page (noisy); a fixed 10-minute read (reads up to a quarter of Austin's rows).

## R8. Counting the TCAD export

- **Decision**: download the 2026 Certified Special Export once to `pipeline/data/raw/tcad/` with a 10-minute inactivity limit and a 2-hour total limit (either one counts as a timeout and records the source as blocked, FR-003/FR-006); the Restate step's inactivity and abort timeouts are set above these limits so the probe, not the runtime, decides; count accounts with `stream-json` (streaming, bounded memory); list top-level record fields; record bytes, SHA-256, download rate, roll year and certification date. The JSON record path is confirmed from the Export Layouts file before counting.
- **Rationale**: the file may be multi-GB (oracle risk 9); spec FR-003.
- **Alternatives considered**: loading the whole file (memory); counting with `jq` (an extra tool outside the TS rule).

## R9. Destination proof

- **Decision**: identity A = Docker side (`docker compose ps`/`inspect`: container ID and image digest of the Postgres service); identity B = SQL inside the container (`pg_control_system()` system identifier, `current_database()`, server version). Record the names and digests; never the URL or password.
- **Rationale**: validator rule 4 requires two independent sources; two values read from the same `.env` would not be independent (oracle risk 10).
- **Alternatives considered**: `DATABASE_URL` host plus database name (one source).

## R10. The US geo-check (PO-approved)

- **Decision**: `.github/workflows/geo-check.yml`, `workflow_dispatch` only, added only when a saved response carries an explicit geo signal (FR-006b). One identified request with the project User-Agent; the status, headers and body digest are uploaded as a run artifact and copied into the evidence. Never triggered for a plain 403 or challenge. Triggering it is a user action.
- **Rationale**: ARD § 8 allows a geo-block retry from a US runner; the PO approved the workflow on 2026-10-19.
- **Alternatives considered**: a proxy or VPN (forbidden: IP rotation).

## R11. The run state and `WAITING_HUMAN`

- **Decision**: the `TravisDiscovery` Restate workflow journals each probe as a `ctx.run` step with the idempotency key `source:measurement:captured_date`. A blocked source sets `state: WAITING_HUMAN` and waits on a durable promise that a human resolves (resolved, or still blocked with a records request). The run never auto-advances to seed (kit default overridden; seed is A-04).
- **Rationale**: constitution VII and A1 (kit runtime uses Restate); oracle patterns 1 and 4.
- **Alternatives considered**: a plain script (no journal or durable pause, weaker VII evidence).

## R12. CI for this story

- **Decision**: add `.github/workflows/pipeline-ci.yml` running `tsc`, ESLint, Prettier check, Vitest and validator `--self-test` for `pipeline/oracle-runtime`. A-03 folds it into the Turborepo CI.
- **Rationale**: article X needs CI green for done; A-01 lands before A-03 creates the monorepo CI.
- **Alternatives considered**: local runs only (fails article X).
