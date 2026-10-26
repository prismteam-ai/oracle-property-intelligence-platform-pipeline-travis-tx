<!--
Sync Impact Report
- Version: 3.0.2 → 3.0.3 (2026-10-19): Article VI wording (PATCH). The AI Gateway key is read from SSM Parameter Store SecureString, not Secrets Manager (architecture decision AD-14, rule A7). Article XII already allowed SSM.
- Earlier: 3.0.1 → 3.0.2 (2026-10-17): Article I wording (PATCH). The hosted runtime is countylens.{domain} (app renamed CountyLens).
- Earlier: 3.0.0 → 3.0.1 (2026-10-17): Article VI wording (PATCH). The Bedrock quota was raised, so the demo uses Bedrock for Claude; the Gateway stays the fallback and serves embeddings.
- Earlier: 2.0.0 → 3.0.0 (2026-10-17): Article VI redefined. Model provider is a setting: Bedrock (default) or Vercel AI Gateway (demo: embeddings now, Claude until the Bedrock quota is raised).
- Earlier: 1.0.0 → 2.0.0 (2026-10-16): Article III redefined. Region comes from config; demo deploys to eu-north-1 (region-locked AWS project), company default us-east-2.
- Earlier: 0.0.0 (template placeholders) → 1.0.0
- Added: Parts 1–3 (articles I–XXIII), Task A addendum (A1–A8), agent roster
- Templates updated: .specify/templates/plan-template.md (Kit Agent Ownership + Constitution Check),
  spec-template.md (story header), tasks-template.md (tests mandatory + Phase Z "prove on hosted runtime")
- Source: ../assessment-guide/templates/constitution.md
-->

# Oracle Property Intelligence Pipeline (Travis County, TX) Constitution

The binding rules for every spec, plan, task, line of code and review in this repo. `docs/architecture-constitution.md` adds component-level decisions and is equally binding once Gate G3 approves it.

## Part 1: Engineering

### I. Outcome first
A feature is done only when it works on the **hosted** runtime (`https://countylens.{domain}` or its Amplify branch URL) with real Travis County data. Working on localhost does not count as done or as evidence.

### II. TypeScript everywhere
Apps, Lambdas, CDK and scripts are TypeScript. Python is forbidden except PySpark/Glue. The vendored kit runtime (`pipeline/oracle-runtime`) runs as provided.

### III. AWS, CDK only, region from config
CDK is the only infrastructure as code. The region is never hard-coded: CDK reads it from `CDK_DEFAULT_REGION`/`AWS_REGION`. Company default `us-east-2` (Golden Path); the demo deploy uses `eu-north-1` because the demo AWS project is region-locked, and the PR says so. In the demo, Bedrock uses `eu.` cross-region inference profiles. Every resource is tagged `project_name=oracle-travis`.

### IV. Turborepo monorepo
`apps/web` (React → Amplify), `apps/api` (tRPC + agent + MCP on Lambda behind API Gateway), `packages/query-core` (views, SQL builders, Zod tool schemas shared by UI, agent and MCP), `packages/api-client` (the only tRPC client), `packages/shared`. Never duplicate the client, the types or the queries.

### V. Zod on every input
Every tRPC procedure, agent tool and MCP tool validates input with Zod. No `any`.

### VI. Vercel AI SDK for every LLM call
Use `ai` with Zod tool schemas. The model provider is a setting (`AI_PROVIDER=bedrock|gateway`), never hard-coded in agent code: `bedrock` uses `@ai-sdk/amazon-bedrock` with `eu.` inference profiles (the default and Golden Path); `gateway` uses the Vercel AI Gateway built into `ai`, with `AI_GATEWAY_API_KEY` read from SSM Parameter Store SecureString (Secrets Manager bills while idle, A7). The demo uses Bedrock for Claude (`eu.anthropic.claude-sonnet-4-6`; quota raised and confirmed by a live call on 2026-10-17) and the Gateway for embeddings (`amazon/titan-embed-text-v2`); the Gateway stays the fallback for Claude. Direct provider SDKs (`openai`, `@anthropic-ai/sdk`, `@aws-sdk/client-bedrock-runtime`) are forbidden.

### VII. Queued external boundaries
Source fetches use bounded concurrency, idempotency keys, exponential backoff, a DLQ and one self-resolving CloudWatch alarm per DLQ (the kit runtime's Restate workflows satisfy this locally).

### VIII. Observability
Every Lambda uses Powertools Logger, Tracer and Metrics, with X-Ray on and JSON logs. Business metrics: items processed, items failed, duration. No secrets or PII in logs.

### IX. Alerting
Critical failures page through PagerDuty Events API v2, or a documented substitute.

### X. Quality gates in CI
Vitest, Playwright (against the hosted URL; the config fails on localhost), ESLint, Prettier and `tsc` run in GitHub Actions. A story is done only when CI is green.

### XI. Data honesty
Every record and answer cites its source (URL, capture time, digest or CID). Missing or unresolved data is shown as missing ("BBB not available", "roof age: low confidence"), never guessed. Assumptions are stated.

### XII. No secrets
No secrets in Git, logs or PR bodies. Use Secrets Manager or SSM.

## Part 2: Kit-agent ownership

### XIII. Every piece of work has an owner agent
Each story's front matter names `agents.design`, `agents.builder`, `agents.reviewers`, `agents.verify` and `skills`, copied from `../assessment-guide/AGENT-MAP.md`. A story without them fails Gate G4.

**Agent roster for this repo**

| Agent | Role here | Patterns that must be visible in the code |
| --- | --- | --- |
| `oracle` | Primary builder: ingestion, reconciliation, publication, MCP | kit `use-oracle` runtime, Travis county profile, stage skills, exact `car-publication` sequence, run manifest, watermarks |
| `metagross` | Builder: monorepo, Explorer UI, API, hosting, CI | Turborepo layout, tRPC + shared api-client, Amplify + CDK, Powertools |
| `alakazam` | Builder: agent retrieval design | structured retrieval over published tables, confidence threshold, citations, golden-query evaluation |
| `ash` | Builder/reviewer: agent runtime | tool loop, conversation state, telemetry |
| `machamp` | Builder: scheduled refresh (off by default) | idempotent batch, throttling, DLQ + alarm, cost control |
| `mew` | Design consult: lexicon classes and fields | exact lexicon names in views and contract |
| `donphan` | Reviewer: published data, counts, MCP answers | — |
| `porygon` | Reviewer: metric consistency (coverage, run deltas) | — |
| `audino` | Reviewer: UI drift from the design | — |
| `smeargle` | Tester: responsive tests at 390 / 768 / 1440 | — |

### XIV. The owner designs it
Before `/speckit-plan`, every `agents.design` agent is consulted read-only and its answer is saved word for word in `specs/{NNN-slug}/agent-design.md`. The plan's "Kit Agent Ownership" section cites it. A plan without it fails the Constitution Check.

### XV. The owner builds it
`/speckit-implement` delegates each task group to the `agents.builder` subagent, which loads its skills plus `apply-engineering-guidelines`. The code must show the patterns in the roster above.

### XVI. The owner reviews it
Before G7, every `agents.reviewers` agent scores the story read-only (0–100). The score is recorded in `docs/reviews/CR-{ID}.md`. A score under 75 blocks the merge until it is fixed or justified there.

### XVII. The toolchain matches the router
The `arceus` routing in `docs/01-intent.md` is the expected toolchain. Every agent it names owns or reviews at least one story, or is listed in `docs/kit-usage.md` as left out with a reason. Product configurer agents (`celebi`, `uxie`, `vivillon`, …) are not used: no Prism product is deployed for this task.

## Part 3: Delivery process

### XVIII. Gates
Each artifact ends at a gate (G0–G8). The `developmentsupport-*` pre-check reports gaps; the human records the decision. No `/speckit-implement` before G4, G5 and G6 pass. No merge before G7 passes.

### XIX. Traceability
Every artifact has front matter with `id` and `parent`. Every commit message starts with the story ID (`A-03: …`).

### XX. Branching
Work happens on `feature/oracle-pipeline`. Each story uses its own branch `NNN-slug`, merged back with `git merge --no-ff`. Nothing is committed to `main`. `docs/progress.md` is regenerated after every merge.

### XXI. Specs before code
Unknowns are written as `[NEEDS CLARIFICATION: …]`. Acceptance criteria are Given / When / Then. Tests are written first and must fail first.

### XXII. Independent tests
Test cases come from the story's acceptance criteria, not from `tasks.md`, and run against the hosted URL.

### XXIII. Defects are records
Every failing hosted test gets `docs/defects/ERR-{n}.md`. No Critical defect is open at a merge or at release.

## Task A addendum

- **A1.** Ingestion uses the kit's `use-oracle` runtime and county stage skills, extended with Travis adapters and profiles, never reimplemented.
- **A2.** Public data comes only from `elephant-cli` (validate → hash → CAR → export-tables → upload). Query DB exports are never published; the Query DB is never exposed.
- **A3.** CIDv1 (base32) is every artifact's identity; gateway URLs are derived. Published CIDs never change; new data means a new CID; run history keeps every CID. Manifests are accepted only when their bytes hash to the requested CID; table parts are accepted only when their SHA-256 equals the one the CID-verified manifest records (PO decision 2026-10-24).
- **A4.** Every run writes a manifest (cid, name, size, codec, sha256) with a CAR for every directory, verified on two independent public gateways.
- **A5.** Contractor identity comes from official records only; unmatched contractors stay unresolved. BBB and places are enrichment, never identity.
- **A6.** Respect source terms: no CAPTCHA bypass, stop on 403, bounded crawls.
- **A7.** Zero idle cost by default: nothing that bills while idle is enabled by default.
- **A8.** Only the kit-bundled Elephant skills (`soofi-xyz-team-kit/skills/`) are used, never the deprecated `../skills` copy.

## Governance

This constitution overrides other practices. A plan that breaks an article either changes or records a justification in its Complexity Tracking table, which you approve. Amendments: edit this file and `../assessment-guide/templates/constitution.md` together, bump the version (MAJOR = article removed or redefined, MINOR = article added, PATCH = wording), and update the Sync Impact Report.

**Version**: 3.0.3 | **Ratified**: 2026-10-15 | **Last Amended**: 2026-10-19
