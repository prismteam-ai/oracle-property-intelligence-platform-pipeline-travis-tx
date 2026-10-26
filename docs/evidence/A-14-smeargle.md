# A-14 responsive tests (smeargle pattern, `responsive-design-tests`)

Run against the hosted preview `https://014-agent-and-mcp.d2lx0utip89u18.amplifyapp.com` (build `21e1ebf`, `/build.json` matched), project `a14-responsive`, spec `tests/e2e/A-14-responsive.spec.ts`. Result: **33 passed, 0 failed** (43 s).

Every state is a **stubbed response** (`[stubbed-response]` in the test title): the page is real and hosted, the agent and tool answers are canned from the real contract so that no model call is made. The states that cannot be provoked on demand (throttled, paused, limit reached, timed out) are only reachable this way. The genuine end-to-end asks are in `tests/e2e/A-14.spec.ts` (see the test report).

## What each test checks, at 390, 768 and 1440 px

- no horizontal page scroll; the 16 px side gutter at 390 px;
- interactive controls at least 48 px (links inside a sentence follow the WCAG 2.5.8 inline exception already used by the audit);
- text not clipped; the result JSON block stays inside the viewport (it may scroll inside itself);
- Atlas tokens only (colour, font, spacing, radius), audited from computed styles with `tests/e2e/lib/atlas-tokens.ts`;
- the state's own text and landmarks are present (for example the running timer, the provenance line, the error text).

## Results

| State | 390 | 768 | 1440 |
| --- | --- | --- | --- |
| Explore AI working | pass | pass | pass |
| Explore AI answered | pass | pass | pass |
| Explore AI no results | pass | pass | pass |
| Explore AI throttled | pass | pass | pass |
| Explore AI paused | pass | pass | pass |
| Explore AI timed out | pass | pass | pass |
| Explore AI limit reached | pass | pass | pass |
| Help · MCP try-a-tool idle | pass | pass | pass |
| Help · MCP try-a-tool running | pass | pass | pass |
| Help · MCP try-a-tool result | pass | pass | pass |
| Help · MCP try-a-tool error | pass | pass | pass |

Screenshots: `docs/evidence/img/A-14-responsive-{state}-{width}.png` (33 files).

## Defects found and fixed during the run

1. **Citation links `[1]`, `[2]`, `[3]` were 24 x 24 px at 390 px.** They were styled as inline-flex boxes, so the inline-link exception did not apply. They are now plain inline links sized by their line of text; the numbered rows they jump to are the full-size targets. Fixed in `apps/web/src/routes/ExploreAi.module.css` (commit `21e1ebf`).
2. **Help · MCP states failed the token audit (nine tests) on a background colour.** The colour was Atlas's own hover state layer on the "Try a tool" button, which the test had just clicked and left the pointer over. This was a test artefact, not a page defect: the test now moves the pointer away and audits the resting state.

Both failed in the first run of this project (10 failed, 23 passed) and passed in the second (33 passed).

## Not covered

- The MCP endpoint itself (`/mcp`) is not a page: smeargle is N/A for it.
- No real-agent state is tested here; with the latest run the real agent ends in the timeout error state, which `A-14.spec.ts` covers.
