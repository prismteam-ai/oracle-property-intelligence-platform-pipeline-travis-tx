---
gate: G3
artifact: docs/architecture-constitution.md
artifact_version: 0.2
run_date: 2026-10-19
tool: Claude
verdict: PASS
---

# G3 pre-check: ARD-A (Architecture Approval), re-run for v0.2

Inputs read: `docs/architecture-constitution.md` v0.2, `docs/plan.md` v0.2, `docs/feature-list.md` v0.1.1, `.specify/memory/constitution.md` v3.0.3, `../assessment-guide/reference/A-oracle.md` § 3, `docs/decisions/0000-agent-architecture.md`, `.specify/extensions/git/README.md` and `git-config.yml`. The PO records the G3 decision; this check never approves.

**Since v0.1 (FAIL, 1 of 9):**
- Constitution 3.0.3 now says SSM in article VI, and feature list 0.1.1 says SSM in NFR-04, so D-01 is resolved.
- The PO confirmed AD-17 to AD-28 on 2026-10-19, including the AD-24 fallback.
- AD-29 (Spec Kit git workflow) and AD-30 / § 15 (playbook story-note overrides) were added.
- AD-20 now names the agent's retrieval as RAG over the published records.

| Check | Criterion | Result | Finding |
| --- | --- | --- | --- |
| C-01 | Style and diagrams | PASS | § 1 states the style; § 2 has C4 L1, L2, and L3 (`apps/api` and the pipeline). |
| C-02 | Decisions with rationale | PASS | § 3 has 30 decisions (AD-01 to AD-30), all Accepted, each with the options considered and the rationale. |
| C-03 | Boundaries | PASS | § 4 layer table and § 9 module table are complete and match constitution IV. The `infra/` departure is D-02 (Accepted). |
| C-04 | Integrations | PASS | § 8 names 18 external systems, each with its failure handling. |
| C-05 | NFRs measurable | PASS | § 10 has 18 rows, each with a threshold and a hosted verification method. The classifier accuracy check is a recorded human sample review (acceptable for a labelling metric). |
| C-06 | Deploy and rollback | PASS | § 11 covers deploy and rollback for web, API/infra, data and secrets. AD-29 adds the story-branch and preview workflow. |
| C-07 | P0 violations | PASS | § 12 has 20 P0 rules; rule 1 is the Task A access boundary. |
| C-08 | Golden Path conformance | PASS | No conflict with constitution 3.0.3: TypeScript (D-03 covers the vendored `.mjs`), CDK with the region from config, tRPC + Zod, Vercel AI SDK with `AI_PROVIDER`, Powertools, queued boundaries, SSM (VI and XII now agree), a documented PagerDuty substitute (IX). AD-29 matches articles XIX and XX and the git extension's `NNN-slug` convention; auto-commit stays off. |
| C-09 | No open questions | PASS | No `[NEEDS CLARIFICATION]` markers and no Proposed decisions remain. |

## Fix list

None needed for PASS.

## Notes (not failures)

1. **Order of decisions:** record G2 (the plan) first, then G3, because ARD-A's parent is PROJ-A.
2. **Score risks the architecture can't remove** (accepted as honest gaps):
   - few `resolved` contractors, because Austin prints names rather than official IDs;
   - BBB therefore appears only for resolved companies;
   - coverage lives inside the manifest rather than in a separate file (AD-04).

   Each is shown on screen with its reason. A-01 should look for an official Austin contractor ID that crosswalks to the Comptroller.
3. **Before A-14,** confirm the Bedrock model works with a live call. Constitution VI says so; `CLAUDE.md` is updated to match.
