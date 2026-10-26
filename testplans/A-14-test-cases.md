---
id: QC-TC-A-14
type: test-cases
title: Answer roofing-lead questions through a source-backed agent and an MCP server
parent: [FEAT-A14, FEAT-A15]
story: stories/A-14-agent-and-mcp.md
spec: specs/014-agent-and-mcp/spec.md
owner: Heba Gaber         # QC Lead
status: Approved          # Draft → In Review → Approved
gate: G6
version: 0.1
created: 2026-10-22
runtime_url: "{RUNTIME_URL}"   # hosted CountyLensApi/Explore URL (CDK stack output) — never localhost
reviewed_code: "{sha}"
qc_signoff: true
---

# Test Cases: A-14 Answer roofing-lead questions through a source-backed agent and an MCP server

> Drafted with `developmentsupport-testcases` from the merged A-14/A-15 story's Given/When/Then ACs and `checks.md` § 7.1 golden queries, **not** from `tasks.md`. Every case runs against the **hosted** Explore · AI tab, the hosted `agent.ask` endpoint, or the hosted `/mcp` endpoint (`MCP_URL`, a `CountyLensApi` stack output) — never `localhost`. Save as `testplans/A-14-test-cases.md`.

## 1. Feature overview

A tRPC `agent.ask` procedure answers plain-language roofing-lead questions over the published Travis County records with citations, stated assumptions and missing-data callouts (D-10, D-11), and a TypeScript MCP server exposes the same data through six fixed, typed tools over Streamable HTTP (D-12). Both surfaces, and the Explore page, are thin adapters over the same `query-core` functions, so they must agree on which rows match the same question against the same published run (AC-8).

## 2. Requirement mapping

| Source | Reference | Covered by |
| --- | --- | --- |
| Acceptance criterion | AC-1 | A-14-TC-001 |
| Acceptance criterion | AC-2 | A-14-TC-002 |
| Acceptance criterion | AC-3 | A-14-TC-003, A-14-TC-004 |
| Acceptance criterion | AC-4 | A-14-TC-005, A-14-TC-006, A-14-TC-007 |
| Acceptance criterion | AC-5 | A-14-TC-NF-01 |
| Acceptance criterion | AC-6 | A-14-TC-013 |
| Acceptance criterion | AC-7 | A-14-TC-014 |
| Acceptance criterion | AC-8 | A-14-TC-015 |
| Acceptance criterion | AC-9 | A-14-TC-016, A-14-TC-017, A-14-TC-018 |
| Acceptance criterion | AC-10 | A-14-TC-019, A-14-TC-NF-02, A-14-TC-021 |
| Acceptance criterion | AC-11 | A-14-TC-022, A-14-TC-023, A-14-TC-024, A-14-TC-025 |
| Acceptance criterion | AC-12 | A-14-TC-029 |
| Functional requirement | FR-001 | A-14-TC-001, A-14-TC-026 |
| Functional requirement | FR-002 | A-14-TC-001, A-14-TC-002, A-14-TC-005, A-14-TC-006, A-14-TC-007 |
| Functional requirement | FR-003 | A-14-TC-003, A-14-TC-004 |
| Functional requirement | FR-004 | A-14-TC-002, A-14-TC-010 |
| Functional requirement | FR-005 | A-14-TC-013 |
| Functional requirement | FR-006 | A-14-TC-014 |
| Functional requirement | FR-007 | A-14-TC-015, A-14-TC-016, A-14-TC-018 |
| Functional requirement | FR-008 | A-14-TC-019 |
| Functional requirement | FR-009 | A-14-TC-022, A-14-TC-023, A-14-TC-024, A-14-TC-025 |
| Functional requirement | FR-010 | A-14-TC-029 |
| Functional requirement | FR-011 | A-14-TC-015 |
| Functional requirement | FR-012 | A-14-TC-001, A-14-TC-009 |
| NFR | NFR-001 | A-14-TC-NF-01, A-14-TC-013 |
| NFR | NFR-002 | A-14-TC-011 |
| NFR | NFR-003 | A-14-TC-014, A-14-TC-NF-02, A-14-TC-021 |
| NFR | NFR-004 | A-14-TC-022, A-14-TC-027 |

## 3. Assumptions

- The Playwright suite reads its own credentials/tokens from the environment (`MCP_TOKEN`, `AI_PROVIDER`, `RUNTIME_URL`, `MCP_URL`) — no token value is ever written into this document or into a test file.
- Golden queries G1–G6 are reproduced **word for word** from `assessment-guide/reference/checks.md` § 7.1; no paraphrasing.
- Until A-11 (full-county publish) merges, the agent/MCP run against whatever subset is already published (per spec.md "Assumptions"). The stalled-permit counts below are flagged with the date they were measured and must be re-verified once A-11 merges (story Merge notes, 2026-10-21).
- The demo area for A-13 (and reused for the UI AI-tab screenshots) is Austin city, 5 mi (`docs/evidence/A-13-open-permits.md`, decided 2026-10-22), because Pflugerville holds 0 properties on the partial (one-month) run. The golden queries themselves still use Pflugerville, Manor and Lakeway verbatim, per checks.md; AC-1/AC-3 results on the partial run may legitimately be empty until A-11 publishes the full county — that is the honest "no open permits" case under test (A-14-TC-003), not a defect.
- `donphan` is reachable as a kit subagent configured against the hosted `/mcp` endpoint for A-14-TC-029.

## 4. Scope

- **In scope:** the hosted Explore · AI tab (`agent.ask`), the hosted `/mcp` Streamable HTTP endpoint and its six tools, the tRPC proxy behind Help · MCP's "Try a tool", cross-surface agreement between agent/MCP/Explore.
- **Out of scope (per story):** streaming responses, AI-user sign-in, any free-form SQL tool, the kit Elephant MCP for Travis (not yet serving this county).

## 5. Test data

- Golden query centres: Pflugerville Census 2024 Gazetteer internal point (30.447765, −97.602116); Manor; Lakeway (partly outside Travis); Round Rock (partly outside Travis).
- Real permit numbers: `1982-012866 BP` (G5 BBB lookup example); stalled reroofs `2004-011296 BP`, `2018-111955 BP`, `2022-098180 BP` (A-14's 2026-10-19 measurement, 3 of 44 Austin reroofs — to be re-measured by Stage 0/at test-run time against the then-current run and recorded in `docs/evidence/A-14-agent.md`).
- County-wide stalled reroofs on 2026-10-19: 2,213 (dated figure, pending re-verification once A-11 merges — do not block this draft on it, per task instructions).
- Partial-run snapshot used for A-13 (interim, until A-11): run `travis-202609-permits-20261021t103516z`, manifest CID `bafkreiasycmsr2qdlxqcfg3yc2conpn3jxmohz7gs55hkseipplhpqsk5i` — 14 properties, 35 reroof permits (22 open, 13 closed, 0 stalled); Austin city 5 mi: 3 properties with roof ≥ 15 yrs, longest open permit 0.13 yrs (47 d).
- Invalid scope probe: ZIP `99999` (not a Travis ZIP, G6); unknown permit number `0000-000000 XX` (does not exist in the published data).
- Data snapshot to record at run time: the published run ID and `manifest_cid` actually live when each TC executes (manifest CID changes as A-11 publishes; record it in § 11 and in `docs/evidence/A-14-agent.md` / `A-14-mcp.md`, never hard-code it here).

## 6. Environment, risks and dependencies

- `RUNTIME_URL={hosted Explore URL}` (CountyLensApi/Amplify output) — Playwright's `playwright.config.ts` refuses a `RUNTIME_URL` containing `localhost` or `127.0.0.1`.
- `MCP_URL={hosted /mcp URL}` (CountyLensApi stack output) — read from env, never hard-coded.
- `MCP_TOKEN` — read from env by the Playwright request-fixture tests only; never logged, never committed, never placed in a case's literal text.
- `AI_PROVIDER` — `bedrock` (default, `eu.anthropic.claude-sonnet-4-6` in `eu-north-1`) or `gateway` (fallback); A-14-TC-011 runs the same suite against both without code changes.
- Known gap at draft time: A-11 (full-county publish) is `Draft`/blocked on A-07, so AC-1, AC-3, AC-5 and the AC-8 cross-check may show reduced-scale or empty results on the partial run; these are linked as gap cases in § 10 and are not defects by themselves.
- `donphan` must be independently configured to use **only** this MCP server's tools for A-14-TC-029, so its answer is not backed by any other data path.

## 7. Coverage matrix

| TC ID | Title | Priority | Tags | Type | Requirement(s) | Playwright test |
| --- | --- | --- | --- | --- | --- | --- |
| A-14-TC-001 | G1 — roofs > 15 yrs within 5 mi of Pflugerville | P1 | @smoke @demo | UI | AC-1, FR-001, FR-002 | `tests/e2e/agent.spec.ts › "A-14-TC-001 G1 roof age + radius"` |
| A-14-TC-002 | G2 — follow-up "that area", open permits + contractor | P1 | @smoke @demo | UI | AC-2, FR-002, FR-004 | `tests/e2e/agent.spec.ts › "A-14-TC-002 G2 follow-up context"` |
| A-14-TC-003 | No open roofing permits → stalled offered, honestly labelled | P1 | @negative @demo | UI | AC-3, FR-003 | `tests/e2e/agent.spec.ts › "A-14-TC-003 no-open-permits stalled offer"` |
| A-14-TC-004 | G6 — ZIP 99999 is out of scope, zero results | P1 | @negative | UI | AC-3, FR-003 | `tests/e2e/agent.spec.ts › "A-14-TC-004 G6 out-of-scope ZIP"` |
| A-14-TC-005 | G3 — open roofing permits > 5 yrs near Manor | P2 | @demo | UI | AC-4, FR-002 | `tests/e2e/agent.spec.ts › "A-14-TC-005 G3 Manor"` |
| A-14-TC-006 | G4 — Lakeway tenure 10+, owners outside the area | P2 | @demo | UI | AC-4, FR-002 | `tests/e2e/agent.spec.ts › "A-14-TC-006 G4 Lakeway"` |
| A-14-TC-007 | G5 — BBB rating for permit 1982-012866 BP | P2 | @demo | UI | AC-4, FR-002 | `tests/e2e/agent.spec.ts › "A-14-TC-007 G5 BBB lookup"` |
| A-14-TC-008 | Round Rock — partly outside Travis, centre stated | P2 | @edge | UI | AC-1, AC-2 | `tests/e2e/agent.spec.ts › "A-14-TC-008 Round Rock centering"` |
| A-14-TC-009 | Edit "How I read this" chip 5→3 yrs re-runs + updates citations | P1 | @edge | UI | FR-012 | `tests/e2e/agent.spec.ts › "A-14-TC-009 edit chip re-run"` |
| A-14-TC-010 | Session reaches 10 answered questions | P2 | @edge | UI | FR-004 | `tests/e2e/agent.spec.ts › "A-14-TC-010 ten-question limit"` |
| A-14-TC-011 | AI_PROVIDER=gateway — same answers, no code change | P3 | @edge @config | UI | NFR-002 | `tests/e2e/agent.spec.ts › "A-14-TC-011 provider switch gateway"` |
| A-14-TC-012 | Round Rock ambiguity resolves to one centre (dup of TC-008 check) | — | — | — | — | folded into A-14-TC-008 |
| A-14-TC-013 | Throttled / budget-paused / timed-out outcomes, never a 5xx | P1 | @negative @nfr | UI | AC-6, FR-005, NFR-001 | `tests/e2e/agent.spec.ts › "A-14-TC-013 typed error outcomes"` |
| A-14-TC-014 | MCP tools/list returns exactly six tools, < 500 ms | P1 | @smoke @mcp | API | AC-7, FR-006, NFR-003 | `tests/e2e/mcp.spec.ts › "A-14-TC-014 tools list"` |
| A-14-TC-015 | AC-8 cross-check — agent, search_properties, Explore agree | P1 | @smoke @mcp @demo | API | AC-8, FR-007 | `tests/e2e/mcp.spec.ts › "A-14-TC-015 cross-surface property_cid parity"` |
| A-14-TC-016 | list_permits — stalled reroofs sorted by open duration | P1 | @mcp | API | AC-9, FR-007 | `tests/e2e/mcp.spec.ts › "A-14-TC-016 list_permits stalled sort"` |
| A-14-TC-017 | list_permits — no status_raw carrier → "stalled" alone | P2 | @mcp @negative | API | AC-9 | `tests/e2e/mcp.spec.ts › "A-14-TC-017 status_raw missing carrier"` |
| A-14-TC-018 | get_coverage returns manifest coverage unchanged | P2 | @mcp | API | AC-9, FR-007 | `tests/e2e/mcp.spec.ts › "A-14-TC-018 get_coverage passthrough"` |
| A-14-TC-019 | >1000-row query → truncated:true + total | P1 | @mcp @scale | API | AC-10, FR-008 | `tests/e2e/mcp.spec.ts › "A-14-TC-019 1000-row cap"` |
| A-14-TC-020 | donphan transcript answered via MCP only (dup ref) | — | — | — | — | folded into A-14-TC-029 |
| A-14-TC-021 | >burst-10 → some calls answer 429 | P1 | @mcp @nfr | API | AC-10, NFR-003 | `tests/e2e/mcp.spec.ts › "A-14-TC-021 burst rate limit"` |
| A-14-TC-022 | No bearer token → 401, nothing runs | P1 | @mcp @security | API | AC-11, FR-009, NFR-004 | `tests/e2e/mcp.spec.ts › "A-14-TC-022 no-token 401"` |
| A-14-TC-023 | Wrong bearer token → 401, nothing runs | P1 | @mcp @security | API | AC-11, FR-009 | `tests/e2e/mcp.spec.ts › "A-14-TC-023 wrong-token 401"` |
| A-14-TC-024 | Unknown permit number → not_found, no fabrication | P2 | @mcp @negative | API | AC-11, FR-009 | `tests/e2e/mcp.spec.ts › "A-14-TC-024 unknown permit not_found"` |
| A-14-TC-025 | Non-Travis ZIP via MCP → out_of_scope | P2 | @mcp @negative | API | AC-11, FR-009 | `tests/e2e/mcp.spec.ts › "A-14-TC-025 non-Travis ZIP out_of_scope"` |
| A-14-TC-026 | Free-form SQL argument → Zod rejects | P1 | @mcp @security @negative | API | AC-11 edge, FR-001 | `tests/e2e/mcp.spec.ts › "A-14-TC-026 free-form SQL rejected"` |
| A-14-TC-027 | Disallowed browser Origin → rejected; Help "Try a tool" still works via proxy | P2 | @mcp @security @edge | API+UI | FR-009, NFR-004 | `tests/e2e/mcp.spec.ts › "A-14-TC-027 origin allowlist"` and `tests/e2e/help-mcp.spec.ts › "A-14-TC-027b try-a-tool proxy"` |
| A-14-TC-028 | SSM token missing at cold start → fail fast, no default token | P3 | @mcp @ops | Log | FR-009, NFR-004 | manual: CloudWatch log check (not Playwright) |
| A-14-TC-029 | donphan answers a Lakeway ownership question through MCP only | P1 | @mcp @demo | Agent | AC-12, FR-010 | `tests/e2e/mcp.spec.ts › "A-14-TC-029 donphan through MCP"` |
| A-14-TC-NF-01 | Agent scale: p95 < 20 s, ≤ 6 tool steps, ≤ 3 model calls, ≤ 1,500 output tokens, ≤ 1,000 rows/tool call | P2 | @perf | UI/API | AC-5, NFR-001 | `tests/e2e/agent.spec.ts › "A-14-TC-NF-01 G1-G6 scale budget"` |
| A-14-TC-NF-02 | MCP p95: tools/call < 3 s over 20 calls; sustains 5 rps burst 10 | P2 | @perf | API | AC-10, NFR-003 | `tests/e2e/mcp.spec.ts › "A-14-TC-NF-02 tools/call p95"` |

## 8. Functional test cases

### A-14-TC-001: G1 — roofs > 15 yrs within 5 mi of Pflugerville (happy path)

- **Priority / tags:** P1 · `@smoke @demo`
- **Maps to:** AC-1, FR-001, FR-002 · demo line D-10
- **Preconditions:** Hosted agent reachable; published run available (partial or full).
- **Test data:** Prompt (word for word, checks.md § 7.1 G1): "Which properties in Travis County within five miles of Pflugerville have roofs older than 15 years?"
- **Steps:**
  1. **Open** `{RUNTIME_URL}/tx/travis/explore` in a private window. → Explore shell loads; "AI" tab visible.
  2. **Click** the "AI" tab. → AI chat panel opens with an input box and the suggested-prompts list.
  3. **Type** the G1 prompt above into the chat input and **submit**. → "Working…" state shows immediately (per `ExploreQ-aiworking.dc.html`).
  4. **Wait** for the final answer. → Answer text states the centre point "Pflugerville city, Census 2024 Gazetteer, 30.447765, −97.602116", radius "5 mi" and threshold "roof ≥ 15 whole years" (per D-3, round R2, 2026-10-22: AC-1's "> 15" and AC-8's "≥ 15" are reconciled to one inclusive, whole-year threshold).
  5. **Verify** the "How I read this" chips show "Centre: Pflugerville (Census 2024 Gazetteer)", "Radius: 5 mi", "Roof age: ≥ 15 whole years".
  6. **Verify** each returned row card shows a real `property_cid`, a roof-age basis (e.g. "built 2008, 18 yrs" or similar) and a source link.
  7. **Verify** (API cross-check) an independent `query-core` SQL run with the same filter returns a set whose intersection with the agent's returned `property_cid`s is ≥ 80% of the agent's top-N (recall ≥ 80%).
- **Expected result:** On a run with matching properties, N real Travis County `property_cid`s are returned, each with roof-age basis, source and the stated centre/radius/threshold; recall ≥ 80% against the independent re-check. On the current partial (pre-A-11) run, if no properties fall in-radius, the answer states that honestly (see A-14-TC-003 for the no-match sub-case) rather than inventing rows.

### A-14-TC-002: G2 — follow-up "that area", open permits + contractor (happy path)

- **Priority / tags:** P1 · `@smoke @demo`
- **Maps to:** AC-2, FR-002, FR-004 · demo line D-11
- **Preconditions:** A-14-TC-001 has just run in the same session (G1 answered, "that area" = Pflugerville 5 mi).
- **Test data:** Prompt (word for word, G2): "Which properties near that area have open roofing permits that have been open for many years, and who is the listed contractor?"
- **Steps:**
  1. **Continue** in the same AI chat session from A-14-TC-001 (do not reload).
  2. **Type** the G2 prompt and **submit**. → "Working…" state.
  3. **Verify** the answer explicitly reuses "that area" as Pflugerville 5 mi (no re-prompt for the centre).
  4. **Verify** the answer states its meaning of "many years" as "≥ 5 years".
  5. **Verify** permits are listed sorted by open duration, longest first, each with contractor "as printed on permit" (or "not printed" if absent) and that name's identity-resolution state.
  6. **Verify** each permit shows a BBB rating or the exact text "not available" with a stated reason.
- **Expected result:** Answer keeps context from the prior turn, states the ≥ 5 yr threshold, lists permits longest-open-first with contractor name/identity state and BBB rating or an honest "not available" reason — no invented contractor or rating.

### A-14-TC-003: No open roofing permits in radius → stalled offered, honestly labelled (missing data)

- **Priority / tags:** P1 · `@negative @demo`
- **Maps to:** AC-3, FR-003
- **Preconditions:** The current published run's Pflugerville/Austin 5 mi radius has 0 open reroof permits (true on both the 2026-10-19 Austin dataset and the partial run per `docs/evidence/A-13-open-permits.md`).
- **Test data:** Same session, G2 prompt from A-14-TC-002.
- **Steps:**
  1. **Open** `{RUNTIME_URL}/tx/travis/explore`, go to the AI tab, ask G1 then G2 (as in TC-001/002) against a run where 0 reroof permits are open in the radius.
  2. **Verify** the answer text states plainly: "no open roofing permits were found in that radius".
  3. **Verify** the answer then offers the stalled permits, each labelled exactly `stalled · source says Expired` when a `status_raw` carrier exists, for example `2004-011296 BP`, `2018-111955 BP`, `2022-098180 BP` (re-measured at run time against the then-current count, not assumed to be 3).
  4. **Verify** missing-data items are listed explicitly, e.g. "contractor not printed" on permits lacking one, and "BBB status not available" where applicable.
- **Expected result:** No fabricated "open" permits; the exact sentence "no open roofing permits were found in that radius" (or equivalent honest phrasing fixed in plan.md UX copy) appears; stalled permits are explicitly labelled `stalled`; missing data is named, not silently omitted.

### A-14-TC-004: G6 — ZIP 99999 is out of scope, zero results (negative)

- **Priority / tags:** P1 · `@negative`
- **Maps to:** AC-3, FR-003
- **Test data:** Prompt (word for word, G6): "How many properties have roofs older than 40 years in ZIP 99999?"
- **Steps:**
  1. **Open** `{RUNTIME_URL}/tx/travis/explore`, go to the AI tab (fresh session).
  2. **Type** the G6 prompt and **submit**.
  3. **Verify** the answer returns zero results.
  4. **Verify** the answer states plainly that ZIP 99999 is outside Travis County / not a valid Travis ZIP.
- **Expected result:** Zero rows, a plain "not in Travis County" / "scope is invalid" statement, no invented count and no property rows.

### A-14-TC-005: G3 — open roofing permits > 5 yrs near Manor

- **Priority / tags:** P2 · `@demo`
- **Maps to:** AC-4, FR-002
- **Test data:** Prompt (word for word, G3): "Show me open roofing permits older than five years within five miles of Manor"
- **Steps:**
  1. **Open** `{RUNTIME_URL}/tx/travis/explore`, AI tab, fresh session.
  2. **Type** the G3 prompt and **submit**.
  3. **Verify** the centre used is Manor (Census 2024 Gazetteer) with its source stated.
  4. **Verify** the exact threshold "> 5 years" is applied and permits are sorted by open duration.
- **Expected result:** Permits matching the exact 5 mi / > 5 yr filter, sorted longest-open-first, each with source and run citation; honest empty state if none exist on the current run.

### A-14-TC-006: G4 — Lakeway tenure 10+, owners outside the area

- **Priority / tags:** P2 · `@demo`
- **Maps to:** AC-4, FR-002
- **Test data:** Prompt (word for word, G4): "Which homes near Lakeway haven't changed owners in 10+ years and have owners outside the area?"
- **Steps:**
  1. **Open** `{RUNTIME_URL}/tx/travis/explore`, AI tab, fresh session.
  2. **Type** the G4 prompt and **submit**.
  3. **Verify** the tenure ≥ 10 years filter is applied and returns real matches (or an honest `no_match`/`field_not_published` if tenure itself is unknown on every candidate row).
  4. **Verify** the owner-outside-the-area part of the question is answered honestly as "can't tell — owner mailing address is not in the published export" (`field_not_published`, `not_in_export`), per D-3 (round R2, 2026-10-22): the owner mailing ZIP is a genuine data-contract gap (`docs/decisions/0002-lexicon-carriers.md`), not something this feature can derive — the answer must never claim to have filtered on it.
  5. **Verify** Lakeway's partly-outside-Travis geometry is handled: results are limited to the Travis County portion, and the answer says so.
- **Expected result:** Real tenure-filtered matches (or an honest no-match), an explicit "can't tell, not published" statement for the owner-outside-area part citing the specific gap, and a stated Travis-only limitation. A combined positive match on both filters is **not** the expected result in v1 and must not be reported as a pass.

### A-14-TC-007: G5 — BBB rating for permit 1982-012866 BP

- **Priority / tags:** P2 · `@demo`
- **Maps to:** AC-4, FR-002
- **Test data:** Prompt (word for word, G5, with the real permit number): "What's the BBB rating of the contractor on permit 1982-012866 BP?"
- **Steps:**
  1. **Open** `{RUNTIME_URL}/tx/travis/explore`, AI tab, fresh session.
  2. **Type** the G5 prompt and **submit**.
  3. **Verify** the answer identifies the exact permit `1982-012866 BP` and its printed contractor.
  4. **Verify** the answer either cites the BBB source (URL + captured date) or states plainly why the rating is missing (e.g. "contractor name not resolvable to a BBB listing").
- **Expected result:** Exact permit lookup, a cited BBB source or an honest, specific missing-data reason — never a guessed rating.

### A-14-TC-008: Round Rock — partly outside Travis, centre stated (edge case)

- **Priority / tags:** P2 · `@edge`
- **Maps to:** AC-1, AC-2 (edge case: ambiguous/partly-outside place)
- **Test data:** Prompt: "Which properties within five miles of Round Rock have roofs older than 15 years?"
- **Steps:**
  1. **Open** `{RUNTIME_URL}/tx/travis/explore`, AI tab, fresh session.
  2. **Type** the Round Rock prompt and **submit**.
  3. **Verify** the answer states which Round Rock centre point it used (its gazetteer source and coordinates).
  4. **Verify** the answer states that results are limited to the Travis County portion of the 5 mi radius (Round Rock spans Travis and Williamson counties).
- **Expected result:** One stated centre, explicit "limited to Travis County" caveat, no Williamson County properties returned.

### A-14-TC-009: Edit "How I read this" chip 5 → 3 yrs re-runs and updates citations

- **Priority / tags:** P1 · `@edge`
- **Maps to:** FR-012 (edge case from story)
- **Preconditions:** A G2-style answer is on screen with a "many years ≥ 5" chip visible.
- **Steps:**
  1. **Open** `{RUNTIME_URL}/tx/travis/explore`, AI tab, ask G1 then G2 (as TC-001/002).
  2. **Click** the "≥ 5 yrs" chip in "How I read this".
  3. **Edit** the value to `3` and **confirm**.
  4. **Verify** the panel re-enters "Working…" then shows a new answer using the 3-year threshold.
  5. **Verify** the citation list (`matches[]` linked rows) updates to reflect the new, wider permit set (any permit open ≥ 3 yrs now included, not just ≥ 5).
- **Expected result:** Re-run uses the edited threshold; citations change to match the new result set; no stale citations from the 5-year answer remain.

### A-14-TC-010: Session reaches 10 answered questions

- **Priority / tags:** P2 · `@edge`
- **Maps to:** FR-004 (edge case from story, item #66: only `answered` counts)
- **Steps:**
  1. **Open** `{RUNTIME_URL}/tx/travis/explore`, AI tab, fresh session.
  2. **Ask** 9 distinct questions that each complete with outcome `answered`, checking the counter after each: "n of 10 AI questions left" decrements by exactly 1 per **answered** question.
  3. **Ask** a 10th question that is `throttled`, `paused` or `timed_out` (not `answered`) and **verify** the counter does not decrement for it.
  4. **Ask** a question that completes `answered` to reach the 10th answered question.
  5. **Verify** the UI shows "0 of 10 AI questions left".
  6. **Ask** an 11th question. → **Verify** it is rejected/blocked with a limit-reached message (per `ExploreQ-ailimit.dc.html`), not sent to the model.
- **Expected result:** The counter decrements only on `answered` outcomes; reaching 0 blocks further questions with a clear limit message.

### A-14-TC-011: AI_PROVIDER=gateway — same answers, no code change (edge case)

- **Priority / tags:** P3 · `@edge @config`
- **Maps to:** NFR-002 (edge case from story)
- **Preconditions:** Two otherwise-identical deployments/environment configs differing only in `AI_PROVIDER` (`bedrock` vs `gateway`), or one environment where the setting is switched and redeployed with no source change.
- **Steps:**
  1. **Run** A-14-TC-001 (G1) against the `bedrock` deployment. Record the answer's structure (fields present: `answer`, `how`, `steps[]`, `matches[]`, `query`, `missing[]`, `outcome`).
  2. **Run** A-14-TC-001 (G1) against the `gateway` deployment.
  3. **Verify** both responses have the identical field shape and both return real, cited properties with no visible behavior difference (same UI states, same error-handling paths).
  4. **Verify** (code check, not Playwright) no application source file branches on provider beyond `getModel()`'s `AI_PROVIDER` switch — a `git diff` between the two deployed shas shows no code difference, only config.
- **Expected result:** Structurally identical, source-backed answers from both providers; switching provider is a config change only.

### A-14-TC-013: Throttled / budget-paused / timed-out outcomes, never a 5xx (NFR + error)

- **Priority / tags:** P1 · `@negative @nfr`
- **Maps to:** AC-6, FR-005, NFR-001
- **Test data:** Three forced conditions, exercised in a staging/test configuration that can simulate each (documented in `docs/evidence/A-14-agent.md`): (a) Bedrock request-rate exceeded (> 10 req/min), (b) the $3/day budget alarm already tripped, (c) a question engineered to exceed 23 s server-side.
- **Steps:**
  1. **Open** `{RUNTIME_URL}/tx/travis/explore`, AI tab.
  2. **Trigger condition (a)** by firing concurrent requests past the provider's rate limit. **Verify** the HTTP response status is in the 2xx/4xx range (never 5xx) and the body's `outcome` field is exactly `throttled`, with message text including "Try again".
  3. **Reset**, then **trigger condition (b)** (simulate the budget alarm state). **Verify** `outcome` is exactly `paused`, never 5xx.
  4. **Reset**, then **trigger condition (c)**. **Verify** the client aborts by 25 s, the response `outcome` is exactly `timed_out`, the UI shows "Took too long" with "Try again" and "Use Filters instead" actions, and no partial/incomplete answer is shown as if it were final.
- **Expected result:** All three paths return a typed `outcome` (`throttled` | `paused` | `timed_out`) with the documented UI message and actions; HTTP status is never 5xx; no partial answer is ever presented as complete.

### A-14-TC-014: MCP tools/list returns exactly six tools, < 500 ms (happy path)

- **Priority / tags:** P1 · `@smoke @mcp`
- **Maps to:** AC-7, FR-006, NFR-003
- **Preconditions:** Valid `MCP_TOKEN` read from env.
- **Steps:**
  1. **Send** `POST {MCP_URL}` with method `tools/list` and header `Authorization: Bearer ${MCP_TOKEN}` (token from env, never literal in the test file).
  2. **Measure** round-trip time.
  3. **Verify** the response lists exactly six tools: `search_properties`, `list_permits`, `get_property`, `get_coverage`, `list_runs`, `get_schema`.
  4. **Verify** each tool's input schema uses AD-07 column names (e.g. `roof_age_years`, `status_class`, `property_cid`) and is Zod-derived (`$schema`/`type` present, matching the Zod-to-JSON-Schema shape).
- **Expected result:** Exactly six tools, correct field names, response time < 500 ms.

### A-14-TC-015: AC-8 cross-check — agent, search_properties and Explore agree (happy path)

- **Priority / tags:** P1 · `@smoke @mcp @demo`
- **Maps to:** AC-8, FR-007
- **Test data:** Same question/run for all three surfaces: Pflugerville (or the demo area), 5 mi, roof ≥ 15 yrs; a single published run ID held constant across all three calls.
- **Steps:**
  1. **Capture** the `property_cid` set from A-14-TC-001's agent answer (G1) for a fixed run.
  2. **Send** `POST {MCP_URL}` `tools/call` for `search_properties` with the equivalent area/radius/roof-age arguments, same run.
  3. **Open** `{RUNTIME_URL}/tx/travis/explore?place=pflugerville&r=5&roof=15` (or the demo-area equivalent) and **capture** the Explore page's result `property_cid`s for the same run.
  4. **Verify** all three sets of `property_cid`s are identical (set equality), not merely overlapping.
  5. **Verify** the MCP result additionally carries `source_url`, `captured_at`, `table_cid`, `run_id`, `manifest_cid` for each row.
- **Expected result:** Exact `property_cid` parity across agent, MCP `search_properties` and Explore for the same question and run; MCP rows carry full provenance. Any mismatch is a defect per the story's edge-case rule, not an acceptable variance.

### A-14-TC-016: list_permits — stalled reroofs sorted by open duration

- **Priority / tags:** P1 · `@mcp`
- **Maps to:** AC-9, FR-007
- **Steps:**
  1. **Send** `tools/call` for `list_permits` with `area` = the demo area, `status_class` = `["open", "stalled"]`.
  2. **Verify** the result includes stalled reroofs (e.g. `2004-011296 BP` on a run where it exists) with `status_class = "stalled"`.
  3. **Verify** each stalled row with a `status_raw` carrier shows `status_raw = "Expired"`.
  4. **Verify** rows are sorted by `open_days` descending (longest open first).
- **Expected result:** Correctly classified, provenance-carrying, duration-sorted permit rows; stalled rows show both the plain label and the source's own status word when available.

### A-14-TC-017: list_permits — no status_raw carrier → "stalled" alone (missing-data edge case)

- **Priority / tags:** P2 · `@mcp @negative`
- **Maps to:** AC-9 (explicit "no status_raw carrier" case)
- **Preconditions:** At least one stalled permit whose source `improvement_status` has no recognizable carrier for "Expired" (per A-02 AC-1).
- **Steps:**
  1. **Send** `tools/call` for `list_permits` with `status_class = "stalled"` against a run/area containing such a permit.
  2. **Verify** that row's `status_class` is `"stalled"` and `status_raw` is absent/null (not fabricated as `"Expired"`).
  3. **Verify** the field is simply omitted or explicitly null — never defaulted to a guessed source string.
- **Expected result:** `status_class: "stalled"` with no `status_raw` value when the source has no carrier; no invented source text.

### A-14-TC-018: get_coverage returns manifest coverage unchanged

- **Priority / tags:** P2 · `@mcp`
- **Maps to:** AC-9, FR-007
- **Steps:**
  1. **Send** `tools/call` for `get_coverage` with the current `run_id`.
  2. **Fetch** the same run's published `manifest.json` `coverage` section directly (via its CID/gateway).
  3. **Verify** the two are byte-for-byte/field-for-field identical (no recomputation, no rounding difference).
- **Expected result:** `get_coverage`'s output equals the manifest's `coverage` section exactly.

### A-14-TC-019: >1000-row query → truncated:true + total (scale)

- **Priority / tags:** P1 · `@mcp @scale`
- **Maps to:** AC-10, FR-008
- **Test data:** County-wide stalled reroofs query (2,213 on 2026-10-19 county-wide — re-verify the live total at test-run time once A-11 is merged; on the partial run, substitute any filter that legitimately exceeds 1,000 rows, or note as not-yet-reproducible and link under § 10 until A-11 merges).
- **Steps:**
  1. **Send** `tools/call` for `list_permits` with `status_class = "stalled"` and no area filter (county-wide).
  2. **Verify** the response contains at most 1,000 rows.
  3. **Verify** `truncated: true` and a `total` field with the true full count (e.g. 2,213, re-verified at run time).
- **Expected result:** ≤ 1,000 rows returned, `truncated: true`, accurate `total` reflecting the real county-wide count on the run tested.

### A-14-TC-021: >burst-10 → some calls answer 429 (NFR/edge)

- **Priority / tags:** P1 · `@mcp @nfr`
- **Maps to:** AC-10, NFR-003
- **Steps:**
  1. **Send** 15 concurrent `tools/call` requests to `get_schema` (a lightweight tool) within a 1-second window.
  2. **Verify** at least 5 of the 15 responses are HTTP `429`.
  3. **Verify** the remaining responses (up to the burst-10 allowance) succeed normally.
  4. **Wait** 2 seconds and **retry** one call. → **Verify** it now succeeds (rate window has reset).
- **Expected result:** The route sustains 5 rps with burst 10 and returns `429` (never a 5xx or a hang) for calls beyond that; the limit recovers after the window.

### A-14-TC-022: No bearer token → 401, nothing runs (security negative)

- **Priority / tags:** P1 · `@mcp @security`
- **Maps to:** AC-11, FR-009, NFR-004
- **Steps:**
  1. **Send** `POST {MCP_URL}` `tools/call` for `get_schema` with **no** `Authorization` header.
  2. **Verify** the response is HTTP `401`.
  3. **Verify** (via CloudWatch log check, no PII/secret in the log line) that the tool was never invoked — no downstream query ran.
- **Expected result:** 401, no tool execution, no token value appears anywhere in the response or logs.

### A-14-TC-023: Wrong bearer token → 401, nothing runs (security negative)

- **Priority / tags:** P1 · `@mcp @security`
- **Maps to:** AC-11, FR-009
- **Steps:**
  1. **Send** `POST {MCP_URL}` `tools/call` for `get_schema` with `Authorization: Bearer wrong-token-value-not-from-env`.
  2. **Verify** the response is HTTP `401`.
- **Expected result:** 401; identical behavior to the no-token case; the real token (from env) is never echoed in the error response.

### A-14-TC-024: Unknown permit number → not_found, no fabrication

- **Priority / tags:** P2 · `@mcp @negative`
- **Maps to:** AC-11, FR-009
- **Test data:** Permit number `0000-000000 XX` (does not exist in the published data).
- **Steps:**
  1. **Send** `tools/call` for `get_property` or the permit-lookup path with permit `0000-000000 XX`.
  2. **Verify** the response is an empty result with reason `not_found` (HTTP 200 with a typed empty payload, or a documented 404 — whichever the implementation defines; it must not be a 2xx with invented data).
- **Expected result:** Empty result, `reason: "not_found"`, no fabricated permit row.

### A-14-TC-025: Non-Travis ZIP via MCP → out_of_scope

- **Priority / tags:** P2 · `@mcp @negative`
- **Maps to:** AC-11, FR-009
- **Test data:** ZIP `99999` (same as G6).
- **Steps:**
  1. **Send** `tools/call` for `search_properties` with a ZIP/area argument of `99999`.
  2. **Verify** the response is an empty result with reason `out_of_scope`.
- **Expected result:** Empty result, `reason: "out_of_scope"`, no invented Travis property returned for a non-Travis ZIP.

### A-14-TC-026: Free-form SQL argument → Zod rejects (security negative)

- **Priority / tags:** P1 · `@mcp @security @negative`
- **Maps to:** AC-11 edge case, FR-001, P0-13
- **Test data:** `{"area": "Pflugerville; DROP TABLE property; --", "sql": "SELECT * FROM property"}` as a `search_properties` argument, and a direct attempt to pass a `sql` field to any tool.
- **Steps:**
  1. **Send** `tools/call` for `search_properties` with an argument object containing an extra `sql` field holding a raw SQL string.
  2. **Verify** the call is rejected by Zod schema validation (HTTP 400 or a typed `invalid_params` MCP error) before any query executes.
  3. **Verify** no SQL tool exists at all: **send** `tools/list` and **confirm** no tool named `query`, `sql`, or similar is present (P0-13).
- **Expected result:** The malformed/SQL-bearing argument is rejected at the schema layer; the six-tool list never includes a free-form query tool.

### A-14-TC-027: Disallowed browser Origin → rejected; Help "Try a tool" still works via proxy

- **Priority / tags:** P2 · `@mcp @security @edge`
- **Maps to:** FR-009, NFR-004
- **Steps:**
  1. **From a script/fetch** with `Origin: https://not-allowed.example.com`, **send** a direct browser-style request to `{MCP_URL}` `tools/list`.
  2. **Verify** the request is rejected (CORS preflight failure or an explicit origin-check 403).
  3. **Open** `{RUNTIME_URL}/help/mcp` in a private window (the real browser origin, on the allowlist for the proxy route only).
  4. **Click** "Try a tool" and **select** `search_properties` with a sample area.
  5. **Verify** a live result returns (real rows, not the static "not available" text), and **inspect** the browser's Network tab request to the tRPC proxy endpoint to **verify** no `Authorization` header or token value is visible client-side (the proxy adds the token server-side).
- **Expected result:** Direct disallowed-origin calls to `/mcp` are rejected; the Help page's own "Try a tool" works end-to-end through the server-side proxy with the token never exposed in the browser.

### A-14-TC-028: SSM token missing at cold start → fail fast (ops check)

- **Priority / tags:** P3 · `@mcp @ops`
- **Maps to:** FR-009, NFR-004
- **Preconditions:** A test/staging deployment where the SSM SecureString parameter can be deliberately removed before a cold Lambda start (not performed against the production hosted endpoint).
- **Steps:**
  1. **Remove** the SSM parameter in a disposable staging stack.
  2. **Force** a cold start (e.g. update Lambda config or redeploy) and **send** any `tools/call`.
  3. **Verify** CloudWatch Logs show a clear failure log line (e.g. "MCP_TOKEN parameter not found — refusing to start") within the first invocation.
  4. **Verify** the call fails (5xx or connection refused is acceptable here, since this is a startup fault, not a normal request path) rather than succeeding with a default/no-auth fallback.
- **Expected result:** No default token is ever used; the server fails closed and loudly, visible in logs. Evidence: the log line screenshot/export in `docs/evidence/A-14-mcp.md`.

### A-14-TC-029: donphan answers a Lakeway ownership question through MCP only

- **Priority / tags:** P1 · `@mcp @demo`
- **Maps to:** AC-12, FR-010
- **Steps:**
  1. **Configure** the `soofi-xyz-team-kit:donphan` kit agent with the hosted `MCP_URL` and `MCP_TOKEN` as its only data-access tool set (no other data path available to it).
  2. **Ask** donphan: "Which properties near Lakeway have owners outside the area?"
  3. **Verify** donphan's answer cites real `property_cid`s.
  4. **Verify** the full transcript (prompt, tool calls, tool results, final answer) is saved as evidence to `docs/evidence/A-14-mcp.md`.
- **Expected result:** A correct, cited answer produced using only the MCP tools, with the transcript captured as evidence.

## 9. Edge cases

- Round Rock (partly outside Travis) → centre stated, Travis-only results (A-14-TC-008).
- "How I read this" chip edited 5 → 3 yrs → re-run, citations update (A-14-TC-009).
- Session reaches 10 answered questions → counter hits 0; only `answered` outcomes count (A-14-TC-010).
- `AI_PROVIDER` switched bedrock ↔ gateway → identical answer shape, no code change (A-14-TC-011).
- Disallowed browser `Origin` → rejected; Help "Try a tool" still works via the server-side proxy (A-14-TC-027).
- SSM token missing at cold start → fails fast, no default token (A-14-TC-028).
- Free-form SQL argument → Zod rejects, and no SQL tool exists at all (A-14-TC-026).
- Agent vs MCP vs Explore disagree on `property_cid`s for the same question/run → defect, asserted never to happen (A-14-TC-015).

## 10. Gap-linked cases (expected to fail until fixed)

| TC ID | Asserts | Gap | Defect |
| --- | --- | --- | --- |
| A-14-TC-001 | Non-empty, real property results for G1 at full-county scale | GAP-A11 (A-11 full-county publish not yet merged; partial run may return 0 properties in Pflugerville, see `docs/evidence/A-13-open-permits.md`) | — (not a defect on the partial run; re-check after A-11) |
| A-14-TC-019 | 2,213-row county-wide stalled total (or the then-current count) is reproducible | GAP-A11 (county-wide stalled total not available until A-11 publishes the full permit history) | — |
| A-14-TC-003 | Stalled count matches a single, re-measured figure (not the conflicting A-14 "3" vs A-15 "18") | GAP-A14-A15-MERGE (Stage 0 re-measurement required per story Merge notes 2026-10-21) | — |

## 11. Execution log (filled in Phase 5)

| TC ID | Run date | Build (sha) | Result | Evidence | Defect |
| --- | --- | --- | --- | --- | --- |
| A-14-TC-001 | {date} | `{sha}` | — | `docs/evidence/A-14-agent.md` | — |

---

## Gate G6: Test Case Approval

| # | Criterion | Status |
| --- | --- | --- |
| G6-1 | Every AC and every FR maps to at least one TC (§ 2 and § 7) | ☑ |
| G6-2 | Happy, negative, edge and missing-data paths covered | ☑ |
| G6-3 | NFRs have test cases with measurable pass criteria | ☑ |
| G6-4 | Every case is a complete sequence starting from the hosted URL (or the hosted `/mcp` endpoint for API cases) | ☑ |
| G6-5 | Negative cases state the exact message or rejection behavior | ☑ |
| G6-6 | Test data and environment documented, with real records | ☑ |
| G6-7 | Every TC traces to the story and a requirement | ☑ |
| G6-8 | AI pre-check (`developmentsupport-g6-precheck`): PASS | ☑ See `docs/gates/G6-A-14-precheck.md` |

**Decision:** ☑ Approved ☐ Returned, reason: {…} · 2026-10-22
