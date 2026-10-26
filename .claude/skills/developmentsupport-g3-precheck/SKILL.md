---
name: developmentsupport-g3-precheck
description: Run the developmentSupport Gate G3 (Architecture Approval) AI completeness pre-check on docs/architecture-constitution.md. Use when the user asks to pre-check, validate or gate-check the architecture constitution, mentions Gate G3, or is about to move past this gate. Reports PASS/FAIL per criterion and never approves.
---

# Gate G3 pre-check: Architecture Approval

You are the AI pre-check for **Gate G3** of the developmentSupport lifecycle (see `assessment-guide/developmentSupport/README.md`). You find gaps. You **never approve**: the user records the decision.

**When:** after drafting the architecture constitution, before the first speckit-plan.

## Inputs (read all before judging)

- docs/architecture-constitution.md
- docs/plan.md
- .specify/memory/constitution.md
- the task guide's architecture section (02 § 3 or 03 § 3)

If an input is missing, report it as FAIL on the first check it affects and continue. Do not invent content to fill it.

## Checks

| Check | Criterion | What PASS requires |
| --- | --- | --- |
| C-01 | Style and diagrams | Architecture style stated; C4 context, container and component diagrams present |
| C-02 | Decisions with rationale | Every key decision lists the options considered and why one was chosen |
| C-03 | Boundaries | Layer and module boundary tables are complete; nothing contradicts the Golden Path monorepo layout |
| C-04 | Integrations | Every external system (sources, gateways, Bedrock, Cognito, Task A outputs) is named, with its failure handling |
| C-05 | NFRs measurable | Each NFR has a threshold and a verification method on the hosted runtime |
| C-06 | Deploy and rollback | Deployment strategy and rollback steps are recorded |
| C-07 | P0 violations | P0 rules listed, including the task's access boundary |
| C-08 | Golden Path conformance | No conflict with .specify/memory/constitution.md (TypeScript, CDK with region from config (default us-east-2, demo eu-north-1), tRPC + Zod, Vercel AI SDK, Powertools, queued external calls) |
| C-09 | No open questions | No [NEEDS CLARIFICATION] markers remain |

Judge strictly but specifically: every FAIL must quote the offending text or name the missing item, and say what would fix it. Checks are also run against `.specify/memory/constitution.md` where it applies.

## Output

1. Write the report to `docs/gates/G3-{artifact-id}-precheck.md`:

   - front matter: `gate: G3`, `artifact: {path}`, `artifact_version`, `run_date`, `tool: Claude`, `verdict: PASS|FAIL`
   - the table above with a **Result** (PASS/FAIL) and **Finding** column
   - a short "Fix list" ordered by impact on the assessment score

2. Reply with the verdict, the number of FAILs and the fix list. Offer to apply the fixes, but change the artifact only if the user agrees.
3. When the verdict is PASS, remind the user to tick the gate's checklist in the artifact, record their decision and date, and add a row to the gate log in `docs/traceability.md`.

The verdict is PASS only if every check passes.
