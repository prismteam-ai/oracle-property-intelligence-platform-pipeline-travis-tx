---
gate: G5
artifact: specs/004-property-backbone (spec.md, plan.md, tasks.md)
artifact_version: "2026-10-21, run 2 (after the C-03 format fixes to tasks.md; uncommitted on 004-property-backbone at b7abf67)"
run_date: 2026-10-21
tool: Claude
verdict: PASS
---

# G5 pre-check (run 2): A-04 Load the county backbone: TCAD properties and owners, coordinates, and permits from every jurisdiction

Inputs read: `specs/004-property-backbone/spec.md`, `plan.md`, `tasks.md`, `agent-design.md`, `run-log.md`; `stories/A-04-property-backbone.md` (status Ready, G4 approved 22:30, D-3); `testplans/A-04-test-cases.md` v0.2 (TC ID cross-check only); `docs/architecture-constitution.md` v0.2.4 (§ 8, § 12 P0, § 16 AM-01…AM-08); `.specify/memory/constitution.md` v3.0.3. `research.md`, `data-model.md`, `contracts/{cli,gis-runner,seams,report}.md` and `quickstart.md` exist and are referenced from plan.md (not re-audited line by line).

**Run 1 (2026-10-21): FAIL (1).**
- **C-03:** (a) T006 was `[P]` but shared `rt/package.json` with T010; (b) lead tasks T060, T061, T064, T067, T074, T075, T076, T078, T081, T082, T084, T085, T088 named no file they write or record into. Observation: T088's G7 pre-check sat before TZ05/TZ06. C-10 note: the run-log named only one of the four HIGH analyze fixes.

Fixes (tasks.md only, format; no scope or meaning change; lead-authorised): `[P]` removed from T006 and "T006 → T010 (both edit rt/package.json)" added to the G-FIX dependency line; a `records in:` path added to each of the 13 lead tasks (run-log.md; the permit pages/receipts dir for T061/T074; `pipeline/data/runs/<jobId>/report.json` for T064; `docs/reviews/CR-A-04.md` for T075; `docs/evidence/A-04.md` for T084/T085; `docs/gates/G7-A-04-precheck.md` for T088); T088's G7 pre-check now runs "after TZ06", with a new "Close-out and Phase Z" dependency line ending in it. The run-log now lists H1–H4 (line "B1 analyze HIGH fixes").

**Accepted exception (pipeline-only story, recorded once, plan CT-1):** Phase Z TZ02–TZ04 are N/A: "pipeline-only story, deploys nothing; shown on the hosted Coverage page and Lead finder after A-11/A-13."

**Note (not an exception; PO-approved Round 1, run-log 22:30 "G-FIX first, then 3 parallel (Recommended)"):** build order is G-FIX (Phase 1) alone first, then G-TCAD ‖ G-GIS ‖ G-PERMITS in one parallel wave (W1).

| Check | Criterion | Result | Finding |
| --- | --- | --- | --- |
| C-01 | Clarified | PASS | spec.md § Clarifications: Round 1 PO decisions (run-log 22:22–22:33) plus `/speckit-clarify` Session 2026-10-21 (5 answers from cited sources); 0 `[NEEDS CLARIFICATION]` in spec.md (run-log 22:39: the 3 markers resolved, checklist 16/16). |
| C-02 | Phase structure | PASS | Phase 0 Preconditions (the Setup step, lead) → Phase 1 G-FIX (Foundational, "runs alone, blocks the wave") → Phase 2 US1 (P1) ‖ Phase 3 US2 (P1) ‖ Phase 4 US3 (P1) → Phases 5–9 integration, pilots, push, runs, close-out (the Polish phases) → Phase Z. All three stories are P1, so there is no P2/P3 ordering to check. |
| C-03 | Task format | PASS (run 2) | 67 tasks (T001, T002–T012, T020–T028, T040–T045, T050–T056, T060–T088, TZ01–TZ06; numbering gaps are deliberate per group). Every builder task has `[USn]` (story phases), a group tag and an exact `owns:` path list; every lead task now has an `owns:` or `records in:` path. `[P]` is set only on tasks with disjoint files: T006 is no longer `[P]` and the G-FIX line reads "T006 → T010 (both edit rt/package.json); T004, T005, T011, T012 [P]". No other `[P]` pair shares a file (T020/T021, T040–T042, T050/T052/T054/T055, T075/T081 checked). |
| C-04 | Tests first | PASS | Every builder task opens with "Test first `<file>` … Then implement …", names its `A-04-TC-nnn` where a G6 case exists, and each phase states its red run with the expected failure messages and "0 new cases pass" (Phase 1, 2, 3, 4 headers). Lead run tasks (Phases 5–9) run against suites already green. |
| C-05 | Live verification last | PASS (with the accepted exception) | tasks.md ends with Phase Z: TZ01 reviewers `oracle`, `donphan` → `docs/reviews/CR-A-04.md` (≥ 75); **TZ02–TZ04 N/A (accepted exception above)**; TZ05 the story's `agents.verify` (`monitoring-county-ingestion`, roll count, coverage SQL ≥ 0.99 both ways, per-jurisdiction counts) → `docs/evidence/A-04.md`; TZ06 test report, evidence, traceability row, kit-usage line. Sections after Phase Z hold no tasks. Run 2: T088's G7 pre-check now runs "after TZ06" (task text and the "Close-out and Phase Z" dependency line), so G7 reads complete evidence. |
| C-06 | LLD complete | PASS | plan.md: components (Project Structure, Build-wave file ownership, seams `createService` / `LoaderTrack` / `ReportSection` / `BackboneCommand` / `RunContext`), data flow (§ Architecture diagram: export → redact → TcadBackbone/TcadChunk → Loader; US runner → artifact → GisImport; AustinPermits → Loader; link → classify → open_days; assemble-coordinates; write-group → elephant-cli local → DuckDB coverage), integration points (TCAD export on disk, Travis GIS via GitHub-hosted US runner, Austin Socrata `3syk-w9eu`, local Restate + Postgres, elephant-cli 44bb182, DuckDB CLI), test approach (Technical Context "Testing": offline Vitest, `QDB_TEST_URL`-gated DB tests, `elephant-cli validate`, `qdb_ro`, report JSON); risks R1–R8; plus research.md, data-model.md, contracts/, quickstart.md. |
| C-07 | Architecture conformance | PASS | Constitution Check (I–XXIII, A1–A8) and ARD P0 1–20 tables filled; every deviation flagged and justified in Complexity Tracking CT-1…CT-8 (CT-1 no hosted proof, CT-2 GIS runner outside Restate, CT-3 redacted payload stored, CT-4 registry-before-permits order, CT-5 vendored files + `@dsnp/parquetjs`, CT-6 size 2.5 d, CT-7 G-FIX skills, CT-8 export point published as `gis_centroid` per frozen `contract/v1`). The US runner is allowed by ARD § 8 ("A geo-block may be retried from a US GitHub Actions runner; a 403 or challenge never is"). No P0 broken: Query DB local only and never on the runner (P0-1), nothing uploaded (P0-2, FR-024), key = `String(pID)` (P0-5), classification only via profile (P0-9), one stack and one writer (P0-10), redaction before storage/validate (P0-15). |
| C-08 | Kit usage | PASS | `agent-design.md` holds `oracle`'s answer word for word (the only `agents.design` agent), with 15 disagreements and separately labelled Lead notes. plan.md "Kit Agent Ownership" cites agent-design.md per section, names each group's builder skills (G-FIX, G-TCAD, G-GIS, G-PERMITS + apply-engineering-guidelines; CT-7 justifies the G-FIX additions) and lists 20 builder patterns with file paths (constitution XIV–XV). Reviewers and verify match the story front matter. |
| C-09 | Coverage | PASS | FR-001…FR-026 and NFR-001…NFR-006 each map to ≥ 1 task in "Requirement coverage" (FR-025 → T008/T009/T010 + Phase 8 order; FR-024 → T012/T045/T079; FR-026 → T027/T044/T053). Every TC ID cited in tasks.md exists in test plan v0.2; the six not cited individually (TC-003/004/021/022/043/052) are covered by the cited ranges TC-001…004, TC-020…022, TC-042…044, TC-050…052. |
| C-10 | Analyze | PASS | run-log 22:39: `/speckit-analyze` 0 CRITICAL, 4 HIGH fixed, 10 MEDIUM/LOW left; "B1 analyze HIGH fixes" lists H1–H4 and each is visible: H1 T026 "the run **stops first** … `waiting_human` … no request made"; H2 story AC-1/§ D-4 treat `0208011301` as the documented negative; H3 `contracts/report.md` "`--job` is the TCAD job …" with per-section source jobs; H4 G-TCAD sequenced (T020 → T022 → T023, T025 → … → T028, only T021 `[P]`). No separate analyze report file (same as A-01…A-03). The run-2 edits are format only and add no new finding. |

## Fix list

No open FAILs (run 2). The only exception is the accepted Phase Z TZ02–TZ04 N/A (CT-1).

## Next steps (PO)

- Tick the G5 checklist in plan.md / tasks.md, record the decision and date (Round 1 D-10 "Approve if PASS"), and add the G5 row to the gate log in `docs/traceability.md`.
- `/speckit-implement` may start only after G5 and G6 are both approved (constitution XVIII).

**Decision:** ☑ Approved ☐ Returned · Approved under Round 1 conditional approval, 2026-10-21 22:45 (D-10 "Approve if PASS (Recommended)"; conditions met: run 2 verdict PASS, 0 FAIL; only exception Phase Z TZ02–TZ04 N/A).
