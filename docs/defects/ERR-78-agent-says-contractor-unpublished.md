---
id: ERR-78
type: defect
feature: FEAT-A14
story: A-16
test_case: hosted agent.ask D-11 on Run 3 (02:45 EEST); unit pin apps/api/test/unpublished-fields.test.ts
ac_reference: AC-13 (A14-5 honesty answers from tool results)
severity: High
status: Closed 2026-10-26: two Api deploys (field list, then the system-prompt line); hosted D-11 re-ask on Run 3 no longer says contractor names are unavailable; missing[] holds only result/no_match
found_by: Claude (main session), asking the README prompts on Run 3, for HebaGaber
found_date: 2026-10-26
fix_branch: 016-cost-and-admin
fix_commit: 9dd7682 (field list), prompt line after it
retest_date: 2026-10-26
closed_date: 2026-10-26
---

# ERR-78: the agent said contractor names are not published (they are, since contract v1.1)

## Brief description
Asked the README follow-up (D-11) on Run 3, the hosted agent answered "Contractor names are not available in this run" with `missing: contractor.name_as_printed / no_lexicon_carrier`. Contract v1.1 publishes `contractor_name_as_printed` on `v_roofing_permit`, and Run 3 carries it for 4,139 of 15,025 permits. The agent's `UNPUBLISHED_FIELDS` list (and the `declareUnpublished` tool's description) still listed the field from before v1.1, so the model declared it unpublished.

## Fix
Removed `contractor.name_as_printed` from `UNPUBLISHED_FIELDS` (the tool's enum is built from it) and told the model in the tool description that the printed name is published per row, empty when a permit prints none. Unit pin: the field is not declarable, and the contract carries it.

## Second cause
After the first deploy `missing[]` was right, but the model still wrote "Contractor names are not available": the system prompt in `apps/api/src/agent/ask.ts` said "Contractor names and BBB ratings are likewise not available in the published export". That line now says the printed name is published per permit row ("no contractor printed on this permit" when empty); a unit test pins it.

## Re-test
After the next Api deploy: D-11 on Run 3 no longer says contractor names are unpublished; a permit row with a printed name shows it.
