# Quickstart: validate A-02

Run from the repository root on branch `002-data-contract`. There is no hosted runtime until A-03.

## Prerequisites

- Node ≥ 22, pnpm 10, DuckDB CLI.
- elephant-cli at `~/.local/share/elephant-cli-main` (commit 44bb182), pinned in the root `package.json`.
- The TCAD certified ZIP from A-01 in `pipeline/data/raw/tcad/`.

## Steps and expected results

| # | Command | Expected |
|---|---|---|
| 1 | `pnpm install` | the workspace installs |
| 2 | `pnpm --filter ./profiles/travis-austin@1.0.0 measure` | `expectations.json` written; candidates = include − excluded − trade − needs_review; 0 Auxiliary Power candidates (AC-5) |
| 3 | `pnpm --filter ./profiles/travis-austin@1.0.0 sample` | 25 permits with seed and verdicts in `docs/evidence/A-02-classifier-review.md` (AC-3, PO review) |
| 4 | `pnpm --filter ./packages/query-core build-gazetteer` | gazetteer JSON + DIGEST; Pflugerville → 4857176 at 30.447765, −97.602116 (AC-6) |
| 5 | `cd pipeline/oracle-runtime && npx tsx travis/pilot/run-pilot.ts` | captures (stop on 403), TCAD subset, groups, then the 8 CLI steps with exit code 0 and header-only error CSVs; `tables-export.json` × 2; pilot manifest + CID |
| 6 | `PILOT_DIR=pipeline/data/pilot/travis-pilot-20261020 pnpm vitest packages/query-core` | all view tests green over the pilot tables (AC-2, AC-7) |
| 7 | `pnpm vitest --coverage` | ≥ 80% on `query-core` and `contract` (NFR-002) |
| 8 | `duckdb -c "SELECT count(*) FROM 'contract/v1/sample.parquet'"` | `20` (AC-8) |
| 9 | open `docs/decisions/0002-lexicon-carriers.md` | 9 verdicts with evidence (AC-1) |

Schemas: [contracts/](contracts/), [data-model.md](data-model.md).
