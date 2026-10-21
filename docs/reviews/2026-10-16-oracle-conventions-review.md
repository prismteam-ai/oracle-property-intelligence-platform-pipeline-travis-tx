# Oracle conventions review, 2026-10-16

Read-only review of this repository's design documents by the kit's `oracle` agent before any v1
implementation. It is kept as the record that the proper kit agent was used to correct course, and as the
input of the next reviews (`mew`, `alakazam`, `metagross`).

**Status:** every correction below was applied the same day to `docs/decisions.md` (itemized in its section 14)
and `docs/api-contract.md` (dated in its change control). `README.md` is the assignment text and was not changed.

## Scope and method

- Reviewed: `docs/decisions.md` sections 2–7 and 13 (including the section 4 sources table) and, in
  `docs/api-contract.md`, the shared definitions, `GET /v1/meta`, `/v1/runs`, `/v1/runs/{run_id}/manifest`
  and the Run, Contractor and PermitSummary schemas. **Line numbers below refer to those files at commit
  `44c7fce`**, the version that was reviewed, not to the corrected versions.
- Checked against: the kit checkout the plugin installs from (`soofi-xyz-team-kit` v0.99.1, branch `travis`
  at `99c7bff`, identical to `main`): `agents/oracle.md`, `skills/use-oracle/SKILL.md` and its references
  `car-publication.md`, `permit-evidence-preflight.md`, `roof-age-and-identity-reingest.md`,
  `continuous-ingestion.md`, plus `onboard-county`, `county-readiness-preflight`, `county-seed-data`,
  `build-county-transform`, `query-db-loading-matching`, `bbb-harvest` and `deploy-open-data-mcp`. Kit paths
  below are relative to the kit root; `reference/` files are under `skills/use-oracle/reference/`.
- Constraints respected: no file edits, no ssh, no Colima/Docker/Restate, no network probes, no ingestion,
  no uploads, no Atlas or transform pull requests, no MCP calls. The lexicon class check used the kit's bundled
  catalog (`skills/use-neutral-lexicon/reference/model-c.json` and `catalog.json`).
- Verification: 26 of the cited line references were re-read against the files by the orchestrating session
  after the agent returned; all matched.
- Verdict scale: `violation` = contradicts a kit MUST/never rule or the agent definition;
  `acceptable if recorded` = permitted only with evidence, a decision record, a readiness-preflight entry, a
  records request or a documented limitation the doc had not yet recorded; `fine` = consistent as written.

## Verdicts on the thirteen claims

Of the thirteen: 8 violations, 5 acceptable if recorded, 0 fine.

| # | Claim | Verdict | Doc (commit 44c7fce) | Kit rule | Fix |
| --- | --- | --- | --- | --- | --- |
| 1 | `permit` as a lexicon class | violation | decisions.md:75-76, :48 | build-county-transform/SKILL.md:61-62; reference/car-publication.md:4-5; agents/oracle.md:56-57; model-c.json:17666-17696 (no `permit` class; `property_improvement` with `property_has_property_improvement`, `parcel_has_property_improvement`, `property_improvement_has_contractor`) | Rename the class to `property_improvement`, keep `permit_number` and friends as its properties, link from `property`/`parcel` with the two edges. |
| 2 | Digits-only `geo_id`/`tcad_id` join | acceptable if recorded | api-contract.md:29-30; decisions.md:80-81 | use-oracle/SKILL.md:120; query-db-loading-matching/SKILL.md:30-37, :115-120; reference/permit-evidence-preflight.md:134-139, :643-645; county-seed-data/SKILL.md:64-71 | Link on `geo_id` exactly as printed first; allow the strip-non-digits form only as a recorded fallback once the Travis profile proves it one-to-one; stamp `match_method`, `normalization_version`, `confidence`; leave collisions valid-unlinked; never strip leading zeros from `PROP_ID`. |
| 3 | Contractor identity from name + phone, name-only Comptroller match | violation | decisions.md:65, :78, :80-82; api-contract.md:32, :217 | agents/oracle.md:107-114; reference/permit-evidence-preflight.md:183-184, :340-341, :359-365; county-ingest-run/SKILL.md:13-18 | Keep printed fields as source-name attribution; write no company, person or license records and no contractor edge from name+phone; demote the Comptroller hit to a review candidate; name Texas's official registry and licensing authorities in the county profile. |
| 4 | Regex roofing tiers and the `issue_date` roof-age fallback | violation | api-contract.md:37-39; decisions.md:84-88 | reference/permit-evidence-preflight.md:113-114, :125-131, :151-162; reference/roof-age-and-identity-reingest.md:46-56, :58-61; runtime/src/roof-age/estimator.ts:35-42, :196, :727-741 | Drop the `issue_date` fallback; move the regex tiers into the Travis permit profile as fixture-tested work-class mappings; compute roof age with the bundled estimator and expose anchor, confidence and caveats. |
| 5 | Unmapped statuses defaulting to open/closed | violation | api-contract.md:41 | reference/permit-evidence-preflight.md:30-31, :104-108, :608-610; reference/roof-age-and-identity-reingest.md:61; estimator.ts:28-33 | Add `status_group: needs_review` for anything outside the fixture-tested mapping; exclude from open/stalled/closed counts and the open-permit signal; report the count under limitations. |
| 6 | Publishing `roofing_signals`, `places` and coverage objects | violation | decisions.md:84-91, :120-122; README.md:59 | use-oracle/SKILL.md:27-29, :147; reference/car-publication.md:97-98, :104-106, :282-283; agents/oracle.md:95-98; overture-places-ingest/SKILL.md:36-38 | Put only `elephant-cli hash` archives and `export-tables` output on IPFS; derive roofing signals, the search-center table and coverage at deploy time into the hosted mirror; meet README:59 with counts in the manifest, the CountyIndex/CountyTables roots and one property data-group root CID. |
| 7 | Optional per-run IPNS | violation | decisions.md:128-129; api-contract.md:69, :229 | reference/car-publication.md:191-193; agents/oracle.md:22-24; deploy-open-data-mcp/SKILL.md:33-34 | Mint no IPNS name; after the Atlas merge record the global `elephant-atlas` name and its resolved index CID, null before merge. |
| 8 | CARs and seed data in git | violation | decisions.md:34-36, :120-129, :187; README.md:70 | agents/oracle.md:132-133; onboard-county/SKILL.md:134-135; reference/self-contained-ingestion.md:122-124; bootstrap-oracle-infra/SKILL.md:42; county-seed-data/SKILL.md:57 | Commit manifests, run records, the seed script and a replay fixture under 1 MB only; keep the seed CSV and every CAR out of git; ship CARs as Release or demo-packet assets referenced by CID. |
| 9 | GIS-only roll contingency | acceptable if recorded | decisions.md:201-203, :62 | county-readiness-preflight/SKILL.md:24-28; reference/readiness-and-completeness.md:86-91, :103-113; scripts/validate-county-readiness.py:278-296; reference/continuous-ingestion.md:31-32 | Record an `approved_exceptions` entry in `travis-sources.yaml` (cause, canonical denominator, seed decision, excluded population, coverage effect) and the TCAD purchase as a human payment decision; otherwise the preflight blocks seed, pilot and full ingest. |
| 10 | Rest-of-county permits as a "documented limitation" | acceptable if recorded | decisions.md:60-61 | county-readiness-preflight/SKILL.md:29-32, :41-44; reference/readiness-and-completeness.md:117-135; reference/request-routing.md:3-5, :37-52; scripts/validate-county-readiness.py:195-204, :336-372 | Enumerate every Travis jurisdiction in `travis-sources.yaml` with a classification and historical-records flag; give every blocked, custodian-only or manual-only row a complete `records_request`. |
| 11 | BBB "not used" without an access request | acceptable if recorded | decisions.md:66, :55; api-contract.md:49 | bbb-harvest/SKILL.md:13-18, :66-68, :116-127; reference/continuous-ingestion.md:52-53; county-readiness-preflight/SKILL.md:16 | File and record the developer.bbb.org access request; re-run the single bounded probe from the approved US-egress runtime; carry coverage as `source_access_status: blocked` with `incomplete_reason: http_403_source_block`. |
| 12 | The 1,000-parcel pilot | acceptable if recorded | decisions.md:46-50 | county-ingest-run/SKILL.md:54-72, :74-85; onboard-county/SKILL.md:80-83; county-readiness-preflight/SKILL.md:66-71 | Run the kit's ~25-parcel representative pilot first, then record the 1,000-parcel run as the feasibility increment with the 48-hour projection; re-run the readiness validator before each. |
| 13 | The single `dataset_cid` | violation | api-contract.md:69, :229; decisions.md:109-110, :188 | reference/car-publication.md:3-8, :134-136, :255-266; agents/oracle.md:93-98 | Replace `dataset_cid` with per-group `{cid, schema, tables}` as written by `export-tables --atlas-page`; let run history and the manifest list those roots. |

## Additional findings in the reviewed sections

| # | Finding | Verdict | Doc (commit 44c7fce) | Kit rule | Fix |
| --- | --- | --- | --- | --- | --- |
| A | Publication sequence skips CAR validation and readback | violation | decisions.md:116 | agents/oracle.md:74-81, :99-100; reference/car-publication.md:42-43, :65-67, :74-79 | Insert `elephant-cli validate <county>-<group>.car` between hash and export-tables; require root readback before the Atlas PR; keep the six per-check counts. |
| B | Calling the run "published" on the README packet alone | acceptable if recorded | decisions.md:130-132 | agents/oracle.md:88-89; use-oracle/SKILL.md:195-196; reference/car-publication.md:206-207 | Report "uploaded with readback", "Atlas PR open/merged/not merged", "not published per kit until global IPNS and MCP sync"; record the Atlas-repo access request if `gh` write access is missing. |
| C | Bulk-first capture provenance | acceptable if recorded | decisions.md:39-45, :21-22 | build-county-transform/SKILL.md:73-85; county-appraisal-onboarding/SKILL.md:8-9 | Stamp every entity with the bulk GET actually made and `request_identifier` as printed; record "bulk" as the access method; still smoke one parcel through `Parcel.process`. |
| D | Lexicon permit scope narrower than query tables | acceptable if recorded | decisions.md:47-50 | reference/readiness-and-completeness.md:112-113, :295-296 | Type the group availability `supported_partial` with excluded classes and counts. |
| E | Comptroller in place of the Texas SOS registry | acceptable if recorded | decisions.md:64 | sunbiz-corporate-ingest/SKILL.md:13-15, :113-120; agents/oracle.md:109-110 | Record it as an approved exception with the SOS paywall as a human payment decision; stamp any published company with its per-taxpayer detail GET, never the bulk page. |
| F | Incremental runs lack Loader watermarks and tombstones | acceptable if recorded | decisions.md:102-107 | agents/oracle.md:103-106; query-db-loading-matching/SKILL.md:84-111 | Add per-track `(path, artifact hash)` watermarks and tombstone consumption to each run record. |
| G | On-demand runtime shut down between runs | fine | decisions.md:30-31, :112 | bootstrap-oracle-infra/SKILL.md:9; reference/continuous-ingestion.md:36-37, :147-150 | None, provided each run reaches a terminal state under Restate before shutdown. |
| H | "Kit not patched" vs county adapter on a kit branch | fine | decisions.md:18, :32-35 | county-permit-adapter/SKILL.md:257-258; build-county-transform/SKILL.md:56-60 | None; wording changed to "no core changes". |
| I | Contingencies: Bedrock and geometry | fine | decisions.md:195-200 | reference/readiness-and-completeness.md:106, :112-113 | None. |

## api-contract.md fields that had to change before the v1 freeze

All 48 are applied in the corrected `docs/api-contract.md`. Line numbers are from commit `44c7fce`.

| # | Schema | Field (line) | Change |
| --- | --- | --- | --- |
| 1 | Shared | `property_id` (:29) | string exactly as printed; no leading-zero stripping; it is the lexicon `parcel_identifier` / `request_identifier` |
| 2 | Shared | `geo_id` join rule (:30) | exact-as-printed first; digits-only only as a recorded fallback with proven one-to-one normalization and version |
| 3 | Shared | `contractor_id` (:32) | renamed `contractor_attribution_key`; phone never feeds identity |
| 4 | Shared | `source` (:36) | add `request_identifier`, `source_http_request`; `cid` → `record_cid`; add `property_cid`, `data_group_cid`; group CIDs on the run |
| 5 | Shared | `is_reroof` (:37) | regex boolean → profile-classified `roof_work_class` enum plus `work_classifier_version` |
| 6 | Shared | `is_roofing` (:38) | derived from the profile mapping only; ambiguous terms → `needs_review` |
| 7 | Shared | Roof age (:39) | `issue_date` fallback removed; `roof_age_basis` enum; add `roof_age_confidence`, `roof_age_anchor`, `roof_age_as_of`, `roof_age_caveats[]` |
| 8 | Shared | Status group (:41) | add `needs_review`; default-to-open/closed rule removed; add `status_observed_at`, `status_evidence` |
| 9 | Shared | `open_since` (:42) | add `open_since_basis` |
| 10 | Shared | `open_duration_days` (:43) | add `open_duration_basis` |
| 11 | Shared | BBB (:49) | `bbb.status` distinguishes `blocked` (`incomplete_reason: http_403_source_block`) from `unavailable` |
| 12 | Shared | Place, `GET /v1/places`, `resolve_place` (:50, :74-78, :143) | renamed search center, `/v1/search-centers`, `resolve_search_center` |
| 13 | `/v1/meta` | `dataset_cid` (:69) | replaced by `groups: {<group>: {cid, schema, tables}}` |
| 14 | `/v1/meta` | `ipns` (:69) | replaced by `atlas: {ipns, index_cid, merged, pr_url}` or null; global name only |
| 15 | `/v1/meta` | `counts.contractors` (:68) | renamed `permit_contractor_attributions` |
| 16 | `/v1/meta` | `counts.businesses` (:68) | renamed `registry_rows_loaded` |
| 17 | `/v1/meta` | `counts` (:66-68) | add `permits_unmatched`, `permits_needs_review`, `roofing_permits_needs_review` |
| 18 | `/v1/meta` | `limitations[].status` (:70) | typed `source_access_status` plus `incomplete_reason` and `records_request` |
| 19 | `/v1/meta` | (new) | add `cli_commit`, `lexicon_manifest_url`, `kit_commit` |
| 20 | Run | `dataset_cid` (:229) | as 13 |
| 21 | Run | `ipns` (:229) | as 14 |
| 22 | Run | `cars[]` (:230) | add `group`, `kind`, `schema_cid`, `block_count`, `car_validation`, `readback_url`; one entry per group archive plus each `tables.car` |
| 23 | Run | `sources[].status` (:226) | typed `availability` plus `source_access_status` |
| 24 | Run | `window` (:225) | add `loader_watermarks[]` and `tombstones_consumed` |
| 25 | Run | `counts`/`deltas` (:227) | add `dead`, `invalid`, `retryable`; `seed = ready + dead + invalid` |
| 26 | Run | (new) | add `atlas` {page_path, pr_url, validate_state, merge_state, revert_issue_url, ipns, index_cid, mcp_sync} |
| 27 | Run | (new) | add `cli_commit`, `lexicon_manifest_url`, `kit_commit`, `readiness_report` |
| 28 | Run | `gateway_checks[]` (:231) | add `codec`, `multihash`; checks target roots |
| 29 | Run | `limitations[]` (:228) | as 18 |
| 30 | Contractor | `contractor_id` (:213) | as 3 |
| 31 | Contractor | `company_name`, `printed_names[]`, `trade`, `phone`, `address` (:215) | kept raw; add `identity_status: "source_name_attribution"`; PII decision recorded in decisions.md section 4 |
| 32 | Contractor | `business_match` (:217) | renamed `registry_candidates[]` with `match_method` and `status: "candidate"`; never identity |
| 33 | Contractor | `bbb` (:218) | status vocabulary as 11 |
| 34 | Contractor | (new) | add `official_identity`, null until an official record matches |
| 35 | PermitSummary | `property_id` (:194) | add `property_link` {method, normalization_version, confidence}; null when zero or several candidates |
| 36 | PermitSummary | `is_roofing`, `is_reroof` (:196) | as 5/6; add `roof_work_class`, `work_classifier_version` |
| 37 | PermitSummary | `status` (:197) | add `status_observed_at` |
| 38 | PermitSummary | `status_group` (:198) | add `needs_review` |
| 39 | PermitSummary | date fields (:199) | add `completed_date_evidence`; null never reads as confirmed empty |
| 40 | PermitSummary | `open_since`, `open_duration_days`, `days_since_expiry` (:200) | basis fields as 9/10 |
| 41 | PermitSummary | `contractor` (:201) | `contractor_id` → `contractor_attribution_key`; add `identity_status` |
| 42 | PermitSummary | `source` (:204) | add `request_identifier`, `source_http_request` |
| 43 | PermitSummary | `cid` (:205) | renamed `record_cid`; add `property_cid`, `data_group_cid` |
| 44 | PropertySummary | `property_id` (:160) | as 1 |
| 45 | PropertySummary | `roof_year`, `roof_age_years`, `roof_age_basis` (:166) | as 7 |
| 46 | PropertySummary | `last_roofing_permit.is_reroof` (:167) | replaced by `roof_work_class` |
| 47 | PropertySummary | `roofing_permit_counts` (:168) | add `needs_review` |
| 48 | PropertySummary | `source`, `cid` (:172) | as 4/43 |

Unchanged: `has_bbb_contractor` (:171), `lat`/`lon`/`coordinate_basis` (:163-164) and the Owner schema (:177-186).

## README vs kit conflicts, and how both are satisfied

| # | README.md | Kit rule | How both are satisfied |
| --- | --- | --- | --- |
| 1 | :9, :66 Filebase+IPNS; "if IPNS is used, record name and resolved CID" | car-publication.md:191-193; oracle.md:22-24 (no per-county pointer) | Only the global `elephant-atlas` IPNS after merge; its name and resolved index CID recorded per run; no candidate name minted. |
| 2 | :59 manifest lists coverage, indexes, sample extracts | use-oracle/SKILL.md:27-29; car-publication.md:282-283 (no coverage objects) | Only kit-eligible objects listed; coverage as counts in the manifest; indexes = CountyIndex/CountyTables roots; sample extract = one property data-group root CID. |
| 3 | :70 manifest and CARs "in the repository or demo packet" | oracle.md:132-133 (never commit CARs) | Manifest committed; CARs only in the demo packet (Release assets) referenced by CID. |
| 4 | :69 every listed CID fetched from two independent public gateways, bytes matching digest | car-publication.md:217-219 (inner blocks not resolvable by bare CID); oracle.md:101 (digests across codecs) | Two-gateway checks on roots; inner blocks by path from the root or `?format=car`; multihash digests compared when codecs differ. |
| 5 | :17, :50-52, :96, :112-113 MCP-ready DuckDB, agent access | oracle.md:22-24; deploy-open-data-mcp:13-14 (Query DB never public; MCP never pointed at it) | Hosted DuckDB built only from Atlas-published, CID-verified `export-tables` output; distinct from Elephant MCP 2.0. |
| 6 | :13, :76, :105-106, :110-111 contractor identity and details | oracle.md:107-114 (name/phone are candidates; no contractor records without an official match) | Printed contractor fields returned as source-name attribution with `identity_status`; official identity only from an official record. |
| 7 | :33, :76, :94, :105-106 BBB rating where available | bbb-harvest:13-18 (403 → stop, request API access, no evasion) | `bbb` shipped as `blocked` with evidence and the access request on record; "where available" is met by an honest null. |
| 8 | :36, :74, :104 roof-age proxies, configurable threshold | permit-evidence-preflight.md:151-162; roof-age-and-identity-reingest.md:46-56 | Computed by the bundled estimator with confidence and caveats; the threshold stays a query parameter. |
| 9 | :27 "until all available county data is uploaded" | county-readiness-preflight:24-44; readiness-and-completeness.md:239-270; county-ingest-run:183-184 (never gate on an exact source count) | "All available" = loaded at least equal to achievable per source, with typed availability and every blocked jurisdiction visible with a records request. |
| 10 | :19, :67, :101-102 new immutable CIDs per republish | continuous-ingestion.md:147-150 | Consistent: each later run yields new group roots; prior CIDs untouched. |
| 11 | :7, :48, :84 no standing cost | continuous-ingestion.md:36-37; bootstrap-oracle-infra:9 | Consistent: Restate+Postgres run locally per job to a terminal state, then stop. |
| 12 | :41 visible run history with counts, deltas, limitations | oracle.md:103-106; car-publication.md:255-266 | Consistent once the run record carries Loader watermarks, tombstones and per-group CIDs. |
