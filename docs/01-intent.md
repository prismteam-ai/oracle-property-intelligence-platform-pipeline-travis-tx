---
id: VIS-A
type: vision/problem-framing
title: Oracle Pipeline (Travis County, TX)
parent: BN-A                # the task README
project: oracle-property-intelligence-platform-pipeline-travis-tx
owner: HebaGaber             # PO
status: Approved             # Draft → In Review → Approved → Returned
gate: G0
version: 0.1
created: 2026-10-17
approved_by: [HebaGaber]
approved_date: 2026-10-17
---

# Intent and Evidence Model: Oracle Pipeline (Travis County, TX)

> **How to use (you + Claude):** paste the README verbatim under *Input*. Fill every mandatory section. Anything you do not know becomes `[NEEDS CLARIFICATION: question]`; never guess. Stay at the problem level here (what and why). The *how* belongs in the plan and the architecture constitution. Run the `developmentsupport-vision` skill to draft it and the G0 pre-check to check it.

**Input (raw assignment):** see `README.md` at commit `e778d6f`.

Other inputs: `../assessment-guide/reference/A-oracle.md` §§ 1–2 (draft intent and evaluation points); the kit's evaluator catalog entry "Oracle Property Intelligence Platform" (`soofi-xyz-team-kit/skills/evaluate-candidate-product/reference/assignment-evidence-catalogs.md`, kit 0.99.1); the working assumptions decided on 2026-10-17 instead of assessor questions (`../assessment-guide/PUBLISHING.md` § 1.4); live source checks run on 2026-10-17. Requirement-by-requirement mapping: [traceability.md](traceability.md).

## 1. Intent (mandatory)

> A **roofing-CRM builder, or its AI agent,** can **find aged-roof and long-open-roofing-permit leads anywhere in Travis County, TX, from real, reconciled, source-backed property data** so that **roofing companies get trustworthy leads while the data stays publicly retrievable and Oracle carries no ongoing infrastructure cost.**

**Task read (one sentence):** Finish the Travis County Oracle pipeline so that all available public property, permit, owner, contractor, BBB, business and location data is loaded, reconciled and kept current by repeated incremental runs. Each run is published as immutable, publicly retrievable IPFS snapshots. The data is then proven usable through a UI, an agent and an MCP-ready interface that answer roofing-lead questions, with no Oracle-hosted database left running.

## 2. Problem statement (mandatory)

Roofing companies find work by spotting homes whose roofs are old or whose roofing permits have stayed open for years. In Travis County that evidence is scattered:
- property, owner and year-built data sit with the appraisal district;
- permits sit with the City of Austin and more than a dozen other jurisdictions;
- contractor identity, business registrations, BBB ratings and parcel coordinates each come from yet another source.

No single place joins these into one trustworthy record per property, says which source each fact came from, or keeps it current as permits open and close. The Oracle pipeline for Travis County was started but never completed, reconciled or demonstrated. The Roofing CRM therefore has no real data to stand on.

The data must also outlive the people who built it. It must stay retrievable from the public network after any one vendor, laptop or demo session is gone, and keeping it available must not leave Oracle paying for infrastructure.

## 3. Affected users and stakeholders (mandatory)

| Actor | Role | What they need from this app |
| --- | --- | --- |
| Roofing CRM developer | Primary consumer | A stable, documented data model they can query (radius, roof age, open permits, owner tenure, out-of-area owners) without changing it later |
| AI agent (the CRM's, or the hosted one) | Primary consumer | A query interface (MCP-ready) that returns source-backed answers and says what data is missing |
| Roofing company sales rep | End beneficiary, through the CRM | Leads that are real, current and explainable: why the roof counts as aged, who the contractor is, how long the permit has been open |
| Oracle operator (the candidate) | Secondary: runs the pipeline | Repeatable incremental runs, visible run history, and documented source limits |
| Third party with only the CIDs | Secondary: independent retriever | The run manifest and artifacts fetchable from public IPFS gateways after the candidate's environment is gone |
| Evaluator | Assessor | Every demo-transcript line passes on the hosted runtime using real Travis County records |

## 4. Evidence model (mandatory)

| Element | Content |
| --- | --- |
| Actors | CRM developer or agent (consumer), Oracle operator, independent retriever, evaluator (§ 3) |
| Workflow | Identify every public Travis County source → collect records → merge duplicates into one canonical entity per property, owner and contractor, keeping per-record provenance → publish a run snapshot as immutable CIDs with a manifest → re-run incrementally over time, adding run history → answer roofing-lead questions through the UI, the agent and the MCP-ready interface |
| Data objects | Property/parcel; structure (year built, roof-age basis); owner and mailing address; sale or deed date; permit (jurisdiction, type, work class, status, issue/final dates, open duration); contractor company; BBB profile and rating; business entity; coordinates; pipeline run (sources, counts, deltas, limitations); published artifact (CID, name, size, codec, digest) |
| Scale signals | **City of Austin permits**, Socrata `3syk-w9eu`: **2,380,507 rows** (live count, 2026-10-17T10:00Z; latest `:updated_at` 2026-10-16T15:08Z). **Roofing subset:** **22,083** of those rows have `REROOF`, `RE-ROOF` or `ROOF REPLACE` in the description (same query). `work_class = 'Roof'` alone matches only 52 (A-oracle.md, 2026-10-15). **Parcel join gap:** **63,019** Austin permit rows (2.6%) have no `tcad_id` (live, 2026-10-17). **Property denominator:** the TCAD 2026 certified appraisal roll account count, measured in story A-01 (see ASM-6). Austin-issued permits located in other cities, from the same dataset: Lakeway 6,825; Bee Cave 4,822 (A-oracle.md, 2026-10-15). |
| Runtime proof | A hosted explorer showing: run summary and history; counts per source against each source's own denominator; the run manifest; a live two-gateway CID fetch with digest match; radius plus roof-age results; open roofing permits ranked by open duration, with contractor and BBB. A hosted agent answering both README prompts with evidence. An MCP-ready interface that lists its tools and answers a query. |
| Access boundaries | **Allowed:** public sources only, within their published terms and rate limits; a polite, identified user agent. **Forbidden:** CAPTCHA or bot-challenge bypass, IP rotation or other evasion; continuing after a BBB 403 (stop and record it); exposing the internal Query DB to any consumer (consumers read only published CIDs); paid or credentialed sources presented as public; synthetic or invented records presented as real. **Publication:** only `elephant-cli` output is published, as CIDv1, and published CIDs never change. **Secrets** (Filebase, AI Gateway, MCP token) never appear in git, logs or the UI. |
| Demo evidence | Every README demo-transcript line (D-1 to D-12 in [traceability.md](traceability.md)), in order, on the hosted runtime with real Travis County records |

## 5. Business value (mandatory)

- Value driver: **revenue** (more qualified roofing leads for CRM users) and **cost** (Oracle carries no standing infrastructure); secondary **risk** (every answer is source-backed, and access stays within public terms).
- Rough magnitude: the reroof-description query above already finds 22,083 historic Austin reroof permits, which become roof-age anchors. The number of aged-roof properties reachable in one radius search depends on the TCAD roll and is measured after story A-04 (ASM-6).

## 6. High-level feasibility (mandatory)

| Concern | Finding | Blocker? |
| --- | --- | --- |
| Data availability | Austin permits: verified live (2.38M rows, incremental `:updated_at` filter works). TCAD exports are listed publicly, but `traviscad.org/publicinformation` returned **HTTP 403** to this machine on 2026-10-17 (browser user agent). PUBLISHING.md recorded 200 on the same day, so the response varies. Travis County GIS timed out (2026-10-17). BBB answers with a Cloudflare bot challenge. Texas has no statewide roofing licence; business identity comes from the Comptroller franchise-tax dataset (lead, `9cir-efmm`). Other jurisdictions' permits are unverified leads. | No → story A-01 measures every source and classifies blocked ones with evidence. A blocked source falls back to a US-hosted GitHub Actions runner (no evasion). BBB coverage may be partial or zero, which the README allows ("where available"). |
| Access and accounts | AWS demo account in `eu-north-1` works. Filebase account created. GitHub fork in place. **Route 53 domain registration is refused** on this Free plan account ("Free Tier accounts are not supported"), and there is no hosted zone. **Bedrock** is unblocked: the support case was approved, and on 2026-10-17 the `eu-north-1` quota for Claude Sonnet 4.6 cross-region inference was 6,000,000 tokens and 10 requests per minute. A test call to `eu.anthropic.claude-sonnet-4-6` returned a reply. The **AI Gateway** also runs embeddings. Atlas registration is not required by the README (ASM-2). | No → the product owner owns `aldarraj.com`, so the explorer runs at `countylens.aldarraj.com` (ASM-8), with the Amplify URL as fallback. The agent uses Bedrock (ASM-9). The 10 requests per minute limit is enough for the demo, but the agent must handle throttling. |
| Cost | Zero idle cost is achievable in principle: the data lives on public IPFS, queries run in DuckDB over published files, and the hosted pieces scale to zero. Ingestion runs on the laptop's local stack, which is already up. | No |
| Time | Assignment start 2026-10-11 (provisional, `docs/00-timeline.md`); work started 2026-10-17. Full-scale loads (millions of permit rows, the full appraisal roll, paged GIS at 2,000 features per request) need measured throughput. | No, but A-01 must measure throughput before scope is fixed. No deadline is stated in the README (ASM-4). |

## 7. Scope boundaries (mandatory)

- **In scope:**
  - Every publicly available Travis County source for property, permit (all jurisdictions, emphasis on roofing), ownership, contractor, BBB rating, business and coordinate data.
  - Merging duplicates across all of them, with per-record provenance.
  - Roof age with its basis and a configurable threshold (default 15 years).
  - Long-open permit signals.
  - Incremental runs with visible history.
  - Public CIDv1 publication with a manifest per run, CARs for directories and two-gateway verification.
  - A DuckDB query layer with no Oracle-hosted database.
  - An exploration UI, an agent and an MCP-ready interface.
  - Documentation of performance and source limits, and proof of zero standing cost.
- **Out of scope:**
  - The Roofing CRM UI, map pin and GPS interaction design, and lead outreach workflows (README; covered by the roofing-crm repo).
  - Live outbound messaging to property owners (README).
  - Counties other than Travis (README sets Travis as the target).
  - Paid data sources such as Texas SOSDirect, and any data that needs a CAPTCHA or bot-challenge bypass (access boundaries).
  - Atlas registration (not required by the README; listed as pending, ASM-2).

## 8. Evaluation points (sum = 40) = success criteria (mandatory)

Each point is an observable outcome on the hosted runtime, not a feature. The evaluator's catalog entry adds two signals that are folded in here: **canonical entity and relationship modeling** (A2) and **RAG-backed retrieval over the real records** (A6). Its scale signal ("sparse data scores extremely low") is why A1 carries the most weight.

| SC | Evaluation point | Sub-weight | What proves it on the live runtime |
| --- | --- | --- | --- |
| SC-1 (A1) | **Coverage and scale.** All available Travis County property, permit, ownership, contractor, BBB, business and coordinate records are loaded at full scale, with source limits and speeds documented. | 10 | Run summary and coverage view: counts per source compared with each source's own denominator (TCAD certified roll; Austin dataset row count), collection timestamps, and a documented limitation for every gap |
| SC-2 (A2) | **Reconciliation, canonical entities and provenance.** Duplicates across all datasets are merged into one entity per property, owner and contractor, and every record and answer cites its source. | 6 | Any property opens with source URL, capture time and digest per fact; a "duplicates merged" statistic per entity type; one worked example showing the merged records and their lineage |
| SC-3 (A3) | **Continuous, incremental ingestion.** New and changed records are picked up by bounded or change-detected refreshes, and run history is kept. | 6 | Run history with at least 3 runs: timestamps, sources, record counts, deltas and limitations. Runs after the first are windowed, not full reloads. |
| SC-4 (A4) | **Durable public publication at zero standing cost.** Each run is published as immutable CIDv1 artifacts with a manifest and CARs, retrievable from public IPFS without the candidate's environment. | 7 | Manifest per run (cid, name, size, codec, SHA-256). CAR for each directory root. A live fetch from two independent public gateways with size and digest match. The previous run's CID still resolves after a republish. A cost view shows no standing Oracle infrastructure. |
| SC-5 (A5) | **Roofing-lead queries in the UI over the DuckDB layer.** | 6 | On the explorer: radius plus roof age over N years (with basis, coordinates, provenance); open roofing permits ranked by open duration, with contractor and BBB; owner tenure over 10 years; out-of-area owners. The query layer runs without an Oracle-hosted database. |
| SC-6 (A6) | **Agent and MCP access with RAG-backed retrieval.** | 5 | The hosted agent answers both README prompts over real records with reasoning, evidence and stated assumptions or missing data. The MCP-ready interface lists its tools and answers a query without changing the data model. |
| | **Sum** | **40** | |

Every README acceptance criterion (AC-1 to AC-47) and demo line (D-1 to D-12) maps to one of these points in [traceability.md](traceability.md) § 1.

## 9. Assumptions and open questions (mandatory)

- **ASM-1 (AWS).** Everything runs in the candidate's own demo AWS account in `eu-north-1`. The code reads the region from config (company default `us-east-2`). *Test:* CDK synth shows no hard-coded region.
- **ASM-2 (Atlas).** CIDs are published with the candidate's own run manifest. Atlas registration is listed as pending, because the README doesn't require it. *Test:* the PR states it.
- **ASM-3 (PRs).** The Oracle and CRM PRs are independent; the CRM reads Oracle data by CID.
- **ASM-4 (Timing).** The start time is the upstream repo's first commit (2026-10-11T18:32+03:00) unless the exact send time becomes known. No deadline is stated, so the plan assumes about 10 working days.
- **ASM-5 (BBB).** "Where available" allows partial coverage; zero coverage is a documented gap, not a failure. *Test:* story A-08 records coverage and any 403 evidence.
- **ASM-6 (Property denominator).** The TCAD certified roll account count is the property denominator, and it is not yet measured. *Test:* story A-01 records it with source and date; story A-04 reconciles to it.
- **ASM-7 ("All available").** "All available" means every source that is public, reachable within its terms, and free. Anything excluded is recorded with evidence (blocked, paid, records request only, no public history). *Test:* story A-01 classifies every source and every permit jurisdiction.
- **ASM-8 (Hosted URL).** The explorer runs at `https://countylens.aldarraj.com`. The product owner owns `aldarraj.com` (registered outside Route 53, which refuses registration on this Free plan account). The Amplify URL `https://{branch}.{app-id}.amplifyapp.com` is the fallback; both are valid hosted runtimes.
- **ASM-9 (Agent model).** The agent uses `AI_PROVIDER=bedrock` with `eu.` inference profiles, through the Vercel AI SDK. The quota was raised on approval of the support case and confirmed by a live test call on 2026-10-17. `AI_PROVIDER=gateway` remains the fallback. *Test:* story A-14's golden queries run on Bedrock under the 10 requests per minute limit.
- **ASM-10 (Credentials).** The explorer, agent and manifest are public with no login. The MCP endpoint uses a bearer token shared privately.

No `[NEEDS CLARIFICATION]` markers remain. Every unknown is a stated assumption with a test, because the access questions were resolved as working assumptions (§ 12).

## 10. Candidate directions (optional, not a committed design)

From `reference/A-oracle.md` and the `arceus` routing (§ 13). The architecture constitution at G3 decides; nothing here is committed.
- Ingest on the local Restate + Postgres stack (already running) with the kit's Oracle runtime.
- Publish with `elephant-cli` to Filebase and IPFS.
- Query with DuckDB over the published Parquet tables.
- Host a serverless explorer, agent and MCP on AWS that scale to zero.

## 11. Gates (assessment)

| Gate | How I will satisfy it |
| --- | --- |
| PR | PR from `HebaGaber:feature/oracle-pipeline` to `prismteam-ai/oracle-property-intelligence-platform-pipeline-travis-tx:main`, never merged |
| Runtime | The hosted explorer (ASM-8), which needs no local setup. localhost is never evidence. |
| Credentials | Public explorer, agent and manifest. MCP bearer token shared privately (ASM-10). |
| Demo | A video walking D-1 to D-12 in order, linked from the PR |

## 12. Open questions (none sent to the assessor; decided 2026-10-17)

None sent. On 2026-10-17 the product owner decided not to message the assessor and to state working assumptions in the PR instead (`PUBLISHING.md` § 1.4). They are ASM-1 to ASM-5 above. BBB and egress were checked directly instead of asked.

## 13. Kit routing (arceus output, pasted)

Planning step P1, 2026-10-17. `soofi-xyz-team-kit:arceus` (kit 0.99.1) was asked for the primary and supporting agents and skills for the eight build areas of the README. Every area also loads `apply-engineering-guidelines`. Agent names are invoked as `soofi-xyz-team-kit:{name}`. Decisions on the differences from `AGENT-MAP.md` are in [kit-usage.md](kit-usage.md#kit-routing-decisions-p1).

*Story merge (2026-10-21):* A-04 … A-18 now run as 6 merged stories. Story IDs in this table are **part** IDs, and each part belongs to one merged story: A-05, A-06 → A-04 · A-08, A-09, A-10 → A-07 · A-12 → A-11 · A-18 → A-13 · A-15 → A-14 · A-17 → A-16.

| Area | Stories | Primary | Supporting | Skills | Invocation hint |
| --- | --- | --- | --- | --- | --- |
| County ingestion | A-01, A-04, A-05, A-06, A-08, A-09 | `oracle` | `mew` (contract and schema), `donphan` (read-only count checks) | `onboard-county`, `county-discovery`, `county-readiness-preflight`, `bootstrap-oracle-infra`, `county-seed-data`, `county-appraisal-onboarding`, `build-county-transform`, `county-ingest-run`, `county-permit-adapter`, `bbb-harvest`, `overture-places-ingest`, `monitoring-county-ingestion`, `use-neutral-lexicon` (via `mew`) | Use the `oracle` subagent to discover and ingest Travis County TCAD appraisal, roofing permits, BBB ratings and Overture places, loading `onboard-county` and `county-ingest-run`. |
| Reconciliation and roof age | A-07, A-10 | `oracle` | `mew` (entity-resolution rules), `porygon` (cross-source reconciliation, reviewer), `donphan` (reviewer) | `query-db-loading-matching`, `use-oracle`, `unify-metrics` (via `porygon`) | Use the `oracle` subagent to reconcile duplicate owners and contractors and derive roof age (year built vs last roofing permit, 15-year threshold) with lineage, using `query-db-loading-matching`. |
| IPFS publication | A-11 | `oracle` | `donphan` (reviewer) | `use-oracle` | Use the `oracle` subagent to publish Run 1 via `elephant-cli` as CIDv1 with CARs and an artifact manifest, then verify size and digest on ipfs.io and dweb.link. |
| DuckDB query layer | A-02, A-03 | `metagross` (serving), `oracle` (tables via `elephant-cli export-tables`) | `oracle`, `mew` | `build-frontend-backends`, `use-oracle` | Use the `metagross` subagent to serve DuckDB over the published CID-addressed Parquet tables behind a tRPC API, with no hosted database. |
| Explorer UI | A-13 | `metagross` | `audino` (UI review, regression tests), `smeargle` (responsive tests) | `build-frontend-backends`, `frontend-bug-fix`, `responsive-design-tests` | Use the `metagross` subagent to build the explorer: run summary, counts by source, manifest, radius search with roof age, open roofing permits with contractor and BBB, Atlas tokens and provenance on every result. |
| Natural-language agent | A-14 | `alakazam` (retrieval), `ash` (runtime) | `ash`, `donphan` (cross-checks answers via the MCP) | `build-ai-agents`, `build-rag-systems` | Use the `alakazam` subagent to build the roofing-lead agent on the Vercel AI SDK (`AI_PROVIDER`) with tool calls into the DuckDB/MCP layer, answers with evidence and stated assumptions, verified against golden queries G1–G6. |
| MCP server | A-15 | `oracle` | `donphan` (proves the server by querying through it) | `deploy-open-data-mcp`, `use-elephant-mcp` | Use the `oracle` subagent to deploy and sync the open-data MCP for Travis County and verify it with MCP Inspector on the hosted URL. |
| Scheduled refresh | A-12, A-16 | `machamp` (scheduler), `oracle` (incremental runs) | `oracle`, `porygon` (run-to-run deltas, reviewer), `metagross` (cost page, A-16) | `build-batch-workflows`, `durable-workflow-builder`, `use-oracle`, `monitoring-oracle-ingestion` | Use the `machamp` subagent to build a CDK-scheduled incremental refresh in the configured region with run history (deltas, old and new CIDs), never changing a published CID, at zero idle cost. |

**Cross-cutting**

- Review: `/code-review`; each story's builder scores its own area in `docs/reviews/CR-{ID}.md`; `audino` for UI; `donphan` and `porygon` for data.
- Testing: `developmentsupport-testcases` and the G4–G7 pre-checks; Playwright on the hosted URL, never localhost.
- Responsive tests: `smeargle` with `responsive-design-tests` on every `ui: true` story (A-03, A-13, A-14, A-16).
- CI/CD: `integrate-ci-cd` (A-03).
- Evaluation: `slowking` with its candidate-evaluation skills, for a practice score before submission.
- Avoid: `babysit-release`, because it drives a PR through merge and this repo never merges its PR.

**Gaps arceus flagged**

- No Texas business-registry or contractor-licence skill (`sunbiz-corporate-ingest` and `dbpr-license-ingest` are Florida-only). `oracle` with `county-permit-adapter` covers it; limits go into the documented source constraints.
- No DuckDB skill. `query-db-loading-matching` is not used for it, because that skill's internal store must never be the public data source.
- `ash` is an Asana-triggered agent builder, so it is a partial fit: A-14 uses its runtime and memory patterns, not its Asana entry point.

**Agents recommended:** `oracle`, `mew`, `donphan`, `porygon`, `metagross`, `audino`, `smeargle`, `alakazam`, `ash`, `machamp`, `slowking`.

---

## Gate G0: Vision Approval

| # | Criterion | Status |
| --- | --- | --- |
| G0-1 | Problem stated independently of any solution | ☑ |
| G0-2 | Target users and stakeholders identified | ☑ |
| G0-3 | Business value articulated | ☑ |
| G0-4 | Feasibility checked; no unmitigated blocker | ☑ |
| G0-5 | Scope boundaries (in / out) stated | ☑ |
| G0-6 | Evaluation points sum to 40, and each is observable on the runtime | ☑ |
| G0-7 | Every README acceptance criterion maps to an evaluation point | ☑ |
| G0-8 | No `[NEEDS CLARIFICATION]` markers left (or each one has been sent to the assessor) | ☑ |
| G0-9 | AI pre-check (`developmentsupport-vision`): PASS, report pasted below | ☑ |

**AI pre-check report:** PASS with 4 warnings. Full report: [gates/G0-VIS-A-precheck.md](gates/G0-VIS-A-precheck.md).

**Decision:** ☑ Approved ☐ Returned · HebaGaber · 2026-10-17
