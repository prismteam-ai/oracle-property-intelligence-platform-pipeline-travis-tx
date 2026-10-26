# G0 pre-check: VIS-A (docs/01-intent.md v0.1)

Skill: `developmentsupport-vision` · Date: 2026-10-17 · Assignment: `README.md` at `e778d6f` · **Verdict: PASS with 4 warnings** · The product owner makes the G0 decision.

| # | Criterion | Result | Finding |
| --- | --- | --- | --- |
| G0-1 | Problem stated independently of any solution | PASS | § 2 names no technology. "Retrievable from the public network" and "no ongoing infrastructure cost" are README constraints, not design choices. IPFS, DuckDB and MCP appear only in § 1's task read, § 4 (README-mandated proof) and § 10. |
| G0-2 | Target users and stakeholders identified | PASS | Six actors in § 3, each with a need: CRM developer, agent, sales rep, Oracle operator, independent retriever, evaluator. |
| G0-3 | Business value articulated | PASS | Revenue, cost and risk drivers in § 5. Magnitude is partly measured (22,083 reroof permits); the aged-roof count waits on the TCAD roll (ASM-6). |
| G0-4 | Feasibility checked; no unmitigated blocker | PASS | Each risk in § 6 has a mitigation. See warnings W1 and W2. |
| G0-5 | Scope boundaries stated | PASS | § 7 lists in and out of scope, each exclusion with a reason. |
| G0-6 | Evaluation points sum to 40 and are observable | PASS | A1 10 + A2 6 + A3 6 + A4 7 + A5 6 + A6 5 = 40. Each has a live-runtime proof. The evaluator catalog's signals (canonical entities, RAG-backed retrieval, scale) are folded into A2, A6 and A1. |
| G0-7 | Every README acceptance criterion maps to a point | PASS | 47 acceptance criteria (AC-1 to AC-47) and 12 demo lines (D-1 to D-12), each tagged A1–A6 in `docs/traceability.md` § 1. No row is untagged. |
| G0-8 | No `[NEEDS CLARIFICATION]` left | PASS | None. Unknowns are assumptions ASM-1 to ASM-10, each with a test. The access questions were resolved as working assumptions on 2026-10-17 (§ 12). |
| G0-9 | AI pre-check | PASS | This report. |

## Number check

Every number in the intent has a source:

| Number | Source |
| --- | --- |
| 2,380,507 Austin permit rows; latest update 2026-10-16T15:08Z | Live Socrata query on `3syk-w9eu`, 2026-10-17T10:00Z |
| 22,083 reroof-description permits | Live Socrata query, same time |
| 63,019 permits without `tcad_id` (2.6%) | Live Socrata query, same time |
| 52 `work_class = 'Roof'` permits; Lakeway 6,825; Bee Cave 4,822 | `reference/A-oracle.md`, verified 2026-10-15 |
| 2,000 features per GIS request | `reference/A-oracle.md` |
| 2026-10-11 start | Upstream first commit, `docs/00-timeline.md` (provisional) |

**Unsupported numbers:** none.

## Warnings (do not block G0)

- **W1: TCAD access.** `traviscad.org/publicinformation` returned HTTP 403 from this machine on 2026-10-17, while `PUBLISHING.md` recorded 200 the same day. TCAD is the property backbone (A1 carries 10 points). Story A-01 must confirm a working, terms-compliant download path first, falling back to the US runner. Never use evasion.
- **W2: Domain.** Route 53 refused domain registration on this Free plan account, and no hosted zone exists. `CLAUDE.md` and the playbook assume `https://explorer.{domain}`. Decide before story A-03: register a domain elsewhere, or use the Amplify URL (ASM-8).
- **W3: Figure drift.** The guide says about 1.6% of Austin permits lack `tcad_id`; today's live count is 2.6% (63,019 / 2,380,507). Use the live figure, and update `reference/A-oracle.md` if you keep it.
- **W4: Cost has no point of its own.** "No ongoing Oracle infrastructure cost" appears in 4 README items (AC-20, AC-44, the context, the description) but is folded into A4. If the evaluator treats it separately, A4's proof (cost view plus billing screenshot, story A-16) still covers it.
