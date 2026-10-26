# Data model: A-11 Publish and runs

> **Correction (2026-10-23):** `GroupArtifacts.group` below is widened to 5 groups; that was
> wrong (see `research.md`'s "Correction"). The real type is `"county" | "property_improvement"`.
> Owner and parcel-geometry fields are already part of `county`'s export; contractor identity is
> fields on `property_improvement`'s permit records (`contractor_company_cid`,
> `contractor_resolution`, plus 3 `aggregate_match` coverage keys), not a separate group.


No new persistent entity is introduced in the Query DB — this story only publishes what A-04/A-07 already reconciled. The entities below are the publication-layer shapes (`packages/contract` / `RunManifestV1`), extended for full-county scale.

## RunManifest (`oracle-travis-run-manifest.v1`)

| Field | Type | Notes |
| --- | --- | --- |
| `runId` | string | e.g. `travis-full-run1-{utc-timestamp}` |
| `previousManifestCid` | CIDv1 \| `null` | `null` for Run 1 (new chain start, per D-2(a)); the previous run's manifest CID otherwise |
| `startedAt`, `finishedAt` | ISO-8601 UTC | Recorded per run; **not** part of AC-10's "same CIDs" check (see research.md) |
| `groups[]` | `GroupArtifacts[]` | One entry per **changed** data group this run (unchanged groups are omitted, per research.md) |
| `sources[]` | `SourceDelta[]` | One entry per source this run's window covered |
| `coverage` | `Coverage` | Labelled counts only — never a direct Query DB read |

### GroupArtifacts (widened from 2 to 5 groups)

| Field | Type | Notes |
| --- | --- | --- |
| `group` | `"county" \| "property_improvement" \| "owner" \| "contractor" \| "parcels"` | Widened `DataGroup` union (was 2 groups in A-03) |
| `carCid` | CIDv1 | The group's CAR root |
| `tablesDirCid` | CIDv1 | The group's exported-tables directory root, itself with a `carCid` |
| `parts[]` | `{ cid, name, size, sha256 }[]` | Table parts at `--part-size 48m` |

### SourceDelta

| Field | Type | Notes |
| --- | --- | --- |
| `name` | string | `"austin_permits" \| "tcad_supplemental" \| "bbb_harvest"` for Run 2/3 (per D-2(c), only these three are re-checked; everything else keeps its previous CID) |
| `watermark` | string | Socrata `:updated_at` + content digest, or export date, or harvest date |
| `records` | number | Records read in this run's window |
| `delta` | `{ added, changed, removed }` | Computed from content digests, never from `:updated_at` alone (FR-006) |
| `limitations[]` | string[] | e.g. `"no newer export"`, `"blocked · 403"` when delta is `{0,0,0}` |

### Coverage

| Field | Type | Notes |
| --- | --- | --- |
| `published_rows` | `Record<table, number>` | Table row counts, derivation `"table_count"` |
| `capture_receipt` | `Record<source, number>` | Source totals at capture time, derivation `"capture_receipt"` |
| `aggregate_match` | `Record<string, number>` | Merge/parcel-match/five-state contractor totals, derivation `"aggregate_match"` |

## RunsIndex (`oracle-travis-runs-index.v1`)

| Field | Type | Notes |
| --- | --- | --- |
| `runs[]` | `{ runId, manifestCid, finishedAt }[]` | Append-only (existing `appendRun`, throws on duplicate `runId`/`manifestCid` — no change needed). Already holds the A-03 walking-skeleton run (kept as-is, per D-2(a)); A-11's Run 1 starts its own chain. The AC-10 idempotency re-run is **not** a new entry (per D-2(b)) — it's an evidence-only proof. |

## Scheduler (infra-only, no Query DB entity)

| Field | Type | Notes |
| --- | --- | --- |
| EventBridge Schedule | CDK `CfnSchedule`/`Schedule` | `state: "DISABLED"` throughout this story |
| Fargate `TaskDefinition` | CDK construct | No `FargateService` (no always-on resource, $0 idle cost); entrypoint = oracle's new non-interactive `publishRun`-equivalent (research.md) |
| Secrets | ECS `Secret` → Secrets Manager ARN | Never a plaintext connection string in `apps/` or `infra/` (AD-26) |
