# Feature Specification: Answer roofing-lead questions through a source-backed agent and an MCP server

**Feature Branch**: `014-agent-and-mcp`

**Created**: 2026-10-22

**Status**: Draft

**Input**: User description: "Specify the story in stories/A-14-agent-and-mcp.md. Every acceptance criterion becomes at least one FR with the same numbers (AC-1 to AC-12; keep the part tags). Fill the spec header (story, merged parts A-14 + A-15, evaluation point A6, demo lines D-10, D-11, D-12, owner agents) from the story front matter. Facts: checks.md § 7 and A-oracle.md. No technology choices."

**Story**: `stories/A-14-agent-and-mcp.md` (merged from parts A-14 Agent + A-15 MCP, merged 2026-10-21) | **Evaluation point**: A6 (primary) · A2 | **Demo line(s)**: D-10, D-11, D-12

**Owner agents** (from the story front matter; used by the plan, not by this spec): design `alakazam`, `ash`, `oracle` · builder `alakazam` (retrieval), `ash` (agent runtime), `oracle` (MCP) · reviewers `alakazam`, `ash`, `oracle`, `donphan` · verify golden queries G1–G6 on the deployed agent; MCP Inspector on the hosted `/mcp`; `donphan` answers through it

> Every story acceptance criterion becomes at least one FR below. No technology choices in this file; they belong in plan.md.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Ask roofing-lead questions in plain language and get a cited answer (Priority: P1) [part A-14]

A CRM developer (or their AI agent) asks a roofing-lead question in plain words on the hosted Explore · AI tab — for example, "which properties within five miles of Pflugerville have roofs older than 15 years?" They get back real Travis County properties, how the question was understood (the centre point used, the thresholds applied), citations to the underlying rows, and an explicit statement of what is missing or unknown. They never see a guessed answer presented as certain.

**Why this priority**: this is evaluation point A6, demonstrated live in the README Demo Transcript (D-10, D-11). Without a trustworthy, source-backed answer to both roofing prompts, the story's primary evaluation point scores zero regardless of what else is built.

**Independent Test**: ask the two README prompts against the deployed agent and read the two answers; each must name real properties with citations, state its assumptions, and say what data is missing, without fabricating anything.

**Acceptance Scenarios**:

1. **Given** the question "Which properties in Travis County within five miles of Pflugerville have roofs older than 15 years?" (G1), **When** the hosted agent answers, **Then** it states the centre point used and its source, the radius and the age threshold, returns real properties each with a roof-age basis and source, and every returned property matches the same filter independently re-checked (recall ≥ 80% of the top matches).
2. **Given** a follow-up question that refers to "that area" (G2), **When** the agent answers, **Then** it keeps the area from the previous turn, states what it means by "many years" (at least 5), lists permits sorted by how long they have been open with the contractor as printed on the permit and that name's identity state, and the contractor's rating or a reason it is not available.
3. **Given** an area where no permits of the asked-about kind are currently open, **When** the follow-up question is asked, **Then** the answer says plainly that none were found in that radius, offers any permits that are stalled (clearly labelled as stalled, with the source's own status word shown), and lists what is missing (for example, that most permits don't print a contractor name, or that a rating isn't available).
4. **Given** a question about a ZIP code that is not in Travis County (G6), **When** the agent answers, **Then** it returns zero results and states plainly that the scope is outside Travis County — never an invented answer.
5. **Given** three further golden questions (an open-duration question near Manor, an ownership-tenure question near Lakeway that is partly outside Travis, and a direct business-rating lookup for one real permit), **When** each is asked, **Then** the agent applies the exact thresholds named, explains when something is "outside the area," and either cites its rating source or says plainly why a rating is missing.
6. **Given** the model provider is temporarily unavailable, the daily spend limit has been reached, or an answer is taking too long, **When** a question is asked, **Then** the agent answers with a plain, typed message (never a server error, and never a half-finished answer presented as whole) and tells the person what they can do next.

---

### User Story 2 - Call the same data through a standard MCP server (Priority: P1) [part A-15]

Another AI tool (Claude Desktop, Claude Code, or a CRM's own agent) connects to the hosted MCP server with a private access token and calls a small, fixed set of typed tools to list and filter the same published Travis County records the website and the plain-language agent use — without needing to understand SQL or the underlying storage, and without changing anything about how the data is modeled or stored.

**Why this priority**: this is the other half of evaluation point A6 and demo line D-12 — the system must be shown "MCP-ready... without changing the data model." It also underwrites Task B, which is expected to read Task A's data by this same interface.

**Independent Test**: connect MCP Inspector (or a compatible client) to the hosted server with the shared token, list the available tools, and successfully call one of them to get back real rows with their sources; confirm a wrong or missing token is refused.

**Acceptance Scenarios**:

1. **Given** the hosted MCP endpoint and a valid access token, **When** a client lists the available tools, **Then** it sees exactly the fixed set of tools, each describing its inputs in the same field names the website uses, returned quickly (well under a second).
2. **Given** a tool call asking for properties near Pflugerville within five miles with a roof-age filter, **When** the server answers, **Then** it returns the same set of properties as the plain-language agent and the website would for the same question on the same published data run, each row carrying where it came from (its source, when it was captured, and which published run it belongs to).
3. **Given** a tool call asking for permits in that area by status, **When** the server answers, **Then** it returns permits that are open or stalled, sorted by how long they've been open, each showing the source's own status word alongside the plain-language label ("stalled"); a coverage-summary tool returns the published run's coverage figures unchanged.
4. **Given** a query that would match more than a defined row limit (for example, every stalled permit countywide), **When** the server answers, **Then** it returns up to that limit with a flag saying the result was cut short and the true total; and under heavy simultaneous use, the server answers quickly up to a defined rate and politely declines calls beyond it.
5. **Given** no token, a wrong token, an unknown record identifier, or a location outside Travis County, **When** any call is made, **Then** the server refuses the call (no token/wrong token) or returns an empty result with a plain reason (unknown record, outside the service area) — never invented rows.
6. **Given** a general-purpose AI agent configured to use only this MCP server, **When** it is asked a realistic roofing-lead question, **Then** it answers using only this server's tools, citing the same record identifiers a person could independently check, and the exchange is kept as evidence.

---

### Edge Cases

- A place name that matches more than one location, one of which lies partly outside Travis County (for example Round Rock) — the answer must state which location it used and that results are limited to Travis County.
- A person edits one of the agent's stated assumptions (for example, changing "many years" from 5 to 3) — the agent re-answers with the edited assumption and its citations update to match.
- A single browsing session reaches its question limit — the agent says plainly that the limit is reached; only fully answered questions count against it.
- The underlying model provider is switched from the default to its fallback — the agent gives the same kind of answers, with no visible change in behavior and no code change.
- A browser page not on the approved list tries to call the MCP server directly — the call is rejected; the website's own "try it" feature still works because it adds the access token on the server side, never in the browser.
- The MCP server's access token is missing when the server starts — it fails immediately with a clear message, rather than running with no authentication.
- A client sends something that looks like a raw database query as a tool argument — it is rejected as an invalid input, never executed.
- The plain-language agent and the MCP server disagree on which properties match the same question against the same published run — this is always a defect: both must be backed by the same underlying query logic.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001** [A-14]: The agent MUST retrieve property, permit and place data only through a fixed set of typed tools (never free-form queries), including a place-lookup tool backed by a public, versioned place reference with a citable source.
- **FR-002** [A-14]: Every agent answer MUST cite the specific records it relied on (their public identifiers, sources and the published run), and state the assumptions it made (centre point, thresholds, time windows).
- **FR-003** [A-14]: When nothing matches, or the requested scope is outside Travis County, the agent MUST say so plainly and list what data is missing, rather than inventing a result.
- **FR-004** [A-14]: The agent MUST remember the subject of the current conversation (for example, "that area") across at least the last few turns of a session.
- **FR-005** [A-14]: When the agent cannot complete a request in time, is rate-limited by its model provider, or has reached a daily spend limit, it MUST return a plain, typed outcome and a helpful message — never a server error, and never a partial answer shown as complete.
- **FR-006** [A-15]: The MCP server MUST expose exactly a fixed, documented set of typed tools covering: searching properties, listing permits, looking up one property, reading published-run coverage, listing published runs, and reading the published schema.
- **FR-007** [A-15]: Every MCP tool result MUST match what the website and the plain-language agent would return for the same question against the same published run, and MUST carry that row's source, capture time, and the published run and manifest it came from.
- **FR-008** [A-15]: The MCP server MUST cap how many rows a single call can return, and MUST flag when a result was cut short along with the true total.
- **FR-009** [A-15]: The MCP server MUST require a private access token on every call and MUST answer an unknown record or an out-of-scope location with a plain reason rather than an empty success or invented rows.
- **FR-010** [A-15]: At least one general-purpose AI agent configured to use only this MCP server MUST be shown successfully answering a realistic roofing-lead question through it, with the exchange captured as evidence.
- **FR-011** [A-14, A-15]: The agent's tools and the MCP server's tools MUST be built on the same underlying data-access logic as the website, so that the three surfaces agree on which records match the same question against the same published run.
- **FR-012** [A-14]: The hosted Explore page MUST show the agent's working state, its final answer, its stated assumptions (editable by the person asking), and its citations linked to the matching rows.

### Key Entities *(include if feature involves data)*

- **Agent answer**: one response to one plain-language question — the answer text, how the question was understood, the assumptions made, the cited rows, what's missing, and a typed outcome (answered, or a specific reason it wasn't).
- **MCP tool call**: one typed request/response pair over the fixed tool set — inputs matching the website's own field names, and a result row set (or a typed empty-result reason) each carrying its provenance.
- **Published record (property, permit)**: the same underlying entity the website displays, identified the same way in all three surfaces (website, agent, MCP), always traceable to its source and the run that published it.
- **Conversation**: a short-lived sequence of turns within one browsing session, carrying forward the subject of a follow-up question and counting toward a per-session question limit.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Both README roofing-lead prompts, asked against the live hosted agent, come back with real Travis County properties, explicit citations, and explicit statements of assumptions and missing data — zero fabricated records across repeated runs.
- **SC-002**: At least 80% of the properties an independent re-check of the same filter would return also appear in the agent's answer, for every one of the six golden questions.
- **SC-003**: A question about a location outside Travis County always comes back empty with a plain "out of scope" explanation — never a guessed answer.
- **SC-004**: A connected MCP client can list the available tools in well under a second and get back real rows with full provenance on its first successful call, with no setup beyond the shared access token.
- **SC-005**: The agent, the MCP server and the website return the same set of matching records for the same question against the same published run, every time they are compared.
- **SC-006**: Under temporary unavailability, a reached spend limit, or a slow answer, a person always sees a clear, specific message and a way forward — never a raw error and never a partial answer presented as finished.
- **SC-007**: A general-purpose AI agent, limited to only this MCP server's tools, successfully answers a realistic roofing-lead question and the exchange is captured as evidence.

## Clarifications

### Session 2026-10-22

- Resolved without a user question (answered from existing code, per the walkthrough's rule to only ask when no source answers it): does the Help · MCP page's "Try a tool" control already call a live endpoint from story A-13, or is wiring it part of this feature? **Resolved: wiring it is part of this feature.** A-13's `apps/web/src/routes/HelpMcp.tsx` (on branch `013-explorer-and-pages`, not yet merged) ships the button but its click handler only shows a static "not available" status (`PAGE_TEXTS.mcpNotAvailable`); the component's own comment states the other five tools' input schemas "are not in query-core yet" and that "no sample response is ever shown... Static text only." The proxy requirement this implies (the website's own "try it" control must call through a server-side adapter that adds the token, so the token never reaches the browser — see Edge Cases) and the live "Try a tool" behavior are in scope here.
- Q: AC-1 says roof age "> 15" and AC-8 says "≥ 15" — which threshold does the roof-age filter actually use? → A: `roof_age_years_min` ≥ 15 (inclusive) for both, since roof age is floored to whole years and the two readings differ only on the exact anniversary day; the "How I read this" chip states "≥ 15 whole years."
- Q: G4 (Lakeway, "owners outside the area") cannot return a positive match in v1 because the owner's mailing ZIP is not in the published export at all — is an honest "can't tell, not published" the correct answer, or is this a defect to fix? → A: it is the correct, honest answer (FR-003); the owner-mailing-ZIP field is a genuine data-contract gap (`docs/decisions/0002-lexicon-carriers.md`), not something this feature can derive, and the evidence must cite the specific gap rather than report a fabricated match or silently return nothing.
- Q: should the agent's tools and the MCP server's six tools share one tool definition, or be separate thin adapters over the same `query-core` functions? → A: separate thin adapters over the same functions and Zod schemas (FR-011). The MCP tools return full rows (≤1,000) in the fixed AD-21 snake_case shape; the agent tools return a compact, citation-indexed projection (≤25 rows) to stay inside its token/step budget. A parity test keeps the two from drifting.

## Assumptions

- The published Travis County property and permit data (from the pipeline's full-county publication) is the single source of truth for both surfaces; where the full county is not yet published, this feature is built and unit-tested against whatever subset is already published, and the full-scale checks run once it is.
- The hosted website already provides a place to show the plain-language agent's answers (an "AI" area of the property Explorer) and a documentation page for the MCP server; this feature fills those in rather than creating new pages for them.
- "Many years" for an open permit defaults to five years or more unless a person asking adjusts it.
- A browsing session's question allowance (ten questions) and the model provider's own request-rate limit are treated as fixed constraints on this feature, not as something it needs to raise.
- The model used to understand plain-language questions is swappable by configuration (a default provider and a fallback), with no visible change in behavior and no change to this feature's code when that switch happens.
- Streaming answers, letting an AI-only user sign in, free-form query access for either surface, and using any Elephant-brand MCP server for this county are all out of scope for this feature.
