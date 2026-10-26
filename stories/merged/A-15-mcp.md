---
id: A-15
type: user-story
title: Expose the data through an MCP server
parent: FEAT-A15
vision: VIS-A
ard: ARD-A
eval_point: A6
priority: P1
moscow: Must
branch: 015-mcp
spec: specs/015-mcp/
depends_on: [A-02, A-03]
size_days: 0.5
agents:
  design: [oracle]
  builder: oracle
  reviewers: [oracle, donphan]
  verify: "MCP Inspector on the hosted URL; `donphan` answers through it"
skills: [deploy-open-data-mcp, use-elephant-mcp, apply-engineering-guidelines]
ui: false
status: Merged
merged_into: A-14
gate: G4
qc_testability_signoff: false
created: 2026-10-19
---

> **Merged 2026-10-21 into [A-14 Answer roofing-lead questions through a source-backed agent and an MCP server](../A-14-agent-and-mcp.md)** (branch `014-agent-and-mcp`). This file is kept for reference only: do not build, gate or branch from it. Its ACs and requirements are renumbered in the merged story, each tagged with its original ID.

# A-15 Expose the data through an MCP server

| Field | Value |
| --- | --- |
| Evaluation point | A6 (primary) |
| Demo line(s) | D-12 (MCP-ready) |
| Agents | design `oracle` · builder `oracle` · reviewers `oracle`, `donphan` · verify MCP Inspector on the hosted URL; `donphan` answers through it (source: [AGENT-MAP.md](../../assessment-guide/AGENT-MAP.md) § 4) |
| Depends on | A-02, A-03 |
| Size | 0.5 days |
| Branch | `015-mcp`, merged into `feature/oracle-pipeline` |

## Context

The README asks for a database "structured to support MCP access" and a demo that the system is MCP-ready "without changing the data model" (AC-23, D-12). An **AI client** (Claude Desktop, the CRM's agent) needs a standard way to query Travis data. The kit Elephant MCP cannot serve Travis yet (checked 2026-10-15: Atlas serves only Jackson County, FL), so CountyLens runs its own MCP over its own CIDs, using the same `query-core` tools as the UI and agent.

## Description

As an **AI client developer**, I want **a hosted MCP endpoint that lists typed tools over the published Travis data and answers queries with provenance**, so that **any MCP-capable agent, including the CRM's, can use the same data model as the UI**.

When done: a TypeScript MCP server (`@modelcontextprotocol/sdk`), stateless Streamable HTTP on its own Lambda at `POST /mcp`, plus a stdio build. It requires a bearer token stored in SSM SecureString and shared privately with the evaluator (AD-10, AD-14). `docs/mcp.md` documents the Claude Desktop, Claude Code and Inspector setup.

**Overrides applied (ARD § 15, AD-30):** the six fixed tools of AD-21 — `search_properties`, `list_permits`, `get_property`, `get_coverage`, `list_runs`, `get_schema` — each ≤ 1,000 rows, with **no SQL tool** on the server (P0-13). The playbook's `listScopes` / `getSchema` / `query` shape is replaced.

**Independent test:** MCP Inspector against the hosted `/mcp` with the token lists six tools and returns rows for `search_properties`; `donphan` answers a question through it.

## Acceptance Criteria

1. **AC-1** · **Given** the hosted endpoint and a valid bearer token, **When** MCP Inspector calls `tools/list`, **Then** it returns exactly the six AD-21 tools with Zod-derived input schemas using the AD-07 column names, in under 500 ms. ☐ testable
2. **AC-2** · **Given** `search_properties` with area Pflugerville (resolved through the A-02 gazetteer), radius 5 mi, roof ≥ 15, **When** called, **Then** it returns the same `property_cid`s as the Explore page's query for the same run, each with provenance (`source_url`, `captured_at`, `table_cid`, `run_id`, `manifest_cid`). ☐ testable
3. **AC-3** · **Given** `list_permits` for the same area with `status_class` open or stalled, **When** called, **Then** it returns stalled reroofs such as 2004-011296 BP with `status_class = stalled` (and `status_raw = Expired` if A-02 found a carrier) and `open_days`, sorted by open duration; `get_coverage` returns the manifest `coverage` section unchanged. ☐ testable
4. **AC-4** (scale) · **Given** a query matching more than 1,000 rows (for example all stalled reroofs county-wide, 2,213 on 2026-10-19), **When** called, **Then** it returns at most 1,000 rows with a `truncated: true` flag and the total count; `tools/call` p95 < 3 s over 20 calls; the route sustains 5 rps with burst 10 and answers 429 beyond it. ☐ testable
5. **AC-5** (missing data / error) · **Given** no token or a wrong token, **When** any call is made, **Then** the server answers 401 and runs nothing; **Given** an unknown permit number or a non-Travis ZIP, **Then** the tool returns an empty result with a reason (`not_found`, `out_of_scope`), never invented rows. ☐ testable
6. **AC-6** · **Given** the `donphan` agent configured with the hosted endpoint, **When** asked "Which properties near Lakeway have owners outside the area?", **Then** it answers through the MCP tools and cites `property_cid`s, and the transcript is saved as evidence. ☐ testable

## Edge cases (at least two)

- A browser `Origin` that is not on the allowlist → rejected; the Help page's "Try a tool" goes through the tRPC proxy, which adds the token server-side (AD-10).
- The SSM parameter is missing at cold start → fail fast with a clear log line; no default token.
- A client sends a free-form SQL string as a tool argument → Zod rejects it.

## Requirements

| REQ | Requirement | Traces to |
| --- | --- | --- |
| FR-001 | Server MUST expose exactly six typed tools from `query-core` | AC-1 |
| FR-002 | Tool results MUST match the UI's query results and carry provenance | AC-2, AC-3 |
| FR-003 | Server MUST cap rows at 1,000 and flag truncation | AC-4 |
| FR-004 | Server MUST require the bearer token and return reasons for empty results | AC-5 |
| FR-005 | A kit agent MUST answer a question through the hosted server | AC-6 |
| NFR-001 | `tools/list` < 500 ms; `tools/call` p95 < 3 s; 5 rps burst 10; 401 without token | AC-1, AC-4, AC-5 |
| NFR-002 | Token never in git, logs, or browser bundles (NFR-04) | AC-5 |

## Prototype reference

The Help · MCP page that documents the endpoint is `design/prototype/HelpMcp1440.dc.html` (rendered in A-13; its "Try a tool" calls this server through the API). Sample "Try" responses must not ship (#44).

## Demo Script

1. Presenter: "Finally, I will show that the system is MCP-ready." → Expected: the tool list and one query through MCP Inspector or Claude Desktop, returning the same view columns as the UI.

## Out of scope

- The kit Elephant MCP for Travis (possible only after Atlas merges Travis).
- Any SQL tool on the server.

## Evidence to capture

- `docs/evidence/A-15-mcp.md`: Inspector screenshot, `tools/list` output, one call with result, 401 check, `donphan` transcript, timings.
- `docs/mcp.md`; `testplans/A-15-test-cases.md` results; `docs/reviews/CR-A-15.md`.

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
