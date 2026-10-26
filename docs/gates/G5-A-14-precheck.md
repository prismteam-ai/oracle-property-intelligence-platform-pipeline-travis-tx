---
gate: G5
artifact: specs/014-agent-and-mcp
artifact_version: spec.md + plan.md + tasks.md as of 2026-10-22 (post speckit-analyze fixes)
run_date: 2026-10-22
tool: Claude
verdict: PASS
---

# Gate G5 pre-check: A-14 tasks + low-level design

| # | Check | Result | Finding |
| --- | --- | --- | --- |
| C-01 | Clarified | PASS | `/speckit-clarify` run in Stage 2; no `[NEEDS CLARIFICATION]` markers remain in `spec.md`. Three further clarifications from round R2 (D-3 ×2, D-4) were added to the spec's Clarifications section after the design consults, same pattern. |
| C-02 | Phase structure | PASS | `tasks.md`: Phase 1 Setup → Phase 2 Foundational → Phase 3 [US1] → Phase 4 [US2] → Phase 5 (cross-surface agreement, this story's cross-cutting concern) → Phase Z. Matches the required Setup → Foundational → story phases → Polish/Phase-Z skeleton; the extra Phase 5 is the story's own AC-8 cross-surface requirement, not a deviation (same convention `013-explorer-and-pages/tasks.md` already uses for its own cross-cutting phases). |
| C-03 | Task format | PASS | Every task has a `T###` ID (`T001`–`T033`, with `a`-suffixed insertions `T005a`, `T010a`, `T011a`, `T018a` for tasks added during review), `[P]` where it shares no open file with another task, a `[US#]` story label on every story-phase task (none on Setup/Foundational/Polish, per the format rule), and an exact file path. |
| C-04 | Tests first | PASS (after fix) | Initial draft had Phase 3's `T019` (citations.ts) and `T022` (ask.ts) with no preceding unit test in that phase, and Phase 2's `T017` (auth.ts) with only a CDK-resource test (`T010`), not a function-level test. Fixed: added `T018a` (citations unit test) and `T010a` (`auth.ts` token-check unit test) in their phases' "Tests first" subsections, and reordered Phase 3 so `T020`/`T023` (which must fail until `agent.ask` exists) precede `T019`/`T021`/`T022`. Phase 4 was already test-first (`T024` before `T025`–`T028`). Phase 2's `T004`–`T010a` all precede `T011`–`T018`. |
| C-05 | Live verification last | PASS | `tasks.md` ends with `TZ01`–`TZ06`: reviewer agents (`alakazam`/`ash`/`oracle`/`donphan` + `/code-review medium`), deploy, Playwright + golden queries against the hosted URL/`/mcp` (never `localhost`, per `tests/agent/golden.json` and `A-14-mcp.spec.ts`'s design), `smeargle` on the AI tab + `/help/mcp`, the independent test, evidence/traceability/kit-usage. |
| C-06 | LLD complete | PASS | `plan.md` documents components (Project Structure tree with every new file and its owner), data flow (`data-model.md`'s `ResultEnvelope`, the six functions, `agent.ask` contract, the six MCP tools), integration points (`contracts/{agent-ask,mcp-tools}.md`), and test approach (fixture replay + golden grader + CDK assertions + hosted Playwright, per `quickstart.md`). |
| C-07 | Architecture conformance | PASS | `plan.md`'s Constitution Check table: all rows ✅, no deviation. Three items recorded in Complexity Tracking are accepted-risk/deferred items with stated reasons, not unjustified deviations (D-5's token-creation method, the `@modelcontextprotocol/sdk` version pin, and — narrowed by the analyze fix — the small `searchProperties`-vs-`exploreSearchSql` SQL reconciliation, now `T030`). |
| C-08 | Kit usage | PASS | `specs/014-agent-and-mcp/agent-design.md` exists with one verbatim answer per design agent (`alakazam`, `ash`, `oracle`, each under its own heading, word for word from their subagent reports) plus a Disagreements table. `plan.md`'s Kit Agent Ownership section cites it, names each builder's skills (`build-rag-systems`/`build-ai-agents`/`deploy-open-data-mcp`/`use-elephant-mcp`/`responsive-design-tests` + `apply-engineering-guidelines`), and lists the builder patterns that must appear in code with file paths. |
| C-09 | Coverage | PASS (after fix) | `speckit-analyze` found FR-012 (AI tab UI) had no implementation task — only `T023`'s contract-level stand-in. Fixed: added `T033` (deferred, blocked on A-13 merging) to wire the real AI tab, closing the gap. All 12 FRs now map to at least one task: FR-001/FR-004 → `T011`, `T011a`, `T021`; FR-002/FR-003 → `T019`, `T022`; FR-005 → `T022`, `T023`; FR-006/FR-007 → `T024`, `T025`; FR-008 → `T005`, `T011`; FR-009 → `T010a`, `T017`, `T025`; FR-010 → `TZ05`; FR-011 → `T029`, `T030`, `T032`; FR-012 → `T023` (stand-in now) + `T033` (real, deferred). |
| C-10 | Analyze | PASS (after fix) | `/speckit-analyze` found 1 CRITICAL (F1: `tasks.md` under-scoped the A-13 dependency — `listPermits`'s area resolution was also routed through A-13's `resolvePlace` in the design, which would have blocked nearly all of wave 2, not just `searchProperties`/`geocodePlace` as scheduled) and 1 HIGH (F2: FR-012 coverage gap, see C-09). Both fixed in `tasks.md` before this pre-check: F1's fix (verified directly by reading `gazetteer.lookup()` and A-13's `places.ts`) unblocks `geocodePlace`, `searchProperties` and `listPermits`'s area resolution to build now, on `gazetteer.lookup()`, narrowing the real A-13 dependency to one small SQL-reconciliation task (`T030`); F2's fix added `T033`. Re-running the report's checks after the fix finds no outstanding CRITICAL/HIGH. |

## Fix list

None outstanding — all findings from this pre-check and from `/speckit-analyze` were fixed before this report was written (C-04, C-09, C-10 above each record what was found and fixed).

## Verdict

**PASS.** 10 of 10 criteria pass.
