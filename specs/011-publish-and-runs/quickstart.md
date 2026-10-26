# Quickstart validation: A-11 Publish and runs

> **Correction (2026-10-23):** the real publish groups are `county` and `property_improvement`
> only — see `research.md`'s "Correction" section. Any mention below of 5 groups is stale.


Prerequisites: on branch `011-publish-and-runs`, local Restate + Postgres stack up, `~/.config/assessment/filebase.env` and `~/.config/assessment/pinata.env` present (chmod 600), elephant-cli at `~/.local/share/elephant-cli-main/node_modules/.bin/elephant-cli` (commit `44bb182`).

## Run 1 (User Story 1 — P1)

```bash
set -a; . ~/.config/assessment/filebase.env; . ~/.config/assessment/pinata.env; set +a
# the fixed 6-step sequence runs per group (county, property_improvement, owner, contractor, parcels);
# see contracts/publish-sequence.md for the exact commands.
npx tsx scripts/verify-manifest.ts runs/{run1}/manifest.json
```

**Expected**: prints `ALL ARTIFACTS VERIFIED`, exits 0. This is the story's first independent test (stories/A-11-publish-and-runs.md).

## Run 2 / Run 3 (User Story 2 — P2), each on a later UTC date

```bash
# incremental runner reads per-source watermarks, computes delta from content digests
npx tsx scripts/verify-manifest.ts runs/{run1}/manifest.json   # must still pass after Run 3
```

**Expected** (checks.md § 6.2 immutability check):
1. `runs/index.json` has ≥ 3 runs on ≥ 3 distinct UTC dates.
2. Each manifest's `previousManifestCid` links to the one before.
3. Run 1's manifest still verifies in full after Run 3.
4. No IPNS field anywhere (`N/A: no IPNS (AD-03)`).

## Idempotency (AC-10)

```bash
# re-run with identical inputs
```

**Expected**: 0 rows written; the **data-group** CAR/table CIDs are identical to the previous run's (not the manifest CID — see research.md). Recorded in `docs/evidence/A-11-runs.md`, not as a new `runs/index.json` entry (D-2(b)).

## Scheduler (User Story 3 — P3)

```bash
cd infra && npx cdk synth
```

**Expected**: CDK assertion confirms the EventBridge schedule state is `DISABLED`, its target is the Fargate task, no Query DB connection string exists in `apps/` or `infra/`, and no always-on resource (no `AWS::ECS::Service`) exists — $0 while disabled.
