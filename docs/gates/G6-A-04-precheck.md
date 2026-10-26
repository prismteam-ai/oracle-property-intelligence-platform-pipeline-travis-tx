---
gate: G6
artifact: testplans/A-04-test-cases.md
artifact_version: v0.3 (2026-10-21, aligned with spec / plan / data-model / contracts)
run_date: 2026-10-21
tool: Claude
verdict: PASS
---

# G6 pre-check: A-04 test cases

Inputs read: `testplans/A-04-test-cases.md` v0.3 (52 cases: 49 functional + 3 NF), `stories/A-04-property-backbone.md` (Ready, AC-1…AC-17), `specs/004-property-backbone/spec.md` (FR-001…FR-026, NFR-001…NFR-006), `.specify/memory/constitution.md` (articles XXI–XXIII, Task A addendum). Names and commands were also checked against `plan.md` § "Names fixed with the test plan", `data-model.md` and `contracts/{cli,gis-runner,report}.md`. A-04 is pipeline-only (`ui: false`) and publishes nothing, so C-05 and C-09 are the accepted exceptions (below).

| Check | Criterion | Result | Finding |
| --- | --- | --- | --- |
| C-01 | AC coverage | PASS | AC-1 → TC-001…004; AC-2 → TC-005, 006; AC-3 → TC-010, 011; AC-4 → TC-012, 013; AC-5 → TC-014, 015; AC-6 → TC-016, 017; AC-7 → TC-020, 021, 022, 032; AC-8 → TC-020, 023, 033, NF-01; AC-9 → TC-024; AC-10 → TC-025; AC-11 → TC-026…028; AC-12 → TC-040, 041, NF-01; AC-13 → TC-042…044; AC-14 → TC-045…047; AC-15 → TC-048, 049; AC-16 → TC-050…052; AC-17 → TC-041, 053, 054 (§ 2). |
| C-02 | FR coverage | PASS | All 26 spec FRs mapped in § 2 with TC and task IDs. FR-018 → TC-007; FR-019 → TC-008, 009; FR-020 → TC-029…031; FR-021 → TC-055, 056; FR-022 → TC-049; FR-023 → TC-047; FR-024 → TC-NF-02, TC-023; FR-025 → TC-018 (new in v0.3; tasks.md had no case for it); FR-026 → TC-023, 025, 033, 050. |
| C-03 | Path coverage | PASS | Happy (TC-001, 005, 020, 022, 040), negative (TC-003, 011, 015, 016, 018, 021, 025, 032, 053, NF-02, NF-03), edge (TC-007…009, 029…031, 033, 044, 047, 049, 055, 056), missing data (TC-003, 011…013, 021, 023, 025, 043, 050), error (TC-016, 026, 027, 051, 053, 054). |
| C-04 | NFR tests | PASS | NFR-001 → TC-005 (N − loaded < 9,865, 0 unexplained); NFR-002 → TC-016, 017, 026, 028, 041, 053 (UA, GIS ≤ 2, Austin ≥ 1,000 ms apart, waits in [0, min(60 s, 2^(k−1) s)], 5 attempts, 1 request on 403); NFR-003 → TC-023 (≥ 437,542 of 441,961, both ways); NFR-004 → TC-026, 028 (in-flight = 2); NFR-005 → TC-042 (rate ≥ 0.9700); NFR-006 → TC-041, 053 (`$limit=50000`, no `X-App-Token`, 48 pages). |
| C-05 | Complete steps | PASS (accepted exception) | No hosted URL: pipeline-only story, nothing deployed or published (story `ui: false`; plan CT-1; G4 C-04). Every case has step 0 `git rev-parse --abbrev-ref HEAD` → `004-property-backbone`, then one exact command per step with exact data (§ 3.3 commands written out per contracts/cli.md; GIS mode via `runner-config.json` push, TC-020). |
| C-06 | Exact expectations | PASS | Negative and error cases state exact rows / strings / states: `1982-012866 BP\|t\|no_tcad_geoid` (TC-003), `{"on_roll":false,"coordinate_source":null}` (TC-021), `waiting_human` + exit 3 + `export_sha256_mismatch` + receipt `outcome: "blocked"`, `http_status: 403` (TC-016), exit 1 naming the running job (TC-018), `gis: blocked at {ts}; coverage not complete` (TC-026), the D-7 text `source export carries no §25.025 marker; conservative suppression on sale-confidentiality codes` (TC-005, TC-014), `source bulk re-stamp; delta by content digest` (TC-051), exit 2 on 403 (TC-053). No "should work" / "test passes" wording (grep: 0 hits). |
| C-07 | Real test data | PASS | Real records: TCAD export SHA-256 `6f7a7585…c2346` (N = 493,246 by type), pID 221829 / geoID 0223120506, negative 0208011301 / 1982-012866 BP, Austin 2,381,226 / 63,021 rows, 22,084 reroof candidates, baseline 129 / 2,213 / 17,251 / 2,491, GIS 373,683, gazetteer DIGEST `0f4c08a8…5d17f`, profile SHA `c8fd15cf…53dfa6`. No manifest CID can exist (A-04 publishes nothing); the snapshot is named by the export SHA-256, Austin watermark, GIS run id + artifact SHA-256 and `{JOB_ID}` (§ 5), as in A-02 G6. Synthetic fixtures are labelled test input only. |
| C-08 | Independence | PASS | Cases were drafted from the story ACs, edge cases and PO decisions (v0.1 header: `tasks.md` not read). v0.3 changed names to match plan / data-model / contracts only; `tasks.md` was read afterwards solely to fill the "Tasks" traceability column in § 2 / § 7, as declared in the front matter. No expected result is taken from a task. |
| C-09 | Automation mapping | PASS (accepted exception) | Every P1/P2 case names its automation in § 7: a Vitest test `-t "A-04-TC-nnn"` (file named), a `backbone` / `elephant-cli` / `gh` command, or a read-only `qdb_ro` / `restate sql` / `grep` check. Playwright N/A: no hosted surface in A-04 (plan CT-1). |

## Exceptions (recorded once)

- **C-05 and C-09.** Pipeline-only story: cases start from a terminal at the repo root on `004-property-backbone` and run with Vitest and run commands instead of Playwright on the hosted URL. The hosted proof comes with A-11 / A-13 (plan CT-1; same basis as G4 C-04 and the A-01 / A-02 G6 reports). Recorded once in the test plan § 3.1.

## Fix list (ordered by impact)

None. 0 FAILs.

## Notes for the build (not G6 gaps)

- New harness names the cases rely on beyond tasks.md: Vitest names `A-04-TC-008` (`tcad-backbone.test.ts`), `A-04-TC-016` in `test/probes/tcad.test.ts`, `A-04-TC-018` in `test/travis/a04/cli.test.ts` and `pipeline/local-stack/test/loader.test.ts`, `A-04-TC-020 workflow|pilot|full` and `A-04-TC-026 import` in `gis-artifact.test.ts` (reading `GIS_ARTIFACT`). The builders (T010, T008, T020, T042, T043) must use these test names.
- TC-001 step 6 fixes the run-log line format `ANCHOR2 geoID=<geoID> pID=<pID> permit=<permit>` for T062.
- TC-006 assumes the `TcadBackbone` invocation key equals `{JOB_ID}` and the TCAD watermark row carries `job_id`; TC-046 assumes `backbone_runs.as_of` for the `--link` job. If the build keys differ, only the lookup changes.
- TC-023 step 4 uses `elephant-cli hash <dir> --output-car`; T079 confirms the CLI accepts the County-group directory (help text says "a single property ZIP archive").

Next: tick G6-8 in the test plan, record the decision and date, and add a row to the gate log in `docs/traceability.md`.

**Decision:** ☑ Approved ☐ Returned · Approved under Round 1 conditional approval, 2026-10-21 22:50 (D-11 "Approve if PASS (Recommended)"; conditions met: verdict PASS, 0 FAIL; only exceptions C-05/C-09).
