---
gate: G4
artifact: stories/A-02-data-contract.md
artifact_version: "Ready rev 2 (2026-10-20, run-1 fixes applied; uncommitted until the story branch exists)"
run_date: 2026-10-20
tool: Claude
verdict: PASS
---

# G4 pre-check (run 2): A-02 Freeze the property-intelligence data contract

Inputs read: the story (rev 1); `docs/feature-list.md` (FEAT-A02, DEP-02, DEP-09, amendment 0.2); `../assessment-guide/AGENT-MAP.md` § 4 (row A-02); `../assessment-guide/reference/A-oracle.md` § 5; `docs/progress.md` (A-01 Done 2026-10-20); `docs/architecture-constitution.md` (§ 3 AD-07, AD-08, AD-24, AD-25, AD-26, AD-30; § 5; § 12; § 15); `.specify/memory/constitution.md` v3.0.3; the PO memory rule "no official requests". No design screen is needed (`ui: false`).

| Check | Criterion | Result | Finding |
| --- | --- | --- | --- |
| C-01 | Front matter | PASS | All fields filled. Agents (design mew, oracle · builder oracle · reviewers oracle, donphan · verify) and skills `use-oracle`, `use-neutral-lexicon` match AGENT-MAP row A-02; `apply-engineering-guidelines` is the CLAUDE.md implement extra. |
| C-02 | User story form | PASS | As a Roofing CRM developer / I want / so that present; the independent test names three commands with exact expected results. |
| C-03 | GWT | PASS | AC-1 to AC-8 are all Given / When / Then (AC-6 has two Given/Then pairs). |
| C-04 | Observable and real | PASS (justified exception) | A-02 is a `Project` feature (FEAT-A02) with `ui: false`, and there is no hosted runtime until A-03. The proof is in the PR: the carrier record, the Vitest output and the `sample.parquet` count. It is shown live later by A-13 (SQL panel) and A-15 (MCP `get_schema`). Every number is real Travis/Austin data with a date (22,084, 52, 2,380,725, GEOID 4857176). PO accepted the exception 2026-10-20. |
| C-05 | Scale + honesty | PASS | Scale: AC-5 (full Austin dataset, 2,380,725 rows). Missing data: AC-7 (a reason instead of a blank). |
| C-06 | Testable | PASS (run 2) | Run 1 FAIL, fixed: four ACs could be judged differently by two testers. **(a) AC-1** says "the lexicon extension request filed", but the PO rule "no official requests" and walkthrough D-8 call for a drafted, unfiled request. A tester cannot tell which one passes. **(b) AC-3** "a random sample of 25 classified Austin permits" does not name the population or the judge. Sampling from all 2.38 M permits would be almost entirely obvious non-roofing and would never test the excludes. "At most 5% in `needs_review`" does not say 5% of what. **(c) AC-5** "within the profile's recorded expectation (22,084 … minus excludes)" has no tolerance, and the dataset grows daily, so the exact figure cannot be re-measured. **(d) AC-8** does not say what one row of `sample.parquet` is. "At least one stalled reroof and one property with roof age" mixes permit rows and property rows, but one Parquet file has one shape. |
| C-07 | Edge cases | PASS | Four edge cases: lexicon tools down, carrier not emitted, unknown status word, straddling place. |
| C-08 | Requirements traced | PASS (run 2) | Run 1 FAIL, fixed (fix 5). Run 1 finding: Every FR and NFR traces to an AC, and the NFRs have thresholds. But **FR-003** says "CI grep gate", and A-02 has no CI (it arrives with A-03), so FR-003 cannot pass inside this story as written. |
| C-09 | Prototype | PASS | Not a UI story. The downstream screens are named (`ExploreQ-sql`, `SearchBox`, `HelpMcp1440`). |
| C-10 | Ready | PASS (justified exception) | A-01 is Done (`docs/progress.md`, merge `6c1383a`). The pilot `tables-export.json` that AC-1 and AC-2 need does not exist yet; A-02 makes it locally (walkthrough stop D-3). There is no `[NEEDS CLARIFICATION]` outside the checklist label. |
| C-11 | Slicing | PASS | One primary evaluation point (A5, with A6 secondary), 1 day. It is an enabler slice under the C-04 exception. The scope is large for one day (four views, profile, gazetteer, pilot, sample), which is a risk but not a FAIL. |

## Exceptions (same pattern as A-01)

- **C-04 (hosted observability).** A-02 is a `Project` feature (FEAT-A02, `ui: false`); the hosted site arrives with A-03. Observable in the PR: `docs/decisions/0002-lexicon-carriers.md`, the `pnpm vitest packages/query-core` output, and `duckdb -c "SELECT count(*) FROM 'contract/v1/sample.parquet'"` = 20. Shown live later by A-13 (SQL panel) and A-15 (MCP `get_schema`). Accepted by PO: ☑ · 2026-10-20 (HebaGaber)
- **C-10 / G4-8 (dependencies done).** A-01 is merged. The pilot tables are made inside A-02 (stop D-3), from real data only, local, with no upload. Accepted by PO: ☑ · 2026-10-20 (HebaGaber)

## Fix list (ordered by impact on the assessment score)

1. **AC-1, plus the matching Description bullet:** replace "the lexicon extension request filed" with "a lexicon extension request drafted in `0002-lexicon-carriers.md` (filing it is a PO decision; not filed by default)". *This changes what AC-1 requires, so the PO decides it (D-1).*
2. **AC-3:** name the population, the seed and the judge: "a random sample of 25 permits (seed recorded) drawn from the Austin permits whose description or work class mentions ROOF, so the excludes are exercised, each shown with the profile's verdict; the PO marks each one right or wrong. At least 24 of 25 are right, at most 1 of 25 (≤ 5%) is `needs_review`, and 0 solar/PV/RTU permits are accepted as roofing."
3. **AC-5:** replace "within the profile's recorded expectation" with: "the reroof candidate count equals the live include-term match count minus the excluded rows, both measured in the same run and recorded in the profile with their date (baseline 22,084 matches on 2026-10-19)".
4. **AC-8:** say what one row is: "each of the 20 rows is one roofing permit from `v_roofing_permit` with its property's `v_property` columns".
5. **FR-003:** "… (no `LIKE '%ROOF%'` in views; enforced by a Vitest test in A-02 and by the CI grep gate from A-03)".
6. Record PO acceptance of the C-04 and C-10 exceptions.

## Run 2 (2026-10-20)

PO decisions at D-1 (2026-10-20): fix 1, "Drafted only"; fixes 2–5, "Apply, Ready if PASS". All six fixes are applied to the story (Description bullet, AC-1, AC-3, AC-5, AC-8, FR-003, and the Evidence line to match AC-1). Re-check: C-06 and C-08 now PASS, and the other checks are unchanged. **Verdict: PASS, 0 FAILs**, with the C-04 and C-10 exceptions accepted by the PO.
