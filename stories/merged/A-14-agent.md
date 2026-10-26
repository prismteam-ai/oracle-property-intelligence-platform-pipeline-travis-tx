---
id: A-14
type: user-story
title: Answer roofing-lead questions with a source-backed agent
parent: FEAT-A14
vision: VIS-A
ard: ARD-A
eval_point: A6
priority: P1
moscow: Must
branch: 014-agent
spec: specs/014-agent/
depends_on: [A-02, A-03]
size_days: 1
agents:
  design: [alakazam, ash]
  builder: [alakazam, ash]   # AGENT-MAP: alakazam (retrieval), ash (runtime)
  reviewers: [alakazam, ash]
  verify: "golden queries G1–G6"
skills: [build-rag-systems, build-ai-agents, responsive-design-tests, apply-engineering-guidelines]
ui: true
status: Merged
merged_into: A-14
gate: G4
qc_testability_signoff: false
created: 2026-10-19
---

> **Merged 2026-10-21 into [A-14 Answer roofing-lead questions through a source-backed agent and an MCP server](../A-14-agent-and-mcp.md)** (branch `014-agent-and-mcp`). This file is kept for reference only: do not build, gate or branch from it. Its ACs and requirements are renumbered in the merged story, each tagged with its original ID.

# A-14 Answer roofing-lead questions with a source-backed agent

| Field | Value |
| --- | --- |
| Evaluation point | A6 (primary) · A2 |
| Demo line(s) | D-10 (roofs > 15 years within 5 mi of a city), D-11 (long-open permits near that area, with contractor) |
| Agents | design `alakazam`, `ash` · builder `alakazam` (retrieval), `ash` (runtime) · reviewers `alakazam`, `ash` · verify golden queries G1–G6 (source: [AGENT-MAP.md](../../assessment-guide/AGENT-MAP.md) § 4) |
| Depends on | A-02, A-03 (real answers need the A-11 full-county tables) |
| Size | 1 day |
| Branch | `014-agent`, merged into `feature/oracle-pipeline` |

## Context

The README's two agent prompts (D-10, D-11) must be answered "with source-backed evidence" and must "clearly identify any assumptions or missing data". A **CRM developer or their AI agent** asks in plain words; the **evaluator** checks that every returned property is real and every claim is cited. The agent is RAG over the published records: the model sees rows only through typed tools (AD-20).

Real check (Austin, live 2026-10-19): within 5 mi of Pflugerville's Census internal point (30.447765, −97.602116), Austin has **0 open** and **3 stalled** (`Expired`) reroof permits out of 44 (2004-011296 BP, 2018-111955 BP, 2022-098180 BP). So an honest answer to D-11 for Pflugerville must say no open roofing permits were found and offer the stalled ones, labelled as stalled. The demo uses the area A-13 records as the demo area.

## Description

As a **CRM developer (or the CRM's agent)**, I want **to ask roofing-lead questions in plain language and get real Travis County properties back with reasoning, citations, assumptions and missing data stated**, so that **I can trust the answer without re-running the query myself**.

When done: a tRPC procedure `agent.ask` on Lambda uses the Vercel AI SDK; `getModel()` switches on `AI_PROVIDER` (`bedrock` with `eu.anthropic.claude-sonnet-4-6`, or `gateway`); the agent code never names a provider. It returns one response (no streaming) with `answer`, `how`, `steps[]`, `matches[]` (citation n → row n with `property_cid`, source URL, run), `query`, `missing[]` and `outcome`. The hosted Explore · AI tab shows Working…, then the answer, "How I read this" chips, and citations linked to rows.

**Overrides applied (ARD § 15, AD-30):** tools come from `query-core` (AD-19), not hand-written Bedrock tools; `geocodePlace` is added and reads the A-02 place gazetteer (US Census 2024 Gazetteer, versioned in `query-core`, source URL and SHA-256 cited in the answer), so it is public and has provenance. One response with layered timeouts: 23 s server abort → `timed_out`, 25 s Lambda and client stop, HTTP API 29–30 s (AD-09, AD-27). Described as RAG over the published records (AD-20).

**Independent test:** the golden queries G1–G6 (`checks.md` § 7) run as Vitest against the **deployed** endpoint and pass.

## Acceptance Criteria

1. **AC-1** · **Given** G1 "Which properties in Travis County within five miles of Pflugerville have roofs older than 15 years?", **When** the hosted agent answers, **Then** it states the centre point and its source ("Pflugerville city, Census 2024 Gazetteer, 30.447765, −97.602116"), uses radius 5 mi and roof > 15, returns real `property_cid`s each with roof-age basis and source, and every returned row satisfies the same `query-core` SQL (recall ≥ 80% of the top-N) (D-10). ☐ testable
2. **AC-2** · **Given** G2 as the next turn, **When** the agent answers, **Then** it keeps "that area" from the previous turn, states its meaning of "many years" (≥ 5), lists permits sorted by open duration with contractor "as printed on permit", its identity state, and BBB or "not available" with the reason (D-11). ☐ testable
3. **AC-3** (missing data) · **Given** the Pflugerville area where the current run finds 0 open Austin reroof permits (3 stalled on 2026-10-19), **When** G2 is asked, **Then** the answer says that no open roofing permits were found in that radius, offers the stalled ones explicitly labelled "stalled · source says Expired" (or "stalled" alone if `status_raw` has no carrier, A-02 AC-1), and lists the missing data (for example "contractor not printed" on most permits, BBB status); **Given** G6 "ZIP 99999", **Then** it returns zero results and says the scope is not in Travis County, with no fabrication. ☐ testable
4. **AC-4** · **Given** G3 (Manor, open > 5 years), G4 (Lakeway, tenure 10+, out-of-area) and G5 (BBB for a real permit number, for example 1982-012866 BP), **When** answered, **Then** each uses exact thresholds, explains "outside the area", and cites the BBB source or says why it is missing. ☐ testable
5. **AC-5** (scale) · **Given** the full-county tables and Bedrock's 10 requests-per-minute limit, **When** G1–G6 run against the hosted endpoint, **Then** p95 < 20 s, each answer uses ≤ 6 tool steps, ≤ 3 model calls and ≤ 1,500 output tokens, and each tool call returns ≤ 1,000 rows. ☐ testable
6. **AC-6** (error) · **Given** the model is throttled, the $3/day budget is reached, or 23 s pass, **When** a question is asked, **Then** the response outcome is `throttled`, `paused` or `timed_out` with a plain message ("Took too long" with Try again and Use Filters instead), never a 5xx and never a partial answer presented as complete. ☐ testable

## Edge cases (at least two)

- A city name that matches two places (Round Rock is partly outside Travis) → state which centre was used and that results are limited to Travis County.
- The user edits a "How I read this" chip (5 → 3 years) → re-runs with the edited threshold; the citation list updates.
- The session reaches 10 questions → "n of 10 AI questions left" reaches 0; only `answered` counts (#66).
- `AI_PROVIDER=gateway` → same answers; no code change.

## Requirements

| REQ | Requirement | Traces to |
| --- | --- | --- |
| FR-001 | Agent MUST retrieve only through `query-core` Zod tools plus a provenance-backed `geocodePlace` | AC-1, AC-4 |
| FR-002 | Every answer MUST cite `property_cid`, source URL and run, and state assumptions | AC-1, AC-2 |
| FR-003 | Agent MUST say when nothing matches and list missing data; no fabrication | AC-3 |
| FR-004 | Agent MUST keep conversation context for "that area" | AC-2 |
| FR-005 | Agent MUST return a typed outcome on throttle, budget or timeout | AC-6 |
| NFR-001 | p95 < 20 s; 23 s abort; ≤ 6 tool steps; ≤ 3 model calls; ≤ 1,500 output tokens; $3/day cap with alarm at 80% | AC-5, AC-6 |
| NFR-002 | Vercel AI SDK only; no direct provider SDK (constitution VI) | AC-1 |

## Prototype reference (mandatory if the story has UI)

| Element | Value |
| --- | --- |
| Claude Design screen | `design/prototype/ExploreQ-ai.dc.html`, `ExploreQ-aicontractor.dc.html`, `ExploreQ-aiworking.dc.html`, `ExploreQ-aislow.dc.html`, `ExploreQ-ailimit.dc.html`, `ExploreQ-aipaused.dc.html`, `HelperStates.dc.html` (and 390/768 variants) |
| States covered | working · answered · no results · throttled · paused · timed out · limit reached |
| Design system | `assessment-guide/design-system/` (Atlas, Material 3, mobile-first) |

## Demo Script

1. Presenter: "Now I am asking the same type of questions through the agent." Agent prompt: "Which properties in Travis County within five miles of Pflugerville have roofs older than 15 years?" → Expected: matching properties, reasoning, source-backed evidence.
2. Agent prompt: "Which properties near that area have open roofing permits that have been open for many years, and who is the listed contractor?" → Expected: a filtered list with open duration, contractor, BBB when available, and stated assumptions and missing data.

## Out of scope

- Streaming responses (AD-09). AI-user sign-in (Coming soon).
- Free-form SQL from the agent (P0-13).

## Evidence to capture

- `docs/evidence/A-14-agent.md`: G1–G6 results with durations, step counts, groundedness and recall, trace IDs.
- `smeargle` report; `testplans/A-14-test-cases.md` results; `docs/reviews/CR-A-14.md` (alakazam, ash).

---

## Gate G4: Story ready for planning

| # | Criterion | Status |
| --- | --- | --- |
| G4-1 | Front matter complete (parent FEAT, eval point, branch, priority, **agents and skills from AGENT-MAP.md**) | ☐ |
| G4-2 | "As a / I want / So that" stated, with an independent test | ☐ |
| G4-3 | Every AC is Given / When / Then, and its testable box is ticked | ☐ |
| G4-4 | One scale AC and one missing-data or error AC | ☐ |
| G4-5 | At least two edge cases | ☐ |
| G4-6 | Every requirement traces to an AC; NFRs have thresholds | ☐ |
| G4-7 | Prototype screen linked (UI stories) | ☐ |
| G4-8 | Dependencies done, or stubbed with **real** sample data | ☐ |
| G4-9 | No `[NEEDS CLARIFICATION]` left | ☐ |
| G4-10 | AI pre-check (`developmentsupport-g4-precheck`): PASS | ☐ |

**Decision:** ☐ Ready ☐ Returned, reason: {…} · {date}
