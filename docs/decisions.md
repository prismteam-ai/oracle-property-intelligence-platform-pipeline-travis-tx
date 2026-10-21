# Architecture decisions — Travis County, TX pipeline

Fixed on 2026-10-16 before implementation, revised the same day, and corrected the same day after the kit's
`oracle` agent reviewed sections 2–7 and 13 and the API contract against the kit's conventions
([`reviews/2026-10-16-oracle-conventions-review.md`](./reviews/2026-10-16-oracle-conventions-review.md)).
`README.md` is the spec and is never edited; this file records how it is met. Change it only by adding a dated
entry at the end; the one in-place rewrite is that 2026-10-16 correction, applied before anything was built and
itemized in section 14. Before the PR is marked ready, a dated closing entry records what was delivered against
this plan and what was not. The API shared with the CRM is in [`api-contract.md`](./api-contract.md).

## 1. Roles and repositories

- The candidate acts as **Oracle** (county onboarding, ingestion, lexicon validation, IPFS publication through
  the kit) and as **builder** (hosted API, MCP, agent, explorer).
- This repository owns ingestion, publication and the hosted query layer. The
  [roofing-crm](https://github.com/prismteam-ai/roofing-crm) only consumes the API and never ingests.

## 2. How the kit is used

- Built with the [soofi-xyz-team-kit](https://github.com/soofi-xyz/soofi-xyz-team-kit) run as its Claude Code
  plugin (kit v0.99.1, commit `99c7bff`). The kit is used as a product: not copied into this repo, no core
  changes; the Travis county modules live on a kit branch, which is the path the kit prescribes (section 3).
- Agents: `arceus` (routing), `oracle` (onboarding, ingestion, validation, `elephant-cli` publication), `mew`
  (lexicon modeling), `metagross` (hosted layer), `slowking` (self-assessment). Skills: `onboard-county`,
  `county-discovery`, `county-readiness-preflight`, `county-seed-data`, `county-appraisal-onboarding` (as the
  reference for wiring the appraisal source; the capture itself is bulk, see section 3), `county-permit-adapter`,
  `build-county-transform`, `query-db-loading-matching`, `county-ingest-run`, `bbb-harvest`, `use-oracle`,
  `build-rag-systems` and `build-ai-agents` (the agent), `apply-engineering-guidelines`, `guide-product-work`,
  `evaluate-candidate-*`.
- Design reviews before implementation, read-only, by kit agents in this order: `oracle` (kit conventions, done
  2026-10-16), `mew` (lexicon modeling), `alakazam` (retrieval design), `metagross` (hosted layer); `slowking`
  self-assessment after hosting. Each review is recorded under `docs/reviews/` and its corrections are applied
  to this file and to `api-contract.md` before the next review starts.
- Work follows `guide-product-work`: feature increments, each run and inspected by the operator before the
  next. The kit sets **at least four increments as a floor** for a full build, never a target. The kit's product
  catalog has no `iterationGuide` for Oracle, so the capability map is `onboard-county`'s stage order plus the
  README's acceptance criteria; it yields the ten increments below, each a user-visible capability with a stable
  id, its dependencies and one acceptance check. `county-ingest-run`'s numbered run stages (pilot, feasibility
  gate, full run, ramp-up, failure handling, streamed load, redrives, wrap-up) are the procedure inside T2–T5,
  not increments of their own. Progress is kept in `docs/progress.md`, one row per increment (`pending`,
  `prepared`, `observed`, `verified`); for the local-Restate increments the inspection checkpoint is the Restate
  UI and the validator or run-record JSON, and AWS inspection applies from T7.
  1. **T1 Readiness** (`county-discovery`, `county-readiness-preflight`, `county-seed-data`; no dependency):
     `travis-sources.yaml` with every jurisdiction classified, the records requests, the approved exceptions,
     the privacy classification of the permit contact fields and the BBB access request; the seed script and
     its row count. Check: the validator prints `PASS` with `seed_allowed` true.
  2. **T2 Appraisal transform and appraisal-only pilot** (`county-appraisal-onboarding`,
     `build-county-transform`, `county-ingest-run`; after T1): bulk capture materialized per parcel, one parcel
     through `Parcel.process`, field-coverage and validation proof, the ~25-parcel pilot run with the
     `__NONE__` eligibility sentinel (no permit harvest yet) and per-source timings. Check: `elephant-cli
     validate` clean on the pilot `county` group, pilot timings in the run record.
  3. **T3 Official identity baseline** (`onboard-county` stage 6; after T1): the Comptroller file loaded as
     registry candidates under the SOS approved exception; the TDLR and TSBPE licensing snapshot for the
     trade-permit rows that print a license number, or the recorded operator decision to proceed without one
     (Texas issues no roofing license; whether the Socrata export prints a license number is checked in
     discovery). Check: snapshot counts and freshness in the run record; no `PermitFeed` has started.
  4. **T4 Permit profile, permit pilot and feasibility** (`county-permit-adapter`, the
     `query-db-loading-matching` link rules; after T2 and T3): the Socrata harvester, the Travis permit
     profile (status, lifecycle and work-class mappings with fixtures, the `geo_id` link proof), the pilot
     re-run with `__ALL__` to exercise the permit, permit-less and failure paths, then the 1,000-parcel
     feasibility run with the 48-hour projection. Check: fixtures pass; link-method counts and the projection
     in the run record.
  5. **T5 Full run, reconciliation and signals** (`county-ingest-run`, `query-db-loading-matching`, the
     roof-age estimator; after T4): the backpressure-aware full run, Loader watermarks and tombstones,
     roof-age estimates, evidence-state counts, `runs/<run_id>.json`. Check: `seed = ready + dead + invalid`,
     counts per table, limitations listed.
  6. **T6 Publication, run 1** (`use-oracle`; after T5): per group validate → hash → validate CAR →
     export-tables → upload with readback; manifest, second pin, gateway checks, Atlas PR. Check: every root
     fetched from two public gateways with matching digests; the Atlas PR URL recorded.
  7. **T7 Hosted query layer** (`metagross`; after T6): the deploy-time DuckDB from the uploaded tables, the
     Lambda with REST `v1` and MCP. Check: `/v1/openapi.json` equals the committed file, one MCP tool call answers,
     the cold first request of each function lands within its budget, one `429` from the chat route and one alarm
     transition are seen, all traced in the Lambda and HTTP API access logs by `apigw-requestid` (section 21).
  8. **T8 Explorer** (after T7): the static explorer with its Verify action and query panels. Check: the
     README demo transcript steps 1–7 on the live URL, a live two-gateway Verify and a DuckDB-WASM range read;
     CloudFront and S3 inspected (section 21).
  9. **T9 Agent** (after T7): the Bedrock agent behind `/v1/agent/chat` with the `v1` tools. Check: the golden set of section 20,
     replayed under SAM local and then on AWS, passes its hard gates; Lambda, Bedrock and LangSmith traces inspected. Kept separate
     from T8 because it is a different concept with a different inspection point.
  10. **T10 Incremental refresh** (`continuous-ingestion`; after T6, demonstrated after T7): the windowed
      delta capability: change detection per source watermark, tombstones, the stale-snapshot queue, new group
      roots and multi-run history, shown by run 2. Check: a non-zero delta, both runs in `/v1/runs`, the old
      roots fetched again from both gateways.

## 3. Ingestion runtime

- The kit's Oracle runtime (`skills/use-oracle/runtime`; section 15 corrects this bullet: at `99c7bff` the shipped
  runtime is the `elephant-county` CLI, and Restate + Postgres via Colima is a v2 decision) runs **on demand
  for the ingest job only** and is shut down once the run has reached a terminal state under the Restate
  coordinator. Oracle carries no standing infrastructure.
- Travis County is a **new county adapter** in that runtime (`adapter`, `seed`, `permit-profile`,
  `query-table`, `validate`, enrichment profile), developed on branch `travis` of a kit checkout pinned at
  `99c7bff`. The adapter sources, the findings, `skills/use-oracle/runtime/docs/travis-sources.yaml`, the Texas
  contractor-identity note, the seed-producing script and a replay fixture under 1 MB (`fixtures/travis-replay/`,
  with a few-row `seed.csv`) are **mirrored into this repository under `oracle/travis/`** with a script that
  copies them into a kit checkout, so a reviewer can rerun from this PR. The full seed CSV, captures, hashed
  output, CARs and Parquet are never committed, here or in the kit. At `99c7bff` the runtime's `.gitignore`
  does not cover `data/` (`bootstrap-oracle-infra` describes it as ignored, but `git check-ignore` matches
  nothing), so the first commit on the `travis` branch adds `data/` to `skills/use-oracle/runtime/.gitignore`
  and the kit's clean-room gate is the proof; tracked runtime files stay under 512 KiB. The county transform is also offered as a PR to the public
  [elephant-xyz/Counties-trasform-scripts](https://github.com/elephant-xyz/Counties-trasform-scripts) repository,
  as the kit prescribes; its merge depends on that repository's maintainers and this submission does not wait for it.
- **Bulk-first capture.** The kit's default appraisal path captures one appraiser page per parcel. For Travis
  the bulk files are the captured sources: the TCAD appraisal export rows, the TNR parcel layer features, the
  Socrata permit export and the Comptroller file. The adapter's capture step materializes one per-property
  input per parcel from those rows, so the kit's per-property transform, validate and hash flow runs
  unchanged. Provenance is the kit's: every entity carries `source_http_request` describing the bulk-file GET
  that was actually made (method, URL, query; never reconstructed after the fact) and `request_identifier` =
  `PROP_ID` as printed; the row locator and fetch time ride in the run record. For `property_improvement`
  entities the `source_http_request` is the Socrata export GET that was actually made and `request_identifier`
  stays the linked parcel's `PROP_ID`: the seed row's request is the default for every entity of that parcel,
  and the export GET is recorded because it was made, never reconstructed. `travis-sources.yaml` records
  "bulk" as the appraisal access method and the publication rights of the TCAD, Socrata and Comptroller files.
  One parcel is still run through the runtime's `Parcel.process` to prove the per-property flow. No per-parcel
  appraiser-page capture unless a required field is absent from every bulk source, and then only for the
  parcels that need it.
- **Readiness gate.** `county-readiness-preflight` validates `travis-sources.yaml` after discovery and again
  immediately before seed, before the pilot and before the full run. A BLOCKED gate stops seed, pilot and full
  ingest, not preparation. The entries Travis needs to pass are named in sections 4 and 13.
- **Identity baseline, pilot, feasibility, full run.** First the kit's pilot: about 25 representative parcels
  (commercial and residential, with and without permits) through capture, transform, validate, hash and load,
  run appraisal-only with the `__NONE__` eligibility sentinel before any permit harvest, verifying the
  residential-skip and failure paths and recording per-source latency, safe concurrency and failure rate.
  Permits are never harvested before the official identity baseline is loaded (section 2, T3; the kit forbids
  harvesting first or in parallel). With the baseline loaded and the adapter built, the pilot is re-run with
  `__ALL__` to exercise the permit and permit-less paths. Then the feasibility increment: 1,000 parcels and
  their permits through the same stages, recording rows per minute per stage and the projected full-county
  duration against the kit's 48-hour gate. The lexicon `property_improvement` scope is set from those numbers.
  Every permit row is loaded into the internal Query DB for reconciliation, but only a permit that links to a
  parcel can be published at all (an archive is property-rooted), and the hosted API serves exactly the
  published `property_improvement` scope: unlinked and excluded permits appear as counts and limitations,
  never as rows. `property_improvement` records start with building permits that link to a parcel and widen
  only if the measured throughput allows it before the publish deadline. While any permit class is excluded
  the group's availability is typed `supported_partial`, with the excluded classes and their counts in the
  run record.
- No rebuild of Oracle from scratch, no replacement of Restate by Step Functions, no generated records.

## 4. Sources (seed list; `county-discovery` verifies, extends and records the evidence)

Probed from outside the US on 2026-10-15/16 unless noted. **First act of discovery:** switch to US egress and
confirm the TCAD export, the TNR parcel layer and data.texas.gov all answer, before anything else is planned.

| Data | Source | Status |
| --- | --- | --- |
| Permits | City of Austin "Issued Construction Permits", Socrata `3syk-w9eu` on data.austintexas.gov. 2,380,323 rows; 65,392 mention roof, 33,340 of those are building permits (`BP`) spanning 22,401 distinct `tcad_id`; daily updates (latest `applieddate` 2026-10-14). Covers Austin full purpose, its ETJ and several small cities, not unincorporated Travis. `tcad_id` is the TCAD **Geographic ID**. | verified, reachable worldwide |
| Permits, rest of county | Every Travis jurisdiction is enumerated in `travis-sources.yaml`: unincorporated Travis County (its development-services permit system), each municipality, the jurisdictions whose permits are inside the Austin feed (classified `delegated`) and the ETJ handling, each with a classification and a `historical_records` flag; the Austin one-stop is never marked as countywide history. Every `blocked`, `custodian-only` or `manual-only` row carries a complete `records_request` (recipient office, portal URL or email, system and date scope, `api-first` or `records-first`), filed before the full run. A block or absence is reported per jurisdiction with that request on record; a limitation note alone leaves the permit gate BLOCKED. | to enumerate and classify in discovery |
| Parcels, ownership, year built, deed/sale date | TCAD public exports at traviscad.org/publicinformation: 2026 Certified Appraisal Export (July), 2026 Supplemental Appraisal Roll Exports, Improvement Details 2026, Export Layout zip. Listed as downloads; cost not stated on the page. Both `PROP_ID` and `geo_id` are expected in the roll. If the files are paid, the purchase is a human payment decision recorded in the run record (section 13). | page reachable; the file host returns 403 outside the US (geo-block or paywall: resolve under VPN first) |
| Coordinates | In this order: (1) Travis County TNR parcel layer `gis.traviscountytx.gov/server1/rest/services/Boundaries_and_Jurisdictions/TCAD_public/FeatureServer/0` (fields include `PROP_ID` and `geo_id`, 1,000 features/request) → centroid per parcel; (2) the county GIS parcel shapefile download if the service blocks bulk paging; (3) the City of Austin parcel layer on its ArcGIS organization or data.austintexas.gov. Secondary for parcels with no geometry: permit `latitude`/`longitude`. **No geocoding, no invented coordinates.** If no source yields parcel centroids under US egress, radius search covers only permit-located parcels and that coverage number is reported as a limitation. | (1) blocked outside the US |
| Business records | Texas Comptroller "Active Franchise Tax Permit Holders", data.texas.gov `9cir-efmm` (~3M rows, filter Travis). The Texas SOS is the official corporate registry and is paid: using the Comptroller file instead is recorded in `travis-sources.yaml` as an approved exception, with the SOS purchase as a human payment decision. Comptroller rows load as registry candidates only (section 5). If they are published as a `corporate_registry` group, each company's `source_http_request` is the per-taxpayer detail GET on the Comptroller site, never the bulk file page. The API's `registry_candidates` and `registry_rows_loaded` exist only if that group is published, as a deploy-time derivation over published groups; otherwise both are empty. | portal blocked outside the US |
| Contractors | From permit rows: `contractor_full_name`, `contractor_company_name`, `contractor_phone`, address, `contractor_trade`, kept raw on the `property_improvement` record as **source-name attribution**. They are not identity: the kit treats name, phone and address matches as candidates, excludes phone from identity matching, and writes no `company`, `person` or `license` record and no `property_improvement_has_contractor` edge without an official registry or licensing match. Texas issues no state roofing license (recorded as a gap). The official authorities named in the county profile before permit harvest are the Texas SOS (corporate registry; see the row above), TDLR (electrical and HVAC licenses) and TSBPE (plumbing) for trade permits. A Comptroller exact unique normalized-name hit is a review candidate (`registry_candidates`), never identity. Official identity is null in v1 unless an official record matches. Contractor phone and address are business contact fields printed on the public permit record and are returned as printed; personal phone and email fields are not collected. That privacy classification is recorded in `travis-sources.yaml` as the kit asks and can be reversed before hosting; whether the printed contact fields enter a published record or only the hosted API depends on the open decision in section 5, since `property_improvement` has no property for them. | derived, attribution only |
| BBB ratings | bbb.org returns a bot challenge and 403 to scripted access (probed 2026-10-16 from outside the US, which the kit does not accept as evidence). Per `bbb-harvest`: one bounded probe from the approved AWS US-egress runtime (`operator_machine: false`), keep the evidence, stop on 403, no proxies, challenge evasion or third-party scrapers, and request approved access through the official API at developer.bbb.org; the request (date, scope, recipient) is recorded in the run manifest. Coverage carries `source_access_status: blocked`, `source_access_complete: false`, `incomplete_reason: http_403_source_block`. BBB fields ship as `rating: null`, `status: blocked`. | blocked, access requested |

**US egress.** TCAD files, the Travis GIS server and data.texas.gov reject non-US clients. Ingestion runs with US
egress on the operator's machine. This is a geo-restriction on public open-data portals, which the kit's
`onboard-county` intake asks about ("US egress and any login, CAPTCHA, records-request, or custodian constraints")
and `county-discovery` handles ("verify the current egress IP is in the US"); it is not bot or robots.txt evasion.
BBB is the exception: its probe and any harvest run from the approved AWS runtime, never from the operator's machine.

## 5. Canonical model and reconciliation

- Records are produced as lexicon records by the kit runtime and validated against the live lexicon before
  hashing. Classes: `property`, `parcel`, `address`, `company` and `person` (in v1 these two
  are the roll's owners in the `county` group, never contractors), and **`property_improvement`** for
  permits. The lexicon has no `permit` class: the kit's permit transform emits the `property_improvement` data
  group, whose properties include `permit_number`, `permit_issue_date` and `permit_close_date`. Links:
  `property_has_property_improvement` and `parcel_has_property_improvement`;
  `property_improvement_has_contractor` only from an official identity match (none expected in v1). The API
  calls these records "permits"; that is the product name for `property_improvement` rows.
- Identity: property = TCAD `PROP_ID` **as printed** (the kit's folio / `request_identifier`; a string, never
  normalized, leading zeros preserved; the roll prints an integer, so there are none to strip); `geo_id` kept
  as a second key as printed; permit = `permit_number` as printed; business = Comptroller taxpayer number (a
  registry candidate, not identity); owner = (`PROP_ID`, owner name as printed) from the roll. Contractors have
  **no identity** in v1: the API's `contractor_attribution_key` (hash of the printed company name and phone)
  only groups permits that print the same values and is labelled `source_name_attribution`.
- **Property ↔ permit link on `geo_id`** (the permits' `tcad_id`), never `PROP_ID`. Exact as-printed match
  first. The strip-non-digits comparison is a fallback used only after the Travis permit profile proves it
  one-to-one over the roll (no two `geo_id` values collapse) and records the normalization version; every link
  carries `match_method` (`exact` or `normalized_digits`), `normalization_version` and `confidence`; a permit
  with zero or several candidates, or a malformed `tcad_id` (`invalid_quarantined`, raw value kept), stays
  valid-unlinked (`property_id` null) with an `unlinked_reason` of `no_candidate`, `multiple_candidates` or
  `invalid_quarantined`, each counted. No digits-only value
  is ever a conflict key. Permit ↔ contractor = the printed fields (attribution). Contractor ↔ business =
  registry candidate only. No fuzzy link sets a public flag.
- Provenance on every record: the lexicon `source_http_request` and `request_identifier` (section 3), dataset
  id, record id as printed, `fetched_at`, `run_id`, and the CIDs `export-tables` writes (`record_cid`,
  `property_cid`, `data_group_cid`) plus the group's archive, tables and schema CIDs.
- **Roofing signals are deploy-time derivations, not published objects.** `roof_work_class`, `is_roofing`,
  `is_reroof`, `roof_year`, `roof_age_basis`, `roof_age_confidence`, `status_group`, `open_since`,
  `open_duration_days`, `days_since_expiry`, `owner_absentee` and `owner_out_of_area` are computed at deploy
  into the hosted DuckDB mirror (section 8) from loaded source fields, with the rules in `api-contract.md`.
  Nothing derived is uploaded to IPFS or registered in Atlas.
  - Work classification comes from the Travis permit profile: fixture-tested mappings of exact source terms in
    `description`, `work_class` and `permit_class` to the kit's classes `primary_roof_replacement`,
    `primary_roof_new_construction`, `repair_or_coating`, `accessory_roof`, `other` and `needs_review`,
    versioned as `work_classifier_version`. The regex tiers of the first draft are the seed vocabulary for those
    mappings and live in the profile's fixtures, not in query-time SQL. Unmapped or contradictory text is
    `needs_review`.
  - Roof age is computed by the kit's bundled estimator (`elephant.roof-age-estimate.v1`): the anchor is the
    completion or close date of a completed `primary_roof_replacement` (high confidence), else of a completed
    `primary_roof_new_construction` (medium), else `year_built` (low). Open permits, repairs, coatings and
    accessory roofs never reset age; no date is synthesized, so there is no `issued_date` fallback; quarantined
    or impossible dates are excluded. The estimator's anchor, confidence and caveats (partial history) are
    exposed by the API.
  - Status groups come from the profile's exact mapping of `status_current`. Any unmapped value is
    `needs_review`: excluded from the `open`, `stalled` and `closed` counts and from the open-permit signal,
    and counted under limitations. The status in v1 is the indexed Socrata value with its observation time
    (`status_source: indexed`); live detail refresh of open roofing permits is not done in v1 and is recorded
    in the permit-evidence gap ledger as a limitation of the open-permit lead decision.
  - A blank `completed_date` in the export is `unknown` evidence (a blank listing column is not a confirmed
    empty); a valid date is `confirmed_present`; an impossible date is `invalid_quarantined` with the raw value
    kept. `stalled` therefore means "expired with no completion evidence".
  - Lifecycle status for the estimator is mapped by the profile separately from `status_group`: only `Final`
    maps to `completed` and can anchor; `Withdrawn`, `Cancelled`, `VOID`, `Aborted` and `Expired` map to
    `other`, so a `closed` permit is never read as completed work.
  - The estimator runs twice with the same frozen profile: in Query DB reconciliation (the kit's internal
    lineage) and at deploy over the published fields. The Travis transform does not pass `roofAge` to the
    runner, so no `structure.roof_date` or `roof_age_years` is published, and the two runs' counts must
    reconcile.
  - Per-field evidence-state counts for `completed_date`, `status_current` and `tcad_id` are written to the
    run record and exposed by `/v1/meta`, so the basis of every `stalled` or unlinked row is countable.
  - **Decision on non-lexicon permit fields (decided by the operator on 2026-10-16; `mew` verifies the premise).** The product fields the README
    needs on a permit (`description`, the printed `status_current`, `expires_date`, the printed contractor
    fields, and therefore text search) have no `property_improvement` property: the class carries the permit
    dates, `fee`, `contractor_type`, the owner-builder and disaster flags and the enums `improvement_type`,
    `improvement_action` and `improvement_status`. The transform keeps such fields in `source_payload` as
    lexicon gaps, which `export-tables` does not write. The options, to be decided before T4 is built:
    (i) classify at transform time into the three enums, make the API's `roof_work_class` and `status_group`
    deploy-time projections of them, and list the homeless fields as lexicon gaps the hosted layer cannot
    serve (the README's contractor name and free-text search would then be unmet); (ii) have the deploy-time
    build also read the published archive blocks, if `mew` confirms that `source_payload` survives
    validate → hash into the CAR; (iii) have the deploy-time build re-read the public Socrata export for the
    non-lexicon columns, keyed by `permit_number` and joined to the published `record_cid`, with its own
    `source_http_request` and shown as source-backed but unpublished fields. Decided: (ii) if it holds, else
    (iii); never the Query DB. The `mew` review answers the factual question first, whether `source_payload`
    survives `validate` → `hash` into the archive blocks; T7's deploy-time build then reads the published
    archive (ii) or the public export (iii), and T4's profile fixtures cover both paths.
- A small deploy-time **search-center** table holds, for every distinct situs city and situs ZIP in the roll,
  the centroid of its parcels with coordinates and the parcel count. It is the only way a place name becomes a
  search center; no external geocoder is called. It is not published, and it is not the kit's `places`
  (Overture) data group, which v1 does not produce.
- At deploy, one DuckDB database file is built from the uploaded-with-readback, CID-verified `export-tables` output
  (the roots the Atlas page entry carries; the Atlas merge is not a dependency; never the Query DB): every published table loaded, the derived tables above, plus a full-text index
  over building permits' `description`, `permit_class` and `work_class` that backs `/v1/permits/text-search`
  (which source supplies those non-lexicon columns is the open decision above).
  The file is stored in S3 beside the Parquet mirror, downloaded once per Lambda instance into ephemeral storage
  (sized to the file, 2 GB) and reused across warm invocations, so queries never range-read S3 per request. It
  is a deployment artifact, not a published one; the Parquet mirror is what the browser reads. No provisioned
  concurrency: the first request after an idle period can take several seconds, and `docs/runbook.md` and the PR body say so
  (README.md is never edited; section 20).

## 6. Incremental runs

- Per-source watermarks: Socrata `:updated_at` and `applieddate` window; TCAD supplemental export number;
  GIS layer edit date when available; Comptroller file date.
- Loader state per track (appraisal, permits, registry): a content-aware watermark of `(path, artifact hash)`
  with `mergedCount` and `lastMergedAt`, verified from durable Loader state rather than logs or file counts.
  Dead and invalid tombstones (permits voided or removed in a later Socrata window, parcels dropped from a
  supplemental roll) are consumed in the same merge, with the tombstone, its evidence and terminal reason
  retained and the watermark updated atomically.
- Each run writes `runs/<run_id>.json` (timestamps, sources and watermarks, Loader watermarks and tombstones
  consumed, counts including dead, invalid and retryable with `seed = ready + dead + invalid`, deltas,
  limitations, per-stage timings, per-source throughput with request counts and any throttling or errors seen,
  per-group CIDs, CAR validation counts, upload and readback summaries, gateway checks, CLI commit, lexicon
  manifest URL, kit commit, readiness report), committed to this repo and published. The slow or constrained
  sources the README asks about are read from that record, not estimated.
- Idempotent: re-running the same window changes nothing. Run 2 uses a later permit window (the dataset
  updates daily) plus any new supplemental roll, so it carries real new rows and new archive and tables roots
  for every group that changed. Run 2 is started no earlier than 24 hours after run 1's permit watermark, and
  its delta is confirmed non-zero before it publishes.
- Scheduling is on demand from the operator's machine; a cron wrapper is optional and not a substitute for run 2.
  A newer loaded watermark marks the published groups stale and queues a new immutable snapshot; prior roots are
  never mutated.

## 7. Publication

1. Kit flow per data group (`county` from the appraisal transform, `property_improvement` from the permit
   pipeline; `corporate_registry` only if the Comptroller exception in section 4 is approved): `elephant-cli
   validate <group-dir>` → `hash` (one CAR per county per data group, seed root inside) →
   **`validate <county>-<group>.car`** (the six per-check counts are kept as evidence) →
   `export-tables --atlas-page` with a 128 MB part-size cap (the kit's default is 1 GB; unit syntax per the CLI
   help) so every published object is small enough for public gateways to serve → `upload` of the CAR and of
   the tables directory, each requiring CID-matching readback of its root through a public gateway before
   anything else happens. CAR shards follow the kit's 5,000-property cap.
2. README packet, every run: `publish/<run_id>/manifest.json` listing every kit-eligible object (per group the
   archive root `cid`, the tables root, every table part and the schema CID; the manifest does not list itself, since its CID lives in the run record and
   `/v1/meta`, section 21) with
   `cid` (CIDv1 base32), `name`, `size`, codec (`file`/`directory`), `sha256`, optional `origins`. Coverage is
   expressed as counts inside the manifest (the README's "coverage"); the CountyIndex and CountyTables roots are
   its "indexes"; one property's data-group root CID is its "sample extract". No Query DB export, coverage
   object, overlay or derived table is listed or uploaded. A `cars[]` section lists, per group, the archive CAR
   and `tables.car` with `root_cid`, `group`, `kind` (`archive` or `tables`), `schema_cid`, `block_count`, `car_validation` counts, `path`,
   `size`, `sha256` and `readback_url` (the CAR file is an export of the root, not a separately pinned object).
   The manifest is a README-packet descriptor, pinned so the packet can verify itself; it is never referenced
   from the Atlas page or served as a registry, and consumers read the global Atlas IPNS.
   Second pin: Pinata **pin-by-CID** of every root after the Filebase upload, which preserves the CIDs by
   construction; each pin is confirmed complete before the gateway checks, and if a pin-by-CID stalls the
   fallback vendor is Storacha with a CAR upload. Pinata's free tier is 1 GB, so a paid month is budgeted if two
   runs exceed it. Retrieval of every root from `ipfs.io` and `dweb.link` with size and digest compared; inner
   blocks are reached by path from the root or with `?format=car` on the root, since third-party gateways cannot
   resolve inner blocks by bare CID; multihash digests are compared, not CID strings, when codecs differ. Saved
   as `runs/<run_id>.gateway-checks.json` and run **immediately after run 1**, not before the demo. **No IPNS
   name is minted:** consumers read the global `elephant-atlas` IPNS; after the Atlas merge the run record
   stores that name with its resolved index CID (null before merge), which is what the README's "if IPNS is
   used" clause receives. Prior CIDs are never mutated. CARs are never committed: they ship as GitHub Release
   assets of this repository (the demo packet), referenced by CID from the manifest.
3. Atlas: open the county-page PR on [elephant-xyz/atlas](https://github.com/elephant-xyz/atlas) as the kit
   prescribes. Publication state is reported in the kit's vocabulary: "uploaded with readback", "Atlas PR open /
   merged / not merged", and "published per kit" only once the global IPNS resolves to an index that includes
   Travis and the MCP sync has run. If `gh` write access to `elephant-xyz/atlas` is missing, the access request
   is recorded and the PR is opened when it arrives. The merge depends on the Atlas maintainers, so the README
   packet above is what this submission proves on its own; the PR body links the Atlas PR or records why it
   could not be opened.

## 8. Hosted layer (us-east-2, TypeScript, one CDK stack, near-zero standing cost)

- S3 mirror of the published tables + CloudFront for the explorer, with CORS that allows `Range` requests so
  DuckDB-WASM can read Parquet directly from the browser. The mirror is a locator, not the identity:
  at deploy, every mirrored object's sha256 is checked against the run's manifest, and the explorer and the API
  show the CID beside anything read from it.
- One Lambda (Node 22, packaged as a container image or with a layer so DuckDB's native binary ships) running
  DuckDB over the deploy-time database file described in section 5, behind an HTTP API: REST `v1`, MCP at `/mcp`
  (stateless JSON, no SSE), `/v1/permits/text-search` and `/v1/agent/chat`. Pay per request, reserved
  concurrency, stage and route throttling as in the contract, no always-on database. Sections 20 and 21 supersede
  this bullet: two functions from one container image with the DuckDB file baked in, MCP at `/v1/mcp`, Bedrock
  granted to the chat function only.
- Agent: Vercel AI SDK + Zod on Bedrock, `ToolLoopAgent` with the `v1` operations as typed tools, including
  `resolve_search_center` (called first when a question names a city or ZIP) and `search_permit_text`; cites ids
  and sources; per-request output cap and a CloudWatch alarm on daily usage.
  Model: the US cross-region inference profile `us.anthropic.claude-opus-5-5` (listed in the account's
  inference profiles on 2026-10-16), set through one stack parameter `BEDROCK_MODEL_ID` so it can be switched to
  `us.anthropic.claude-sonnet-5-5` without a code change. The Lambda role is granted `bedrock:InvokeModel` and
  `bedrock:InvokeModelWithResponseStream` on the profile ARN and on the foundation-model ARNs of every region
  the profile routes to.
- **Retrieval design.** The agent is retrieval-augmented over governed records: structured retrieval
  (radius, roof age, permit status, tenure) through the `v1` query tools, lexical retrieval through the
  full-text permit index, and generation that only reports rows those tools returned, with ids and sources.
  No embedding index is used: the README's example questions are numeric and spatial filters, which
  embeddings cannot evaluate, and the kit's RAG skill counts operational retrieval over records as RAG.
  Section 20 corrects the classification and records the exceptions this paragraph left implicit.
- **Kit-guideline exceptions, recorded.** The chat path calls Bedrock synchronously because the user waits
  for the answer; it has a 30-second timeout, two retries with backoff, bounded concurrency and metrics, which
  is the guideline's documented-sync case. Critical-failure alerting goes to a PagerDuty free-tier service
  through SNS if it can be wired in the hosting increment; otherwise the alarms notify by email and the PR
  records the substitution. Local Lambda emulation for the agent uses `sam local` against the CDK-synthesized
  template, as the kit's RAG skill asks; CDK remains the only IaC. Section 20 replaces the
  timeout and retries with a 25 s turn deadline and one retry; section 21 wires PagerDuty at T7.
- Powertools logger, tracer and metrics on the Lambda; secrets in SSM/Secrets Manager; cost-allocation tags.
- Not used: Cloudflare, SAM as IaC, Terraform, browser-held keys.

## 9. Explorer (static React + Vite, TypeScript, on CloudFront)

Run summary and counts by source; run history with every group root; manifest view with links to both public
gateways and a **Verify** action per object that fetches it from `ipfs.io` and from `dweb.link` in the browser
and compares size and sha256 to the manifest, so the IPFS criteria can be exercised live; query panels (center
from a place box backed by `/v1/search-centers` or typed coordinates) for radius + roof age, open and stalled
roofing permits with contractor attribution and BBB status, owner tenure, absentee and out-of-area owners, and
free-text permit search; a DuckDB-WASM SQL box over the published Parquet (served from the S3 mirror with CORS,
CIDs shown); agent chat; MCP endpoint and example call. Property views show both `property_id` and `geo_id`.

## 10. Quality bar

TypeScript strict, Vitest, ESLint, Prettier, `tsc`, GitHub Actions on the PR. No secrets in git, logs or
video. Real Travis records only; a missing source is a limitation with evidence, never generated data.

## 11. Out of scope

CRM UI and lead workflows (other repo), outbound messaging, waiting for an Atlas or transform-scripts merge,
generated datasets, copying or forking the kit into this repository.

## 12. PR deliverables

Live explorer URL, `API_BASE` and its `/v1/openapi.json`, MCP URL, demo video recorded on the live URLs,
`publish/` manifests with the CARs attached as Release assets referenced by CID (never committed), `runs/` with
at least two runs and two sets of group root CIDs, `docs/reviews/` (one record per pre-implementation review),
`docs/intent.md`, `docs/runbook.md` (rerun from a clean clone: kit checkout, `.env.example`, the mirror script,
the ingest and publish commands), `docs/slowking-self-assessment.md`, record counts per table with source,
limitations, a cost table itemized as section 21 requires, separating standing from per-request cost with the
worst-case day, and showing the ingestion runtime at zero when idle, "how to review in two minutes".

## 13. Contingencies (2026-10-16)

- **Bedrock enablement on the deployment account is pending with AWS** (requested 2026-10-16). Bedrock is
  first needed in the hosting increment. If enablement is still pending then, the agent runs on the Vercel AI
  SDK's Anthropic provider with an API key in Secrets Manager, recorded here as a dated deviation, and moves
  to Bedrock when access arrives. Section 20 adds what that deviation must keep and record.
- **Parcel geometry unavailable under US egress** → coverage limited to permit-located parcels, reported as a
  number, never geocoded.
- **TCAD export behind a paywall** → the purchase is a human payment decision, recorded in the run record. If
  it is declined, the TNR parcel layer's attributes become the parcel roll (owner, situs, values are published
  there), and year built and deed dates become documented gaps unless another official source provides them.
  Because GIS features are not the assessed-property population, this path requires an `approved_exceptions`
  entry in `travis-sources.yaml` naming the cause (TCAD paywall or geo-block), the canonical denominator, the
  seed decision, the excluded population (`separately_assessed_without_geometry`) and the coverage effect;
  without it the readiness validator blocks seed, pilot and full ingest.

## 14. 2026-10-16 (later): corrections after the oracle conventions review

Applied in place before implementation; the review and every citation are in
[`reviews/2026-10-16-oracle-conventions-review.md`](./reviews/2026-10-16-oracle-conventions-review.md).

- §5: `permit` class → `property_improvement` with its two parcel/property edges. The API keeps "permit" as
  the product name.
- §5, contract: property ↔ permit link is exact `geo_id` first; digits-only comparison only as a recorded,
  profile-proven fallback with method, version and confidence; `property_id` is `PROP_ID` as printed.
- §4, §5, contract: contractor identity removed. Printed fields are source-name attribution; no company,
  person or license records; Comptroller hits are registry candidates; Texas official authorities named.
- §5, contract: regex roofing tiers → profile-mapped work classes; roof age from the kit's estimator; no
  `issued_date` fallback; unmapped statuses → `needs_review`; blank completion dates are `unknown` evidence.
- §5, §7: `roofing_signals`, the search-center table and coverage are deploy-time artifacts, never published.
- §7, contract: no minted IPNS; the global `elephant-atlas` name and resolved index CID are recorded after merge.
- §3, §7, §12: no seed CSV or CARs in git; replay fixture under 1 MB; CARs as Release assets by CID.
- §7: `validate <county>-<group>.car` and root readback added to the sequence; publication state vocabulary.
- §7, contract: single `dataset_cid` → per-group `{cid, schema, tables}`.
- §3: kit pilot (about 25 parcels) before the 1,000-parcel feasibility increment; readiness validator before each.
- §4: rest-of-county permits enumerated per jurisdiction with `records_request`; BBB access request filed and
  the probe moved to the AWS US-egress runtime; Comptroller-for-SOS recorded as an approved exception.
- §13: GIS-only roll contingency requires an `approved_exceptions` entry.
- §3, §6: bulk-capture provenance rule; Loader watermarks and tombstones in the run record.
- §2: review order recorded; §8, §9: `places` renamed to search centers.
- Second look, same day (`reviews/2026-10-16-oracle-second-look.md`): §2 ten-increment plan (T1–T10) against
  the kit's floor of four, identity baseline before any permit harvest, appraisal-only pilot then `__ALL__`
  re-run, explorer and agent split, incremental refresh named as a capability; §3 the runtime `.gitignore`
  gap and the `property_improvement` provenance; §3, §5, contract: the API serves only the published permit
  scope, unlinked and excluded permits are counts; §4 privacy classification and registry candidates
  conditional on a published group; §5 owners as `company`/`person`, `unlinked_reason`, lifecycle mapping,
  estimator run twice, evidence-state counts, `status_source`, and the decision on non-lexicon permit
  fields (option ii, else iii, decided by the operator the same day; `mew` verifies whether `source_payload`
  survives hashing); §7 `cars[].kind` and the manifest as a packet descriptor.

## 15. 2026-10-16 (evening): v1 cut and runtime correction before implementation

- **Runtime premise corrected.** At `99c7bff` the kit's bundled runtime is the `elephant-county` CLI
  (`skills/use-oracle/runtime/bin/elephant-county.mjs`: `capture-raw`, `ingest`, `reconcile-export`, `replay`)
  over per-county modules `src/counties/<county>/{adapter,seed,query-table,validate,permit-profile,enrichment-profile}.mjs`
  (Duval, Broward and Pinellas ship), plus the AWS Batch track for enrichment. It ships no Restate services, no
  Postgres, no `docker-compose.yml` and no `Parcel.process`; the Restate topology that `county-ingest-run`,
  `county-appraisal-onboarding` and `bootstrap-oracle-infra` describe is one the operator would author with
  `durable-workflow-builder`. Section 3's "Restate + Postgres via Colima" and its `Parcel.process` smoke are
  therefore replaced for v1: Travis is a `src/counties/travis/` module registered in the CLI's adapter map, the
  single-parcel smoke is `elephant-county ingest --live-fetch` on a one-row seed, the pilot is the same command
  on the 25-row seed, and the internal load is `reconcile-export`. The durable Restate topology is a v2
  decision, taken only if the full run's volume needs it. "On demand, no standing infrastructure" still holds:
  the CLI runs and exits.
- **Versions.** The kit has no v1/v2/v3 staging; this is the repo's cut over section 2's increments, chosen so
  v1 is the lowest-hanging end-to-end slice. **v1** = T1 readiness PASS + T2 appraisal-only pilot (about 25
  parcels) through the CLI runtime, the pilot `county` group taken through `validate → hash → validate CAR →
  export-tables`, and, when Filebase keys are available, `upload` with readback, Pinata pin, two-gateway checks
  and `publish/<run_id>/manifest.json`, labelled "pilot scope, uploaded with readback, no Atlas PR". **v2** =
  T3–T7: identity baseline, permit profile and feasibility, full run and reconciliation, run-1 publication with
  the Atlas PR, hosted layer (the first point at which `slowking` can score). **v3** = T8–T10: explorer, agent,
  incremental refresh with run 2 at least 24 hours after run 1, plus BBB from the AWS runtime, the
  `corporate_registry` group if approved, Atlas merge → IPNS → MCP sync.
- **Autonomy, recorded as the operator's explicit instruction.** On 2026-10-16 the operator instructed the
  agent to "proceed autonomously" to deliver v1. Per `guide-product-work` this overrides the stop-per-increment
  rule for the v1 preparation steps; the omitted evidence (the operator's own run and observation of T1 and
  T2) is collected afterwards and recorded in `docs/progress.md` before T3 starts.
  **Restored the same evening:** the operator restored the stop-per-increment rule. The autonomous run is
  limited to T1 plus the safe preparation the readiness skill allows while blocked (adapter scaffold, fixtures,
  profile fixtures, seed script not run). From the T1 hand-off onward the operator runs and inspects each
  increment before the next starts, and the omitted-evidence clause above no longer applies.
- **Egress today.** The operator's egress is outside the US (`ipinfo.io/country` returned `RO`). TCAD, the
  TNR parcel layer and data.texas.gov are unreachable until a US VPN window; the Austin Socrata feed, the
  lexicon manifest, GitHub, Filebase and the public gateways are reachable. Until the window: safe preparation
  only (catalog, records requests, approved exceptions, permit-profile fixtures from Socrata samples, adapter
  scaffold, the runtime `.gitignore` fix, the readiness validator's BLOCKED report); no seeding, no pilot, no
  live fetch of geo-blocked hosts, no BBB from the laptop.
- **Where the Travis module lives.** In a separate worktree of the kit at
  `/Users/luti/dev/ateam/role1-prism/kit-travis` on branch `travis`, because the Claude Code plugin installs
  from the main checkout, which stays at the pin on `main`. The mirror into this repository under
  `oracle/travis/` is unchanged.

## 16. 2026-10-16 (evening): lexicon corrections from the `mew` lookup, and two CRM-side contract fixes

Source: the `mew` agent's read-only lookup against the kit's bundled catalog. The live lexicon MCP tools returned
errors today, so the live manifest confirms each point at T2's first `elephant-cli validate`.

- **Envelope, not lexicon properties.** `source_http_request` and `request_identifier` are the kit's per-entity
  envelope required by `elephant-cli validate` (output-contract.md:31-32), not properties of any class;
  relationships carry only `from` and `to`. Section 5's "the lexicon `source_http_request`" is read that way.
  The kit defines `request_identifier` as the parcel identifier substituted into the request; keeping `PROP_ID`
  on `property_improvement` entities whose request is the bulk Socrata GET is a deliberate deviation so that
  the tables column stays the parcel id. Recorded here as such.
- **The Seed group is mandatory.** The transform also emits `property_seed` (`parcel_id`, `prior_parcel_id`)
  and `unnormalized_address` (with `county_jurisdiction`), linked by the seed relationships; `hash` refuses to
  run without the seed root. Section 5's class list is read as including them.
- **Owners are never "as printed".** `person.first_name` and `last_name` are required and pattern-constrained
  (capitalized), so a roll owner string is case-normalized and split into a `person`, or becomes a `company`
  by a recorded classification rule; the as-printed string and the (`PROP_ID`, printed name) owner key stay in
  `source_payload`. `company.name` has no pattern.
- **Cardinality.** `parcel_has_property_improvement` is single-valued per root; `property_has_property_improvement`
  (one-to-many) is the carrying link for a property's many permits. The transform emits one
  `property_has_property_improvement` per permit and at most one `parcel_has_property_improvement`.
- **`property_id` comes from the archive.** A published `property_improvement` always sits under its property
  root, so a served permit always has `property_id` and `property_link` (the method recorded at transform time);
  `unlinked_reason` exists only as counts on `/v1/meta`. The `geo_id` link is made in the transform and the
  Query DB, never re-made by the hosted layer. `geo_id` has no lexicon home: the transform keeps it in
  `source_payload` on the property and on the permit, so option (ii) covers it; under (iii) the deploy also
  re-reads the TCAD export for it.
- **Identity of published records.** `permit_number` is optional and unpatterned in the lexicon; uniqueness per
  permit is a transform and Query DB invariant, and the published identity is the record CID.
- **Option (i) is dead on the lexicon's own terms.** `improvement_status` has no `Expired` member, so `stalled`
  would be unrecoverable, and `improvement_type: Roofing` or `improvement_action: Replacement` taken from
  description text would publish the classifier's output. The recorded choice, (ii) else (iii), stands. The
  empirical check for (ii) is fixed: hash one pilot property whose `property_improvement.json` carries
  `source_payload`, inspect the canonical block for the key, change one `source_payload` value and confirm the
  record CID changes, and confirm `export-tables` writes no such column.
- **Contractor contact fields.** The group has homes (`company.name`, `communication.phone_number` through
  `company_has_communication`, `person` through `contractor_has_person`); v1 writes none because there is no
  official identity. The gap ledger records this as a policy consequence, not a lexicon gap. `trade`, applicant
  and job valuation have no home.
- **Groups to confirm live.** The bundled catalog has no `corporate_registry` or `places` group, and `company`
  has no taxpayer-number property (only `sunbiz_document_number`); the Comptroller rows therefore stay Query DB
  candidates unless the live manifest provides a home.
- **CRM-side contract fixes** (reported through the roofing-crm agents): `API_BASE` is recorded in
  `docs/runbook.md` and the PR body after deploy, never in README.md; and the MCP endpoint enforces the same
  per-operation limits as the REST routes inside its handler, so `search_permit_text` cannot bypass the
  text-search throttle.
- **Publication credentials.** Filebase and Pinata credentials exist in the operator's git-ignored `.env`
  (variable names only: `FILEBASE_ACCESS_TOKEN`, `FILEBASE_SECRET_KEY`, `PINATA_API_KEY`, `PINATA_API_SECRET`,
  `PINATA_JWT_SECRET_ACCESS_TOKEN`). The kit's CLI reads `FILEBASE_ACCESS_KEY`, `FILEBASE_SECRET_KEY` and
  `FILEBASE_BUCKET`, so the runbook maps the token variable onto the key variable and the bucket name is added
  before the first upload. The v1 pilot upload is therefore possible as soon as the US egress window has
  produced the pilot.

## 17. 2026-10-16 (night): T1 preparation results and two recorded changes

- **Hand-off at T1** (the restoration of stop-per-increment is recorded in section 15). This run
  ends with T1 handed to the operator (`docs/progress.md`: T1 `prepared`, T2 `pending`); everything
  beyond T1 that was built is the safe preparation `county-readiness-preflight` allows while the
  validator is BLOCKED and is labelled "preparation, not T2". No seed, smoke, pilot or
  `ingest --live-fetch` has run.
- **Section 5, non-lexicon permit fields: option (ii) is dead at `validate`.** Every live class
  schema is `additionalProperties: false` without `source_payload`, and `elephant-cli validate`
  1.58.1 (commit `44bb182`) rejects `source_payload` on a `property` entity (kit evidence
  `docs/evidence/travis-fixture-validate-2026-10-16.*`). The transform keeps lexicon-gap fields in a
  per-parcel sidecar outside the archive; the hosted layer takes option (iii) (re-read the public
  exports for the non-lexicon columns, keyed by `permit_number` and `PROP_ID`, with their own
  provenance). Section 16's `geo_id` note follows: the deploy re-reads the TCAD export for it.
- **Lexicon county enum (new blocker for T2).** `unnormalized_address.county_jurisdiction` (required)
  and `address.county_name` are enumerated and lack `Travis`; every Travis property fails
  `validate` on exactly that error until the enum is extended. The request is drafted in the kit
  (`docs/travis-lexicon-county-enum-request.md`); opening the pull request on
  `elephant-xyz/lexicon` is an operator action and precedes any hash or upload.
- **Austin permits carry no license number** (78 export columns, none license-related) and Texas
  issues no roofing license, so the DBPR-style official lookup has no key in v1/v2; contractor
  fields stay source-name attribution, as section 4 already states. `:updated_at` is the daily
  publish time on every Socrata row, so incremental runs watermark on row content and the
  `statusdate`/`applieddate` windows, not on `:updated_at` (section 6 reads that way).
- **Elephant CLI** is installed project-locally in this repository (`package.json` devDependency,
  `github:elephant-xyz/elephant-cli#main` resolved to 1.58.1 / `44bb182b9f7f904662e9b33e1fde70bdeab62322`).

## 18. 2026-10-16 (night): the lexicon merge is a hard dependency

- Unlike the Atlas merge (section 7) and the transform-scripts merge (section 11), the Travis county-enum change
  in `elephant-xyz/lexicon` gates the first step, `elephant-cli validate`, because `unnormalized_address`
  is required in the Seed group of every archive. Without it no Travis record validates, so nothing is hashed,
  published, hosted or demonstrated; section 11's "waiting for a merge is out of scope" does not cover it.
- The kit has no lexicon step in county onboarding, so its readiness validator can PASS for a county the enum
  lacks; that is a kit gap worth reporting. Upstream, adding a county is a routine small pull request (Ellis
  #171, Hunt #115, Dallas #148), merged the same day by the maintainers.
- Since `elephant-xyz/lexicon` #189 (merged 2026-10-16) the repository pins the SHA-256 and source revision of
  `src/data/lexicon.json` in `scripts/build-model-composition.mjs`, so any lexicon edit also needs the Model
  composition rebuilt, and the revision must name the merge commit. Whether county additions now go through a
  governed Model release instead of a direct edit is a question for the maintainers.
- Route: a pull request from the operator's fork, carrying the change exactly as Ellis did and asking the
  maintainers which composition route they want. It is the operator's decision; T1 to T2 preparation and every
  increment's code and fixtures continue meanwhile, and validation is re-run when the published manifest
  includes Travis.


## 19. 2026-10-16 (night): T1 under US egress — counts, the GIS gap, and the source corrections

- **TCAD exports are free** direct downloads (no login, account or fee), so the section 13 paywall contingency
  stays inactive. The 2026 certified export is the PACS Legacy 8.0.33 fixed-width format (`PROP.TXT`, 9,922-byte
  records); `prop_id` is an `int(12)` field printed zero-padded, and the identifier is the integer that TCAD's
  property search and the TNR layer print (section 5's "PROP_ID as printed" reads as that integer).
- **Canonical parcel denominator:** 441,961 real-property accounts (distinct `prop_id`, `prop_type_cd` R). Mobile-home
  (11,744), business personal property (39,536) and mineral (5) accounts are outside the parcel population.
- **Coordinates source corrected:** the TNR layer is `TCAD_public/MapServer/0` (386,682 polygons, 13,130 without a
  PROP_ID); the `FeatureServer/0` path in section 4 is not enabled on the service.
- **The GIS gap is material (12.51%)**, explained by 57,567 condominium accounts without polygons of their own. The
  kit's readiness gate requires the exception to be documented and approved; it is documented in the kit catalog as
  proposed, and approving it is the operator's decision (runbook section 1). Until then the validator stays BLOCKED
  and no seed is built. Accounts without a polygon stay seed rows without coordinates, reported as a coverage number.
- Comptroller Active Franchise Taxpayers: 342,338 Travis rows (county code 227, the taxpayer's mailing county).
- Portal re-probes under US egress: Cedar Park and Leander block pages persist (not geo-blocks); Sunset Valley's
  GovBuilt now answers a challenge (not attempted); Lakeway runs Tyler EnerGov self-service (reachable; a
  `tyler-civic-access` candidate for T4); Round Rock's portal is an account login; all six stay `blocked`.
- Submitted on 2026-10-16 as https://github.com/elephant-xyz/lexicon/pull/194 from the operator's fork, with the
  operator's approval of its text. Fork pull requests wait for a maintainer to approve the CI run and the
  Vercel preview; the composition test is expected to fail until the maintainers choose a route.

## 20. 2026-10-16 (night): corrections after the alakazam retrieval and agent review

Applied before the contract freeze; the review and its citations are in
[`reviews/2026-10-16-alakazam-retrieval-agent-review.md`](./reviews/2026-10-16-alakazam-retrieval-agent-review.md), and
the contract changes are dated in `api-contract.md`'s change control.

- **Classification.** The agent is knowledge Q&A: grounded generation over operational data, with a structured
  leg (SQL filters) and a lexical leg (the DuckDB full-text index) and no vector leg. No retrieval result is
  auto-applied, so the kit's confidence bands, review queue and staged automation do not apply; grounding,
  citation and golden-set evaluation do. Recorded exceptions: no Bedrock embeddings, no OpenSearch, no Docker
  OpenSearch. README requires DuckDB and no standing cost, and v1 has no vector retrieval. Local replay is
  `sam local invoke` of the chat function from `cdk.out` against a DuckDB file built by the same deploy code from
  fixture inputs. If embeddings are ever needed they go to OpenSearch, with its standing cost accepted by the
  operator, never to DuckDB `vss`.
- **Fields the lexicon cannot hold (option iii, made one observation).** The deploy takes them from the same run's
  own captures: the Socrata export rows behind the published permits and the TCAD export rows behind `geo_id` and
  `owner_name`, each verified by the SHA-256 the run record holds (`sources[].sha256`). The captures travel with the
  deploy inputs in the private S3 deploy bucket and are never served as artifacts. Each published permit joins to
  exactly one captured row on `permit_number`; duplicates, missing rows and rows whose link disagrees with the
  published one are `conflicting` or `unavailable` and are neither served nor indexed. Every such field is labelled
  `unpublished_source` and never attributed to `record_cid`; `/v1/meta.deploy` pins the snapshot. If a run's capture
  is unavailable, one live read per deploy is pinned instead and recorded the same way.
- **Text search.** Index configuration: porter stemmer, English stopwords, an ignore pattern that keeps digits,
  lowercase and accent stripping, recorded in `/v1/meta.deploy.text_index`. A versioned alias list built from the
  permit profile's vocabulary rewrites variants to one token in documents and queries (`re-roof`, `re roof`,
  `reroof`). Stopwords are dropped from queries before matching: checked locally on DuckDB 1.5.6, where a
  conjunctive query containing a stopword returns nothing and `re-roof`, `reroof` and `re roof` do not match one
  another without the alias list. Matching defaults to all terms; sort is `bm25_score` then `permit_id`.
- **Golden set; replaces T9's two-prompt check.** `fixtures/rag/queries/*.json`, replayed under SAM local and then
  on AWS before T9 is accepted. Cases: both README prompts as one two-turn conversation; several cities, ZIPs and
  alias spellings; out-of-county, off-topic and no-match questions; "many years"; BBB and owner-contact questions;
  an area with `needs_review` permits; text-search vocabulary variants with hand-labelled permit ids; one injected
  description. Each case records the expected tool sequence and parameters, the expected ids computed by SQL on the
  same DuckDB file, and the expected `outcome`. Hard gates: no id or CID cited unless a tool returned it in that
  turn; no `answered` without a successful tool call. Reported, labelled experimental: parameter accuracy, id recall
  on the returned page, text-search precision and recall at k, outcome accuracy, p95 turn latency, tokens per turn.
  Rerun on any change of model, provider, prompt or profile.
- **Grounding.** The server builds `evidence[]` from the turn's tool results and checks every citation in the answer
  against it, failing closed; earlier turns are never evidence; typed limitations are added by the server. The
  system prompt requires `roof_age_basis` and `roof_age_confidence` with every roof age, "listed contractor as
  printed, not a verified identity", and "stalled" as expired with no evidence of completion.
- **Prompt-injection boundary.** Tools stay read-only: no write, URL-fetch or outbound tools, ever. Tool results reach
  the model as JSON with free-text fields capped at 1,000 characters and stripped of control, zero-width and bidi
  characters, under a system rule that tool text is data. Roles are limited to `user` and `assistant`. The explorer
  renders the answer as sanitized Markdown: no HTML, no remote images, links only to the API, the explorer and the two
  public gateways. The MCP instructions and the OpenAPI mark the untrusted fields. The golden set carries an injection
  case.
- **Personal data.** The agent's view of `get_property` and `get_permit` omits `owner_name`, `mailing_address`,
  `applicant` and the contractor's phone unless the question asks about ownership or contact. Logs and traces carry
  ids, counts and hashes only; LangSmith hides person fields. CloudWatch logs are kept 90 days (section 21); LangSmith keeps
  traces 14 days (free Developer plan, base traces; recorded 2026-10-21). The section 13 fallback adds a processor outside AWS and is recorded as such.
- **Stateless chat.** HTTP ingress with no Chat SDK state: the kit's `ConversationEventStore` interface with its
  `NoopConversationEventStore`, so AgentCore Memory can be added later without a contract change. Tool results do
  not carry between turns; follow-ups work through the history the client sends, and the golden set covers it.
- **Time budget and isolation.** Chat runs in its own Lambda function, same package and DuckDB artifact, with its own
  reserved concurrency and the only Bedrock grant, so chat load cannot starve the CRM's REST and MCP calls and the
  public REST path cannot invoke Bedrock; metagross sizes it. Each turn has a deadline of about 25 s from receipt,
  cold start included, under API Gateway's 30 s cutoff; each step's timeout derives from the remaining budget; at
  most one retry, only on throttling or a 5xx, and only if budget remains; the output budget counts across steps; a
  `stopWhen` cap of 6 steps. At the deadline the turn returns `limit_reached` with the evidence so far. A circuit
  breaker returns `503 circuit_open`. A server-side daily request and token budget, whose alarm action disables chat,
  returns `503 budget_exhausted`. This deviates from the guideline's default timeout of 5 s or less: the user waits
  for a model answer.
- **Agent tools.** `limit` 20 (max 50), always with `total`; the model sees a projection that keeps ids, CIDs,
  signals and `source.url` and drops `source_http_request` and long text; one structured log line per tool call
  (params, total, returned, ms, status). `search_properties.open_permits` is required for the agent and MCP. The
  harness rejects any search whose `lat`/`lon` was neither returned by `resolve_search_center` in the turn nor typed
  by the user; the agent asks when only non-exact search centers come back, and the centroid basis goes into
  `assumptions`.
- **Observability.** Proposed runtime name `staraptor-agent`, after a hawk that surveys rooftops from above, pending
  the operator's confirmation as the kit's naming rule requires; it names `LANGSMITH_PROJECT`, the Powertools
  service and the metrics namespace. LangSmith through the kit's facade: session = `session_id`, else `request_id`;
  `flush()` before returning; degrade gracefully when tracing fails; key in Secrets Manager, whose monthly charge goes
  in the standing-cost row of the cost table. Bedrock prompt caching through `withBedrockPromptCaching`, with the
  per-deploy run summary in the system prompt and cache tokens logged. Per-turn metrics: steps, tool calls, input,
  output and cache tokens, latency, outcome, deadline hits, citation-check failures, Bedrock throttles and denials;
  an error-rate alarm on the recorded alerting channel. Every REST and MCP response carries `x-request-id`.
- **Model.** At T9: one Converse call through the inference profile from the chat function's role, and the on-demand
  quotas checked, since a listed profile is not proof of permission. The default model is chosen on the golden
  set's accuracy and p95 latency within the deadline, Sonnet or Opus through the one stack parameter, with the
  per-request cost in the cost table. The section 13 fallback, if used: tool results go to a processor outside AWS,
  the provider's own cache control replaces the Bedrock-only middleware, the time-budget controls stay, responses
  and traces report provider and model, and switching back reruns the golden set.
- **`needs_review` correction loop.** The operator reviews the distinct unmapped terms; accepted terms become profile
  fixtures under a new `work_classifier_version` with reviewer, date and reason; nothing is accepted from model
  output.
- **Durations.** `open_duration_days`, `days_since_expiry` and the long-open test are computed at query time and
  quoted with `open_duration_as_of`.
- **README vs kit, satisfied both ways.** DuckDB with no standing cost versus the kit's OpenSearch: no vector leg in
  v1, exception recorded above. HTTP chat and MCP versus the kit's Asana ingress: this product has no Asana thread;
  the rest of the kit's agent stack applies. CIDs as identity versus fields the lexicon cannot hold:
  `unpublished_source` per record and `deploy.reads` per snapshot. No standing cost versus Secrets Manager: its
  monthly charge is listed in the cost table.
- **Effect on the plan.** T7 gains the chat function split, the citation check and MCP schemas generated from the tool
  registry, about 1 to 2 hours; T9 gains the golden set, tracing, caching and the budget controls, about 2 to 3
  hours. The CRM syncs these contract changes with the rest at the freeze.

## 21. 2026-10-16 (night): corrections after the metagross hosted-layer review; contract frozen

Applied before the freeze; the review and its citations are in
[`reviews/2026-10-16-metagross-hosted-layer-review.md`](./reviews/2026-10-16-metagross-hosted-layer-review.md). With
it the four pre-implementation reviews are done and `api-contract.md` v1 is frozen at the field level.

- **Layout** (pnpm + Turborepo, the kit's locations): `apps/api/` holds the REST, MCP and chat handlers, one
  Dockerfile and one image for two functions, with the CDK app in `apps/api/cdk/`; `apps/explorer/` is the React +
  Vite app; `packages/contract/` holds the Zod params and responses and generates the committed `openapi.json` and
  the MCP and agent tool schemas; `packages/api-client/` is the explorer's typed client (the CRM generates its own
  from `openapi.json`); `packages/query/` holds the DuckDB schema and one SQL implementation per operation, called
  in-process by REST, MCP and the agent's tools; `packages/deploy-build/` verifies inputs and builds the DuckDB file,
  importing the estimator and the Travis profile from the pinned kit worktree; `packages/tsconfig/`. `oracle/travis/`,
  `publish/`, `runs/` and `docs/` stay outside the workspace. Deploy order: deploy-build, `cdk deploy TravisApi`, the
  explorer built with `VITE_API_URL`, `cdk deploy TravisWeb`, then the T7 and T8 checks.
- **Recorded exceptions.** REST, OpenAPI and MCP replace tRPC: the CRM is a separate repository, so a shared router
  type cannot reach it; one Zod package keeps the kit's intent. S3 and CloudFront replace Amplify: one distribution
  serves the explorer and the CID-keyed Parquet mirror, so DuckDB-WASM reads are same-origin. No custom domain: this
  is not a catalog product with an Environment-owned domain; `API_BASE` is the HTTP API's `$default` execute-api URL
  and the `HttpApi` construct ID never changes. One deployed environment, one account, `us-east-2`, stacks without
  stage suffixes; local is SAM local with the fixture DuckDB, and CI is synth plus tests. No kit metric registry or
  Main Dashboard: an in-repo metric registry and one dashboard defined in the stack.
- **Stacks.** One CDK app with `TravisApi` (both functions, the HTTP API, alarms, SNS, the private deploy bucket) and
  `TravisWeb` (CloudFront, the explorer bucket, the mirror bucket), each pinned to `us-east-2`, tagged `project_name`,
  with fixed construct IDs. One Zod-validated CDK config holds account, region, model id, memory, reservation,
  throttles, alarm subscribers and the explorer's `VITE_API_URL`.
- **DuckDB in Lambda.** The checkpointed, read-only DuckDB file is baked into the container image both functions
  share, in a layer before the code so code-only deploys reuse it; Lambda loads image chunks lazily, so no cold start
  downloads 2 GB. The S3 download stays only if T7 measures the cold first-request p95 far inside the 25 s and 30 s
  budgets. One `DockerImageFunction` image, arm64, DuckDB's Node bindings installed for linux-arm64 inside the
  Lambda base image, DuckDB 1.5.6 as in the build, `fts` bundled with `extension_directory` set and autoinstall off,
  `memory_limit`, `threads` and `temp_directory=/tmp` set explicitly, memory sized from T7's measurements.
- **Routes, throttles and CORS.** Four routes: `POST /v1/agent/chat` to the chat function; `GET /v1/permits/text-search`,
  `POST /v1/mcp` and `$default` to the API function. Limits set on the `$default` stage's route settings and published
  in `/v1/meta.limits`; HTTP APIs have no usage plans and WAF would add standing cost, so limits stay shared. CORS is
  configured on the API (`corsPreflight`) and never in the handler; `x-request-id` = `requestContext.requestId`. T7
  checks from the explorer's origin whether a throttled `429` is readable cross-origin; if not, clients treat that
  opaque failure as a back-off signal.
- **Concurrency.** Before T7 the operator runs `aws lambda get-account-settings --region us-east-2` and reads the
  inference profile's Bedrock quota; Lambda keeps 100 unreserved, so a low new-account limit makes any reservation
  fail. Only chat is reserved, at R ≤ min(5, Bedrock RPM × p95 turn seconds ÷ 360); its route throttle is about R ÷ p95
  turn seconds with burst R; the API function stays unreserved. Chat's timeout is 28 s and its deadline counts from
  `requestContext.timeEpoch`, so cold start is included. MCP's per-instance text-search bucket rarely binds, since an
  instance serves one request at a time.
- **CloudFront.** `/tables/*` allows `GET`, `HEAD`, `OPTIONS`, with a response-headers policy for any origin that allows
  `Range` and exposes `Content-Range`, `Accept-Ranges`, `Content-Length` and `ETag`, compression off and immutable
  caching. The explorer's single-page routing is a viewer-request CloudFront Function, never a distribution-wide
  error response that would turn a missing Parquet part into `index.html`. DuckDB-WASM's non-isolated bundle is
  self-hosted as `application/wasm`.
- **Mirror.** Objects are keyed `tables/<tables_cid>/<relative path>`; each part, 128 MB or less, is uploaded in a
  single PutObject carrying the manifest's SHA-256 as `x-amz-checksum-sha256`, so S3 rejects mismatched bytes;
  objects are immutable; only `/index.html` is invalidated per explorer deploy.
- **Private data stays private.** The DuckDB file and the captures are in no CloudFront origin: in the image or the
  private deploy bucket. Origin Access Control reads only the mirror and explorer buckets; every bucket has Block
  Public Access, TLS-only and SSE-S3.
- **Deploy-time build.** `packages/deploy-build` runs on the operator's machine before `cdk deploy`, where the export
  output, the captures and the kit worktree are. It checks every table part against the manifest and every capture
  against `sources[].sha256` and stops on a mismatch; writes the checkpointed file and a `deploy.json` with
  `deploy_id` and `inputs_sha256`; skips the rebuild when `inputs_sha256` is unchanged; and stores its inputs in the
  deploy bucket under SHA-256 keys. The TCAD live-read fallback needs US egress, so outside a VPN window it covers the
  Socrata export only.
- **OpenAPI.** OpenAPI 3.1 and the MCP tool schemas are generated from the Zod package; `openapi.json` is committed and
  served unchanged; CI fails when the generated file differs from the committed one or a field named in the
  contract's tables is missing. The CRM pins that file.
- **Secrets and IAM.** The LangSmith secret is created out of band and imported by name, resolved at runtime with
  caching, never as a Lambda environment variable; the section 13 Anthropic key the same way, only if used. The
  PagerDuty URL and the chat kill-switch flag are free SSM standard parameters. Roles: the API function gets logs and
  X-Ray only, no Bedrock and no S3 while the file is in the image; the chat function gets Bedrock invoke on the
  profile and its foundation-model ARNs, `GetSecretValue` on one secret and `ssm:GetParameter` on the flag; the flag
  writer gets `ssm:PutParameter` on that parameter; no function gets `aws-marketplace:*`. CDK template tests assert
  each.
- **Kill switch.** The daily-usage alarm sets the SSM flag through SNS and a small function; the chat handler reads the
  flag with a short cache and answers `503 budget_exhausted`; an EventBridge Scheduler job clears it daily. Setting
  reserved concurrency to zero is not used, because it would surface as gateway errors, not the contract's body.
- **Observability and alerting.** 90-day retention on every log group, custom-resource functions included; HTTP API
  access logs with `requestId`, `routeKey`, `status` and `integrationErrorMessage`; `QueryServed`, `QueryFailed` and
  `ProcessingDuration` with `service`, `operation` and `status` dimensions, ids in metadata only. PagerDuty Free is
  wired at T7 as the HTTPS subscriber of one SNS topic, email the second; at most ten self-resolving alarms (stage
  5xx, errors and throttles per function, chat error rate, daily chat usage, the budget flag) to stay in the free
  tier. CloudFront metrics exist only in `us-east-1`; that gap is accepted.
- **CI.** A justfile with the kit's six recipes; a repo-local PR workflow running `prettier --check`, ESLint,
  `tsc -b`, Vitest (with the OpenAPI snapshot and CDK assertions) and `cdk synth --strict` on the fixture DuckDB with
  no lookups or credentials. `deploy` is run by the operator only, never on push.
- **Cost table.** Standing lines at list price: S3 (mirror, deploy bucket, CDK assets), ECR image versions, each
  Secrets Manager secret ($0.40 a month), alarms and dashboards beyond the free tier, log storage, the Pinata
  month and the Filebase month (both paid plans: about 9.4 GB distinct, 18.9 GB as Filebase counts it, decisions.md
  section 27; Filebase's free 5 GB no longer suffices). Bought by the operator on 2026-10-19: Filebase Pro at $7.50 a
  month (500 GB S3 and IPFS storage, 250 GB IPFS bandwidth, extra storage $0.015 a GB) and Pinata Picnic at $20 a
  month (1 TB storage, 500 GB bandwidth, one gateway, extra storage $0.07 a GB); both cover run 1 and run 2 (about
  40 GB as Filebase counts it). Per-request lines: Lambda, API Gateway, CloudFront, X-Ray, custom metrics, Bedrock. Plus the worst-case day at
  the throttle and concurrency ceilings. Lifecycle rules and `cdk gc` keep per-deploy artifacts from piling up;
  `project_name` is activated as a cost-allocation tag so Cost Explorer can back the table.
- **Teardown and lifetime.** The stacks stay up with termination protection until the evaluation ends, since the
  evaluator needs a live runtime. Then `cdk destroy` with explicit removal policies (the deploy bucket, images and log
  groups go with the personal data they hold; the mirror can go because IPFS keeps the bytes) and `cdk gc`. The
  README packet and its CIDs remain as the surviving proof.
- **Verify action.** Per codec, the way `gateway_checks` works: file parts are fetched in full and compared by size and
  SHA-256, hashed in a Worker; directory and large roots compare the `?format=raw` root block with the CID's
  multihash. A gateway `?format=car` stream or a Release asset is never compared with the local CAR's SHA-256, since
  block order differs and Release downloads are not readable cross-origin. dweb.link's redirect to its subdomain
  origin is followed; a gateway timeout shows "unverified", not a mismatch. T8 confirms both gateways' CORS from the
  live origin.
- **README vs kit, satisfied both ways.** An external consumer versus tRPC: one Zod package generates REST, OpenAPI and
  MCP. No ongoing cost versus DEV/PROD, domains and Amplify: one account, PR CI as the dev gate, operator-run deploys,
  every standing line priced. No ongoing cost versus paging, 90-day logs and secrets: PagerDuty Free costs nothing,
  id-only logs cost cents, the secret is priced. "Without Oracle-hosted database infrastructure" versus a Lambda
  backend: the functions query an embedded file with no database server, and the DuckDB-WASM box queries the Parquet
  with no Oracle compute at all. No ongoing cost versus a persistent runtime for the evaluation: the stacks stay up at
  the quantified near-zero cost through the evaluation, then are destroyed.
- **Effect on the plan.** T7 grows by the container image with the baked file, the two stacks, the generated OpenAPI,
  the kill switch and the alarms: about 2 to 3 more hours. The contract's first T7 commit is the Zod package and the
  committed `openapi.json`, which the CRM pins.

## 22. 2026-10-17: the Seed root is address_has_parcel only; the amended lexicon leaves T2

Recorded from the read-only oracle assessment the operator requested through arceus (option B). It supersedes the
amended-lexicon route of 2026-10-17 (kit evidence `docs/evidence/travis-t2-lexicon-amended-a0c05c5-plus-travis.json`,
run `20261017T052903Z`, now evidence only).

- **Seed root.** Each property's Seed root carries `address_has_parcel` only (the County group's `address.json` to
  `parcel.json`): the root `elephant-cli transform` writes itself (`writeSeedGroup`, elephant-cli #251; kit
  `skills/build-county-transform/reference/scripts-mode.md` 23-27), and the shape of the only county published with
  tables (Jackson, FL: `address`, `address_has_parcel`, `parcel`, `properties`, `property`, `property_has_address`).
  `property_seed` and `unnormalized_address` are no longer written into the archive. Their values duplicate archive
  fields (`parcel_id` is `parcel.parcel_identifier`, `full_address` is `address.unnormalized_address`, the coordinates
  are the geometry's) except `county_jurisdiction`. Section 16's `prior_parcel_id` was never written. The Seed root
  stays mandatory (`hash` derives the property CID from it); section 16's entity list for it is replaced by this one.
- **Why not the full root.** It validated only against an amended lexicon (the live state `a0c05c5` plus #194's two
  enum lines) served on 127.0.0.1, while the kit and Atlas's PR gate validate against the live manifest; and
  `elephant-cli export-tables` at `44bb182` (main HEAD, no fix open) refuses it with "table property_seed has two
  schemas in this car": the Seed group's relationship key `property_seed` is also the `property_seed` class table's
  name. B is the kit's lexicon-valid workaround after a reported bug, and the CLI's own default.
- **Result.** Run of record `20261017T072132Z` against the live manifest (sha256 `7084b933…`, no local server, no
  `ELEPHANT_*` overrides): smoke `20261017T072127Z` (830704) 1 of 1; pilot 25 = 25 + 0 + 0, 13 with geometry,
  reconcile-export 25 of 25; `validate` 25 of 25 with 0 errors. `hash`: `travis-county.car`, 471 blocks, root
  `baguqeerahe3ecgiyigcgdg6gmxqsmc5ylzlucf4kb3n5xcqi5tvtiebpv2ta`; CAR validation: integrity, root, index, graph,
  lexicon and orphans 0 (25 properties, 50 data groups). `export-tables --part-size 128m`: 23 tables in 23 parts, 444
  rows, root `baguqeeram5hefoyihxelublnx3hzdmbdxg5gavyukspzevkwnii7b5zexipq`; every class (9) and relationship key
  (13) the transform emits has a table. Local Atlas page `counties/TX/travis.json`, group `county`, schema the live
  County CID. Evidence: kit `docs/evidence/travis-t2-run-20261017T072132Z.json`.
- **The county label is a lexicon gap.** No field in the archive names the county: `address.county_name` is omitted
  until lexicon#194 is live, and `unnormalized_address` is not written. The county is named by the Atlas page
  (`counties/TX/travis.json`, FIPS 48453), the run record and the README manifest. Adding the label later is a new
  snapshot with new CIDs.
- **Wrong-county check.** Because nothing in the archive names the county, the adapter fails closed with
  `assertTravisIdentity`: the seed row's county is Travis and FIPS 48453; every entity's `request_identifier` is the
  row's `parcel_id`; every `source_http_request` host is `traviscad.org` or `gis.traviscountytx.gov` (T4's permit
  entities add `data.austintexas.gov`); `address.state_code` is TX and `address.county_name` absent or Travis; every
  geometry point inside the Travis bbox. `county_jurisdiction` stays internal (the adapter's seed files beside `data/`).
- **CIDs.** Every property CID differs from the amended pilot's; nothing was published or pinned. T4's permit
  transform must write `address.json` and `parcel.json` byte-identical to the appraisal transform's, so that the Seed
  root, and with it the property CID, is the same in both archives.
- **Supersedes.** Section 17's "every Travis property fails `validate` on exactly that error until the enum is
  extended" and section 18's "the lexicon merge is a hard dependency" held only for a Seed root carrying
  `unnormalized_address`. Lexicon#194 now adds only the county label; T2 does not wait for it.
- **Follow-ups.** The elephant-cli issue (draft, not filed: kit
  `docs/travis-elephant-cli-issue-property-seed-table-collision.md`); the kit gap reports (kit
  `docs/travis-kit-gap-reports.md`); lexicon#194 stays open with its Why edited (operator approval; not posted); the
  runbook's T2 expectation now says validate passes against the live manifest.

## 23. 2026-10-17: T3 rulings: the registry equivalent, licensing, business records and scope

Approved by the operator on 2026-10-17, from the read-only `oracle` ruling requested under the operator's rule that
README.md is law: deliver what it asks unless the regular sources provably lack the data, and show a proven gap as
missing. Egress was RO during the ruling, so data.texas.gov, tdlr.texas.gov and tsbpe.texas.gov were not contacted;
their contents below come from the Socrata Discovery API catalog and web search and are re-checked live in the next US
window.

- **Corporate registry (supersedes section 4's "approved exception" and "registry candidates only", and section 5's
  "business = Comptroller taxpayer number (a registry candidate, not identity)").** The Comptroller's Active Franchise
  Taxpayers file (`9cir-efmm`) is the Travis profile's official corporate-registry equivalent under
  `sunbiz-corporate-ingest` (SKILL.md 13-15) and `permit-evidence-preflight.md` (188-190): an official state record of
  each franchise-tax entity carrying the Secretary of State's registry key. The SOS file number is on 335,980 of the
  342,338 cached Travis rows (98.14%), with the SOS status code, charter and status dates and the right-to-transact
  code. The SOS stays the authority of record and SOSDirect an optional human payment decision. Gaps, from the file's 18
  columns: no registered agent or other filing roles, no assumed names, no entities outside franchise tax, no ended
  accounts and so no history. A row is the official record of its taxpayer (`taxpayer_number` and SOS file number as
  printed); a link from a permit contractor or a roll owner to a row is a review candidate, never identity (oracle.md
  107-108). The inert `corporate-registry` entry under `approved_exceptions` is replaced by a profile entry naming the
  equivalent, its limits and the operator's approval. Each row's provenance is its bulk capture (request, `fetched_at`,
  SHA-256, offset); a per-taxpayer Comptroller detail URL is added only once its form is confirmed under US egress, and
  the bulk page is never written as a company's `source_http_request`.
- **Licensing.** Proven missing: no Austin permit prints a license number (68 named columns, 82 in the Socrata catalog
  with 4 location sub-fields and 10 computed regions, none license-related; license markers in free text on 14 of about
  2.38 million rows and in no contractor field); Texas issues no roofing license (RCAT's credential is voluntary,
  enrichment at most); 18 of the 33,351 building permits mentioning roof name a licensed trade. Acquired in T3 as dated,
  digested snapshots: TDLR's daily license files (the data.texas.gov copy is `7358-krk7`), TSBPE's free licensee lists
  (the Responsible Master Plumber CSV with the last known company) and the City of Austin's Active Right of Way
  Contractor License Holders (`8d92-wsiw`). A name match to a license row is a `license_candidate`, never identity.
  **Historical qualification** (which license holder backed which business on a permit's date) is closed for v1 by the
  operator on 2026-10-17: the README does not ask for it, Texas has no roofing license, and no public file carries the
  dated relationship, so no records requests are filed and the gap is listed under limitations. The live manifest
  (2026-10-17, 159 entries, sha256 `7084b933…`) has no `license` class and no company-to-license relationship; the gap is
  recorded and no other edge is substituted (oracle.md 119-122).
- **Contractor records.** The README's contractor record (README.md 32, 76, 106, 111) is the permit's listed contractor
  as printed, served as `identity_status: source_name_attribution` with the permit's provenance and
  `official_identity: null` with its proven reason. oracle.md 52-53 and 111-114 govern identity records and edges, and
  the kit keeps the raw contacts (oracle.md 47-48; preflight 195-198, 223-225): both hold.
- **Business records (README.md 34, 94).** Proven missing in the lexicon: no corporate-registry group among the live
  manifest's 16 data groups; `company` holds only `name` and the nullable Florida `sunbiz_document_number` under
  `additionalProperties: false`; `Business_Location` is the places shape and a franchise row is a mailing address. The
  rows are therefore not eligible for IPFS (README.md 49, 59; oracle.md 22-24). They load on the internal `registry`
  track with its loader watermark and, at deploy, into one source-shaped DuckDB table `business_records` built by
  `packages/deploy-build` from the run's own capture, verified against `sources[].sha256`, labelled `unpublished_source`
  per row, never attributed to a CID, never named or laid out as a lexicon class table, never registered, never read
  from the Query DB. This extends section 20 from fields on published records to records the lexicon cannot hold. The
  versioned exact-unique-normalized-name matcher runs in internal reconciliation and again at deploy, and the counts
  reconcile. Contract, before T7's first deploy: `counts.registry_rows_loaded` and `Contractor.registry_candidates[]`
  lose the "unless a `corporate_registry` group is published" condition; additive and nullable:
  `Contractor.license_candidates[]`, a business and license read path in REST, MCP and the agent, and one `deploy.reads[]`
  and Run `sources[]` entry per business or licensing source.
- **Further business sources.** The Comptroller's Active Sales Tax Permit Holders (`jrea-zgmq`: outlet addresses, outlet
  county, NAICS, permit and first-sale dates, entity types outside franchise tax) is loaded for Travis outlets the same
  way, or its exclusion is recorded with proof; its individual-owner rows get a privacy classification before hosting and
  no SSN-derived taxpayer number is served; whether `Business_Location` fits outlets is a `mew` lookup. The SOS Veteran
  Owned Business file (`2vfr-72e4`) is loaded for its Travis subset and joined to the Comptroller rows by exact SOS file
  number.
- **Scope.** The business-records load is Travis (`taxpayer_county_code` 227, the mailing county). The statewide file
  (3,486,216 rows on 2026-10-16) is the private matching universe (README.md 37, 79): of 14,477 roofing building permits
  that print a company, at least 4,077 (28.2%) print a contractor city outside Travis, and 629 normalized names already
  map to more than one taxpayer within Travis. Out-of-county rows enter `business_records` only as matched candidates of
  a Travis permit or roll owner, flagged by scope.
- **Kit inconsistency (reported with the kit gap reports).** county-permit-adapter SKILL.md 9-13 and county-ingest-run
  SKILL.md 9-18 block permit harvest until an adequate licensing snapshot exists; permit-evidence-preflight.md 221-231,
  284-287 and 313-317 block only historical qualification of permits without a license number. Travis follows the
  preflight, which county-permit-adapter 16-17 names as the identity procedure, and README.md 29.
- **Effect on the plan.** T3 starts now offline (Travis load, the Austin right-of-way snapshot, the matcher and its
  fixtures, profile edits, the contract additions, a VPN-only fetch script) and closes after one short US window
  (statewide franchise file, sales-tax outlets, TDLR and TSBPE files, the veteran-owned file, the detail-URL form). The
  findings note "no further VPN window is needed until run 2" no longer holds.


## 24. 2026-10-17: T3 window results ruled by the operator

The T3 window run `20261017T160716Z` is verified and loaded offline (`docs/progress.md` T3; kit
`docs/evidence/travis-t3-run-2026-10-17.json`). Four points needed a ruling; the operator ruled on all four on
2026-10-17 (point 2 delegated to the `oracle` agent, which arceus named as the closest owner). Each ruling is a
versioned rule, so a later change is a re-load, not a rewrite of history.

1. **Veteran-owned join key.** Section 23 says the SOS Veteran Owned Business rows are "joined to the Comptroller rows
   by exact SOS file number". The franchise file prints that number zero-padded to 10 digits (all 3,245,622 printed
   values), the veteran file prints 9 digits (all 27,205), so equality of the printed values joins 0 rows. The loader
   joins on the veteran number left-padded to 10 digits (`travis-sos-file-number-join.v1`): 25,466 rows join, 2,343 of
   them to a Travis taxpayer, and the veteran file's own `taxid` equals the joined taxpayer number on 24,868 (16 differ,
   582 blank). **Ruled (operator, 2026-10-17): approved.** The SOS file number left-padded to 10 digits counts as the
   exact SOS file number (`travis-sos-file-number-join.v1`).
2. **Withheld numbers inside two digests.** `api-contract.md` defined `business_record_id` as the SHA-256 of the source
   key and the printed key, and `unpublished_source.row_sha256` as the hash of the row as captured. For a sole owner's
   sales-tax row (`record_id_withheld: individual_owner`; 9,471 Travis outlets of 9,088 owners) either digest could be
   reversed by trying every 11-digit number, which contradicts "they never expose a withheld number".
   **Ruled (oracle agent, delegated by the operator on 2026-10-17):**
   - `unpublished_source.row_sha256` of a withheld row is the SHA-256 of the captured row with the withheld cells
     emptied. It is a content digest: anyone holding the capture recomputes it, the page digest in `sources[].sha256`
     still anchors the page, and it holds no trace of the number.
   - `business_record_id` of a withheld row is the first 32 hex characters of HMAC-SHA256 under a record-id key over
     the same message as the plain recipe (source key, taxpayer number, outlet number; `travis-record-id.v1`). Records
     with a printed key keep the plain SHA-256.
   - Collision counts on the 9,471 real rows: the plain recipe with the number emptied (source key and outlet number)
     gives 22 ids, collapsing 9,464 rows (outlet number 1 alone covers 5,615); taxpayer name plus outlet number shares 4
     ids among 8 rows; the redacted row and the outlet fields (number, name, address, city, ZIP, permit and first-sale
     dates) give 9,471 distinct ids today, but nothing guarantees it, and either id changes whenever any of those printed
     values changes; the keyed digest gives 9,471 distinct ids by construction, because its message is the dataset's own
     unique key ("combined with taxpayer number, a unique number to identify the outlet", the dataset's column notes).
     Omitting the digests is ruled out: `business_record_id` is the path key of `/v1/businesses/{id}` and of
     `RegistryCandidate`, and `row_sha256` is the row's provenance.
   - Why: (a) no kit agent or skill owns identifier design for privacy-classed rows; the kit's only precedent stores an
     SSN "as an immutable salted hash" (use-neutral-lexicon model-b, precedent, not authority), and with an 11-digit
     input only a secret key, not a public salt, stops enumeration, so the keyed digest is that precedent's reading;
     (b) the READMEs ask for no collapsed entities and for preserved provenance and say nothing about record ids; (c) the
     operator's lean, digests without the number, fits `row_sha256` exactly and is adopted there, but as an id it either
     collapses rows or is unstable, so the id keeps the number inside a keyed digest.
   - The key: 32 random bytes in `data/travis/keys/record-id.key` under the kit runtime (gitignored, mode 0600,
     `TRAVIS_RECORD_ID_KEY_FILE` overrides), created once with `node src/counties/travis/t3-record-id-key.mjs init`,
     never printed. The kit loader and `packages/deploy-build` both run on the operator's machine (section 21) and read
     the same file; the watermark and the run record carry its fingerprint (`a85dc5bf94154a97`), and a load with a
     missing or different key stops. The operator keeps one copy off the machine: with the key lost, the next load
     re-keys the sole-owner outlets once (`--allow-rekey`, recorded as `rekeyed`), and nothing else changes.
   - Applied 2026-10-17: the snapshot keys withheld rows by that id (the one-time change: 9,471 rows re-keyed, none
     removed); a re-load is a no-op; the privacy check finds no number, no captured-row hash, no plain-recipe id and no
     key material in any derived file, and 9,471 distinct keyed ids; no record id is shared by two records in any
     snapshot. `api-contract.md` change control, 2026-10-17.
3. **`license_record_id` for TDLR.** The recipe "license number and type" is not unique in the TDLR files: 121 A/C
   technician numbers are printed once as registered (`REG`) and once as certified (`CER`) under the same license type.
   The snapshot keys TDLR licenses by type, subtype and number. **Ruled (operator, 2026-10-17): approved.** The TDLR key
   is (type, subtype, number), a blank subtype the empty string, as a dated contract correction (`api-contract.md`
   change control, 2026-10-17). Applied: 459,993 TDLR licenses, 459,993 ids, none shared, none missing (the one row
   without a subtype now has an id); the snapshot and the licensing watermark are unchanged.
4. **Who counts as an individual owner.** The privacy rule (`travis-t3-privacy.v1`) withholds the taxpayer number of
   every sales-tax row of organization type `IS` (sole owner), whatever the number's form, and treats no other type as a
   natural person. No number in the capture has the leading 2 of SSN-based numbers, but the record layouts that define
   the organization codes and the number forms (Socrata attachments of `jrea-zgmq` and `9cir-efmm`) were not captured;
   the classification rests on the code names and the data (no `IS` name carries an entity word). **Ruled (operator,
   2026-10-17): capture the two layouts in the next US window, at the same VPN moment as the TSBPE re-run.** Applied:
   the window source `comptroller-record-layouts` (resolved at fetch time from each dataset's metadata, behind the same
   egress guard and receipts) and one command for both,
   `node src/counties/travis/t3-vpn-fetch.mjs --only tsbpe-responsible-master-plumber,comptroller-record-layouts`; the
   offline step `t3-load.mjs --only layouts` (`travis-t3-layout-check.v1`) then checks the organization codes and
   number forms against the privacy rule and reports any change.
   **Outcome (2026-10-17, window run `20261017T192341Z`):** both layouts print the same table of 79 organization codes,
   one-letter codes included, and two sole-owner types: `IS` "INDIVIDUAL - SOLE OWNER" (9,471 Travis outlets) and `S`
   "SOLE PROPRIETORSHIP" (0 rows). Neither mentions Social Security numbers, and no taxpayer number of any type in the
   capture starts with 2. Following this ruling (classify by the layouts), the rule became `travis-t3-privacy.v2`,
   which withholds `IS` and `S`; the re-load rewrote the sales-tax snapshot under the new version and changed no row.
   The layout check now reports `consistent` (kit `docs/evidence/travis-t3-record-layouts-2026-10-17.json`).
   **Ruled (oracle agent, on the operator's delegation, 2026-10-17): `PI` "IND GENERAL PRTNSHP" (365 Travis outlets of
   348 taxpayers), `PZ` "IND SUCCESSOR PRTSHP" (0), `ES` "ESTATE" (1) and `TR` "TRUST" (4) are not withheld.** The rule
   exists so that no number derived from a Social Security number is stored or served, and only a natural person has
   one. A partnership, an estate or a trust is a taxpayer of its own, with an employer number or a Comptroller-assigned
   number: these rows print first digits 3 (Comptroller-assigned; 305 rows) and 1 (employer-number-based; 65), never 2.
   The layouts list them apart from the two sole-owner types, and the franchise file, which holds only taxable entities,
   prints the same types (PI on 1,308 rows statewide). The partners' names a `PI` row may print are the partnership's
   name as published, served like any other business name. The layout check guards the ruling at every load: a new
   sole-owner code, a withheld code described otherwise, or a visible number with the leading 2 turns it to `differs`.

## 25. 2026-10-17 (night): T4 results, the corrections applied, and five points open for the operator

T4 ran on the operator's go of 2026-10-17 (`docs/progress.md` T4; kit `docs/evidence/travis-t4-run-2026-10-17.json`;
findings section 14). Egress was RO throughout; the only hosts contacted were data.austintexas.gov (which answers any
country) and the lexicon manifest. No TCAD, TNR or `*.texas.gov` request was needed or made.

**Applied in T4 by the agent, for the operator's review at the T4 checkpoint:**

1. **Harvest shape.** One GET per (`permittype`, `calendar_year_issued`) partition, planned from the dataset's own
   group-by counts (270 requests, the largest partition 21,926 rows), replaces section 4's "one bulk GET ... or SODA pages
   with `$offset`". A permit never changes partition, so the request that captured it is the same in every run: its
   `source_http_request` (section 3) stays put when rows are added elsewhere, and an unchanged permit keeps its record CID
   from run to run (sections 6 and T10). The 7 applicant fields are never requested (the T1 privacy classification), and
   neither is `issued_in_last_30_days`, which the publisher recomputes daily.
2. **`tcad_id` evidence v2.** The "seven-character" values of 2026-10-16 are the Williamson Central Appraisal District
   account form, `R` and six digits (103,848 rows, plus 21 printed `WCAD`; 89,550 of the 89,564 with coordinates lie north
   of latitude 30.40). They get the reason `williamson_cad_account_form` and still end `invalid_quarantined`; the
   proposed scope rule for them is point 6.
3. **Work classifier v2.** v1 tested accessory terms before the new-building rule, so 42,287 new buildings (a new
   residence "with covered porch" or "att carport", or one "W/No Gar Or Carport") were `accessory_roof` and 4 more
   `needs_review`. v2: a `New` permit in a new-building class is `primary_roof_new_construction` unless its text names only
   replacement work (56 legacy re-roofs coded `New` stay re-roofs) or only repair work (6 rows). Where such a permit is
   `Final` with a completion date, the roof-age anchor moves from the built year (low) to new construction (medium). The
   term vocabulary is unchanged; new terms still go through section 20's review loop.
4. **Property Improvement records.** Printed facts only: `permit_number`, and the applied, issue, completion and close
   dates the profile confirms (the close date only for `Final`). The four enums the class requires are written as null
   (point 7). No `parcel_has_property_improvement`: section 16 allows at most one, and no single permit is the parcel's
   permit. Everything else goes to a sidecar beside `data/`. The Seed root and the shared property, address and parcel
   files are copied byte for byte from the appraisal output, so both archives give each property the same CID (checked
   on the pilot and on the 1,000-parcel run).
5. **Failure path.** The real pilot produced no failure, so a labelled fault drill on the pilot seed exercises it: an
   injected permanent failure stays `failed_permanent` on `--resume`, and an injected timeout is `failed_retryable` and
   completes on `--resume`. The drill is a separate run; its numbers are in no count of record.

**Open for the operator, each with the agent's recommendation:**

6. **Williamson County rows.** Recommended: treat the 103,869 Williamson-form permits as outside Travis. That means a
   dated contract correction before T7's first deploy, adding `out_of_county` to `unlinked_reasons`, plus a limitation
   "Austin permits on Williamson County parcels" with the count, and leaving them out of the Travis permit totals. The
   alternative is to keep them `invalid_quarantined` (T4's state), which overstates Travis's unlinked share by 4.4 points.
   **Ruled (operator, 2026-10-18): approved.** Applied as `travis-parcel-link-v2` (kit `ad17d92`): the 103,869 permits are
   `out_of_county`; `invalid_quarantined` keeps 178. Contract correction dated 2026-10-18 (`api-contract.md` change control);
   the run record lists them under `limitations`.
7. **The four required enums.** Recommended: publish `improvement_type` from the printed `permittype` code, one to one
   on every row (`BP` GeneralBuilding, `EP` Electrical, `MP` MechanicalHVAC, `PP` Plumbing, `DS` DrivewayPermit). Keep
   `improvement_status`, `improvement_action` and `contractor_type` null: `Expired`, `Active` and `Pending` have no
   faithful status member, `work_class` values such as `Addition and Remodel` or `Shell` have no one-to-one action, and no
   contractor type is printed. The alternative is all four null (T4's state). Either way T5 writes the choice once, and
   the first published CIDs carry it.
   **Ruled (operator, 2026-10-18): approved, "but just double check"; then reconciled with the `mew` check and applied as
   versioned exact-value tables (`travis-improvement-enums-v1`, permit transform v2, kit `d81e9a6`).** Verified against the
   live schema (`property_improvement` `bafkreid5jnt3…`, whose cached bytes hash to the CID the live manifest
   `7084b933…` names) and the full capture (evidence: kit `docs/evidence/travis-t4-ruling-7-enum-check-2026-10-18.json`).
   A printed value is matched exactly; anything unlisted is null; all four properties are nullable, so a partial table is
   the lexicon's convention.
   - `improvement_type` from `permittype` (each code prints one `permit_type_desc`): BP `GeneralBuilding` 521,351, EP
     `Electrical` 689,152, MP `MechanicalHVAC` 506,530, PP `Plumbing` 547,025, DS `RightOfWayPermit` 116,649; null 0%.
     DS is `RightOfWayPermit`, not the `DrivewayPermit` recommended above: Austin Transportation and Public Works lists
     "Driveway/Sidewalk (DS)" among its right-of-way permit types, for "any kind of driveway, sidewalk, curb, or gutter
     work" (page captured with a receipt), and 2,452 DS rows are sidewalk, curb or gutter only.
   - `improvement_status` from `status_current`: `Final` `Completed` 2,010,298; `Active` `Permitted` 27,902 (issued, every
     row prints an issue date, with no evidence that work started, so never `InProgress`); `On Hold` `OnHold` 70; `Cancelled`
     and the two `Cancelled - …` values `Cancelled` 810; null 14.35% (`Expired`, `VOID`, `Withdrawn`, `Aborted`, `Pending`
     and the rest have no faithful member).
   - `improvement_action` from `work_class`, building permits only: `New` 193,699, `Repair` 51,093, `Addition` 29,442,
     `Remodel` and `Remodel Mobile Home` `Alteration` 187,701, `Demolition` `Remove` 21,449 (92.72% of BP rows); null for
     `Addition and Remodel`, `Shell`, `Interior Demo Non-Structural`, `Life Safety`, `Relocation`, `Fireline`, blank and every
     non-BP row (79.70% of all rows). A trade or driveway permit filed under a building permit carries its parent's work
     class (EP 98.8%, MP 99.1%, PP 89.8%, DS 91.0% of those whose parent is in the capture), so on them the field names the
     project. Caveat: the field is Austin's filing category, so the 23,290 permits the profile reads as re-roofs publish
     `Alteration` 19,986, `Repair` 2,335, `Addition` 248, `New` 72, `Remove` 9 and null 640; the roofing signal stays the
     profile's.
   - `contractor_type` from `contractor_trade` (five printed values over all rows): `General Contractor`
     `GeneralContractor` 565,111; `Electrical`, `Mechanical` and `Plumbing Contractor` `Specialist` 866,726; blank null
     39.86%.
   Corrections of this section's own statements: `contractor_trade` is printed and collected, so "no contractor type is
   printed" was wrong; re-roofs are filed mostly `Remodel`, not `Repair`. No point of `mew`'s check is disputed. The README's
   open and long-open permit questions (README.md 13, 105, 110) are answered from the printed `status_current` of the run
   capture (`api-contract.md` lines 86-90, 404), not from `improvement_status`. Pilot and feasibility re-run under v2:
   0 validation errors (runbook section 6 has the new roots).
8. **Applicant fields.** The contract's `PermitDetail.applicant` ("as printed") contradicts the T1 privacy
   classification, under which applicant fields are not collected; the harvester follows the classification.
   Recommended: keep them uncollected and correct the contract before T7's first deploy, so that `applicant` is always
   null with the reason "not collected: personal contact fields". The alternative is to collect `applicant_org` only,
   after a privacy review.
   **Ruled (operator, 2026-10-18): approved.** Contract correction dated 2026-10-18: `PermitDetail.applicant` is always
   null, with `applicant_unavailable_reason: "not collected: personal contact fields"`.
9. **Published scope, and the 48-hour gate.** Section 3 sets the `property_improvement` scope from the measured
   throughput. The source acquisition takes 0.09 hours, so the kit's per-source gate holds. The full run with every
   exactly linked permit of all five types (1,978,992 permits on 232,640 parcels) projects to 59.97 hours sequentially,
   past the gate: `elephant-cli validate` of the County group alone takes 44.2 hours. With the CLI chain on 8 concurrent
   shards per group (measured on the 1,000-parcel run) it projects to 15.47 hours. Recommended: T5 publishes all five
   types and runs the CLI per 5,000-property shard, up to 8 shards in flight per group. The group stays
   `supported_partial`: it covers Austin only, and 16.9% of the export's rows do not link. The alternative, building
   permits only (435,019), shortens the permit group's CLI stages but not the County validation, which dominates.
   **Measured at the operator's request (2026-10-18), before the ruling below** (kit `docs/evidence/travis-t4-point-9-measurements-2026-10-18.json`).
   - Benchmark of the CLI chain (validate, hash, CAR validate, export-tables) on the 1,000-parcel run, two passes each, peak
     memory of the CLI processes together: County 8 shards 94.8 s and 204.6 s (7.7 and 6.1 GB), 10 shards 133.5 s and 173.7 s
     (8.9 and 7.8 GB), 12 shards 158.7 s and 157.5 s (9.3 and 8.8 GB); Property Improvement (530 parcels) 8 shards 39.1 s and
     45.2 s (4.1 and 4.0 GB), 10 shards 43.5 s and 46.7 s, 12 shards 46.1 s and 53.4 s (up to 5.9 GB). The night before, with
     memory free, 8 shards took 85.2 s and 21.9 s. Projected full run: 18.99-33.28 h on 8 shards, 24.32-29.67 h on 10,
     27.75-28.58 h on 12, 62.41 h sequential. The swap file was nearly full during the passes (14.4 of 15.4 GB, a virtualization
     VM of about 4 GB resident): 8 shards is fastest when memory is free, 10 and 12 add processes on the two efficiency cores
     and 1-2 GB without gaining time; every sharded variant stays inside 48 hours.
   - Network of the T5 full run: the runner's one request is the lexicon manifest (`--manifest <file>` avoids it); the
     Socrata cross-check is only the pilot flag `--cross-check-socrata`; no Socrata, TCAD or TNR request otherwise. Each
     `elephant-cli` call also checks npm for a newer version and exits 1 if one exists (`ELEPHANT_SKIP_UPDATE_CHECK=1` turns
     it off), validate and hash fetch the lexicon manifest again, and schemas come from `~/.elephant-cli/schema-cache` (IPFS
     gateways only on a miss).
   - Projected published size per run, from the 1,000-parcel run: County 3.57 GB of CARs and 1.02 GB of table parts, 4.25 GB
     distinct, 8.49 GB as Filebase counts it; Property Improvement 4.33 and 0.39 GB, 4.51 GB distinct, 9.02 GB counted; together
     about 8.8 GB distinct and 17.5 GB counted (the tables DAG links the archive, so archive and parts count twice; the formula
     reproduces T2's 505,699 counted bytes). 74% of a permit record is its partition request, mostly the 60-column `$select`.
   - Checkpointing for T5 (design): shards of at most 5,000 properties assigned from the sorted PROP_IDs; the per-parcel
     stages are already resumable by fingerprint; each shard stage writes to a staging name and, on success, an atomic marker
     with its input and output digests, so a resume skips matching markers and reruns only the stages in flight; the run
     runs under `caffeinate -i`.
   - Recommendation, unchanged in substance: 8 shards per group with memory headroom (close the VM and heavy apps for the run),
     `ELEPHANT_SKIP_UPDATE_CHECK=1`, the manifest digest checked at start and end.
   **Ruled (operator, 2026-10-18): approved.** T5 publishes all five Austin permit types, every linked permit (the count
   after point 10's ruling is recorded there). The CLI chain runs per shard of at most 5,000 properties, 8 shards in
   flight per group: the fastest setting measured when memory is free. Design notes for T5 (recorded here, not built in
   T4):
   - **Done-markers.** Each shard stage (validate, hash, CAR validate, export-tables) writes to a staging name; only after
     the CLI exits 0 and its output parses is the output renamed and `shards/<id>/<stage>.done.json` written atomically,
     with the input digest (sorted per-parcel file digests, lexicon manifest SHA-256, CLI version) and the output digests
     (CAR SHA-256, roots). A resume skips every stage whose marker matches the recomputed input digest and reruns the rest,
     so a crash or a sleep redoes only the shards in flight. Shards are assigned from the sorted PROP_IDs, so a rerun
     builds the same shards.
   - **Update check off.** The run exports `ELEPHANT_SKIP_UPDATE_CHECK=1`: otherwise an npm release during the run makes
     every later `elephant-cli` call exit 1 with "update required". The CLI stays pinned at 1.58.1 (`44bb182`), and the
     lexicon manifest SHA-256 is recorded at the start and the end; a change stops the run.
   - **Memory first.** During the measurements the Colima/Docker VM held about 4 GB and the swap file was nearly full
     (14.4 of 15.4 GB), which doubled the 8-shard County time (94.8 s, then 204.6 s, against 85.2 s with memory free). Before
     the start: stop the VM, close heavy apps, and check `sysctl vm.swapusage`.
   - **No sleep.** The run runs under `caffeinate -i`; a lid-close or a forced sleep counts as a crash and resumes from the
     markers.
10. **Retired `geo_id`s.** 196,400 permits print one of 6,260 ten-digit ids that no 2026 account prints (their share
    rises to 14.6% for the 2020s, which fits tracts subdivided after the permit). Recommended: keep them `no_candidate`
    and list the count under limitations. Attaching them would need a TCAD parcel-lineage source (splits and merges),
    and looking for one needs US egress; only worth a slot in a VPN window that is already planned.
    **Investigated from RO on 2026-10-18 at the operator's request** (kit `docs/evidence/travis-t4-retired-geo-ids-2026-10-18.json`;
    every capture with a receipt; public files only):
    (a) TCAD. The 6,260 ids are on no 2026 account of any type (all 493,324 PROP.TXT records; 63 permits sit on mobile-home
    ids). The export layout has no prior, parent or split field. The 2026 Certified Special Export (JSON, 3.55 GB, free,
    answers from RO) has no prior geo_id either, but its `links` tie current accounts to 76,477 account ids that no longer
    exist, its land comment report (206,939 comments) names splits and merges between account ids ("SPLIT OUT OF 787408"),
    and its `permits[]` lists TCAD's own permits per account. The EARS "parent account" is an economic-unit grouping.
    (b) TNR GIS does not answer from RO (connection timeout); whether it keeps historical parcel layers needs US egress.
    (c) Austin publishes past parcel snapshots: Land Database 2021 and the Land Use Inventory of 2022 and 2026, each pairing a
    10-digit parcel id with the account id of its day. They print 5,873 of the 6,260 ids, beside account ids 5,871 of which
    are gone from the 2026 roll: the ids belong to retired accounts.
    Lineage therefore exists between accounts, reached through those snapshots, but it ends in several current accounts, the
    lots of a split: through TCAD `links`, 4,164 ids reach current accounts and 4,047 of them reach several; through land
    comments, 230 ids, 221 of them one account (8,959 permits).
    (d) Point-in-polygon of the permit's own coordinates against the 2026 TNR polygons: `query-db-loading-matching` allows
    location or address evidence only as an explicit fallback with its method, version and confidence, so it would be a
    separately labelled candidate method (and a `property_link.match_method` the contract does not list). It is 99.8%
    precise on permits that already link exactly, but only 4,618 of the 162,389 retired-id permits with coordinates fall in
    one polygon: 157,771 fall in none, where the layer has no polygon yet for the new lots and condominiums. TCAD's own
    permit listing names one current account for 7,531 of them (97.4% agreement with exact links where both exist), and a
    unique street line for 25,641 (99.07% precise on exact links). All methods together reach 35,713 of the 196,400 permits;
    160,687 (81.8%) are reached by none.
    (e) README impact if they stay unlinked: 23,250 roofing permits (11.3% of all roofing permits), 700 open (15.9% of open
    roofing permits) and 849 stalled roofing permits are loaded internally and counted under `limitations` but shown on no
    property (README.md 13, 105, 110). Roof age loses at most the medium or high anchor of 3,070 parcels that have none from
    an exact link and whose permit TCAD lists (their age falls back to the built year, low confidence); all methods together
    would reach 6,881 roofing, 155 open and 222 stalled roofing permits.
    **Recommendation:** keep `no_candidate` with the limitation and its counts for T5; the proof above shows that no public
    source attributes most of these permits to one current parcel, and the reachable share of open roofing permits is 155
    of 700. If the operator wants the rest of what is reachable, the one fallback backed by an official source is TCAD's own
    permit listing (`match_method: tcad_permit_listing`, its own version and a `candidate` confidence, a dated contract
    correction): 7,531 permits, 4,024 roofing, 21 open roofing. Street line and point-in-polygon stay out (address-grade
    evidence for 99% precise but small gains). The TNR history question waits for a VPN window that is planned anyway.
    **Ruled (operator, 2026-10-18): option B approved, for roofing coverage.** Retired `geo_id`s stay `no_candidate` by
    default; one new, separately labelled method links through TCAD's own permit listing; the unique-street-address and
    coordinate methods are not added. Applied as `travis-parcel-link-v3` (kit `6025f17`, `00bea93`; evidence kit
    `docs/evidence/travis-t4-ruling-10-tcad-listing-2026-10-18.json` and the link proof `travis-t4-link-proof-v1792239863.json`):
    - **Source.** The 2026 Certified Special Export (JSON) already on disk from the study above, checked against its receipt
      (3,554,021,795 bytes, SHA-256 `6f7a7585…`) before it is read. Nothing was re-fetched, so no request went to
      traviscad.org. `t4-tcad-permit-listing.mjs` turns its `permits[]` into a permit-number index (493,246 accounts; 781,459
      permit numbers on 1,121,918 permit-account pairs; listing SHA-256 `7b2bf8e6…`), which the link pass rechecks before use.
    - **Precedence.** Exact `geo_id`, then the digits-only comparison, then the listing. The listing is read only for a
      ten-digit `tcad_id` that no current account prints, and it links only when it records the permit number on exactly one
      current (seed) account. Blank, shared, quarantined and out-of-county ids never read it. A listing on several current
      accounts, only on accounts outside the roll, or no listing at all leaves the permit `no_candidate`: the printed id still
      names no current parcel.
    - **Label.** `match_method: tcad_permit_listing`, `confidence: official_listing`, with the listing version
      (`travis-tcad-permit-listing-v1`) and the source digest on every link. TCAD's listed entries go to the permit sidecar.
    - **A link, not a candidate,** under `query-db-loading-matching` (permit/property matching 1-6). Exact source identity
      comes first and keeps precedence (rules 1-2). The listing is an explicit fallback (rule 3): it joins two printed
      identifiers (Austin's permit number and TCAD's account id) from the authority that issues the accounts. That evidence
      is stronger in kind than the address evidence the rule already admits as a fallback, and it applies only after the
      `geo_id` paths find no candidate. Unresolved permits keep null links (rule 4). Rule 5 asks to reconcile a related
      parcel to the target. Here the target is retired, so it is reconciled by measurement. On the 222,931 exactly linked
      permits that TCAD lists on one current account, the listing names the same account 97.30% of the time (98.33% where
      TCAD's own permit record names the printed id, 92.73% where it does not; roofing 97.19%). Per record, TCAD's record
      names the retired id the permit prints for 4,468 of the 7,531 links. Method, version, confidence and source hash are
      recorded (rule 6). In the skill a candidate is unaccepted evidence that is never linked, published or used for roof
      age. This evidence is accepted, so the method links. Correction of the recommendation above: it proposed a `candidate`
      confidence. Under these rules that word would mean "not linked", so the label is `official_listing`.
    - **Counts over the full capture (before → after).** Linked 1,978,992 → 1,986,523 (83.13% → 83.44%) on 232,640 → 237,533
      parcels. Recovered: 7,531 permits (BP 6,808, EP 523, PP 184, MP 15, DS 1) on 5,034 parcels, 4,893 of which had no
      link before; among them 4,024 roofing, 21 open and 142 stalled roofing permits, and 3,658 roof-age anchors. Still
      `no_candidate`: 251,888 (was 259,419): 63,019 with a blank `tcad_id`, plus 188,869 on retired ids (463 listed on several
      current accounts, 26 only on accounts outside the roll, 188,380 not listed). Unchanged: exact, `multiple_candidates`
      38,249, `invalid_quarantined` 178, `out_of_county` 103,869 and every profile count. The study's figures are reproduced.
    - **README impact now** (README.md 13, 36, 105, 110; the study evidence cites roof age as line 33, which is line 36):
      - Roofing permits shown on no property: 39,481 → 35,457 (on retired ids 23,250 → 19,226). Open roofing: 801 → 780
        (700 → 679). Stalled roofing: 1,222 → 1,080 (849 → 707).
      - Parcels with a permit roof-age anchor: 105,663 → 108,733. The 3,070 parcels whose anchor permit TCAD lists no longer
        fall back to the built year. 333,228 of 441,961 parcels have no permit anchor (built year, low confidence, or no age).
      - 15,395 anchor-eligible permits stay unlinked, on parcels no public source names; at most that many parcels fall back
        because of them.
      - Anchor-eligible means a completed primary roof (replacement or new construction) with a confirmed completion date,
        read with the profile's date evidence. This is why it counts 19,053 retired-id anchors where the study counted 19,057.
    - **Contract.** A dated correction (2026-10-18, `api-contract.md` change control) adds the new `match_method` value and
      its confidence. A roof-age anchor from such a permit adds the caveat `anchor_link_tcad_permit_listing` (T5's estimator
      input carries the link method). The Run's `sources[]` lists the special export. No other field changes.
    - **Runs.** Pilot, `__NONE__`, drill and feasibility were re-run at kit `8455bb5` with 0 validation errors. County roots
      are unchanged; the Property Improvement roots are new (runbook section 6). The pilot gains parcel 748284 (10 permits on
      the retired id `0108032001`); the feasibility sample gains 12 parcels and 22 permits. With 25.9, T5 publishes every
      linked permit, 1,986,523.

## 26. 2026-10-18: T5 phase A — the pre-run fixes, the sharded runner, and one point open before the full run

T5 phase A ran on the operator's go of 2026-10-18 (T4 approved): the pre-run fixes oracle recorded in the T5 row of
`docs/progress.md` on 2026-10-17, the full-run runner of the design approved in 25.9, the Loader, roof age, the run record
and a dry run with a resume proof. The full run itself has not started: the operator frees the machine's memory and starts
it with the one command of runbook section 7. Evidence: kit `docs/evidence/travis-t5-field-coverage-2026-10-18.json`,
`travis-t5-prefix-reruns-2026-10-18.json`, `travis-t5-dry-run-2026-10-18.json`.

**Applied by the agent, for the operator's review at the T5 checkpoint:**

1. **Transform v4 (the pre-run fixes).**
   - *One geometry per part.* A multi-part parcel keeps its point in `geometry.json` (the address's geometry, as before)
     and gets one `geometry_part_<n>.json` per polygon part with its outer ring, each linked by `parcel_has_geometry` (an
     array in the County schema): 616 parcels, 1,593 parts, all written; v3 wrote no polygon for them. A single-part parcel
     is unchanged byte for byte.
   - *Inner rings.* `geometry.polygon` holds one ring, so the holes of 284 parcels (605 rings, 135,508 vertices) are not
     written; each parcel's sidecar counts them (`geometry.inner_rings_dropped`) and the coverage record lists the gap.
   - *The TCAD fields with a lexicon home that T2 left unread*, read in one offline pass over the receipted 2026 export (58
     seconds; `t5-tcad-extras.mjs`, the seed builder's first-record rule): `structure` from `IMP_ATR.TXT` on 324,617
     accounts (roof material Composition 276,217, Metal 21,644, Tile 13,155, Wood 1,360; roof covering Built-Up Roof 7,443
     and Wood Shingle 1,360; roof design Hip 183,379, Gable 126,865, Flat 8,706, Mansard 615; foundation Slab on Grade
     296,134, Pier and Beam 24,374); `lot` from `LAND_DET.TXT` for 72,997 of the 73,334 accounts the roll prints without
     legal acreage; `tax.homestead_cap_loss_amount` from `ten_percent_cap` on 34,774 accounts; and the county, hospital
     district, college district, school and city taxable values of `PROP_ENT.TXT` (441,957, 441,954, 335,804, 441,219 and
     330,389 accounts). The rules are in point 26.8. The TNR feature is inventoried in the coverage record: 386,682
     features carrying `OBJECTID`, `PROP_ID` and `geo_id` (the three fields T1 requested), 697 of them MultiPolygons,
     13,130 without a PROP_ID, the layer's `geo_id` equal to the roll's on all 373,541 joined features.
   - *Roots.* County roots change, Property Improvement roots do not (the permit group copies property, address and
     parcel, which v4 keeps). Pilot: County CAR 493 blocks (was 471), root
     `baguqeerairotuzbwrkd5cxddtqv32u5ki6fqfhudsg2bmuddsf37xjp6yk3a`, 25 tables, root
     `baguqeeragnjfmjgtmcot5njwwgc7jbbhrlgi5lhsxmsfowj4t75agb6eif7q`. Feasibility: County CAR 21,938 blocks (was 20,138),
     root `baguqeera4fyfdfxvehuiqejspt2wxqive336mfuvnvbbn6h5bii4ps2sixaa`, 26 tables, root
     `baguqeera62zm5wsicpdl4tbyzkmwgb7qoba2cyt62bbxuyulbfiot442e3ua`. 0 validation errors on both; runbook section 6's
     County roots are T4's and no longer reproduce under v4.
2. **The runner (`t5-run.mjs`, the 25.9 design).** Shards of at most 5,000 sorted PROP_IDs (89 for the roll), one
   partition for both groups: a shard's Property Improvement group is the permit parcels of its County shard, so it holds
   at most 5,000 properties by construction (89 County and 89 Property Improvement archives, about 2,700 properties each on
   the permit side). Up to 8 shards in flight; each runs its County chain, then its Property Improvement chain, so at most 8
   `elephant-cli` processes run at once (the measured setting). Every stage writes to an attempt-numbered location and an
   atomic done-marker with its input digest (the files it read, the lexicon manifest SHA-256, the CLI version, the digest of
   the code it ran) and its output digests; a resume reruns only a stage whose marker is missing or no longer matches. The
   same start command resumes an unfinished run of its label. A property `elephant-cli validate` rejects is left out of the
   archives and tombstoned as invalid (none so far). The link pass streams every permit to one file per shard and to the
   internal permits table instead of holding them in memory.
3. **Loader, roof age, run record.** The internal store is file-based (`travis-sources.yaml` `destination.mode`): per-shard
   merge records behind a ready-hash gate, then an atomic finalize (a new generation and a `CURRENT` pointer) with
   content-aware watermarks per track and prefix, deltas against the generation in force, and dead, invalid and absent-key
   tombstones; the internal permits table holds every captured permit, linked or not. Roof age runs the kit's estimator per
   parcel with the Travis profile over the parcel's published linked permits and its published built year; a parcel with a
   linked permit has `partial` history, one without has `unknown` history; an anchor linked through TCAD's listing carries
   `anchor_link_tcad_permit_listing`. The run record has the contract's Run shape (`seed = ready + dead + invalid` checked,
   counts per table from the CLI's own exports, deltas, tombstones, evidence states, limitations, every CAR, timings, peak
   memory, tool versions, run history); `groups`, `manifest_cid`, `gateway_checks` and `atlas` stay empty until T6.
4. **Contract.** A dated correction: `evidence_states.tcad_id` gains `unknown` (63,019 blank ids), so the three states sum
   to the permit rows.

**Measured (dry run and projection):**

5. **Dry run.** Real seed rows (the first 5,000 PROP_IDs), cut into 20 shards of 250 so that 8 run in flight and each slot
   runs 2–3 shards, with the real CLI, the live manifest, the whole permit capture and TCAD's listing: 14 min 42 s; 5,000 =
   5,000 ready + 0 dead + 0 invalid; 80 CARs (archive and tables per group and shard), every CAR check 0; 55,539 permits
   published on 3,895 parcels; roof age for 4,625 parcels (435 completed replacement, 1,187 new construction, 3,003 built
   year; 3,733 older than 15 years), 375 without one; the internal permits table 2,380,707 rows; manifest `7084b933…` at
   start and end; `caffeinate` held.
6. **Resume proof.** The same dry run twice more, killed mid-shard and resumed by the same command. SIGTERM at 8 of 20
   shards: the runner stopped its two `elephant-cli` processes and exited 143 within 6 seconds; the resume reran the 3
   stages in flight. SIGKILL at 6 of 20: exit 137, the two CLI processes ended with their pipes; the resume reran the 8
   stages in flight (two queued Loader merges, three County validations, two permit transforms, one appraisal). In both,
   every stage a finished shard had kept its first marker, and all 261 compared stage outputs equal the uninterrupted run's
   (CAR SHA-256s and roots, tables, the validate and CAR-check CSVs, roof age, the query table, the per-parcel artifact
   digests, the link files). The CLI's per-property ZIPs under `hashed/` carry file times and differ byte for byte; the CAR
   that holds their blocks is identical.
7. **Projection** (swap at 5.5 of 7 GB throughout, as during the T4 passes): 14.48 hours from the dry run's own stage
   times, 14.46 hours by T4's method on the v4 feasibility sample (59.13 hours sequential); both within the 48-hour gate.
   About 125 GB of disk (231 GB free). Memory: the runner alone peaks at 6.1 GB during the link pass, before any CLI
   process; in the shard pool the runner holds under 1 GB, and one `elephant-cli` process grows only slowly with its shard
   (0.91 GB at 250 properties, 0.98 GB at 1,000, 1.05 GB at 5,000, measured on one full-size County shard of the dry run's
   parcels in one process: 31.6 minutes, 112,446 blocks, every check 0), so 8 full-size shards in flight peak at about 9
   GB with the runner. Kit `docs/evidence/travis-t5-dry-run-2026-10-18.json` holds the runs, the comparison and the
   benches.

**Open for the operator:**

8. **The exact-value tables of transform v4.** Like 25.7's enums, they go into the first published County CIDs, and
   changing one after the full run means rerunning the County chain of every shard (about 10 of the 14.5 hours). Applied:
   - `IMP_ATR` "Roof Covering" (printed codes, cut at 10 characters): `BUILT-UP` → `roof_covering_material` "Built-Up
     Roof"; `WOOD SHING` → "Wood Shingle" and `roof_material_type` "Wood"; `COMPOSITIO`, `METAL` and `TILE` →
     `roof_material_type` "Composition", "Metal", "Tile" only, because each names a material and not one of the covering
     members (3-tab or architectural shingle, standing seam or corrugated, clay or concrete tile); `OTHER` → nothing.
     "Roof Style": `FLAT`, `GABLE`, `HIP`, `MANSARD` → `roof_design_type`; `A-FRAME`, `BARN`, `OTHER` → null. "Foundation":
     `SLAB` → "Slab on Grade", `PIER AND B` → "Pier and Beam"; `BLOCKS`, `FLOATING S`, `WOOD POST`, `OTHER` → null.
   - One structure per property (`property_has_structure` is single-valued): a field is written only when the account
     prints one code for its attribute over all its improvements; 2,460 accounts print several roof coverings, 3,472
     several roof styles and 2,625 several foundations, and those fields stay null. `roof_age_years` and `roof_date` are
     never written (section 5).
   - `lot` from the land segments only where the roll prints no legal acreage: the summed square feet, and the acres only
     when they agree within 1% (409 accounts keep square feet only).
   - `tax`: `homestead_cap_loss_amount` when `ten_percent_cap` is positive (like the agricultural value); per class (county
     = TRAVIS COUNTY, hospital = TRAVIS COUNTY HEALTHCARE DISTRICT, college = AUSTIN COMM COLL DIST, school = a name ending
     in ISD, city = CITY OF or VILLAGE OF), the taxable value of the one entity of that class on the account; 738 accounts
     in two school districts and 26 in two cities leave that field out. Special districts (an account sits in several),
     per-entity exemptions and an account-wide taxable value (not printed) are not written, nor is `IMP_INFO`'s improvement
     type (no one-to-one property form or building count).
   Recommended: approve as applied. A `mew` check of the tables against the live schemas, as for 25.7, costs minutes and
   is best done before the start; nothing else waits for it.

   **Ruled 2026-10-18 (operator, "go with the fix"), after mew's read-only check against the live manifest
   (`7084b933…`; structure, lot, tax, County and relationship schemas re-hashed against their CIDs):** every applied
   value confirmed; `FLOATING S` → `foundation_type` "Slab on Grade" (5 accounts; a floating slab is a slab on grade),
   mapping `travis-tcad-extras-mapping-v2` (kit commit after `5225bcc`). Not taken: `BARN` → "Gambrel" (194 accounts),
   an inference the printed code does not make, by the standard that keeps `COMPOSITIO` off the covering members.
   Several structures per property stay out of v1: the lexicon reaches them only through building layouts
   (`property_has_layout` → `layout_has_structure`), not a pre-run fix.

## 27. 2026-10-19: T5 phase B — the full run reconciled, three deviations explained, three points ruled and applied

The operator ruled points 9-11 on 2026-10-19. Points 12-18 record what was applied: the scoped rerun is attempt 2 of
the same run. Points 1-8 are the phase B record of attempt 1, as written then.

The full run `20261018T143520Z-t5-full` (kit `962f851`, CLI 1.58.1, lexicon manifest `7084b933…` at start and end) was
started on 2026-10-18 at 14:35:20Z by the coordinator at the operator's request and printed `done` at 2026-10-19
03:14:36Z (12.23 hours to the run record). Phase B reconciled it offline; nothing was re-run, uploaded, pinned or
registered. Evidence: kit `docs/evidence/travis-t5-run-20261018T143520Z.json` (the phase B run record), the run's own
`run.json` (SHA-256 `a0732ed3…`, copied byte for byte to `runs/20261018T143520Z-t5-full.json`), and
`src/counties/travis/t5-reconcile.mjs`, which recomputes every number below in about 70 seconds.

**Reconciled (the T5 check of section 2 item 5):**

1. **`seed = ready + dead + invalid`: 441,961 = 441,924 + 37 + 0.** All 1,157 stage markers of the 89 shards match
   their recomputed inputs, with the code as of `962f851`. The full verification re-hashed every output the markers
   name: 683,895 files, 28.33 GB, 271 seconds, all equal. The permit capture verifies against its receipts (270
   partitions). The Loader generation matches its marker and is the one in force. `run.json` equals the record
   rebuilt from the markers.
2. **CARs.** There are 177 archives, and every one passed all six `elephant-cli validate` checks with 0 errors:
   - County: 89 archives, 9,689,788 blocks, 441,924 properties;
   - Property Improvement: 88 archives, 5,398,330 blocks, 237,531 properties.
   There are also 177 tables CARs: County 26 tables in 2,313 parts, Property Improvement 7 tables in 616 parts.
3. **Counts per table (the CLI's own exports).**
   - County: property, parcel, `property_has_address`, `property_has_parcel`, `address_has_parcel`, tax and
     `property_has_tax` 441,924 each.
   - Addresses: 883,548 (441,924 situs, plus 343,957 person and 97,667 company mailing addresses).
   - Geometry: `address_has_geometry` 373,482; geometry and `parcel_has_geometry` 375,022. That is 373,482 points plus
     1,540 polygon parts: the seed's 1,593 parts on 616 multi-part parcels, less 53 parts on 2 dead accounts.
   - Other County tables: lot 441,587, structure 324,617, sales history 423,970, person 343,957, company 97,667.
   - Property Improvement: `property_improvement` and `property_has_property_improvement` 1,986,484 each; property,
     address and parcel 237,531.
   - Internal tables: permits 2,380,707, query table 441,924, roof age 441,924.
4. **Permits.** Captured 2,380,707, linked 1,986,523, made up as follows:
   - exact `geo_id` 1,978,992;
   - `tcad_permit_listing` 7,531.

   The unlinked rows:
   - `no_candidate` 251,888;
   - `multiple_candidates` 38,249;
   - `invalid_quarantined` 178;
   - `out_of_county` 103,869.

   Published: 1,986,484 on 237,531 parcels. That is the linked total less 39 permits on 2 dead accounts (554109,
   986147), which stay internal. All three evidence-state maps sum to the capture.
5. **Roof age.** 441,924 parcels; 390,210 have an age (eligible):
   - 12,199 rest on a completed primary-roof replacement (high confidence);
   - 96,601 on a completed new-construction roof permit (medium);
   - 281,410 fall back to the published built year (low).

   51,714 parcels have neither and get no age. 276,667 are older than 15 years. The 108,800 permit anchors date from
   the `completed_date` (35,161) or, on a Final permit, the status date (73,639); 3,086 came through TCAD's listing.
   T4's link-pass figure was 108,733 under the stricter rule of a confirmed `completed_date`. The difference is exact:
   2 of those parcels are dead, and 69 parcels the estimator anchors on a Final permit's status date have no
   `completed_date`.
6. **Loader.** This is the first generation of scope `full`, so there is no prior and every delta is new:
   441,924 appraisal, 237,531 permit groups, 2,380,707 permits. 37 dead tombstones, 0 invalid, 0 stale rows removed.
   Three content-aware watermarks:
   - appraisal: 441,924 merged;
   - permit capture: 270 partitions, 2,380,707 rows;
   - permit groups: 237,531 groups, 1,986,484 rows.

   The seven T3 registry and licensing watermarks are unchanged. The run history holds one finalize, at 02:47:43Z,
   with its state digest.
7. **Limitations.** All 18 are still true, and their numbers recompute from the record's own counts. They miss four
   things:
   - the 22 accounts with no situs street (a source fact);
   - the 3 accounts with the street in shifted columns (point 10);
   - the 12 accounts the bounding box refused (a pipeline defect, point 9);
   - the 39 permits (6 roofing) on dead accounts, which make 35,463 roofing permits shown on no property, not the
     35,457 listed.

   `run.json` is not edited by hand, since `--verify` proves it equals what the markers imply. The record builder
   gains the four items with the fix of point 9, which rewrites `run.json`, or at the latest when T6 writes the
   published record.

   **Applied 2026-10-19 (point 16).** The 12 and the 3 are published. The record lists 20 limitations. The two new ones:
   - the 22 accounts with no situs street (`no_situs_street`);
   - the 39 permits (6 roofing) on 2 dead accounts (`linked_to_dead_account`).

   The roofing item now reads 35,463 roofing permits shown on no property. Of these, 35,457 link to no property and 6
   sit on dead accounts. The reconciliation finds nothing missing.

**Deviations, explained:**

8. **37 dead, not 25.** Every one is a permanent failure in the appraisal stage, from the transform's own guards. None
   reached `elephant-cli`.
   - **25: the T2 roll rows with a blank situs street.** In 21 of them the roll prints no situs part at all, and
     773537 prints only a house number: the source lacks the street. In the other 3 the roll prints the street one
     column to the right (point 10).
   - **12: refused by `assertGeometryInCounty`** (adapter `validate.mjs`, box 30.02–30.63 N, −98.17 to −97.37 W).
     These are county-line accounts on Hamilton Pool Rd, Round Mountain Rd, Zurga Ln, Cow Creek Rd and County Line
     Rd, in shards s0039 (6), s0040, s0066, s0067 (2), s0068 and s0081.
     - For 10 of them only polygon vertices lie past the box; for 2 the centroid does too (by 1 m and 770 m). The
       worst vertex is 1.5 km past the box.
     - TCAD appraises them and the TNR layer draws them. That layer's own centroid extent reaches −98.178 W and
       30.6287 N, while the contract calls the box "about" the county.
     - **This is a pipeline defect, not a source fact.** None of the 12 has a linked permit. The dry runs, on the
       first 5,000 PROP_IDs, never reached them.
   - Cost of fixing it is point 9.

   **The other deviations:**
   - **354 CARs, not 356.** Shard s0089 holds the 1,961 newest accounts (PROP_IDs 1012767–1020110) and has no
     Property Improvement group, so it has no archive and no tables CAR. Only 7 of its 1,955 `geo_id`s appear on any
     permit (618 permits). Each of the 7 is shared with an older account, two or three accounts per id, so the ruled
     link rule leaves all 618 as `multiple_candidates` and none links. This is a source fact under the ruled rule.
   - **The runner did not exit.** Pid 15367 stayed alive after `done` at 0% CPU, with its `caffeinate` child.
     - A read-only `sample` of the process shows the event loop had ended and C `exit()` was running. The main
       thread is in libuv's `uv__threadpool_cleanup`, in `uv_thread_join` (Node 22.22.0, libuv 1.51.0, macOS 26.5),
       with 3 of the 4 workers parked in `uv_cond_wait`. No JS can run, so nothing more can be written.
     - It is not the lexicon fetch's keep-alive (no TCP socket is open), not the progress interval (unref'd and
       cleared) and not `caffeinate` (it waits for its parent with `-w`).
     - It did not reproduce on a 60-parcel whole-seed run or on the three dry runs.
     - **Fixed in kit `6107969`.** `main()` flushes its output and calls `process.exit(code)` on every path. Before
       that it arms a detached watchdog, which sends SIGTERM and then SIGKILL if the runner is still alive 30 s after
       exiting. It never touches a process whose command line no longer names `t5-run`.
     - Tested: a real runner child with a leaked handle exits 0 right after `done`, and the test fails without the
       fix.
     - **Stopping 15367 is safe:** `kill 15367`, and `kill -9 15367` if it is still there after 5 seconds.
       `caffeinate` (15384) ends with it.
   - **Timing and resources.** Wall time was 12.23 h against the 14.5 h projected. Peak memory was 12.2 GB for the 8
     CLI processes (12.8 GB with the runner), against the ~9 GB estimated. Swap went from 5.5 to 4.9 GB, with no
     growth. 25 of the 27 finalize minutes are the record's disk figure: `bytesUnder` stats about 50 million entries, 569,504 in one full shard.
     The run directory holds 66.1 GB of file bytes and takes 125.8 GB allocated (phase A estimated about 125 GB); the Loader scope takes 2.5 GB.
   - **Resume is now a no-op on a finished run.** Before phase B, the same start command would have started a new
     run in a new directory: `latestUnfinished` skips finished runs, so the operator could have started a 12-hour run
     by mistake.
     - Since `6107969` it only verifies the finished run, read-only, in about 5 seconds, then exits 0. Nothing at any
       depth of the run or Loader directory changes.
     - `--verify` also re-hashes every output (about 4.5 minutes). `--new` starts a new run. `--reopen` reruns a
       finished run in place.
   - **Sizes (for T6's Filebase and Pinata plans), measured from the CARs block by block and the part files:**
     - County: 4.974 GB distinct, 9.947 GB as Filebase counts it.
     - Property Improvement: 4.471 GB distinct, 8.942 GB counted.
     - Together: 9.445 GB distinct (9.065 GB without the 0.38 GB of property blocks both groups share) and 18.889 GB
       counted.
     - The estimate of 25.9 was 8.76 and 17.51 GB. County grew 17% with transform v4's extras (structure, lot, tax,
       geometry parts); Property Improvement is 1% under.

**Ruled by the operator (2026-10-19):**

9. **The 12 accounts the bounding box refused** (a pipeline defect). The fix: the adapter validates against the
   wider box the seed builder already uses (29.95–30.75 N, −98.25 to −97.30 W). That box contains every TNR centroid
   and every vertex of the 12. A 1-line change plus a test.

   The difficulty: `validate.mjs` is part of the code digest of every shard's appraisal and permits stages.

   - **A — scoped rerun before T6 (recommended).** Rerun shards s0039, s0040, s0066, s0067, s0068 and s0081 (with
     s0084 if point 10 is taken) under the fixed guard. Re-certify the other 82 shards' markers in place: each keeps
     its outputs and records its old input digest and why.

     This is sound because the guard only decides whether a parcel is refused, and the reconciliation shows these 12
     are its only refusals in the roll. A new runner option, with a test, is needed: about 1 hour to build.

     Running it takes about 1.5 hours:
     - the 7 County chains in parallel, about 50 minutes (validate 44–45 minutes each);
     - the Property Improvement chains and merges, about 12 minutes;
     - the finalize and the record, about 27 minutes.

     It needs about 13 GB of disk. County roots change for those shards only; the record gains the four missing
     limitations.
   - **B — `--reopen` as built.** Every shard's appraisal and permits stages rerun, about 36 minutes at 8 in flight,
     and the link pass reruns because `t5-run.mjs` changed since the run. Then the same 7 County chains and the
     finalize: about 2 hours in all.

     But each rerun stage writes a new attempt directory: about 1.5 GB on disk per shard, plus 7.1 GB for the link
     pass, about 140 GB in all. The disk has 44 GiB free, so B needs space freed first.
   - **C — defer to run 2 (T10).** T6 publishes 441,924 accounts and lists the 12 as a pipeline limitation. The fix
     goes into the code before run 2, which reruns everything anyway.

   Recommended: **A**. The first publication then holds every account TCAD appraises and the TNR layer draws, and
   only 7 County roots change before anything is published.

   **Ruled 2026-10-19 (operator): option A approved.** The guard may use the wider seed box or, better if it is cheap
   and proven, the county boundary; it must never accept geometry that is genuinely outside Travis. Only the affected
   shards rerun. The others are re-certified in place without recomputing them: their marker input digests must still
   match, or the code change must be proven not to reach them. Tests for both. Applied: points 12, 14 and 15.
10. **The 3 accounts whose street is printed one column to the right:**
    - 954255: `E` / `PARMER` / `LN` in prefix, suffix and unit;
    - 978103 and 978104: `PINNACLE` / `CV` in suffix and unit.

    The source prints the street, only in the wrong columns.
    - **(i) Read the shifted columns, for exactly this pattern:** the street column blank, a name in the suffix
      column, a 2–4 letter suffix word in the unit column. The name becomes the street name, the unit word goes
      through the transform's suffix table, and the sidecar flags `situs_columns_shifted`. Run with point 9 A: s0081
      already reruns, and s0084 adds one shard in parallel.
    - **(ii) Keep them dead** as a source data-entry defect, listed with proof.

    Recommended: **(i)**. Under the README rule, data is missing only where the source lacks it, and here it does not.

    **Ruled 2026-10-19 (operator): (i) approved**, for exactly the pattern of 954255 and 978103/978104 and nothing
    broader, with tests, run together with 9 A. Applied: point 13.
11. **Disk.** 44 GiB of 1.8 TiB was free after the run (98% used). The run directory takes 125.8 GB allocated and the
    Loader 2.5 GB. Phase B's 60-parcel exit probe left 3.4 GB in the session scratchpad, now 42 GiB free.
    - T6 (upload) and point 9 A fit in that space.
    - Run 2 (T10) writes about as much as run 1 again. Before T10, free at least 160 GB or move `data/` to a larger
      volume. The agent deletes nothing.
    - Recommended: decide before T10; it does not block T6.

    **Ruled 2026-10-19 (operator):** the operator diagnoses the disk separately. Free space is checked before the rerun,
    which stops if under 25 GiB. T6, T7 and T10 needs are reported for planning. Applied: points 15 and 18.

**Applied (2026-10-19; kit `1cf6ed1` and `2c2d129`; attempt 2 of the same run):**

12. **The guard (27.9).** `TRAVIS_VALIDATION_BBOX` is now the seed builder's box: 29.95-30.75 N, -98.25 to -97.30 W.
    - None of the roll's 373,513 TNR geometries (7,053,937 points) has a point outside it.
    - It contains the contract box, so it refuses nothing that passed before.
    - The other identity checks still keep a wrong-county record out: seed county and FIPS, source hosts, request
      identifiers and address state.

    The county boundary was weighed and not taken, because it is not cheap and not proven here. The check used the
    Census TIGERweb county polygon (GEOID 48453, 1,955 vertices, SHA-256 `1656dd6d…`, a scratch download, never a
    record's source). Against the roll:
    - 653 TNR centroids lie outside the Census line;
    - 56 accounts lie wholly outside it, by up to 46 m;
    - parcel points cross it by up to 2.35 km (355656);
    - 7 of the 12 have their centroid outside it.

    TCAD's parcel fabric does not follow that line. An exact boundary test would refuse 56 published accounts TCAD
    appraises, and any tolerance would have to be calibrated on the data. Tests:
    - the box equals the seed box and contains the contract box;
    - each of the 12 refusing points now passes;
    - points outside the box still fail.
13. **The shifted situs columns (27.10).** Situs columns v1 (`transform.mjs` `readShiftedSitusColumns`) reads exactly this
    pattern:
    - the street column blank;
    - one name in the suffix column (letters only, not itself a suffix word);
    - in the unit column, one of 19 suffix words: the 2-4 letter USPS standard abbreviations TCAD prints as a situs
      suffix on 1,000 or more accounts.

    The house number and prefix are read as printed. The address stays the printed parts (`E PARMER LN, TX 78753`,
    `PINNACLE CV, TX 78645`), and the sidecar records the reading (`situs_columns_shifted`). On the roll it matches 954255,
    978103 and 978104 and no other row. Every other blank street still dies with the run's message.

    Tests cover:
    - the three patterns and 14 near misses (a real unit such as `A`, `101`, `APT` or `STE`, a suffix word or two
      words in the suffix column, and others);
    - the published output;
    - the reconciliation class.

    A side-by-side test runs the run's transform (`962f851`) on rows with a street and gets the same bytes.
14. **The scoped rerun option** (`t5-run.mjs --rerun-shards <ids>`, `t5-recertify.mjs`, kit `1cf6ed1`). It reruns the
    named shards of a finished run in place. It re-certifies every other marker whose input changed only through its
    code digest: it rewrites the marker with the new input and keeps the old input digest under `recertified`.

    Nothing is assumed. Each changed file needs a text proof against the run's kit commit:
    - `validate.mjs`: only the box declaration changed, and the new box contains the old;
    - `transform.mjs`: the run's text plus delimited `travis-situs-columns-v1` blocks and one guard condition;
    - `t5-run.mjs`: the plan and link stages are byte for byte the run's.

    Each shard needs its own facts:
    - no refusal by the guard, and no permit-group failure;
    - every blank-street row dead with the run's evidence and outside the pattern.

    Its outputs are re-hashed (every parcel's `data/` and permit-directory digest). No marker is re-certified until each
    rerun shard shows that its earlier parcels came out the same. Anything else stops the run and names the shard.

    The kit must be committed (the record names the commit). Tests:
    - the proofs on synthetic texts, and on the real texts against `962f851`;
    - the shard facts;
    - a scoped rerun end to end (re-certify, verify quick and full);
    - a refused shard, a closed gate, and a refusal before anything is written.

    The Travis tests are 34 files, 265 passed; readiness `PASS`.
15. **The rerun.** On 2026-10-19 from 07:08:37Z, with 36.09 GiB free (above the 25 GiB floor), the start command plus
    `--rerun-shards s0039,s0040,s0066,s0067,s0068,s0081,s0084`.
    - **Shards:** 7, the 6 of 27.9 plus s0084 for 27.10 (954255 is in s0081).
    - **Time:** 1 h 55 min, shard phase 77 minutes.
      - County validate took 48.5-49.9 minutes per shard, as in the full run.
      - The Loader finalized at 08:25:22Z.
      - The record's disk figure took 34 minutes.
      - The Node teardown stalled again after `done`; the exit watchdog of `6107969` ended it with SIGKILL, everything
        already written.
    - **Comparisons:** each rerun shard's earlier parcels came out byte for byte the same (`data/` and sidecar): 34,984 of
      34,984. The permit states of those parcels were unchanged too. The 15 accounts are newly ready (done with zero
      permits), and 358348 stays dead.
    - **Re-certified:** 165 markers, the link pass and the appraisal and permits stages of 82 shards. Their other stages
      matched as they were.
    - **Property Improvement:** the CARs came out identical, so their CAR checks and tables are attempt 1's.
    - **Disk:** the rerun allocated 8.77 GiB: 7.32 GiB of new attempt directories, 1.45 GiB of new Loader files (the
      permits table is rewritten). Free space fell 17.96 GiB to 18.13 GiB over the same two hours. The other 9.2 GiB
      went elsewhere on the volume: 25 Time Machine local snapshots by then, and other processes.
    - Peak memory was 9.8 GB.
16. **Re-reconciled** (`t5-reconcile.mjs` v2; full `--verify`: 683,910 files, 28.54 GB re-hashed in 240 s, all equal; the
    quick verification writes nothing; `run.json` equals the record rebuilt from the markers, code basis `1cf6ed1`):
    - **441,961 = 441,939 ready + 22 dead + 0 invalid.** All 22 are source facts in 17 shards: 21 print no situs part,
      1 only a house number. The 12 county-line accounts are ready; the 3 shifted ones are ready and flagged.
    - County: 89 archives, 9,690,099 blocks, 441,939 properties. Property Improvement unchanged: 88 archives,
      5,398,330 blocks, 237,531 properties. Every CAR's six checks are 0.
    - Tables: address 883,578; geometry and `parcel_has_geometry` 375,037; `address_has_geometry` 373,497; lot 441,602;
      sales history 423,983; person 343,966; company 97,673. Permits are unchanged: 1,986,484 published on 237,531
      parcels (none of the 15 has a linked permit).
    - Roof age: 441,939 parcels, 390,212 with an age (281,412 from the built year: 355650 and 954255 gain one), 51,727
      without, 276,668 older than 15 years.
    - Loader: the second generation of the run. Deltas against the first: appraisal 15 new and 441,924 unchanged;
      permit groups and permits unchanged; 22 dead tombstones. The replaced generation is kept. Run history: 2.
    - `run.json` SHA-256 is `15a43cb8…`, copied to `runs/20261018T143520Z-t5-full.json`.
17. **Roots.** 14 of 354 changed: the County archive and tables roots of the 7 rerun shards. The other 340 are unchanged,
    as are both CAR digests of all 82 other shards.

    | Shard | County root (new) | County tables root (new) | Blocks |
    | --- | --- | --- | --- |
    | s0039 | `baguqeera33wulnc4wnz2vgnipntuhppdwa2fjko3ryoxdxvsdykdhzy7urya` | `baguqeerawlxhcmbjxv6wikvksofilsgl5k2etm6tzhiv2bfd6ssu76safvyq` | 109,971 |
    | s0040 | `baguqeeraoxwdgtmzzigl34myi34d6rsn3jslsum2j5itdpsbabu7cdpndfbq` | `baguqeerasz5fscgq7yr4x4nst24snrpuqdfthjauf5lnuzmgmd2prktgsb6a` | 112,550 |
    | s0066 | `baguqeerau5bdszsro66i4kkyr2cpmwjxlkx6ijkjyfh7j4dsnehreoy7badq` | `baguqeeraahn5tak2dr243k6l3yjqyxunezoqf5pekmhdxarofhygkatjmcvq` | 106,992 |
    | s0067 | `baguqeeraeo7azvxutmv62bxm22pwam3zhenqae5qztpxyakwl7rxom33ekxa` | `baguqeerad3brwg3vnezopkr2plofp2poteb5jzhcuwkpxyppxm5c42nbfkua` | 109,515 |
    | s0068 | `baguqeeracc6vsrgmqpkgoykjpsv5vd626t4abgfunouu7wzoayogs7axnxra` | `baguqeerald62bnm56mbgxvdqeu66nr46d4yh7dog3dppwnnwqbhsednhxsxa` | 110,472 |
    | s0081 | `baguqeeramkkib2yjcuqgh5i75yc73d6yuiupgdq6ofkrbp36kda6pe3bdelq` | `baguqeerae3uk5kwqwncwexeekalubaaqtnc2pej4hlrumkdznj576sczj75a` | 102,925 |
    | s0084 | `baguqeeraoacjaavqkbjkxze2phdysu3uhli42wwxuxhaut4pvkzmsxo52a2q` | `baguqeera3awjgxnbnr6vhh6yu74lcd4exxnoylivvct7ina5vc3arectjenq` | 98,950 |

    The former roots are in the kit record's `before_the_rulings`. Sizes are unchanged to the third decimal: 9.445 GB
    distinct, 18.889 GB as Filebase counts it.
18. **Disk for T6, T7 and T10 (27.11).** Free now: 18.13 GiB.
    - **T6: about 10.1 GB.**
      - The full-DAG tables CARs that README.md:68 asks for are one per shard and group, 177 in all. Each holds the
        archive's blocks with their framing, the Parquet parts and the tables index: about 10.0 GB (County 5.35,
        Property Improvement 4.68).
      - Upload staging is none: `elephant-cli upload` streams each CAR and part from the run directory and writes only
        JSON receipts.
      - Gateway checks and the manifest add under 0.1 GB.
    - **T7: about 18 GB at peak, 15 GB kept.**
      - The DuckDB file is about 3.2 GB. A DuckDB 1.5.6 build of 10 sample shards turned 158 MB of parts into 326 MB
        (x2.07), and a full-text index over their 210,853 permits added 18.6 MB. Scaled: 2.95 + 0.18 + about 0.1 GB of
        derived tables. That is above section 5's 2 GB ephemeral figure; section 21's image-baked path carries it.
      - The peak also holds the CID-verified parts if downloaded (1.4 GB), the build's spill (up to 3 GB), the CDK asset
        copy (3.2 GB) and the image in the colima VM disk (about 7 GB, which does not shrink by itself).
    - **T10: free at least 180 GB before run 2, or move `data/` to a larger volume** (27.11 said 160):
      - run 2 itself, about 126 GB;
      - Loader 1.5 GB;
      - fresh captures 3.7 GB;
      - T6 again 10 GB;
      - a T7 rebuild 18 GB at peak;
      - 20 GB kept free for swap and local snapshots.
    - **Targets:** before T6 at least 30 GiB free, before T7 at least 40 GiB, so at least 50 GiB before starting T6.
      Today T6 would leave about 8.7 GiB, and T7 does not fit.
    - **Candidates:** the agent deletes nothing. The operator decides on the superseded dry-run directories (about 13.5
      GB), and the system temp directory holds 12 stale `cdk.out` directories of other projects (19 GB).

**Open:** nothing for T5 beyond the operator's approval. Before T6, the free space of point 18.

## 28. 2026-10-19: T6 step 0 — Atlas registers one archive per data group; run 1 has 177; stopped before anything was built or uploaded

The operator's conditional go for T6 required that Atlas accepts a county registered as many shard archives. It does
not, so nothing was built, uploaded, pinned or registered (no full-DAG tables CAR, no import test, no Filebase or
Pinata call). The full verification ran (read-only) and its byte total is recorded below.

1. **Evidence (elephant-xyz/atlas `main`, public since 2026-10-17; read 2026-10-19).**
   - `schema/entry.schema.json`: "The current state of one county: one archive per data group." `groups` maps a
     data-group key ("`county`, `property_improvement`, ...") to exactly one `{cid, schema, tables}`; `cid` is "CountyIndex
     root of the archive".
   - `CONTRIBUTING.md`: set `groups.<data_group>` to `{ "cid", "schema", "tables" }`; "to supersede an archive, change `cid`
     and `tables`".
   - The CLI writer: `export-tables --atlas-page` keys the entry by the snake_cased schema title (`county`,
     `property_improvement`) and supersedes an existing entry, so exporting 89 County archives over one page leaves the last
     one. Kit `car-publication.md`: "one Content Addressable aRchive per county per data group"; withdrawing a key is the
     only hand edit a page ever gets.
   - Consumers: the MCP's `getAtlasDatasetInfo(state, county, dataGroup)` returns one data group's tables and CIDs;
     `index.json` carries one entry per group (FL `jackson`, the only real page, has one `county` group).
   - Mechanically the gate would not stop synthetic keys: the key pattern `^[a-z][a-z0-9]*(_[a-z0-9]+)*$` admits
     `county_s0001`, uniqueness is checked for `cid` and `tables` only (not `schema`), and `verify-roots.mjs` checks each
     changed group on its own. That is a loophole, not a registration format.
   - Run 1's layout: 89 County and 88 Property Improvement archives, each its own `CountyIndex` root (the runner's
     5,000-PROP_ID shards, decision 25.9). Section 7.1's "CAR shards follow the kit's 5,000-property cap" meant the
     CLI's shards inside one archive.
2. **The 375 CAR files against the record's 354.** 354 = 89 + 89 County (archive, tables.car) + 88 + 88 Property
   Improvement, as `run.json` lists them (County archives 4,295,559,822 bytes, 9,690,099 blocks; Property Improvement
   4,310,324,352 bytes, 5,398,330 blocks; largest archive s0015 Property Improvement, 125,009,886 bytes). The other 21
   are attempt 1's files of the 7 rerun shards, kept on disk and not of record: 7 County archives and 7 County tables.car
   (superseded, their roots changed) and 7 Property Improvement archives (the record points at attempt 2's copies; roots
   unchanged). No pilot, feasibility or table-part file is among them. All 375 come to 9,153,568,915 bytes.
3. **Options (the operator's decision; costs from `run.json` timings, T5 memory and disk).**
   - **A. One merged archive per group**, from one `elephant-cli hash --output-car` over the union of the validated group
     directories, then `validate` the CAR, `export-tables --atlas-page`, the full-DAG tables CAR. Property blocks,
     property CIDs and data-group roots are content-derived and do not change, so the Loader, permits, roof age and the
     per-parcel digests stand; 4 roots replace 354. Time: hash 5.3 h (County) and 2.2 h (Property Improvement), CAR
     validate 1.8 and 0.5 h, export 0.3 and 0.2 h, as T5's per-shard sums; the groups side by side about 7.5 h wall if
     the CLI is single-threaded. The group-directory `validate` is 66.4 + 12.3 h as one process, about 10 h rerun per
     shard 8 at a time, or 0 h if the operator rules that the 177 digest-pinned per-shard validate markers cover the union.
     Memory: unmeasured for one process over 441,939 properties (T5: about 1.05 GB per 5,000-property CLI process; linear
     scaling would need about 93 GB on this 32 GB machine), so a sized merge of 10 shards (about 50,000 properties) comes
     first. Disk: about 8.6 GB archives, 0.9 GB tables, about 16 GB hashed ZIPs, 1 GB full-DAG tables CARs (501 GiB free).
     New work: a merge stage in the kit runner with tests, a run-record section, and the multi-GB `dag/import` test of the
     2026-10-17 note. Atlas risk: its gate streams each archive (`?format=car`, about 4.3 GB) from `ipfs.filebase.io` or
     `trustless-gateway.link` and runs `elephant-cli validate` on a GitHub runner within a 20-minute default deadline per
     group (at least 3.6 MB/s sustained); unmeasured.
   - **B. Register the shards under synthetic keys** (`county_s0001` ... , 177 entries). No rebuild, but a hand-written
     page against the schema's description, CONTRIBUTING, the CLI writer and the kit, 177 data groups for one county in the
     index and the MCP, and a likely refusal at code-owner review.
   - **C. Ask the Atlas maintainers for multi-archive groups** (schema, `build-index`, `verify-roots`, the CLI's
     `--atlas-page`, the MCP). No local cost; the timeline is theirs.
   - **D. Decouple:** publish the README packet (Filebase, Pinata, manifest, gateway checks) on the shard layout now and
     register later through A or C. Outside the conditional go (needs its own go). With A later, IPFS stores only the new
     index and shard blocks, but Filebase may count each uploaded CAR again (about 18.9 GB now plus up to about 18.9 GB,
     within 500 GB), and run 1 would carry two sets of CIDs, the shard set never registered in Atlas.
4. **Second open point, found on the way: the two gateways.** Runbook section 3 records ipfs.io and dweb.link as retired
   for automated clients (2026-09-21) and leaves the replacement pair to the operator; no ruling is recorded, so
   README.md:69's check would come back unverified on every row. For reference, Atlas's own gate uses
   `https://ipfs.filebase.io` and `https://trustless-gateway.link`.
5. **Verification (pre-upload check 1, read-only).** `t5-run.mjs --verify` at kit `557207e` (2026-10-19): `verified`, 683,910 files
   re-hashed, **28,609,472,173 bytes**, the true total with the counter fix (T5's recorded 28,544,896,999 and the later
   28,428,041,013 lost increments across the concurrent shard checks), capture 0 mismatches, loader state equal, `run.json`
   equal. Runbook section 7's expected line now carries this total.

6. **Ruled (2026-10-19; the oracle's ruling, the operator's go "go D").** The README is the rule; the kit's
   conventions bend where the README does not require them.
   - **28.3: D.** The README never names Atlas (lines 9, 57-70 ask for CIDs, a manifest, CARs and two-gateway
     retrieval), so run 1 is published as the 177 shard archives as they are: no merge, no Atlas PR. A (merging) only if
     Atlas registration ever becomes required; C (the multi-archive question to the maintainers) is in
     `docs/OPTIONAL-WORK.md`, not sent.
   - **28.4: `https://4everland.io` and `https://gateway.pinata.cloud`** (README.md:69: two independent public gateways
     this environment does not operate). Probed 2026-10-19 with a pilot CID: `trustless-gateway.link` 521/522/525
     (Cloudflare origin errors), `ipfs.io`, `dweb.link`, `w3s.link`, `nftstorage.link` 429 or 52x,
     `gateway.lighthouse.storage` 402, `gw3.io` wrong bytes; only 4everland, Pinata and Filebase served the right bytes.
     Filebase is excluded as the host. The gateway checks run before the Pinata pins, so Pinata's gateway fetches from
     the network rather than from its own pin.
   - **Check scope** (README.md:69, "each listed CID ... bytes match the manifest size/digest"): the raw root block of
     every archive root, tables root and schema against its multihash (their manifest size and sha256 are that block's,
     as in the pilot) and the full bytes of every table part against its size and sha256. Full bytes on the demo
     artifact only would not meet line 69: a part's manifest digest is the whole file, not its root block.
   - **CARs** (README.md:68 and 70, "in the repository or demo packet"): every archive CAR and a full CAR per tables
     root are listed in the manifest by release-asset name, size, sha256 and root CID, as assets of a GitHub Release of
     this repository; they are not uploaded as file CIDs (that would put about 10 GB per gateway under line 69's check).
     Creating the release is a separate go at submission.
   - **Pinata** pins every archive and tables root by CID (recursive; a tables root's DAG holds its parts), waited on
     for at most 45 minutes; a refusal or a pending job is recorded with its exact status.
   - **Run record:** `run.json` stays as T5 left it (its rebuilt-record check stays green); the publication record is
     separate: kit `docs/evidence/travis-t6-publication-20261018T143520Z.json` (written now, status "stopped"), and,
     once the publication completes, repository `runs/20261018T143520Z-t5-full.publication.json` with the gateway rows
     in `runs/20261018T143520Z-t5-full.gateway-checks.json`.
7. **T6 as run (2026-10-19, kit `bfb3b50`, `3b86fc9`; `t6-publish.mjs`, 6 tests; Travis tests 35 files, 271 passed,
   1 skipped). Stopped at the Filebase upload.**
   - **Pre-upload checks, all pass.** Full verify (point 5). The plan re-read all 177 archives: bytes equal to the record,
     all six recorded CAR checks 0, every tables root points back at its shard's archive, 0 problems. Import test: the
     largest archive (s0015 Property Improvement, 125,009,886 bytes, 146,786 blocks) `dag import`ed into a scratch Kubo
     0.43.1 repository offline in 38 s, root equal and pinned recursively; the full tables CAR of the same shard imported
     beside it and pinned too. Multi-GB import test: moot, no archive is over 125 MB. Full tables CARs: 177, 9,383 blocks,
     1,427,990,944 bytes, every part equal to its linked CID (built with the CLI's own importer; Kubo computes the same
     CID). Sizes: archives 8,605,884,174 bytes, parts 1,426,831,183, 10.03 GB distinct (T5's 9.445 GB figure was low),
     20.07 GB as Filebase counts it of 500 GB, at most 18.64 GB at Pinata of 1 TB.
   - **Upload (13:14:07Z-13:24:15Z, concurrency 4).** Read back through `https://ipfs.filebase.io`: 7 archive roots
     (County s0001-s0004, Property Improvement s0001-s0003) and 3 tables roots (County s0003, Property Improvement s0002,
     s0003). **Failed:** the tables uploads of County s0001, s0002, s0004 and Property Improvement s0001, each with the
     CLI's `Upload failed: fetch failed` 309-315 s after it started (the three that passed took 22-135 s). Filebase holds
     every part of all four (read-only `pin/ls`); County s0001's tables root was pinned recursively after the client gave
     up, the other three roots were not. Cause: Node 22's default fetch headers timeout (300 s) on the CLI's
     `dag/import?pin-roots=true` of `tables.car`, which sets no timeout of its own; the recursive root pin walks the
     shard's archive through `county_root` (the double pin of `docs/OPTIONAL-WORK.md`). Nothing else ran: no full
     Filebase pin check, no gateway check, no Pinata pin, no manifest.
   - **The operator's decision. Recommended: (a).** (a) Run the CLI under a preload that raises Node's fetch timeouts
     for the CLI process only (30 minutes; the CLI's code and parameters unchanged), recorded as a deviation, then
     the same upload command resumes: the 10 read-back roots are kept, the four failed tables are redone (adding a
     part again is idempotent). About 15 minutes of kit work, then 2-4 h of unattended upload. (b) Rerun as it is and
     retry failures: no fix, 4 of the first 7 tables imports exceeded the cap. (c) Import `tables.car` without
     pinning its root: changes what the CLI pins; not recommended. The 10 read-back roots are public on Filebase
     either way, and they stay valid: their CIDs do not change.
   - **Applied: (a), the operator's go "go a" (2026-10-19). Deviation:** the elephant-cli upload process runs with
     Node's fetch headers and body timeouts at 30 minutes instead of 300 s, through kit
     `src/counties/travis/cli-fetch-timeout.mjs` preloaded with `NODE_OPTIONS=--import` into that process only
     (`t6-publish.mjs upload --fetch-timeout-minutes 30`; kit `387a324`, a test proves the preload governs Node's
     built-in fetch). The CLI's code, version (1.58.1) and parameters are unchanged; no other process gets the preload.
     The same upload command resumed: the 10 read-back roots were kept, the 4 failed tables uploads redone.
   - **Attempt 2 (14:11:14Z-14:33:25Z) stopped again, on a different failure.** The 4 tables uploads of attempt 1 went
     through, and 29 of 354 roots are now read back (15 archives, 14 tables). The 30-minute timeout was needed: County
     tables imports took 776 s on average (at most 1,177 s; the recursive root pin walks the shard's archive), Property
     Improvement tables 172 s (at most 349 s), archives 16-50 s. **Failed:** County s0008's tables upload: Filebase answered
     the CLI's `add` of `tables/geometry/part-00000.parquet` with `502 Bad Gateway` (nginx), at 14:27:45Z; the CLI has no
     retry. The two uploads in flight finished; nothing new started. Still not run: the full Filebase pin check, the
     gateway checks, the Pinata pins, the manifest.
   - **The operator's decision (8). Recommended: (i).** (i) A bounded retry per upload in the runner, only for a CLI
     failure that is a 5xx answer or a network error (`fetch failed`): up to 3 attempts, 2 and 4 minutes apart, every
     attempt kept in the log and the record; a CID mismatch, a 4xx or a third failure still stops. The uploads are
     content-addressed and idempotent (adding a part again returns its CID, importing a CAR again re-pins the same root),
     so a retry cannot change a published CID. About 10 minutes of kit work. (ii) Keep stopping and resume by hand after
     each transient error: at 1 error in about 33 uploads, about 10 more stops over the remaining 325. Either way the
     remaining upload is about 23 h of uploads in sequence, about 6 h wall at concurrency 4 (about 3 h at 8, if Filebase
     takes it; 502s argue for 4), then the gateway checks (about 1 h) and the pins (at most 45 minutes).
   - **Applied: (i), the operator's go "go i" at 8 uploads in flight (2026-10-19). Two deviations:** (1) a bounded retry
     per upload in the runner (kit `t6-publish.mjs` `retryableFailure` and `uploadAll`, tested): only when that attempt's
     own CLI output shows `fetch failed` or a 5xx answer to `add` or `dag/import`; at most 3 tries in all, 2 and 4
     minutes apart; every failed attempt kept in `uploads.json` (`retries`); a 4xx, a root or CID mismatch, a readback
     timeout or a third failure still stops. (2) Concurrency 8 instead of 4, the operator's choice; if a third failure
     stops it, the operator decides whether to resume at 4.
   - **Attempt 3 (17:27:57Z-20:38:25Z, concurrency 8): every root uploaded and read back.** 354 of 354 (the 29 earlier
     kept); 17 failed attempts retried, every one recovered on its second try (16 `fetch failed` at the 30-minute
     timeout on a tables import, 12 County and 4 Property Improvement; 1 `HTTP 500` on `dag/import`); no failure. Full
     Filebase pin check: 3,283 of 3,283 CIDs pinned, the 8 controls unpinned.
   - **Stopped at the gateway sample (20:39:24Z-21:04:18Z; the rule "if 4everland can't serve the roots, stop").** The
     first 5 archive roots (raw) and the first 5 parts (full bytes) per gateway, 10 minutes per object:
     `gateway.pinata.cloud` 10 of 10 match on the first try; `4everland.io` 2 match (1 root on its 3rd try, 1 part on
     its 6th), 8 unverified with `504` after 4 tries each, 0 mismatches. cid.contact lists 4-6 provider records for every
     sampled root, so the blocks are announced; 4everland's own retrieval times out. Not run: the full gateway checks,
     the Pinata pins, the manifest. (A hand-off probe also showed `ipfs.filebase.io` answering `429` after about 100
     requests in a minute.)
   - **The operator's decision (9). Recommended: (γ).** (γ) Replace 4everland with `https://ipfs.filebase.io`: README.md:69
     asks for two independent public gateways this environment does not operate, and Filebase's and Pinata's gateways
     are two companies' public gateways, neither run by us; the earlier exclusion of Filebase as the host was ours, not
     the README's. Pinata's checks still run before its pins, so one of the two proves retrieval from the network. The
     4everland sample stays in the record as informational. About 1-2 h unattended (Filebase's 429s are retried no
     sooner than `Retry-After`), then the pins (at most 45 minutes) and the manifest. (β) Keep 4everland, re-run the
     10-object sample in a few hours and the full check only if it passes: uncertain, and 8 of 10 failed for 10 minutes
     today. (α) Run the full check on 4everland now with its 20-minute deadline per object: at today's rate most of
     3,285 rows would end unverified, after many hours.
   - **Applied: (γ), the operator's go "go γ" (2026-10-20).** The two gateways are `https://gateway.pinata.cloud` and
     `https://ipfs.filebase.io`. Why Filebase was excluded before, and why that was our rule, not the README's: point 6
     dropped it because Filebase holds the upload, so its gateway serves from its own pins rather than proving retrieval
     from the network. README.md:69 asks only for "two independent public gateways that this environment does not
     operate"; Filebase's gateway is public, unauthenticated, run by Filebase, and independent of Pinata's (its own
     example pair, ipfs.io and dweb.link, came from one operator). The network-retrieval proof is kept on the other
     gateway: Pinata's checks run before any Pinata pin. The 4everland sample stays in the publication record as
     informational. Same scope, a 20-minute deadline per object, 4 objects in flight per gateway, 429 and 5xx retried no
     sooner than `Retry-After`, then one short pass over any row without a definitive answer.
   - **Stopped at the gateway checks (21:28:24Z-21:39:20Z).** `ipfs.filebase.io`: all 356 roots and schemas and the
     first 235 parts matched, nothing else yet. `gateway.pinata.cloud`: 250 roots matched in 9 minutes, then `429` with
     `Retry-After` of about 3,540 s (an hourly quota); the runner gives up on a wait longer than the 20-minute deadline,
     so 39 rows went unverified, and the chain was stopped by hand rather than send more requests into the window.
     0 mismatches. Not run: the rest of the checks, the Pinata pins, the manifest.
   - **The operator's decision (10). Recommended: (1).** (1) Pace Pinata's gateway to its quota: wait out each
     `Retry-After` in full (up to about an hour) instead of giving up at the deadline, 1 request in flight on Pinata,
     Filebase unchanged; the scope and the manifest stay as ruled. About 10 minutes of kit work, then about 12-13 h
     unattended for Pinata's remaining ~3,035 rows (about 250 an hour), then the pins and the manifest. (2) List only the
     354 directory roots and the 2 schemas in the manifest (each part stays reachable through its CountyTables root and
     its CAR, with its size and CID inside that block): 356 rows per gateway, about 1 more hour at Pinata's pace; cheaper,
     but it reads README.md:63's "query table" as the tables root rather than its parts, which a reviewer could contest.
   - **Ruled: 3, the operator's ruling "go 3" (2026-10-20), replacing (1) and (2).** The manifest keeps every table part
     (README.md:63, "every eligible object"). The full `ipfs.filebase.io` check finishes at the ruled scope. The Pinata
     pins run now, without waiting for the Pinata gateway checks: the pre-pin ordering is dropped for the remaining
     objects. The 250 roots Pinata's gateway matched at 21:28-21:37Z, before any Pinata pin, already show it fetching
     from the public network; they are in the manifest's gateway rows. The manifest is written and pinned once the
     Filebase check has passed and every pin is done or has its status recorded. The remaining `gateway.pinata.cloud`
     rows (and the manifest's own) are checked afterwards in a detached background process (`t6-publish.mjs
     gateway-paced`, kit `d13f340`): one request in flight, each `Retry-After` waited out in full (up to 6 rounds per
     object), resuming from the 289 rows already made; its rows go to their own evidence file
     (`runs/20261018T143520Z-t5-full.gateway-checks-pinata.json` when it finishes), never into the immutable manifest. A
     mismatch, a 4xx other than 429 or a pin refusal stops the work; a row still unverified after the paced rounds is
     kept with its status.
   - **Ruling 3 as run (2026-10-19 22:04Z-22:59Z; kit `d13f340` and the read-only `pin-status`). T6 observed.**
     `ipfs.filebase.io`: 3,285 of 3,285 rows matched (356 raw root blocks and schemas, 2,929 parts in full, 1,426,831,183
     bytes), 0 mismatches, 0 unverified; 1,547 rows needed retries inside their deadline (at most 6 attempts), so the
     operator's pre-approved slow passes ("retry unverified", 2026-10-20) were not needed. Pinata pins of the 354 roots,
     at the 45-minute bound: 214 pinned, 140 pending (97 retrieving, 41 prechecking, 1 searching, 1 backfilled), 0 refused;
     at 23:01:29Z 274 of 355 (the roots and the manifest) pinned, 81 retrieving. Manifest
     `publish/20261018T143520Z-t5-full/manifest.json`: 3,285 objects, 354 CARs, 1,466,902 bytes, sha256 `4a0f3231…`, CID
     **`bafybeid6jqqzpo2ods6iehz5vgud2ust4fykfiozspzxb3xjmqiup36ud4`** (Filebase's `add` returned the locally computed CID;
     pinned on Pinata; its full bytes match on `ipfs.filebase.io`). Its gateway rows: Filebase's 3,285 and Pinata's 250
     pre-pin matches (`runs/20261018T143520Z-t5-full.gateway-checks.json`). The remaining 3,036 `gateway.pinata.cloud` rows
     (with the manifest's) run detached from 22:59:43Z (pid 19109, `caffeinate`, log
     `data/travis/publish/20261018T143520Z-t5-full/gateway-checks-pinata.log`), about 250 an hour, so about 12 h. The
     publication record: `runs/20261018T143520Z-t5-full.publication.json` (also kit `docs/evidence/`).

## 29. 2026-10-20: T7 and T8 built together; build rulings

- **T7 and T8 are built together and checked once**, the operator's one exception to stop-per-increment
  (`docs/tmp-token-budget.md` point 4). T9 and T10 keep stop-per-increment.
- **npm workspaces + Turborepo, not pnpm** (section 21's layout otherwise unchanged): the root `package-lock.json` pins
  `@elephant-xyz/cli` 1.58.1 at `44bb182`, which a package-manager switch would re-resolve. The fixed interface points
  are in `docs/hosted-layer-interfaces.md`.
- **The chat route ships at T7 as a placeholder**: `503 agent_unavailable` (`model_unavailable`, or `budget_exhausted`
  when the kill switch is set), no Bedrock call. The route, its throttle, the kill switch and the alarms are checked at T7;
  T9 replaces the handler.
- **Alarms notify by email only** (section 8's documented substitution; README.md does not ask for paging). Section 21's
  PagerDuty subscriber is not wired; the PR records the substitution.
- **Explorer Verify gateways are `ipfs.filebase.io` and `gateway.pinata.cloud`**, the two section 28 ruled for T6
  (`ipfs.io` and `dweb.link` stopped serving backend clients; section 9's names are superseded). T8 confirms both
  gateways' CORS from the live origin.
- **Finding: the published `address` tables carry no address text.** `export-tables` wrote only `cid`,
  `property_cid`, `data_group_cid` and `request_identifier` for `address` (checked on shard s0001). The API serves situs
  and mailing text from the receipted TCAD capture (each shard's `seed.csv`), labelled `unpublished_source`, beside the
  published address CID. Whether the archive blocks hold the text and only the tables export drops it is a question for
  the oracle before run 2 (T10); it does not block T7.
- **Both functions run at 3008 MB, DuckDB at 2 GB** (was 4096 MB and 3 GB). The first deploy failed on account
  561303652468's Lambda quotas: at most 3008 MB per function and 10 concurrent executions in total. 3008 MB works without
  a quota request, so check 1's cold-start times are measured at 3008 MB. Raising the memory needs a quota increase
  (Service Quotas, Lambda). The 10-execution cap also leaves no room for T9's reserved chat concurrency, because AWS keeps
  10 unreserved, so T9 needs that increase too.

## 30. 2026-10-20: T7 correction — the large tables are served as Parquet from the private deploy bucket

Replaces section 21's "DuckDB in Lambda" bullet and revises its "Secrets and IAM" bullet for the two functions.
Contract v1 is unchanged. The operator approved the direction; the kit's `metagross` reviewed it once
([`reviews/2026-10-20-metagross-serving-parquet-review.md`](./reviews/2026-10-20-metagross-serving-parquet-review.md)).

- **Why.** Section 21 assumed that "Lambda loads image chunks lazily, so no cold start downloads 2 GB". For random reads
  that is false. Measured on Lambda over six deploys, reading the 4 GB file baked into the image ran at 50 MB/s for the
  first 100 MB, then about 4 MB/s. Cold radius and permit searches hit the 25 s timeout. A parallel warm-up (32 × 8 MB
  reads) stalled the instance and was dropped (never committed). Downloading from our own CloudFront ran at about
  5 MB/s. Check 1 itself passed on the first deploy (meta 200, cold 18.4 s; chat 503; the served `openapi.json` equal to
  the committed one; MCP `structuredContent`).
- **The serving set.** `deploy-build serving` (in `just deploy-api`, skipped when current) derives it from the
  checkpointed file, which stays the build of record. Six zstd Parquet files go to the private deploy bucket under
  `serving/<deploy_id>/`, content-named `<table>.<sha256-16>.parquet`, immutable, uploaded with their SHA-256 as the S3
  checksum and listed with it in `deploy.json` (`serving` block):

  | File | Sort | Row group | Size |
  | --- | --- | --- | --- |
  | `properties` | `floor(lat*40) NULLS LAST, lon, property_id` | 10,000 | 91 MB |
  | `permits` | `is_roofing DESC, status_group, floor(radius_lat*40) NULLS LAST, radius_lon, permit_id` | 10,000 | 297 MB |
  | `permit_text_rows` (the 541,912 text-indexed permits) | `permit_id` | 1,000 | 114 MB |
  | `business_records` | `name_norm, source, business_record_id` | 10,000 | 64 MB |
  | `property_extras`, `roof_age_reference` | `property_id` | 10,000 | 15 MB, 4 MB |

  Every other `main` table, `permit_text` with its BM25 index rebuilt by `post_load.sql`'s own PRAGMA, a
  `permit_text_filters` table (permit id, status group, roofing flag, radius point of the text-indexed permits) and
  `serving_files` go into one 77 MB DuckDB file baked into the image (`/opt/db/serving.duckdb`, with `deploy.json`), well
  inside the fast first 100 MB. `lex.*` (about 2.6 GB) is not exported: the API never reads it. The image went from about
  4.5 GB to 0.6 GB.
- **Serving mode in `Queries.open`.** It opens the serving file read-only as the main database and loads `fts` and
  `httpfs`, both bundled in the image with pinned SHA-256s (`httpfs` `b18472a0…`), autoinstall off. It builds a
  temporary S3 secret, scoped to the serving base, from the function role's credentials. One temporary view per
  `serving_files` row, named after the table, so the SQL is the same in both modes. `deploy_id` comes from the baked
  file, so the image and its Parquet set cannot drift. The Parquet metadata, HTTP metadata and external file caches are
  on and the instance is reused, so a warm call reads nothing again. Then external access closes to all but the serving
  prefix and `/tmp/`, and the configuration is locked: no SQL text can reach another URL or file (tested). Threads 4,
  `memory_limit` 2 GB. Full-file mode stays for tests and local runs.
- **Two query changes, both with equal outputs in the two modes.**
  1. **Text search is computed in two steps.** Scores, filters, the total and the page's ids come from the local tables,
     then one read by id fetches the page's full rows from `permit_text_rows`. The old join read the whole permits file:
     62 s cold. An `IN` list on the radius-sorted file is not pruned (291 MB read), and a full id-sorted copy has an
     11 MB footer every cold open would pay. So the copy holds only the text-indexed permits. In full-file mode both
     relations are views over `permits`.
  2. **`get_property` by `geo_id` answers the lowest `property_id`.** 1,160 geo_ids sit on 11,577 accounts. The answer
     used to depend on the scan order, so the full file and the Parquet files gave different accounts. The contract
     says nothing about this case, so the deterministic rule is not a contract change.
- **IAM (section 21 revised).** The API and chat functions each get exactly `s3:GetObject` on
  `<deploy bucket>/serving/*`; CDK template tests assert that it is their only S3 grant. No `ListBucket`, because names
  are exact: a missing key answers 403, so the open error names the file and the deploy. No KMS, because the bucket is
  SSE-S3. `serving/` has no expiry rule, so rolling back an image still finds its set; teardown's `autoDeleteObjects`
  removes it.
- **Private data stays private** (section 21, unchanged). The Parquet files sit in the private deploy bucket (Block
  Public Access, TLS-only, SSE-S3), which is in no CloudFront origin.
- **Gate before every deploy that changes the serving set or the query layer:**
  `npx tsx packages/deploy-build/scripts/serving-gate.ts`. It runs every operation on a cold instance over a local Range
  server at 5 MB/s in total plus 30 ms per request, timed from the start of `Queries.open`. Each answer must equal the
  full file's; the CRM's main call must finish under 10 s and every operation under 15 s. Result 2026-10-20: **PASS**,
  20 of 20 equal:

  | Operation (cold, open included) | Time | Warm |
  | --- | --- | --- |
  | CRM call: `searchProperties` r5, roof age over 15, `open_permits` false, limit 500 | 8.6 s | 60 ms |
  | `searchProperties` r5 (defaults) | 7.7 s | 39 ms |
  | `searchProperties` county-wide (tenure 10, absentee), the slowest | 14.0 s | 61 ms |
  | `searchPermits` open and stalled roofing r5 | 3.1 s | 25 ms |
  | `searchPermitText` county-wide / r5 | 4.2 s / 4.0 s | about 100 ms |
  | `getProperty`, `getPermit` | 4.0 s, 4.2 s | 21 ms, 33 ms |
  | meta, runs, centers, licenses (local tables only) | 1.8 s (the open) | under 10 ms |

  With `SERVING_BASE` and session credentials the same script reads the uploaded set from S3. On 2026-10-20 that
  covered signing, the session token, TLS and region from the operator's machine: 20 of 20 equal. The times there are a
  distant client's (open about 8 s), not Lambda's. The built arm64 image under the base image's runtime interface
  emulator then answered `getPermit` and the CRM call from the real bucket (200, 500 items of 53,308), which covers the
  bundled `httpfs` and the image's CA bundle.
- **Review findings** (metagross, one pass): 1 and 2 (blocking: time cold from the open, warm calls too; test the S3
  path before Lambda) applied as above; 4 (lock external access), 5 (exact grant, error names the file) and 7 (no expiry)
  applied; 6 is moot because this section describes the code. **3 is not applied.** Rebuilding the secret on a 403 would
  read the same environment variables, which do not change inside an execution environment, so it cannot help; a
  failure of that kind shows as 5xx and fires the stage 5xx alarm.
- **Cost.** About 0.66 GB more in S3 (about $0.02 a month) and roughly 20 to 300 GETs per cold operation (fractions of a
  cent per thousand calls). No standing compute.
- **Uploaded 2026-10-20:** `serving/e17c90aa0b91ccae/`, 6 objects, 585 MB, every checksum accepted by S3. Check 1 measures
  the cold times on Lambda after the next `deploy-api`.

## 31. 2026-10-20: T7 margin — no standing warm-ups; a deploy-time warm-up, an init prefetch and client prewarm

The operator's ruling after section 30's deploy: 8.6 s against the CRM's 10 s is too tight for a demo; look at the
adjacent paths too; prefer an honest loading state and a prewarm triggered by real use over keeping Lambda busy.

- **Where the limits are.** The 10 s was the T7 handoff's own gate target, not a timeout. The real limits:

  | Limit | Where |
  | --- | --- |
  | 15 s per attempt, one retry on a GET `5xx` or timeout, one call in flight | the CRM's browser (roofing-crm decisions, "Transport") |
  | 8 s per call | the CRM's own Lambda calling the pipeline (F5, later) |
  | 25 s | the API function's timeout |
  | 30 s | API Gateway's HTTP API integration cap (fixed) |

- **Measured on Lambda after section 30's deploy** (2026-10-20, curl from the operator's machine). Seven different
  operations sent at once, each on a new instance of the freshly pushed image: 7.9-9.4 s each, text search 15.0 s
  (handler 5.6-7.4 s and 12.6 s, init 0.8-1.0 s). The same calls on instances already open, without that query's data:
  0.6-3.1 s. Cold starts minutes later: 4.6 s for the CRM call (handler 2.5 s). So S3 is not the cost. The slow part is
  the image's blocks on a new instance of a new image: httpfs (19.9 MB) and fts (10.8 MB) as DuckDB loads them, and the
  serving file's text index pages, read at the image's slow rate until Lambda caches them. Section 30's gate models S3
  reads, not image reads, so it stays the gate for the query layer, and check 1 measures the live path.
- **No standing warm-up.** EventBridge Scheduler pings (3 at once every 5 minutes, about 114,000 GB-s a month, inside
  the free tier) were built and dropped before any deploy. They run whether anyone uses the API or not: the ongoing
  cost README.md rules out by default ("does not carry ongoing infrastructure cost by default"). Free tier or not, that
  is a server kept warm. The kit has no rule on warmers, standing schedules or loading states (arceus,
  2026-10-20: the only cold-start line is `apply-engineering-guidelines/rules/stack-typescript-for-apis.md:13`). A
  template test asserts that the only schedule in `TravisApi` is the daily flag clear. Provisioned concurrency is out
  for the same reason, and the 10-execution cap leaves none to allocate.
- **A warm-up at deploy time and before a demo.** The API function accepts `{"warm": {"hold_ms": 1500}}`: it opens the
  instance and, once per instance, runs the demo's default calls (meta, the CRM's main call, the 5-mile property and
  permit searches around central Austin, a county-wide text search), then holds 1.5 s so simultaneous warm-ups take
  separate instances. `just warm n=3` sends n of them. `just deploy-api` ends with it, so the new image's slowest cold
  starts land on the deploy, and the operator runs it before a live demo and before marking the PRs ready for review.
  Cost: a few invocations per deploy or demo.
- **A prefetch at init was measured and removed.** Each instance read the bundled extensions and the serving file in
  4 MB chunks (4 in flight, bounded at 3 s) before DuckDB opened them. Deployed 2026-10-20 14:50Z. On the new image's
  first instances it read 60-64 MB in about 4 s (15 MB/s) and was ready after 5.5 s: no faster than without it. On cold
  instances once the image was cached it read all 108 MB in 1.4-1.5 s, but the open still took 1.5 s. The CRM call's
  handler took 4.2-4.3 s (6.4-6.6 s end to end), against 2.5 s (4.6 s) without the prefetch. DuckDB's own reads are
  already fast there. Kept: the open starts at init, and every instance logs `cold start` (open and ready ms).
- **Clients prewarm when a person opens them.** The explorer's API client sends the page's first call alone and holds
  the calls that start with it until it answers (`firstCallAlone` in `packages/api-client`). On an idle API they then
  land on the one instance it opened, instead of each opening a cold one. After 3 s `Loading` says why: "The first
  request after a quiet period starts the data service, which can take up to about 15 seconds." The CRM's calls already
  go out one at a time. It is told to send `GET /v1/meta` when the page opens, so the first search queues behind it, and
  to show the same kind of message. It should allow 25 s per attempt, not 15: the instance a timed-out attempt opened is
  still busy, so a quick retry only opens a second cold one. Its F5 agent's 8 s per call needs the same prewarm at the
  start of a chat.
- **What a reviewer can still meet.** On an idle API, the first call after a quiet period takes about 5 s (8-9 s if
  Lambda has dropped the image's cached blocks), behind a loading message that says why. On an instance a warm-up primed,
  the CRM call's handler takes 0.3 s (1.6 s end to end, mostly its 500 items travelling); other calls take 0.6-3 s.

## 32. 2026-10-20: T9 built — the agent on Bedrock Sonnet 4.6, its tracing, name and limits, SAM local and the golden set

The operator's rulings of 2026-10-20 on the T9 brief, and what the build measured. Contract v1 is unchanged: the generated
`openapi.json` is byte-identical (SHA-256 `7d8ece68…`, the CRM's pin).

- **Model (ruling 1; replaces section 8's model bullet).** On account 561303652468 Bedrock answers AccessDenied ("not
  available for this account", `agreementAvailability` `NOT_AVAILABLE`) for every Claude model from Opus 4.7 and Sonnet 5
  on, including `us.anthropic.claude-opus-5-5`, `-sonnet-5-5` and `-haiku-5-5`. Converse works for
  `us.anthropic.claude-sonnet-4-6`, `us.anthropic.claude-opus-4-6-v1`, `us.anthropic.claude-haiku-4-5-20251001-v1:0` and
  `us.anthropic.claude-sonnet-4-5-20250929-v1:0`. The operator's ruling: stay on Bedrock, use the 4.6 models, compare
  Sonnet 4.6 and Opus 4.6 on the golden set (section 20, "Model"). **Sonnet 4.6 won** (table below) and is the
  `bedrockModelId` default in `config.ts`, `config.json` and `config.example.json`. Both profiles route to us-east-1,
  us-east-2 and us-west-2; the foundation-model id is the profile id without `us.` (`anthropic.claude-opus-4-6-v1` for Opus
  4.6), and a CDK test pins the ARNs for both. Quotas: 10,000 requests a minute; 6M tokens a minute for Sonnet 4.6, 3M for
  Opus 4.6. Moving to 5.5 later is a config change plus a golden-set rerun.
- **Timing spike first** (`apps/api/scripts/chat-spike.ts`, real tool payloads of the README turns, streamed, from the
  operator's machine). Tool-choice steps: Sonnet 4.6 1.3-1.6 s, Opus 4.6 1.7-2.5 s, Haiku 4.5 1.2-1.5 s. The answer step
  with 20 records in context and a 450-600-token answer: Sonnet 7.0-8.5 s, Opus 6.6-10.5 s, Haiku 4.0-5.2 s (Haiku also
  cited an address as a property id). A README turn is three model steps (resolve the place, search, answer; turn 2
  fetches again, since earlier turns are never evidence), so the answer's length decided the turn: it was cut to at most
  three sentences and three records, one line each, no commentary before tool calls, 600 output tokens per step and 1,500
  per turn (`LIMITS_JSON`). Long lists reach the user as `evidence[]`, which the explorer renders, not as model tokens.
- **Golden set** (`fixtures/rag/queries/*.json`, 22 cases, 24 turns, built by `apps/api/scripts/golden-build.ts`: expected
  tool sequences and parameters, expected ids from the query layer's SQL on deploy `e17c90aa0b91ccae`, expected outcomes,
  12 hand-labelled hail re-roof permits for text search). Run once per model, fixed (non-exact search centers rejected by
  the harness, server guidance in `resolve_search_center` results, outcome inference for a reply that only asks, the
  runner's id recall), run once more; one result file per run in `fixtures/rag/results/`. Run 2, local replay:

  | Model | Hard gates | Outcome accuracy | Parameter accuracy | Id recall | Text P@k / R@k | p50 / p95 / max turn | README turns | Tokens per turn (in / out / cache read) | Cost per turn |
  | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
  | Sonnet 4.6 | 24/24, 24/24 | 1.000 | 1.000 | 1.000 | 0.66 / 0.64 | 8.0 / 12.6 / 15.1 s | 7.3 s, 10.0 s | 12,810 / 355 / 8,945 | $0.022 |
  | Opus 4.6 | 24/24, 24/24 | 0.958 | 1.000 | 1.000 | 0.49 / 0.75 | 8.8 / 14.4 / 23.9 s (one deadline hit) | 8.7 s, 12.1 s | 12,557 / 347 / 716 | $0.076 |

  Run 1 (before the fixes): Sonnet 0.917 outcome accuracy, p95 13.1 s; Opus 0.917, p95 14.9 s, one deadline hit. Costs are
  list prices per million tokens (Sonnet $3 in, $15 out, $0.30 cache read, $3.75 cache write; Opus $5, $25, $0.50, $6.25);
  Bedrock's on-demand Claude prices follow them, and a US geo profile may carry a premium, so the cost table quotes them as
  an estimate. Opus reads almost nothing from the cache: its minimum cacheable prefix is 4,096 tokens and the system prompt
  plus tools are about 3,400. The local replay reads the S3 tables from the operator's machine, so its tool times are a
  distant client's; the README turns were primed and are model time (6.7 s and 9.4 s of model steps). The live replay
  after deploy is the real check.
- **LangSmith (ruling 2).** The key is the Secrets Manager secret `staraptor-agent/langsmith-api-key` (a plain string,
  created 2026-10-20 and verified against the LangSmith API), imported by name; the chat role alone gets
  `secretsmanager:GetSecretValue` on `…:secret:staraptor-agent/langsmith-api-key-??????`; the function reads it at init and
  caches it (`LANGSMITH_API_KEY_SECRET_ID`, never the key in the environment). `LANGSMITH_PROJECT=staraptor-agent`. The
  kit's facade on `langsmith` 0.11 (`wrapAISDK` wraps AI SDK 7's `ToolLoopAgent`): session and thread = `session_id`, else
  the request id; `flush()` within the deadline (at most 2 s); a failed secret read or wrapper gives the plain SDK and is
  retried after 5 minutes. Person fields are hidden by key in every traced input and output, and the person values a
  personal view returned in a turn are hidden in any traced text, the model's answer included (checked in LangSmith:
  `owner_name` and `mailing_address` read `[hidden]`). Traces from the local replay and from SAM local arrived with model
  and tool child runs. LangSmith keeps traces 14 days (free Developer plan, base traces; recorded 2026-10-21).
- **Name (ruling 3).** `staraptor-agent` names `LANGSMITH_PROJECT`, the chat function's Powertools service and its metrics
  namespace (was `travis-chat` in `TravisPropertyIntelligence`). The alarms are unaffected: the chat error-rate, daily-usage
  and throttle alarms read `AWS/Lambda` metrics and the flag alarm reads `ChatBudgetFlagSet`, which the flag setter writes
  to `TravisPropertyIntelligence`; the CDK assertions cover all of them. Section 20 asked for a daily request **and token**
  budget; T7 had requests only, so a ninth alarm, `travis-chat-daily-tokens` (input plus output tokens a UTC day over
  `dailyChatTokenLimit`, default 5,000,000, about $9 on Sonnet at the measured mix of cache reads and writes), also sets
  the kill switch.
- **Concurrency (ruling 4).** `aws lambda get-account-settings` shows 1,000 concurrent executions (10 at T7, section 29).
  Section 21's formula with the measured p95 of 12.6 s: R ≤ min(5, 10,000 × 12.6 ÷ 360 = 350) = **5**; route rate ≈ R ÷ p95
  = 5 ÷ 12.6 = **0.4 requests a second, burst 5** (was 1 and 3). Both in the config, published in `/v1/meta.limits`.
- **SAM local (ruling 5, final; replaces section 20's "replayed under SAM local" and section 21's "local is SAM local").**
  T9 runs three cases with `sam local invoke` of the chat function from `cdk.out` (the README two-turn conversation, one
  out-of-scope, one prompt injection) to prove the image, packaging and event handling. The full golden set runs through a
  tsx script calling the same exported handler with the same events, against the built-in serving DB, the S3 Parquet
  tables and real Bedrock. It then runs against the live `POST /v1/agent/chat`, which is the real check. SAM proves nothing
  about IAM, quotas or Bedrock access. If SAM can't load the CDK image, the same image runs under the Lambda Runtime
  Interface Emulator via `docker run`, recorded as a deviation. As built (`just sam-local`): SAM loads the CDK image once
  `cdk synth -c sam-local=1` adds the asset metadata SAM's CDK support reads (both functions take the shared asset through
  `fromEcr`, so CDK writes none; the deployed template stays without it) and `sam build --use-buildkit` builds it (the
  Dockerfile's `COPY --chmod` needs BuildKit), so the emulator fallback was not needed. The out-of-scope case runs as a
  one-shot `sam local invoke` (a cold container, 14.2 s: the operator's machine opens the S3 tables in about 9 s). A cold
  container cannot fit a README turn in the function's 28 s from here, so the README conversation and the injection case
  run through `sam local start-lambda --warm-containers LAZY`, primed first by the warm-up event (README turns 9.2 s and
  8.4 s). Result: 4 of 4 pass (`fixtures/rag/results/20261020T170201Z-sam-local.json`).
- **Cold start.** The chat bundle is 3.7 MB (zod 1.1 MB, `ai` 0.7 MB, `langsmith` 0.5 MB, the Anthropic and Bedrock
  providers 0.4 MB); evaluating it takes 155-170 ms locally (the API bundle 110 ms). At init the function also starts the
  query layer's open (about 1-1.5 s on Lambda at T7, section 31; 8.7 s from the operator's machine to S3) and the secret
  read, in parallel. `just warm` now also sends `c` (default 2) warm-ups to the chat function: each opens an instance, reads
  the secret and runs the README turns' tool calls once (`AGENT_PRIME`: Austin, 5 miles, roofs over 15 years; open roofing
  permits open 5 years or more), with no model call.
- **Explorer prewarm.** The Agent tab sends `POST /v1/agent/chat` with `{"messages": []}` when it opens, at most once per
  5 minutes per browser session (a `sessionStorage` timestamp): the contract answers it `400`, and the handler opens and
  primes the instance (as `just warm` does, once per instance, bounded by the turn deadline) before it answers. Cost: one
  request of the chat route's burst of 5, no Bedrock call, a few seconds of Lambda on a cold instance and milliseconds on a
  warm one. Each prewarm and each `just warm` chat warm-up is a chat-function invocation, so it counts toward the
  200-a-day invocation limit (`travis-chat-daily-usage`) that sets the kill switch.
- **Deviations from sections 20 and 21, recorded.** (1) A property is cited either from a property record or from a permit
  record that names it (the permit's evidence item carries its `property_id`), so a permit list can say which properties
  it is on. (2) The search-center rule is enforced, not only prompted: a search around a center that came back only as a
  prefix or alias match is rejected until the user confirms, and a result whose exact match has under 50 parcels while
  another candidate has ten times more tells the model to ask (on this roll "Westlake" matches a 3-parcel `WEST LAKE`
  exactly; "Austin, TX" a 1-parcel `AUSTIN TX`). (3) The one retry runs in a model middleware (throttling or 5xx, only with
  at least 1.5 s left); the AI SDK's own retries are off. (4) The circuit breaker is per instance: three consecutive turns
  failing on Bedrock open it for 30 s, then one turn probes. (5) The personal view is a keyword rule on the latest question
  (owner, deed, mailing, contact, phone, email and similar words). (6) The tool-text injection case needs the local runner's
  query hook, so the live replay skips it; the history-injection case runs everywhere. (7) Tool-call logs keep ids,
  numbers and flags as given and hash free-text parameters (`q`, `number`, `license_number`).
- **Cost.** Per turn about $0.02 (Sonnet 4.6), $0.03-0.04 for a README turn; the worst day at the kill-switch limits
  (200 turns) about $5-8 of Bedrock. Standing: the secret, $0.40 a month.
- **Fix pass after the alakazam review** ([`reviews/2026-10-20-alakazam-t9-agent-review.md`](./reviews/2026-10-20-alakazam-t9-agent-review.md),
  one blocker and four should-fix, all applied the same day; contract unchanged, `openapi.json` still `7d8ece68…`).
  (B1) The citation check runs over the model's assumption lines with the answer, and every `tool_error` carries no model
  text: no answer and no model assumptions (the server's assumptions and limitations stay). (S1) Ids written outside
  `[[…]]` are checked against this turn's evidence too: bare permit ids, 32-hex contractor keys and business or license
  record ids, "property <id>" mentions, and the ids in API paths of link targets; any other fails closed. (S2) The server
  removes HTML (tags, comments, autolinks) and Markdown images from the answer and the assumptions before the check and
  keeps links only to the API's own host, the two gateways and the explorer's `#/` routes (a link elsewhere keeps its text,
  a bare URL elsewhere goes): the CRM renders this text too. (S3) The flag read, the tracing facade and the data open run
  inside the deadline and the `try`, each bounded (1.5 s for the flag and the facade; the open by the deadline); the SSM and
  Secrets Manager clients have 1 s request and connection timeouts and two attempts; a failed flag read keeps the cached
  value or counts as not set, a failed secret read turns tracing off for that instance and never fails the turn; a turn
  that ends before reporting to the circuit breaker releases its half-open probe, so the instance cannot stay at
  `503 circuit_open`; a missing or stale `timeEpoch` (a hand-made event) counts as now. (S4) Every earlier message of the
  client-sent history reaches LangSmith only as `[earlier message sha256:…]`, with the same per-turn person-value
  redaction as before. Also from the review's notes: a test parses a turn body with the frozen `ChatResponse` schema, the
  golden runner's own gate checks what B1 and S1 check, and result files record `prompt_version`. The review's other note,
  alarming on `ChatTurns` instead of invocations, is not applied: the operator decides whether prewarms and warm-ups
  should stay inside the daily limit.
- **State suffix (coordinator, 2026-10-20, checked on the live API).** `/v1/search-centers` finds nothing for
  "Pflugerville, TX", matches "Austin, TX" exactly to a 1-parcel `AUSTIN TX` and "Austin Texas" only as an alias, so a
  reviewer who adds the state would get a question or no match. The agent's `resolve_search_center` wrapper (not the shared
  REST and MCP lookup, whose matching is contract) drops a trailing ", TX", " TX", ", Texas" or " Texas" in any case before
  the lookup and adds the server assumption `State suffix dropped from the place name: "Pflugerville, TX" → "Pflugerville"`.
  Alias-only matches such as "ATX" still get a question, as the contract requires. Two golden cases were added.
- **Golden set after the fix pass.** 24 cases, 26 turns. For the README conversation and the two state-suffix cases the
  expected ids are now independent SQL written from the contract's definitions over the serving set's own Parquet files
  (`data/deploy/current/serving`), not the query functions the tools call; all four turns equal the query layer's ids and
  totals (50,260; 139; 27,819; 50,260). The other cases keep their query-layer ids. One run on Sonnet 4.6 only
  (`fixtures/rag/results/20261020T173105Z-local-claude-sonnet-4-6-run3-review-fixes.json`): hard gates 26/26 and 26/26,
  outcome accuracy 1.000, parameter accuracy 1.000, id recall 1.000, text P@k 0.49 / R@k 0.75, p50 8.8 s, p95 14.3 s, max
  16.8 s (the four-step contractor-identity turn), README turns 8.8 s and 10.7 s, state-suffix turns 7.5 s and 9.4 s,
  $0.024 a turn. No Opus rerun. SAM local ran on the image built before this fix pass; the AWS replay validates the final
  image.
- **Live (2026-10-20; the operator's approval after the runbook section 10 checks).** Deployed 17:44Z with the IAM changes
  approved. Live golden set (`fixtures/rag/results/20261020T174636Z-live-claude-sonnet-4-6-live.json`, 23 cases, 25
  turns): hard gates 25/25 and 25/25, outcome accuracy 1.000, parameter accuracy 0.96 (`out-of-county-dallas` declined
  without the `resolve_search_center` call the fixture expects; outcome right, no rows), p50 6.9 s, p95 10.9 s, max
  12.0 s, README turns 6.6 s and 10.9 s, state-suffix turns 7.2 s and 8.7 s, no deadline hit, no non-200. Cold probe:
  five concurrent README first turns, three on fresh unprimed instances (init 0.6-1.0 s), 9.9 s, 10.3 s and 12.3 s end to
  end against the 25 s deadline; a warm instance 7.9 s; the model's time (5.4-7.8 s) dominates. Two live fixes, both deployed
  by the operator (the first before checks 2 and 3, the second after the approval): (1) the HTTP API's `$default` route catches CORS preflights too, so they reached the API function and
  got `405`, and the browser blocked the Agent tab's POST (the explorer's first preflighted request); the app now answers
  `OPTIONS` with `204` before it opens anything, and API Gateway adds the configured CORS headers (`821fe94`). (2) The
  server's search-center assumption states both counts ("129,473 parcels; centroid of 124,832 … (those with
  coordinates)"), since the model quotes `parcel_count` beside the basis's coordinate count (`5956f22`). The Agent tab
  answered both README prompts; LangSmith thread `5y4r0251415l0l2a4p0v0q65` holds both turns with their model and tool
  child runs and no error; the `chat turn` log line carries ids, hashes, tokens and timings only.

## 33. 2026-10-20/21: T10 — run 2 is an incremental next run, not a second full run

- **Why not a full rerun** (the operator's question, 2026-10-20). Run 1's 12.2 h was CPU, not download or VPN: of 104
  shard-hours, `elephant-cli validate` of the County group took 71.6 (45 min per 5,000-parcel shard); source acquisition took
  0.09 h. The README asks run 2 for an incremental, windowed refresh (lines 19, 40-42, 101), and the kit's model is a new
  immutable snapshot that reuses byte-identical property artifacts (`use-oracle` reference `continuous-ingestion.md:147`,
  `continuous-safe-optimization.md:116`). Section 27.9 C and 27.18 assumed run 2 "reruns everything"; that is superseded.
- **Window.** The permit export is republished whole every day (`:updated_at` is after 2026-10-19 on every row), so change
  detection is by content: a fresh capture (`v1792499798`, rowsUpdatedAt 2026-10-20T12:36:38Z, 2,380,939 rows, verified, from
  RO egress; the host answers any country) against run 1's. Permits only: TCAD's later roll (`travis_SUPP 335`, 511 MB,
  2026-10-08, a different "website export" layout) is the next window, recorded as a limitation; TCAD also answers from RO.
- **Mechanism** (kit `54d1d14`, `c3cc36a`): `t5-run.mjs --next-run latest --capture <newer>` clones the finished run
  (clonefile(2) per shard, copy-on-write: no disk, run 1 untouched) under a new run id and reruns every stage whose input
  changed. County chains are carried (their input is the County records' digest; the lexicon manifest is unchanged,
  `7084b933…`); a shard reruns its Property Improvement chain only when its published permit records changed; merges and
  the Loader finalize always rerun (generation 2, deltas against run 1). The record names `previous_run`,
  `changed_since_previous` and the carried stages (left out of the timings). A test proves it on the fake CLI.
- **Run 2** `20261020T200236Z-t5-full` (2026-10-20 20:02Z to 2026-10-21 00:47Z; clone 0.7 h, processing 2.9 h, 8 in flight):
  441,961 = 441,939 ready + 22 dead + 0 invalid. County 89 of 89 archives carried (same CIDs); Property Improvement 78 of 88
  archives new, 10 carried. Loader deltas: permits 232 new, 3,662 changed, 2,377,045 unchanged, 0 removed; parcels with
  permits 9 new, 394 changed. Published permits 1,986,694 (run 1: 1,986,484); roof age on 390,215 (12,200 high, 96,608
  medium, 281,407 low) as of 2026-10-20.
- **Publication** (`t10-publish.sh`, kit `b6a51a8`; `t6-publish.mjs plan --previous`): only the 156 new roots were uploaded
  with readback (546 new parts, 4.48 GB; attempt 1 stopped on 3 network errors for one upload, the same command resumed;
  2 retries); Filebase pins all 3,283 CIDs; Filebase gateway 702 of 702 new objects matched; Pinata gateway 253 matched
  before its hourly quota, the rest paced in the background as in run 1 (finished 2026-10-21 06:42Z: 702 of 702 matched,
  0 mismatched, 0 unverified; `runs/20261020T200236Z-t5-full.gateway-checks-pinata.json`); Pinata pins 353 of 354 roots (1 retrieving). The
  198 carried roots keep run 1's CIDs and evidence. Manifest `bafybeicj4vw5hgntnmwl2cie5txpe7esn4y3ygsqoau3hzqk5ipsz6xhqy`
  (3,285 objects, 354 CARs, each CAR with its `release_tag`; `previous_run` names run 1's manifest), pinned on both vendors,
  matched on both gateways. Record `runs/20261020T200236Z-t5-full.publication.json`.
- **Kit coalescing rule.** The kit holds publication until the loaded delta exceeds max(10,000 rows, 1%) unless the user
  explicitly requests it (`continuous-safe-optimization.md:120`). Run 2's 3,894 changed rows are below it; the operator
  requested this publication because README lines 19, 42 and 101 require a later incremental publish.
- **Hosted layer.** `deploy-build` serves run 2: run id (`TRAVIS_RUN_ID` overrides), capture, link-pass directory and as-of
  date read from the run's record and markers (they were run 1's constants; the first build caught the stale as-of date
  through its own count gates); the count gates come from the served record (run 1's still equals the T5 constants);
  `/v1/runs` shows each run's roots from its own manifest (run 1 showed none). Deploy `8191073a04a47541` (4.1 GB), deployed
  2026-10-21 04:10Z (`scripts/deploy-api.sh`, code only). Live: `/v1/meta` serves run 2; `/v1/runs` lists run 2 (177 roots,
  `previous_run`, deltas), run 1 (177 roots) and the pilot; run 2's manifest served byte-identical (`8cf695be…`); CRM search
  200 in 2.0 s; MCP `structuredContent`; the README's first agent prompt 200 in 6.9 s, citing run 2. The golden set's
  expected values were then recomputed on run 2 and replayed live (`f076996`, result `20261021T060832Z`, 23 cases, 25
  turns): hard gates 25/25 and 25/25, outcome accuracy 0.96, parameter accuracy 1.000, p95 9.4 s, README turns 7.3 s and
  10.1 s. The one miss is the `alias-westlake` follow-up: both tools succeeded, the citation check refused the model's
  answer (`citation_failures: 1`, `cited: 0` in its log line), and the turn returned `tool_error` with no model text,
  the fail-closed path. Not fixed; the PR states it.
- **CAR releases** (README lines 68 and 70; section 28.6): `scripts/release-cars.py` stages each CAR by the manifest's size
  and SHA-256, uploads to a draft release and publishes it only when GitHub's digest of every asset equals the manifest.
  Run 1: release `run-20261018T143520Z-t5-full`, 354 assets, 10.03 GB, all equal, published 2026-10-21. Run 2: release
  `run-20261020T200236Z-t5-full` with its 156 new CARs; the carried CARs stay in run 1's release.
- **Section 29's open question answered (address text).** The published archives hold the address text (`address.json`:
  `unnormalized_address`, city, ZIP, coordinates and the TCAD source URL; checked on shard s0001); only the CLI's
  `export-tables` (1.58.1) leaves those columns out of the `address` table. The API's situs text comes from the same TCAD
  capture; the address record's CID, served beside it, resolves to the published text. Recorded as a limitation; no code change.

## 34. 2026-10-21: the API function gets a daily kill switch like chat's

Before submission the operator ruled that the search API needs a daily stop, not only its throttle: held at the stage's
20 requests a second for a whole day, the API function would cost about $35–70 (3,008 MB arm64 at 0.5–1 s a call).

- **Mechanism, the same as chat's (section 21).** A second SSM standard parameter, `/travis/api/budget-exhausted`; a
  tenth alarm, `travis-api-daily-usage`, on the API function's invocations summed over one UTC day above
  `dailyApiRequestLimit` (default 20,000, far above review traffic); the flag writer now maps each alarm to its flag
  (`BUDGET_FLAGS`) and emits `ApiBudgetFlagSet` or `ChatBudgetFlagSet`; the budget-flag alarm sums both; a second
  Scheduler job clears the API flag at 00:00 UTC. The API function gets `ssm:GetParameter` on its own flag only.
- **Behaviour.** While the flag is `true`, every REST and MCP request answers `503 {error: "api_unavailable", reason:
  "budget_exhausted", detail, request_id}` before the query layer is touched; the flag is read with the same 30 s cache
  and a 1.5 s bound, and at init. Warm-ups are not blocked. Reserved concurrency zero is still not used (section 21).
- **Drilled live on 2026-10-21** by the operator: with the flag set `true`, `/v1/meta` answered `503 budget_exhausted`
  on the first request (07:28:51Z); after it was set back to `false`, it answered 200 again at 07:29:27Z, inside the
  30 s cache plus a warm container's lag.
- **Cost of the worst day** falls to about $5: the requests before the alarm trips, then about 1.7 million fast 503s,
  mostly API Gateway's $1 per million.

- **The `project_name` cost-allocation tag** (section 21 says it is activated) was found inactive in billing on
  2026-10-21 and activated then; Cost Explorer can filter by it from that date only, so the PR's cost figures come from
  the account's bill with credits excluded, not from the tag.

## 35. 2026-10-21: `GET /` answers 200 JSON, outside the contract

Both PR descriptions link the bare API_BASE (`https://733jzm4xv4.execute-api.us-east-2.amazonaws.com`); a reviewer who
clicked it got `404 {"error":"not_found"}`.

- **Behaviour.** The app answers `GET /` before routing (after the `OPTIONS` preflight) with `200
  {status: "ok", service, version, openapi: "/v1/openapi.json", request_id}` and `x-request-id`; `service` and `version`
  are `openapi.json`'s `info.title` and `info.version`, so they follow the served contract. JSON only, no page. It never
  opens the query layer and, like a preflight, records no query metric (API Gateway's access log still has it). The kill
  switch still applies: while the API flag is set, `/` answers `503` like every other path (section 34). Other methods
  on `/` and every other unknown path still answer `404 not_found`.
- **Not in the contract.** Contract v1 is frozen (section 21) and the CRM's check that the live contract equals its
  pinned copy fails if a path is added, so `/` is in neither `ENDPOINTS` nor `openapi.json`; a test asserts both. No CDK
  change: the HTTP API's default integration (`$default`) already sends `/` to the API function.
- **Live, 2026-10-21.** Deployed 09:58Z (`scripts/deploy-api.sh`, code only: one new image layer, no IAM change).
  `GET /` answered 200 with that body in 26 ms and 13 ms at API Gateway (instances the deploy's warm-up had just opened;
  no cold start was measured); `/v1/openapi.json` stayed byte-identical (150,244 bytes, SHA-256 `7d8ece68…`, the same
  before and after the deploy and equal to `packages/contract/openapi.json`); `/v1/nothing` and `POST /` answered 404;
  `/v1/meta` 200.

## 36. 2026-10-21: the CRM's requests, the agent's citation repair, and the review follow-ups

The CRM's slowking run scored its PR at 85; the top deduction was long-open lead relevance, caused by this pipeline's
data and property search. Its session asked for R1–R5 (R1–R4 deployed by 19:30 EEST, R5 by 20:30 or skipped).

- **R1, a completed date closes a permit.** Austin's export still prints "Active" on some old permits that have a
  completed date (`1999-002931 BP`, a storage shed, completed 1999-07-04, was shown as open 27 years). The deploy build
  now serves a permit whose printed status maps to open or stalled but which has a completed date as `closed`, with the
  new optional `status_group_basis: completed_date`; the printed status stays in `status`. The profile's own mapping is
  kept as `status_group_profile`, and the reconciliation compares that with the kit's permits-internal, so the run
  record, the published archives and the kit are unchanged (they hold the printed status). It carries into the open and
  stalled counts, the durations, the long-open signal, the sort, permit search's default and `/v1/meta`, in REST and MCP.
  673 published permits move (768 in the county, 87 of them roofing): open roofing permits 4,379 → 4,292; stalled stays
  6,378 (no stalled roofing permit has a completed date). The CRM's evidence query (5 miles of downtown, open at least 5
  years) returns 136 permits, none with a completed date (165 before, 29 of the first 100 completed). A new
  reconciliation check: no served open or stalled permit has a completed date. A `/v1/meta` limitation gives the count.
- **R2, `roof_work_class` on property search** (REST, and the MCP and agent tool `search_properties`): an optional list
  of the four roofing classes. It limits `roofing_permit_counts.open` and `.stalled`, the open, long-open and stalled
  match reasons, the sort and `total`; omitted, all four count as before. Each property carries the four signal columns
  per roofing class (16 columns), the query combines the requested ones, and a reconciliation check proves they add up
  to the totals. Live: near downtown at 5 miles with `primary_roof_replacement,repair_or_coating`, 10 rows are long-open
  (24 without it), and each has an open or stalled replacement or repair permit at least 5 years old with no completed date.
- **R3.** `dailyApiRequestLimit` 20,000 → 50,000; the alarm threshold reads 50,000 live. The worst day rises to about $6
  (section 34: about $5), the extra 30,000 full requests before the alarm trips.
- **R4.** A contractor `phone` with fewer than 10 digits is `null`, in permit and contractor responses; the attribution
  key and the captured value are unchanged.
- **R5, declined.** Titan Text Embeddings V2 on demand embeds one text per call, so about 2 million permit descriptions
  take hours; cosine scoring over vectors read from S3 Parquet on a cold Lambda does not fit the 25 s budget; and there
  was no time for an alakazam review before 20:30. Text search stays lexical (BM25), the recorded deviation.
- **The agent's daily question limit stays 200** (the CRM raises its own Assistant to 500): the 5M-token cap already
  bounds the cost, and review traffic is far below 200.
- **One contract change** (R2's parameter, R1's field; dated in `api-contract.md`), served from `031b720`, deploy
  `0b604818b489aff5` (run 2, rebuilt), deployed 12:08Z; the served `openapi.json` equals the committed file (SHA-256
  `6ff17f6c…`). The test fixture is rebuilt from run 2 (16.2 MB; its cap is now 18 MB for the 16 new columns), and three
  query tests now name run 2.
- **The agent's citation repair.** Section 33's one miss (`alias-westlake`) was the model, not the checker: its
  LangSmith trace shows `[[property:110514]]` on the row the tool returned as `110510` (same address and roof age). When
  the check refuses an answer and at least 5 s remain, the model now gets one more step with the refused ids and
  rewrites the answer, which is checked again; anything still failing returns no model text, as before. The step keeps
  the tools and is told not to call them: Bedrock drops the tool configuration for `toolChoice: 'none'` and refuses a
  conversation with tool blocks without one. The prompt (version `.7`) says to copy ids character for character, and
  "property 1967" (a year) is no longer read as a property id (no property id lies in 1800–2099; the smallest is
  100008). Deployed 12:16Z (`91eeb01`). Live golden replay on run 2 after R1 (`20261021T121640Z`, 23 cases, 25 turns):
  hard gates 25/25 and 25/25, outcome accuracy 1.00, parameter accuracy 0.94 (`contractor-identity` called
  `search_businesses` rather than `get_contractor`; `out-of-county-dallas` answered without a tool; both outcomes right),
  p95 11.3 s, README turns 9.9 s and 11.3 s. README turn 2's expected set is 110 properties (139 before R1).
- **Review follow-ups.** `GET /v1/mcp` from a browser still answers `405`, since the MCP spec allows only an SSE stream
  or `405` there; its `detail` now says so. TCAD's supplemental roll export 335 (2026-10-08), which section 33 said was
  "recorded as a limitation", was in neither the run record nor the PR: it is now a `/v1/meta` limitation and in the PR
  (owner, deed and value fields are as of the certified roll of 2026-07-18); section 6's "plus any new supplemental roll"
  was not met by run 2. Atlas: [elephant-xyz/atlas#78](https://github.com/elephant-xyz/atlas/issues/78) asks whether a
  county entry may list several archives per data group (the question in `OPTIONAL-WORK.md`, now sent). CI: the PR comes
  from a fork and the upstream runs no workflow for it, so `pr.yml` also runs on pushes to the fork's `assignment`
  branch; green on `91eeb01` ([run 39598326275](https://github.com/xucian/oracle-property-intelligence-platform-pipeline-travis-tx/actions/runs/39598326275)).
  Prettier: three files from `b5770c4` reformatted (whitespace only; one is a saved golden result).

## 37. 2026-10-21: R5's decline corrected, after the arceus and alakazam reviews

Section 36 declined R5 partly on a wrong number and before any review. "About 2 million permit descriptions take hours"
counted every permit: the text-indexed permits print 265,678 distinct descriptions, about 47 minutes at Titan V2's 6,000
requests a minute. Both reviews were then run, read-only:

- **arceus** routed it to alakazam (`build-rag-systems` is authoritative, and it requires OpenSearch for production
  vector or hybrid retrieval) and recommended skipping it today: retrieval over the records with SQL filters and BM25,
  with cited answers, already counts as RAG under that skill.
- **alakazam** ([review](reviews/2026-10-21-alakazam-r5-hybrid-review.md)): no-go for 20:30. A careful build is about
  6.5 h against 4.8 h left, and it would put a contract, IAM and image change on the live API under review. Its corrected
  design (vectors in their own image file, ranking per distinct description, a calibrated cosine floor, the agent kept
  lexical, a 20-query labelled evaluation) can ship in a later deploy; no OpenSearch is acceptable to it as a recorded
  deviation under the conditions in the review.
- **R5 stays declined, for those reasons.** Section 20's "embeddings go to OpenSearch" stands until a dated ruling adopts
  alakazam's conditions.
- **The embeddings made while this was weighed** (Titan V2, 256 dimensions, normalized, int8, keyed by
  `md5(lower(trim(description)))` over all 265,678 distinct descriptions of the served run, about $0.10;
  `apps/api/scripts/embed-descriptions.ts`) stay in `data/deploy/embeddings`, not served and not published, for that
  later deploy. They are a deploy-time index of the served run, like the BM25 index, not a published artifact: runs 1
  and 2 keep their CIDs, and a later run embeds only the descriptions not already cached.

## 38. 2026-10-21: PagerDuty wired to the alarm topic

The CRM created a free PagerDuty service and put its Amazon CloudWatch integration URL in the SSM String parameter
`/roofing-crm/pagerduty/integration-url` (same account and region). The alarm topic now subscribes it over HTTPS beside
the email subscriber, as section 21 planned, which closes section 29's email-only substitution. The CDK config names the
parameter (`pagerDutyUrlParam`); the URL is resolved from SSM at deploy and is never in git. Deployed 12:58Z (`c0f658e`,
infrastructure only: the image did not change). PagerDuty confirmed the subscription, and a test on the API errors alarm
(ALARM 13:00:26Z, OK 13:01:12Z; not a budget alarm, so no kill switch) delivered 7 notifications with 0 failed. A CDK
test asserts the HTTPS subscription and its SSM parameter.

## 39. 2026-10-21: roofing leads default to replacements and repairs; DuckDB-WASM reads parts by CID

The pre-video slowking dry run found the lead screens and the agent led with accessory roofs and new construction. The
explorer's lead queries now default to `roof_work_class` primary_roof_replacement and repair_or_coating (a ticked box;
untick it for all four roofing classes): near Austin at 5 mi, open and stalled roofing permits go from 3,490 to 635. The
agent's prompt (`.8`) does the same for open-roofing-permit questions, states it as an assumption, gives the total
first and lists at most five records (was three). The golden set's three open-permit turns expect the filter, with ids
from the independent SQL filtered the same way (the README's second question: 11 permits, was 110). Live replay
`20261021T133951Z`: hard gates 25/25, outcome accuracy 1.00, parameter accuracy 0.96, p50 8.0 s, p95 11.9 s.

The explorer's DuckDB-WASM box can read each Parquet part straight from `ipfs.filebase.io/ipfs/<part CID>` instead of
the same-origin mirror (Filebase answers range requests with open CORS). Deployed 13:37Z (explorer) and 13:39Z (API,
agent prompt only; the served contract is unchanged, SHA-256 `6ff17f6c…`). The Titan embeddings computed for R5 stay
an unused local cache (section 37).
