---
gate: G4
artifact: stories/A-01-discover-sources.md
artifact_version: "Draft rev 3 (2026-10-19, after run-2 fixes; uncommitted)"
run_date: 2026-10-19
tool: Claude
verdict: PASS
---

# G4 pre-check (run 3): A-01 Discover Travis County sources and pass readiness preflight

Inputs read: the story (rev 3); `docs/feature-list.md` (FEAT-A01, NFR-07, A-1, A-6, DEP-01); `../assessment-guide/AGENT-MAP.md` § 4 (row A-01); `../assessment-guide/reference/A-oracle.md` § 4, § 6, § 10; `docs/progress.md`; `docs/architecture-constitution.md` § 7–8; `.specify/memory/constitution.md`; kit skill `county-readiness-preflight`; `stories/A-11-full-publish.md` AC-4 and `stories/A-13-explorer-ui.md` AC-1/AC-2; `.gitignore` (`pipeline/data/` ignored). No design screen is needed (`ui: false`).

History (all 2026-10-19): run 1 failed C-04, C-06, C-08; run 2 failed C-06 (no allowed source for the roll count; mixed decision words). Both sets of fixes are applied; C-04 is a justified exception.

| Check | Criterion | Result | Finding |
| --- | --- | --- | --- |
| C-01 | Front matter | PASS | All fields filled; agents and the four skills match AGENT-MAP row A-01 (`apply-engineering-guidelines` is the CLAUDE.md implement extra). |
| C-02 | User story form | PASS | As / I want / So that present; independent test covers both the pass and the blocked outcome. |
| C-03 | GWT | PASS | AC-1 to AC-7 are all Given / When / Then. |
| C-04 | Observable and real | PASS (justified exception) | A-01 is a `Project` feature (FEAT-A01, approved at G1) with no direct UI. Its proof is the committed YAML, `docs/sources.md` and validator JSON in the PR (AC-7). Hosted display is checked by A-11 AC-4 (manifest `coverage`) and A-13 AC-1/AC-2 (Runs, Coverage). All numbers are real Travis County figures with dates. PO acceptance still to be recorded (see Exceptions). |
| C-05 | Scale + honesty | PASS | Scale: AC-4 (every jurisdiction vs the Census expected count) and AC-2 (2.38 M rows, backfill hours). Error: AC-6 (403 / timeout → `blocked`, `WAITING_HUMAN`, defined outcome). |
| C-06 | Testable | PASS | AC-3 now names its input: the Certified Special Export (JSON), downloaded once with size, SHA-256 and capture time, counted but not loaded (Out of scope allows exactly this plus the Export Layouts). If the download is blocked, AC-6 defines the outcome. Decision words are the same in the Description, AC-2 and AC-5 (`bulk download` / `ingest` / `runtime retrieval`). AC-1 names the validator command and its exit conditions; AC-4 names the expected set (Census places + unincorporated). |
| C-07 | Edge cases | PASS | Four edge cases; the layout-comparison case is supported by the Export Layouts allowance. |
| C-08 | Requirements traced | PASS | FR-001 to FR-005 and NFR-001 trace to ACs; NFR-001 has thresholds (concurrency ≤ 2, 0 CAPTCHA bypasses; backoff 1 s / 60 s / 5 attempts). The Description and Out of scope agree on the single TCAD download. |
| C-09 | Prototype | PASS | Not a UI story; downstream screen named. |
| C-10 | Ready | PASS | `depends_on: []`; local stack exists (commit 1027cfd); no `[NEEDS CLARIFICATION]` outside the checklist label; the raw download folder is gitignored. TCAD 403 is handled by AC-6. |
| C-11 | Slicing | PASS | One primary evaluation point (A1), 1 day; enabler slice accepted under the C-04 exception. |

## Exceptions

- **C-04 (hosted observability).** A-01 is a `Project` feature (FEAT-A01, class approved at G1): it produces a source catalog and a validator result, not a screen. Its proof is the committed `pipeline/docs/travis-sources.yaml`, `docs/sources.md` and validator JSON report in the PR (AC-7). The same counts and limitations reach the hosted runtime through the manifest `coverage` section (A-11 AC-4) and the Runs and Coverage pages (A-13 AC-1, AC-2), which are checked there. Accepted by PO: ☑ · 2026-10-19 (HebaGaber)

## Fix list (ordered by impact on the assessment score)

No blocking gaps. One open action:

1. ~~Record PO acceptance of the C-04 exception.~~ Done 2026-10-19 (HebaGaber).
