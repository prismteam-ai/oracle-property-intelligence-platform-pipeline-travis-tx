# CR-A-14 final review: alakazam (retrieval quality and honesty)

Branch 014-agent-and-mcp, HEAD 3be4ff9. Read-only review. Previous score 85 on cf741bd.

## Score: 80 / 100 (gate needs 75: PASS)

Retrieval is honest by construction. The tools register every returned row up to 1,000. The server builds `matches[]` from row provenance only. `truncated` is surfaced, and the evidence file says plainly that G1-G4 are vacuous. The score is held down by three things:

- accumulation of exploratory rows and reasons across tool calls
- English-regex honesty sentences tuned to golden prompts
- no non-vacuous proof of recall or AC-8 on real rows

## Verified by running

- `packages/query-core`: `pnpm exec vitest run` gave 27 files passed, 375 tests passed, 6 skipped.
- `tests/agent`: `vitest run grader` gave 15 of 15 passed.
- I did not run `golden.test.ts` (it needs the deployed agent).

## Verified by reading

- `packages/query-core/src/tools/functions.ts`
  - `searchProperties` takes its rows and total from `exploreSearchSql` (Explore parity, lines ~215-235).
  - `field_not_published` is reported only when relaxing exactly one field provably unblocks the result.
  - An unresolved place or a point outside the Travis box returns `out_of_scope`. A wrong `manifest_cid` returns `run_not_found`.
- `apps/api/src/agent/tools.ts`
  - Every row is registered up to `MAX_REGISTERED_ROWS` = 1000. The model sees a 25-row projection with citation index `n`.
  - A row dropped by the registry sets `truncated`, which `ask.ts:361` turns into `missing {result, truncated}`.
  - The model-supplied `manifest_cid` is dropped.
- `apps/api/src/agent/citations.ts`
  - `postCheck` strips out-of-range `[n]` and unregistered CID-shaped tokens.
  - Matches are built only from row fields.
- The evidence file `docs/evidence/A-14-agent.md` opens with "Read this first". It states the small-run vacuity, the inconclusive `empty_reason` comparisons, and the regex-keyed server sentences. This is honest, better than typical.

## Findings

### Major

1. **`matches[]`, `missing[]` and `query` accumulate across all tool calls, including loosened retries.**
   - Evidence:
     - `tools.ts` projectEnvelope registers every row of every call into one registry.
     - `ask.ts:341-365` (`composeStructuredParts`) merges `applied` across envelopes and pushes `empty_reason` and `unknown_excluded` from every envelope.
   - Effect: if call 1 is empty and call 2 (relaxed) returns rows, the response carries `matches` from the relaxed filter next to `missing {result, no_match}`. `query` is a union, and later calls overwrite earlier keys. The user-visible filter claim can then differ from why a given row matched.
   - ERR-61 showed that the model loosens filters. `describeFilterChanges` only partly covers this (T050 is open).
   - Fix: take `matches[]`, `query` and `missing` from the last successful envelope, or tag each match with the call that produced it.
   - The grader cannot see this on the small run. Correctness only checks that matches are a subset of the oracle set for the golden filter, and that is vacuous.

2. **Honesty rules are English-regex patches keyed to golden prompts.**
   - Evidence: `ask.ts:315-330` (contractor/BBB, out-of-area owner, "many years") and `ask.ts:723-746` (appended fixed sentences).
   - Effect: a paraphrased question skips the deterministic disclosure and relies on the model. It also risks overfitting G2/G4/G5. T049 is open.
   - Documented honestly in the evidence, but it is a real recall-of-disclosure gap.
   - Severity is Major rather than Critical because the system prompt also carries the rules, and the tool-level `empty_reason` and `unknown_excluded` are structural.

### Minor

3. **`unknown_excluded` is radius-wide, not conjunctive.**
   - Evidence: `functions.ts` unknownCounts query `WHERE radiusWhere AND p.field IS NULL`.
   - Effect: it counts every in-radius row with a null field, not rows that would otherwise match the other filters. The tool description says "rows left out because a filtered field is null". A non-zero count overstates the exclusion. A zero count is correct.
   - The `field_not_published` logic, by contrast, is correctly conjunctive.

4. **Defect records ERR-61, 62, 63 are inconsistent.**
   - Front matter says `status: Closed` with fix commits.
   - The Resolution tables still read "Root cause: not investigated (reported only)", with an empty Fix and Re-test, and unchecked status boxes (`docs/defects/ERR-61.md:74-77`, `ERR-63.md:73-76`; check ERR-62 likewise).
   - Fix the tables to match the front matter.

5. **Grader limits.**
   - `empty_reason` is compared with the oracle, not with the agent response (the response has no such field). The evidence says so.
   - Recall is capped at the top 25 and never exercises the 1,000-row path.
   - `tests/agent/grader.ts` has no truncation check.
   - No non-vacuous recall exists except G5, which has 1 row.
   - The AC-8 Explore leg is "not measured" (recorded). The parity test covers fixtures, and T044 (more than 25 rows) is open and carried to A-16.

6. **G1 answer speculates.** It says "Roof age data may not be populated... roofs replaced within 15 years" with no basis in the envelope. The claim is hedged, but ungrounded.

7. **`permit_number` lookup path.**
   - It sets `returned: 1, total: 1` and reads `rows[0]` only.
   - Permit numbers are not unique across counties. This is fine for the Travis-only scope but undocumented.

## Recorded exceptions (judged on how honestly they are documented)

- Full-county timeout, ERR-64 burst 503, and G1-G4/G6 vacuous on the small run are all documented candidly. ERR-64 has a DEC file and keeps TC-021 red on purpose. The evidence file leads with limits. Good practice.
- Dimension subtotal: documentation honesty 9/10.

## Not verified

- Hosted agent behaviour, Bedrock, AWS, and a golden rerun.
- Real-row recall at full-county scale.
- ERR-62 resolution table (skimmed only).
