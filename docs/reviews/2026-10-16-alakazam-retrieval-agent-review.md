# Alakazam retrieval and agent review, 2026-10-16

Read-only review by the kit's `alakazam` agent of the retrieval and agent design, the third of four pre-freeze
reviews (after two `oracle` passes and a `mew` lookup; `metagross` follows). No edits, AWS, Bedrock, network or MCP
calls. Line numbers refer to commit `4188f4a`. Kit files read in full: `agents/alakazam.md`, `skills/build-rag-systems/`
(SKILL.md and its 8 rule files), `skills/build-ai-agents/` (SKILL.md and its rules), `skills/build-local-rag-pocs/SKILL.md`,
`skills/apply-engineering-guidelines/` (SKILL.md and its rules). Rule files are cited by file name.

**Status:** every finding was applied the same day: `docs/decisions.md` section 20 and the dated entry in
`docs/api-contract.md`'s change control. The orchestrating session verified the text-search claims (finding F4)
on DuckDB 1.5.6: `re-roof`, `reroof` and `re roof` do not match one another, matching is disjunctive by default,
and a conjunctive query containing a stopword returns nothing.

**Classification** (alakazam.md:12-18, :30): knowledge Q&A, i.e. grounded generation, plus hybrid search over
operational data, with a structured leg (SQL) and a lexical leg (full-text) and no vector leg. It is RAG, because
retrieved records ground a generated answer; it is not operational retrieval, because no prior decision is reused
and nothing is auto-applied.

**Verdict:** the retrieval approach is sound and acceptable once recorded; the contract was not ready to freeze.

## Findings

| # | Finding | Verdict | Doc (4188f4a) | Kit | Applied as |
| --- | --- | --- | --- | --- | --- |
| F1 | "Operational retrieval over records" is the wrong class | violation | decisions.md:328-332 | alakazam.md:12-18, :30; build-rag-systems/SKILL.md:10; architecture-rag-use-case-taxonomy.md:11-27, :29-48 | §20 Classification |
| F2 | No embeddings, no OpenSearch, no Docker OpenSearch: exceptions not recorded | acceptable if recorded | decisions.md:240-242, :331-338 | build-rag-systems/SKILL.md:63, :67-89, :110, :173; architecture-aws-local-emulation.md:45-80; alakazam.md:20-21 | §20 Classification |
| F3 | No retrieval-quality evaluation; T9 accepted on two prompts | violation | decisions.md:75-77 | delivery-evaluation-and-operations.md:9-43, :57, :135; build-rag-systems/SKILL.md:71-72, :89, :140-146; alakazam.md:19, :25 | §20 Golden set; §2 T9 check |
| F4 | Text-search mechanics unspecified (DuckDB FTS defaults drop digits and hyphens, disjunctive matching, raw BM25, no snippet function, no sort) | acceptable if recorded | api-contract.md:148-154, :248; decisions.md:193-194, :240-242 | implementation-retrieval-and-confidence-policy.md:13-60, :96-103; alakazam.md:24; build-rag-systems/SKILL.md:170 | §20 Text search; contract text search |
| F5 | Fields outside the lexicon, and every text-search hit, are not backed by the CID they are cited with; dead option (ii) still in four places | violation | decisions.md:143, :229-231, :239-240, :489-492, :524-540; api-contract.md:52, :173, :219, :231, :246, :313 | implementation-corpus-and-metadata-contract.md:13-25; implementation-retrieval-and-confidence-policy.md:88-90, :102; delivery-evaluation-and-operations.md:40; alakazam.md:26 | §20 option (iii) as one observation; `unpublished_source`; `/v1/meta.deploy` |
| F6 | Grounding and citation stated as intent, not enforced; evidence shape too small | violation | api-contract.md:170-175; decisions.md:320-322, :330 | implementation-retrieval-and-confidence-policy.md:84-92; implementation-request-contracts-and-routing.md:94-101; alakazam.md:22 | §20 Grounding; chat response |
| F7 | No prompt-injection boundary | violation | api-contract.md:153, :170, :219, :234, :243, :250; decisions.md:350 | implementation-retrieval-and-confidence-policy.md:91-92; implementation-corpus-and-metadata-contract.md:109; build-rag-systems/SKILL.md:174; alakazam.md:26 | §20 Prompt-injection boundary; contract untrusted-text rule |
| F8 | Personal data to Bedrock, LangSmith and logs not governed | acceptable if recorded | api-contract.md:213-224, :243, :250; decisions.md:148, :339, :374-377 | alakazam.md:26; build-rag-systems/SKILL.md:174; implementation-corpus-and-metadata-contract.md:101-111; delivery-evaluation-and-operations.md:59-72; apply-engineering-guidelines/SKILL.md:103; observability-logging-tracing.md:36-38 | §20 Personal data |
| F9 | Stateless HTTP chat replaces Chat SDK ingress and AgentCore Memory, unrecorded | acceptable if recorded | api-contract.md:170-171; decisions.md:333-338 | build-ai-agents/SKILL.md:120-129, :174, :177, :179; state-agentcore-memory.md:22-23, :160; state-chat-sdk-state.md:9-11 | §20 Stateless chat |
| F10 | Chat request unbounded | violation | api-contract.md:21-22, :170-171 | state-agentcore-memory.md:162; external-dependency-boundaries.md:21 | chat request limits, `413` |
| F11 | The sync-call exception does not fit API Gateway's 30 s cutoff; no bulkhead, circuit breaker or fallback | violation | decisions.md:243-246, :316-319, :333-335; api-contract.md:21-30 | external-dependency-boundaries.md:19-22; apply-engineering-guidelines/SKILL.md:106; architecture-aws-local-emulation.md:48 | §20 Time budget and isolation; `503 agent_unavailable` |
| F12 | No tool-call or result-size limits inside the agent | acceptable if recorded | decisions.md:320-322; api-contract.md:24-26, :64, :182 | implementation-vercel-ai-tool-loop-agent.md:133, :158-164; delivery-tools-deploy-and-test.md:48-52 | §20 Agent tools; MCP `limit` 20/50 |
| F13 | LangSmith tracing, prompt caching and an agent name missing | violation | decisions.md:75-77, :320-322, :339 | build-ai-agents/SKILL.md:41, :106, :110-118, :176, :178; observability-langsmith-telemetry.md:9-22, :80-88; implementation-bedrock-prompt-caching.md:9-23; foundation-agent-naming.md:9-62; delivery-evaluation-and-operations.md:59-72; alakazam.md:20 | §20 Observability (name pending the operator) |
| F14 | Public chat route has no hard cost limit | acceptable if recorded | api-contract.md:15, :20-23; decisions.md:322, :350 | external-dependency-boundaries.md:21; delivery-evaluation-and-operations.md:85 | §20 daily budget, `503 budget_exhausted` |
| F15 | Model choice and the Bedrock fallback need verification and a fuller deviation record | acceptable if recorded | decisions.md:323-327, :369-377 | build-ai-agents/SKILL.md:102; implementation-vercel-ai-tool-loop-agent.md:9, :53-67, :205-206; stack-ai-sdk-for-llm.md:20; implementation-bedrock-prompt-caching.md:9; alakazam.md:20, :26 | §20 Model |
| F16 | Search-center resolution needs normalization; "no invented coordinates" not enforced | acceptable if recorded | decisions.md:146, :235-238; api-contract.md:62, :109-113, :181 | alakazam.md:24; implementation-retrieval-and-confidence-policy.md:17-20, :30-38, :50-52, :102 | contract Search center; §20 Agent tools |
| F17 | `search_properties` ORs two signals by default, so README prompt 1 is answered wrongly | violation (MCP and agent) | api-contract.md:117-118, :123-125, :182 | implementation-vercel-ai-tool-loop-agent.md:160-161; delivery-tools-deploy-and-test.md:48 | `open_permits` required for MCP and the agent |
| F18 | MCP surface under-specified for an external agent | violation | api-contract.md:18-19, :27-29, :177-190, :314; decisions.md:507-509 | implementation-vercel-ai-tool-loop-agent.md:130, :140, :161-164; delivery-tools-deploy-and-test.md:50; stack-ai-sdk-for-llm.md:22-23 | `/v1/mcp`, pinned revision, schemas, annotations, `isError` |
| F19 | `needs_review` has no correction path | acceptable if recorded | decisions.md:190-195, :202-206; api-contract.md:46-47, :51, :152 | implementation-human-review-and-learning-loop.md:39-49; implementation-retrieval-and-confidence-policy.md:52, :66; architecture-rag-use-case-taxonomy.md:79-81 | §20 correction loop |
| F20 | "Today" in durations is unspecified | acceptable if recorded | decisions.md:185-188; api-contract.md:55-57 | delivery-evaluation-and-operations.md:40; implementation-retrieval-and-confidence-policy.md:88 | computed at query time, `open_duration_as_of` |
| F21 | AI SDK with Zod tools and `ToolLoopAgent` on Bedrock, one model parameter, scoped IAM, `sam local` over CDK, Powertools | fine | decisions.md:320-327, :337-339 | build-ai-agents/SKILL.md:101-103; implementation-vercel-ai-tool-loop-agent.md:9, :128-131; stack-ai-sdk-for-llm.md:22-25; build-rag-systems/SKILL.md:80-87 | none |

## Contract changes required before the freeze

[B] breaking, applied before the freeze; [A] additive, applied now because T9 needs them. All 38 are applied.

| # | Area | Change | Tag |
| --- | --- | --- | --- |
| 1 | Transport | `POST /mcp` becomes `POST /v1/mcp` | B |
| 2 | Transport | one pinned MCP protocol revision; `structuredContent` plus a text block; `outputSchema` per tool | B |
| 3 | Transport | MCP failures as `isError` results `{error, detail?, retry_after_seconds?}` | B |
| 4 | Transport | chat `503 agent_unavailable` with reasons; API Gateway's own `503`/`504` at 30 s | B |
| 5 | Transport | `x-request-id` header on REST and MCP | A |
| 6 | Definitions | `status_observed_at` = observation time of the row that supplied `status`; `:updated_at` not used | B |
| 7 | Definitions | durations computed at query time | B |
| 8 | Definitions | search-center normalization, match order, no geocoding | B |
| 9 | Search centers | `match_type`; exact first, then `parcel_count` descending | A, B |
| 10 | Properties search | `open_permits` required in MCP and agent schemas | B |
| 11 | Searches | `area_note` on every search response | B |
| 12 | Searches | radius basis for permit and text search | B |
| 13 | Text search | `q` at most 200 characters; normalization documented | B |
| 14 | Text search | `match` (`all`\|`any`, default `all`) | B |
| 15 | Text search | default `status_group` = all four | B |
| 16 | Text search | sort `bm25_score` desc, then `permit_id` | B |
| 17 | Schemas | `score` becomes `bm25_score` (number, not a confidence) | B |
| 18 | Schemas | `match_snippet` becomes `{field, text}` | B |
| 19 | Schemas | option (ii) removed from `owner_name`, `geo_id`, `source` and the change control | B |
| 20 | Schemas | `unpublished_source` on PermitSummary, PropertySummary (`geo_id`) and Owner (`owner_name`) | A |
| 21 | Schemas | `open_duration_as_of` | A |
| 22 | Schemas | permit `distance_miles` in search results | A |
| 23 | Meta | `/v1/meta.deploy` snapshot | A |
| 24 | Run | `sources[].sha256` | A |
| 25 | Chat | roles `user`\|`assistant`, string content, last message `user` | B |
| 26 | Chat | 20 messages, 4,000 characters each, 16,000 total; `413` | B |
| 27 | Chat | `session_id` opaque, at most 64 characters | B |
| 28 | Chat | `answer` Markdown subset with fixed citation markup | B |
| 29 | Chat | `outcome` | A |
| 30 | Chat | `assumptions[]` | A |
| 31 | Chat | `tool_calls[]` gains `id`, `status`, `total`, `returned` | A |
| 32 | Chat | `evidence[]` nullable `record_cid`, `kind`, `tool_call_id`, `unpublished_source` | B, A |
| 33 | Chat | `limitations` typed as `Limitation[]` | B |
| 34 | Chat | `run_id`, `manifest_cid`, `model_id`, `prompt_version`, `request_id` | A |
| 35 | MCP | frozen descriptions, schemas, `outputSchema`, annotations per tool | B |
| 36 | MCP | `limit` default 20, max 50 | B |
| 37 | MCP | `get_property` takes exactly one of `property_id` or `geo_id` | B |
| 38 | MCP | `instructions` carry citation rules, field semantics and the untrusted-text warning | B |

## README vs kit conflicts

| # | README | Kit | How both are satisfied |
| --- | --- | --- | --- |
| 1 | :7, :17, :48, :50, :84 DuckDB, no standing cost | OpenSearch in production and Docker OpenSearch locally, no other vector store | no vector leg in v1; SQL plus DuckDB full-text recorded as an exception; local replay with SAM over the same DuckDB build; any future embeddings go to OpenSearch with its cost accepted |
| 2 | :52, :107-113 agent access, agent demo, MCP | Chat SDK with Asana ingress, DynamoDB chat state, AgentCore Memory | HTTP chat and MCP are the ingress; stateless as the kit's Noop store behind its interface; the rest of the kit's agent stack applies |
| 3 | :11, :79, :105-106, :110-111 CIDs as identity, source-backed answers | stable ids, source hashes and versions, preserved citations | fields outside the lexicon served as source-backed, not CID-backed: `unpublished_source` and `deploy.reads`; the run's own capture makes text and CID one observation |
| 4 | :7, :48 no standing cost | LangSmith key in Secrets Manager | the secret's monthly charge listed in the cost table |
