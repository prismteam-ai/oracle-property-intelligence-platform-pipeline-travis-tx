---
name: developmentsupport-testcases
description: Draft QC test cases (testplans/{ID}-test-cases.md) from a story's Given/When/Then acceptance criteria, independent of tasks.md, with happy, negative, edge, missing-data and NFR cases that run against the hosted URL and map one-to-one to Playwright tests. Use when the user wants test cases, a test plan or QC cases for a story, or is preparing Gate G6.
---

# Test cases (Phase 4, Gate G6)

Fill `assessment-guide/templates/test-cases.md` and save it as `testplans/{ID}-test-cases.md`.

## Inputs

- The story file `stories/{ID}-{slug}.md` (G4 ready). Work from its ACs, edge cases and requirements.
- `specs/{NNN-slug}/spec.md`, for the FR numbering.
- The design screen linked in the story, for element names and messages.
- **Do not read `tasks.md`.** The test cases must stay independent of the implementation.

## Steps

1. **Requirement mapping.** Every AC and every FR maps to at least one TC.
2. **For each AC, write:**
   - a happy-path case;
   - a negative or missing-data case;
   - edge cases from the story;
   - an NFR case with a measurable threshold (e.g. p95 timing measured in Playwright).
3. **Write the steps.** Start every case with "Open `{RUNTIME_URL}{route}` in a private window" (Task B: then log in as `{TEST_USER}`). Use one action per step, name the exact element and the exact real data, and use `Action → Expected` where it helps.
4. **Expected results.** Give concrete values and messages, plus provenance or citations. Never write "works" or "test passes".
5. **Test data.** Use real Travis County records and name the data snapshot (manifest CID). For Task B leads, use run-scoped unique values and describe the cleanup.
6. **Automation mapping.** For each P1/P2 case, name the Playwright test (`tests/e2e/{file}.spec.ts › "{ID}-TC-00n …"`). Offer to scaffold the specs: one helper per step, and `test()` bodies that call helpers only. `playwright.config.ts` must refuse `localhost` as `RUNTIME_URL`.
7. **Self-check** with the checks in `developmentsupport-g6-precheck`, and report the verdict. The user, as QC Lead, approves.
