---
gate: G7
artifact: branch 011e-run3-1-permit-contractors (A-11 Run 3.1 corrections: ERR-72, ERR-73, ERR-74, contract v1.2)
artifact_version: 49d6f41 (CI) + documentation and test commits after it (CI re-run on the final commit before the merge)
run_date: 2026-10-26
tool: Claude
verdict: PASS
---

# G7 pre-check: A-11 Run 3.1 corrections

Scope: the Run 3.1 correction of story A-11 (already Done; Run 3 G7 in `G7-A-11-run3-precheck.md`). Run 3.1 is published: `travis-full-run3-1-20261025`, manifest `bafkreidbqsav3rsbxqy5fx3li73uskfth254nz5zw34xwac5w3fd4tmbai`, all 8 publish steps with receipts, listed in `runs/index.json`.

| Check | Criterion | Result | Finding |
| --- | --- | --- | --- |
| C-01 | Tasks done | PASS | `specs/011-publish-and-runs/tasks.md`: 37 of 37 checked, 0 open. Run 3.1 is a defect correction tracked by ERR-72, ERR-73, ERR-74 (no new tasks), as Run 2 and Run 3 were. |
| C-02 | Unit tests | PASS | `docs/reports/A-11-unit-test-report.md` § Run 3.1 addendum: publish 408, query-core 439, contract 58, web 537, oracle-runtime permits 31, local-stack contractor-coverage 6, all passing. CI run `40272932002` on `49d6f41`: workspace (typecheck, lint, test, synth) success. Coverage of changed code: publish 92.55 % statements (run-manifest 97.6 %, publish-run 92.3 %, manifest 92.7 % lines); `contractor-coverage.ts` 76.8 % lines, every exported function covered, the uncovered lines are the command-line entry (environment and database connection), and the real run reproduced the published counts. Aggregate over the changed code is above 80 %. |
| C-03 | Code review | PASS | `docs/reviews/CR-A-11-run3-1.md`: all four `agents.reviewers` scored at least 75 (oracle 70 → 80, donphan 77, machamp 78, porygon 82); `/code-review medium` run (10 findings, none Critical). Fixed before the merge: 7 code-review findings and every reviewer finding rated High or Medium except those recorded as carried to A-16 (tooling only, no published data affected). Zero open Critical findings (constitution XVI). |
| C-04 | TC executed on hosted URL | PASS | CI run `40272932002`: all seven `e2e-hosted` jobs (site, manifest, permits, isolated, a13-pages, a13-explorer, a13-scan) success against the Amplify branch URL after `/build.json` reported sha `49d6f41` (the job waits for the Amplify build of the commit). Laptop run on the same preview (sha `3437d23`): runs, manifest, verify-manifest specs 12 passed, 1 skipped; A-03-TC-004 needs the CI runner's bandwidth (ten 400 MB CARs) and passed in CI. Nothing ran on localhost. |
| C-05 | Defects closed | PASS | ERR-72, ERR-73, ERR-74: status Closed, re-test 2026-10-26, closed 2026-10-26 (Run 3.1 published). The two hosted failures found on the way (TC-003 expecting the old registry note; web tests expecting 58 sample columns) were fixed in the branch and pass in CI. |
| C-06 | No open Critical | PASS | No Critical defect or finding is open. |
| C-07 | Evidence | PASS | `docs/evidence/A-11.md` § Run 3.1: hosted URL (Amplify branch preview), observed counts (441,940 situs; 408,780 properties with an owner ZIP; 4,552 contractor permits; five-state totals; table comparison), publication receipts (8 steps), public readback; screenshot `docs/evidence/img/A-03-TC-010-3-run-card.png` (Runs page lists `travis-full-run3-1-20261025`). Trace id: none, as for Run 3 (no Lambda is deployed by this story; walkthrough § 1 exception recorded for C-07). |
| C-08 | Traceability | PASS | `docs/traceability.md` § Run 3.1 correction (decisions, defects, criteria, evidence); `docs/kit-usage.md` rows for oracle, donphan, machamp, porygon and code-review (Run 3.1). Gate-log row added at the merge. |
| C-09 | Commits | PASS | All 23 first-parent commits on the branch start with `A-11`; none writes `#` followed by a number. gitleaks success in CI. The only credential-shaped line in the diff composes a token from environment variables at run time. |
| C-10 | Story status | PASS | `stories/A-11-publish-and-runs.md` is already `status: Done`; Run 3.1 adds no story scope. |

## Fix list

None blocking. Carried to A-16 (recorded in `docs/reviews/CR-A-11-run3-1.md`): retry wrapper built into `publish-run.ts` with a per-attempt time limit; `registryNote` from the coverage report; five-state contractor keys in the monthly run; address-point receipt check; registry match counts reconciliation; a per-row flag for person names in `company`; one-off workflow permissions and the re-export done marker.

## Decision

The PO approved this merge in advance on 2026-10-26 ("once you are done ... merge this branch to oracle pipeline without my approval"), conditional on this pre-check passing. Gate-log row in `docs/traceability.md`.
