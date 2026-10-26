---
gate: G5
artifact: specs/001-discover-sources
artifact_version: "spec (clarified, 5 Q&A) + plan + tasks (60 tasks), 2026-10-19, uncommitted after commit 350194c"
run_date: 2026-10-19
tool: Claude
verdict: PASS
---

# G5 pre-check: A-01 tasks and low-level design

Inputs read: `specs/001-discover-sources/spec.md`, `plan.md`, `tasks.md`, `research.md`, `data-model.md`, `contracts/`, `quickstart.md`, `agent-design.md`; `stories/A-01-discover-sources.md`; `docs/architecture-constitution.md` (ARD-A v0.2); `.specify/memory/constitution.md` (3.0.3); the `/speckit-analyze` report of 2026-10-19.

| Check | Criterion | Result | Finding |
| --- | --- | --- | --- |
| C-01 | Clarified | PASS | `/speckit-clarify` ran with 5 questions answered (session 2026-10-19 in spec.md § Clarifications); 0 `[NEEDS CLARIFICATION]` markers. |
| C-02 | Phase structure | PASS | Setup → Foundational → US1 → US2 → US4 → US3 → Polish → Phase Z. All four stories are P1; the US4-before-US3 order is stated and justified in tasks.md ("the readiness verdict (US3) needs the finished catalog, including US4's blocked rows"). |
| C-03 | Task format | PASS | 60 tasks: T001–T054 and TZ01–TZ06 (template IDs). Every task has a file path or N/A text; 35 `[P]` markers; every story-phase task carries `[US1]`–`[US4]`; Setup, Foundational, Polish carry none, as the format requires. |
| C-04 | Tests first | PASS | Each phase opens with a "Tests … (MANDATORY, write first)" block before its implementation tasks (Foundational T005–T008 before T009–T014; US1 T015–T019 before T020–T026; US2 T027–T029; US4 T034–T035; US3 T040–T043). |
| C-05 | Live verification last | PASS (justified exception) | Phase Z is last with TZ01–TZ06. TZ01 runs the `oracle` reviewer (≥ 75), TZ05 runs the readiness validator (`agents.verify`) and TZ06 writes evidence, traceability and kit-usage. TZ02 (deploy) and TZ03 (Playwright on RUNTIME_URL) read "N/A: Project story, no hosted runtime until A-03". That is the G4 C-04 exception accepted by the PO on 2026-10-19 and recorded in plan.md Complexity Tracking (Article I / XXII); the G6 test cases still run against the committed artifacts in T054. TZ04 (smeargle) is N/A because `ui: false`. No task uses localhost as evidence. |
| C-06 | LLD complete | PASS | **Components:** plan Project Structure plus the 9 patterns mapped to paths. **Data flow:** plan Summary (probes → source client → catalog → validator → rendered summary) and the data-model run state machine. **Integration points:** Socrata, TCAD, ArcGIS, Census, BBB, Restate, Docker/Postgres identity, GitHub (research R6–R12, contracts/capture-receipt.md). **Test approach:** plan Technical Context "Testing", quickstart Scenarios 1–6, and the TDD tasks. |
| C-07 | Architecture conformance | PASS | Code lives in `pipeline/oracle-runtime` per AD-23 and the ARD module table; StopOnBlocked sits in the External layer; the geo-check follows ARD § 8 (a geo-block only, never a plain 403); the Query DB is identity-read only (A2). The only departure, Article I hosted proof, is justified in Complexity Tracking. VIII/IX (Powertools, PagerDuty) are N/A with the reason given (no Lambda). |
| C-08 | Kit usage | PASS | `agent-design.md` holds the one `agents.design` answer (`oracle`) word for word, plus PO decisions. plan.md Kit Agent Ownership cites it by section, names the builder's five skills plus apply-engineering-guidelines, and lists 9 builder patterns each mapped to a file path. |
| C-09 | Coverage | PASS | All 24 FR/NFR items have at least one task (analyze coverage table: 100%). Four are only partly covered (FR-001 kit intake, FR-003b counted-GIS path, FR-003c, FR-007): these are MEDIUM/LOW findings, not missing coverage. |
| C-10 | Analyze | PASS | The 2026-10-19 analyze run found 1 CRITICAL (C1, missing front matter on spec.md and the checklist) and 1 HIGH (C2, G6 test cases never run). Both were fixed the same day: all 11 spec-folder files now carry `id`/`parent` (checked by script), and T054 now runs every TC in `testplans/A-01-test-cases.md` and records results in `docs/reports/TR-A-01.md`. 3 MEDIUM and 7 LOW findings remain open; none block G5. |

## Fix list (ordered by impact on the assessment score)

No blocking gaps. Recommended before `/speckit-implement`; each is a one-line tasks.md edit:

1. **Analyze U1 (MEDIUM):** add to T048 a run of the kit `onboard-county` intake and the `county-discovery` procedure for Travis (FIPS 48453), recorded in `docs/evidence/A-01.md`, with no external push. FR-001 names this flow, and the `oracle` reviewer will look for it.
2. **Analyze U2 (MEDIUM):** add tests to T018/T019 for the counted-GIS path: `gap_pct` computed, `discrepancy_explanation` above 2%, `separately_assessed_without_geometry` when GIS is below the roll (FR-003b).
3. **Analyze C3 (MEDIUM):** require `id`/`parent` front matter on generated docs (`docs/sources.md`, `pipeline/docs/travis-county-findings.md`, `docs/evidence/A-01.md`) in T046, T049, T051 (Article XIX).
4. Optionally fold in the 7 LOW findings (drift threshold, TCAD timeout value, 8-vs-9 source wording, `decision` wording, plan tree, anti-bot assertions, defect records, explicit commit step).

## Decision

**Approved (HebaGaber), 2026-10-19.** C-05 relies on the G4 C-04 exception (Project story, no hosted runtime until A-03). The three MEDIUM analyze findings (U1, U2, C3) are recommended, not blocking.
