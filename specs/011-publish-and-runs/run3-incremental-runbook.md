# Run 3 incremental refresh: runbook

Status: rehearsed on a throwaway copy on 2026-10-25 (nothing real was written). Run it only after the
other Run 3 branches are merged and the PO approves. All paths are from the repo root unless a `cd`
is shown. `DATABASE_URL` comes from `pipeline/local-stack/.env`; never print it.

## What the rehearsal found (Austin permits 3syk-w9eu, watermark 2026-10-21T14:42:23.154Z)

| Item | Value |
| --- | --- |
| Source rows now / in Run 2 | 2,381,886 / 2,381,226 (+660) |
| Rows with `:updated_at` newer than the watermark | all 2,381,886 (Austin re-stamped every row on 2026-10-24 14:31 to 14:51 UTC) |
| Re-stamp detector | fired (window share 100%), so the run pages the whole dataset by `:id` (48 pages) and decides by content digest |
| Delta by content digest | added 660, changed 9,922, removed 0, unchanged 2,371,304 |
| New watermark | 2026-10-24T14:51:37.805Z |
| Re-keyed rows | Austin also regenerated many `:id` values; the key-set diff treats them as re-keys, not removals |
| Changed content | mostly Austin dropping `latitude`/`longitude`/`location` from about two thirds of changed rows, plus status/expiry dates and a few contractor fields |
| Roofing permits linked to a TCAD parcel (Query DB) | 16,816 before, 16,816 after: 0 added, 4 changed, 0 removed |
| Published roofing permits (15,025 in Run 2) | re-export of the 2,433 affected pIDs: 555 permit files, all byte-identical to Run 2; 0 added, 0 changed, 0 removed; 0 new folders |
| Control | 300 unaffected pIDs re-exported: 362 permit files and all shared files byte-identical to Run 2 |
| Permit-link totals after relink | linked 2,008,095; no_tcad_geoid 275,830; no_tcad_id 31,824; ambiguous_geoid 36,568; address_unmatched 29,480; ambiguous_address 89 (sum 2,381,886) |
| Existing rows, content unchanged | 0 link changes, 0 roofing-verdict changes, 0 status-class changes (so no property or permit CID moves) |
| `open_days` | changes for 191,551 existing rows because the as-of date moves; it is not in the published permit files today |

So the real Run 3 delta lands in the manifest `sources[]` entry for Austin, but the published
Property Improvement files do not change. Expect the permits group to keep its Run 2 content.

## Time estimates (this machine)

| Step | Estimate |
| --- | --- |
| Capture and merge (48 pages, 1 request in flight, at least 1 s apart) | 50 to 70 min (about 40 s download plus 20 to 40 s merge per page; the first pages of a freshly bulk-loaded copy were 7 min each until `VACUUM ANALYZE`, a copy artifact) |
| `--link` over all permits | about 6 min |
| `incremental-facts.ts` (both phases) | under 1 min |
| Re-export of affected pIDs | under 2 min (2,433 pIDs) |
| Batch hash, validate, export, manifest, publish | as for Run 2 (about 1 min per 5 batches locally, plus uploads) |

## Preconditions

1. `git status` clean on the integrated branch; UTC date is later than Run 2's (2026-10-24), so
   Run 3 is a third distinct date.
2. Local stack up: Restate on 9070, Postgres on 5432 (`bootstrap-oracle-infra`).
3. No other ingest running (one at a time, FR-025): `npm --prefix pipeline/oracle-runtime run backbone -- report ...` shows none running.
4. Optional safety copy: `docker exec oracle-travis-local-postgres-1 pg_dump -U postgres -d elephant -Fc -t permit_source_rows -t property_improvements -t watermarks -t source_tombstones > <dir>/permits-before.dump`.
5. Record the before state (read-only): the `watermarks` row for track `permits`, key `austin-3syk-w9eu`
   must show `maxUpdatedAt` 2026-10-21T14:42:23.154Z and `endTotal` 2381226. If it differs, stop:
   the base manifest and the DB disagree.

## Ordered commands

```bash
# 1. Capture and merge (durable, through Restate). Prints job_id=<J>; re-stamp is detected, so it pages everything.
npm --prefix pipeline/oracle-runtime run backbone -- permits --mode incremental
#    exit 0 ok, 1 error, 2 blocked (a 403: stop, never retry), 3 waiting_human.
#    Rehearsal without Restate, on a scratch copy only: pipeline/local-stack/scripts/permits-incremental-direct.ts

# 2. Record which pIDs the job touched BEFORE relinking (a changed permit may move parcel).
cd pipeline/local-stack
npx tsx scripts/incremental-facts.ts pre-link --job <J> --out ../../specs/011-publish-and-runs/run3

# 3. Relink, reclassify and recompute open days over every permit.
cd ../..
npm --prefix pipeline/oracle-runtime run backbone -- permits --link

# 4. Other Run 3 loads that depend on permits, in the order their branches define
#    (roof-age:backfill --apply, identity:resolve, reconcile:merge, coordinates). Not part of this branch.

# 5. Facts, receipt and affected pIDs (read-only SQL; refuses if the link step has not run).
cd pipeline/local-stack
npx tsx scripts/incremental-facts.ts final --job <J> --out ../../specs/011-publish-and-runs/run3 \
  --base-manifest ../../runs/travis-full-run2-20261024/manifest.json
#    writes austin-facts.json, austin-receipt.json, affected-pids.txt, prints added/changed/removed/unchanged.
#    Check: watermarkUsed == Run 2's Austin watermark, recordsRead == endTotal, watermarkCheck pass.

# 6. Rebuild the Property Improvement folders for the affected pIDs, seeded from Run 2 so unchanged pIDs are reused.
cp -Rl pipeline/data/runs/travis-a11-permits-fix-20261024 pipeline/data/runs/travis-a11-permits-run3-<yyyymmdd>
sort -u ../../specs/011-publish-and-runs/run1-permit-pids.txt ../../specs/011-publish-and-runs/run3/affected-pids.txt > /tmp/run3-pids.txt   # use the run's scratchpad, not /tmp
npx tsx scripts/reexport-permits.ts --pids <that file> --job travis-a11-permits-run3-<yyyymmdd> --chunk 500 --concurrency 4
npx tsx scripts/reexport-permits.ts --pids <that file> --job travis-a11-permits-run3-<yyyymmdd> \
  --compare-run ../../pipeline/data/runs/travis-a11-permits-fix-20261024/groups/property_improvement
#    Report permitsHere/identical/DIFFERENT/not in Run 2/Roofing lost. In the rehearsal: 0 / 0 / 0.
#    A different permit file is allowed only if its content really changed (the compare prints FAIL then; read the list).

# 7. Batches, hash, validate, export-tables: as for Run 2 (pipeline/publish/scripts/batch-hash-validate-export.sh).
#    If the permits files are byte-identical to Run 2, the batches reproduce Run 2's CIDs: keep the previous CIDs
#    and do not republish the permits group (AC-11). If the pID set grows, see Risk 1.

# 8. Manifest. Base is Run 2 (not Run 1). Coverage keys the builder reports as stale (contractor_*, permits_trade_sub_permit)
#    go in a --config file under coverageOverrides.
npx tsx pipeline/publish/scripts/build-run-manifest.ts --config specs/011-publish-and-runs/run3/config.json \
  --run-id travis-full-run3-<yyyymmdd> --started-at <iso> --finished-at <iso> \
  --previous-manifest-cid bafkreife3vk3cgcod3v6tue2xes3hvl2vndqoshbhrhsnjtriskihpcute \
  --base runs/travis-full-run2-20261024/manifest.json \
  --county-dir <county batches> --permits-dir <permits batches> \
  --austin-facts specs/011-publish-and-runs/run3/austin-facts.json \
  --austin-receipt specs/011-publish-and-runs/run3/austin-receipt.json

# 9. Publish exactly as Run 2: publish-run.ts --manifest runs/<runId>/manifest.json --run-id <runId> --dry-run [--probe], then without --dry-run.
# 10. Verify: scripts/verify-manifest.ts on Run 1's manifest (must still print ALL ARTIFACTS VERIFIED) and on Run 3's.
```

## What the manifest will say (Austin source)

`watermark` = new watermark; `records` = 2,381,886 (capture-time total, also what the permit-link
reconciliation adds up to); `added` 660, `changed` 9,922, `removed` 0 (content digest, never
`:updated_at`). The manifest schema (`RunManifestV1`, strict) has no field for the watermark used or
the rows read, so one limitation line states both: `Incremental run: whole dataset paged by :id ...;
2381886 rows read; watermark used ...; new watermark ...; delta by content digest: added ..., changed
..., removed ..., unchanged ...`, plus `source bulk re-stamp; delta by content digest`. TCAD keeps
its watermark with delta 0 and `source unchanged, watermark entry@sha256:...` (AC-11). The Comptroller
registry is not a manifest source (it is internal), so it has no entry.

## Run history and the Runs page

`runs/index.json` gets the new entry (`publish-run.ts` step `index`). `apps/web` `Runs.tsx` shows only
the latest run, read from the index and the manifest by CID, so Run 3 appears automatically with its
run id, times, sources and coverage. This branch adds one line per source: added, changed, removed and
the watermark. Still missing for the README's "visible run history": the page does not list earlier
runs or compare two runs, and it does not show `limitations` (so the "watermark used" and the
"source unchanged" reasons are only in the manifest). Change needed: read every index entry
(`loadRunsIndex` already returns them all), render a list of runs newest first, and render
`source.limitations` under each source. `design/prototype/RunsCompare1440.dc.html` is the target.

## Risks

1. Batch churn: `split-into-batches.py` cuts equal-count batches of sorted pID folders. Any new pID
   folder shifts every boundary and changes all 5 permits batches. In the rehearsal the 2,433 affected
   pIDs produced no new folder, so the batches stay the same; if another branch adds permits for new
   parcels, batches will change. Fixed pID-range batching would avoid it (not done here).
2. Austin removed coordinates on about two thirds of changed rows. The Query DB payload now has no
   latitude/longitude for those permits; the `permit_point` coordinate source (coordinates branch) reads them.
3. `open_days` moves with the run date for every open permit. If the open_days branch publishes it,
   each relink will change published permit files for open permits (they would be "changed" without a source change).
4. `--link` is one transaction over all permits and takes the Loader lock for about 6 min.
5. A narrow window (no re-stamp) cannot detect removals; the facts then say `removals not checked`.
   Removal is found only by a full pass (key-set diff) or by counts: stored rows minus rows unmoved at the
   watermark minus window rows already stored (`inferRemovedCount`).
6. A page failing 5 times ends the job `failed` without advancing the watermark; rerun resumes nothing
   for incremental mode (it restarts the pass). A 403 stops the run for a human.
7. The rehearsal raw pages are kept at `/private/tmp/claude-501/.../scratchpad/austin-artifacts` (552 MB);
   the real run captures again (data may differ by then).
