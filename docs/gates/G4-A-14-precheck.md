---
gate: G4
artifact: stories/A-14-agent-and-mcp.md
artifact_version: merged 2026-10-21 (A-14 + A-15)
run_date: 2026-10-22
tool: Claude
verdict: PASS
---

# Gate G4 pre-check: A-14 Answer roofing-lead questions through a source-backed agent and an MCP server

| # | Check | Result | Finding |
| --- | --- | --- | --- |
| C-01 | Front matter | PASS | id, parent FEAT (FEAT-A14, FEAT-A15), vision, ard, eval_point (A6), priority, moscow, branch, depends_on, status all filled. `agents.design` = `[alakazam, ash, oracle]`, `agents.builder` = `[alakazam, ash, oracle]`, `agents.reviewers` = `[alakazam, ash, oracle, donphan]`, `agents.verify` and `skills` all match AGENT-MAP.md § 4 row "A-14 Agent + MCP" (line 359) exactly. |
| C-02 | User story form | PASS | "As a CRM developer (or the CRM's agent, or any MCP client), I want … so that …" present; independent test stated (G1–G6 Vitest against the deployed `agent.ask`, MCP Inspector on the hosted `/mcp`, `donphan` transcript). |
| C-03 | GWT | PASS | AC-1 through AC-12 are all Given/When/Then; every AC's `☐ testable` box is present (unticked, correct for Draft). |
| C-04 | Observable and real | PASS | Every AC names a real, checkable fact on the hosted runtime: real place names (Pflugerville, Manor, Lakeway, Round Rock), real permit numbers (2004-011296 BP, 1982-012866 BP), real coordinates, real counts (2,213 stalled county-wide). |
| C-05 | Scale + honesty | PASS | Scale: AC-5 (p95, tool-step/model-call/token limits, 1,000-row cap), AC-10 (1,000-row truncation, rate limits). Missing-data/error: AC-3 (no open permits, ZIP 99999), AC-6 (`throttled`/`paused`/`timed_out`), AC-11 (401, `not_found`, `out_of_scope`). |
| C-06 | Testable | PASS | Every AC gives an exact threshold or exact string (recall ≥ 80%, ≤ 6 steps, ≤ 1,500 tokens, 500 ms, 3 s p95, 5 rps/burst 10, specific permit IDs). No AC leaves room for two testers to disagree. |
| C-07 | Edge cases | PASS | 8 edge cases listed (≥ 2 required): ambiguous place name, chip edit, session quota, provider switch, Origin rejection, missing SSM parameter, free-form SQL rejection, agent/MCP `property_cid` mismatch. |
| C-08 | Requirements traced | PASS | FR-001…FR-010 and NFR-001…NFR-004 all carry a "Traces to" AC column; every NFR has a numeric threshold (p95 < 20 s, 23 s abort, ≤ 6 tool steps, ≤ 1,500 tokens, $3/day + 80% alarm, tools/list < 500 ms, tools/call p95 < 3 s, 5 rps/burst 10). |
| C-09 | Prototype | PASS | `ui: true`. Screens linked: `ExploreQ-ai.dc.html`, `ExploreQ-aicontractor.dc.html`, `ExploreQ-aiworking.dc.html`, `ExploreQ-aislow.dc.html`, `ExploreQ-ailimit.dc.html`, `ExploreQ-aipaused.dc.html`, `ExploreQ-aiooa.dc.html`, `HelperStates.dc.html`, `HelpMcp1440.dc.html` — all verified present in `design/prototype/`. States covered: working, answered, no results, throttled, paused, timed out, limit reached — matches the story's "States covered" row. |
| C-10 | Ready | PASS (with finding, see G4-8 below) | Explicit `depends_on: [A-02, A-03]`: both `status: Done` and merged into `feature/oracle-pipeline` (`e98c12e A-02: merge data contract`, `8ae1870 A-03: merge walking skeleton`). No stub needed for these two. |
| C-11 | Slicing | PASS | One primary evaluation point (A6); 1.5 days (merged story, within the 0.5–1.5 day band); vertical slice (retrieval + agent runtime + AI tab + MCP server, all touching the same `query-core` layer). |

## G4-8 finding: implicit dependencies not yet in `depends_on`

The story's own "Merge notes" section and Context already name two **implicit** dependencies that the formal `depends_on: [A-02, A-03]` list omits:

- **A-11** (full-county tables, Run 1 manifest, `coverage`). Stage 0 confirms: `status: Draft`, **not merged** into `feature/oracle-pipeline` (it depends on A-07, which is itself in progress on the pipeline chain, branch `007-enrich-reconcile`, not yet merged). Without it, AC-1, AC-4 to AC-6, AC-8 to AC-12 (anything needing full-county rows or the manifest) cannot be truly verified — only built and unit-tested on A-03's published slice.
- **A-13** (Explore shell, demo area, Explore query for AC-8, `/help/mcp`). Stage 0 confirms: `status: Done (G7 approved 2026-10-22)`, but **merge into `feature/oracle-pipeline` is itself waiting on A-11** (per A-13's own story file and `PARALLEL-RUN.md` wave 5). The AI tab's placement inside the Explore page, and the AC-8 cross-check against "the Explore page's query," need A-13's merged code.

This matches exactly what `PARALLEL-RUN.md` § 2 expects at this point in the parallel run (wave 3: "A-13 / A-14 continue" while the pipeline chain is still on A-07): A-14's retrieval and MCP tracks may start now; the AI tab's final wiring, the full-county golden runs, AC-8's test case and G7 wait for A-11 and A-13 to land on `feature/oracle-pipeline`.

**Recommendation:** add `A-11` and `A-13` to `depends_on` (→ `depends_on: [A-02, A-03, A-11, A-13]`), as the story's own Merge notes already propose. This is 🛑 **D-1** in the walkthrough.

## Fix list (ordered by impact)

1. **G4-8 (implicit dependencies).** Update `depends_on: [A-02, A-03]` → `depends_on: [A-02, A-03, A-11, A-13]` in the front matter. Low effort, no content change, but required so `progress.sh` and later gate checks read the real dependency graph. **Blocking for the Ready decision only in the sense that the decision should record this gap — not blocking Stages 1–2 (G4, spec) themselves**, since A-02 and A-03 (the hard direct prerequisites for any code to run) are both merged.
2. No other fixes needed — every other check passes as written.

## Verdict

**PASS.** 10 of 10 criteria pass; one finding (G4-8, implicit dependencies) is carried forward as a recommendation, not a blocking FAIL, per the story's own Merge notes and `PARALLEL-RUN.md`'s wave plan. The story can proceed to `status: Ready` once the owner records the G4-8 decision and ticks the ten G4 boxes.
