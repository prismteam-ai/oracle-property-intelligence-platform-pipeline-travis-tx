---
story: A-04
agent: soofi-xyz-team-kit:oracle (design, read-only)
date: 2026-10-21
skills: county-seed-data, county-appraisal-onboarding, build-county-transform, county-ingest-run, use-oracle, query-db-loading-matching, county-permit-adapter, durable-workflow-builder, apply-engineering-guidelines
subagent: duration_ms see run-log.md
---

# Agent design: A-04 (oracle, word for word)

> Saved verbatim from the oracle design subagent's answer. Stage 0 export-read findings that arrived after the brief are appended at the end as **Lead notes** (not oracle's words).

## 0. Facts found that change the design (read first)

1. **The kit ArcGIS adapter is not vendored.** `kit/VENDORED.md` lists only the readiness validator, its fixtures and `roof-age/estimator.ts`. To use `arcgis-feature-service.mjs` we must vendor it unmodified together with what it imports: `permits/{contracts,backfill-inputs,normalization,http,errors}.mjs`. `backfill-inputs.mjs` loads `@dsnp/parquetjs` when imported, so that becomes a new dependency. Each file needs a hash row in VENDORED.md.
2. **The adapter hard-codes `returnGeometry:false` and `outFields:"*"`, and it is a permit normaliser.** Its `onPage` hands back permit records, not geometry. Its seams are `options.client` (any object with `json(url)`), `loadPageCheckpoint`, `onPage`, `pageConcurrency ≤ bulkConcurrency` and the snapshot drift refusal. That is how we get points (see §2).
3. **The TCAD export already carries a point.** `geometry` is printed as `"[lat, lon]"` (`shared-seed.ts pointOf`). A-03 writes it as `geometry.json`, and the frozen contract labels it `gis_centroid`. DEC-A-01 says real-estate (R) accounts with no export point are mainly A4/F4 (56,139) and O1 (3,534). So R accounts with an export point are about 382k (about 86% of R), and GIS (373,683 features) covers almost the same land parcels. **The 99% target depends on the condo rule, not on GIS paging.**
4. **Frozen `v_property` cannot show `permit_point`.** `views.sql:154` calls `coordinate_source(geo.latitude, geo.longitude, NULL::DOUBLE, NULL::DOUBLE)`, so any published geometry reads as `gis_centroid`. A permit point written as geometry would be mislabelled, which breaks P0-11.
5. **Frozen missing reasons are a closed list.** `no_gis_feature`, `gis_null_geometry`, `no_permit_point` (AC-10) and `no_issue_date` (AC-16) are not on it. The public values are `no_coordinates`, `source_missing` and `needs_review`.
6. **Owner mailing ZIP, situs and city are `not_in_export` in v1** (ADR-0002 R7: `address` is a top-level oneOf). So publicly `owner_area_class = unknown` and AC-3 can only hold in the Query DB.
7. **The versioned ZIP lists already exist (AD-26, D-6 done).** `gazetteer/travis-places@1.0.0/owner-area.json` holds 63 Travis ZCTAs, 49 regional ZCTAs, 6 regional county FIPS codes and an all-US ZCTA bitmap. `sources.json` holds the Census URLs with their SHA-256. `ownerArea(zip)` is the classifier and `GAZETTEER_SHA256` (0f4c08a8…) is the digest. A-04 must reuse these and not create new lists.
8. **No Query DB schema exists yet.** No `CREATE TABLE` anywhere; A-03 ran scripts, not Restate (D-5). `local-stack/services/app.ts` is one shared registration file.
9. **The data folders are not actually gitignored.** `pipeline/data` and `pipeline/local-stack/data` are symlinks in this worktree. `.gitignore` has `pipeline/data/` (a trailing slash matches directories, not symlinks) and nothing for `local-stack/data`. `git status` shows both as `??`, so a `git add -A` would commit the symlinks (local paths), even though not the captures.
10. **`STATE_CODES` conflicts with DEC-A-01.** `shared-seed.ts` maps A4 to `Townhouse`, but DEC-A-01 reads A4/F4 as condominium units ("meaning unverified"). Only 11 codes are mapped, so a full-county run gives many `property_type = null` rows.

## 1. Part TCAD (G-TCAD), AC-1 to AC-6

**Assumptions about the field-level read (still running)**
- Year built is in `propertyProfile[0].imprvActualYearBuilt`, plus a per-improvement array (`improvements[]`, each with its own year built and area).
- Sale date is `sales[].saleDt`.
- Confidentiality comes from `owners[].confidentialCode`, `sales[].confidentialCode` and `sales[].confidentialSale`, as A-03 modelled.
- `geometry` is a point string.

If the read shows different names, only `travis/tcad/fields.ts` and `redact.ts` change. If it finds a property-level §25.025 flag whose key does **not** start with `confid`, A-03's fail-closed check (`/^confid/i`) misses it. So the field read must produce a full key inventory, and the export Zod schema must reject any unknown top-level key (strict schema, the run fails).

**Key.** `request_identifier = String(pID)`, exactly as printed (P0-5; kit folio rule). geoID is kept as a string with its leading zeros and is never normalised to digits. In the Query DB, `tcad_geoid(geo_id, request_identifier, prop_type)` holds many rows per geoID; 11,589 R accounts share a geoID.

**Mapping to frozen names.** Query DB columns use the `v_property` names so that the Query DB count and the `v_property` count compare one to one.

| Frozen name | Source and rule |
| --- | --- |
| `request_identifier`, `parcel_identifier` | pID (keep A-03's choice) |
| `property_type`, `property_usage_type` | `propertyProfile[0].stateCd` through a versioned code map. Extend it only with an official PTD/TCAD code-table citation; resolve A4 first (fact 10). |
| `property_structure_built_year` | the year-built rule below |
| `latitude`, `longitude`, `coordinate_source` | written by G-GIS's assembler |
| `last_ownership_transfer_date`, `tenure_years`, `tenure_basis`, `is_long_tenure` | the latest dated `saleDt`. No dated sale gives `tenure_basis = unknown`, `is_long_tenure = null` (AC-4). |
| `owner_kind`, `owner_name` | A-03's person/company/unparsed split |
| `owner_area_class`, `owner_is_out_of_area`, `area_list_sha256` | `ownerArea(addrZip)` from the gazetteer, stamped with `GAZETTEER_SHA256` (AC-3, Query DB only). Abroad means `out_of_area` only when `addrCountry` is non-US; otherwise `unknown`. |

Extra Query DB columns: `prop_type` (R/P/MH/MN, D-5), `confidential`, `confidential_basis[]`, `export_sha256`, `record_ordinal`, `record_sha256` (of the raw record bytes), `source_url` (`TCAD_EXPORT_REQUEST.url`), `year_built_rule`, and `run_id`.

**Year-built rule** (one rule, recorded as `year_built_rule`):
1. Use `propertyProfile[0].imprvActualYearBuilt` if it is an integer from 1800 up to the year of `as_of`. This is TCAD's own main-improvement year (`profile_main`).
2. Otherwise use the improvement with the largest living area among residential main-improvement types, and its actual year built (`largest_main_improvement`).
3. Never take the minimum, maximum or effective year. Otherwise the value is null with `source_missing`, and the roof-age basis is `unknown` / `no_roof_date` (AC-4).

All improvements stay as child rows (`tcad_improvement`).

**§25.025 redaction before validate (AC-5; D-7).** Add a new `travis/tcad/redact.ts`, called **immediately after the Zod parse** in the stream. It runs before both the Loader mapping and `transformTcadCounty`. It returns the record with owner names, mailing lines and sale-party data stripped, plus the basis.
- The Query DB stores the **redacted** payload plus `record_sha256` of the original bytes, so provenance can still be checked against the export on disk. A confidential name never reaches the Query DB or a group directory.
- This bends the kit rule "preserve full source_payload". The raw export zip stays as the gitignored source of truth.
- `tcad-county.ts` keeps its suppression logic as a second guard. The redacted count goes into the run's source limitations (A-11 copies it into the manifest).
- Confidential accounts **are loaded** (property, coordinates, year built); only owner fields are hidden. See disagreement #3.

**AC-2 reconciliation.** Query DB `tcad_property` holds all 493,246 rows, each with `prop_type`. Taxonomy, following kit pattern 5: `loaded`, `dead` (in export but unparseable, record kept in `dead.json`), `invalid` (fails Zod), `transform_failure`. Confidential is a count, not a subtraction. The gate is `loaded ≥ achievable` (county-ingest-run: never gate on an exact source count).

**Publication scope (local export for the coverage SQL).** The County group emits **R accounts only**. MH, P and MN are loaded to the Query DB and listed as `out_of_scope` (on the frozen enum), so the story's `SELECT avg((latitude IS NOT NULL)::int) FROM v_property` measures exactly the D-1 denominator. Mobile homes (11,744) may matter for roofing; that is a PO choice (disagreement #6).

**Join proof (1,000 rows).** I could not find "R7" in the repo. It is not in the playbook, the spec, or ADR-0002 (whose R7 is the `county_name`/oneOf request), so this is my reading of it. Draw 1,000 Austin rows that have a `tcad_id`, using a recorded seed. For each:
- resolve geoID → pID through `tcad_geoid`;
- re-scan the raw export independently (A-03's `scanTcadSubset`) and check that the record with that pID carries that geoID in `propertyIdentification[]` as an exact string;
- report matched, `no_tcad_geoid` and `ambiguous_geoid` counts, with 0 disagreements.

Also do the reverse: 1,000 random R pIDs from the export must each have a Query DB row with an identical `request_identifier` string. The proof goes in `docs/evidence/A-04.md`.

**Kit patterns and how they show in code**
- `CountyIngest`-style Restate workflow `TcadBackbone` keyed `travis-<jobId>`, fanning out to `TcadChunk` children (`travis-<jobId>-c<N>`, about 10k records each). This is durable-workflow-builder pattern 11, with the pattern 1 backpressure window.
- Stream the 3.5 GB entry once with `zip-entry.ts` and A-03's record splitter. Write gzipped chunk files.
- Transform with a warm `TransformPool` (county-ingest-run).
- Write **one `<pID>.zip` per property**. elephant-cli `validate` and `hash` accept a directory of `.zip` children (`utils/batch-input.js listChildren`). Loose files would be about 10M files and about 40 GB on APFS.
- `Loader` virtual object keyed `travis` (patterns 8–9) merges with COPY into staging and `ON CONFLICT (request_identifier) DO UPDATE … WHERE record_sha256 IS DISTINCT FROM excluded.record_sha256`, so a re-load writes 0 rows.
- The watermark is `(track=tcad-certified, prefix, mergedCount, lastMergedAt, hashIndex[(chunk path, sha256)])`.
- AC-6: if the export is missing or its SHA-256 does not match `export_sha256`, a download attempt that gets a 403 writes a `blocked` receipt, and the workflow waits on a durable promise (`WAITING_HUMAN`, the A-01 `resolve` pattern). Test it with an injected `FetchLike` that returns 403; no network.
- CR2-10 (deferred to A-04): `probes/tcad.ts:317` re-hashes 3.5 GB on every run. Add a one-time summary (sha256, size, mtime, inode) and re-hash only when it changes.

**Pilot (25 parcels).** Seed `pipeline/local-stack/data/seeds/travis-pilot.csv` through `pilot/build-seed.ts`. Include geoIDs `0208011301` and `0223120506`, plus at least one each of:
- P, MH and MN accounts;
- a confidential account;
- an A4 with no export point (condo);
- several improvements;
- no dated sale;
- out-of-area, regional and foreign mailing addresses;
- a shared geoID;
- no year built.

Run it through the same workflow (`jobId pilot-20261022`), then `elephant-cli validate` on the 25 zips, then load. The build-county-transform coverage report must list every mapped field (AC-1).

**Files (G-TCAD only)**
- New: `travis/tcad/{export-stream,redact,fields,account-class,write-group,join-proof,pilot-select}.ts`, `pipeline/local-stack/services/workflows/tcad-backbone.ts`, `pipeline/local-stack/services/tracks/tcad.ts`, `pipeline/local-stack/migrations/0101_tcad.sql`, tests under `pipeline/oracle-runtime/test/tcad/`.
- Edited: `travis/transforms/{tcad-county,shared-seed}.ts`, `travis/pilot/{build-seed,capture-tcad-subset}.ts`, `travis/discovery/probes/tcad.ts` (CR2-10).

**Risks**
- Unknown confidentiality key names (handled by the strict key inventory).
- The A4 meaning.
- Owners with no dated sale cannot appear in frozen `v_property`, because owners link to the latest dated sale. They stay in the Query DB with `no_dated_sale` (disagreement #5).
- Disk (§6).

**Verification**
- Unit tests on real byte fixtures cut from the pilot records: redaction, the year-built rule, tenure, `ownerArea`.
- Reconciliation SQL: seed folios = ready + dead + invalid; distinct folios = 493,246.
- `monitoring-county-ingestion` reports complete.
- The join proof.

## 2. Part GIS (G-GIS), AC-7 to AC-11

**Runner (D-2).** New `.github/workflows/a05-us-gis-pages.yml`:
- Trigger: `on.push` to `004-property-backbone`, with `paths` limited to that workflow file and `travis/gis/runner-config.json`.
- `permissions: contents: read`, `concurrency: gis-pages`, no secrets, `timeout-minutes: 90`.
- Log the egress country (`loc=` only, as in A-01).
- `npm ci` in `pipeline/oracle-runtime`, then `tsx travis/gis/runner-fetch.ts`.
- Upload `out/` as an artifact with 7-day retention.
- It is fetch-only: no transform, no Query DB, no publish. Set `if: false` after the full run.

Two pushes:
1. `mode: "pilot"`: layer metadata `?f=json` (fields, `maxRecordCount`, ObjectId field, `supportsPagination`, `editingInfo.lastEditDate`), count, ids, and 1 page.
2. `mode: "full"`.

Each needs PO approval, as in A-01. Because the fork is public, artifacts are downloadable by any logged-in GitHub user, so request **minimal `outFields`** (OBJECTID, the pID field, the geoID field) and never owner columns. The operator pulls the artifact with `gh run download`.

**Getting points without editing vendored files.** `runner-fetch.ts` calls the vendored `createArcgisFeatureServiceAdapter(jurisdiction, { client })` and its `enumerateAll({ pageConcurrency: 2, loadPageCheckpoint, onPage })`. Config: `bulkPageSize: 2000` only if `maxRecordCount ≥ 2000`, `bulkConcurrency: 2`, `parcelField: null`, `fieldMap: { parcelIdentifier: <pID field> }`.

The injected `travis/gis/geometry-client.ts` implements `json(url)`. **Only on the `objectIds=` page queries** it sets `returnGeometry=true`, `outSR=4326`, `geometryPrecision=7` and the minimal `outFields`. Count and ids queries pass through unchanged. It sends every request through `travis/lib/source-client.ts`: project User-Agent, 1 s / 60 s / 5 attempts with full jitter (AC-11; the kit `PermitHttpClient` allows only 4 attempts with an 8 s cap and is bypassed), and StopOnBlocked. It writes each raw body plus receipt (url, status, bytes, sha256, captured_at) **before** returning, keyed by the page's `objectIdsSha256`.

The kit still does the snapshot, page reconciliation and drift refusal (`arcgis_source_drift`). We ignore its `records` and read our raw pages. Record this seam use in VENDORED.md.

Risk: 2,000 objectIds in a GET is about 14 KB of query string, and an IIS front end may answer 414 or 404. If the pilot shows that, lower `bulkPageSize` (still ≤ 2,000) rather than rewrite to POST.

**Resume (AC-11).** On the runner, `onPage` writes `checkpoints/<pageKey>.json`. `actions/cache` restore and save (`if: always()`, key = snapshot sha) lets a re-run skip completed pages through `loadPageCheckpoint`; the kit checks the snapshot and objectIds digests. A 403 or challenge stops the run and is never retried. Timeouts after 5 attempts give `status: blocked` with the timestamp, the partial pages are uploaded, and there is **no** `complete.json`. Locally, `GisImport` refuses to report coverage as complete without `complete.json` (no partial coverage published as complete).

**Points: centroid or interior point.** `travis/gis/points.ts` (pure, tested):
- area-weighted shoelace centroid over all rings, with holes subtracted;
- point-in-polygon test; if inside, `point_method = centroid`;
- otherwise polylabel (pole of inaccessibility, precision 1e-7°) on the largest outer ring, giving `interior_point`;
- `geometry: null` gives `gis_null_geometry`.

Planar maths in EPSG:4326 is fine at parcel scale. Both methods publish as `gis_centroid` (frozen), and the interior-point count goes into limitations. Several features for one pID (split parcels): take the largest-area feature (tie: lowest OBJECTID) and count the others. A permit point more than 0.5 mi from the GIS point keeps the GIS point and is flagged for review.

**Coordinate ranking (`travis/gis/assemble-coordinates.ts`, runs after permit linking):**

| Rank | Rule (internal `coordinate_rule`) | Public `coordinate_source` |
| --- | --- | --- |
| 1 | GIS feature joined by **exact-string pID** (fallback: geoID, if the layer has no pID field; then accounts sharing a geoID share the parcel point by rule) | `gis_centroid` |
| 2 | TCAD export point (what A-02 already publishes as `gis_centroid`) | `gis_centroid` |
| 3 | Condo or shared-geoID unit takes its building's point (`condo_building_point`), by a recorded rule. Candidates: a GIS or export point on the same geoID; a master account identified by an official key. Austin's `condominium` flag is only a hint. | `gis_centroid` |
| 4 | `permit_point`: the property's linked Austin permits, mode point at 6 decimal places, tie broken by latest `issue_date` | `permit_point`, Query DB only until fact 4 is fixed (disagreement #2) |
| 5 | null with internal reason `no_gis_feature` / `gis_null_geometry` / `no_permit_point` | publicly `no_coordinates` |

Never geocode an address. **Amended 2026-10-25 (PO decision, ADR 0004):** one narrow exception, an exact and unique match of the situs to the City of Austin public address-point layer may give a point (rule `address_point`, lowest priority, never over a GIS point); nothing else is ever turned into a point and no geocoding service is used.

**Count and gap.** The GIS count (373,683 in A-01, re-measured) and its gap to N are computed with the pure function from G-FIX. Page count, duration and rows per second go into evidence for `docs/source-limits.md`. Freshness comes from `lastEditDate`.

**Files (G-GIS only)**
- New: `.github/workflows/a05-us-gis-pages.yml`, `travis/gis/{runner-config.json,runner-fetch,geometry-client,points,import,assemble-coordinates,coverage-report}.ts`, `pipeline/local-stack/services/workflows/gis-import.ts`, `pipeline/local-stack/services/tracks/gis.ts`, `pipeline/local-stack/migrations/0201_gis.sql`, tests under `test/gis/` (polygon fixtures: L-shape, U-shape, holes, multipart, null).

**Risks**
- The real coverage limit is condos: about 59.7k R accounts (13.5%) lack an export point. Without a provable condo rule, R coverage is about 86–88% and D-1 fails.
- GIS field names are unprobed.
- The URL-length risk above.

**Verification**
- AC-7: `0208011301` has a point with the GIS layer URL, `captured_at` and page sha256.
- The coverage SQL over the local `v_property` matches the Query DB count.
- A gap report by reason.
- Resume test: kill the job mid-run, re-run, and resumed pages are skipped.

**If D-1 or D-2 differ.**
- D-1 with denominator = all N: 99% is unreachable (51,285 non-land accounts), so report it as a fail rather than reshape the data.
- D-1 without the condo rule: about 86–88% of R; reword AC-8 to "R accounts with their own land parcel" and count condos separately.
- D-2 with no runner: GIS is `blocked` (AC-11 path). Ranks 2–4 still give about the same coverage, because export points cover almost the same parcels, but AC-7's GIS-layer provenance fails and the DEC-A-01 "sampled join" is not done.

## 3. Part permits (G-PERMITS), AC-12 to AC-17

**Grow A-03 through seams (AD-17).** `socrata.ts` is a per-permit GET design. At 1 request/s, 2.38M GETs would take about 27 days, so leave it in place for run-month and add a new `travis/adapters/socrata/socrata-pages.ts`:
- keyset pages `$select=*,:id,:updated_at,:created_at`. The spike's receipts show `$select=:id,*` returns **400**, so system fields go after `*`.
- `$order=:id`, `$where=:id > '<last>'`, `$limit=50000`, ≤ 1 request/s, no app token, StopOnBlocked.
- Reuse `datasetUrl`, `POLITENESS`, `pickPermitRow` and the source-client backoff.
- `austin-3syk-w9eu.ts` gains the page config (select list and the volatile-field list).
- Following county-permit-adapter, the harvester writes only artifacts and status (`raw/pages/page-NNNNNN.json.gz` with the digest over the decoded bytes, `receipts.jsonl`); the `Loader` merges.

**Restate `AustinPermits` workflow** keyed `austin-3syk-w9eu-<mode>-<runId>`:
- One `ctx.run` per page. It returns only `{lastId, sha256, rows, maxUpdatedAt}`, never the body, to keep the journal small.
- AC-17 resume is journal replay: the incomplete page is fetched again and completed pages are not.
- 429 or 5xx back off 1 s / 60 s / 5 attempts. A page is never skipped: the next `$where` comes only from the journaled `lastId`.

**Watermark and count at the watermark (AC-12).**
- Before paging: `count(*)`.
- After paging: `W = max(:updated_at)`, then `count(*) where :updated_at <= W` and the total again.
- Pass: captured rows with `:updated_at ≤ W` = source count at W. Rows above W are counted separately.
- If the start and end totals differ, run a key-set diff (below).

**Content digest (`travis/permits/content-digest.ts`).** sha256 of the JCS of the row **without** `:`-prefixed system fields, `:@computed_region_*`, and the time-relative derived columns **`issued_in_last_30_days`** (seen in the spike page) and `day_issued`. Those change with the calendar and would mark rows "changed" every day. Keys are sorted; absent keys stay absent. Each row also stores `page_sha256` and `row_index`, pointing to the exact bytes.

**Re-stamp detector (AC-16, `travis/permits/restamp.ts`).**
- Incremental window = `:updated_at > watermark`.
- Rule: window count ≥ 50% of total, **or** ≥ 90% of window rows fall inside a 6 h span. Then it is a source-wide re-stamp.
- Response: page the whole set by `:id` (about 48 pages, about 16 min), compare content digests, upsert only changed rows, and record the limitation "source bulk re-stamp; delta by content digest".
- Unit test from a fixture modelled on the 2026-10-19 event.

**Upsert key.** The permit is `(jurisdiction_key='austin', permit_number)`, matching the story and the stable lexicon id. Every source row is kept in `permit_source_row` keyed `(source_key, :id)`. The current row comes from A-03's `pickPermitRow` (identical rows, or latest `:updated_at` then canonical JSON); duplicates are counted.
- SQL: `ON CONFLICT … DO UPDATE … WHERE content_sha256 IS DISTINCT FROM excluded.content_sha256`.
- History lives in receipts and source rows.
- `jurisdiction_key` is the **issuing** jurisdiction. The `jurisdiction` column is the location: Lakeway (6,825) and Pflugerville (1,117) stay Austin-issued.

**Tombstones (`travis/permits/keyset-diff.ts`).**
- On every full page-through, and weekly with `$select=:id,permit_number` (about 48 light requests), diff against the Query DB.
- `:id` gone and `permit_number` gone: write a `source_removed` tombstone (run_id, first_missing_at, evidence page sha) and downgrade the row; never delete it silently.
- `permit_number` present under a new `:id`: record a re-key, not a tombstone.
- The Loader consumes tombstones atomically with the watermark (query-db-loading-matching).

**Linking (`travis/permits/link.ts`, AD-16; match method, version and confidence recorded).**

| Case | Result (`method`) |
| --- | --- |
| `tcad_id` equals exactly one **R** geoID | linked (`geoid_unique_r`) |
| Shared geoID (more than one R) | linked only if exactly one candidate's situs signature equals the permit's (`geoid_plus_address`); else unlinked, kept (`ambiguous_geoid`) |
| No `tcad_id` | address fallback over all R, exact address signature, unique only (`address_sig_v1`) |
| Otherwise | unlinked, reason `no_tcad_geoid` / `no_address_match` / `ambiguous_address` |

The address signature is the vendored kit `core/address-signature.mjs` (`address:v1`; kit rule: no ROAD→RD expansion), using `original_address1`, `original_zip`, `original_state` and unit against the TCAD situs fields.
- Out-of-county: no TCAD match **and** `original_zip` not in the gazetteer's Travis ZCTAs, giving `outside_travis`. These are counted separately, not dropped (AC-12).
- Contractor fields stay in the raw payload only; no contractor row is written (A-07, AD-06).

**Classification (AC-14).** Only `profiles/travis-austin@1.0.0` decides; `classify-run.ts` imports it. `status_raw` and the expiry date stay in the Query DB, because they have no lexicon carrier. `open_days = as_of − issue_date` for open and stalled; a null issue date gives null with internal reason `no_issue_date` (public `needs_review`). Report against the 2026-10-19 baseline with deltas. 1982-012866 BP must read Suspended / open.

**Other jurisdictions (AC-15).** A-01 classes 22 of 23 as records-request or no public history, so no kit vendor module applies. `jurisdictions-report.ts` lists each with its evidence URL from `travis-sources.yaml` and `profiles/jurisdictions.ts` in the run's source limitations.

**Spike pages in `pipeline/data/raw/austin-full/`.** Their origin is known. ADR-0001 read-path spike (A-03 Stage 2S), `spikes/read-path/capture/capture.ts`, captured 2026-10-20 23:57–00:13Z (user agent `countylens-spike/0.1`), 48 pages, 2,380,939 rows, with `receipts.jsonl` and `summary.json`.
- **Do not use them as the backfill of record.** They have no `:updated_at` (field inventory checked), so there is no per-row watermark. They were captured under the spike's identity, not this story's adapter or workflow, and against a different count than the one at the run watermark.
- Allowed uses: after checking each file's sha256 against `receipts.jsonl`, offline as the dev fixture for the page parser and digests; and as a real baseline to show "delta by content digest" (diff by `:id` against the new capture).
- **Re-capture** with the new adapter: about 16–20 min, about 50 requests. After that, ask the PO before deleting them and `austin-parquet/`; that frees about 5.1 GB.

**Files (G-PERMITS only)**
- New: `travis/adapters/socrata/socrata-pages.ts`, `travis/permits/{content-digest,restamp,keyset-diff,link,classify-run,jurisdictions-report}.ts`, `pipeline/local-stack/services/workflows/austin-permits.ts`, `pipeline/local-stack/services/tracks/permits.ts`, `pipeline/local-stack/migrations/0301_permits.sql`, tests under `test/permits/`.
- Edited: `travis/adapters/socrata/austin-3syk-w9eu.ts`.

**Risks**
- 97% may not be reached: 508 rows have no `tcad_id` (2.3%) and some geoIDs are shared, so the address match carries the margin.
- `:id` may not be stable across a dataset replace (a re-key, not a tombstone).
- Rows inserted during paging with `:id` below the cursor (caught by the totals check plus the key-set diff).

**Pilot.** The same workflow with `maxPages: 1`. Then load, link the 50k rows, run a replay test (kill services mid-page; replay writes 0 duplicate rows), and run the re-stamp detector against the fixture.

## 4. Part G-FIX (runs first, wave 0; owns every shared file)

**The three A-01 fixes**
- **CR2-8** (`source-client.ts:784`, `refusal()`): `bodyBytes = advertisedLength(headers)` is the *encoded* length under `content-encoding: gzip|br`, because fetch decodes the body. When the encoding is not `identity`, set `bodyBytes = excerpt.byteLength` with `body_bytes_basis: "decoded_excerpt"` and keep `content_length_encoded` as its own field. Tests: gzip headers fixture and identity fixture.
- **OR-N8** (`WAF_BODY`, line 289): `\brequest (?:has been |was )?blocked\b` also matches small 2xx Socrata pages whose description says "REQUEST BLOCKED" (bodies ≤ 8 KB are checked). Tighten it to require a firewall noun: `\b(?:mod[_ ]?security|web application firewall|waf)\b` or `request (?:has been |was )?blocked by (?:mod[_ ]?security|the (?:web application )?firewall|waf)`. Keep it fail-closed on non-2xx. Tests: San Leanna 406 page (still blocked), small JSON page containing "REQUEST BLOCKED" (not blocked).
- **CR2-9** (`record-gis-runner.ts:278`): export a pure `gapPercent(roll: number, gis: number): number | "unknown"` from `probes/arcgis.ts`. `computeGap` calls it, and `gapPct` calls it directly. The `example.invalid` placeholders are removed, and G-GIS imports the pure function.

**Seams (so the three other groups share no file)**
- `services/app.ts`: auto-register every `services/workflows/*.ts` that exports `createService(restate)`.
- `services/loader.ts`: `Loader` virtual object `travis`, single writer, loading every `services/tracks/*.ts` plug-in. Raise `inactivityTimeout` and `abortTimeout` for multi-minute COPYs (durable-workflow-builder rule 3).
- `migrations/0000_core.sql` (watermarks, tombstones, receipts) and `services/migrate.ts`.
- Both `package.json` files (scripts; `@dsnp/parquetjs`).
- `.gitignore`: add `pipeline/data` without the trailing slash, and `pipeline/local-stack/data`.
- `kit/VENDORED.md` plus the vendored files: `use-oracle/runtime/src/permits/{adapters/arcgis-feature-service,contracts,backfill-inputs,normalization,http,errors}.mjs` and `core/address-signature.mjs`.
- Order: G-FIX merges into the story branch first, then G-TCAD, G-GIS and G-PERMITS build in parallel. Cross-group use is by import or SQL read only.

**Not owned by any builder group:** `docs/evidence/A-04.md`, `docs/source-limits.md` and the `travis-sources.yaml` re-counts. The lead writes them in Stage 6.

## 5. Order of local runs and realistic durations

| # | Step | Duration |
| --- | --- | --- |
| 0 | G-FIX merged; migrations; stack up | — |
| 1 | Pilots: TCAD 25 | about 10 min (one export scan) |
| 1 | Pilots: Austin 1 page | about 2 min |
| 1 | Pilots: GIS runner, pilot mode | about 5 min plus PO approval |
| 2 | **Austin full backfill** (network-bound, needs no roll) | 25–45 min |
| 3 | **TCAD full load** to Query DB | 30–60 min |
| 3 | Per-pID zips | 15–30 min |
| 4 | GIS full runner (remote, can overlap 2–3) | 20–40 min |
| 4 | GIS import | 5–10 min |
| 5 | Link permits, assemble coordinates, coverage, join proof | 15–30 min |
| 6 | Local County-group `validate` → `hash --output-car` → `validate` CAR → `export-tables` (no upload), then the coverage SQL | **2–5 h** (measure one 10k chunk first and project; this is the largest unknown) |
| 7 | Next-day incremental Austin run (watermark, re-stamp check, key-set diff) | about 20 min |

Total: about 4–8 h of run time plus the pilots.

## 6. Disk budget (24 GiB free; guard: every step stops below 5 GiB free)

| Item | Estimate |
| --- | --- |
| Austin raw pages, gzipped | about 0.7 GB (3.6 GB uncompressed) |
| GIS pages, gzipped | about 0.4 GB |
| TCAD chunk staging, gzipped NDJSON | about 0.6 GB, deleted after merge |
| Postgres volume (permits with jsonb about 3 GB, properties, owners, sales, indexes) | 4–6 GB (Docker.raw does not shrink) |
| County per-pID zips | 2–4 GB |
| Hashed zips | 2–4 GB, deleted after the CAR validates |
| CAR | 2–4 GB |
| Tables | about 0.3 GB |
| **Peak** | **about 15–20 GB** |

Do not run the full Property Improvement group locally in A-04; that is A-11. Free the spike data (5.1 GB) with PO approval before step 6.

## Disagreements

| # | Topic | Story / ARD says | Oracle recommends | Why |
| --- | --- | --- | --- | --- |
| 1 | Missing reasons for coordinates and open days | AC-10 `no_gis_feature`/`gis_null_geometry`/`no_permit_point`; AC-16 `no_issue_date` | Keep them as **internal** Query DB and gap-report sub-reasons; published `missing` uses `no_coordinates` / `needs_review` | `contract/v1/README.md` closed list; D-9 (frozen contract wins) |
| 2 | `permit_point` in published data | AC-9: property gets `coordinate_source = permit_point` | Keep permit points in the Query DB until `views.sql:154` reads the geometry's `source_http_request` host. That is an additive derivation fix in `packages/query-core` and needs a PO call on v1 or v2. Otherwise a published permit point is labelled `gis_centroid`. | P0-11; `derive.ts:112` gets `NULL` permit coordinates |
| 3 | Confidential accounts in AC-2 | "loaded = N − dead/invalid − confidential" | Confidential accounts are **loaded** with owners redacted. Count them; do not subtract them. | P0-15 covers owner fields, not the parcel; subtracting would hide real parcels from the backbone |
| 4 | AC-3 out-of-area owners | `owner_is_out_of_area = true`, `regional`/`out_of_area` on the property | Prove it in the Query DB only. v1 publishes `unknown` / `not_in_export` until ADR-0002 R7 is addressed. | Mailing ZIP is `not_in_export` (contract README "Location") |
| 5 | Owners without a dated sale | README: "linking without a sale is deferred to A-04" | Do not create undated `sales_history` records. Keep these owners in the Query DB; public reason `no_dated_sale`. | Frozen `owner_name` derives from the latest **dated** sale; inventing a sale would change its meaning |
| 6 | Which accounts are published | "every Travis County parcel"; D-5 loads every type | Load all 4 types; emit **R only** in the County group (MH, P, MN `out_of_scope`) so the story's coverage SQL measures the D-1 denominator. PO to decide whether mobile homes (11,744) should be included. | D-1 denominator; SQL as written covers every emitted row |
| 7 | GIS primary vs export point | AC-7/8: GIS centroid primary, permit fallback | GIS first, **TCAD export point second** (already frozen as `gis_centroid` by A-02), then the condo rule, then the permit point | Export points cover about the same parcels; the real gap is condos (DEC-A-01) |
| 8 | Condo meaning | DEC-A-01 reads A4/F4 as condo units | Resolve the A4 conflict with an official code table before relying on it. The code (`shared-seed.ts`) maps A4 → `Townhouse`. | Either the property type or the gap explanation is wrong |
| 9 | Kit ArcGIS adapter "through seams" | Story/AD-17 imply it is available | Vendor it plus 5 dependencies plus parquetjs. Get geometry through an injected `options.client` (documented request rewrite), not by editing kit files. | It is not vendored; it hard-codes `returnGeometry:false` |
| 10 | Spike Austin pages | (unstated) | Not the backfill of record; re-capture. Reuse only as fixture and digest baseline after checking sha256. | No `:updated_at`; spike identity; different watermark |
| 11 | Raw payload in the Query DB | Kit: "preserve full source_payload" | Store the TCAD payload **redacted**, plus the sha256 of the original bytes | AC-5 "no confidential owner name reaches the Query DB export path" |
| 12 | Story order vs kit order | Kit county-ingest-run: official registry before permit harvest | Accept: Austin capture writes no contractor (AD-06; ARD §8 "before contractor resolution"). Record it as an explicit note in the plan. | The kit rule protects contractor identity; there is no resolution in A-04 |
| 13 | Gitignore | `.gitignore` covers `pipeline/data/` | Add `pipeline/data` and `pipeline/local-stack/data` (no trailing slash) in G-FIX | They are symlinks in this worktree and show as `??` (P0-17 hygiene) |
| 14 | ZIP lists (D-6) | "versioned ZIP lists in git with URL + SHA-256" | Already done: reuse `travis-places@1.0.0` (`owner-area.json`, `sources.json`, `GAZETTEER_SHA256`) and add nothing new | Two list versions would create two digests (AD-26) |
| 15 | "R7 join proof" | (walkthrough term) | I could not find R7 in the repo. My reading is the 1,000-row geoID→pID proof plus its reverse, as in §1; please confirm. | No definition in the playbook, spec or ADR-0002 |

---

## Lead notes (Stage 0 export read, 2026-10-21 19:08Z; not oracle's words)

- **No owner-level §25.025 flag exists in the JSON** (full key scan). Only `sales[].confidentialCode` (Q ×15,874, O ×6 on 15,410 R) and `sales[].confidentialSale` (always 0). `owners[].confidentialCode` does not exist. The legacy-layout fallback needs legacy data that is not on disk. → Round 1 D-7.
- **Anchor `0208011301` is in no field of the export**; `0223120506` → pID 221829. → Round 1 D-4.
- **Every record has a non-empty `geometry` string** (all 441,961 R), against 380,461 in `travis-sources.yaml:68`; G-TCAD resolves the definition (oracle's fact 3 assumed ~86% R with a point).
- Year built: `propertyProfile[0].imprvActualYearBuilt` (0 when missing) and `valuations[].details["cost-local"].improvements[]` (there is no main flag); R with no year built 52,521.
- Sale: `sales[].saleDt`; no sale date 317,818 (R 266,553). Mailing: `owners[].addrZip`, `addrCountry`, `addrInternational`.
- R7 settled: Austin `tcad_id` = TCAD `geoID` (oracle disagreement #15: same reading).
