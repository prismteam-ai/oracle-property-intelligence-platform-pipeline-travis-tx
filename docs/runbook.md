# Runbook

Everything the operator runs, in order, with the exact commands. Paths are absolute for this
machine; the kit checkout on branch `travis` is `/Users/luti/dev/ateam/role1-prism/kit-travis`
(the plugin checkout `/Users/luti/dev/ateam/role1-prism/kit` stays at the pin on `main` and is
never modified). The Travis files are mirrored under `oracle/travis/` here; `oracle/travis/apply-to-kit.sh`
rebuilds them into any kit checkout at `99c7bff`.

Increment state is in `docs/progress.md`. The stop-per-increment rule applies: T1 is handed to
the operator; nothing below past T1 runs until the operator has run T1 and replied.

## 0. One-time setup

```bash
cd /Users/luti/dev/ateam/role1-prism/kit-travis/skills/use-oracle/runtime && npm ci && TZ=America/Chicago npm test
cd /Users/luti/dev/oracle-property-intelligence-platform-pipeline-travis-tx && npm ci && ./node_modules/.bin/elephant-cli --version   # 1.58.1 (44bb182)
```

The Broward `coconut-creek` fixture test is timezone-sensitive at `99c7bff` (it expects a date one
day off outside US timezones); `TZ=America/Chicago` makes the whole suite green and does not touch
any Travis code (every Travis date is computed in UTC).

## 1. T1 readiness

The US egress window ran on 2026-10-16 (agent): the counts are in the catalog, the identifier is proven,
and the validator is BLOCKED on one thing only, the parcel gate's material GIS gap (12.51%, condo accounts
without their own polygons). Kit evidence: `skills/use-oracle/runtime/docs/travis-county-findings.md`
section 0 and `skills/use-oracle/runtime/docs/evidence/`.

### Observe the current state

```bash
cd /Users/luti/dev/ateam/role1-prism/kit-travis
python3 skills/use-oracle/scripts/validate-county-readiness.py skills/use-oracle/runtime/docs/travis-sources.yaml
```

Prints `"overall": "BLOCKED"`; parcel `BLOCKED` with "GIS 386682.0 vs assessed 441961.0 is approximately
12.5% (threshold 2.0%); unresolved material discrepancy; GIS-only seeding is not allowed"; permit `PASS`
(23/23), destination `NOT_APPLICABLE`, enrichment `PASS` (kit `docs/travis-readiness-2026-10-16-us-egress.json`).

### Decide the parcel exception (operator decision), then observe PASS

The kit requires the cause, canonical denominator, seed decision, excluded population and coverage effect
of a gap above 2% to be documented **and approved**. They are documented in `travis-sources.yaml` under
`approved_exceptions` as `gate: parcel-pending-operator-approval` (the validator ignores that gate name).
Read it first. Running the next command **is** the approval: it renames the gate to `parcel`, marks it
approved, and re-runs the validator.

```bash
cd /Users/luti/dev/ateam/role1-prism/kit-travis && sed -i '' -e 's/^  - gate: parcel-pending-operator-approval$/  - gate: parcel/' -e 's/^    status: proposed-awaiting-operator-approval$/    status: approved-by-operator/' skills/use-oracle/runtime/docs/travis-sources.yaml && python3 skills/use-oracle/scripts/validate-county-readiness.py skills/use-oracle/runtime/docs/travis-sources.yaml
```

Expect `"overall": "PASS"`, `"seed_allowed": true`, `"execution_allowed": true`, parcel `PASS`
(a dry run on a temporary copy returned exactly that). Commit the catalog change on the kit branch.

### Seed (only after PASS, under US egress; county-seed-data)

The TCAD files are already downloaded (free, sha256 receipts in kit `docs/evidence/travis-tcad-downloads-2026-10-16.jsonl`)
into the gitignored `skills/use-oracle/runtime/data/travis/export/`. The export is the PACS Legacy 8.0.33
fixed-width format; the script streams it from the archive and pages the TNR **MapServer** layer (the
FeatureServer path is not enabled) at 1,000 features per request, about 387 requests.

```bash
curl -s ipinfo.io/country          # must print US
cd /Users/luti/dev/ateam/role1-prism/kit-travis/skills/use-oracle/runtime
node src/counties/travis/build-seed.mjs \
  --export-archive 'data/travis/export/2026 Certified Appraisal Export Supp 0_07182026.zip' \
  --export-url 'https://traviscad.org/wp-content/largefiles/2026%20Certified%20Appraisal%20Export%20Supp%200_07182026.zip' \
  --tnr-cache data/travis/tnr --fetch-tnr \
  --output data/seeds/travis.csv \
  --pilot-output data/seeds/travis-pilot.csv --pilot-size 25
# prints travis_seed_complete: counts.rowsWritten (expected 441,961), gisFeatureCount, rowsWithGeometry,
# foldedOwnerRecords, confidentialOwners, tcadIdNormalizationProof.oneToOne and the 25 pilot PROP_IDs;
# data/seeds/travis-seed-manifest.json keeps the same. Re-run the validator right after.
```

Free files on the TCAD page, for the record: certified export
`https://traviscad.org/wp-content/largefiles/2026%20Certified%20Appraisal%20Export%20Supp%200_07182026.zip`,
layout `https://traviscad.org/wp-content/largefiles/Website_Legacy8.0.33-AppraisalExportLayout_06182026.zip`,
improvement report `https://traviscad.org/wp-content/largefiles/improvement_detail_2026.zip`, certified
totals `https://traviscad.org/wp-content/uploads/totals_2026_AsOfRollCorr_0_RunID_6885_20260718_171007.pdf`.

## 2. Preparation that is already done (not T2)

Committed on the kit branch `travis` and mirrored under `oracle/travis/`: the Travis adapter, the
transform with the Seed group, the permit profile and fixtures, the replay fixture, the seed script.
`elephant-county replay --county travis` proves the offline path:

```bash
cd /Users/luti/dev/ateam/role1-prism/kit-travis/skills/use-oracle/runtime
node bin/elephant-county.mjs replay --county travis --fixture fixtures/travis-replay --output "$(mktemp -d)"
```

## 3. T2 — appraisal transform and appraisal-only pilot (offline)

Runs offline: no `--live-fetch`, so no request to traviscad.org, gis.traviscountytx.gov or data.texas.gov
(each seed row already carries its TNR geometry and the page query that returned it), and no egress check is
needed. The only network request is the public lexicon manifest, which the adapter reads from
`<run>/lexicon-manifest.json`. `validate` passes against the live manifest: the Seed root is
`address_has_parcel` only (decisions.md section 22), so the missing `Travis` in the county enums
(elephant-xyz/lexicon#194, open) costs only the county label, not validation.

```bash
cd /Users/luti/dev/ateam/role1-prism/kit-travis/skills/use-oracle/runtime
cli=/Users/luti/dev/oracle-property-intelligence-platform-pipeline-travis-tx/node_modules/.bin/elephant-cli
{ head -1 data/seeds/travis-pilot.csv; grep '^830704,' data/seeds/travis-pilot.csv; } > data/seeds/travis-smoke.csv

# $1 = seed, $2 = smoke|pilot; prints the run directory
t2run() {
  run=data/travis/runs/$(date -u +%Y%m%dT%H%M%SZ)-$2; mkdir -p "$run/html"
  curl -sf https://lexicon.elephant.xyz/api/manifest -o "$run/lexicon-manifest.json"
  node bin/elephant-county.mjs ingest --county travis --seed "$1" --html-dir "$run/html" --output "$run" > "$run/ingest-stdout.json"
  node bin/elephant-county.mjs reconcile-export --county travis --seed "$1" --run "$run" --output "$run/reconciliation"
  for z in "$run"/*/transformed.zip; do id=$(basename "$(dirname "$z")"); mkdir -p "$run/validate/county/$id"; unzip -q -o "$z" -d "$run/validate/county/$id"; done
  (cd "$run/validate" && $cli validate ./county --output-csv ./travis-county-errors.csv > validate.log 2>&1; tail -2 validate.log)
  echo "$run"
}
t2run data/seeds/travis-smoke.csv smoke
t2run data/seeds/travis-pilot.csv pilot
```

Expect: smoke 1 = 1 + 0 + 0 and `Properties processed: 1, succeeded: 1, failed: 0`; pilot `reconciled` 25 = 25
success + 0 permanent + 0 retryable, `geometryCount` 13, reconcile-export `rowCount` 25 = `expectedCount` 25;
validate prints `Properties processed: 25, succeeded: 25, failed: 0`, and `travis-county-errors.csv` has no data
rows. Inspect: `<run>/manifest.json` (`reconciled`, `timings`), one parcel's `data/` (the Seed root carries
`address_has_parcel` only; no `property_seed.json` or `unnormalized_address.json` inside `data/`) and its
`source-payload.json` (the lexicon-gap sidecar, never in the archive). The run of record is kit
`docs/evidence/travis-t2-run-20261017T072132Z.json`.

Then, in the pilot's `validate` directory (no Atlas clone, no PR in v1). Expect `CAR written … (471 blocks, root
baguqeerahe3ecgiyigcgdg6gmxqsmc5ylzlucf4kb3n5xcqi5tvtiebpv2ta)`, "CAR passed every check" with the six error counts
at 0, and `Tables written … (23 tables, 23 parts, root baguqeeram5hefoyihxelublnx3hzdmbdxg5gavyukspzevkwnii7b5zexipq)`;
the roots are deterministic, so an unchanged seed and export reproduce them:

```bash
$cli hash ./county --output-zip ./travis-county-hashed --output-csv travis-county-hash.csv --output-car travis-county.car
$cli validate travis-county.car --output-csv travis-county-car-errors.csv
$cli export-tables travis-county.car --output ./travis-county-tables --part-size 128m --output-json travis-county-tables-export.json \
  --atlas-page ./atlas-page/counties/TX/travis.json --county travis --state TX --fips 48453     # local page file only
```

### Upload with readback (run 2026-10-17 on the operator's go)

Option B (decisions.md section 22): the run of record `20261017T072132Z` validated, hashed and exported against the
live manifest, so no amended schemas need pinning. On the operator's go ("go upload", 2026-10-17, after the T2
approval) the oracle agent ran the steps below in order; the outcome is under "Result" below, in the kit run record's
`publication` and in `runs/20261017T072132Z-pilot.json`. The credentials stay in the
git-ignored `.env` (`FILEBASE_ACCESS_TOKEN`, `FILEBASE_SECRET_KEY`, `FILEBASE_BUCKET=travis-tx-oracle-pipeline`,
`PINATA_JWT_SECRET_ACCESS_TOKEN`) and are loaded into the shell that runs the upload only; never echo them or write
them to a file. The CLI reads `FILEBASE_ACCESS_KEY`, `FILEBASE_SECRET_KEY` and `FILEBASE_BUCKET` and composes the
Filebase token itself. In order:

```bash
cd /Users/luti/dev/ateam/role1-prism/kit-travis/skills/use-oracle/runtime
RUNTIME=$PWD; A=/Users/luti/dev/oracle-property-intelligence-platform-pipeline-travis-tx
cli=$A/node_modules/.bin/elephant-cli
publish="node $RUNTIME/src/counties/travis/publish.mjs"
run_id=20261017T072132Z
car_root=baguqeerahe3ecgiyigcgdg6gmxqsmc5ylzlucf4kb3n5xcqi5tvtiebpv2ta
tables_root=baguqeeram5hefoyihxelublnx3hzdmbdxg5gavyukspzevkwnii7b5zexipq
schema=bafkreia6tjziby3upxmidymud5iusd32urrztslgrudkwysc7ydmxoekuq
cd data/travis/runs/$run_id-pilot/validate

# 1. Credentials into this shell only
set -a; . $A/.env; set +a
export FILEBASE_ACCESS_KEY="$FILEBASE_ACCESS_TOKEN"        # the 20-character token is the Filebase S3 access key
[ "$FILEBASE_BUCKET" = travis-tx-oracle-pipeline ] && echo "bucket ok" || echo "STOP: FILEBASE_BUCKET is not travis-tx-oracle-pipeline"

# 2. The artifacts are the ones the run record holds
shasum -a 256 travis-county.car travis-county-tables/tables.car
#    expect 62456f387fd6b25466c63ba6f8b4bbf2020c2b1fa963f71a82b3541bf8a1ebc6  travis-county.car
#           d2aaf5fc2bbfdcf2f115c89b93bd2fc976a924b50a16e2dbff2b5ec4a3e960c9  travis-county-tables/tables.car

# 3. Upload the archive, then the tables (every part added and pinned, then tables.car), to Filebase over Kubo RPC;
#    the CLI reads each root back through https://ipfs.filebase.io
$cli upload travis-county.car --api https://rpc.filebase.io --output-json travis-county-upload.json
$cli upload ./travis-county-tables --api https://rpc.filebase.io --output-json travis-county-tables-upload.json

# 4. CID readback: the uploaded roots are the recorded ones, and the tables point back at the archive
python3 -c "import json,sys; c=json.load(open('travis-county-upload.json')); t=json.load(open('travis-county-tables-upload.json')); ok=c['root']=='$car_root' and t['root']=='$tables_root' and t.get('countyRoot')=='$car_root'; print('roots match' if ok else 'STOP: root mismatch'); sys.exit(0 if ok else 1)"

# 4b. Filebase holds every CID (the 23 parts are all added under the name part-00000.parquet): read-only pin/ls,
#    plus a never-uploaded control that must come back unpinned
parts=$(python3 -c "import json; print(','.join(p['cid'] for p in json.load(open('$RUNTIME/docs/evidence/travis-t2-run-$run_id.json'))['tables']['parts']))")
$publish filebase-pins --cids $car_root,$tables_root,$parts --output filebase-pins.json

# 5. Second pin: Pinata pin-by-CID of both roots, requested together, each waited on for at most 30 minutes; a refusal
#    or a pin still pending at the bound is written to pins.json with its exact status (exit code 1), never dropped
$publish pin --cids $car_root,$tables_root --name-prefix travis-county-$run_id --wait-minutes 30 --output pins.json

# 6. ipfs.io and dweb.link, every object in parallel: the raw block of both roots, every part and the schema against the
#    CID's multihash, and every part's full bytes (/ipfs/<cid>) against the run record's size and sha256; 404, 429, 5xx
#    and timeouts retried for up to 20 minutes per object (never sooner than Retry-After); then a short re-run
$publish gateway-check --cids $car_root,$tables_root,$parts,$schema --gateways https://ipfs.io,https://dweb.link \
  --run-record $RUNTIME/docs/evidence/travis-t2-run-$run_id.json --deadline-minutes 20 --concurrency 49 --output gateway-checks.json
$publish gateway-check --cids $car_root,$tables_root,$parts,$schema --gateways https://ipfs.io,https://dweb.link \
  --run-record $RUNTIME/docs/evidence/travis-t2-run-$run_id.json --deadline-minutes 3 --concurrency 49 --output gateway-checks-rerun.json
#    final rows: per object the re-run's row when it is definitive (match or mismatch), else the first pass's
python3 -c "import json; a=json.load(open('gateway-checks.json')); b={(r['cid'],r['gateway'],r['check']): r for r in json.load(open('gateway-checks-rerun.json'))}; res=lambda r: r['bytes'] if r['check']=='file' else r['multihash']; json.dump([b[k] if res(b[k]) in ('match','mismatch') else r for r in a for k in [(r['cid'],r['gateway'],r['check'])]], open('gateway-checks-final.json','w'), indent=2)"

# 7. publish/<run_id>/manifest.json in this repository (never lists itself; a directory entry carries its root block's
#    size and sha256, read from the local CAR; the schema's from its CID-verified bytes), then pin it (cidVersion 1;
#    the CID must equal its local raw CID). --accept-unpinned true only carries a refusal recorded in step 5.
$publish manifest --run-record $RUNTIME/docs/evidence/travis-t2-run-$run_id.json \
  --car-upload travis-county-upload.json --tables-upload travis-county-tables-upload.json \
  --gateway-checks gateway-checks-final.json --pins pins.json --hash-csv travis-county-hash.csv \
  --archive-car travis-county.car --tables-car travis-county-tables/tables.car \
  --schema-file ~/.elephant-cli/schema-cache/$schema.json --accept-unpinned true \
  --output $A/publish/$run_id/manifest.json
$publish pin-file --file $A/publish/$run_id/manifest.json --name travis-publish-manifest-$run_id --output manifest-pin.json
```

**Result, 2026-10-17** (the v1 pilot publication: "pilot scope, uploaded with readback, no Atlas PR"):

- Uploads with readback: archive root `baguqeerahe3ecgiyigcgdg6gmxqsmc5ylzlucf4kb3n5xcqi5tvtiebpv2ta`, 471 blocks, uploaded
  09:08:06Z; tables root `baguqeeram5hefoyihxelublnx3hzdmbdxg5gavyukspzevkwnii7b5zexipq`, 23 parts, `countyRoot` the
  archive root, uploaded 09:08:31Z; both read back through `https://ipfs.filebase.io/ipfs/<root>`; step 4 printed
  `roots match`. `filebase-pins`: all 25 CIDs pinned (recursive), the control unpinned. cid.contact lists Filebase's
  provider records (bitswap and `trustless.filebase.io`) for all 25.
- Second pin: **refused.** Pinata answers pin-by-CID with `HTTP 403 {"reason":"PAID_FEATURE_ONLY","details":"You must be
  on a paid plan to pin by CID"}` for both roots, while `pinList` answers 200 (the plan, not the key's scope). Filebase
  is the only provider pinning the roots. Whether to buy a Pinata plan (decisions.md section 7.2 budgets a paid month) or
  use 7.2's Storacha fallback is the operator's decision; the agent switched no vendor and created no account.
- ipfs.io and dweb.link: **unverified on all 98 rows in both passes, nothing mismatched.** Both gateways stopped serving
  backend and automated HTTP clients (IPFS Foundation, "IPFS is moving beyond the sponsored gateways", 2026-08-25;
  `https://gatewaychanges.ipfs.io/`: retired for good on 2026-09-21): full-byte requests get `429` with
  `retry-after: 900` and "This IPFS gateway is switching to a service worker gateway only", and `?format=raw` is
  redirected to `trustless-gateway.link`, whose origin fails with Cloudflare 521, 522 and 525. README.md:69's two example
  gateways can no longer demonstrate retrieval; which two public gateways replace them is the operator's decision.
  Informational only (not in the manifest): the same checks on `https://gateway.pinata.cloud` (Pinata's gateway, which
  holds none of these blocks) matched every row, and `https://4everland.io` matched the rows it answered; see the run
  record's `publication.informational`.
- Manifest: `publish/20261017T072132Z/manifest.json`, 26 objects (both roots, 23 table parts, the County schema), 88,713
  bytes, CID `bafkreiaasx5bscxhvcpfyza2hzlwyfrmqrss6roa4btefom2usxopm2a44` (equal to its local raw CID), pinned with
  Pinata pinFileToIPFS. Run history: `runs/20261017T072132Z-pilot.json`. No Atlas PR in v1.

README demo step ("retrieve one published artifact by CID from a public gateway ... then again from a second independent
public gateway"): fetch one table part from two gateways and compare it with the manifest. With ipfs.io and dweb.link
retired this prints `FAILED` for both; put the two gateways the operator chooses in the `for` list:

```bash
m=/Users/luti/dev/oracle-property-intelligence-platform-pipeline-travis-tx/publish/20261017T072132Z/manifest.json; read -r cid size sha < <(python3 -c "import json,sys; o=next(o for o in json.load(open(sys.argv[1]))['objects'] if o['name']==sys.argv[2]); print(o['cid'], o['size'], o['sha256'])" "$m" tables/property/part-00000.parquet); for gw in https://ipfs.io https://dweb.link; do f=$(mktemp); if curl -sSfL --retry 3 --retry-delay 5 --max-time 120 "$gw/ipfs/$cid" -o "$f"; then s=$(wc -c < "$f" | tr -d ' '); h=$(shasum -a 256 "$f" | cut -d' ' -f1); if [ "$s" = "$size" ] && [ "$h" = "$sha" ]; then echo "MATCH    $gw/ipfs/$cid size=$s sha256=$h"; else echo "MISMATCH $gw/ipfs/$cid size=$s sha256=$h (manifest $size $sha)"; fi; else echo "FAILED   $gw/ipfs/$cid"; fi; rm -f "$f"; done
```

## 4. Requests the operator submits (drafted, not submitted)

- Lexicon: `kit docs/travis-lexicon-county-enum-request.md` (add `Travis` to the two county enums).
- BBB: `kit docs/travis-bbb-access-request.md` (API access through developer.bbb.org).
- Records requests for the 22 non-Austin jurisdictions: `kit docs/travis-sources.yaml`
  (`records_request` per row; the reusable body is in the kit's `request-routing.md`).

## 5. T3 — official identity baseline

Both US-egress windows are done: run `20261017T160716Z` (franchise statewide, sales-tax outlets, veteran-owned, TDLR,
detail-URL probe) and run `20261017T192341Z` (the TSBPE list and the two Comptroller record layouts). A later re-run,
VPN on, is resumable: `node src/counties/travis/t3-vpn-fetch.mjs [--only <source,source>]` in the kit runtime. Rulings:
decisions.md sections 23–24; run record: kit `docs/evidence/travis-t3-run-2026-10-17.json`.

**Record-id key.** `data/travis/keys/record-id.key` in the kit runtime (fingerprint `a85dc5bf94154a97`) keys the ids of
the sole-owner outlets (decisions.md 24.2). Keep one copy in your password manager; without it the loader stops.

### Hand-off checklist (offline, about 12 minutes)

Run in `/Users/luti/dev/ateam/role1-prism/kit-travis/skills/use-oracle/runtime`; nothing is sent. Not in this repo's
mirror `oracle/travis/kit/…/runtime`: it holds the code only, with no `node_modules` and no `data/`.

1. `for r in 20261017T160716Z 20261017T192341Z; do node src/counties/travis/t3-verify.mjs --run $r | tail -1; done` →
   `t3-verify: OK; 112 files, 112 receipts, 4,460,985 CSV rows, 888.0 MB; run <r>`, once per run. Without `| tail -1`,
   the TSBPE line reads `failed: … not CSV: responsible-master-plumber-responsible-master-plumber.csv`: the first run's
   saved HTML page, kept as evidence; its CSV came in the second run.
2. `node src/counties/travis/t3-record-id-key.mjs fingerprint` → `"fingerprint":"a85dc5bf94154a97"`.
3. `shasum -a 256 data/travis/registry/watermark.json data/travis/licensing/watermark.json` → `beb3d529…` and
   `ff62b029…`.
4. `node --max-old-space-size=16384 src/counties/travis/t3-load.mjs` (about 9 minutes) → each snapshot step ends
   `removed 0; no-op` with `diff new 0, changed 0`: `[franchise-statewide] 3,487,662 rows, 3,487,631 keys`
   (`2a102105f56e`), `[franchise-travis] 342,334 rows, 342,333 keys` (`942e8645eec3`), `[sales-tax] 49,025 rows, 49,025
   keys` (`8cc5583a80d5`), `[veteran] 27,205 rows, 27,205 keys` (`988727bb91ca`), `[tdlr] 887,715 rows, 459,993 keys`
   (`2e3ab26003d6`), `[tsbpe] 9,378 rows, 9,378 keys` (`11cf66bb169e`); then `[veteran-join] unchanged (25466 of 27205
   veteran rows joined (Travis 2343); …)`, `[layouts] consistent (2 layouts read; the privacy rule holds)`,
   `[name-index] unchanged (6 indexes; …)`, `[record-ids] no collapsed records (…)`, and last
   `t3-load: 10 steps; all no-op (0 new, 0 changed, 0 removed; identical bytes); …`.
5. Step 3 again → the same two digests.
6. `node src/counties/travis/t3-privacy-check.mjs` → exit 0; `"privacy_version":"travis-t3-privacy.v2"`,
   `"classed_rows_in_capture":9471`, `"withheld_values_in_capture":9088`, `"snapshot_rows":49025`,
   `"snapshot_rows_classed":9471`, `"keyed_record_ids_in_snapshot":9471`, `"keyed_record_ids_distinct":9471`,
   `"track_files_checked":5`, every other count 0, `"ok":true`.
7. `cd /Users/luti/dev/ateam/role1-prism/kit-travis && python3 skills/use-oracle/scripts/validate-county-readiness.py skills/use-oracle/runtime/docs/travis-sources.yaml`
   → exit 0, `"overall": "PASS"`, `"seed_allowed": true`.
8. In the runtime directory, `npx vitest run tests/travis-*` → `Test Files 18 passed (18)`, `Tests 159 passed (159)`.

## 6. T4 — permit profile, permit pilot and feasibility

The harvest of record is the Austin export captured on 2026-10-17 (`v1792239863`, 270 partition requests, kit
`docs/evidence/travis-t4-harvest-v1792239863.json`). Everything below reads that capture, the T1 seed and the TCAD special
export captured for point 25.10 (`data/travis/t4-rulings/lineage/`, checked against its receipt, never re-fetched). No VPN is
needed: the only requests go to the public lexicon manifest and to data.austintexas.gov (steps 4 and 7), which answer from RO.
Run record: kit `docs/evidence/travis-t4-run-2026-10-17.json` (rebuilt after the rulings of 2026-10-18). Rulings: decisions.md
section 25 (all five ruled; 6, 7, 8 and 10 applied, 9 is T5's design); the before/after counts of 25.10 are in kit
`docs/evidence/travis-t4-ruling-10-tcad-listing-2026-10-18.json`.
`t4-permit-fetch.mjs` captures a newer version under its own `v<rowsUpdatedAt>`; it is not part of this checklist.

### Hand-off checklist (about 30 minutes)

Run in `/Users/luti/dev/ateam/role1-prism/kit-travis/skills/use-oracle/runtime`, not in the mirror. Each run writes a new
directory under `data/travis/runs/`. The roots below hold while the live lexicon manifest's SHA-256 is `7084b933…` (each run
records it in its `t4-run.json`); `total_s` and `elapsed_s` vary.

```bash
cli=/Users/luti/dev/oracle-property-intelligence-platform-pipeline-travis-tx/node_modules/.bin/elephant-cli
t4run() { node --max-old-space-size=12288 src/counties/travis/t4-run.mjs "$@"; }   # a function, so zsh runs it as bash does
export ELEPHANT_SKIP_UPDATE_CHECK=1   # elephant-cli exits with "update required" if npm has a newer version than 1.58.1
```

1. `node src/counties/travis/t4-permit-verify.mjs` → `t4-permit-verify: OK; 270 partitions, 274 receipts, 2,380,707 CSV
   rows, 1813.8 MB; v1792239863 (rowsUpdatedAt 2026-10-17T12:24:23.000Z)`.
2. TCAD's permit listing, offline from the receipted capture (about 3.5 minutes):
   `node --max-old-space-size=8192 src/counties/travis/t4-tcad-permit-listing.mjs` →
   `"accounts":493246,"accounts_listing_permits":341900,"permit_numbers":781459,"listed_pairs":1121918,"listing_sha256":"7b2bf8e62af758aad4bd1ca53557a4d1fd1f3fc87731a6ecad4ee05f8a96a999"`.
   It stops if the zip's bytes or SHA-256 differ from its receipt; steps 3 to 7 stop if the listing is missing.
3. `node --max-old-space-size=12288 src/counties/travis/t4-permit-links.mjs` (about 1.5 minutes) →
   `"rows":2380707,"linked":1986523,"link_method":{"exact":1978992,"normalized_digits":0,"tcad_permit_listing":7531},"unlinked_reasons":{"no_candidate":251888,"multiple_candidates":38249,"invalid_quarantined":178,"out_of_county":103869},"linked_parcels":237533,"digits_fallback_enabled":true,"tcad_permit_listing":{"retired":196400,"linked":7531,"overlap_agreement":0.973},"new_unmapped_statuses":[]`.
4. Pilot, `__ALL__` (2 minutes; 27 Socrata requests):
   `PROPERTY_FIRST_PERMIT_ELIGIBLE_USAGE_TYPES_TRAVIS=__ALL__ t4run --seed data/seeds/travis-pilot.csv --label pilot --cli $cli --cross-check-socrata`
   → `"appraisal":{"seedRows":25,"success":25,"permanentFailure":0,"retryableFailure":0}`,
   `"permit_states":{"done_zero_permits":19,"done":6},"permits_linked":155,"permits_published":155,"by_link_method":{"exact":145,"tcad_permit_listing":10},"property_cid_check":true,"socrata_cross_check":"25/25 equal through 2026-10-16"`,
   then `county validate 25/25 (0 error rows), CAR 471 blocks root baguqeerahe3ecgiyigcgdg6gmxqsmc5ylzlucf4kb3n5xcqi5tvtiebpv2ta, checks pass, 23 tables root baguqeeram5hefoyihxelublnx3hzdmbdxg5gavyukspzevkwnii7b5zexipq`
   (T2's roots) and `property_improvement validate 6/6 (0 error rows), CAR 348 blocks root baguqeeranegqm7efvvxckwfltf6ewzxsuwmmf7kuk2obi6r5svbgw7cqk22q, checks pass, 7 tables root baguqeeraxyla6jami62bqvc46xitp4tkyu2boive5b4esf2n5vuwfk2gmafa`.
   Inspect two parcels, with `p=$(ls -d data/travis/runs/*-t4-pilot | tail -1)`:
   - `ls $p/830704/permit-data` lists 5 `property_improvement_*.json`, their relationships, the Property Improvement root
     `bafkreicyzy…json`, the Seed root and the copied property, address and parcel files; `permit-source-payload.json` beside
     it holds the printed rows, the profile and the capture locator. The five records of permit `2013-084591` carry
     `improvement_type` GeneralBuilding, RightOfWayPermit, Electrical, MechanicalHVAC and Plumbing (BP, DS, EP, MP, PP),
     `improvement_status` Completed, `improvement_action` New on the BP only, and `contractor_type` GeneralContractor (BP, DS)
     or Specialist (the trades) (`travis-improvement-enums-v1`).
   - `748284` is the parcel the listing adds: its 10 permits print the retired id `0108032001`. In
     `$p/748284/permit-source-payload.json` every `link.property_link` reads `tcad_permit_listing` / `official_listing`,
     and `link.listing_entries` holds TCAD's own entry for the permit.
5. Appraisal only, `__NONE__`: `PROPERTY_FIRST_PERMIT_ELIGIBLE_USAGE_TYPES_TRAVIS=__NONE__ t4run --seed data/seeds/travis-pilot.csv --label pilot-none --cli $cli`
   → `"permit_states":{"not_eligible":25}`, the same County line as step 4, and `property_improvement no parcel in this group`.
6. Failure paths: `PROPERTY_FIRST_PERMIT_ELIGIBLE_USAGE_TYPES_TRAVIS=__ALL__ t4run --seed data/seeds/travis-pilot.csv --label pilot-drill --cli $cli --fault-drill permanent:547839,retryable:830704`
   → `"permit_states":{"done_zero_permits":19,"failed_permanent":1,"done":4,"failed_retryable":1}` and
   `property_improvement validate 4/4`; then
   `PROPERTY_FIRST_PERMIT_ELIGIBLE_USAGE_TYPES_TRAVIS=__ALL__ t4run --resume "$(ls -d data/travis/runs/*-t4-pilot-drill | tail -1)" --cli $cli`
   → `"attempt":2`, `"permit_states":{"done_zero_permits":19,"failed_permanent":1,"done":5}`, `property_improvement validate 5/5`.
7. Feasibility, 1,000 parcels (about 13 minutes; 1,001 Socrata requests). The sample is reproducible:
   `node src/counties/travis/t4-sample.mjs` → `"rows":1000,"sha256":"5fccc9c2deaca758c1f585a90621a56105f093ca445d72c1304748161ed9990c"`. Then
   `PROPERTY_FIRST_PERMIT_ELIGIBLE_USAGE_TYPES_TRAVIS=__ALL__ t4run --seed data/seeds/travis-feasibility-1000.csv --label feasibility-1000 --cli $cli --cross-check-socrata`
   → `"appraisal":{"seedRows":1000,"success":1000,…}`, `"permit_states":{"done":542,"done_zero_permits":458},"permits_linked":4173,"permits_published":4173,"by_link_method":{"exact":4151,"tcad_permit_listing":22},"property_cid_check":true,"socrata_cross_check":"998/998 equal through 2026-10-16"`,
   `county validate 1000/1000 (0 error rows), CAR 20138 blocks root baguqeerajznciv64kds7dilxfyy5mg33klp4ap2wxfe2frrag7cwhb6gau4a, checks pass, 24 tables root baguqeerag4dmbm2gzcqhvlzetfng4je6v6oklp2ny45azubq4ewv45sizrba`
   and `property_improvement validate 542/542 (0 error rows), CAR 11600 blocks root baguqeerahbiu3sp5wrgqnnugp4dcgsrn3iifuljet5ruumkt4izy3vrg6qyq, checks pass, 7 tables root baguqeerab4phy3thmss6fweimqiprjf72aruewhnvmfi33wokx3vutq6ybrq`.
8. Projection (about 2 minutes):
   `f=$(ls -d data/travis/runs/*-t4-feasibility-1000 | tail -1); for g in county property_improvement; do node src/counties/travis/t4-shard-bench.mjs --group-dir $f/validate/$g --shards 8 --cli $cli --out $f/shard-bench-$g-8.json; done; node src/counties/travis/t4-projection.mjs --feasibility $f --bench-county $f/shard-bench-county-8.json --bench-property_improvement $f/shard-bench-property_improvement-8.json`
   → two `"all_passed":true` bench lines, then `"within_gate":false` for the sequential run (about 62 hours, `cli_county_validate`
   about 46 of them), `"sharded":{… "within_gate":true …}` and `"source_acquisition_h":0.089`. Hours depend on the machine's free
   memory (decisions.md 25.9): the run record projects 62.45 sequential and 19.01 on 8 shards (the 25.9 benchmarks with the
   current link counts; the 8/10/12-shard passes are in kit `docs/evidence/travis-t4-point-9-measurements-2026-10-18.json`).
9. `cd /Users/luti/dev/ateam/role1-prism/kit-travis && python3 skills/use-oracle/scripts/validate-county-readiness.py skills/use-oracle/runtime/docs/travis-sources.yaml`
   → exit 0, `"overall": "PASS"`, `"seed_allowed": true`.
10. In the runtime directory, `npx vitest run tests/travis-*` → `Test Files 28 passed (28)`, `Tests 201 passed (201)`.

## 7. T5 — full run, reconciliation and signals

**State: finished, waiting for the operator's "T5 approved".** Run `20261018T143520Z-t5-full` (kit `962f851`, two attempts,
2026-10-18 14:35Z to 2026-10-19 09:02Z):

- **Accounts:** 441,961 = 441,939 ready + 22 dead + 0 invalid; reconciles. The 22 dead are roll rows with no situs street,
  a source fact.
- **Shards and CARs:** 89 shards, 354 CARs, not 356: shard s0089 has no Property Improvement group, because none of its
  accounts holds a linked permit.
- **Permits published:** 1,986,484. **Roof age:** 390,212 eligible.
- **Uploaded:** nothing; that is T6.

Run record: `runs/20261018T143520Z-t5-full.json` (the kit's `run.json`, byte for byte). Design: decisions.md 25.9; dry run:
section 26; rulings on attempt 1's deviations: section 27 (attempt 2, the scoped rerun of 7 shards: 27.12–27.18).

**Next:** the three post-run checks below, then say "T5 approved". Before T6, at least 50 GiB free (decisions.md 27.18).

### Post-run checklist (about 6 minutes, offline, in the kit runtime; nothing reruns)

No VPN. First, once per terminal. It only sets up the shell, so it prints nothing: `pgrep` printing nothing (exit code 1)
means no runner is left writing while step 1 re-hashes. The steps only read the run and can run in parallel; in a second
terminal opened while step 1 runs, `pgrep` lists step 1's own `--verify` process, which is expected.

```bash
cd /Users/luti/dev/ateam/role1-prism/kit-travis/skills/use-oracle/runtime
t5() { node --max-old-space-size=12288 src/counties/travis/t5-run.mjs --cli /Users/luti/dev/oracle-property-intelligence-platform-pipeline-travis-tx/node_modules/.bin/elephant-cli --eligibility __ALL__ --label full "$@"; }
R=data/travis/runs/20261018T143520Z-t5-full
pgrep -lf t5-run.mjs
```

1. **Every output re-hashed** (about 4 minutes). Pass: `"status":"verified"`, `"mismatches":0`, `"loader":true`,
   `"run_json":"equal"`.
   ```bash
   t5 --verify | tail -1 | jq -c '{status, outputs_rehashed, capture, loader: .loader.state_sha256_matches, run_json}'
   ```
2. **Reconciliation** (about 75 seconds): the counts, the 22 dead and their tombstones, every CAR's validation, the
   county-line and shifted-situs rulings and the 20 limitations. Pass: `"all_checks_pass":true,"failed_checks":[]`. Add
   `--out <file>` for the whole report.
   ```bash
   node --max-old-space-size=12288 src/counties/travis/t5-reconcile.mjs --run $R | jq -c '{all_checks_pass, failed_checks, dead, dead_shards: (.dead_shards | length), rulings, s0089: .shards_without_property_improvement.s0089, sizes: .sizes_gb.total, anchors: .roof_age_anchors, limitations_missing}'
   ```
3. **The run record:** the scoped rerun left the earlier parcels byte for byte the same (decisions.md 27.14–27.15), and
   the repository's copy is the run's. Pass: `"identical":true`, then `165`, then the same hash twice.
   ```bash
   jq -c '.scoped_reruns[0] | {shards, kit_commit_at_run, recertified, proofs: [.code_changes[] | "\(.proof):\(.holds)"], earlier_parcels_unchanged: ([.comparisons[].appraisal.unchanged] | add), identical: ([.comparisons[] | .appraisal.identical and .permits.identical] | all), newly_ready: ([.comparisons[].appraisal.newly_ready | length] | add)}' $R/run.json
   grep -l '"recertified"' $R/shards/*/*.done.json $R/global/*.done.json | wc -l
   shasum -a 256 $R/run.json /Users/luti/dev/oracle-property-intelligence-platform-pipeline-travis-tx/runs/20261018T143520Z-t5-full.json
   ```

Then say "T5 approved".

<details>
<summary>Full expected output</summary>

1. `{"status":"verified","outputs_rehashed":{"files":683910,"bytes":28609472173},"capture":{"ok":true,"mismatches":0},"loader":true,"run_json":"equal"}`
2. `{"all_checks_pass":true,"failed_checks":[],"dead":{"no_situs_street:nothing_printed":21,"no_situs_street:number_only":1},"dead_shards":17,"rulings":{"county_line":{"accounts":12,"ready":12},"situs_columns_shifted":{"seed_rows_matching":3,"ready":3,"sidecar_flagged":3}},"s0089":{"accounts":1961,"linked":0,"permits_printing_a_geo_id":618,"their_link_state":{"multiple_candidates":618},"every_printed_geo_id_is_shared":true},"sizes":{"car":8.606,"blocks":8.017,"parts":1.427,"distinct":9.445,"filebase_counted":18.889},"anchors":{"t4_rule":108733,"estimator":108800,"only_estimator":69,"only_t4_rule_dead":2},"limitations_missing":0}`
3. `{"shards":["s0039","s0040","s0066","s0067","s0068","s0081","s0084"],"kit_commit_at_run":"962f851","recertified":{"shards":82,"stages":{"link":1,"appraisal":82,"permits":82}},"proofs":["link_stage_unchanged:true","situs_columns_branch:true","validation_box_widened:true"],"earlier_parcels_unchanged":34984,"identical":true,"newly_ready":15}`,
   then `165`, then `15a43cb8f6ac0b4f46306106f6d59d8a903a02898474dc2060f2a2943bd3fc2b` for both files.

</details>

### Running a full run (T10, or again)

One command runs the whole roll through every stage, offline except for the public lexicon manifest:

- the readiness validator (the run stops unless `PASS`);
- the manifest: its SHA-256 is recorded and checked again on every resume and at the end, and a change stops the run;
- the shard plan: 89 shards of at most 5,000 sorted PROP_IDs;
- one link pass over the 2,380,707 captured permits;
- then up to 8 shards in flight. Each goes through the appraisal transform (v4), the permit transform, roof age and the
  internal query table, the County and the Property Improvement `elephant-cli` chains (validate, hash, CAR validate,
  export-tables) and the Loader's merge.

Every stage writes an atomic `<stage>.done.json` with its input and output digests, so an interruption redoes only the
shards in flight. The runner holds `caffeinate -dimsu -w <its pid>`, sets `ELEPHANT_SKIP_UPDATE_CHECK=1` and writes
`run.json` at the end. Nothing is uploaded, pinned or registered. Measured: attempt 1 took 12.2 hours (the dry run
projected 14.5 with swap at 5.5 of 7 GB), about 126 GB on disk, a peak of about 9 GB for the 8 `elephant-cli` processes and
the runner together (kit `docs/evidence/travis-t5-dry-run-2026-10-18.json`).

**Before you start (about 5 minutes)**

1. `colima stop` (or quit Docker Desktop), then quit heavy apps (browsers with many tabs, other IDEs). Keep the Mac on AC
   power with the lid open: `caffeinate` prevents sleep on AC only; on battery a lid close still sleeps, which counts as an
   interruption.
2. `sysctl vm.swapusage` → `used` well under half of `total`; a nearly full swap doubled the County time in T4
   (decisions.md 25.9). macOS keeps swapped pages until their process exits, so if `used` stays high after quitting apps,
   restart the Mac.
3. `df -h /Users/luti` → at least 180 GB available (decisions.md 27.18).

The run repeats checks 2 and 3 at its start as warnings (`[t5] preflight warning: …`) and starts anyway.

**Start**

```bash
cd /Users/luti/dev/ateam/role1-prism/kit-travis/skills/use-oracle/runtime && node --max-old-space-size=12288 src/counties/travis/t5-run.mjs --cli /Users/luti/dev/oracle-property-intelligence-platform-pipeline-travis-tx/node_modules/.bin/elephant-cli --eligibility __ALL__ --label full --new
```

`--new` starts a new run directory. Without it the command never starts over: it resumes an unfinished `full` run, or, on a
finished one, verifies it read-only in about 6 seconds, prints `"status":"verified"` and exits 0 (kit `6107969`).

It prints `[t5] starting data/travis/runs/<timestamp>-t5-full (attempt 1, pid <n>); no-sleep caffeinate -dimsu -w <n>;
ELEPHANT_SKIP_UPDATE_CHECK=1; loader scope full`, then about 3 minutes of global stages (the runner alone uses up to about
6 GB during the link pass), then the shard pool. Leave the terminal open.

**Watch**

- The terminal prints one line a minute and one per finished shard, for example
  `[t5 2026-10-19T02:10:04Z] shards | shards 23/89 done, 8 in flight (s0024 county.validate, …) | parcels 115000/441961 | elapsed 3h48m | ETA 10h41m (about 12:51 local) | elephant-cli 8 procs 7.4 GB, runner 0.4 GB, swap 1.2 GB`.
- From another terminal: `cat "$(ls -d data/travis/runs/*-t5-full | tail -1)/progress.txt"` (the same line), or
  `tail -f "$(ls -d data/travis/runs/*-t5-full | tail -1)/progress.jsonl"`.
- A shard that fails is logged as `[t5] s00NN failed: …` and in the run directory's `failures.jsonl`; the other shards go
  on.

**Interrupted or failed** (Ctrl-C, a crash, `kill`, a sleep, a reboot, or an end with `[t5] N shard(s) failed (…)`)

Fix the cause named in `failures.jsonl`, if any (for example disk space), then run the start command again **without**
`--new`. It prints `[t5] resuming data/travis/runs/<timestamp>-t5-full (attempt 2, …)`, stops any `elephant-cli` process a
killed runner left behind, checks the lexicon manifest against the one recorded at the start, skips every stage whose
done-marker still matches and reruns only what was in flight. The ETA counts only the shards that still run.

**Changing a finished run** (start command without `--new`, plus one of)

- `--reopen` reruns it in place; only the stages whose inputs changed run.
- `--rerun-shards s0039,s0040,…` (kit `1cf6ed1`, decisions.md 27.14) reruns only the named shards. Every other shard is
  re-certified in place, or the run stops and names the shard it cannot re-certify. Commit the kit first. A scoped rerun
  that stops resumes with the same command.

**Exit watchdog.** The runner exits by itself after `done`, a failure or a signal, but Node's own teardown has stalled
after both attempts of the full run. The log then ends with `[t5] exit watchdog: pid <n> is still alive 30 s after it
exited with code 0 (…); sending SIGTERM` and, if needed, `… sending SIGKILL`. Harmless: everything was written before
those lines.

<details>
<summary>What "done" printed for run 20261018T143520Z-t5-full</summary>

Attempt 1 (the full run, 2026-10-19 03:14:36Z):

```
{"travis_t5_run":"20261018T143520Z-t5-full","status":"finished","seed":441961,"ready":441924,"dead":37,"invalid":0,"reconciles":true,"shards":89,"cars":354,"permits_published":1986484,"roof_age_eligible":390210,"wall_h":12.23,"run_record":"data/travis/runs/20261018T143520Z-t5-full/run.json"}
```

Attempt 2 (the scoped rerun of decisions.md 27.9 and 27.10, 2026-10-19 09:02:39Z, about 1 h 55 min). Its `wall_h` spans
both attempts and the gap between them; `last_attempt_h` is the rerun:

```
{"travis_t5_run":"20261018T143520Z-t5-full","status":"finished","seed":441961,"ready":441939,"dead":22,"invalid":0,"reconciles":true,"shards":89,"cars":354,"permits_published":1986484,"roof_age_eligible":390212,"wall_h":17.89,"last_attempt_h":1.33,"scoped_rerun":{"shards":["s0039","s0040","s0066","s0067","s0068","s0081","s0084"],"recertified":{"shards":82,"stages":{"link":1,"appraisal":82,"permits":82}}},"run_record":"data/travis/runs/20261018T143520Z-t5-full/run.json"}
[t5] done: data/travis/runs/20261018T143520Z-t5-full/run.json
```

decisions.md section 27 explains attempt 1's deviations and rules on them; points 12–18 record attempt 2.

</details>

## 8. T6 — publication, run 1

Observed 2026-10-19 (decisions.md 28.6-28.7; the operator's goes D, a, i, γ and 3): the 177 shard archives as they are,
no Atlas PR. Every root is uploaded with readback, Filebase pins every CID, every manifest CID is checked on
`ipfs.filebase.io`, and the manifest is pinned on Filebase and Pinata. Two things finish on their own: the
`gateway.pinata.cloud` byte checks (detached, about 12 h) and the pending Pinata pins. Nothing below reruns or writes.

```bash
cd /Users/luti/dev/ateam/role1-prism/kit-travis/skills/use-oracle/runtime
```

1. **The publication record.** Pass: the line below.
   ```bash
   jq -c '{manifest: (.manifest | {cid, sha256, objects, cars, filebase_add_cid_equal, pinata}), uploads: (.upload.read_back | length), filebase_gateway: (.gateway_checks.filebase | {match, mismatch, unverified}), pinata_before_pins: .gateway_checks.pinata_before_pins.match, pins_at_bound: (.pins.at_bound | {pinned, refused})}' docs/evidence/travis-t6-publication-20261018T143520Z.json
   ```
2. **The manifest fetched by its CID equals the repository's copy** (public HTTP). Pass: the same hash twice, `4a0f3231…`.
   ```bash
   curl -s --max-time 60 https://ipfs.filebase.io/ipfs/bafybeid6jqqzpo2ods6iehz5vgud2ust4fykfiozspzxb3xjmqiup36ud4 | shasum -a 256
   shasum -a 256 /Users/luti/dev/oracle-property-intelligence-platform-pipeline-travis-tx/publish/20261018T143520Z-t5-full/manifest.json
   ```
3. **Pinata pins now** (read-only; loads the JWT into this shell). Pass: `"pinned"` 274 or more of 355, rising to 355;
   `pending` holds only Pinata job states (`retrieving`, `prechecking`, `searching`), and `not_listed` is 0.
   ```bash
   set -a; . /Users/luti/dev/oracle-property-intelligence-platform-pipeline-travis-tx/.env; set +a
   node src/counties/travis/t6-publish.mjs pin-status --out data/travis/publish/20261018T143520Z-t5-full --extra-cids bafybeid6jqqzpo2ods6iehz5vgud2ust4fykfiozspzxb3xjmqiup36ud4
   ```
4. **The background Pinata-gateway check.** Pass: `"mismatch":0` and `"running":true` (or, once done, `"finished":true`
   with `"remaining":0` and `"unverified":0`).
   ```bash
   node src/counties/travis/t6-publish.mjs gateway-status --out data/travis/publish/20261018T143520Z-t5-full --jsonl gateway-checks-pinata.jsonl --gateway https://gateway.pinata.cloud --extra-jobs 1
   ```
5. **Demo:** open `https://ipfs.io/ipfs/bafybeid6jqqzpo2ods6iehz5vgud2ust4fykfiozspzxb3xjmqiup36ud4` in a normal browser.
   Pass: the manifest JSON, whose `label` starts with "run 1: the shard archives". (ipfs.io serves browsers through its
   service-worker gateway; the agent could not test that from a shell.)

Then say "T6 approved".

<details>
<summary>Full expected output</summary>

1. `{"manifest":{"cid":"bafybeid6jqqzpo2ods6iehz5vgud2ust4fykfiozspzxb3xjmqiup36ud4","sha256":"4a0f3231ed7131e925f484aeb6d1448f2586ac5c9dc520b974cff678f8c009fb","objects":3285,"cars":354,"filebase_add_cid_equal":true,"pinata":"pinned"},"uploads":354,"filebase_gateway":{"match":3285,"mismatch":0,"unverified":0},"pinata_before_pins":250,"pins_at_bound":{"pinned":214,"refused":0}}`
2. `4a0f3231ed7131e925f484aeb6d1448f2586ac5c9dc520b974cff678f8c009fb  -` then the same hash with the file path.
3. For example, at 23:01Z: `{"checked_at":"2026-10-19T23:01:29.472Z","roots":355,"pinned":274,"pending":{"retrieving":81},"not_listed":0}`
4. For example, at 23:05Z: `{"gateway":"https://gateway.pinata.cloud","running":true,"finished":false,"jobs":3286,"match":277,"mismatch":0,"unverified":14,"remaining":3009,"last_row_at":"2026-10-19T23:02:14.959Z"}`

</details>

## 9. T7 and T8 — hosted query layer and explorer (built together, checked once)

Built offline on 2026-10-20 (decisions.md section 29). The DuckDB file is already built: `data/deploy/current` →
deploy `e17c90aa0b91ccae`, 4.04 GB, from commit `e462172`, reconciled with T5 (441,939 properties, 1,986,484 permits
on 237,531 parcels, roof age on 390,212). `npm run build-db -w @travis/deploy-build` rebuilds it (about 5 minutes, 16 GB
peak memory) and skips the build when its inputs are unchanged. The functions do not read that file: since the T7
correction (decisions.md section 30) they read its serving set, a 77 MB file in the image plus six Parquet files (585 MB)
in the private deploy bucket. `just deploy-api` exports, stages and uploads that set (each step skips what is current).
Before any deploy that changes it or the query layer, the agent runs the gate,
`npx tsx packages/deploy-build/scripts/serving-gate.ts` (it must print `PASS`).
Everything below is run by the operator from the repository root.
`PROFILE` is the AWS profile, `ACCOUNT` its 12-digit id.

### Setup (once; done for account 561303652468 on 2026-10-20, so skip it there)

```zsh
export PATH="/opt/homebrew/bin:$PATH" AWS_PROFILE=cdk-lab
brew install just
colima start --arch aarch64 --cpu 4 --memory 8 --disk 60
aws cloudformation describe-stacks --stack-name CDKToolkit --region us-east-2 --query 'Stacks[0].StackStatus' --output text
cp -n apps/api/cdk/config.example.json apps/api/cdk/config.json
```

`cdk-lab` is the profile of account 561303652468; for another account use its profile. `cp -n` never overwrites an
existing `config.json`. If the fourth command says the stack does not exist:
`npx --prefix apps/api/cdk cdk bootstrap aws://ACCOUNT/us-east-2`. In `apps/api/cdk/config.json` (gitignored) set
`account` and `alarmEmails`; keep `chatReservedConcurrency` at `0` (the chat route is a placeholder until T9).

### Deploy

```zsh
PUPPETEER_SKIP_DOWNLOAD=1 npm ci
just deploy-api
```

`deploy-api` exports the serving set, uploads its Parquet files to the deploy bucket, then pushes an image of about
0.6 GB to ECR; CDK asks to approve IAM changes when there are any (section 30: `s3:GetObject` on the bucket's
`serving/*` for both functions). Last it runs `just warm`, which opens and primes three API instances at once, so the
slow first cold starts of a new image land on the deploy, not on a reviewer (section 31). Run `just warm` again before
a live demo and before marking the PRs ready for review. Confirm the SNS subscription email. Then run check 1 at once, while both functions are still cold, and
afterwards (once; already done on 2026-10-20):

```zsh
just build-explorer deploy-web mirror
npm run stage-inputs -w @travis/deploy-build -- --bucket "$(aws cloudformation describe-stacks --stack-name TravisApi --region us-east-2 --query "Stacks[0].Outputs[?OutputKey=='DeployBucketName'].OutputValue" --output text)"
```

`deploy-web` creates CloudFront (about 5-10 minutes) and prints `ExplorerUrl`; `mirror` uploads the 2,929 table parts
(about 1.4 GB, each with the manifest's SHA-256 as its S3 checksum; re-running skips what is there).

### Check 1: the API, MCP and cold starts

```zsh
out() { aws cloudformation describe-stacks --stack-name TravisApi --region us-east-2 --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text; }
API_BASE=$(out ApiBase); echo "$API_BASE"
curl -s -o /dev/null -w 'crm %{http_code} %{time_total}s\n' "$API_BASE/v1/properties/search?lat=30.2672&lon=-97.7431&radius_miles=5&roof_age_min=15&open_permits=false&limit=500"
curl -s -o /dev/null -w 'meta %{http_code} %{time_total}s\n' "$API_BASE/v1/meta"
curl -s -o /dev/null -w 'chat %{http_code} %{time_total}s\n' -X POST "$API_BASE/v1/agent/chat" -H 'content-type: application/json' -d '{"messages":[{"role":"user","content":"hello"}]}'
curl -s "$API_BASE/v1/openapi.json" | shasum -a 256; shasum -a 256 packages/contract/openapi.json
curl -s -X POST "$API_BASE/v1/mcp" -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' -H 'mcp-protocol-version: 2025-06-18' -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"search_properties","arguments":{"lat":30.2672,"lon":-97.7431,"radius_miles":1,"roof_age_min":15,"open_permits":false,"limit":2}}}' | head -c 900; echo
```

Pass: `crm 200` within about 3 s (the CRM's main call on an instance the warm-up primed; decisions.md section 31),
`meta 200` and `chat 503`, each under 25 s (keep the times for the PR); the two SHA-256
lines equal; the MCP answer has `structuredContent` with two properties and no `isError`.

### Check 2: throttle, alarm, kill switch and the log trace

```zsh
for i in $(seq 30); do curl -s -o /dev/null -w '%{http_code} ' -X POST "$API_BASE/v1/agent/chat" -H 'content-type: application/json' -d '{"messages":[{"role":"user","content":"hello"}]}' & done; wait; echo
aws sns list-subscriptions-by-topic --region us-east-2 --topic-arn "$(aws cloudformation describe-stack-resources --region us-east-2 --stack-name TravisApi --query "StackResources[?ResourceType=='AWS::SNS::Topic'].PhysicalResourceId" --output text)" --query 'Subscriptions[?Protocol==`email`].SubscriptionArn' --output text
aws cloudwatch set-alarm-state --region us-east-2 --alarm-name travis-chat-daily-usage --state-value ALARM --state-reason 'T7 check'
sleep 90
curl -s -X POST "$API_BASE/v1/agent/chat" -H 'content-type: application/json' -d '{"messages":[{"role":"user","content":"hello"}]}'; echo
aws ssm put-parameter --region us-east-2 --name /travis/chat/budget-exhausted --value false --type String --overwrite >/dev/null
RID=$(curl -s -D - -o /dev/null "$API_BASE/v1/meta" | awk 'tolower($1)=="apigw-requestid:"{print $2}' | tr -d '\r'); echo "$RID"
sleep 60
for g in AccessLogGroupName ApiLogGroupName; do aws logs filter-log-events --region us-east-2 --log-group-name "$(out $g)" --filter-pattern "\"$RID\"" --query 'length(events)'; done
```

Pass: the subscription line prints an ARN, not `PendingConfirmation` (an unconfirmed subscription gets no email: on
2026-10-20 the confirmation had gone unnoticed; `aws sns subscribe` with the same address re-sends it); at least one
`429` among the 30 codes (sent at once; eight were not enough on 2026-10-20, when 2 of 30 came back
`429`: from a distant client the requests arrive spread out, and the 1-per-second rate with a burst of 3 absorbs them); an alarm email for `travis-chat-daily-usage` arrives; the chat answer
after the pause says `"reason":"budget_exhausted"`; both log counts are at least 1.

### Check 3: the explorer on the live URL

Open `ExplorerUrl` (from `deploy-web`, or `aws cloudformation describe-stacks --stack-name TravisWeb --region us-east-2`).
Its tabs follow README.md's "Demo Transcript" (the unnumbered "Presenter:" lines after the opening one), in order:

| Tab | The README's line | Pass |
| --- | --- | --- |
| 1 Run summary | "opening the pipeline run summary" | run `20261018T143520Z-t5-full`; 441,939 properties, 1,986,484 permits |
| 2 Records by source | "total uploaded records by source" | one row per source, with counts |
| 3 Query layer | "the DuckDB-backed query layer" | one preset SQL query returns rows (DuckDB-WASM reading the mirror) |
| 4 Manifest | "the published artifact manifest for this run" | manifest `bafybeid6jqq…` with its objects |
| 5 Verify | "retrieve one published artifact by CID from a public gateway … then … a second" | one table part and one directory root: `match` on `ipfs.filebase.io` and on `gateway.pinata.cloud` |
| 6 Run history | "a later incremental publish produced a new CID" | the published runs listed (run 2's new CID comes with T10) |
| 7-8 Lead queries | "properties within a sample radius … older than 15 years"; "open roofing permits … open for many years, including contractor and BBB rating" | central Austin, 5 miles: aged-roof properties listed; open roofing permits, longest open first, with the printed contractor and BBB shown as blocked |

The Agent tab is T9 (its route answers `503` until then); the MCP tab shows the endpoint. `unverified` on Pinata means
its hourly quota is spent: try again after the hour, never a pass by default. The first call after a quiet period can
take a few seconds; the loading text then says so (decisions.md section 31).

<details><summary>Teardown (after the evaluation only)</summary>

Disable termination protection on both stacks, then `npx --prefix apps/api/cdk cdk destroy TravisApi TravisWeb` and
`npx --prefix apps/api/cdk cdk gc`. The buckets, image and log groups go; IPFS keeps the published bytes.

</details>

## 10. T9 — the agent (`POST /v1/agent/chat`)

Built on 2026-10-20 (decisions.md section 32): the Bedrock agent on Sonnet 4.6 (`us.anthropic.claude-sonnet-4-6`), the
golden set (`fixtures/rag/queries`, 24 cases; results in `fixtures/rag/results`), LangSmith tracing to the project
`staraptor-agent`, and the explorer's Agent tab, with the alakazam review's fixes applied. Local results before deploy
(Sonnet 4.6, run 3): both hard gates on 26 of 26 turns, outcome accuracy 1.000, p95 14.3 s, README turns 8.8 s and 10.7 s,
"Pflugerville, TX" and "Austin, TX" turns 7.5 s and 9.4 s; `just sam-local` passed 4 of 4 on the image before the fix pass.
The secret `staraptor-agent/langsmith-api-key` exists already (2026-10-20). The coordinator deploys:

```zsh
export PATH="/opt/homebrew/bin:$PATH" AWS_PROFILE=cdk-lab
just deploy-api
just build-explorer deploy-web
```

`cdk deploy TravisApi` asks to approve the IAM changes (the chat role's Bedrock grant moves to the Sonnet 4.6 profile and
its three foundation models; `secretsmanager:GetSecretValue` on the one secret) and adds the alarm
`travis-chat-daily-tokens`, reserved concurrency 5 and the chat route throttle 0.4 a second, burst 5. `deploy-api` ends with
`just warm`, which now also warms two chat instances (no model call). Run `just warm` again before a live demo. Done 2026-10-20 and verified (decisions.md section 32, "Live"); later code-only deploys need no approval. Then:

### Check 1: the golden set against the live API

```zsh
out() { aws cloudformation describe-stacks --stack-name TravisApi --region us-east-2 --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text; }
API_BASE=$(out ApiBase)
npx tsx apps/api/scripts/golden.ts --target "$API_BASE" --label live 2>&1 | tail -40
```

Pass: `"pass": true` under `hard_gates`, `outcome_accuracy` at least 0.95, `latency_ms_p95` under 15000, and both
`readme_turn_ms` and both `state_suffix_turn_ms` under 15000 (23 cases: the tool-text injection case is local-only); the
run writes its result file to `fixtures/rag/results/`.

### Check 2: the README's two agent prompts in the explorer

Open `ExplorerUrl`, tab **Agent**, click **Ask the agent** (the first README prompt is filled in), then, once it has
answered, **Ask the agent** again (the second prompt is filled in next).

The tab prewarms the chat function at most once per 5 minutes; each prewarm and each `just warm` chat warm-up counts
toward the 200-a-day invocation limit that sets the kill switch.

Pass: both answers show the badge `answered`, a short answer with citation chips, assumptions (the Austin centroid's basis),
limitations (BBB blocked on the second), an evidence table and `model us.anthropic.claude-sonnet-4-6` under Tool calls;
while waiting a notice counts the seconds; each answer arrives in under about 15 s (a first question after a quiet period
can take up to about 25 s).

### Check 3: the LangSmith trace of that conversation

Open https://smith.langchain.com, project `staraptor-agent`, **Threads**, the newest thread.

Pass: two `staraptor-agent turn` runs in one thread, each with its model steps and tool calls (`resolve_search_center`,
then `search_properties` or `search_permits`) as child runs, and no error.

### Check 4: one CloudWatch log line of a turn

```zsh
aws logs filter-log-events --region us-east-2 --log-group-name "$(out ChatLogGroupName)" --filter-pattern '"chat turn"' --max-items 1 --query 'events[0].message' --output text
```

Pass: one JSON line with `"message":"chat turn"`, `outcome`, `steps`, `input_tokens`, `output_tokens`,
`cache_read_tokens` and `turn_ms`, ids and hashes only (no question or answer text).

## 11. T10 — run 2, the incremental next run (decisions.md section 33)

How run 2 was made (kit runtime, `/Users/luti/dev/ateam/role1-prism/kit-travis/skills/use-oracle/runtime`; for the record,
not to repeat):

1. `node src/counties/travis/t4-permit-fetch.mjs` → a newer capture (`v1792499798`), then `t4-permit-verify.mjs`.
2. `node --max-old-space-size=12288 src/counties/travis/t5-run.mjs --cli <assignment>/node_modules/.bin/elephant-cli
   --eligibility __ALL__ --label full --next-run latest --capture data/travis/permits/v1792499798` (if it stops, the same
   command without `--next-run` resumes it).
3. `src/counties/travis/t10-publish.sh 20261020T200236Z-t5-full` (only new roots; resumes on rerun).
4. In this repository: `npm run build-db -w @travis/deploy-build`, `scripts/deploy-api.sh`,
   `/usr/bin/python3 -I scripts/release-cars.py <run id>` per run.

### Checks (about 5 minutes)

Run 1 is `20261018T143520Z-t5-full`, run 2 is `20261020T200236Z-t5-full`.

1. **Both runs are listed.** Open the [explorer](https://d2n7ef6folp70l.cloudfront.net), tab **Run history**. You should see
   two full runs, newest first (plus the small pilot). Run 2 says it follows run 1 and shows 232 new and 3,662 changed permits.
   Raw: [`/v1/runs`](https://733jzm4xv4.execute-api.us-east-2.amazonaws.com/v1/runs).
2. **Run 1's CID still resolves and run 2 has its own** (README line 101). Each link opens a run's manifest from a public
   gateway; all four should open as JSON (Run history links the same URLs next to each manifest CID):
   - run 1: [Filebase](https://ipfs.filebase.io/ipfs/bafybeid6jqqzpo2ods6iehz5vgud2ust4fykfiozspzxb3xjmqiup36ud4),
     [Pinata](https://gateway.pinata.cloud/ipfs/bafybeid6jqqzpo2ods6iehz5vgud2ust4fykfiozspzxb3xjmqiup36ud4)
   - run 2: [Filebase](https://ipfs.filebase.io/ipfs/bafybeicj4vw5hgntnmwl2cie5txpe7esn4y3ygsqoau3hzqk5ipsz6xhqy),
     [Pinata](https://gateway.pinata.cloud/ipfs/bafybeicj4vw5hgntnmwl2cie5txpe7esn4y3ygsqoau3hzqk5ipsz6xhqy)

   Optional byte check in a terminal (prints `4a0f3231ed71` for run 1 and `8cf695be464a` for run 2, on both gateways):
   ```bash
   for c in bafybeid6jqqzpo2ods6iehz5vgud2ust4fykfiozspzxb3xjmqiup36ud4 bafybeicj4vw5hgntnmwl2cie5txpe7esn4y3ygsqoau3hzqk5ipsz6xhqy; do for g in https://ipfs.filebase.io https://gateway.pinata.cloud; do echo "$g ${c:0:12} $(curl -s "$g/ipfs/$c" | shasum -a 256 | cut -c1-12)"; done; done
   ```
3. **A changed shard got a new CID; an unchanged one kept its CID.** Explorer, tab **Manifest**, pick a run in the selector and
   search `property_improvement/s0001`: run 1 lists `…cp6ueq`, run 2 lists `…qiwwn2q`. Search `county/s0001`: the same CID in
   both runs (County records did not change).
4. **The CAR files are downloadable.** [Run 1's release](https://github.com/xucian/oracle-property-intelligence-platform-pipeline-travis-tx/releases/tag/run-20261018T143520Z-t5-full)
   has 354 files; [run 2's release](https://github.com/xucian/oracle-property-intelligence-platform-pipeline-travis-tx/releases/tag/run-20261020T200236Z-t5-full)
   has 156 (only its new CARs; unchanged ones stay in run 1's).

Verified 2026-10-21: the operator ran these four checks and approved T10.
