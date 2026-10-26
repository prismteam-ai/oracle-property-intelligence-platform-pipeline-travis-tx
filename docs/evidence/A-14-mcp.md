# A-14 MCP server evidence

- **Hosted MCP URL:** `https://s7h96zfam0.execute-api.eu-north-1.amazonaws.com/mcp` (stack output `CountyLensApi.McpApiUrl`; the URL is not a secret, the token is)
- **Build:** `ec9a7e7` or later on branch `014-agent-and-mcp` (the shared-server 500 was fixed in `ec9a7e7`)
- **Run used for data calls:** `travis-202609-permits-20261021t103516z`, manifest `bafkreiasycmsr2qdlxqcfg3yc2conpn3jxmohz7gs55hkseipplhpqsk5i`, pinned on every data call. The full-county runs time out on the Lambda (`docs/decisions/DEC-A-14-agent-mcp-full-county.md`), so nothing below is a full-county result.
- All saved request and response bodies are token-free: `docs/evidence/mcp/A-14-TC-*.json`.

## `tools/list` (A-14-TC-014, 171 ms, HTTP 200)

Six tools: `search_properties`, `list_permits`, `get_property`, `get_coverage`, `list_runs`, `get_schema`. No SQL tool exists; a free-form `sql` argument is rejected (A-14-TC-026: `Invalid arguments for tool search_properties: Unrecognized key: "sql"`).

## `search_properties` (A-14-TC-015, 791 ms)

`area: Pflugerville, radius_mi: 5, roof_age_years_min: 15, limit: 1000` on the pinned run returns `rows: []`, `returned: 0`, `total: 0`, `truncated: false`, `empty_reason: no_match`, `unknown_excluded: {roof_age_years: 0}`, with the area resolved to "Pflugerville city · Census 2024 Gazetteer" (gazetteer `travis-places@1.0.0`, SHA-256 `0f4c08a8bda573737adecc7d62e84d629aadc5005b987f2f787e4fd31ab5d17f`) and the run echo (`run_id`, `manifest_cid`, `as_of` 2026-10-21T10:40:04.543Z). The same call through the MCP Inspector is in `docs/evidence/img/A-14-inspector.png`.

## AC-8: agent, MCP and Explore agree (A-14-TC-015)

The agent's G1 matches (`docs/evidence/A-14-golden-results.json`) and the MCP `search_properties` rows are both the **empty set**, so they are equal, but the equality is **vacuous**. The comparison against the Explore page's live query was not made on the full county (the Explore search itself returns HTTP 500 there, `DEC-A-13-explore-full-county`). The agreement with Explore's query is by construction (T030: the tool takes its rows from the same `exploreSearchSql`) and is tested on the fixture engine, not on hosted data.

## `list_permits` with real rows (A-14-TC-016, 710 ms)

`area: Austin, radius_mi: 25, status_class: open_or_stalled` returns 22 rows of 22 (`truncated: false`). The first row is permit `2026-116568 BP`, roofing replacement, `status_class: open`, `open_days: 47`, `issue_date: 2026-09-04`, with `permit_cid`, `property_cid`, `profile_version travis-austin@1.0.0`, `profile_sha256`, `source_url`, and `contractor_resolution: unresolved`, `bbb_status: not_checked` (`bbb_status_reason: contractor_unresolved`). A **stalled** permit was not found: `status_class: stalled` returns 0 rows on this run (A-14-TC-017 skipped for that reason).

## `get_coverage` (A-14-TC-018, 288 ms)

Matches the manifest's coverage section: contractor_unresolved 35, contractor_resolved 0, confidential_suppressed 0 (owner name and mailing withheld before validate).

## Truncation (A-14-TC-019)

The call asks for `limit: 1000` with `status_class: stalled` and returns 0 rows with `truncated: false`; the cap and the `truncated` flag are consistent, but a **truncated** response was not demonstrated on this run (no result set exceeds 1000 rows). The forced-small-limit truncation is covered by the unit tests only.

## Unknown and out-of-scope inputs

- Unknown permit number (A-14-TC-024): `empty_reason: not_found`, no fabricated row.
- ZIP 99999 (A-14-TC-025): `empty_reason: out_of_scope`.

## Security and limits

| Check | Result | Evidence |
| --- | --- | --- |
| No token | HTTP 401 `{"error":"unauthorized"}` | A-14-TC-022 |
| Wrong token | HTTP 401 | A-14-TC-023 |
| Disallowed browser Origin | HTTP 403 `origin_not_allowed` | A-14-TC-027 |
| Burst above 5 rps (40 calls) | 14 x 200, 1 x 429, 25 x 503: **fails AC-10** | A-14-TC-021, ERR-64, `DEC-A-14-mcp-burst-503.md` |
| Token in git, CloudWatch logs, hosted JS bundle | **0 in all three** (details under the table) | PO-run counts, 2026-10-25 |

Token-leak counts: Run by the PO in their own shell on 2026-10-25, token loaded from SSM, counts only (the value was never printed): MCP Lambda log group 0, agent Lambda log group 0 (the AWS CLI printed one 0 per result page, all zero); the hosted preview's JavaScript bundle: 3 files, 0 matches in each; repository history (every commit reachable from any ref): 0 commits contain the token. Caveats: the log check covers the log events that existed at that time, the website check covers the preview build `21e1ebf` or later, and the repository check searches committed content only.

## Timings (A-14-TC-NF-02)

20 `tools/call` requests (alternating `get_schema` and `search_properties`) on the pinned run: p50 313 ms, p95 415 ms, max 417 ms (limit 3,000 ms). `tools/list` 171 ms (limit 500 ms).

## MCP Inspector

`docs/evidence/img/A-14-inspector.png` (six tools, a `search_properties` call with provenance, the protocol log: `initialize`, `tools/list`, `tools/call` all OK) and `docs/evidence/img/A-14-inspector-connected.jpg` (the Connected card showing the hosted `/mcp` URL and protocol 2025-11-25). The first connection attempt was logged by the server as `unauthorized` (most likely an empty header value: the shell variable holding the token was empty in that terminal at the time; not verified); the second, with the token, connected.

## Rerun on the final build (`40808ca`, 2026-10-25, PO ran with the token)

The MCP request tests were rerun after the final-review fixes: **12 passed, 1 failed (TC-021, the accepted ERR-64 deviation), 2 skipped (TC-017, TC-029)**, the same as the first full run. Figures quoted above are from the first full run (build `ec9a7e7`); the saved JSON under `docs/evidence/mcp/` is from this rerun and differs a little: `tools/list` 139 ms, `search_properties` G1 2,558 ms (first call after a cold start), `list_permits` 816 ms, `get_coverage` 324 ms, p50 330 ms, p95 408 ms, max 427 ms over 20 calls. The 40-call burst gave 23 x 200, 3 x 429, 14 x 503 (first run: 14 x 200, 1 x 429, 25 x 503): the same deviation, with different counts, because API Gateway's throttle is approximate.

## `donphan` answers through the MCP server alone (A-5)

The server was registered in Claude Code with `claude mcp add --transport http --scope local countylens <MCP_URL> --header "Authorization: Bearer $MCP_TOKEN"`. The `soofi-xyz-team-kit:donphan` agent was run with the walkthrough's question, **plus** operating notes added by the operator: use no other MCP server and no web access, and pass the pinned `manifest_cid` (the default run times out). Question as given: "For this question, use only the tools on MCP server `countylens` (the CountyLens server for Travis County, TX). Which properties near Lakeway have owners outside the area? Cite every `property_cid`, and state scope, row limits and gaps." Transcript, word for word (donphan's final report):

> **(1) Answer**
>
> No properties were found, so there are no property_cids to cite. I did not invent any.
>
> - **Scope:** place `Lakeway`, a 5-mile radius (my choice, as instructed). The server resolved it to Lakeway city, using the Census 2024 Gazetteer centroid at 30.354982, -97.986269. The filter was `owner_is_out_of_area=true`, sorted by nearest, with limit 1000. The run was `travis-202609-permits-20261021t103516z`, manifest_cid bafkreiasycmsr2qdlxqcfg3yc2conpn3jxmohz7gs55hkseipplhpqsk5i, as of 2026-10-21T10:40:04Z.
> - **Row limits:** I asked for up to 1000 rows. The result was 0 rows with total 0 and truncated=false, so nothing was cut off. `empty_reason` was `no_match`. The `unknown_excluded` count for `owner_is_out_of_area` was 0, so no rows were dropped for unknown owner status.
> - **Why it is empty:** I also searched the same area and radius with no owner filter. That returned 0 rows too. So the cause is the data, not the out-of-area filter. This published run is a small permits-driven sample. `get_coverage` shows only 14 parcels published and 35 roofing permits emitted for the whole run. None of the 14 parcels fall within 5 miles of Lakeway. The server does not say where they are, and I did not check.
> - **Gaps:**
>   - This result says nothing about Lakeway as a whole. The full-county run was not queried because it times out.
>   - I did not try radii larger than 5 miles.
>   - Owner data in the sample is thin. Of the 14 parcels, 7 have owners but no dated sale, and 3 have a dated sale but an unparsed owner name. None are confidential and none lack an owner record.
>   - Because of those owner gaps, the out-of-area flag may be unavailable even for parcels that are in range.
>   - The answer is exhaustive only for this sample run.
>
> **(2) Countylens tool calls** (all with manifest_cid bafkreiasycmsr2qdlxqcfg3yc2conpn3jxmohz7gs55hkseipplhpqsk5i; no credentials were involved)
>
> 1. `search_properties(area={place:"Lakeway"}, radius_mi=5, owner_is_out_of_area=true, limit=1000)` returned 0 rows (`no_match`) and resolved the area to Lakeway city.
> 2. `get_coverage()` returned the run's coverage figures: 14 parcels published, 35 permits emitted, 7 owners with no dated sale and 3 owners unparsed.
> 3. `search_properties(area={place:"Lakeway"}, radius_mi=5, limit=1000)` with no owner filter also returned 0 rows (`no_match`).
>
> I called no other MCP server and no web tools.

What this shows: an independent agent used only the six `countylens` tools, cited nothing it did not get, stated scope, limit and gaps, and said that the empty answer is about this sample run. What it does not show: an answer with real owner rows, which this run cannot give. Note also that the MCP tool, unlike the agent (ERR-62), reports `no_match` for the owner filter and not "field not published" when no property is in range; `donphan` reached the right conclusion from `get_coverage` and the no-filter search.
