# Oracle pipeline, Travis County TX: the full county published by CID in six immutable runs, explored, queried by an agent and an MCP server, at $0 fixed cost

> **Ready for review.** All nine stories (A-01 to A-04, A-07, A-11, A-13, A-14, A-16) are built, reviewed and merged (`--no-ff`, one merge per story) on `feature/oracle-pipeline`, each through gates G4 to G7. The live site serves **Run 4** (2026-10-26) at **https://countylens.aldarraj.com**.

## Outcome

The Travis County property and permit data is collected from the public sources, reconciled, published to IPFS as content-addressed snapshots with `elephant-cli`, and made usable for roofing lead generation: a hosted Explorer with radius, roof-age, open-permit and owner filters, a source-backed agent, and a read-only MCP server, all reading the published CIDs through DuckDB. Nothing runs or bills while idle.

**The candidate did both jobs.** As **Oracle**: discovered and classified every source, ran the county pipeline six times (a pilot slice, Runs 1 to 3, the Run 3.1 correction and the Run 4 incremental refresh), published each run with `elephant-cli` as CIDv1 artifacts, pinned them on Filebase and Pinata and verified them by CID on public gateways this project does not operate. As **builder**: the CountyLens app, the query API, the agent, the MCP server and the zero-idle-cost AWS stacks, each story through gates with tests on the hosted URL.

**On real data:** 441,961 Travis County properties (TCAD certified roll; 441,940 with a street address; owners, tenure and coordinates), 15,025 City of Austin roofing permits with status, dates, open duration and the contractor as printed (4,552 name one), the contractor match against 342,333 Texas Comptroller registry rows, and owner mailing ZIPs for the out-of-area filter.

## Links

| What | Where |
| --- | --- |
| Runtime | **https://countylens.aldarraj.com** (Amplify, `eu-north-1`; the served build is named at `/build.json`) |
| Test credentials | The demo path is public, no login. The admin test account (`/admin/sign-in`: run controls, Activity) and the MCP bearer token have been shared privately with the team, never in the repository |
| Demo video | **https://youtu.be/njYF63sCr2M**. Script: [`design/03-demo-script.md`](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/blob/feature/oracle-pipeline/design/03-demo-script.md): each README line with its link, what to show and the figures on screen |
| MCP server | `POST https://s7h96zfam0.execute-api.eu-north-1.amazonaws.com/mcp` (Streamable HTTP, bearer token, six read-only tools); a live "Try a tool" without a token at `/help/mcp` |
| Latest run | **Run 4** `travis-full-run4-20261026`, manifest CID `bafkreig76n7d6oiaxwmzu2mpoww4lttnr2mkawmgkqqnekxl7x7cf4hsha` ([`manifest.json`](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/blob/feature/oracle-pipeline/runs/travis-full-run4-20261026/manifest.json)), previous Run 3.1 `bafkreidbqsav3rsbxqy5fx3li73uskfth254nz5zw34xwac5w3fd4tmbai` |
| Run history | [`runs/index.json`](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/blob/feature/oracle-pipeline/runs/index.json): six runs from 2026-10-21 to 2026-10-26; each manifest names its predecessor (`previousManifestCid`); no IPNS (the index and the chain are the pointer) |
| Independent verification | `npx tsx scripts/verify-manifest.ts runs/travis-full-run4-20261026/manifest.json --sample` fetches by CID from Pinata and orbitor and checks size and SHA-256; in the app, `/data/verify/<cid>` does the same in the browser |
| CI | GitHub Actions runs on the fork, so they do not appear in this PR's checks list: [all runs on `feature/oracle-pipeline`](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/actions?query=branch%3Afeature%2Foracle-pipeline) (secret scan, workspace checks, pipeline runtime, and Playwright on the hosted URL in seven shards) |

## Progress since the last update (2026-10-26)

| What | Result |
| --- | --- |
| Run 4, a real incremental refresh | Austin re-stamped its dataset, so all 2,381,895 rows were paged and compared by content digest: **9 added, 35 changed, 0 removed**, watermark moved to 2026-10-25T12:55Z. None of the changed rows is a published roofing permit, so all 285 artifacts kept Run 3.1's CIDs and only the manifest is new. All 8 publish steps passed (identity gate, Filebase, CAR files adopted by gateway probe, manifest, CID copy, remote identity gate, release, index); Pinata holds the new manifest with the same CID |
| Data-binding audit (11 findings, every label traced to its field) | Street addresses and owner mailing ZIPs shown where Run 3.1 publishes them; run numbers follow the run id (Run 3.1, Run 4); Compare matches files by CID; county coverage reads the roll total (89.6 %); decimal sizes; plain words for contract codes; the roof evidence chain cites the permit for permit-based ages |
| README and demo walk-through (line by line, live) | Fixed: the demo place (Austin, where long-open permits exist), the agent's permit question (an open permit includes stalled ones, PO decision), the "all matches are stalled" note, reconciliation visible on Coverage, TCAD's placeholder year 1900 shown as approximate, "permits cover the City of Austin only" wherever a property has no permit, Verify explains the retired ipfs.io and dweb.link |
| Prototype parity and Explore | One left drawer for Filters and AI (collapsible); the board's results table at 1440 px with contractor and BBB; the AI tab keeps the results list and drives it with the answer's filters; an expired permit reads "Stalled · open past expiry"; MCP and Coming soon in the rail, a legal footer, Coverage rebuilt for reading; style cleanup across pages |
| Evaluator self-score | The assessor's evaluator rubric was applied to the live app; every functional finding above was fixed and re-tested on the hosted URL |
| Second label review (every screen against the manifest and API) | Compare opens the right pair from Runs ("Run 4 vs Run 3.1") and names runs, not list positions; per-source deltas only for neighbouring runs; the Fetch step and Latest events separate what a run captured from what it carried over (Run 4: Austin permits fetched, TCAD and address points carried); a batched run's CAR link reads "CAR 1 of 15"; "all N matches are stalled" only when every match is on the page; Data licences lists the City of Austin address points |
| Permit status from dates, corrected (found by the Roofing CRM team) | A permit with no City status word was guessed stalled from its issue date alone. Now it is closed when it carries an accepted completion date (952 permits) or when a later roofing permit on the same property finished (17, reason "superseded by a later finished roofing permit"); a City status word is never overridden. Run 4: stalled 1,674 → 705, open 80 unchanged; the demo's long-open search near Austin is 286 permits on 225 properties, led by a permit stalled since 2001 instead of a 1982 permit beside a roof replaced two years ago. The views are v1.3 and Run 4's Explore index was rebuilt and verified (0 differences against the views) |
| Explore and shell polish | "Ask about this property" asks at once; a new search or tab change starts the AI tab afresh; no printed contractor reads as a plain dash; Coverage draws no "no count" label for published tables; the empty Timeline card is gone; a tab left open across a release reloads itself once instead of failing |

## Evaluation points

| README area | Status | Evidence |
| --- | --- | --- |
| Geography, data loading, provenance | Met; permits are City of Austin only (the other 22 jurisdictions offer records requests only) and BBB ratings are not collectable (bbb.org answers 403) | [`docs/evidence/A-04.md`](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/blob/feature/oracle-pipeline/docs/evidence/A-04.md), [`docs/evidence/A-07.md`](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/blob/feature/oracle-pipeline/docs/evidence/A-07.md), [`docs/source-limits.md`](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/blob/feature/oracle-pipeline/docs/source-limits.md) |
| Roof age (configurable threshold, default 15), reconciliation | Met: roof age with basis and confidence; permit-to-parcel reconciliation counts on Coverage | [`docs/evidence/A-13-roof-age.md`](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/blob/feature/oracle-pipeline/docs/evidence/A-13-roof-age.md), [`docs/evidence/A-07.md`](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/blob/feature/oracle-pipeline/docs/evidence/A-07.md) |
| Continuous and incremental | Met: watermark windows, re-stamp detection with digest deltas, idempotent publish steps, run history with deltas and limitations; Run 4 is the latest incremental run; the scheduler is deployed and off by default ($0 idle) | [`docs/evidence/A-11.md`](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/blob/feature/oracle-pipeline/docs/evidence/A-11.md), [`specs/011-publish-and-runs/run4/STATE.md`](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/blob/feature/oracle-pipeline/specs/011-publish-and-runs/run4/STATE.md) |
| IPFS publication (CIDv1, manifest, CARs, two independent gateways, immutability) | Met | [`docs/evidence/A-11.md`](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/blob/feature/oracle-pipeline/docs/evidence/A-11.md), [`docs/evidence/A-16.md`](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/blob/feature/oracle-pipeline/docs/evidence/A-16.md) § AM-10 |
| DuckDB, zero idle cost | Met: DuckDB over the published Parquet on a Lambda that scales to zero; $0.00 fixed per month | [`docs/cost.md`](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/blob/feature/oracle-pipeline/docs/cost.md), [`docs/decisions/0001-read-path.md`](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/blob/feature/oracle-pipeline/docs/decisions/0001-read-path.md) |
| UI, agent, MCP (radius, aged roofs, long-open permits with contractor and BBB, tenure > 10 years, out-of-area owners) | Met, live | [`docs/evidence/A-13.md`](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/blob/feature/oracle-pipeline/docs/evidence/A-13.md), [`docs/evidence/A-14-agent.md`](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/blob/feature/oracle-pipeline/docs/evidence/A-14-agent.md), [`docs/evidence/A-14-mcp.md`](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/blob/feature/oracle-pipeline/docs/evidence/A-14-mcp.md) |

The README criterion-by-criterion matrix is [`docs/traceability.md`](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/blob/feature/oracle-pipeline/docs/traceability.md).

## Story status

| Story | Status | Merge commit | Gate |
| --- | --- | --- | --- |
| A-01 Discover sources and pass readiness | Done | `6c1383a` | G7 |
| A-02 Freeze the data contract | Done | `e98c12e` | G7 |
| A-03 Walking skeleton: one month by CID on a hosted page | Done | `8ae1870` | G7 |
| A-04 County backbone (TCAD, owners, coordinates, permits) | Done | `01ee900` | G7 approved with exceptions |
| A-07 Enrich and reconcile (contractor identity, roof age) | Done | `5cb3090` | G7 |
| A-11 Publish the full county by CID, incremental runs | Done | `50f9a10` | G7 approved with exceptions |
| A-13 Explorer UI and pages | Done | `c4b065e` | G7 approved with exceptions |
| A-14 Agent and MCP server | Done | `283bf51` | G7 approved with exceptions |
| A-16 Zero idle cost, admin, prototype parity, full-county index | Done | `d02430c`, demo polish `972d864` | G7 |

## Verification

| What | Result |
| --- | --- |
| Unit and integration tests | About **2,800 passed, 0 failed** across the workspace on the branch head (breakdown under Validation and testing) |
| Hosted end-to-end (Playwright on the live URL) | **102 passed, 0 failed**, 5 skipped by design, in seven shards on the last green run: Explorer 27, pages 24, isolated (performance, verify, gateways) 19, site 17, permits 9, manifest 3, scan 3 |
| Pipeline gates on every run | Identity gate (no published property or permit CID lost, changed or remapped between runs), remote identity gate from the public CID copy, two-gateway readback of every upload, `verify-manifest` on Pinata and orbitor |
| Agent | Both README prompts answered live on Run 4: 75,433 properties within 5 mi of Austin with roofs ≥ 15 years (nearest first, with addresses); 286 roofing permits open ≥ 5 years (225 properties) with the contractor as printed and the BBB status with its reason |
| Code review | Every story scored by its reviewer agents at 75 or higher before G7, plus `/code-review medium` rounds; scores in [`docs/kit-usage.md`](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/blob/feature/oracle-pipeline/docs/kit-usage.md) |
| Defects | 79 defect records, each with a root cause and a fix or a PO decision ([`docs/defects/`](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/tree/feature/oracle-pipeline/docs/defects)) |

## How it was built

The work follows the assessment guide's gated, story-by-story loop. Nothing was built before the vision, feature list, plan and architecture were approved by the product owner.

| Stage | What happened | Where |
| --- | --- | --- |
| Planning gates G0 to G3 | Vision, feature list, high-level plan and architecture constitution, each pre-checked by the `developmentsupport-*` skills (which only report gaps) and approved by the PO | [`docs/gates/`](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/tree/feature/oracle-pipeline/docs/gates), [`docs/architecture-constitution.md`](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/blob/feature/oracle-pipeline/docs/architecture-constitution.md) |
| Per story | Ready check (G4), `/speckit-specify` and `/speckit-clarify`, design agents consulted read-only (answers saved in `agent-design.md`), `/speckit-plan`, `/speckit-tasks`, `/speckit-analyze`, test cases written before code (G6), build by kit builder agents in at most four task groups, one review round, deploy and Playwright on the hosted URL, `/speckit-converge` once, G7, `--no-ff` merge | [`specs/`](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/tree/feature/oracle-pipeline/specs), [`testplans/`](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/tree/feature/oracle-pipeline/testplans), [`docs/reports/`](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/tree/feature/oracle-pipeline/docs/reports) |
| Kit agents | Each story names its design, builder, reviewer and verifier agents (`oracle`, `metagross`, `machamp`, `alakazam`, `ash`, `donphan`, `porygon`, `audino`, `smeargle`, `mew`); a story needs reviewer scores of 75 or more before G7 | [`docs/kit-usage.md`](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/blob/feature/oracle-pipeline/docs/kit-usage.md), [`docs/reviews/`](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/tree/feature/oracle-pipeline/docs/reviews) |
| Runs as an operator | Each run has a state file (phases, commands, checks, logs), a database dump before any write, a dry run with the identity gate, a PO approval before anything public, receipts for every publish step, and an Explore index verified against the published views | [`specs/011-publish-and-runs/`](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/tree/feature/oracle-pipeline/specs/011-publish-and-runs) |
| Rules that held throughout | Only `elephant-cli` output is published and the internal Query DB is never exposed; CIDv1 only and published CIDs never change; stop on a 403, never bypass; no invented or synthetic data; every display shows its source and every missing value its reason; Atlas tokens and components only; CDK only; the Vercel AI SDK for models; no secrets in git or logs; the PR is never merged by the author | [`.specify/memory/constitution.md`](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/blob/feature/oracle-pipeline/.specify/memory/constitution.md) |
| Independent checks before submission | A data-binding audit of every label, a prototype parity review at 390 / 768 / 1440 px, a line-by-line README and demo walk-through on the live site, and an evaluator self-score; their fixes are in the progress table | [`docs/evidence/A-16-prototype-parity.md`](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/blob/feature/oracle-pipeline/docs/evidence/A-16-prototype-parity.md) |

## Validation and testing

| Layer | What is checked | Result (2026-10-26, branch head) |
| --- | --- | --- |
| Static checks | TypeScript strict type-check of every workspace task, ESLint, Prettier, Stylelint, five repository grep gates, secret scan (gitleaks), CDK synth with assertions | All pass |
| Bundle gate | Total app JavaScript at most 320 KB gzipped and the Hub's first load at most 150 KB | 316 KB and 132 KB |
| Unit and integration tests | Vitest: web 652, publish 496, query-core 457, API 419, oracle runtime 281, infra 147, scripts and gates 118, e2e harness 105, contract 64, shared 46 | About 2,800 passed, 0 failed (skips by design: live-only suites) |
| Data pipeline | Socrata keyset paging with watermark windows and re-stamp detection; content-digest deltas; permit-to-parcel linking with recorded reasons; `elephant-cli` validate before export; batch hashing; manifest built from verified parts | Six runs published; the identity gate passed on every run since Run 2 |
| Publication | CIDv1 for every artifact, CARs for directory roots, Filebase pin plus readback on two gateways, CloudFront CID copy, Pinata second copy with CID match, GitHub Release with the CARs | Receipts for every step in [`specs/011-publish-and-runs/upload-receipts/`](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/tree/feature/oracle-pipeline/specs/011-publish-and-runs/upload-receipts) |
| Explore index | Built from the published parts only, each part's SHA-256 checked against the manifest, views compared with the index both ways (EXCEPT ALL) | 0 differences on every run's index |
| Hosted end-to-end | Playwright on the live URL at 390, 768 and 1440 px: Hub, Runs, Compare, Log, Coverage, Manifest, Catalog, Verify on public gateways, Permits, Explore filters and table, property drawer, AI tab, MCP help, legal pages, coming-soon routes, the design-token audit, layout stability (CLS) and accessibility scans | 102 passed, 0 failed |
| Agent | Answers from tool results only, citations checked server-side, at most three model calls and 1,500 output tokens, spend cap; golden queries G1 to G6 on a pinned run; README prompts asked live after every deploy | Golden 6 of 6 on the pinned run; README prompts answered live on Run 4 |
| Performance | Explore search on the full county 0.5 to 1.9 s; pages draw in 0.5 to 1.1 s on desktop | Measured on the hosted URL |
| Cost | CDK assertions (scheduler disabled, no provisioned concurrency, log retention, budget alarm); Cost Explorer read | $0.00 fixed per month ([`docs/cost.md`](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/blob/feature/oracle-pipeline/docs/cost.md)) |

## Architecture and Golden Path

Decided and approved at G3: [`docs/architecture-constitution.md`](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/blob/feature/oracle-pipeline/docs/architecture-constitution.md). The pipeline runs on the kit's county runtime (Restate workflows, a local Query DB for reconciliation only) and publishes with `elephant-cli`. The app and API never read the Query DB: they read the published Parquet by CID through a CloudFront copy (Filebase as fallback) and query it with DuckDB on a Lambda that scales to zero.

Golden Path: TypeScript · CDK (region from config; demo in `eu-north-1` because the demo AWS project is region-locked, company default `us-east-2`) · Turborepo · tRPC + Zod · Vercel AI SDK on Bedrock · Powertools + X-Ray · Vitest + Playwright in GitHub Actions. Six stacks: `CountyLensData` (S3 + CloudFront CID copy), `CountyLensApi` (Lambdas + HTTP API: Explore, agent, MCP, admin), `CountyLensWeb` (Amplify), `CountyLensOps` (SNS, alarms, budget), `CountyLensCert`, `CountyLensScheduler` (off by default). The organisation policy denies the GitHub OIDC provider, so infrastructure deploys run from the operator machine after explicit approval (AM-08).

## Delivery process

| What | Where |
| --- | --- |
| Vision, feature list, plan, architecture (G0 to G3) | [`docs/01-intent.md`](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/blob/feature/oracle-pipeline/docs/01-intent.md), [`docs/feature-list.md`](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/blob/feature/oracle-pipeline/docs/feature-list.md), [`docs/plan.md`](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/blob/feature/oracle-pipeline/docs/plan.md), [`docs/architecture-constitution.md`](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/blob/feature/oracle-pipeline/docs/architecture-constitution.md) |
| Gate log | [`docs/traceability.md`](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/blob/feature/oracle-pipeline/docs/traceability.md) § 3, pre-checks in [`docs/gates/`](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/tree/feature/oracle-pipeline/docs/gates) |
| Story progress and git graph | [`docs/progress.md`](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/blob/feature/oracle-pipeline/docs/progress.md) |
| Test cases and execution reports | [`testplans/`](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/tree/feature/oracle-pipeline/testplans), [`docs/reports/`](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/tree/feature/oracle-pipeline/docs/reports) |
| Code reviews and defects | [`docs/reviews/`](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/tree/feature/oracle-pipeline/docs/reviews), [`docs/defects/`](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/tree/feature/oracle-pipeline/docs/defects) |
| Per-story evidence | [`docs/evidence/`](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/tree/feature/oracle-pipeline/docs/evidence) |
| Decisions | [`docs/decisions/`](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/tree/feature/oracle-pipeline/docs/decisions) (read path, lexicon carriers, tenure, address points, exceptions) |

## Kit usage

See [`docs/kit-usage.md`](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/blob/feature/oracle-pipeline/docs/kit-usage.md): for each story, the agents and skills used and the reviewer scores.

## Known gaps

Every carried item, with its outcome, is in [`docs/evidence/A-16.md` § Closure](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/blob/feature/oracle-pipeline/docs/evidence/A-16.md). The ones that matter most:

| Gap | Why | Next step |
| --- | --- | --- |
| Permits outside the City of Austin | The other 22 Travis jurisdictions offer permits only through records requests (four block automation with HTTP 403); requests were not filed (PO decision) | A licensed permit-data feed, or records requests |
| BBB ratings | bbb.org refuses automated access (403); each permit carries a BBB search link instead | A licensed BBB data feed |
| The City's status word (e.g. Expired) and the expiry date | The published data model has no field for them (ADR-0002); status is derived from the dates (open, stalled, closed) | A lexicon extension request |
| Business records | The Comptroller registry feeds the contractor match only; it is not published as rows | Publish a company table in a later run |
| Scheduled runs (kept off, PO decision 2026-10-26) | The scheduler stack is deployed and off ($0 idle), and its cloud task image is a placeholder: the reconciliation database and the patched `elephant-cli` live on the operator machine, where runs are started from the admin page through the laptop bridge. Switching a schedule on now would publish a new run while the submission is being evaluated (the header, Compare pair and demo script would move), Pinata's free plan is near its cap for a second copy, and a run whose permit rows change stops for an operator-supplied coverage count | Move run state to S3 and DuckDB, build the task image, then enable a weekly schedule |
| Contractor resolved to a company | 0 of 15,025 permits: the City prints a name, and the Comptroller registry has no shared identifier to join on, so a name match stays a candidate (130) and is never presented as resolved | An identifier crosswalk (licence or taxpayer number on the permit) |
| Places (businesses) | Not collected in this run; the run's `travis-places` profile is the Census place-name gazetteer that locates towns and ZIPs for search, not a places dataset | Overture Maps places in a later run |
| Ownership and coordinate counts on Coverage | The rows are published (1.70 M sales, 470,692 people, 91,090 companies, 434,016 parcel points), but Run 4's manifest records no count for them and a published manifest never changes | Write the counts into the next run's manifest |
| Second copy of every file | Pinata's free plan holds all six manifests and 201 of 255 current table files; the CARs are on the GitHub Releases | A paid pin |
| MCP bursts above 5 requests per second answer 503 | A WAF rate rule would bill while idle; the PO kept $0 idle | A Lambda concurrency quota increase |
| Six-case golden grader on the full county | The grader binds runs locally and the CID copy refuses its unsigned fetch; the README prompts are asked live instead | Read parts through the signed path |
| Atlas registration (not filed, PO decision 2026-10-26) | An Atlas page takes one archive root per data group; Run 4 publishes each group in batches (10 county, 5 permit roots), so registering means re-hashing single archives whose roots are in no run manifest. The Travis page already has an open Atlas pull request from another contributor for the permit group, and a merge is the Elephant code owners' act. Details: [`docs/atlas-pr.md`](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/blob/feature/oracle-pipeline/docs/atlas-pr.md) | Publish unbatched archives in a later run, then open the Atlas pull request |

🤖 Generated with [Claude Code](https://claude.com/claude-code)
