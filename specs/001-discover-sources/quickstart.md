---
id: QS-A-01
parent: PLAN-A-01
---

# Quickstart: run and verify A-01

How to prove the story works. Commands are in [contracts/cli.md](contracts/cli.md); catalog rules in [contracts/catalog.md](contracts/catalog.md).

## Prerequisites

- Local stack up: `docker compose -f pipeline/local-stack/docker-compose.yml up -d` (Restate + Postgres), then `npm --prefix pipeline/local-stack start` (binds `TravisDiscovery`). `bootstrap-oracle-infra` checks this.
- `npm --prefix pipeline/oracle-runtime ci`.
- Optional: a Socrata app token in the environment (never committed or logged).
- Never print `pipeline/local-stack/.env`.

## Scenario 1: the verdict (AC-1, AC-6)

1. `npm --prefix pipeline/oracle-runtime run discover`
2. `npm --prefix pipeline/oracle-runtime run check-catalog` → exit 0.
3. `npm --prefix pipeline/oracle-runtime run validate` → expected one of:
   - exit 0, report shows `overall: PASS`, `seed_allowed: true`, `ingest_allowed: true`; or
   - exit 1 where the **only** blocked gate is `parcel` because TCAD is blocked, the run is `WAITING_HUMAN`, the TCAD row has `blocked_evidence` and a complete `records_request`, and the blocker is written in `docs/sources.md` and `docs/evidence/A-01.md`. Permit, destination, enrichment and metadata gates PASS.

## Scenario 2: kit gate integrity and parser parity

1. `python3 pipeline/oracle-runtime/kit/use-oracle/scripts/validate-county-readiness.py --self-test` → exit 0.
2. `shasum -a 256` of the vendored file equals the value in `kit/VENDORED.md`.
3. Run the validator with PyYAML (`python3 …`) and without it (`python3 -s …`, which skips the user site where PyYAML is installed); the two reports are identical.

## Scenario 3: guard behavior (AC-6, NFR-001)

`npm --prefix pipeline/oracle-runtime test` → the guard tests pass: 403 → 1 attempt, `blocked`, `WAITING_HUMAN`; challenge page → `blocked`; 429 → capped backoff, ≤ 5 attempts; constant User-Agent, no proxy; bare 403 is not a geo-block, an explicit geo signal is.

## Scenario 4: honesty and traceability (AC-7, SC-002)

1. `npm --prefix pipeline/oracle-runtime run render-sources` → `git diff docs/sources.md` is empty.
2. Pick 3 numbers in `docs/sources.md`; each links to its source URL and UTC capture time (under 2 minutes each).
3. Spot re-measure: an independent `count(*)` on `3syk-w9eu` limited to rows created by the measurement's `captured_at` equals the catalog value exactly; the `9cir-efmm` county-227 recount and the Austin-issued counts per jurisdiction agree within 0.5% (test cases TC-005, TC-006, TC-014).

## Scenario 5: hygiene

- `git check-ignore pipeline/data/raw/tcad/<file>` succeeds; no TCAD rows are committed.
- gitleaks is clean; a grep of `docs/evidence/` and the catalog finds no `postgres://`, token values or `/Users/` paths.

## Scenario 6: CI

The `pipeline-ci` workflow is green on the story branch (tsc, lint, Vitest, validator `--self-test`).

## If TCAD's response carries a geo signal

Only then: trigger the approved `geo-check` workflow once (user action) and record its artifact. A plain 403 or challenge goes straight to a records request.
