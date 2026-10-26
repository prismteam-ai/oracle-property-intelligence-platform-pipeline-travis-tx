# Quickstart validation: A-14 agent + MCP server

Every check below runs against a **hosted** URL (the `014-agent-and-mcp` Amplify preview or, after merge, `https://countylens.aldarraj.com`) — never localhost (`playwright.config.ts` already fails on `localhost`). Prerequisites: the branch is deployed (Stage 6, 🛑 D-9), the MCP token exists in SSM (✋ A-2) and is loaded into `$MCP_TOKEN` (✋ A-4).

## 1. Agent — golden queries (G1–G6)

```bash
AGENT_URL="<hosted api url>/trpc/agent.ask" pnpm vitest run tests/agent
```

Expected: each of G1–G6 passes groundedness (every `property_cid` exists in the published run), correctness (every match satisfies the re-run `query-core` filter), recall ≥ 80% of the top-N, and honesty (assumptions + missing data stated); G6 returns zero matches with an out-of-scope sentence. Results and trace IDs land in `docs/evidence/A-14-agent.md`. On today's ≈37-row A-03 slice, several queries will honestly return `no_match` — that is a pass, not a failure (see `research.md`); full-county numbers are re-checked once A-11 merges.

## 2. Agent — Explore · AI tab (manual, once A-13's shell is merged)

1. Open `<preview url>/explore?mode=ai`.
2. Ask G1, then G2 as a follow-up. Expect: Working… (elapsed timer) → answer, "How I read this" chips (centre label + source, radius, thresholds), citations `[n]` linked to numbered rows, a missing-data list.
3. Edit the chip from 5 to 3 years; confirm the answer and `matches[]` both update.
4. Ask a 10th question in the session; confirm "0 of 10 AI questions left" and that only `answered` outcomes counted.

Until A-13 merges, step 2's contract is verified directly against `agent.ask` (asserting `outcome` values) rather than through the UI — see `design-ash.md` § "How to verify."

## 3. MCP — Inspector

```bash
npx @modelcontextprotocol/inspector
# connect to <hosted api url>/mcp with header: Authorization: Bearer $MCP_TOKEN
```

Expected: `tools/list` returns exactly the six AD-21 tools, AD-07 input names, under 500 ms. `search_properties({area:{place:"Pflugerville"}, radius_mi:5, roof_age_years_min:15})` returns rows with full provenance; the returned `property_cid`s match `agent.ask`'s G1 answer and the Explore page's own query for the same `manifest_cid` (AC-8). No token / wrong token → `401`. An unknown `property_cid` → `not_found`; `area:{place:"99999"}` → `out_of_scope`.

## 4. MCP — scale and security

- A query matching > 1,000 rows (county-wide stalled reroofs, once A-11 is live) → `truncated: true` + the true `total`.
- 20 consecutive `tools/call`s → p95 < 3 s. A burst above 5 rps/burst 10 → some `429`s.
- `gitleaks` in CI, plus a manual grep of the agent/MCP CloudWatch log groups and the hosted JS bundle for the token string → zero matches.

## 5. `donphan` through MCP only

Register the hosted server (✋ A-5), then ask: "Which properties near Lakeway have owners outside the area?" with `donphan` restricted to the `countylens` MCP server. Expect an honest "can't tell — owner mailing address isn't published (`not_in_export`)" for the owner-area part, with cited `property_cid`s for the tenure-only matches. Transcript saved to `docs/evidence/A-14-mcp.md` (AC-12).

## 6. Cross-surface agreement (AC-8, FR-011, SC-005)

Compare, for the same question and the same `manifest_cid`: `agent.ask`'s `matches[].property_cid`s, `search_properties`'s `rows[].property_cid`s, and the Explore page's own query result. All three must be the identical set. Any mismatch is a Critical defect (both doors must call the same query-core function — see `research.md`).
