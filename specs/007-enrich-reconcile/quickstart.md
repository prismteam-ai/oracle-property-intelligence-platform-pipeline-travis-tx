# Quickstart: validating A-07

A-07 is pipeline-only (`ui: false`) — there is no hosted URL to click through. Every validation step runs from a terminal at the repo root, on branch `007-enrich-reconcile`, against the local stack (Restate + Postgres).

## Prerequisites

- Local stack up: `bootstrap-oracle-infra` passes, `http://localhost:9070` answers.
- Egress check passes (VPN off) before any Comptroller or Overture request.
- `~/.local/share/elephant-cli-main/node_modules/.bin/elephant-cli --help` prints (never the Homebrew copy).

All commands below run as `npm --prefix pipeline/oracle-runtime run backbone -- <verb> [flags]` (the `backbone` script in `pipeline/oracle-runtime/package.json`, `travis/backbone/cli.ts`). Earlier drafts of this file and `contracts/cli.md` wrote this as a shorthand `EN <verb>` that was never wired to a real binary — TN02 caught it (2026-10-23); both files now show the real command. Run from the repo root.

## Track A — contractor identity

```bash
npm --prefix pipeline/oracle-runtime run backbone -- identity:load-registry --source tx-comptroller --scope travis
npm --prefix pipeline/oracle-runtime run backbone -- identity:resolve --scope austin-roofing-permits --registry-snapshot <digest-from-previous-step>
cat pipeline/data/identity/travis/<jobId>/resolution-report.json
```
There is no `identity:report` verb (an earlier draft of this file named one that was never built, caught by TN02); the five-state totals and match-rule version are in the resolution run's own report JSON, and `node pipeline/oracle-runtime/travis/runs/a07-verify.ts` prints the same totals from the assembled manifest-coverage shape.

Expected: five-state totals sum to the permit total (22,084); `resolved` = 0 with the AC-2 fixture test proving the code path separately; `contractor_not_printed` count ≈ 15,060. Confirmed live 2026-10-22: resolved=0, candidate=311, ambiguous=0, conflicting=78, unresolved=21,695.

## Track B — BBB (stub only, not built this pass)

```bash
npx vitest run pipeline/oracle-runtime/test/travis/a07/bbb
```
Track B is a documented gap this run (PO cost-mode scope decision, 2026-10-22): bbb.org is blocked by a Cloudflare challenge (A-01 receipts), so no `bbb:probe` verb is built or run. The stub tests above don't exist either, since Track B's code wasn't built.

## Track C — business/places (only if tracks A and D merged before 2026-10-23 12:00 EEST)

```bash
npm --prefix pipeline/oracle-runtime run backbone -- business:transform --scope travis
npm --prefix pipeline/oracle-runtime run backbone -- places:probe-counts --release 2026-09-23.0 --county-fips 48453
```
Not built this pass (same PO scope decision as Track B) — these verbs don't exist yet. Expected, once built: business count equals the Comptroller source count at the watermark; places either loaded with category counts and the pinned release recorded, or the "Places: not loaded · {reason}" limitation if the licence gate (D-15) failed.

## Track D — reconcile and roof age

```bash
npm --prefix pipeline/oracle-runtime run backbone -- reconcile:merge --entity-type property
npm --prefix pipeline/oracle-runtime run backbone -- reconcile:merge --entity-type owner
npm --prefix pipeline/oracle-runtime run backbone -- reconcile:merge --entity-type contractor
npm --prefix pipeline/oracle-runtime run backbone -- roof-age:audit --limit 25 --offset 0 --as-of-date 2026-10-22 --source-system travis-austin-permits --report pipeline/data/roof-age/travis/<jobId>/audit.json
npm --prefix pipeline/oracle-runtime run backbone -- roof-age:backfill --as-of-date 2026-10-22 --source-system travis-austin-permits --report pipeline/data/roof-age/travis/<jobId>/apply.json --apply
```
Expected: `merge {entityType, inputRecords, canonical}` per type (contractor merges = 0, expected). Confirmed live 2026-10-22: property/owner 1,001,321 → 493,246 canonical, 0 refused; contractor 0/0/0. The 25-row audit report is ready for D-21 review; `--apply` runs only after that approval, then a re-run shows `rowsWritten: 0` (confirmed: 25/25 agreement, then the full roll at 493,246 parcels, re-run `rowsWritten: 0`).

## Unit tests (all tracks)

```bash
cd pipeline/oracle-runtime && npm test && npx vitest run --coverage
```
Expected: ≥ 80% coverage on business-rule code in `packages/query-core`, `packages/contract` and the profiles (NFR-09).
