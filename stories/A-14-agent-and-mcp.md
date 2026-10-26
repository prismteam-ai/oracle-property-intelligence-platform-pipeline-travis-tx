---
id: A-14
type: user-story
title: Answer roofing-lead questions through a source-backed agent and an MCP server
parts: [A-14, A-15]
parent: [FEAT-A14, FEAT-A15]
vision: VIS-A
ard: ARD-A
eval_point: A6
priority: P1
moscow: Must
branch: 014-agent-and-mcp
spec: specs/014-agent-and-mcp/
depends_on: [A-02, A-03, A-11, A-13]
size_days: 1.5
agents:
  design: [alakazam, ash, oracle]
  builder: [alakazam, ash, oracle]   # AGENT-MAP: alakazam (retrieval), ash (agent runtime), oracle (MCP)
  reviewers: [alakazam, ash, oracle, donphan]
  verify: "golden queries G1–G6 on the deployed agent; MCP Inspector on the hosted /mcp; `donphan` answers through it"
skills: [build-rag-systems, build-ai-agents, deploy-open-data-mcp, use-elephant-mcp, responsive-design-tests, apply-engineering-guidelines]
ui: true
status: Done
gate: G4
qc_testability_signoff: true
created: 2026-10-19
merged: 2026-10-21
ready: 2026-10-22
---

# A-14 Answer roofing-lead questions through a source-backed agent and an MCP server

| Field | Value |
| --- | --- |
| Merged from | A-14 (agent) + A-15 (MCP server), merged 2026-10-21 to run the story loop once. The original files are in [`stories/merged/`](merged/) for reference; this file is the one to build from |
| Evaluation point | A6 (primary) · A2 |
| Demo line(s) | D-10 (roofs > 15 years within 5 mi of a city), D-11 (long-open permits near that area, with contractor), D-12 (MCP-ready) |
| Agents | design `alakazam`, `ash`, `oracle` · builder `alakazam` (retrieval), `ash` (agent runtime and AI tab), `oracle` (MCP server) · reviewers `alakazam`, `ash`, `oracle`, `donphan` · verify golden queries G1–G6, MCP Inspector on the hosted `/mcp`, `donphan` answers through it (source: [AGENT-MAP.md](../../assessment-guide/AGENT-MAP.md) § 4) |
| Depends on | A-02, A-03 (direct); A-11, A-13 (implicit, added at G4: full-county answers need the A-11 tables; the AI tab and the demo area need A-13) |
| Size | 1.5 days |
| Branch | `014-agent-and-mcp`, merged into `feature/oracle-pipeline` |

## Context

The README asks for two things that read the same published data: an agent that answers the two roofing prompts "with source-backed evidence" and "clearly identif[ies] any assumptions or missing data" (D-10, D-11), and a database "structured to support MCP access", shown MCP-ready "without changing the data model" (AC-23, D-12). A **CRM developer or their AI agent** asks in plain words; an **AI client** (Claude Desktop, Claude Code, the CRM's agent) calls typed tools; the **evaluator** checks that every returned property is real and every claim is cited.

Both are RAG over the published records: the model sees rows only through typed tools (AD-20), and both the agent's tools and the MCP tools come from the same `query-core` functions as the UI (AD-19). The kit Elephant MCP cannot serve Travis yet (checked 2026-10-15: Atlas serves only Jackson County, FL), so CountyLens runs its own MCP over its own CIDs.

Real check (Austin, live 2026-10-19): within 5 mi of Pflugerville's Census internal point (30.447765, −97.602116), Austin has **0 open** reroof permits. The two part stories disagree on the stalled count (A-14: **3** stalled `Expired` of 44, 2004-011296 BP, 2018-111955 BP, 2022-098180 BP; A-15: **18** stalled); Stage 0 re-measures it on the current run with the shared `query-core` SQL, and both the agent and the MCP tests use that one number. County-wide there were 2,213 stalled reroofs on 2026-10-19. An honest answer to D-11 for Pflugerville must say no open roofing permits were found and offer the stalled ones, labelled as stalled. The demo uses the area A-13 records as the demo area.

## Description

As a **CRM developer (or the CRM's agent, or any MCP client)**, I want **to ask roofing-lead questions in plain language, or call typed tools over the published Travis data, and get real Travis County properties back with reasoning, citations, assumptions and missing data stated**, so that **I can trust the answer without re-running the query myself, and any MCP-capable agent can use the same data model as the UI**.

When done:

- **Agent.** A tRPC procedure `agent.ask` on Lambda uses the Vercel AI SDK; `getModel()` switches on `AI_PROVIDER` (`bedrock` with `eu.anthropic.claude-sonnet-4-6`, or `gateway`); the agent code never names a provider. It returns one response (no streaming) with `answer`, `how`, `steps[]`, `matches[]` (citation n → row n with `property_cid`, source URL, run), `query`, `missing[]` and `outcome`. The hosted Explore · AI tab shows Working…, then the answer, "How I read this" chips, and citations linked to rows.
- **MCP server.** A TypeScript MCP server (`@modelcontextprotocol/sdk`), stateless Streamable HTTP on its own Lambda at `POST /mcp`, plus a stdio build. It requires a bearer token stored in SSM SecureString and shared privately with the evaluator (AD-10, AD-14). `docs/mcp.md` documents the Claude Desktop, Claude Code and Inspector setup.
- **One query layer.** The agent's tools and the six MCP tools are thin adapters over the same `query-core` functions and Zod schemas, so the agent, the MCP server and the Explore page return the same `property_cid`s for the same question and run.

**Overrides applied (ARD § 15, AD-30):**

- Agent: tools come from `query-core` (AD-19), not hand-written Bedrock tools; `geocodePlace` is added and reads the A-02 place gazetteer (US Census 2024 Gazetteer, versioned in `query-core`, source URL and SHA-256 cited in the answer), so it is public and has provenance. One response with layered timeouts: 23 s server abort → `timed_out`, 25 s Lambda and client stop, HTTP API 29–30 s (AD-09, AD-27). Described as RAG over the published records (AD-20).
- MCP: the six fixed tools of AD-21 (`search_properties`, `list_permits`, `get_property`, `get_coverage`, `list_runs`, `get_schema`), each ≤ 1,000 rows, with **no SQL tool** on the server (P0-13). The playbook's `listScopes` / `getSchema` / `query` shape is replaced.

**AI provider (PUBLISHING § 1.6, repo `CLAUDE.md`):** the provider is a setting, `AI_PROVIDER=bedrock|gateway` (constitution VI). Bedrock `eu.anthropic.claude-sonnet-4-6` in `eu-north-1` is the default (quota raised 2026-10-17 through the AWS Support case, confirmed by the PO 2026-10-19; Stage 0 re-checks it with a real call, because the new account started at 0 TPM). The Vercel AI Gateway is the fallback and serves Claude only after a paid credit top-up. Switching to the Gateway is a 🛑 decision in the walkthrough, never a code change.

**Independent test:** the golden queries G1–G6 (`checks.md` § 7) run as Vitest against the **deployed** `agent.ask` and pass; MCP Inspector against the hosted `/mcp` with the token lists six tools and returns rows for `search_properties`; `donphan` answers a question through it.

## Acceptance Criteria

Agent (from A-14)

1. **AC-1** (A-14 AC-1) · **Given** G1 "Which properties in Travis County within five miles of Pflugerville have roofs older than 15 years?", **When** the hosted agent answers, **Then** it states the centre point and its source ("Pflugerville city, Census 2024 Gazetteer, 30.447765, −97.602116"), uses radius 5 mi and roof > 15, returns real `property_cid`s each with roof-age basis and source, and every returned row satisfies the same `query-core` SQL (recall ≥ 80% of the top-N) (D-10). ☐ testable
2. **AC-2** (A-14 AC-2) · **Given** G2 as the next turn, **When** the agent answers, **Then** it keeps "that area" from the previous turn, states its meaning of "many years" (≥ 5), lists permits sorted by open duration with contractor "as printed on permit", its identity state, and BBB or "not available" with the reason (D-11). ☐ testable
3. **AC-3** (A-14 AC-3, missing data) · **Given** the Pflugerville area where the current run finds 0 open Austin reroof permits (stalled count re-measured in Stage 0), **When** G2 is asked, **Then** the answer says that no open roofing permits were found in that radius, offers the stalled ones explicitly labelled "stalled · source says Expired" (or "stalled" alone if `status_raw` has no carrier, A-02 AC-1), and lists the missing data (for example "contractor not printed" on most permits, BBB status); **Given** G6 "ZIP 99999", **Then** it returns zero results and says the scope is not in Travis County, with no fabrication. ☐ testable
4. **AC-4** (A-14 AC-4) · **Given** G3 (Manor, open > 5 years), G4 (Lakeway, tenure 10+, out-of-area) and G5 (BBB for a real permit number, for example 1982-012866 BP), **When** answered, **Then** each uses exact thresholds, explains "outside the area", and cites the BBB source or says why it is missing. ☐ testable
5. **AC-5** (A-14 AC-5, scale) · **Given** the full-county tables and the model provider's request limit (Bedrock 10 requests per minute), **When** G1–G6 run against the hosted endpoint, **Then** p95 < 20 s, each answer uses ≤ 6 tool steps, ≤ 3 model calls and ≤ 1,500 output tokens, and each tool call returns ≤ 1,000 rows. ☐ testable
6. **AC-6** (A-14 AC-6, error) · **Given** the model is throttled, the $3/day budget is reached, or 23 s pass, **When** a question is asked, **Then** the response outcome is `throttled`, `paused` or `timed_out` with a plain message ("Took too long" with Try again and Use Filters instead), never a 5xx and never a partial answer presented as complete. ☐ testable

MCP server (from A-15)

7. **AC-7** (A-15 AC-1) · **Given** the hosted endpoint and a valid bearer token, **When** MCP Inspector calls `tools/list`, **Then** it returns exactly the six AD-21 tools with Zod-derived input schemas using the AD-07 column names, in under 500 ms. ☐ testable
8. **AC-8** (A-15 AC-2) · **Given** `search_properties` with area Pflugerville (resolved through the A-02 gazetteer), radius 5 mi, roof ≥ 15, **When** called, **Then** it returns the same `property_cid`s as the Explore page's query and the agent's G1 answer for the same run, each with provenance (`source_url`, `captured_at`, `table_cid`, `run_id`, `manifest_cid`). ☐ testable
9. **AC-9** (A-15 AC-3) · **Given** `list_permits` for the same area with `status_class` open or stalled, **When** called, **Then** it returns stalled reroofs such as 2004-011296 BP with `status_class = stalled` (and `status_raw = Expired` if A-02 found a carrier) and `open_days`, sorted by open duration; `get_coverage` returns the manifest `coverage` section unchanged. ☐ testable
10. **AC-10** (A-15 AC-4, scale) · **Given** a query matching more than 1,000 rows (for example all stalled reroofs county-wide, 2,213 on 2026-10-19), **When** called, **Then** it returns at most 1,000 rows with a `truncated: true` flag and the total count; `tools/call` p95 < 3 s over 20 calls; the route sustains 5 rps with burst 10 and answers 429 beyond it. ☐ testable
11. **AC-11** (A-15 AC-5, missing data / error) · **Given** no token or a wrong token, **When** any call is made, **Then** the server answers 401 and runs nothing; **Given** an unknown permit number or a non-Travis ZIP, **Then** the tool returns an empty result with a reason (`not_found`, `out_of_scope`), never invented rows. ☐ testable
12. **AC-12** (A-15 AC-6) · **Given** the `donphan` agent configured with the hosted endpoint, **When** asked "Which properties near Lakeway have owners outside the area?", **Then** it answers through the MCP tools and cites `property_cid`s, and the transcript is saved as evidence. ☐ testable

## Edge cases (at least two)

- A city name that matches two places (Round Rock is partly outside Travis) → state which centre was used and that results are limited to Travis County. (A-14)
- The user edits a "How I read this" chip (5 → 3 years) → re-runs with the edited threshold; the citation list updates. (A-14)
- The session reaches 10 questions → "n of 10 AI questions left" reaches 0; only `answered` counts (#66). (A-14)
- `AI_PROVIDER=gateway` → same answers; no code change. (A-14)
- A browser `Origin` that is not on the allowlist → rejected; the Help page's "Try a tool" goes through the tRPC proxy, which adds the token server-side (AD-10). (A-15)
- The SSM parameter is missing at cold start → fail fast with a clear log line; no default token. (A-15)
- A client sends a free-form SQL string as a tool argument → Zod rejects it. (A-15)
- The agent and MCP return different `property_cid`s for the same question and run → a defect: both must call the same `query-core` function (AC-8).

## Requirements

| REQ | Requirement | Traces to | From |
| --- | --- | --- | --- |
| FR-001 | Agent MUST retrieve only through `query-core` Zod tools plus a provenance-backed `geocodePlace` | AC-1, AC-4 | A-14 FR-001 |
| FR-002 | Every answer MUST cite `property_cid`, source URL and run, and state assumptions | AC-1, AC-2 | A-14 FR-002 |
| FR-003 | Agent MUST say when nothing matches and list missing data; no fabrication | AC-3 | A-14 FR-003 |
| FR-004 | Agent MUST keep conversation context for "that area" | AC-2 | A-14 FR-004 |
| FR-005 | Agent MUST return a typed outcome on throttle, budget or timeout | AC-6 | A-14 FR-005 |
| FR-006 | MCP server MUST expose exactly six typed tools from `query-core` | AC-7 | A-15 FR-001 |
| FR-007 | MCP tool results MUST match the UI's and the agent's query results and carry provenance | AC-8, AC-9 | A-15 FR-002 |
| FR-008 | MCP server MUST cap rows at 1,000 and flag truncation | AC-10 | A-15 FR-003 |
| FR-009 | MCP server MUST require the bearer token and return reasons for empty results | AC-11 | A-15 FR-004 |
| FR-010 | A kit agent MUST answer a question through the hosted MCP server | AC-12 | A-15 FR-005 |
| NFR-001 | Agent: p95 < 20 s; 23 s abort; ≤ 6 tool steps; ≤ 3 model calls; ≤ 1,500 output tokens; $3/day cap with alarm at 80% | AC-5, AC-6 | A-14 NFR-001 |
| NFR-002 | Vercel AI SDK only; no direct provider SDK; provider from `AI_PROVIDER` (constitution VI) | AC-1 | A-14 NFR-002 |
| NFR-003 | MCP: `tools/list` < 500 ms; `tools/call` p95 < 3 s; 5 rps burst 10; 401 without token | AC-7, AC-10, AC-11 | A-15 NFR-001 |
| NFR-004 | MCP token and AI Gateway key never in git, logs, or browser bundles (NFR-04) | AC-11 | A-15 NFR-002 |

## Prototype reference (mandatory if the story has UI)

| Element | Value |
| --- | --- |
| Claude Design screen | Agent: `design/prototype/ExploreQ-ai.dc.html`, `ExploreQ-aicontractor.dc.html`, `ExploreQ-aiworking.dc.html`, `ExploreQ-aislow.dc.html`, `ExploreQ-ailimit.dc.html`, `ExploreQ-aipaused.dc.html`, `HelperStates.dc.html` (and 390/768 variants). MCP docs page: `design/prototype/HelpMcp1440.dc.html` (rendered in A-13; its "Try a tool" calls this server through the API; sample "Try" responses must not ship, #44) |
| States covered | working · answered · no results · throttled · paused · timed out · limit reached |
| Design system | `assessment-guide/design-system/` (Atlas, Material 3, mobile-first) |

## Demo Script

1. Presenter: "Now I am asking the same type of questions through the agent." Agent prompt: "Which properties in Travis County within five miles of Pflugerville have roofs older than 15 years?" → Expected: matching properties, reasoning, source-backed evidence.
2. Agent prompt: "Which properties near that area have open roofing permits that have been open for many years, and who is the listed contractor?" → Expected: a filtered list with open duration, contractor, BBB when available, and stated assumptions and missing data.
3. Presenter: "Finally, I will show that the system is MCP-ready." → Expected: the tool list and one query through MCP Inspector or Claude Desktop, returning the same view columns as the UI.

## Out of scope

- Streaming responses (AD-09). AI-user sign-in (Coming soon).
- Free-form SQL from the agent (P0-13) and any SQL tool on the MCP server.
- The kit Elephant MCP for Travis (possible only after Atlas merges Travis).

## Merge notes (2026-10-21)

- **Judgement call: one query layer.** Both parts already require `query-core` (AD-19), but they name their tools differently: the agent's camelCase tools (`geocodePlace`, `searchProperties`, `searchRoofingPermits`, `getProperty`) and the six snake_case MCP tools of AD-21. This merged story keeps both public names and requires them to be thin adapters over the same `query-core` functions and Zod schemas (AC-8, FR-007). Whether the agent should call the six MCP tool definitions directly instead is a design question for Stage 3 (alakazam + oracle), not a new requirement.
- **Conflicting dated number.** The parts disagree on stalled reroofs within 5 mi of Pflugerville (3 vs 18, both "2026-10-19"). Stage 0 re-measures it once; AC-3 and AC-9 use that number.
- **Implicit dependencies kept from both parts:** A-11 (full-county tables, Run 1 manifest) and A-13 (Explore shell, demo area, Explore query for AC-8, `/help/mcp`). Stage 1 proposes adding them to `depends_on` (G4-8).
- **Evidence and test file names** use the lead ID: `testplans/A-14-test-cases.md`, `docs/reviews/CR-A-14.md`, `docs/evidence/A-14-agent.md` and `docs/evidence/A-14-mcp.md` (was `A-15-mcp.md`).

## Evidence to capture

- `docs/evidence/A-14.md` (summary, from the template), linking:
  - `docs/evidence/A-14-agent.md`: G1–G6 results with durations, step counts, groundedness and recall, trace IDs; model and provider used.
  - `docs/evidence/A-14-mcp.md`: Inspector screenshot, `tools/list` output, one call with result, the AC-8 comparison with the agent and Explore, 401 and 429 checks, `donphan` transcript, timings.
- `docs/mcp.md`; `smeargle` report; `testplans/A-14-test-cases.md` results; `docs/reviews/CR-A-14.md` (alakazam, ash, oracle, donphan).

---

## Gate G4: Story ready for planning

| # | Criterion | Status |
| --- | --- | --- |
| G4-1 | Front matter complete (parent FEAT, eval point, branch, priority, **agents and skills from AGENT-MAP.md**) | ☑ |
| G4-2 | "As a / I want / So that" stated, with an independent test | ☑ |
| G4-3 | Every AC is Given / When / Then, and its testable box is ticked | ☑ |
| G4-4 | One scale AC and one missing-data or error AC | ☑ |
| G4-5 | At least two edge cases | ☑ |
| G4-6 | Every requirement traces to an AC; NFRs have thresholds | ☑ |
| G4-7 | Prototype screen linked (UI stories) | ☑ |
| G4-8 | Dependencies done, or stubbed with **real** sample data | ☑ A-02, A-03 done and merged; A-11, A-13 added to `depends_on` 2026-10-22 (D-1) — A-11 `status: Draft` (blocked on A-07), A-13 `status: Done` but merge waits on A-11 per `PARALLEL-RUN.md` wave 5. Build/unit-test now on A-02/A-03; full-county answers, AC-8, AI-tab wiring and G7 wait |
| G4-9 | No `[NEEDS CLARIFICATION]` left | ☑ |
| G4-10 | AI pre-check (`developmentsupport-g4-precheck`): PASS | ☑ See `docs/gates/G4-A-14-precheck.md` |

**Decision:** ☑ Ready ☐ Returned, reason: {…} · 2026-10-22
