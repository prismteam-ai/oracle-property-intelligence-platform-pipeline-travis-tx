---
gate: G6
artifact: testplans/A-14-test-cases.md
artifact_version: 0.1, as of 2026-10-22 (post round-R2 wording fixes)
run_date: 2026-10-22
tool: Claude
verdict: PASS
---

# Gate G6 pre-check: A-14 test case approval

| # | Check | Result | Finding |
| --- | --- | --- | --- |
| C-01 | AC coverage | PASS | § 2's requirement mapping lists AC-1 through AC-12, each with ≥1 TC (e.g. AC-8 → TC-015, AC-12 → TC-029). |
| C-02 | FR coverage | PASS | FR-001 through FR-012 (spec.md) each map to ≥1 TC in § 2's table. |
| C-03 | Path coverage | PASS | Happy (TC-001, TC-014, TC-016, TC-029), negative (TC-003/004, @negative: TC-022–TC-026), edge (@edge: TC-008–TC-011, TC-027), missing-data (TC-003, TC-006 — fixed at round R2 to expect the honest `field_not_published` answer, TC-017, TC-024, TC-025, TC-028) are all present. |
| C-04 | NFR tests | PASS | NFR-001 → TC-NF-01 (p95 < 20 s, ≤6 steps, ≤3 calls, ≤1,500 tokens) and TC-013; NFR-002 → TC-011; NFR-003 → TC-014, TC-NF-02, TC-021 (< 500 ms, p95 < 3 s, 5 rps/burst 10); NFR-004 → TC-022, TC-027 (token never in git/logs/bundles). Each has a measurable pass criterion, not a vague adjective. |
| C-05 | Complete steps | PASS | Every case opens `{RUNTIME_URL}` (or sends to `{MCP_URL}`) first, one action per step, with exact data (real place names, real permit numbers, exact thresholds). Spot-checked TC-001, TC-006, TC-014, TC-015, TC-022. |
| C-06 | Exact expectations | PASS | Negative/missing-data cases state exact text or state, e.g. "stalled · source says Expired" / "stalled" alone (TC-017), "401, nothing runs" (TC-022/023), "`out_of_scope`" / "`not_found`" (TC-024/025), the fixed round-R2 wording for TC-006 ("can't tell — owner mailing address is not in the published export"). No "should work"/"test passes" language found. |
| C-07 | Real test data | PASS | § 5 names the manifest CID of the current partial run (`bafkreiasycmsr2qdlxqcfg3yc2conpn3jxmohz7gs55hkseipplhpqsk5i`), real permit numbers (`1982-012866 BP`, the three stalled Austin reroofs), and explicitly dates the county-wide stalled count (2,213, 2026-10-19) for re-verification once A-11 merges, rather than presenting it as current fact. |
| C-08 | Independence | PASS | § "Feature overview" line states the cases were drafted from the story's Given/When/Then ACs and `checks.md` § 7.1, explicitly **not** from `tasks.md`; confirmed — no TC references a `T###` task ID anywhere in the document. |
| C-09 | Automation mapping | PASS | Every P1/P2 case in § 7's coverage matrix names its Playwright test (`tests/e2e/agent.spec.ts` or `tests/e2e/mcp.spec.ts`, with the exact test title). The one exception, TC-028 (SSM token missing at cold start), is P3 and explicitly marked "manual: CloudWatch log check (not Playwright)" — correctly exempt from the P1/P2 rule. |

## Round-R2 consistency fixes applied before this check

Two wording corrections were made to align the test cases with the D-3 decisions recorded in `spec.md`'s Clarifications and `run-log.md`:
- TC-001: the "How I read this" chip and answer-text assertions changed from "roof > 15 years" to "roof ≥ 15 whole years" (AC-1/AC-8 threshold reconciliation).
- TC-006 (G4): steps 3–4 and the expected result changed from expecting a combined positive match on "owners outside the area" to expecting the honest "can't tell — not published" (`field_not_published`) answer, since the owner mailing ZIP is a genuine data-contract gap, not something this feature can derive.

## Fix list

None outstanding.

## Verdict

**PASS.** 9 of 9 criteria pass.
