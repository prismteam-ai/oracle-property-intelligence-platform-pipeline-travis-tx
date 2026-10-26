---
gate: G6
artifact: testplans/A-13-test-cases.md
artifact_version: "v0.2 (2026-10-21, aligned to plan contracts; GAP-6/GAP-8 closed; uncommitted)"
run_date: 2026-10-21
tool: Claude
verdict: PASS
---

# G6 pre-check: A-13 test cases

Inputs read: `testplans/A-13-test-cases.md` (73 cases: 62 written-out sections + TC-060…TC-070 under one shared Coming soon procedure with an entry point each); `stories/A-13-explorer-and-pages.md`; `specs/013-explorer-and-pages/spec.md` (FR-001…FR-025, Clarifications) and `contracts/ui-routes.md` (exact strings); `.specify/memory/constitution.md` (I, XI, XXII). Checked by script as well as by reading (run-log 2026-10-21). This report finds gaps; it does not approve.

| Check | Criterion | Result | Finding |
| --- | --- | --- | --- |
| C-01 | AC coverage | PASS | AC-1…AC-14 each have a coverage row with ≥ 1 TC (e.g. AC-1 → TC-002, 007, 010–015; AC-14 → TC-073, 074). |
| C-02 | FR coverage | PASS | Every FR-001…FR-025 incl. 001a–c, 003a–d, 004a–b, 006a appears in the FR matrix (script check: 0 missing). |
| C-03 | Path coverage | PASS | Happy (`@smoke` ×4, `@integration` ×24, D-1…D-9 first), negative (×24), edge (×20), missing data (×18), plus security, perf, a11y. |
| C-04 | NFR tests | PASS | NFR-001 (TC-041 p95 < 3 s over 20 runs, TC-040 first load ≤ 8 s with progress bar), NFR-002 (TC-081 LCP < 2.5 s / CLS < 0.1 / INP < 200 ms under the stated mobile-4G profile, TC-082 ≤ 300 KB gzipped, TC-080 390/768/1440 + 48 px, TC-083 WCAG 2.2 AA), NFR-003 (provenance on 100% of rows). |
| C-05 | Complete steps | PASS | Every case starts from `RUNTIME_URL` (directly or by reusing another case's hosted URL, e.g. TC-030 "the TC-026 URL", TC-073/080 "every route of TC-086"); one action per step; exact query strings. No login (Task A is public). `localhost` refused (TC-085). |
| C-06 | Exact expectations | PASS | Every negative case asserts its exact text from `contracts/ui-routes.md` (e.g. TC-012 "Run index unavailable · {reason}", TC-038 "Read-only: only SELECT, WITH, DESCRIBE and SHOW run here", TC-021 mismatch text, TC-042 "Not available yet · the agent and MCP server arrive with story A-14"); no "should work" / "test passes" (script check: 0). |
| C-07 | Real test data | PASS | Snapshot named: run `travis-202609-permits-20261021t103516z`, manifest `bafkreiasycmsr2qdlxqcfg3yc2conpn3jxmohz7gs55hkseipplhpqsk5i`; expected values read at run time from the hosted `runs/index.json` and manifest; the only fixed numbers are the dated Pflugerville references labelled "2026-10-19, re-measured at run time". Cases needing A-11 data say "Waits for A-11" and what they check today. |
| C-08 | Independence | PASS | Header states `tasks.md` was not read (only six spec-file names taken); cases trace to ACs, edge cases and FRs. |
| C-09 | Automation mapping | PASS | All 73 index rows name `tests/e2e/A-13-{explorer,verify,perf,pages,scan,vitals}.spec.ts @scenario:A-13-TC-nnn` (script check: 73/73). |

## Fix list

None. Notes for the PO: 13 cases are tagged "Waits for A-11" (3 runs, full county, table export, scale, multi-run log) and pass only after A-11 publishes; TC-009 reads `docs/evidence/A-13-open-permits.md`, written at D-11.

When approving: tick the G6 checklist in the test-case file (`qc_signoff`), record the decision and date, and add the gate-log row in `docs/traceability.md`.

## PO decision

☑ Approved · HebaGaber · 2026-10-21 (D-10, round R3: "Approve G6 (Recommended)"). AC-6 wording: "Yes, match the architecture (Recommended)".
