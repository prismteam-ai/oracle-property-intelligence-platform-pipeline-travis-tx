---
id: DEC-A-14-agent-mcp-full-county
type: decision
story: A-14
title: "Close A-14 with the agent and MCP server proven on the small published run, not on the full county; the gap moves to A-16 (PO exception, same cause as DEC-A-13-explore-full-county)"
superseded: "A-16 closed it on 2026-10-26: the agent and MCP read the per-run index; hosted D-10 on Run 3 answered in 15.5 s (28,062 matches), MCP search_properties 0.8–2.4 s (docs/evidence/A-16.md § Closure, A14-1)"
status: Approved by the PO (HebaGaber) on 2026-10-25 ("Close like A-13")
created: 2026-10-25
---

# Agent and MCP on the full county (A-14 exception)

## Decision

A-14 is closed and merged with the agent (`agent.ask`), the AI tab and the MCP server **proven on the hosted site against the small published run `travis-202609-permits-20261021t103516z`** (manifest `bafkreiasycmsr2qdlxqcfg3yc2conpn3jxmohz7gs55hkseipplhpqsk5i`), not against Run 1 or Run 2. On those two runs any tool call that reads property data ends in the Lambda timeout. The cause and the way to close it are the ones already recorded in `docs/decisions/DEC-A-13-explore-full-county.md`, and the gap is carried to A-16.

## Why (measured on the hosted site, 2026-10-25)

| Step | Result |
| --- | --- |
| Agent, latest run (Run 2), 1,769 MB, all four views bound | HTTP 500 at 25 s; Lambda used 1,768 MB of 1,769 MB |
| Agent, 3,008 MB, all four views bound | HTTP 500 at 25 s; 2,559 MB used |
| Agent, 3,008 MB, only the views a query reads bound (ERR-19 rule) | HTTP 500 at 25 s (Run 2), HTTP 500 at 25 s (Run 1) |
| Query API `explore.search`, Run 2 (the Explore page's own query) | HTTP 500 at 29 s, three tries in a row |
| Agent, pinned to the small run `travis-202609-permits-…` | answers (G1: an honest "no match", 0 results, nothing excluded) |

The agent's search tool uses the same Explore search query as the Explore page (reconciled in T030 so that the agent, the MCP tool and the page return the same properties). It therefore has the same full-county limit as A-13: the work is a join of `v_property` and `v_roofing_permit` over 441,961 properties inside one Lambda.

## Fixes made on the way (all deployed, all kept)

1. The route throttle settings named routes that CloudFormation had not created yet (first deploy rolled back cleanly); the stages now depend on their routes.
2. The Amplify `/api/<*>` rewrite pointed at the query API, which has no `/agent` route; a more specific `/api/agent/<*>` rewrite now points at the agent API.
3. The agent, MCP server and "Try a tool" proxy read the run list from an S3 key that is never published; they now fetch the site's own `/runs/index.json` (`RUNS_INDEX_URL`).
4. The agent role had no Bedrock permission; it may now invoke only the `eu.anthropic.claude-sonnet-4-6` profile, and the base model only through it (two statements, because the profile resource cannot carry the `bedrock:InferenceProfileArn` condition).
5. The agent and MCP Lambdas run at 3,008 MB (amendment AM-09 in `docs/architecture-constitution.md`).
6. The agent and MCP engines bind only the views a query reads (the rule of ERR-19).

None of 1 to 6 was visible to the unit, contract or CDK tests; each was found by the first hosted call.

## What works and what does not

- Works on the small run: the whole path (browser or MCP client, rewrite, API, run list, model call through the AI SDK and Bedrock, tools, citations, honest empty and missing-data answers).
- Does not work: any question that reads property data on Run 1 or Run 2. The agent ends in HTTP 500 after 25 s (its Lambda timeout; the AI tab shows an error state, the exact wording is recorded in the UI test evidence). The MCP data tools end at their own 15 s Lambda timeout with a bare gateway error, not a typed answer (no per-call deadline: a gap noted in the final review, not fixed here). `list_runs` and the 401 and 403 checks are unaffected; the burst behaviour (429 versus 503) is a separate, recorded deviation (ERR-64, `DEC-A-14-mcp-burst-503.md`).
- Nothing shows sample data. Answers on the small run are mostly "no match", and say so.

## How to close it (A-16, gap with A-13 item 1)

A per-run Explore index (a derived, private or published file with the columns the search reads) so the search, the agent and the MCP tools read it instead of joining the full tables. Estimated at 5 to 7 hours plus two or three hosted CI cycles, as in the A-13 record. When it exists, the golden queries G1 to G6, the AC-8 three-way comparison and the MCP checks should be re-run on Run 2 and the cases marked in the A-14 test report as "full-county gap" should turn green.

## What the evaluator will see

The AI tab and the MCP server respond on the hosted URL, with citations and honest empty answers, when the run is the small one; on the latest run they show an error state. The A-14 test report and evidence list each affected case as failed or not run on the full county, with this record as the reason.
