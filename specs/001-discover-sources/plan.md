---
id: PLAN-A-01
parent: A-01
spec: specs/001-discover-sources/spec.md
agent_design: specs/001-discover-sources/agent-design.md
---

# Implementation Plan: Discover Travis County sources and pass readiness preflight

**Branch**: `001-discover-sources` | **Date**: 2026-10-19 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/001-discover-sources/spec.md`; technical direction from [agent-design.md](agent-design.md) (oracle, 2026-10-19).

**PO decisions applied**: US geo-check GitHub workflow approved (only on a saved geo-block signal); push to `elephant-xyz/Counties-trasform-scripts` declined. No other part of the oracle design was rejected.

## Summary

A-01 produces a fail-closed source catalog for Travis County before any ingestion. A Restate discovery workflow runs bounded TypeScript probes through one HTTP boundary (at most 2 concurrent requests per source, backoff only on 429/5xx, stop on 403/challenge/timeout). It writes `pipeline/docs/travis-sources.yaml` in the kit's catalog contract. The kit validator, vendored unmodified, then gives the readiness verdict, and a TypeScript checker enforces the A-01 rules the validator does not. `docs/sources.md` is rendered from the YAML, so every number carries its URL and UTC capture time. If TCAD stays blocked (403 on 2026-10-17 and 2026-10-19), the expected outcome is exit 1 with `parcel` as the only blocked gate, a complete records request and the run in `WAITING_HUMAN` (spec FR-006c).

## Technical Context

**Language/Version**: TypeScript 7 on Node 22 (run with `tsx`). Python 3 only to run the vendored kit validator as provided (article II, ARD D-03).

**Primary Dependencies**: existing `@restatedev/restate-sdk` 1.17, `p-limit` 7, `postgres` 3, `dotenv`; to add: `zod` (boundary parsing), `yaml` (block-style catalog emit and read), `stream-json` (streaming count of the TCAD export).

**Storage**: the catalog and evidence are files in git. The raw TCAD export goes to `pipeline/data/raw/tcad/` (gitignored). The local Postgres Query DB is **not written**; only its identity is read for destination proof.

**Testing**: Vitest (guard, schema, checker, renderer, status mapping); validator `--self-test`; validator run with PyYAML (`python3`, PyYAML 6.0.3 in the user site) and without it (`python3 -s`) for parser parity. No Playwright: A-01 has no hosted surface (G4 C-04 exception).

**Target Platform**: operator machine with the local stack (Docker: Restate + Postgres); one GitHub-hosted US runner only for the approved geo-check.

**Project Type**: pipeline enabler (CLI scripts + one durable workflow), inside the AD-23 layout.

**Performance Goals**: Austin throughput from at least 3 consecutive pages of at most 50,000 rows (≤ 150,000 rows read, about 6% of the dataset). Whole discovery run completes within the 1-day story budget (SC-006).

**Constraints**: ≤ 2 concurrent requests per source host; backoff 1 s base, 60 s cap, 5 attempts with full jitter on 429/5xx only; 0 retries on 403, challenge or timeout; one constant identified User-Agent; no proxy/IP/UA rotation; TCAD export parsed as a stream (bounded memory, file may be multi-GB); no secrets or absolute home paths in evidence.

**Scale/Scope**: 9 source rows (A-oracle § 4); about 20–25 permit jurisdictions (Census places with land in Travis County + unincorporated); counts on 2.38 M Austin rows and the full TCAD roll, using server-side counts or streaming, never paging to count.

## Kit Agent Ownership *(mandatory, constitution XIII–XVII)*

Copied from `stories/A-01-discover-sources.md` front matter and [agent-design.md](agent-design.md).

| Role | Agent(s) | Skills loaded | What it decided (cite agent-design.md) |
|------|----------|---------------|----------------------------------------|
| Design consult | `oracle` | onboard-county, county-discovery, county-readiness-preflight, bootstrap-oracle-infra, apply-engineering-guidelines | Catalog keys the validator reads (§ Data 1); spec-class → validator-status mapping (§ Data 2); A-01 keys the validator ignores (§ Data 3); capture receipt and run record (§ Data 4); risks 1–13, chiefly the status mismatch, the TCAD 403 outcome, the null-GIS gap and YAML parser divergence |
| Builder | `oracle` | the five skills above + apply-engineering-guidelines | Patterns 1–9: unmodified fail-closed gate, one HTTP boundary with StopOnBlocked, Zod at every boundary, a Restate workflow with journaled steps, bounded measurement, roll-not-GIS, two-identity destination proof, TS-only code, data honesty |
| Reviewer(s) | `oracle` | — | Scores the branch 0–100 in `docs/reviews/CR-A-01.md` (≥ 75) against the patterns and the verify list ("How to verify" 1–10) |
| Verify | readiness validator exits 0 | — | Validator run on the committed catalog: exit 0 with `overall: PASS`, or the documented exit 1 with `parcel` as the only blocked gate (FR-006c). There is no hosted URL for this Project feature; hosted display is verified in A-11 AC-4 and A-13 AC-1/AC-2 (G4 C-04 exception) |

**Patterns the code must show** (from the builder's answer, each mapped to a path in Project Structure):

| # | Pattern | Path |
|---|---------|------|
| 1 | Fail-closed gate run unmodified, SHA-256 checked, relative catalog path, no auto-advance to seed | `pipeline/oracle-runtime/kit/use-oracle/scripts/validate-county-readiness.py` (vendored), `pipeline/oracle-runtime/travis/discovery/run-validator.ts` |
| 2 | One HTTP boundary: StopOnBlocked, backoff only on 429/5xx, `p-limit(2)` per host, constant identified UA, no rotation, `isGeoBlock` only on an explicit signal | `pipeline/oracle-runtime/travis/lib/source-client.ts` |
| 3 | Zod at every boundary, closed list: Socrata responses (`3syk-w9eu`, `9cir-efmm`), ArcGIS count response, Census file rows, TCAD export records (each streamed record parsed for the key and date fields used), the Export Layouts field list, evidence-page responses (status, content type, challenge markers), the catalog on read and write, and the `resolve` command arguments; a challenge page fails the parse and becomes `blocked` | `pipeline/oracle-runtime/travis/discovery/probes/*.ts`, `catalog.schema.ts` |
| 4 | Durable workflow: journaled `ctx.run` probe steps with idempotency keys; `WAITING_HUMAN` via a durable promise; long TCAD step timeout | `pipeline/oracle-runtime/travis/discovery/workflow.ts`, bound in `pipeline/local-stack/services/app.ts` |
| 5 | Measurement: ≥ 3 consecutive pages, median rate, server-side counts, streaming TCAD count, projected hours | `pipeline/oracle-runtime/travis/discovery/probes/socrata.ts`, `probes/tcad.ts`, `measure.ts` |
| 6 | GIS is not the population; null GIS gives the gap `unknown` with a reason | `probes/arcgis.ts`, `check-catalog.ts` |
| 7 | Destination proof from two independent identities (Docker side + SQL server side), no URL or password recorded | `pipeline/oracle-runtime/travis/discovery/destination-proof.ts` |
| 8 | TypeScript only; JSON logs with no secrets; optional Socrata token recorded only as `app_token_used` | all of `pipeline/oracle-runtime/travis/` |
| 9 | Data honesty: `docs/sources.md` rendered from the YAML; missing values carry a reason; no TCAD rows committed | `pipeline/oracle-runtime/travis/discovery/render-sources-md.ts` |

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design. Mark each ✅ / ❌ / N/A; every ❌ needs a row in Complexity Tracking.*

| # | Article | Check for this plan | Status |
|---|---------|---------------------|--------|
| I | Outcome first | A-01 has no hosted surface. Its proof is the committed catalog, summary and validator report in the PR (FR-007), all with real Travis County data; hosted display comes in A-11/A-13 | ❌ justified (G4 C-04 exception, see Complexity Tracking) |
| II–IV | Stack | All new code is TypeScript; the only Python is the vendored kit validator run as provided (II, D-03). No AWS resources, so no CDK and no region; CDK (top-level `infra/`, region from config, `project_name=oracle-travis` tags) arrives with the first AWS resource in A-03. Code sits in the AD-23 layout (`pipeline/oracle-runtime`, `pipeline/local-stack`); Turborepo and the api-client also arrive in A-03 | ✅ (CDK, api-client: N/A until A-03) |
| V–VI | Contracts and LLM | Zod parses every source response and the catalog before any logic; no `any`. No LLM calls | ✅ (VI: N/A) |
| VII–IX | Operations | VII: bounded concurrency (2/host), idempotency keys, exponential backoff, Restate journal/pause as the local DLQ (allowed by VII). VIII/IX: no Lambda and no hosted critical path, so Powertools, X-Ray and PagerDuty do not apply; structured JSON logs; a blocked source surfaces as `WAITING_HUMAN` in the run record | ✅ (VIII–IX: N/A, stated) |
| X | Quality gates | Vitest + `tsc` + ESLint + Prettier for `pipeline/oracle-runtime`, plus validator `--self-test`, run in a new GitHub Actions workflow `pipeline-ci.yml` (A-03 later folds it into Turborepo CI). Playwright: no hosted URL in this story | ✅ (Playwright: N/A) |
| XI | Data honesty | Every number is a measurement with source URL and UTC capture time; missing values carry a reason; `docs/sources.md` is generated, never hand-edited; no TCAD rows or sample records committed | ✅ |
| XII | Secrets | `.env` never printed; Socrata token optional (env/SSM), never logged; relative catalog path in the validator report; grep for `postgres://`, tokens and `/Users/` plus gitleaks before commit | ✅ |
| XIII–XV | Owner agents | Kit Agent Ownership filled; `agent-design.md` exists (word for word, 2026-10-19); builder patterns listed with paths; `/speckit-implement` delegates task groups to `soofi-xyz-team-kit:oracle` | ✅ |
| XVI | Owner review | `oracle` scores in `docs/reviews/CR-A-01.md`; under 75 blocks the merge | ✅ |
| XVIII–XXIII | Delivery | G4 passed (2026-10-19); G5 and G6 run before implement; tests written first and failing first (guard, checker, mapping); branch `001-discover-sources`, merged `--no-ff`; failing tests recorded as `docs/defects/ERR-{n}.md`. XXII's "hosted URL" is covered by the C-04 exception: test cases run against the committed artifacts and the validator | ✅ |
| Addendum | Task A (A1–A8) | **A1** ✅ kit flow and unmodified kit validator; Travis probes extend it, nothing reimplemented. **A2** ✅ nothing published; the Query DB is only identity-read. **A3/A4** N/A (no CIDs or manifests in A-01). **A5** ✅ contractor licensing recorded as evidence only, not identity. **A6** ✅ StopOnBlocked, no CAPTCHA bypass, bounded probes. **A7** ✅ no billable resources; the geo-check runs only on manual dispatch. **A8** ✅ kit 0.99.1 bundled skills only | ✅ |

**Gate result (pre-research)**: PASS. One ❌ (Article I) is justified in Complexity Tracking and was accepted by the PO at G4.

**Re-check after Phase 1 design**: PASS, unchanged. The data model and contracts add no public interface, no AWS resource and no new language; the status mapping (research R3) and parser rules (R5) remove the two highest risks before tasks.

## Project Structure

### Documentation (this feature)

```text
specs/001-discover-sources/
├── spec.md              # /speckit-specify + /speckit-clarify
├── agent-design.md      # oracle design input (word for word) + PO decisions
├── plan.md              # this file
├── research.md          # Phase 0: decisions R1–R12
├── data-model.md        # Phase 1: catalog, measurement, jurisdiction, receipt, run state
├── quickstart.md        # Phase 1: how to run and verify
├── contracts/
│   ├── catalog.md           # travis-sources.yaml keys (kit + A-01 extensions)
│   ├── capture-receipt.md   # internal receipt and run record
│   └── cli.md               # operator commands and exit codes
├── checklists/requirements.md
└── tasks.md             # /speckit-tasks (not created here)
```

### Source Code (repository root)

```text
pipeline/
├── oracle-runtime/                      # AD-23: vendored kit runtime + Travis code (new code in TS)
│   ├── package.json                     # zod, yaml, stream-json, p-limit, restate SDK, vitest
│   ├── tsconfig.json
│   ├── kit/
│   │   ├── VENDORED.md                  # kit version 0.99.1, source path, SHA-256 per file
│   │   └── use-oracle/scripts/validate-county-readiness.py   # unmodified
│   └── travis/
│       ├── lib/
│       │   ├── source-client.ts         # pattern 2: the single HTTP boundary
│       │   └── log.ts                   # JSON logs, redaction
│       ├── profiles/
│       │   └── jurisdictions.ts         # curated classifications with evidence URLs (versioned, AD-26 style)
│       └── discovery/
│           ├── workflow.ts              # pattern 4: TravisDiscovery Restate workflow
│           ├── probes/socrata.ts        # Austin 3syk-w9eu, Comptroller 9cir-efmm
│           ├── probes/tcad.ts           # one download + streaming count + layouts
│           ├── probes/arcgis.ts         # TCAD_PARCELS count only
│           ├── probes/census.ts         # incorporated places with land in Travis County
│           ├── probes/evidence.ts       # jurisdiction + licensing + BBB evidence pages
│           ├── measure.ts               # median rate, projected hours, 48 h rule
│           ├── destination-proof.ts     # pattern 7
│           ├── status-map.ts            # spec class → validator status (research R3)
│           ├── catalog.schema.ts        # Zod schema for the full catalog
│           ├── write-catalog.ts         # block-style YAML emit (research R5)
│           ├── check-catalog.ts         # A-01 rules the validator ignores (CLI, exit code)
│           ├── blocked-evidence.ts      # evidence files + blocked_evidence rows
│           ├── resolve.ts               # operator command for WAITING_HUMAN (FR-006f)
│           ├── run-validator.ts         # runs the vendored validator, saves report + exit code
│           └── render-sources-md.ts     # docs/sources.md from the YAML
│   └── test/                            # Vitest: guard, mapping, schema, checker, renderer (synthetic fixtures, test-only)
├── local-stack/
│   └── services/app.ts                  # changed: binds TravisDiscovery
├── docs/
│   ├── travis-sources.yaml              # the catalog (validator input)
│   └── travis-county-findings.md        # county-discovery findings profile (narrative)
└── data/raw/tcad/                       # gitignored: the one TCAD download

docs/
├── sources.md                           # generated from the catalog
└── evidence/
    ├── A-01.md                          # exit code, YAML SHA-256, one row per source, blocker record
    ├── A-01-readiness.json              # validator report as printed
    └── A-01-coverage.md                 # started here, completed in A-11

.github/workflows/
├── pipeline-ci.yml                      # tsc, lint, Vitest, validator --self-test
└── geo-check.yml                        # approved; added only if a geo-block signal is saved; manual dispatch, one request
```

**Structure Decision**: the probe code goes in `pipeline/oracle-runtime/travis/`, as AD-23 and the ARD module table require ("vendored kit runtime + Travis adapters/profiles, new code in TS"), not in `pipeline/local-stack/services/` as the oracle answer offered as an option. This keeps the plan inside the approved architecture with no Complexity Tracking entry. `pipeline/local-stack` stays the runtime host and only binds the workflow. `pipeline/oracle-runtime` gets its own `package.json` until A-03 adds the Turborepo workspace.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Article I / XXII: no hosted-URL proof for A-01 | A-01 is a `Project` feature (FEAT-A01, approved at G1) that produces a catalog and a validator verdict, not a screen. Its proof is the committed catalog, summary and validator report in the PR (FR-007). Hosted display is tested in A-11 AC-4 and A-13 AC-1/AC-2. Accepted by the PO at G4 (C-04 exception, 2026-10-19) | Building a hosted page now would duplicate A-13 before the A-03 skeleton exists and would delay the critical path A-01 → A-03 |

## Additions after planning (T063, 2026-10-20)

These touch-points were not in the plan when it was approved. Each was added during the live run or the reviews, for the reason given. All are offline TypeScript commands in `pipeline/oracle-runtime` (no new service, no AWS), each writes only its own catalog fields through `amendCatalog` (recorded in the catalog's `amendments` list), and each reruns the validator.

| Touch-point | Added for | Network |
| --- | --- | --- |
| `travis/discovery/record-gis-runner.ts` | Record the GIS count from the one approved US GitHub Actions runner request (DEC-A-01-source-access D-2; FR-006b amendment) | none (reads the runner artifact) |
| `travis/discovery/reprobe-jurisdictions.ts` | One re-probe of jurisdictions whose evidence fetch failed (network error, 404, 5xx); refuses 403, challenge and WAF rows (OR-M2) | one identified request per named row |
| `travis/discovery/explain-blocked.ts`, `travis/discovery/jurisdiction-explanation.ts` | A plain `blocked_explanation` on every non-supported row; no records request filed (PO decision 2026-10-20) | none |
| `travis/discovery/reconcile-parcel-gap.ts`, `travis/discovery/parcel-gap.ts` | Explain the 24.24% GIS-vs-roll gap from the certified export (account breakdown) | none (streams the held export) |
| `travis/discovery/approve-exception.ts` | Write the PO-approved parcel exception, bound to its values (OR-M3; DEC-A-01-parcel-gap-exception) | none |
| `travis/discovery/backfill-amendments.ts` | One-off: record the amendments made before the `amendments` list existed (OR-M5) | none |
| `travis/discovery/render-coverage.ts` | Regenerate `docs/evidence/A-01-coverage.md` from the catalog (OR-M5) | none |
| `travis/lib/egress.ts` | Check and record the egress country before any request-sending command (OR-B1) | one request to the Cloudflare trace (country only) |
| `pipeline/local-stack/services/prove-destination.ts`, `configured-db.ts` | A third destination identity through the configured connection (OR-m4) | local database only |
| `travis/discovery/refresh-tcad-landing.ts` | One identified request for the TCAD certification date (PO decision 2026-10-20; FR-003a amendment) | one identified request |
