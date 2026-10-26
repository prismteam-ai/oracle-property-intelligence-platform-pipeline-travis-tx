---
gate: G5
artifact: specs/003-walking-skeleton (spec.md, plan.md, tasks.md)
artifact_version: "2026-10-21, run 2 (after the C-04 and C-07 fixes to tasks.md and plan.md; uncommitted)"
run_date: 2026-10-21
tool: Claude
verdict: PASS
---

# G5 pre-check (run 2): A-03 Publish one month of Austin roofing permits by CID and show them in the hosted UI

Inputs read: `specs/003-walking-skeleton/spec.md`, `plan.md`, `tasks.md`, `agent-design.md`, `run-log.md`, `research.md`, `data-model.md`, `contracts/`, `quickstart.md`; `stories/A-03-walking-skeleton.md`; `testplans/A-03-test-cases.md` v1.0 (G6 PASS); `docs/architecture-constitution.md` v0.2.3 (§ 16 AM-01…AM-06); `.specify/memory/constitution.md` v3.0.3.

**Run 1 (2026-10-21): FAIL (2).**
- **C-04:** T058 (`run-month.test.ts`) sat in Phase 5, after T036 (`run-month.ts`, Phase 3), the implementation it covers, and group G-B1 listed it last.
- **C-07:** plan.md's Complexity row for the 15 s Lambda timeout said "Needs an ARD § 16 note if the PO wants it recorded as an amendment", and the Input line cited AM-01…AM-05, although the ARD already records the timeout as AM-06 (2026-10-21, PO D-4).

Fixes (plan.md and tasks.md only; no change to the story, the spec's ACs, the ARD, `contract/v1` or the test plan): T058 moved into Phase 3's test block ahead of T035/T036 (same ID, same `[US3]` tag, pointer left in Phase 5); G-B1 reordered to T025 → T058 → T035 → T036; AM-06 cited in the plan's Input line, the superseded-points row and the Complexity row.

| Check | Criterion | Result | Finding |
| --- | --- | --- | --- |
| C-01 | Clarified | PASS | Two `/speckit-clarify` sessions in spec.md § Clarifications (6 answers from the docs, 7 from PO rounds R3–R4: D-2, D-4, D-5); 0 `[NEEDS CLARIFICATION]` in spec.md. |
| C-02 | Phase structure | PASS | Phase 1 Setup → Phase 2 Foundational → US1, US2, US3, US4 (P1) → US5 (P2) → Phase N Integration & cross-cutting (the Polish phase) → Phase Z. |
| C-03 | Task format | PASS | T001–T079 and TZ01–TZ06, continuous, 85 tasks. `[P]` on parallel tasks; `[USn]` on every story-phase task (Setup, Foundational, Phase N and Z carry none, by the template rule); every T### task has an `owns:` path; every implementation task is tagged `[metagross]` or `[oracle]`. Every TC cited (TC-001…061, NF-01…06) exists in the G6 matrix, every matrix TC is assigned to a task, and the 13 `tests/e2e/*.spec.ts` names match the matrix. |
| C-04 | Tests first | PASS (run 2) | Every phase lists its test tasks before the implementation they cover: T001→T002, T006→T007–T009, T010/T011→T012–T014, T015→T016, T017→T018/T019, T020→T021, T025/T058/T026–T034→T035–T044, T051–T053→T054–T057, T061–T063→T064–T066, T068–T071→T072–T075. T058 now precedes T036 in document order and in G-B1. T060 extends `runs.test.tsx` test-first inside the task (noted, acceptable). |
| C-05 | Live verification last | PASS | tasks.md ends with TZ01 (reviewers `metagross`, `oracle` → `docs/reviews/CR-A-03.md`, ≥ 75), TZ02 (deploy Data → Api → Web → Ops → Cert, D-10 gated, URL + `/build.json` SHA in evidence), TZ03 (Playwright, one test per TC tagged `@scenario:A-03-TC-nnn`, against `RUNTIME_URL`; config throws on localhost, T023), TZ04 (smeargle 390/768/1440 on Runs and Permits), TZ05 (`verify-manifest` → `ALL ARTIFACTS VERIFIED` on Pinata + Filebase, the story's `agents.verify`), TZ06 (TR, evidence, traceability row, kit-usage line). The sections after Phase Z (coverage table, waves, notes) hold no tasks. |
| C-06 | LLD complete | PASS | plan.md: components (Project Structure, five stacks, routers, engine adapters), data flow (Architecture diagram: Socrata → run-month → two-phase publish → Filebase → CID copy → browser / Lambda), integration points (Socrata, TCAD zip, Filebase Kubo RPC, S3 + CloudFront, Pinata, HTTP API, Amplify, Namecheap), test approach (Technical Context "Testing", Fixed texts table, Read-path scope); plus research.md, data-model.md, contracts/{api,cli,storage}.md, quickstart.md. |
| C-07 | Architecture conformance | PASS (run 2) | Deviations are flagged and justified in Complexity Tracking (D-02 `infra/`, D-05 local CI, D-03 `.mjs`, D-04 SNS, run-script instead of Restate per PO D-5, kit skill-order per oracle risk 3, 15 s timeout = AM-06). The amended rules AM-01…AM-06 are applied (Pinata + Filebase, deploy order, access log, read path, `carCid`, 15 s). No P0 broken: only `elephant-cli` output + manifest + index public, fixed order with a test, CIDv1 only, no Query DB import in `pipeline/publish`, region from config, nothing that bills while idle, no fixture data on the hosted site. The second pin and GitHub Release CARs (AD-22) are owned by A-11 AC-6 / FR-005, so their absence here is scope, not a deviation. |
| C-08 | Kit usage | PASS | `agent-design.md` holds the `oracle` and `metagross` answers word for word (both `agents.design`), a 9-row Disagreements table and a Spike delta. plan.md "Kit Agent Ownership" cites it per section, names the builder skills from the story front matter (`metagross`: build-frontend-backends, integrate-ci-cd, responsive-design-tests; `oracle`: use-oracle, county-permit-adapter; both + apply-engineering-guidelines) and lists 13 builder patterns with file paths (constitution XIV–XV). |
| C-09 | Coverage | PASS | FR-001…FR-013 and NFR-001…004 each map to ≥ 1 task in the "Requirement coverage" table; spot checks hold (FR-001 `carCid` + index → T027/T038/T047; FR-004 gateway legs → T067, range reads + Brotli → T053/T054/T057; FR-005 no-`tcad_id` → T036/T058/T060; FR-007 trace ID in evidence → T068/TZ06, budget → T075; FR-011 21/21 labels → T015/T016; FR-013 → T042/T056). |
| C-10 | Analyze | PASS | run-log 10:52: `/speckit-analyze` found 1 CRITICAL + 3 HIGH, all fixed (ItemsProcessed/ItemsFailed → T071/T073; Lambda-proof presets = TC-NF-05 → T011/T061/T066; full-size COUNT on the Lambda bench → plan § Read-path scope + T066); 3 MEDIUM, 1 LOW left. The fixes are visible in plan.md and tasks.md. No separate analyze report file (same as A-01/A-02). The run-2 edits reorder one task and correct one citation; they add no new finding. |

## Fix list

No open FAILs.

## Next steps (PO)

- Tick the G5 checklist in plan.md / tasks.md, record the decision and date (🛑 D-6).
- Add the G5 row to the gate log in `docs/traceability.md`.
- `/speckit-implement` may start only after G5 (D-6) and G6 (D-7) are both approved (constitution XVIII).

**Decision:** ☑ Approved ☐ Returned · HebaGaber · 2026-10-21 (PO: "Approve (Recommended)", round R5, 11:00)
