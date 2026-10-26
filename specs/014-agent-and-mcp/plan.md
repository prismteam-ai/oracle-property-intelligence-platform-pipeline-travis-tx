# Implementation Plan: Answer roofing-lead questions through a source-backed agent and an MCP server

**Branch**: `014-agent-and-mcp` | **Date**: 2026-10-22 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/014-agent-and-mcp/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command; its definition describes the execution workflow.

## Summary

Two doors onto the same published Travis County data, both reading only through typed `query-core` functions over the CID-copy (never the Query DB, never free-form SQL): a plain-language `agent.ask` tRPC procedure (Vercel AI SDK, `getModel()` switched by `AI_PROVIDER`) that cites real properties/permits with assumptions and missing data stated, shown on the Explore · AI tab; and a standalone MCP Lambda at `POST /mcp` exposing six fixed AD-21 tools behind a bearer token, documented at `docs/mcp.md`. The agent's camelCase tools and the MCP's snake_case tools are separate thin adapters over one set of new `query-core` functions (`searchProperties`, `listPermits`, `getProperty`, `getCoverage`, `listRuns`, `getSchema`, `geocodePlace`) and their Zod schemas, so the agent, the MCP server and the Explore page agree on which rows match the same question against the same published run (AC-8, FR-011). Technical approach, functions, and schemas are taken verbatim from `agent-design.md` (alakazam/ash/oracle, 2026-10-22) with the D-3/D-4/D-5 decisions applied.

## Technical Context

**Language/Version**: TypeScript (Node.js 20, Lambda runtime arm64), per the existing Turborepo workspace.

**Primary Dependencies**: `ai` + `@ai-sdk/amazon-bedrock` (Vercel AI SDK; constitution VI — never `@aws-sdk/client-bedrock-runtime`/`@anthropic-ai/sdk`/`openai` for model calls); `@modelcontextprotocol/sdk` (version pinned in this plan, see Complexity Tracking); `zod`; `@duckdb/node-api` (AD-18, reused via a promoted shared engine binder, see Project Structure); existing `@countylens/contract`, `@countylens/query-core`, `@countylens/shared`; AWS CDK v2.

**Storage**: the published CID-copy (S3 + CloudFront, Filebase fallback) via `@duckdb/node-api`, read-only — no new storage. One new DynamoDB table (on-demand, no idle cost per constitution A7) for the $3/day spend counter: one item per UTC day, incremented per model call.

**Testing**: Vitest (unit + fixture replay over committed pilot tables, and the golden-query grader against the deployed `agent.ask`), Playwright (browser, against the hosted preview URL; `request` fixture for MCP against the hosted `/mcp`), `cdk synth` assertions.

**Target Platform**: AWS Lambda (arm64, 3,008 MB per AM-09) behind API Gateway HTTP API, region `eu-north-1` from `CDK_DEFAULT_REGION`; Bedrock via `eu.anthropic.claude-sonnet-4-6` inference profile (confirmed ACTIVE this run) or the Vercel AI Gateway fallback.

**Project Type**: web service (monorepo: shared packages + two Lambda-backed API surfaces + one existing web app).

**Performance Goals**: agent p95 < 20 s, ≤ 6 tool steps, ≤ 3 model calls, ≤ 1,500 output tokens per answer (AC-5); MCP `tools/list` < 500 ms, `tools/call` p95 < 3 s over 20 calls (AC-7, AC-10); recall ≥ 80% of top-N on every golden query (AC-1, SC-002).

**Constraints**: agent: 23 s server abort → `timed_out`, 25 s Lambda/client stop, 29–30 s HTTP API ceiling (AD-09, AD-27); $3/day spend cap with an 80% alarm; MCP: 5 rps / burst 10 route throttle, ≤ 1,000 rows per call with `truncated`+total; no reserved concurrency on either new Lambda — the AWS account's `ConcurrentExecutions`/`UnreservedConcurrentExecutions` are both 10, account-wide (confirmed this run), matching the existing AM-06 precedent for the query-API Lambda; no SQL tool anywhere (P0-13); MCP token in SSM SecureString only, fail-fast at cold start, no default (AD-10, AD-14); AI Gateway key and MCP token never in git, logs, or browser bundles (NFR-04).

**Scale/Scope**: today's published run is ≈ 37 rows (A-03's slice; A-11 not yet merged) — functions and tests must behave correctly at this scale now and be re-verified, unchanged, once the full county (~342k parcels per A-01) and incremental runs land.

## Kit Agent Ownership *(mandatory, constitution XIII–XVII)*

Copied from `stories/A-14-agent-and-mcp.md` front matter and `specs/014-agent-and-mcp/agent-design.md`.

| Role | Agent(s) | Skills loaded | What it decided (cite agent-design.md) |
|------|----------|---------------|----------------------------------------|
| Design consult | `alakazam` (retrieval, query-core functions, confidence, citations, golden grader), `ash` (agent runtime, AI tab), `oracle` (MCP server) | `build-rag-systems`, `build-ai-agents`, `deploy-open-data-mcp`, `use-elephant-mcp`, `responsive-design-tests` + `apply-engineering-guidelines` | alakazam: structured deterministic retrieval, no embeddings (§0); six `query-core` functions + `geocodePlace` with exact Zod shapes (§2–3); hard-gate confidence checks, not a similarity score (§4); server-built citation registry (§5); golden grader design (§6). ash: `agent.ask` contract, `getModel()` provider switch, limits enforcement, 4-layer timeouts, DynamoDB spend counter + 80% alarm, outcome taxonomy, no reserved concurrency (risk). oracle: six AD-21 tool adapters over alakazam's functions, provenance fields, row cap/truncation, empty-result reasons, SSM token fail-fast design, Origin allowlist (empty — browser never calls `/mcp` directly), 5 rps/burst-10 throttle, stdio build. |
| Builder | `alakazam` (shared `query-core` functions + agent tool adapters + `geocodePlace` + golden set/grader), `ash` (agent runtime: `agent.ask`, `getModel()`, AI tab, spend-cap infra), `oracle` (MCP server: six tool adapters, MCP Lambda, transport, auth, stdio, docs) | same as above + `apply-engineering-guidelines` | Patterns from agent-design.md §1 "Components and files touched" tables, each builder owning files no other group touches (G-1 alakazam, G-2 ash, G-3/G-4 oracle — see Project Structure). |
| Reviewer(s) | `alakazam`, `ash`, `oracle`, `donphan` | — | Score the whole branch 0–100 (≥75 to pass) in `docs/reviews/CR-A-14.md`: are the services what each would choose, are their own patterns/contracts/guardrails followed, confidence note. `donphan` reviews from the MCP consumer side (usable tools, stated scope/limits/provenance). |
| Verify | golden queries G1–G6 on the deployed agent; MCP Inspector on the hosted `/mcp`; `donphan` answers through it | — | Independent test per the story: Vitest grader against `agent.ask`, Inspector `tools/list`/`tools/call` against `/mcp` with the token, one `donphan`-only-MCP transcript saved as evidence. |

**Patterns the code must show** (from the builders' answers):
- No embeddings/vector index/OpenSearch anywhere in the retrieval path — `packages/query-core/src/tools/functions.ts`, `packages/query-core/src/permits.ts` (alakazam).
- Every tool input is a `.strict()` Zod schema; no string field accepts free-form SQL — `packages/query-core/src/tools/schemas.ts` (alakazam).
- `getModel()` is the only place `AI_PROVIDER` is read; no provider name anywhere else in `apps/api/src/agent/` — `apps/api/src/agent/model.ts` (ash).
- Server, not the model, builds `how`/`missing[]`/`matches[]`; the model writes only `answer` prose — `apps/api/src/agent/citations.ts`, `apps/api/src/agent/ask.ts` (alakazam logic + ash wiring).
- Four concentric timeouts, all present and tested independently — `apps/api/src/agent/ask.ts` (ash).
- SSM SecureString token read at cold start with no default, fails fast — `apps/api/src/mcp/auth.ts` (oracle).
- MCP tools built from the exact same Zod schemas as the agent tools, via `import` not re-typing — `apps/api/src/mcp/tools.ts` (oracle) importing from `packages/query-core/src/tools/schemas.ts`.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design. Mark each ✅ / ❌ / N/A; every ❌ needs a row in Complexity Tracking.*

| # | Article | Check for this plan | Status |
|---|---------|---------------------|--------|
| I | Outcome first | Every AC verified on the hosted `agent.ask`/`/mcp` endpoints with real Travis County data (G1–G6, MCP Inspector, `donphan`); no check accepted from localhost | ✅ |
| II–IV | Stack | TypeScript throughout; two new CDK-managed Lambdas (agent, MCP) in the existing `CountyLensApi` stack, region from `CDK_DEFAULT_REGION` (`eu-north-1`); Turborepo layout unchanged; one `api-client` (tRPC) for the website, MCP is its own protocol surface (not a second api-client, it's the public contract AC-23 asks for) | ✅ |
| V–VI | Contracts and LLM | Every tool input is `.strict()` Zod (`packages/query-core/src/tools/schemas.ts`); every model call goes through `ai`/`@ai-sdk/amazon-bedrock` via `getModel()`, provider from `AI_PROVIDER`, never a direct Bedrock/OpenAI/Anthropic SDK call | ✅ |
| VII–IX | Operations | No new external boundary (the only external call is Bedrock/Gateway, already queued by the AI SDK's own retry and bounded by the 23 s abort); Powertools logger/metrics/tracer on both new Lambdas; CloudWatch alarm at 80% of the $3/day spend cap is the alerting path | ✅ |
| X | Quality gates | Vitest fixture + unit tests, golden-query grader, `cdk synth` assertions, Playwright (browser for the AI tab, request-fixture for MCP) on the hosted preview URL, all in CI except the paced hosted golden run (rate-limited, run manually/on-deploy per AD-09) | ✅ |
| XI | Data honesty | Every agent answer and every MCP row carries provenance (`source_url`, `captured_at`, `table_cid`, `run_id`, `manifest_cid`); every empty/missing case has a typed reason (`out_of_scope`, `not_found`, `no_match`, `field_not_published`, `run_not_found`); no fabricated rows ever (G6, AC-11) | ✅ |
| XII | Secrets | MCP bearer token: SSM SecureString only, created once by the PO via CLI (✋ A-2, D-5), read by the Lambda via Powertools Parameters, never in code/git/logs/bundles; AI Gateway key stays in `~/.config/assessment/ai-gateway.env`, existence-only checked | ✅ |
| XIII–XV | Owner agents | Kit Agent Ownership filled above; `specs/014-agent-and-mcp/agent-design.md` exists (alakazam + ash + oracle, with a Disagreements table); builder patterns listed above with file paths | ✅ |
| XVI | Owner review | `alakazam`, `ash`, `oracle`, `donphan` planned as reviewers in Stage 5, 75-point threshold, scores recorded in `docs/reviews/CR-A-14.md` | ✅ |
| XVIII–XXIII | Delivery | G4 passed (`docs/gates/G4-A-14-precheck.md`, Ready 2026-10-22); G5/G6 run together next (light lane); tests first in every task group; branch `014-agent-and-mcp`; any defect recorded as `docs/defects/ERR-{n}.md` | ✅ |
| Addendum | Task A A6 (respect source terms), A7 (zero idle cost) | A6: neither surface scrapes a source directly — both read only the published CID-copy, so no new source-rate-limit exposure; the only outbound rate limit to respect is Bedrock's own 10 req/min, paced in testing. A7: spend-cap table is on-demand (no idle billing); no reserved Lambda concurrency (none would be safe at this account's 10-wide limit anyway); explicitly rejected a vector index/OpenSearch for retrieval because it would bill while idle and nothing here needs it (alakazam §0) | ✅ |

No ❌ rows. Two items are deferred, not violations — tracked below in Complexity Tracking and in `agent-design.md`'s Disagreements table (both already resolved by D-1/D-3 decisions, not new constitution conflicts): the full-county numeric checks (AC-1 recall, AC-3/AC-9 stalled counts, AC-10 truncation) wait for A-11; `searchProperties`/`geocodePlace`'s exact SQL-sharing with the Explore page, and the AC-8 three-way parity check, wait for A-13.

## Project Structure

### Documentation (this feature)

```text
specs/014-agent-and-mcp/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md         # Phase 1 output
├── quickstart.md         # Phase 1 output
├── contracts/             # Phase 1 output (agent.ask, MCP tools)
├── agent-design.md        # Stage 3 design consult (already written)
├── design-alakazam.md, design-ash.md, design-oracle.md  # source design docs
├── run-log.md
└── tasks.md              # Phase 2 output (/speckit-tasks — not yet created)
```

### Source Code (repository root)

**Structure Decision**: existing Turborepo monorepo (Option 2-like, but with shared packages as a third tier). No new apps; new files land inside `packages/query-core`, `packages/contract` (read-only, unchanged), `apps/api`, `apps/web`, and `infra/`, plus a new promoted shared engine package per oracle's risk-3 recommendation.

```text
packages/
├── query-core/
│   ├── src/
│   │   ├── tools/
│   │   │   ├── schemas.ts        # NEW — alakazam — Zod inputs for all 6 question shapes + geocodePlace
│   │   │   └── functions.ts      # NEW — alakazam — searchProperties, listPermits, getProperty, getCoverage, listRuns, getSchema, geocodePlace
│   │   ├── permits.ts            # NEW — alakazam — permitsSql() + count, reused by listPermits
│   │   ├── builders.ts           # EXISTING (A-03) — radiusSql/roofAgeSql/listRoofingPermitsSql/runSummarySql/MAX_ROWS, unchanged
│   │   └── index.ts              # CHANGED — alakazam — export tools/*, permits.ts
│   └── test/
│       └── tools.*.test.ts       # NEW — alakazam — unit + fixture replay + 3-way parity test
├── contract/                      # UNCHANGED (read-only this story)
└── engine-duckdb/                 # NEW shared package — oracle's risk-3: promote apps/api's duckdb-node.ts + s3-read.ts binder here so both apps/api and the new MCP Lambda import one AD-18-compliant engine, never two copies

apps/
├── api/
│   └── src/
│       ├── agent/
│       │   ├── ask.ts             # NEW — ash — agent.ask tRPC procedure, timeout layering, outcome taxonomy
│       │   ├── model.ts           # NEW — ash — getModel(), the only AI_PROVIDER read site
│       │   ├── tools.ts           # NEW — ash (wiring) — 4 camelCase AI SDK tools, thin adapters over query-core/tools
│       │   ├── citations.ts       # NEW — alakazam (logic) + ash (wiring) — citation registry, matches[] builder
│       │   └── spend.ts           # NEW — ash — DynamoDB daily spend counter read/increment
│       └── mcp/
│           ├── tools.ts           # NEW — oracle — 6 snake_case MCP tools over query-core/tools
│           ├── auth.ts            # NEW — oracle — SSM SecureString token check, fail-fast
│           ├── server.ts          # NEW — oracle — Streamable HTTP POST /mcp + GET /health, Origin check
│           └── stdio.ts           # NEW — oracle — local stdio build entry point
└── web/
    └── src/routes/
        └── (AI tab additions land once A-13's Explore shell merges; ash's agent.ask contract is designed to be stable for it)

infra/
└── lib/stacks/
    └── countylens-api-stack.ts    # CHANGED — ash (agent Lambda, spend table, 80% alarm) + oracle (MCP Lambda, /mcp route, throttle, SSM read grant) — same stack, two builders, non-overlapping resource blocks

tests/
├── agent/
│   ├── golden.json                # NEW — alakazam — G1–G6 fixtures
│   ├── golden.test.ts             # NEW — alakazam — Vitest driver against deployed agent.ask
│   └── grader.ts                  # NEW — alakazam — groundedness/correctness/recall/honesty scoring
└── e2e/
    ├── A-14.spec.ts                # NEW (Stage 6) — browser Playwright, AI tab
    └── A-14-mcp.spec.ts            # NEW (Stage 6) — request-fixture Playwright, /mcp
```

Builder groups map 1:1 to `/speckit-tasks`' G-1…G-4 (agent-design.md §1, walkthrough §3a): **G-1** `packages/query-core/*` + `apps/api/src/agent/tools.ts`'s query-core imports + `tests/agent/*` (alakazam) · **G-2** `apps/api/src/agent/{ask,model,spend}.ts` + the agent half of the infra stack change + the AI tab (ash) · **G-3** `apps/api/src/mcp/tools.ts` + `apps/api/src/mcp/stdio.ts` + `docs/mcp.md` (oracle) · **G-4** `apps/api/src/mcp/{auth,server}.ts` + the MCP half of the infra stack change (oracle). `packages/engine-duckdb` is a shared pre-task both `apps/api`'s existing query router and the new MCP Lambda import — built first, in wave 1, by oracle (who identified the need) with alakazam reviewing the extraction doesn't change existing query-router behavior.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

No Constitution Check violations. These are deferred/accepted-risk items, not deviations:

| Item | Why Needed | Simpler Alternative Rejected Because |
|------|------------|---------------------------------------|
| MCP bearer token created by the PO via AWS CLI, not CDK (D-5) | CloudFormation's `AWS::SSM::Parameter` resource cannot create a `SecureString` value (only `String`); the value must exist before CDK grants read access to it | A plaintext SSM `String` or a value embedded in CDK/environment would violate constitution XII (no secrets in git/code) and AD-14's explicit SecureString requirement |
| `@modelcontextprotocol/sdk` version pinned explicitly in this plan rather than left to "latest" | oracle's design-oracle.md risk 7: the Origin/DNS-rebinding guard option name is version-specific; pinning avoids a silent behavior change between design and build | Floating to latest risks the Origin-allowlist implementation silently changing between the design consult and the build task, which would not be caught by any gate until a live 403/401 test fails |
| Full-county numeric checks (AC-1 recall %, AC-3/AC-9 stalled counts, AC-10 2,213-row truncation) run first against a synthetic/fixture-scale check, then re-run unchanged once A-11 merges | A-11 (full publish) is not merged yet (Stage 0 finding, G4-8/D-1); the story's own G4 decision already accepts "build and unit-test now; G7 waits for A-11" | Waiting to build anything until A-11 merges would leave no time in the 1.5-day estimate for the agent/MCP build itself |
| `searchProperties`/`geocodePlace` (and the AC-8 three-way parity check) sequenced after A-13 merges, reusing A-13's `exploreSearchSql`/`resolvePlace` rather than reimplementing equivalent SQL now | alakazam's design-alakazam.md risk 1: reimplementing from `builders.ts` primitives risks subtle divergence (e.g. the tenure off-by-one it flags) that would break the "same `property_cid`s" requirement (AC-8, FR-011) | Building a second, parallel SQL path now and reconciling later is exactly the kind of drift AD-19 ("one shared query layer") exists to prevent |
