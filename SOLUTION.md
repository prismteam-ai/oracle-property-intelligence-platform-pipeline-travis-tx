# Travis County, TX Oracle pipeline — solution

This repository implements the pipeline described in [README.md](README.md). It ingests public Travis County property, permit, business, place and geography data on a repeatable, incremental schedule and reconciles it into DuckDB. Each run exports an immutable Parquet snapshot, which is published to IPFS as CIDv1 content with a CAR file and a JSON artifact manifest. The snapshot is served to agents (MCP) and people (explorer UI) without any Oracle-hosted database.

> **Scope:** this is a one-day deliverable, built and run within a single working session. Everything listed under [Results](#results-measured) was run and measured on real Travis County data. What is deliberately deferred, and why, is in [Limitations and trade-offs](#limitations-and-trade-offs), together with the follow-up work planned for the next days.

## Hosted runtime (AWS us-east-2)

| What                                                         | URL                                                      |
| ------------------------------------------------------------ | -------------------------------------------------------- |
| Explorer UI (run summary, IPFS publication, map, agent, SQL) | https://d33kpcae0foivx.cloudfront.net                    |
| MCP endpoint (Streamable HTTP)                               | https://d33kpcae0foivx.cloudfront.net/mcp                |
| JSON tool API                                                | `https://d33kpcae0foivx.cloudfront.net/api/tools/<tool>` |

The hosted API serves the latest public snapshot, `run-20261015T060821Z` (root `bafybeiawnfo4kvfsjwusazr3cjti53zqcowubwmlw7njbq6fxytnn2ijqm`), read from IPFS through `ipfs.filebase.io`. The publication record (`runs/history.json` and per-run manifests) is bundled into the Lambda at deploy time, so the explorer's IPFS publication tab works without a database; `historyUrl` can point it at the repository instead. See [Deployment](#deployment-aws-us-east-2-demo-scope) for what is and isn't deployed.

## Architecture

```
            ┌────────────── sources (public) ───────────────┐
            │ TxGIO StratMap parcels (TCAD)   Austin permits │
            │ TX Comptroller franchise tax    Overture places│
            │ Census TIGER county + places    TCAD roll  BBB*│  * US egress only
            └───────────────┬───────────────────────────────┘
                            │ raw artifacts (sha256, url, fetched_at) → data/raw/<source>/<run>/
                            ▼
   packages/pipeline ── DuckDB (data/travis.duckdb)
     run ledger: runs, run_sources (inserted/updated/unchanged/deleted/out_of_scope, limitation),
                 raw_artifacts, source_watermarks
     canonical : parcels, parcel_geometries, permits, businesses, places, geo_places, bbb_profiles, county_boundary
                 (every row: source_id, source_record_id, source_url, raw_sha256, collected_at, record_hash,
                  first_seen_run, last_seen_run, last_changed_run, is_deleted)
     derived   : permit_parcel_links (tcad_id → geo_id, else point-in-parcel), permit_scope (in county),
                 contractors (+ business / place / BBB links, ambiguous kept unlinked), roof_evidence,
                 property_roof, roofing_permits, property_leads
                            │ export
                            ▼
   data/exports/<run>/ tables/*.parquet geo/*.parquet run.json coverage.json schema.json samples/ NOTICE.txt
                            │ publish (CIDv1, IPIP-499 unixfs-v1-2025 profile, computed locally)
                            ▼
   <root>.car  +  CAR-of-CAR  +  manifest.json  → any Kubo-RPC node / Pinning-Service-API vendor (configurable)
   runs/manifests/<run>.json  runs/history.json  runs/manifests/<run>.verification.json   (committed)
                            │
                            ▼
   packages/mcp  ── embedded DuckDB over the snapshot (local dir or https://<gateway>/ipfs/<root CID>)
     • MCP server (Streamable HTTP /mcp, stdio)  • JSON API /api/tools/*  • agent /api/agent (Vercel AI SDK)
   apps/explorer ── React + MapLibre UI (run summary, publication + in-browser gateway verification, map, agent, SQL)
   infra         ── CDK (us-east-2): CloudFront + S3 + Lambda (API/MCP), on-demand Fargate ingestion, alarms
```

## How each acceptance criterion is met

| Criterion                                 | Implementation                                                                                                                                                                                                                                                                                                                                                                        |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Travis County default                     | `ORACLE_COUNTY=travis`, `ORACLE_FIPS=48453`; all scope clipping uses the Census county polygon.                                                                                                                                                                                                                                                                                       |
| Property records                          | `txgio_stratmap_parcels` (TCAD-contributed parcel roll, resolved to the newest TxGIO collection at run time).                                                                                                                                                                                                                                                                         |
| Permit records, roofing emphasis          | `austin_issued_construction_permits` (full + windowed incremental). Roofing classifier: building permits whose description indicates re-roof / replacement / shingles / tear-off / membrane, solar-only and rooftop-deck work excluded (`work_class_roof`, `roof_replacement`, `roof_work`). Unit-tested on real descriptions.                                                        |
| Status, open/close dates, open duration   | `status`, `applied/issued/status/expires/completed` dates, `is_open`, `open_days`, `expired_without_final`.                                                                                                                                                                                                                                                                           |
| Ownership                                 | owner name, care-of, mailing address; `owner_location_class` local / regional_texas / out_of_state; absentee signal; TCAD deed date → `last_deed_date`, `years_since_deed`, `ownership_tenure_basis` (same owner for N years).                                                                                                                                                        |
| Contractors + BBB                         | contractors reconciled across name variants (normalized name key), linked to Comptroller businesses and Overture places; BBB fields wired end-to-end but empty until the BBB harvest runs from US egress.                                                                                                                                                                             |
| Business records                          | Texas Comptroller active franchise taxpayers (county 227) and Overture places.                                                                                                                                                                                                                                                                                                        |
| Coordinates                               | parcel point-on-surface centroid, parcel polygons (WKB), permit lat/lon, Census place centroids for geocoding.                                                                                                                                                                                                                                                                        |
| Roof age (configurable threshold)         | `property_roof`: latest finaled re-roof permit (high confidence) → latest finaled primary-structure new-construction permit (medium) → TCAD year built of the main floors (`1ST`/`2ND`/`3RD` improvement details, low confidence) → `no_evidence`. TCAD roof style and covering are exported as `tcad_roof_attributes`. Threshold `ORACLE_ROOF_AGE_THRESHOLD_YEARS` / tool parameter. |
| Reconcile duplicates                      | permits ↔ parcels (TCAD id, then spatial), contractor name variants → one contractor, contractor ↔ business / place / BBB (unambiguous only), parcels deduplicated by prop_id.                                                                                                                                                                                                        |
| Provenance                                | every canonical row carries source id, source URL, raw artifact SHA-256 and collection time; raw files are kept per run.                                                                                                                                                                                                                                                              |
| Continuous / incremental                  | `run --mode incremental` uses per-source watermarks with a lookback window; snapshot sources are skipped when the raw artifact SHA-256 is unchanged; every merge records inserted / updated / unchanged / deleted counts. Scheduled on AWS via EventBridge → Fargate (disabled by default).                                                                                           |
| Run history                               | `runs` and `run_sources` tables, `run.json` inside every snapshot, `runs/history.json` and per-run manifests committed to the repo.                                                                                                                                                                                                                                                   |
| Slow / constrained sources                | see [docs/travis-sources.yaml](docs/travis-sources.yaml) and [Source constraints](#source-constraints).                                                                                                                                                                                                                                                                               |
| No ongoing Oracle infra cost              | no database server; data lives on IPFS; API is a Lambda (pay per request); ingestion is an on-demand Fargate task whose schedule is off by default; no NAT gateway.                                                                                                                                                                                                                   |
| IPFS (CIDv1, manifest, CAR, immutability) | `oracle-pipeline publish` computes every CID locally (CIDv1 base32), writes the CAR and a CAR-of-the-CAR, uploads to the configured providers, records the previous root CID, and never rewrites a published manifest.                                                                                                                                                                |
| Two independent gateways                  | `oracle-pipeline verify` fetches every object from ipfs.io and dweb.link and checks size + SHA-256 against the manifest; the explorer repeats this in the browser.                                                                                                                                                                                                                    |
| MCP-ready, agent access                   | `packages/mcp`: 13 read-only MCP tools over the snapshot, Streamable HTTP and stdio transports, plus an AI-SDK agent that uses the same tools.                                                                                                                                                                                                                                        |
| UI                                        | `apps/explorer`.                                                                                                                                                                                                                                                                                                                                                                      |

## Running locally

```bash
npm ci
docker compose up -d                       # local Kubo node (dev publish target)
cp .env.example .env                       # adjust providers/LLM as needed
npm run pipeline -- run --mode full        # first run (~20-30 min, ~2 GB raw)
npm run pipeline -- run --mode incremental # later runs: windowed permits, unchanged snapshots skipped
npm run pipeline -- publish --run <runId>  # CAR + manifest + provider upload
npm run pipeline -- verify --run <runId>   # two public gateways, size + sha256
npm run mcp                                # http://localhost:8787/mcp and /api/*
npm run dev -w @oracle/explorer            # http://localhost:5173
```

MCP client configuration (stdio):

```json
{
  "mcpServers": {
    "oracle-travis": {
      "command": "npx",
      "args": ["tsx", "packages/mcp/src/stdio.ts"],
      "env": { "ORACLE_SNAPSHOT_ROOT_CID": "<root cid>" }
    }
  }
}
```

## Deployment (AWS, us-east-2): demo scope

`OracleTravisApi` (CloudFront + S3 explorer, Lambda MCP/API/agent) is deployed and serves the published snapshot. `OracleTravisIngest` (Fargate ingestion, EventBridge schedule, alarms) is synthesized but not deployed: ingestion ran on the development machine and published the snapshot that the hosted API reads. See [Deployment scope](#deployment-scope-demo-only). The manual steps are below; a wrapper script with preflight checks was used for the actual deploy.

```bash
npm run build -w @oracle/explorer
cd infra
npx cdk bootstrap
npx cdk deploy OracleTravisApi -c snapshotRootCid=<root cid> \
  -c historyUrl=<raw URL of runs/history.json> -c manifestBaseUrl=<raw URL of runs/manifests>
npx cdk deploy OracleTravisIngest -c alertEmail=<email> [-c ingestScheduleEnabled=true]
aws ssm put-parameter --name /oracle-travis/publish-env --type SecureString --value "$(cat publish.env)"
aws ecs run-task --cluster <ClusterName> --task-definition <TaskDefinitionArn> --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[<PublicSubnets>],assignPublicIp=ENABLED}"
```

## Results (measured)

All numbers come from real runs on 2026-10-14 and 2026-10-15, made from a development machine whose egress is outside the US (Poland).

### Run history (`runs` table, shown in the explorer)

| Run                  | Mode        | Status    | Notes                                                                                                                                                                                                             |
| -------------------- | ----------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| run-20261014T193222Z | full        | failed    | Every source was ingested. Derive then ran out of disk: a cross join copied the 81 KB county polygon onto each of 2.38M permit rows. Fixed by evaluating the polygon once and adding DuckDB memory and temp caps. |
| run-20261014T201502Z | incremental | failed    | Host froze during derive (same bug). Overture failed because an empty `ORACLE_OVERTURE_RELEASE=` in `.env` was used as a value; config now treats empty values as unset.                                          |
| run-20261014T203653Z | incremental | succeeded | First clean snapshot.                                                                                                                                                                                             |
| run-20261014T204527Z | incremental | succeeded | Roofing classifier tightened ("new roof top skylights" was a false positive found by the agent). Reclassification ran over all 2.38M stored permits.                                                              |
| run-20261015T051946Z | incremental | succeeded | Next day, before Austin's daily reload: all sources unchanged (no false updates). Published to Filebase as the second public snapshot.                                                                            |
| run-20261015T054647Z | incremental | succeeded | First TCAD load (traviscad.org became reachable): 453,705 roll records. Validation found 10 implausible deed dates (years 0021, 2202, ...); bounded to 1836..today, re-run. Not published.                        |
| run-20261015T055323Z | incremental | succeeded | TCAD with bounded deed dates (11 records updated). Published as the third public snapshot, then superseded: `property_leads.year_built` still read StratMap's empty column.                                       |
| run-20261015T060153Z | incremental | partial   | TCAD source failed: its download directory was deleted by an operator clean-up command during the run. Not published.                                                                                             |
| run-20261015T060821Z | incremental | succeeded | TCAD year built in `property_leads` and coverage. **Latest public snapshot.**                                                                                                                                     |

Incremental change detection:

- StratMap was skipped as unchanged (identical raw SHA-256).
- The permit window returned 13,701 records, all unchanged.
- Businesses (342,337), places (93,331), county (1) and Census places (49) were all unchanged.
- No false updates were recorded.

### Coverage (run-20261015T060821Z, latest)

| Measure                                                                                                    | Count                                                              |
| ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Properties (TCAD prop_id, StratMap 2026)                                                                   | 386,241                                                            |
| Properties with owner / with coordinates                                                                   | 379,607 / 386,241                                                  |
| Properties joined to the TCAD appraisal roll (453,705 roll records)                                        | 379,607                                                            |
| Properties with TCAD year built / deed date                                                                | 327,006 / 365,846                                                  |
| Properties with the same owner for 10+ years (TCAD deed date)                                              | 161,304                                                            |
| Properties with roof age: re-roof permit (high) / new-construction permit (medium) / TCAD year built (low) | 10,471 / 98,553 / 223,436 (332,460 total; 53,781 without evidence) |
| Properties with roof age at least 15 years                                                                 | 247,981 (permit evidence only: 75,592)                             |
| Permits ingested (City of Austin) / in Travis County                                                       | 2,380,118 / 2,199,708                                              |
| Permits linked to a parcel by TCAD id / by point-in-parcel                                                 | 1,999,118 / 181,467                                                |
| Roofing permits in county / open / open 5+ years                                                           | 23,868 / 250 / 6                                                   |
| Contractors after name reconciliation (2,504 variants merged)                                              | 52,413                                                             |
| Contractors linked to Comptroller business / Overture place / ambiguous (kept unlinked)                    | 3,488 / 2,112 / 20                                                 |
| Active franchise-tax businesses (Travis)                                                                   | 342,337                                                            |
| Overture places inside the county polygon (OSM-sourced excluded)                                           | 93,331                                                             |
| Out-of-state / regional-Texas owners                                                                       | 22,119 / 25,509                                                    |

### Publication

| Item                                                                                      | Value                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Public runs (CIDv1, unixfs-v1-2025 profile), pinned on Filebase via Kubo RPC `dag/import` | `run-20261014T204527Z`: root `bafybeic3pzmw7facz2kcxgwxdpeysmma6d4iasi7eqpwyu2tdlz4gkmmwa`. `run-20261015T051946Z`: root `bafybeidn6o4enpjappzak7vg27efdrx5g3rjfujd27vpsvsflxx5fjqj44`. `run-20261015T055323Z`: root `bafybeibcg6m3vs3mty6zrjjayeaj3zadanj2iz7d3q2thyobvl76g76ddi` (superseded, see run history). **`run-20261015T060821Z` (latest, with TCAD): root `bafybeiawnfo4kvfsjwusazr3cjti53zqcowubwmlw7njbq6fxytnn2ijqm`.** Each records the one before it as `previous`, and all roots still resolve through `ipfs.filebase.io`. |
| CAR file                                                                                  | 363,038,776 bytes for the first run, 403,614,541 bytes for the latest (TCAD columns added); CIDs recorded in `runs/manifests/<run>.json`                                                                                                                                                                                                                                                                                                                                                                                                    |
| Local Kubo verification                                                                   | 21/21 file objects matched size and SHA-256                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Immutability (local node)                                                                 | Two consecutive runs gave distinct roots: `…qcos4` then `…kmmwa`. The second records the first as `previous`, and both still resolve.                                                                                                                                                                                                                                                                                                                                                                                                       |
| Public gateways                                                                           | See `runs/manifests/<run>.verification.json`. ipfs.io and dweb.link rate-limited this development IP (HTTP 429, `Retry-After: 900`), so the verifier backs off and retries.                                                                                                                                                                                                                                                                                                                                                                 |

### Agent (Claude Sonnet 5.5 through the Vercel AI SDK, real snapshot)

- **"Which properties within five miles of Pflugerville have roofs older than 15 years?"**
  - Calls `find_aged_roof_properties`.
  - Before TCAD (run-20261014T204527Z): 1,968 matches out of 47,128 properties; it stated that about 90% of the radius lacked evidence, because Pflugerville permits come from another portal.
  - With TCAD (run-20261015T060821Z): 27,046 matches (1,968 from new-construction permits, 25,078 from TCAD year built), 4,948 still without evidence. It flags the year-built matches as low confidence and points out placeholder-looking build years (1800, 1900) among the oldest.
- **"Which properties within one mile of downtown Austin have had the same owner for more than 10 years and a roof older than 20 years?"** (with TCAD, run-20261015T060821Z)
  - Uses the TCAD deed date for tenure and states it is the only ownership-change signal.
  - Notes that the Census "Austin" point lies about 2.3 miles from the business district and answers for both centres: 1,686 and 839 matches, with the split by roof-age basis.
- **"Which have open roofing permits open for many years, and who is the contractor?"**
  - Answers with three `find_open_roofing_permits` calls, widening the criteria.
  - Reports that no permit has been open 3+ years in that radius.
  - Lists permits that expired without a final inspection, with contractor name and phone and "BBB: not available".
  - Flags the one open permit as a weak lead.

### Hosted runtime checks (2026-10-15)

Run against https://d33kpcae0foivx.cloudfront.net after deployment:

- **Explorer:** loads and shows the run summary, coverage tiles and source deltas for `run-20261015T060821Z`, read from IPFS.
- **MCP:** `initialize` and `tools/list` (13 tools) over Streamable HTTP; `find_open_roofing_permits` (Austin, 5 mi, open 5+ years) returned the same 5 permits as locally, in 0.55 s warm.
- **Tools and SQL:** `find_aged_roof_properties` (Pflugerville, 5 mi, 15+ years) returned 27,046 matches, as locally; `query_sql` over `property_leads` worked. The first request after a cold start took about 7 s.
- **Agent (Bedrock, `us.anthropic.claude-sonnet-5-5`):** answered "How many open roofing permits older than five years are within five miles of Austin?" in 18 s with the same 5 permits, its method and a table. Through CloudFront, a longer question first hit CloudFront's default 30 s origin timeout (HTTP 504); the origin read timeout is now 60 s and the agent stops itself at 55 s with a JSON error instead.

## Source constraints

The full catalogue is in [docs/travis-sources.yaml](docs/travis-sources.yaml).

| Source                                  | Constraint                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TCAD appraisal export (`traviscad.org`) | Returned Cloudflare 403 to non-US egress on 2026-10-14; reachable on 2026-10-15. The yearly certified export is a 557 MB zip (18 GB unzipped, 9,923-character fixed-width latin-1 records); only `PROP.TXT`, `IMP_DET.TXT` and `IMP_ATR.TXT` are extracted and they are deleted after loading. All 42 parser field positions were checked against TCAD's published 8.0.33 layout. Deed dates are `MM-DD-YYYY`; 10 implausible years are kept only as raw text. Year built is taken from main-floor details only (porches, paving and canopies excluded). Pre-1925 build years cluster on 1900 / 1910 / 1920, i.e. appraiser estimates. |
| BBB                                     | 403 from non-US egress. The `bbb_profiles` table and its contractor links are wired through to every consumer. The harvest adapter is not written yet: it needs real BBB pages from US egress.                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| City of Austin permits (Socrata)        | About 70–140 s per 250k-row page; a full pull is about 20 minutes and 1.3 GB of CSV (gzipped after staging). `:updated_at` is rewritten on every daily reload, so it cannot be used for change detection; per-record content hashes plus a date window are used instead.                                                                                                                                                                                                                                                                                                                                                               |
| Other permit jurisdictions              | Pflugerville, Lakeway, Bee Cave, Manor, unincorporated Travis County and others run separate portals, which are not ingested yet. The agent reports this gap in its answers.                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| StratMap parcels                        | CloudFront 403 without a browser User-Agent and Referer. `YEAR_BUILT` is empty for every Travis row. Updated yearly.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Texas Comptroller                       | Active franchise taxpayers only. Texas has no statewide roofing-contractor licence.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Public IPFS gateways                    | ipfs.io and dweb.link rate-limit (HTTP 429) after a few dozen requests per IP. Verification spaces its requests and honours `Retry-After`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

## Limitations and trade-offs

The work was time-boxed to a single day. These items were left out on purpose; the reason is recorded for each.

### Deployment scope (demo only)

- **Deployed:** `OracleTravisApi`, the hosted explorer, MCP endpoint and agent (see [Hosted runtime](#hosted-runtime-aws-us-east-2)). The Lambda reads the published snapshot straight from IPFS, so no Oracle-hosted database exists.
- **Not deployed:** `OracleTravisIngest`. To keep the cost of a test task minimal, ingestion ran on the development machine, and the hosted API serves the snapshot it published. The stack synthesizes and needs no code changes to deploy; its task receives the TCAD export URL.
- **Agent model:** Bedrock (`us.anthropic.claude-sonnet-5-5`) on the hosted runtime. The locally measured agent results below used the same model through the Anthropic provider of the Vercel AI SDK.
- **Not built:** Bedrock embeddings.

### BBB not reachable from the development machine

- **What's affected:** `bbb.org` returns HTTP 403 (Cloudflare) to the non-US development egress (Poland). BBB is the only source of contractor ratings.
- **TCAD (resolved):** `traviscad.org` returned 403 on 2026-10-14 but was reachable on 2026-10-15, so the real certified export was ingested (see [Coverage](#coverage-run-20261015t060821z-latest)). The parser was validated against it: two fixes followed (`MM-DD-YYYY` deed dates, year built from main-floor details only) and implausible deed dates are now bounded.
- **What is in place for BBB:** the `bbb_profiles` table, contractor-to-BBB links and BBB columns are wired end to end, but are empty. BBB is recorded as `blocked` in every run, with the probe results, so the gap is visible in run history rather than hidden.
- **Consequences for the README criteria:** BBB ratings show as "not available".
- **Plan:** write the BBB harvest adapter against real BBB pages and run it from US egress (the CDK Fargate task in `infra/` once a deployment is funded, or any US-based runner).

### Roof age is an estimate for most properties

- Only 10,471 properties have a finaled re-roof permit (high confidence) and 98,553 a finaled new-construction permit (medium). For 223,436 more, roof age falls back to TCAD year built (low confidence): it is the building's age, not the roof's, and for old buildings it is often an appraiser estimate.
- Every row carries `roof_age_basis` and `roof_age_confidence`, the MCP tools return them, and the agent states the basis in its answers.

### Kit-conformance rework deferred

- **Kit path:** the soofi-xyz kit's Oracle path consists of Restate durable workflows, Elephant lexicon records, `elephant-cli` CAR hashing and upload, and Atlas county-page registration.
- **What was built instead:**
  - a self-contained TypeScript pipeline;
  - a DuckDB ledger with its own normalized canonical schema, provenance on every row and content-hash deltas;
  - a CIDv1 CAR builder.
- **What still follows the kit:**
  - **County discovery:** the kit's discovery outputs (`docs/travis-sources.yaml`).
  - **Engineering guidelines:** TypeScript, CDK in us-east-2, the Vercel AI SDK, Powertools, Vitest and GitHub Actions.
- **Why:** mapping into the Elephant lexicon and adopting Restate and Atlas is more work than one session allows, and the README requirements are met without it.
- **What makes the rework contained:** the canonical tables are source-agnostic, so it would be a mapping layer plus an orchestration swap, not a rewrite.

### Embedding-based RAG skipped

- **What's there now:** agent retrieval is tool-based (structured DuckDB queries over the snapshot) plus BM25 full-text search over roofing permits. Every answer is grounded in tool results and cites prop_ids, permit numbers and source URLs. This was verified live with Claude on real data.
- **What's missing:** vector (embedding) retrieval was not built, because no Bedrock access was available for an embedding model during the session.
- **Plan:** add embeddings (Bedrock Titan, or another provider through the Vercel AI SDK) for permit descriptions and contractor text, stored alongside the Parquet snapshot.

### Deployment and publication status

- **Hosted runtime:** `OracleTravisApi` is deployed in us-east-2 (see [Hosted runtime](#hosted-runtime-aws-us-east-2)); the ingestion stack is not (see [Deployment scope](#deployment-scope-demo-only)).
- **Public IPFS:** four runs are pinned on Filebase: `run-20261014T204527Z`, `run-20261015T051946Z`, `run-20261015T055323Z` (superseded) and `run-20261015T060821Z` (latest, with TCAD).
  - **Two-gateway verification:** couldn't be completed from the development IP, because ipfs.io and dweb.link rate-limited it (HTTP 429, `Retry-After: 900`). The verifier backs off and retries.
  - **New CID per run:**
    - The second public run got a new immutable root CID and records the first as `previous`; the first root is unchanged and still resolves.
    - That run found **no source changes**: Austin reloads its permit data at about 12:00 UTC and the run happened at 05:20 UTC. Its CID differs because the as-of date (roof ages, open durations) and the run metadata changed, not because of new source records.
    - A run after Austin's next reload would carry real record changes.
- **IPNS:** implemented as configuration (Filebase names API, `ORACLE_IPNS_PROVIDER=filebase-names`), not yet enabled.
- **Second pinning vendor:** not in place; see the next section.

### Second IPFS pinning vendor

The README asks that published artifacts stay retrievable after any single pinning vendor is gone.

- **Today:** only Filebase pins the snapshot. Two things mitigate this:
  - Every manifest lists a CAR of the snapshot DAG, and the CAR is itself published by CID.
  - Anyone can `ipfs dag import` that CAR into any IPFS node and serve the identical CIDs.
- **Why no second vendor yet:** it must keep our exact CIDs, either by pinning an existing CID or by importing our CAR without re-chunking. On 2026-10-14, no free-tier vendor could be confirmed to do that.
- **Adding one later:** the publisher supports any Kubo-RPC `dag/import` endpoint or any IPFS Pinning Service API endpoint through `.env` alone (`ORACLE_IPFS_PROVIDERS`, `ORACLE_IPFS_<NAME>_TYPE/URL/AUTH|TOKEN`). A vendor exposing one of these needs no code change.

What was checked on 2026-10-14. "Direct test" means a request made from this project's pipeline code and its response recorded; "observed" means an HTTP request made from the development machine.

| Vendor                            | What was checked                                                                               | Result                                                                                                                                                                                                                                                                                     | Source                                                                                        |
| --------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| Filebase (in use)                 | CAR import through Kubo RPC `POST https://rpc.filebase.io/api/v0/dag/import`                   | The root CID of our CAR was reported pinned. The snapshot root `bafybeic3pzmw7facz2kcxgwxdpeysmma6d4iasi7eqpwyu2tdlz4gkmmwa` is pinned.                                                                                                                                                    | Direct test; `runs/manifests/run-20261014T204527Z.json` (`providers`)                         |
| Filebase (in use)                 | Documented CAR upload over S3                                                                  | "Folders pin as CAR files" uploaded with "the `import=car` metadata flag"; "The response includes the folder's root CID."                                                                                                                                                                  | [Filebase docs: Pinning files](https://filebase.com/docs/ipfs/pinning/pinning-files)          |
| Filebase (in use)                 | Storage available                                                                              | 5 GB on the plan used for this project                                                                                                                                                                                                                                                     | Plan limit stated by the account owner                                                        |
| Pinata                            | API credentials                                                                                | `GET https://api.pinata.cloud/data/testAuthentication` returned 200                                                                                                                                                                                                                        | Direct test                                                                                   |
| Pinata                            | Pin an existing CID through the Pinning Service API (`POST https://api.pinata.cloud/psa/pins`) | HTTP 403 `PAID_FEATURE_ONLY`: "You must be on a paid plan to pin by CID"                                                                                                                                                                                                                   | Direct test (API response)                                                                    |
| Pinata                            | Storage available                                                                              | 1 GB on the plan used for this project                                                                                                                                                                                                                                                     | Plan limit stated by the account owner                                                        |
| Storj IPFS Pinning Service (beta) | Access                                                                                         | "We are no longer accepting additional beta users." Uploads go to `https://www.storj-ipfs.com/api/v0/dag/import` with beta-issued HTTP basic-auth credentials. No free tier, limits or pricing are stated.                                                                                 | [Storj docs: Storj IPFS Pinning Service (Beta)](https://storj.dev/dcs/api/storj-ipfs-pinning) |
| Storacha                          | Service availability                                                                           | `https://storacha.network/` returned `301` → `https://fil.one/`. `https://console.storacha.network/` did not respond (no HTTP status).                                                                                                                                                     | Observed                                                                                      |
| Storacha                          | What the redirect target offers                                                                | fil.one describes itself as S3-compatible object storage with "1 TB free for 30 days", and offers migration "from Storacha or another S3-compatible provider". Its homepage does not mention IPFS pinning or CAR uploads.                                                                  | [fil.one](https://www.fil.one/)                                                               |
| IPFS.NINJA                        | Site and docs                                                                                  | `https://ipfs.ninja/` returned HTTP 403. Its documentation URLs (`/docs/api/car-import`, `/blog/best-ipfs-pinning-services`) return `301` → `https://zellbox.com/`, an appointment-scheduling product that does not mention IPFS. No IPFS.NINJA capability or free tier could be verified. | Observed; [zellbox.com](https://zellbox.com/)                                                 |
| Lighthouse                        | Free tier, pin-by-CID, CAR upload                                                              | The homepage mentions none of these; its FAQ says "Filecoin plans can be billed monthly or annually, and Walrus plans are currently billed monthly."                                                                                                                                       | [lighthouse.storage](https://www.lighthouse.storage/)                                         |
| 4EVERLAND                         | Free tier, pin-by-CID, CAR upload                                                              | The homepage says "Our built-in pinning orchestration makes the process of uploading and pinning files to IPFS and Arweave seamless" and has a "Get Started for Free" button. It states no free-tier limits and does not mention pin-by-CID or CAR uploads.                                | [4everland.org](https://www.4everland.org/)                                                   |

**Follow-up:** confirm a second vendor before relying on it. Options:

- a paid Pinata plan (pin-by-CID is the blocker above);
- or a vendor whose documentation and a probe upload show that it preserves CIDs.

Then add it to `ORACLE_IPFS_PROVIDERS`. With a 1 GB limit, pin only the snapshot root (about 363 MB), not the CAR file, on that vendor.

### Coverage limits that remain even with US egress

- **Permits:** only City of Austin permits (full purpose, limited purpose and ETJ) are ingested. Pflugerville, Lakeway, Bee Cave, Manor, unincorporated Travis County and other jurisdictions run separate portals. Each would need its own adapter into the same `permits` table, plus a mapping of its status and description vocabulary.
- **Roofing classification:** rule-based, on Austin's permit descriptions. It is re-applied to all stored permits on every run, so fixes apply retroactively; one false-positive class was already found and fixed by reviewing agent output.

### Next days (optional rework and enhancements)

1. Deploy `OracleTravisIngest` and run ingestion from Fargate (the task already receives the TCAD export URL). Add the BBB harvest adapter and run it from US egress.
2. Publish a run made after Austin's daily reload (real record changes), and run the two-gateway verification from a network the public gateways don't rate-limit. Optionally enable IPNS, and add a second pinning vendor once one is confirmed to preserve CIDs (see [Second IPFS pinning vendor](#second-ipfs-pinning-vendor)).
3. Add Bedrock embeddings for RAG.
4. Optionally align with the kit: Elephant lexicon mapping, Restate orchestration and Atlas registration.
5. Add permit adapters for the other Travis County jurisdictions.
