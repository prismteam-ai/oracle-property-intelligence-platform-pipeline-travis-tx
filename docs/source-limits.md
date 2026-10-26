# Source limits and measured throughput

Draft for A-16 AC-3 and AC-5. Updated 2026-10-26. Every number is measured in this repository's runs and cites its evidence file, run-log row or catalog entry (`pipeline/docs/travis-sources.yaml`, snapshot 2026-10-20T05:43:09Z). A source that never became reachable shows "blocked" with dates, not a throughput. "Not measured" means no measurement exists, with the reason.

## 1. Sources read from the web

| Source | Access and page size | Throughput | Full-capture duration at full scale | Rate limits and etiquette | Anti-bot posture | Optimisation applied |
| --- | --- | --- | --- | --- | --- | --- |
| **TCAD 2026 certified JSON export** (`tcad_certified`) | One zip file, 3,554,021,795 B (29.86 GB unzipped), 493,246 records, key `pID`, SHA-256 `6f7a7585...2346` | Download 328.2 MB/min (A-01, 2026-10-19). Streaming scan about 10 min. Load into the Query DB 260 to 382 records/s (2,000-record chunks, 3 in flight, 1 s pause) | Download 10.8 min (649.8 s, one range resume after a first attempt ended at 1,287,539,237 B). Full load **21.7 min** (A-04 run, 2026-10-22 05:26 to 05:48Z) | One identified request per file; no new download without a stop; a 403 or a SHA-256 mismatch ends in `WAITING_HUMAN`; never a retry with another identity | None seen (HTTP 200, 3 requests) | Download once, keep on disk; resume by range; chunked load with a health gate |
| **TCAD supplemental exports** (`tcad_supplemental`, `/publicinformation`) | Zip files listed on the public-information page | Not measured: listed, not downloaded in A-01 | Not measured (reason: the A-11 incremental path reads Austin, not the supplement) | One identified request | HTTP 403 on `publicinformation` was reported on 2026-10-17 and 2026-10-19, but no response was saved, so it is unconfirmed; the listing itself is reachable. The runs do not need these exports (the Austin incremental path reads Austin permits) | Not used as a feed |
| **Travis County GIS layer 6** (`tcad_gis`) | ArcGIS MapServer query, **2,000 features per request**, ids sent as a POST form body (a 2,000-id GET URL fails) | 4,578 features/s (US runner) | **81.6 s** for 187 pages, 373,683 features, concurrency 2 (GitHub-hosted US runner, run `39684063596`, 2026-10-22) | Concurrency at most 2; only `OBJECTID`, `PROP_ID`, `geo_id` requested | **Blocked from the operator machine**: TCP connect to `gis.traviscountytx.gov:443` never completes from egress EG (2026-10-17 to 2026-10-20: `docs/evidence/blocked/tcad_gis-20261019T210845Z.md`, `...212423Z.md`, `...20261020T053344Z.md`, `...072223Z.md`, last one current); answers from a US runner, no challenge | Capture from a GitHub Actions US runner (DEC-A-04-gis-runner); POST bodies; 60 s timeout, then page retry |
| **Austin Socrata permits `3syk-w9eu`** | Keyset pages `$order=:id`, **50,000 rows per page** (about 88 MB), no app token | Discovery measurement: 120,043 rows/min (median of 3 pages). Full backfill: **1,313.84 rows/s** (about 78,800/min) | Backfill: 48 pages, 2,381,226 rows, **1,812 s (about 31 min)**, 2026-10-21. Incremental Run 3 (2026-10-25): 48 pages, 2,381,886 rows read, **about 36 min**, 10,582 rows written, relink about 6 min | At most 1 request/s, project User-Agent, page timeout 5 min, up to 5 attempts with backoff (1 s base, 60 s cap, full jitter) | None seen. A 403 or challenge: stop, no retry. Austin re-stamped every `:updated_at` on 2026-10-19 12:22 to 12:43Z (source-wide re-stamp) | Keyset paging (`date_trunc_ymdh` does not exist; use `date_trunc_ymd` and `date_extract_hh` on `to_floating_timestamp(:updated_at,'UTC')`); re-stamp detector writes only rows whose content digest changed; watermark `maxUpdatedAt`; one page timed out and passed on attempt 2 |
| **Austin address-point layer** | ArcGIS layer, 466,149 records | Not measured per request (Run 3 made 2 metadata requests and reused a cache) | Not measured at full scale (reason: cached from an earlier agent run; layer last edit 2026-10-24T04:31:08Z) | Metadata requests only unless the last edit changes | None seen | Cache keyed by SHA-256 `4683eec6...b28b03c`; reload only when the layer edit date moves |
| **Texas Comptroller franchise-tax holders `9cir-efmm`** | Socrata, 50,000 rows per page, no app token | 327,439 rows/min (median of 3 pages, A-01) | Projected 0.017 h for 342,334 Travis-coded rows (A-01); registry load of 342,333 rows ran as job `travis-a07-identity-registry-20261022184652` (duration not recorded here) | Same Socrata etiquette; incremental by `:updated_at` | None seen (5 requests) | Travis-only lookup set (342,333 of 3,487,662 statewide rows), recorded as a manifest limitation |
| **BBB** (`bbb-harvest`) | Category listing page | Not measured | **Blocked**: HTTP 403 Cloudflare challenge (`cf-mitigated: challenge`) on 2026-10-17 and 2026-10-19 21:08:55Z; again 2026-10-20 (`docs/evidence/blocked/bbb-20261019T210855Z.md`, `bbb-20261020T072323Z.md`) | At most 1 request per 3 s, concurrency 1 (architecture constitution); stop on the first 403 | Cloudflare challenge; never solved, no identity change, no retry; 0 requests since (A-07 gap, PO decision 2026-10-22) | None possible; the official API application is not filed (PO decision 2026-10-20) |
| **Overture places** | Bulk files | Not measured (reason: optional source with no licence decision yet) | Not measured | n/a | None seen (1 request) | Bulk download only |
| **Contractor licensing (TDLR)** | Web pages | Not measured (no statewide roofing licence register to count) | n/a | n/a | None seen (2 requests) | Runtime retrieval only |

## 2. Permit portals of other jurisdictions

None of these has a bulk source. Every place is classified (22 are records-request class) in `travis-sources.yaml`; each carries its evidence file under `docs/evidence/blocked/`. Austin-issued permits located inside those places come from the Austin dataset above.

| Class | Places | Posture and dates |
| --- | --- | --- |
| Blocked (HTTP 403, Cloudflare or Access Denied) | Cedar Park, Creedmoor, Leander, Sunset Valley (2026-10-19) | Not requested again; no retry, no identity change |
| Blocked (HTTP 406, web application firewall) | San Leanna (2026-10-19 and 2026-10-20) | Not requested again |
| Blocked (HTTP 404, evidence page gone) | Rollingwood (2026-10-19, 2026-10-20) | Evidence URL updated; not requested again |
| Account-only portal, no public history | Travis County TNR, Bee Cave, Elgin, Jonestown, Lago Vista, Lakeway, Manor, Pflugerville, Round Rock | Records request, not filed (PO decision 2026-10-20) |
| Paper or office records, no online system | Briarcliff, Mustang Ridge, Point Venture, The Hills, Volente, Webberville, West Lake Hills | Records request, not filed |

## 3. Publication and read path

| Step | Measured | Limit and effect |
| --- | --- | --- |
| `elephant-cli` 44bb182, `validate` of loose files | 0.50 s per property (about 61 h for the county) | Never run on loose files at scale |
| `validate` of a CAR | about 13 ms per property (about 9 to 10 min per 44,000) | Used for the county |
| `hash` | about 13 ms per property in a CAR; Run 1 batches 2,065 to 2,500 s each | 10 county batches plus 2 permit batches |
| `export-tables` | about 25 s per 44,000 properties; Run 1 batches 27 to 166 s | Part size 48 MiB (`PART_SIZE_BYTES` 50,331,648) |
| Run 1 dry run, whole county | **3 h 19 min** (estimate was 46 min; waves ran 5-wide and competed) | Batched, not one pass |
| County group write (Run 3) | about 25 min | One pass; sharding was not used |
| Filebase | Free plan 5 GB; one county run about 2.95 GB (upper bound 3.73 GB), two runs would not fit; 504 and 429 seen under volume; quota stopped an upload on 2026-10-24 | One pinned run at a time |
| Pinata gateway (independent half of the check) | Served new county CARs at about 59 KB/s; `Retry-After` up to 2,806 s on 2026-10-24; `pinByHash` returns 403 `PAID_FEATURE_ONLY` | Whole-file readback beyond the 300 s limit; Run 3 used Filebase-only readback (`PUBLISH_DEFER_PINATA=1`); Retry-After honoured only up to a cap |
| ipfs.io and dweb.link | Retired 2026-09-21; answer 429 or a service-worker page | Not used |
| Hosted Permits page, full county | Run 2: first load 24 to 28 s from a home connection, about 45 s from GitHub runners (about 95 MB); count 0.26 s; list 0.56 s | Limit revised to 60 s; list paged at 200 rows |
| Hosted SQL panel, first query | about 97 s on the full county (A-13) | Later queries are fast |
| API Lambda, Explore search on the full county | Out of memory at 1 GB, then HTTP 500 at the 29 s limit (2 GB DuckDB cap) | A-13 gap carried to A-16 |
| Agent model (Bedrock Claude Sonnet 4.6) | 10 requests per minute (story context, 2026-10-17); budget guard pauses at $5 per day (raised from $3 on 2026-10-26) | Quota raised, confirmed 2026-10-17 |
| Account Lambda concurrency | 10, shared by API, agent and MCP | Bursts above 5 requests/s on `/mcp` mostly answer 503 (ERR-64) |

## 4. Limitations carried in the run report

- Confidential owner records redacted (conservative rule on sale-confidentiality codes): 15,410 accounts; the export carries no owner-level section 25.025 marker.
- `property_type` of 28,595 real-estate accounts is a generic fallback (`Building` with an improvement, `LandParcel` without); A4 (54,675 accounts, `Townhouse`, deprecated and unverified) and F4 (2,891) are listed.
- `tenure_years` comes from the latest dated sale, which may not be the current owner's.
- Austin roofing-permit match rate 88.36% (PO exception `DEC-A-04-permit-match-rate`); coverage of map points 99.63% of ordinary land parcels and 28.43% of condo-coded accounts (`DEC-A-04-coverage-exception`).
- GIS 373,683 features against a certified roll of 493,246 (24.24% below); the certified roll stays the denominator (`DEC-A-01-parcel-gap-exception`).
- 22 jurisdictions are `records request`, not filed; each carries its evidence URL in the report.

## 5. Machine notes (16 GiB laptop)

Docker's engine was killed twice by memory exhaustion during one-shot database scans (about 5 h lost, no data lost); long steps run in small batches with a health gate (waits up to 30 minutes for Postgres). Disk: the County group is 2.3 GB, the ten county archives 2.2 GB, the exported tables 0.5 GB, the Query DB 6 GB; Run 1's whole county job directory is 8.8 GB.

## 6. Open items before this file is final

- Confirm the TCAD `publicinformation` 403 (2026-10-17 and 2026-10-19): no matching evidence file was found in the repo.
- Comptroller registry load duration and the Bedrock 10-requests-per-minute measurement have no evidence file of their own; the first is in `specs/007-enrich-reconcile/run-log.md` if recorded, the second is quoted from the story.
