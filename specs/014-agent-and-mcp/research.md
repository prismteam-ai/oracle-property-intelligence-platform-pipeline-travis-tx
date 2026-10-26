# Phase 0 research: A-14 agent + MCP server

No `NEEDS CLARIFICATION` markers remain in plan.md's Technical Context — the story, the ARD and the three Stage 3 design consults (`agent-design.md`) answer every technical unknown. This file records the handful of real technology decisions the design consults made, with rationale and the alternative each rejected, so Stage 5's builders don't re-derive them.

## Decision: no embeddings / vector index for retrieval

- **Decision**: structured, deterministic retrieval only — exact gazetteer match for places, typed numeric/enum filters over the published view columns, haversine radius math already in `builders.ts`. No OpenSearch, no Bedrock embeddings, no vector index.
- **Rationale**: every field the agent/MCP filter on is either an exact name (place), a frozen enum (`status_class`), or a numeric threshold on an AD-07 column — exactly the case alakazam's own `build-rag-systems` skill says to use deterministic rules for, not embeddings. A vector index would also bill while idle (constitution A7) with nothing to search semantically (there is no free-text corpus here, only structured rows).
- **Alternatives considered**: the skill's default pattern (OpenSearch + Bedrock embeddings) was rejected for the reason above; a lighter in-memory fuzzy-match library for place names was rejected because exact-match-only is what makes `out_of_scope` behavior correct and testable (any fuzzy match risks silently resolving a misspelled or ambiguous place to the wrong centre point, which would fail honesty/no-fabrication checks).

## Decision: separate thin adapters, one shared function/schema layer (D-4)

- **Decision**: `packages/query-core/src/tools/{schemas,functions}.ts` own the six Zod input schemas and functions; `apps/api/src/agent/tools.ts` (camelCase, ≤25-row citation-indexed projection) and `apps/api/src/mcp/tools.ts` (snake_case, ≤1,000-row full payload, AD-21 names) each import and wrap them.
- **Rationale**: confirmed with the user at D-4. MCP's fixed AD-21 shape and the agent's token/step budget genuinely need different output shapes; sharing one tool object would force a compromise on one side. A parity test (query-core) and a hosted three-way comparison (agent vs MCP vs Explore `search`) are the actual guarantee of agreement (AC-8, FR-011), not object identity.
- **Alternatives considered**: one shared tool definition for both surfaces — rejected per D-4 (would flood the agent's context with 1,000-row payloads, or leak agent-only citation-numbering into the public MCP contract).

## Decision: roof-age threshold is `≥ 15` (inclusive) everywhere (D-3)

- **Decision**: `roof_age_years_min: 15` with `≥` semantics, used for both AC-1 ("roof > 15") and AC-8 ("roof ≥ 15").
- **Rationale**: confirmed with the user at D-3. Roof age is floored to whole years as of the run's `as_of` date, so `> 15` and `≥ 15` differ only on the exact anniversary day — a wording inconsistency between two frozen ACs, not a real behavior difference worth two code paths.
- **Alternatives considered**: strict `> 15` for AC-1 only — rejected (would need two oracle queries in the grader for no practical benefit).

## Decision: G4 (owners outside the area) answers honestly as "can't tell, not published" (D-3)

- **Decision**: `searchProperties`'s `owner_is_out_of_area` filter returns `empty_reason: field_not_published` when every in-radius row has `owner_is_out_of_area = null` (today, always — the owner mailing ZIP is not in the published export per `docs/decisions/0002-lexicon-carriers.md`).
- **Rationale**: confirmed with the user at D-3. This is a genuine data-contract gap (`UNCARRIED.v_property`), not a bug; constitution XI (data honesty) and FR-003 require saying so plainly rather than returning zero rows silently or inventing a signal.
- **Alternatives considered**: deriving an out-of-area proxy from some other field — rejected as out of scope; no published field carries owner location today.

## Decision: promote the DuckDB/CID-copy engine binder to a shared package

- **Decision**: new `packages/engine-duckdb` wrapping the existing `apps/api/src/engine/duckdb-node.ts` + `s3-read.ts` (AD-18-compliant CID-copy binder), imported by both the existing query-API Lambda and the new, separate MCP Lambda.
- **Rationale**: oracle's design-oracle.md risk 3 — AD-21 puts MCP on its own Lambda, and letting `apps/mcp`/the MCP handler grow its own copy of the binder would violate AD-19 ("one shared query layer") the moment the two copies drift.
- **Alternatives considered**: a second, MCP-local copy of the binder — rejected for the reason above; it is faster to build but is exactly the kind of drift the ARD forbids.

## Decision: no reserved Lambda concurrency on either new Lambda (agent, MCP)

- **Decision**: neither the agent Lambda nor the MCP Lambda reserves concurrency; both rely on API Gateway stage/route throttling, the spend-cap/rate-limit backstops, and (for the agent) Bedrock's own 10 req/min ceiling.
- **Rationale**: this run's environment check found the AWS account's `ConcurrentExecutions` **and** `UnreservedConcurrentExecutions` are both 10, account-wide, not per-stack — confirmed independently by both ash and alakazam's design consults. Reserving any amount for the new Lambdas would starve the existing query-API Lambda, the admin Lambda and the pipeline bridge sharing that same 10-wide pool. This matches the already-accepted AM-06 precedent for the existing query-API Lambda (no reserved concurrency, same account limit cited).
- **Alternatives considered**: reserving a small amount (e.g. 2) for the agent Lambda to guarantee it isn't starved during a demo — rejected because the account cannot safely divide 10 slots across 4+ functions with any meaningful margin; AD-11 itself says "reserved concurrency only if the account allows it," and it does not here.

## Decision: pin `@modelcontextprotocol/sdk` to an exact version in this plan

- **Decision**: the exact version is recorded at the start of Stage 5's build (not "latest"), because oracle's design-oracle.md risk 7 found the Origin/DNS-rebinding guard's option name is version-specific.
- **Rationale**: avoids a silent behavior change between this design consult and the actual build.
- **Alternatives considered**: floating to latest — rejected per the risk above.

## Decision: timeout layering — agent Lambda keeps AD-27's 25 s, independent of AM-06's 15 s

- **Decision**: `agent.ask`'s Lambda timeout is 25 s (AD-27: 23 s abort → `timed_out`, 25 s Lambda, 29–30 s HTTP API ceiling). This is a **different** Lambda from the existing query-API Lambda, whose 15 s timeout is set by AM-06 (AD-11's cap) for a different workload (DuckDB COUNT queries).
- **Rationale**: both alakazam's and ash's design consults independently raised this as a possible conflict; resolved by reading `docs/architecture-constitution.md` lines 207 (AD-09), 237 (AD-27) and 435 (AM-06) directly — AD-27 governs the agent Lambda specifically ("Metagross owns API and hosting... keeps AD-09's 25 s"), AM-06 is scoped to "The API Lambda timeout is 15 s" for the existing query/explore API. No actual conflict; no user decision needed.
- **Alternatives considered**: none — this was a documentation-reading task, not a design choice.
