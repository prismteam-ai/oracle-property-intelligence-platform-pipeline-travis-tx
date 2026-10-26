# Quickstart: validate A-03 end to end

Run guide only; the commands are specified in [contracts/cli.md](contracts/cli.md) and the APIs in [contracts/api.md](contracts/api.md). localhost is never evidence.

## Prerequisites
- Node 22, pnpm 10, `aws` with profile `assess` (region `eu-north-1` from the profile), `~/.config/assessment/filebase.env`.
- `pnpm install` at the root; `npm ci` in `pipeline/oracle-runtime`.
- `node_modules/.bin/elephant-cli --version` reports commit 44bb182.

## 1. Local tests (all must pass)
```bash
pnpm turbo typecheck lint test synth      # unit, contract, CDK assertions, order test, verify allowlist, label coverage
(cd pipeline/oracle-runtime && npm test)
```
Expected: green; `infra` assertions list no banned resource types.

## 2. Capture and build (no network beyond Austin Socrata)
```bash
(cd pipeline/oracle-runtime && npx tsx travis/runs/run-month.ts --month 2026-09)
pnpm --filter @countylens/publish exec tsx src/cli.ts build --run <runId>
```
Expected: summary ≈ 42 captured / 38 accepted / 1 no-tcad, plus `owners_redacted`; roots and parts printed; every part ≤ 50.3 MB; a second `export-tables` on the same CAR reproduces the same tables root (T046 determinism check); the run directory's `elephant-cli.log` and `reports/*.json` pass the secret scan before anything is quoted.

## 3. 🛑 D-8, then publish
```bash
set -a; . ~/.config/assessment/filebase.env; set +a
pnpm --filter @countylens/publish exec tsx src/cli.ts upload --run <runId>
pnpm --filter @countylens/publish exec tsx src/cli.ts cid-copy --manifest runs/<runId>/manifest.json
npx tsx scripts/verify-manifest.ts runs/<runId>/manifest.json
```
Expected: readback OK; `ALL ARTIFACTS VERIFIED` (Pinata + Filebase).

## 4. 🛑 D-10, then deploy and push
```bash
pnpm --filter @countylens/infra exec cdk diff --profile assess
# deploy in order: CountyLensData CountyLensApi CountyLensWeb CountyLensOps CountyLensCert
git push origin 003-walking-skeleton
```
Expected: Amplify branch preview builds; `/build.json` SHA = HEAD.

## 5. Hosted checks
```bash
RUNTIME_URL=https://<branch>.<appId>.amplifyapp.com pnpm --filter @countylens/e2e exec playwright test
RUNTIME_URL=… pnpm --filter @countylens/e2e exec playwright test -g "A-03-TC-NF-05"   # uploads, benches, deletes
```
Expected: every `@scenario:A-03-TC-*` passes; smeargle 390/768/1440 green; Lambda radius + roof-age p95 < 3 s; private copy deleted and the deletion recorded in `docs/evidence/A-03.md`.
