# CLAUDE.md: oracle-property-intelligence-platform-pipeline-travis-tx

This repo is a PrismTeam assessment task (Task A). `README.md` is the assignment, and its Demo Transcript is the evaluator's script. The `soofi-xyz-team-kit:slowking` agent scores it; a missing PR, hosted URL, credentials or demo video means 0/100.

The user is a technical product manager. Explain steps in plain language, say what each command does before running it, and ask before anything hard to reverse.

## Read before acting

- `../assessment-guide/PLAYBOOK-A-oracle.md`: **the steps, in order.** Planning P1–P8, the six-stage story loop, the build order with story notes, release R1–R7.
- `../assessment-guide/AGENT-MAP.md` § 4: the agents that design, build, review and verify each story.
- `../assessment-guide/reference/A-oracle.md`: facts (architecture, data contract, backlog, demo map). `reference/checks.md`: validation scripts, golden queries, conformance checklist.
- `../assessment-guide/PUBLISHING.md`: accounts, hosting, IPFS publication, PR and demo.
- Templates: `../assessment-guide/templates/`. Design system: `../assessment-guide/design-system/` (Atlas, Material 3, mobile-first).

## Branches and PR

- Feature branch: `feature/oracle-pipeline`. PR from `{fork}:feature/oracle-pipeline` to `prismteam-ai/oracle-property-intelligence-platform-pipeline-travis-tx:main`. Never commit to `main`, never merge the PR.
- Each story has its own branch `NNN-slug` (listed in AGENT-MAP.md), created by `/speckit-specify`. Merge it back with `git merge --no-ff` only after its G7 pre-check passes and the user approves, then run `bash scripts/progress.sh`.
- Commit messages start with the story ID: `A-03: ...`.
- Never write `#` followed by a number in commit messages, PR text or GitHub comments (write `F-8` or "finding 8"). This repo is a fork of `prismteam-ai/oracle-property-intelligence-platform-pipeline-travis-tx`, so GitHub links `#9` to PR or issue #9 there, often another candidate's submission, and the link cannot be removed after the push.
- Hosted runtime: `https://countylens.{domain}`, plus Amplify branch previews for story branches. localhost is never evidence.

## Rules

- `.specify/memory/constitution.md` is binding (articles I–XXIII plus the Task A addendum), and so is `docs/architecture-constitution.md` once G3 approves it.
- **Kit-agent ownership (constitution XIII–XVII):** every story's front matter names `agents.design`, `agents.builder`, `agents.reviewers`, `agents.verify` and `skills`. Consult the design agents read-only and save their answers in `specs/{NNN-slug}/agent-design.md` before `/speckit-plan`. In `/speckit-implement`, delegate each task group to the builder as the `soofi-xyz-team-kit:{builder}` subagent, loading its skills plus `apply-engineering-guidelines`. Before G7, every reviewer agent scores the branch (0–100, at least 75) in `docs/reviews/CR-{ID}.md`.
- Gate pre-checks are the `developmentsupport-*` skills. They report gaps only; the user approves.
- Use only the kit-bundled Elephant skills (`soofi-xyz-team-kit/skills/`). Never use `../skills` (deprecated upstream copy).
- UI uses only Atlas tokens and components. Every data display shows provenance, and missing data says why.
- Publish only `elephant-cli` output; never publish or expose the Query DB. CIDv1 only; published CIDs never change. Stop on BBB 403s; no CAPTCHA bypass.
- Never: secrets in git or logs, invented or synthetic data presented as real, Python outside PySpark/Glue, non-CDK IaC, direct LLM provider SDKs (use the Vercel AI SDK; provider set by `AI_PROVIDER`), merging the PR.

## The story loop (summary of the playbook's Part 2)

1 Ready: G4 pre-check → 2 Spec: `/speckit-specify`, `/speckit-clarify` → 3 Agents design: design agents → `agent-design.md` → `/speckit-plan` → `/speckit-tasks` → `/speckit-analyze` → test cases → G5 + G6 pre-checks in parallel → 5 Build + review: `/speckit-implement` via at most 4 builder groups → unit tests → one review round: `/code-review medium` + reviewer agents in parallel → 6 Prove live: deploy → Playwright on the hosted URL (+ `smeargle` on changed pages for UI) → evidence → `/speckit-converge` once → G7 → merge --no-ff. Light lane since 2026-10-21 (no `/speckit-checklist`; rules L1–L8 in `../assessment-guide/PLAYBOOK-A-oracle.md`).

## AWS (demo project)

- Profile `assess`, account `515618610572`. If credentials expire, run `aws login --profile assess`.
- The project is region-locked to **`eu-north-1`**: create every resource there. Only CloudFront, WAF and CloudWatch Logs may use `us-east-1`. Read the region from config (company default `us-east-2`); never hard-code it.
- Free plan ($120 credits, ends 2027-04-16): AWS stops access when credits run out. If something that worked suddenly returns "Access Denied", check the plan and credits (`aws freetier get-account-plan-state`) before debugging the code.
- AI models, always through the Vercel AI SDK: `AI_PROVIDER=bedrock` uses `eu.` inference profile IDs; `AI_PROVIDER=gateway` uses Vercel AI Gateway IDs (`anthropic/claude-sonnet-4.6`, `amazon/titan-embed-text-v2`). Bedrock Claude (`eu.anthropic.claude-sonnet-4-6`) works and is the default (quota raised 2026-10-17, confirmed by the PO 2026-10-19). The Gateway is the fallback for Claude (needs a paid top-up) and serves embeddings. Local key: `~/.config/assessment/ai-gateway.env`. Never print or commit it.
- The constitution wins over any AWS skill advice: CDK only (no AWS Blocks, no Amplify Gen2 backends, no console-created resources).
