---
gate: G4
artifact: stories/A-07-enrich-reconcile.md
artifact_version: "861efa1 (merged 2026-10-21; last commit touching the story); fixes applied 2026-10-22, pre-merge"
run_date: 2026-10-22
tool: Claude
verdict: PASS (with exceptions recorded below and at D-1)
---

# G4 pre-check (run 1): A-07 Enrich and reconcile: contractor identity, BBB ratings, business and places data, duplicate merge and roof age

Inputs read: the story (`stories/A-07-enrich-reconcile.md`, 19 ACs, tracks A/B/C/D); `docs/feature-list.md` (FEAT-A07, FEAT-A08, FEAT-A09, FEAT-A10 and DEP-04 to DEP-06); `../assessment-guide/reference/A-oracle.md` § 10 (demo map); `../assessment-guide/AGENT-MAP.md` § 4 (row A-07); `.specify/memory/constitution.md` (Part 2, Task A addendum); `docs/progress.md`; `docs/evidence/A-02.md` (carrier verdicts); `docs/evidence/A-03.md`; `docs/evidence/A-04.md` (anchor and join evidence); `docs/evidence/blocked/bbb-20261019T210855Z.md` and `docs/evidence/blocked/bbb-20261020T072323Z.md`; `pipeline/docs/travis-sources.yaml` (`tx_comptroller`). This report finds gaps; it does not approve.

## Gate exception (recorded once)

**C-04 hosted-runtime exception applies.** A-07 deploys nothing. Its proof is PR evidence (five-state counts, BBB probe log and 403 receipts, business counts vs source, roof-age audit and worked example), and it becomes visible on the hosted runtime only after A-11 publishes and A-13 reads it. Under this exception C-04 still checks that each AC is verifiable from PR evidence and uses real Travis County data. Two C-04 problems fail regardless of the exception (AC-15 anchor and the BBB date), see below.

**C-09 is N/A.** The story is pipeline-only (`ui: false`).

## Checks

| Check | Criterion | Result | Finding |
| --- | --- | --- | --- |
| C-01 | Front matter | FAIL | Filled and matching AGENT-MAP row A-07: design `[oracle, mew]`, builder `oracle`, reviewers `[oracle, donphan, porygon]`, verify text, and skills (the six AGENT-MAP skills plus `apply-engineering-guidelines`, which CLAUDE.md requires). **Gap:** `depends_on: [A-01, A-04]` is incomplete. Stories A-02 and A-03 are implicit dependencies: AC-9 requires "no lexicon carrier was confirmed in A-02" (the carrier verdicts live in `docs/evidence/A-02.md` lines 61–75), and AC-8, AC-11, AC-17 and AC-18 write `coverage` sections into the manifest that A-03 built. Not fixed here (per instruction). |
| C-02 | User story form | PASS | "As a roofing sales rep … I want … so that …" (Description). Independent test present, four numbered steps (Context / Independent test). |
| C-03 | GWT | PASS | AC-1 to AC-19 each have Given / When / Then. |
| C-04 | Observable and real | FAIL | Hosted-runtime exception applied (see above). Two findings remain. **(a) AC-15 uses an anchor that is absent from the roll.** AC-15 says: "**Given** TCAD id `0208011301` with open replacement permit 1982-012866 BP (`Suspended`)". Context line 54 repeats it: "TCAD id `0208011301` carries reroof permit **1982-012866 BP**". `docs/evidence/A-04.md` line 39 says: "0208011301 absent (0 rows)", and line 262: "unmatched, `no_tcad_geoid` (geoID 0208011301 is on no 2026 account)". A property with no TCAD account cannot receive a roof age, so AC-15 cannot be observed as written. **(b) The BBB date is wrong.** Context line 50 says "BBB answered with a Cloudflare bot challenge on 2026-10-17", and AC-7 says "(as seen on 2026-10-17)". No 2026-10-17 receipt exists. The measured receipt `docs/evidence/blocked/bbb-20261019T210855Z.md` is a plain **HTTP 403** at `2026-10-19T21:08:55.628Z`. The Cloudflare challenge (`cf-mitigated: challenge`) is in `docs/evidence/blocked/bbb-20261020T072323Z.md` (2026-10-20T07:23:23Z). |
| C-05 | Scale + honesty | PASS | Scale: AC-3 (22,084 candidates, 342,334 records), AC-8, AC-11, AC-17. Missing data or error: AC-4 (`contractor_not_printed`), AC-5 (`registry_unavailable`), AC-9 (`no_lexicon_carrier`), AC-13 (places not loaded), AC-19 (roof age unknown). |
| C-06 | Testable | FAIL | **(a) Comptroller scope contradicts the source contract.** AC-1 says "matches exactly one active **Travis** Comptroller legal name", AC-3 says "the **342,334 Travis** Comptroller records", AC-11 says "**342,334 Travis rows**". `pipeline/docs/travis-sources.yaml` line 1211 says: "statewide rows are the A-07 identity lookup set". Context line 48 gives "3,487,662 statewide", so the story records both but its ACs test only Travis. Two testers would count different populations for "the five-state totals sum to the permit total" (AC-3) and for the identity lookup (AC-1). **(b) AC-2 has a conditional Given.** "**Given** an official identifier crosswalk (if this story finds one Austin publishes)". If none exists, the AC has no defined outcome, and testers can disagree on whether it is N/A or failed. **(c) "active" is undefined** in AC-1 and the edge cases (`sos_status_code` is referenced only in an edge case). **(d) AC-7 names the wrong response:** "a 403 or a Cloudflare challenge (as seen on 2026-10-17)" (see C-04b). AC-15 is also not testable as written (see C-04a). |
| C-07 | Edge cases | PASS | 13 edge cases (ambiguous same-name records, non-active status → `conflicting`, abbreviation normalisation, BBB/Overture names never used for identity, NR profile, 403 halfway, robots disallow, county 227 outside Travis, Overture bounding box vs polygon, count change at watermark, two final permits, expired-stalled permit, invalid year built, no merge across TCAD ids). |
| C-08 | Requirements traced | PASS | FR-001 to FR-018 each trace to at least one AC. NFR-001 (0 unmatched `resolved`, sample 25), NFR-002 (0 bypasses), NFR-003 (100% licence, count = source), and NFR-004 (25/25, `rowsWritten: 0`) have thresholds. Note: NFR-002 maps to AC-7, which tests the 403 stop but not the "0 CAPTCHA bypass" threshold itself. Low impact. |
| C-09 | Prototype | N/A | `ui: false`. The Prototype reference section names the design screens that A-13 renders. |
| C-10 | Ready | FAIL | The listed dependencies are Done in `docs/progress.md` (A-01 and A-04 are both "Done"). The real dependency set is not complete: A-02 and A-03 are also Done, so no stub is needed, but the metadata does not say so, and "dependencies are done" cannot be checked for the full set. No `[NEEDS CLARIFICATION]` marker is present (the G4-9 checkbox text only). |
| C-11 | Slicing | FAIL | One primary evaluation point (front matter `eval_point: A1`; table "A1 (primary) · A2 · A5"). Vertical. **Size:** front matter `size_days: 2.5`, and line 41 "2.5 days (sum of parts: 0.5 + 0.5 + 0.5 + 1)". The criterion is 0.5–1.5 days. The merge of 2026-10-21 (feature-list amendment 0.2.1) is a PO decision, but it does not change the criterion. The user decides whether to record an exception or split it back into four stories. |

## Fix list (ordered by impact)

1. **C-04a / C-06 (AC-15 anchor, the story's headline roof-age example).** Replace `0208011301` / permit `1982-012866 BP` in AC-15 and Context line 54 with the anchor that is present and carries an open permit: pID `221829` / geoID `0223120506` with `2000-000025 BP` (`Re Review`, open; `docs/evidence/A-04.md` line 263, `pID 221829`). Keep `0208011301` only as the "no TCAD record" exclusion case, which is the A-04 documented negative (`no_tcad_geoid`, line 262), and say so in an edge case. Update the worked example in the evidence requirement (line 181) to use `0223120506`.
2. **C-11 (size 2.5 days).** Either split into four stories (A-07 track A, A-08 track B, A-09 track C, A-10 track D; each ≤ 1.5 days) or record a PO exception in the gate decision. This is a PO decision, not a wording fix.
3. **C-06 (Comptroller scope).** Decide and state one population. Recommended: AC-1 and AC-3 resolve against the statewide set (3,487,662 rows, the identity lookup set per `travis-sources.yaml` line 1211), and AC-11 counts the Travis subset (342,334 rows). Rewrite AC-3's totals to say which population they sum over.
4. **C-04b (BBB date).** Replace "2026-10-17" in Context line 50 and AC-7 with the measured receipts: HTTP 403 on 2026-10-19T21:08:55.628Z (`bbb-20261019T210855Z.md`) and Cloudflare challenge on 2026-10-20T07:23:23Z (`bbb-20261020T072323Z.md`).
5. **C-01 / C-10 (depends_on).** Change to `depends_on: [A-01, A-02, A-03, A-04]` and state why A-02 (lexicon carriers, AC-9) and A-03 (manifest `coverage` section, AC-3, AC-8, AC-11, AC-17, AC-18) are needed. All four are Done in `docs/progress.md`.
6. **C-06 (AC-2 conditional).** Add an explicit outcome for "no official crosswalk found": AC-2 is N/A and the evidence records the negative finding with the Austin source checked (Context, track A, "record the answer").
7. **C-06 (define "active").** State the Comptroller status rule (for example `sos_status_code` = active) in AC-1 and the edge cases.
8. **C-08 (NFR-002 threshold).** Add a 0-bypass check to AC-7 or a separate AC so NFR-002 traces to an AC that tests its threshold.
9. **Low (traceability note, not a gate fail).** The demo IDs in the story (D-3 totals by source, D-8 roof over 15 years, D-9 contractor and BBB on open permits) do not match the numbering in `../assessment-guide/reference/A-oracle.md` § 10 (#2, #7, #8). Confirm the README transcript numbering and align the labels.

After fixes 1, 3, 4, 5 and 6 are applied, C-04, C-06 and C-01 can be re-checked. C-11 needs the PO decision in fix 2.

## Resolution (round R1, PO decisions 2026-10-22)

| Fix | Disposition |
| --- | --- |
| 1. AC-15 anchor | **Applied.** AC-15, the Context paragraph, and the Evidence-to-capture line now use TCAD `0223120506` (pID 221829, permit `2000-000025 BP`). `0208011301` is kept only as a new edge case ("no 2026 TCAD account"). C-04a / C-06 (AC-15 part) now PASS. |
| 2. C-11 size (2.5 days) | **Accepted exception, no split.** D-1: Ready, approved as the merged story under the 2026-10-21 light-lane decision (one G4/G5/G6/G7 cycle for four parts, each still vertical and independently traced). Recorded here rather than re-asked. |
| 3. Comptroller scope | **Decided: keep Travis, not statewide** (D-1, PO decision 2026-10-22) — against this report's own recommendation. AC-1, AC-3 and AC-11 all resolve and count against the 342,334 Travis rows, as drafted. If Stage 3's `oracle` design agent shows material matches living outside Travis with evidence, that comes back as a numbered Stage-3 finding (D-6), not a silent change. C-06(a) PASS on this reading. |
| 4. BBB date | **Applied.** Context and AC-7 now cite the two measured receipts (403 at 2026-10-19T21:08:55.628Z; Cloudflare challenge at 2026-10-20T07:23:23Z). C-04b PASS. |
| 5. depends_on | **Applied** (D-0, PO decision 2026-10-22): `depends_on: [A-01, A-02, A-03, A-04]`, with the "why" stated in the story's summary table. C-01 / C-10 PASS. |
| 6. AC-2 conditional | **Applied.** AC-2 now states the fixture-only fallback and evidence requirement if Stage 3's crosswalk research (oracle R4, held for D-10) finds no Austin identifier. C-06(b) PASS. |
| 7. Define "active" | **Applied.** AC-1 now defines "active" as the Comptroller `sos_status_code` indicating active franchise-tax status, cross-referenced to the "conflicting" edge case. C-06(c) PASS. |
| 8. NFR-002 threshold | **Deferred, non-blocking.** AC-7 already traces to NFR-002 and tests the stop-on-403 behavior; a dedicated "0 bypass" assertion is left for the test-case draft (Stage 3/4) rather than a story rewrite. |
| 9. Demo ID numbering | **Deferred, non-blocking.** Low-impact traceability note; revisit if it affects evaluation scoring, not a gate blocker. |

**C-11 recorded as PO exception; every other check now PASSes.** G4 decision: Ready, 2026-10-22 (see the story's Gate G4 table for the full D-0 to D-4 record).
