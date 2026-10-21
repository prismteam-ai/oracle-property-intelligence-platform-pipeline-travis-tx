# Oracle second look, 2026-10-16

Read-only re-review by the kit's `oracle` agent of the corrected `docs/decisions.md` and `docs/api-contract.md`
(commit `0049bf9` plus the section 2 increment plan that was added just before this look), against the kit at
`99c7bff`. Same constraints as the first review: no edits, no ssh, no stack, no network, no MCP calls. Kit paths
are relative to the kit root; `reference/` means `skills/use-oracle/reference/`. Line numbers cite the state
that was reviewed; the fixes applied afterwards shifted them.

**Verdict:** the first review is resolved (20 of 22 rows resolved or fine, all 48 field changes present), but the
design was **not yet implementable** because of four items that change what the next reviewers would design.
Three were fixed the same day; the fourth was decided by the operator the same day (option ii, else iii; `decisions.md` §5), and the `mew` review verifies its premise.

## The four blockers

| # | Finding | Kit rule | Status |
| --- | --- | --- | --- |
| 1 | The hosted layer is declared to read only `export-tables` output, but most product fields the README needs (permit `description`, printed `status_current`, `expires_date`, the printed contractor fields, text search) have no `property_improvement` property. The class carries `permit_number`, `application_received_date`, `permit_issue_date`, `permit_close_date`, `completion_date`, `final_inspection_date`, `fee`, `contractor_type`, `is_owner_builder`, `is_disaster_recovery`, `permit_required`, `private_provider_*` and the enums `improvement_type`, `improvement_action`, `improvement_status`. `source_payload` is where the transform keeps lexicon-gap fields, and it is not a lexicon property. | model-c.json:12481-12686; reference/car-publication.md:104-106; build-county-transform/SKILL.md:102-109; output-contract.md:33 | **Decided by the operator the same day: (ii) if it holds, else (iii).** The options were (i) classify at transform time into the lexicon enums and list the homeless fields as lexicon gaps the hosted layer cannot serve; (ii) have the deploy-time build read the published archive blocks if `source_payload` survives validate → hash; (iii) re-read the public Socrata export at deploy for the non-lexicon columns, keyed by `permit_number`, with its own provenance. Recorded in `decisions.md` §5. |
| 2 | "Query tables only" permits and the Comptroller candidates could only come from the Query DB as written, which the kit forbids serving. | agents/oracle.md:22-24; use-oracle/SKILL.md:27-29; query-db-loading-matching/SKILL.md:169-171; reference/car-publication.md:13-19 (an unlinked permit cannot sit in a property-rooted archive) | Fixed: the API serves exactly the published `property_improvement` scope; unlinked and excluded permits are counts and limitations, never rows; registry candidates exist only if a `corporate_registry` group is published. |
| 3 | The section 2 plan harvested permits before the identity baseline and ran the pilot before the permit adapter, inverting `onboard-county` stages 6–8. | county-ingest-run/SKILL.md:8-18 ("harvesting permits first or in parallel with those registries is not allowed"); onboard-county/SKILL.md:59-81; county-ingest-run/SKILL.md:263-266 (`__NONE__` / `__ALL__` sentinels) | Fixed: increment 2's pilot is appraisal-only (`__NONE__`), increment 3 is the identity baseline, increment 4 builds the adapter, re-runs the pilot with `__ALL__` and runs the feasibility increment. |
| 4 | `decisions.md` asserted that the kit gitignores `data/` including `seeds/`. At `99c7bff` `skills/use-oracle/runtime/.gitignore` does not cover `data/` and `git check-ignore` matches nothing, so the seed CSV was committable on the kit branch. | agents/oracle.md:132-133; reference/self-contained-ingestion.md:100-118, :122-124; bootstrap-oracle-infra/SKILL.md:42 (describes, does not enforce) | Fixed: the first commit on the `travis` branch adds `data/` to the runtime `.gitignore`; the kit's clean-room gate is the proof. |

## Part 1. Resolution of the first review

| # | Claim or finding | Status | Note |
| --- | --- | --- | --- |
| 1 | `permit` class → `property_improvement` | resolved | edges confirmed at model-c.json:17681, :17687 |
| 2 | Digits-only `geo_id` join | resolved | naming aligned on `match_method` in both files |
| 3 | Contractor identity | partially resolved → fixed | identity baseline now precedes the harvest; license-number presence in the export and the TDLR/TSBPE decision are recorded in `travis-sources.yaml` |
| 4 | Regex tiers and `issue_date` fallback | resolved | the six work classes and the four confidence levels match `estimator.ts`; the mapping of the estimator's eligibility reason codes to `roof_age_basis` is now stated |
| 5 | Unmapped statuses | resolved | `Cancelled*` is now "the exact Cancelled values the export prints, enumerated in the profile fixtures" |
| 6 | Published derived tables | resolved | see blocker 1 for what the published tables can carry |
| 7 | Per-run IPNS | resolved | |
| 8 | CARs and seed data in git | partially resolved → fixed | blocker 4 |
| 9 | GIS-only contingency | resolved | |
| 10 | Rest-of-county permits | resolved | `records_request` fields match the validator |
| 11 | BBB access request | resolved | |
| 12 | Pilot size | resolved | pilot position fixed (blocker 3) |
| 13 | Single `dataset_cid` | resolved | |
| A–F | CAR validation, publication state, provenance, partial scope, Comptroller exception, watermarks | resolved | |
| G–I | runtime shutdown, kit-branch wording, contingencies | fine | |

## Part 2. Field inconsistencies found and fixed

| Item | Problem | Fix applied |
| --- | --- | --- |
| `atlas` (14/26) | two shapes under one name in `/v1/meta` and Run | one shape everywhere |
| `limitations[]` (18/23/29) | `source_access_status` typed with the availability vocabulary | `availability` and `source_access_status` are two fields, as on `sources[]` |
| `property_link` (35) | API `method` vs decisions `match_method` | `match_method` in both; `unlinked_reason` added (`no_candidate`, `multiple_candidates`, `invalid_quarantined`), each counted |
| `cars[]` (22) | decisions.md omitted `kind` | added |
| `record_cid` (4/43) | wording implied the CLI writes a `record_cid` column | "the tables' `cid` column, renamed" |
| `completed_date_evidence` (39) | five of the kit's seven states | the seven-state vocabulary, `stale` and `conflicting` unused in v1 |

## Part 3. New findings and what was done

| Finding | Verdict | Done |
| --- | --- | --- |
| Increment count (eight, later ten) against the floor of four; no `iterationGuide` exists for Oracle in the product catalog | fine | stated in §2 |
| Run stages placed inside the ingest increments | fine | kept |
| Explorer and agent as one increment | acceptable if recorded | split into two increments (different inspection points) |
| Increment "run 2" read as a rerun | acceptable if recorded | renamed to the incremental-refresh capability (windowed delta, stale-snapshot queue, multi-run history), demonstrated by run 2 |
| No feature IDs, dependencies, checkpoints, progress rows | acceptable if recorded | IDs T1–T10 with dependencies and checkpoints; progress rows in `docs/progress.md` |
| Contractor phone and address as printed | acceptable if recorded | privacy classification recorded in `travis-sources.yaml`; whether the fields enter a published record depends on blocker 1 |
| Search-center rename | fine | |
| Live status refresh out of v1 | acceptable if recorded | recorded in the permit-evidence gap ledger with the affected decision; `status_observed_at` on every row |
| Blank `completed_date` as `unknown` | acceptable if recorded | per-field evidence-state counts added to the run record and `/v1/meta` |
| `status_evidence` is not one of the kit's evidence states | acceptable if recorded | renamed `status_source` |
| `closed` could be read as the estimator's `completed` | acceptable if recorded | the profile maps lifecycle status separately: only `Final` → `completed`; `Withdrawn`, `Cancelled`, `VOID`, `Expired` → `other` |
| Roof age computed in reconciliation and at deploy | acceptable if recorded | the estimator runs twice with the same frozen profile; the transform does not pass `roofAge` to the runner; the two counts must reconcile |
| `company` and `person` listed among produced classes | acceptable if recorded | stated: roll owners in the `county` group, not contractors |
| `request_identifier` for `property_improvement` entities | acceptable if recorded | stated: the Socrata export GET as `source_http_request`, the parcel's `PROP_ID` as `request_identifier` |
| "Atlas-published" as a dependency of the hosted layer | acceptable if recorded | "uploaded with readback, CID-verified"; the Atlas merge is not a dependency |
| Manifest pinned as `manifest_cid` | fine as recorded | stated: a README-packet descriptor, never referenced from the Atlas page |
