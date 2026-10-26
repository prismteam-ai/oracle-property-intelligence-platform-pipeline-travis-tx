# Specification Analysis Report: A-16 (016-cost-and-admin)

Read-only run of `speckit-analyze` on 2026-10-26. Inputs: `spec.md`, `plan.md`, `tasks.md`, `stories/A-16-cost-and-admin.md`, `testplans/A-16-test-cases.md`, `.specify/memory/constitution.md`, CLAUDE.md. The hooks in `.specify/extensions.yml` (optional git commits) were not run, because this pass must not commit.

Totals: 0 CRITICAL, 6 HIGH, 8 MEDIUM, 3 LOW. Requirement coverage is 13 of 13 FRs and 14 of 14 ACs with at least one task. Three ACs (AC-1, AC-3, AC-12) are covered only indirectly, see H2 and H3.

## Findings

| ID | Category | Severity | Location(s) | Summary | Recommendation |
|----|----------|----------|-------------|---------|----------------|
| H1 | Constitution / process | HIGH | plan.md L9, L27; tasks.md L7-L13 | CLAUDE.md says `/speckit-implement` uses at most 4 builder groups. tasks.md defines five (G1, G2a, G2b, G3, G4). The plan summary says "four parallel builder groups" and its table lists G2a and G2b as well. | Merge G2a and G2b into one G2 owner, or run G2b after G2a as a sequenced sub-batch of the same group. Fix the "four" wording in plan.md. |
| H2 | Coverage gap | HIGH | spec FR-001, FR-003, FR-005; story AC-1, AC-3; tasks T040, T068 | No task reads Cost Explorer for the last billed days, captures the billing screenshot, or finalises `docs/cost.md` and `docs/source-limits.md`. Both docs exist only as drafts. T040 only parses them, and T068 only collects evidence. Story AC-1 ("screenshot in `docs/evidence/img/`") and AC-3 (full-capture durations) therefore have no owner. | Add a [Me] task in Phase 1 or 3. It should read billing for at least 3 full billed days, split idle from per-use and gross from credits, store the screenshot, and finish the two docs, with the Part 2 rows marked as stated from pricing. T040 depends on it. |
| H3 | Coverage gap | HIGH | spec US3 / FR-011; tasks Dependencies line ("Smeargle matrix -> T046, T050"); T046, T050, T065 | `docs/evidence/A-16-prototype-parity.md` does not exist, and no task creates the board/width/state inventory or runs the first smeargle comparison. T046 and T050 are blocked on a matrix nobody builds. | Add a Wave 1 task for smeargle (design consult) to produce the parity inventory and first verdicts before G2a and G2b start. Name it in the Dependencies line. |
| H4 | Coverage gap (AC-14) | HIGH | story Closure table vs tasks | Closure rows with no task or evidence plan: A11-4 (fresh Run 1 verify log), A11-8 (Majors closed), A11-10(a) (policy note), A13-5 (county counts in manifest coverage), A14-3 (quota increase noted), A14-4 (golden-query rerun on the full county), A14-6 (80% spend alarm wired to the Ops SNS topic), A14-7 (raw-table count in the index header). T003 and T010-T011 do not mention the header count. T015 covers only `run_lookup_failed`. Also, carried items 15-17 of the A11 list (Run 3 data fixes, review findings, printed-contractor answers in `ask.ts`) have no closure ID. | Add the missing items to tasks (G3 for A11-8, A13-5 and A14-6, G4 for A14-7, Me for A11-4 and A14-4). Add closure IDs A11-15 to A11-17 to the story table, or mark them Exception with PO decision. Update the count of 27 in the test plan. |
| H5 | Inconsistency (tests) | HIGH | tasks T020, T047, T053; testplan section 7 and section 3; plan frozen names | tasks.md plans `infra/test/idle-cost.test.ts` and `tests/e2e/A-16.spec.ts`. The test plan maps to `cost-rules.test.ts`, `admin-rules.test.ts`, `A-16-cost.spec.ts`, `A-16-admin.spec.ts`, `A-16-parity.spec.ts`, `A-16-county.spec.ts` and `A-16-closure.spec.ts`. No task creates the parity, county or closure specs (TC-023 to 033, 034 to 040). Credentials are named `COUNTYLENS_TEST_USERNAME/PASSWORD` in the plan but `ADMIN_TEST_EMAIL` / `NONADMIN_TEST_*` in the test plan. The plan has no non-admin credential. | Make tasks use the test plan's file names (G1 owns the CDK files, G2a the admin and cost specs, G2b the parity spec, G4 the county spec, Me the closure spec). Use one env-var set including the non-admin user. |
| H6 | Underspecification (ownership) | HIGH | tasks L8-L12, T022; infra/src/data-stack.ts L263; api-stack.ts L445-L451, L645, L873 | The index and `live/` read grants need `Data.grantApiRead` in `data-stack.ts`, which is limited to `ipfs/*` and `private/bench/*`. The synth assertions in `api-stack.ts` hard-match `/(ipfs\|private\/bench)\/\*$/`. G1 owns `api-stack.ts` but nobody owns `data-stack.ts`, and the matching infra tests would fail. Also the A-14 spec files that T053 un-parks have no owner. | Give `infra/src/data-stack.ts` and its tests to G1 and add them to T022. Update the three assertion regexes in the same task. Assign the A-14 spec edits (T053) to G4 or G2b by name. |
| M1 | Inconsistency | MEDIUM | story AC-7 (`runs/live.json`); plan L19, L89; T022 (`live/live.json`); plan (`index/{runId}/`) vs T003 (`private/explore-index/<manifestCid>/`) | The live-state object and the index key each have two or three different paths. T002 and T003 were meant to freeze them. | Pick one path each (suggest `private/live/live.json` and `private/explore-index/<manifestCid>/`), then fix plan.md, story AC-7 and TC-013. |
| M2 | Inconsistency | MEDIUM | spec FR-011 vs story FR table | The spec folds AC-11 (infra checks) and AC-12 (prototype parity) into FR-011. The story's FR-011 is AC-12 only, and the header says each AC maps to an FR with the same number. AC-11 is unmapped in the story FR table. | Put the AC-11 checks under FR-002 (or a new FR) in spec.md and keep FR-011 for parity. |
| M3 | Ambiguity | MEDIUM | spec NFR-003, AC-10; T024 | "Activity p95 < 3 s through a 5-minute cache" does not say whether an uncached 30-day Logs Insights query is included. That query often takes longer than 3 s. | State the cold-cache budget (for example, first call under 10 s, with a loading state), or pre-warm. Add a test in TC-NF-03. |
| M4 | Constitution A7 / NFR-001 | MEDIUM | spec NFR-001; plan Constitution Check; T022, T030, T020 | The plan adds at least the DLQ alarm, the duration alarm and the 80% spend alarm. CloudWatch alarms bill about $0.10 per month each beyond the 10 free. Logs Insights bills per GB scanned. "$0.00 fixed" is asserted without counting alarms against the free allowance. | Count all alarms in `docs/cost.md` against the free allowance, and state Logs Insights as a per-use line. Add an alarm-count assertion to the idle test. |
| M5 | Inconsistency (stale plan) | MEDIUM | plan L81-L87 vs tasks L7-L13 | plan.md still lists the old structure (single G2, `pipeline/index/*`, `ExploreSql.engine.ts` under G4) and defers to tasks.md in a footnote. | Rewrite the plan's Project Structure block to match tasks.md. |
| M6 | Missing task | MEDIUM | story A13-1 "Step 0"; T011-T012; T022 | Step 0 (a 1-hour timing measurement of cold file reads versus the query) is not a task. The reader does a single cold index download inside a 15 s Lambda (T022 cuts 29 to 15 s) with a 1,769 MB memory target and no size or latency budget. The A-13 history shows this is the exact failure point. | Add a Step 0 timing task before T012. Record the index size, cold-load time and peak memory. Set the Lambda limits from the result. |
| M7 | Inconsistency | MEDIUM | story Context ("Cognito email-code sign-in"), Part 2 intro vs AC-6 | Narrative text still says email-code sign-in. AC-6 and the spec say email + password. | Edit the story text (or add an amendment note). |
| M8 | Underspecification | MEDIUM | spec Assumptions; T016 (`--source local`) | `--source local` builds the index from laptop files. The spec requires "published CIDs only" but does not say how local bytes are proven to be the published ones, beyond the SHA check in T010. | State in T011 and TC-037 that local mode must match the manifest-recorded SHA-256 for every part and refuse any Query DB path. |
| L1 | Wording | LOW | spec header | `Status: Draft` and task markers are fine, but the spec names technologies (SQS, DLQ) that the file says to avoid. | Optional wording clean-up. |
| L2 | Dependency note | LOW | tasks Dependencies | T012 has no dependency on T003 or T011. T053 depends on T016 and the hosted deploy but this is not stated. | Add the edges. |
| L3 | Duplication | LOW | story A13-4 / A11-2; A11 items 3 and 14 | Same item appears under two IDs or numbers. | Note "same as" in the closure table (already done for A13-4). |

## Coverage Summary

| Requirement | Has task? | Task IDs | Notes |
|-------------|-----------|----------|-------|
| FR-001 / AC-1 | Partial | T040, T068 | No task reads billing or captures the screenshot (H2) |
| FR-002 / AC-2 | Yes | T020 | |
| FR-003 / AC-3 | Partial | T040, T068 | Docs are drafts (H2) |
| FR-004 / AC-4 | Yes | T040, T041, T047 | |
| FR-005 / AC-5 | Yes | T040, T041 | |
| FR-006 / AC-6 | Yes | T021, T024, T042, T043 | |
| FR-007 / AC-7 | Yes | T001, T023, T024, T030-T032, T043, T066 | |
| FR-008 / AC-8 | Yes | T024, T020 | |
| FR-009 / AC-9 | Yes | T030, T043, T066 | |
| FR-010 / AC-10 | Yes | T024, T044 | |
| FR-011 / AC-11 | Yes | T020, T030 | Spec numbering (M2) |
| FR-011 / AC-12 | Partial | T046, T050, T065 | Matrix creation missing (H3) |
| FR-012 / AC-13 | Yes | T003, T010-T016, T022 | Step 0 missing (M6) |
| FR-013 / AC-14 | Partial | T068 | Eight closure rows have no task (H4) |

## Unmapped tasks

None. Every task maps to an AC or closure ID, though T005 only supports AC-13 indirectly.

## Constitution alignment

No MUST conflict found (CRITICAL = 0). Articles XIII-XVII, XXI and XXII are met (agent-design.md exists, tests come first, test cases derive from ACs). The process rule "at most 4 builder groups" (CLAUDE.md) is breached (H1). Addendum A7 (zero idle) is at risk only through alarm counting (M4). A2 and A3 (Query DB never exposed, published CIDs) are respected by design, with the proof in M8.

## Metrics

- Requirements: 13 FR, 4 NFR, 6 SC. ACs: 14.
- Tasks: 44 (T001-T005, T010-T016, T020-T024, T030-T035, T040-T047, T050-T053, T060-T068).
- FR coverage with at least one task: 13/13 (100%), 3 of them partial.
- Ambiguity count: 3 (M3, M4, M8). Duplication count: 1 (L3).
- Critical issues: 0. High: 6. Medium: 8. Low: 3.

## Next actions

No CRITICAL issues, but resolve H1 to H6 before `/speckit-implement`, because they change task ownership and G5/G6 inputs.

1. Edit tasks.md: the group count (H1), the new Wave 1 tasks for billing/docs (H2) and the parity inventory (H3), the missing closure work (H4), test file names and env vars (H5), `data-stack.ts` ownership (H6), and the Step 0 timing task (M6).
2. Edit plan.md: Project Structure and the path names (M1, M5).
3. Edit spec.md: FR-011/AC-11 mapping and the Activity cold-cache budget (M2, M3).
4. Edit the story: closure IDs for items 15-17 and the email-code wording (H4, M7), and update the test plan's file names (H5).
5. Re-run `developmentsupport-g5-precheck` and `developmentsupport-g6-precheck` after the edits.

Would you like concrete remediation edits for the top issues? No edits have been applied.


## Resolution (2026-10-26)

- H1: **PO exception** (2026-10-26): five builder groups kept (G1, G2a, G2b, G3, G4), files disjoint; the PO asked to maximise parallel work. Recorded in the gate log.
- H2–H6: fixed in commits `e358159` and `ec9d7db` (T070–T073, T025, T026, T036, closure rows A11-14 to A11-17, test file owners, `data-stack.ts` to G1).
