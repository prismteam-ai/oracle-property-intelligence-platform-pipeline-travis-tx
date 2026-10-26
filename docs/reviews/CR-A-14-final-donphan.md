---
id: CR-A-14-final-donphan
type: code-review-log
story: A-14
branch: 014-agent-and-mcp
reviewed_commit: 3be4ff9
reviewer: soofi-xyz-team-kit:donphan (consumer-side, read-only)
previous_score: 83 (cf741bd)
score: 80
---

# A-14 final review, consumer side (donphan)

**Score: 80/100** (gate: 75). Verdict: passes. 0 Critical, 3 Major, 7 Minor. The evidence is unusually honest about what it does not prove. The remaining defects are in what the product itself tells a consumer, not in the paperwork.

Scope of the review: do the agent and MCP answers stay faithful to the published open data and its provenance. Read-only: repo files and committed evidence only. No deployed agent, MCP server or AWS call was made.

## Findings

### Major

**M1. Agent responses carry no run identity when they have no matches.**
- Where: `apps/api/src/agent/ask.ts` (`composeStructuredParts`, return object) and `apps/api/src/agent/tools.ts` (`projectEnvelope`).
- `AgentAskResponse` has no `run` field. `run_id`, `manifest_cid` and `as_of` appear only inside `matches[]`. `projectEnvelope` drops the envelope's `run`, and `query` omits `manifest_cid` because the tools strip it.
- Evidence: in `docs/evidence/A-14-golden-results.json`, G1 to G4 and G6 have `matches: []` and the serialized response contains no "manifest". Only G5 names the run.
- Consequence: the "no match" answers for Pflugerville, Manor and Lakeway do not say which run was searched. G1's answer says "no properties within 5 miles of Pflugerville in the published dataset have a recorded roof age of 15 years or older". That is true only of a 14-property sample run, and the answer never says so.
- The contract requires scope stated and a run echo on every envelope. The MCP path does this; the agent path does not. This is the same class of fault as "unknown reported as none found", at the level of scope.
- Fix: add `run: {run_id, manifest_cid, as_of}` to `AgentAskResponse` from `bound`, and have the server append a run sentence to the answer.

**M2. Radius searches silently drop rows with no coordinates and permits with no matching property. Neither is counted.**
- Where: `packages/query-core/src/permits.ts` (`build()`: `p.latitude IS NOT NULL AND ...`, and `JOIN v_property`), `tools/functions.ts` (`listPermits`, `searchProperties`).
- `listPermits` never sets `unknown_excluded`, so it is always `{}`, even though the contract gives `no_coordinates` as a missing reason for `latitude`/`longitude`. A permit whose property has null coordinates is excluded from an area search with no trace.
- The `JOIN` is an INNER JOIN, including for the county-wide search. A permit with no `v_property` row is excluded from `rows`, `total` and `truncated`.
- This is exactly the "keep unmatched permits explicit / unknown is not none" rule. On the 14-parcel run it is invisible, because `parcels_without_emitted_permit` is 0 and all coordinates are present.
- The golden and MCP evidence cannot show this either way. On the full county it would understate results with `empty_reason: null` and `unknown_excluded: {}`.
- Fix: add `unknown_excluded.coordinates` to both tools, and report unmatched permits from the manifest coverage (`permits_excluded`, `permits_ambiguous_geoid`) in the envelope, or state explicitly that the tool only returns matched permits.

**M3. The agent never cites the gazetteer version or SHA-256.**
- Where: `ask.ts` (`composeStructuredParts` reads only `area.label`), `tools.ts` (`projectEnvelope` passes `area` to the model but the response does not keep it).
- The MCP path is correct. `search_properties` and `list_permits` return `area.gazetteer = {version: "travis-places@1.0.0", sha256: "0f4c08a8…d5d17f"}` plus the `area.source` stamp (Census file URL, `file_date`, `sha256`). Verified in TC-015 and TC-016 JSON.
- The agent's `how` carries only "Pflugerville city · Census 2024 Gazetteer · lat, lon". `docs/evidence/A-14-agent.md` itself says "the response carries the name, not the version or hash".
- Fix: a `gazetteer` entry in the agent response, or `area` copied into the response.

### Minor

**m1. `missing[]` reasons come from several vocabularies, not the contract's closed list.**
- `MISSING_REASONS` in `packages/contract/src/provenance.ts` is a closed list.
- `composeStructuredParts` pushes `no_match`, `truncated`, `incomplete`, `field_not_published`, `out_of_scope` and `unknown`, which are not in that list. These are tool `empty_reason` values or ad-hoc words.
- Field `result` is not a contract field either. Evidence: G1 `{"field":"result","reason":"no_match"}`.
- The reasons that are contract-named (`not_in_export`, `no_lexicon_carrier`) are used correctly.
- Fix: document that `field: "result"` entries are envelope-level notes, or move them to a separate field.

**m2. Contradictory BBB entries.** G5 `missing[]` has `bbb_status/no_lexicon_carrier` and `bbb_status/contractor_unresolved` together. In the contract, the uncarried field is `bbb_rating`/`bbb_url`, and `bbb_status` is a carried column that is "always not_checked in v1". The mapping `bbb_rating` to `bbb_status` in `CONTRACT_MISSING_NAMES` follows `golden.json`'s `must_flag_missing`, but it mislabels a carried column as uncarried.

**m3. Wording: "BBB status is not available in the published data."**
- The data contract publishes `bbb_status: not_checked` with a reason. The status is present; the rating is the part that is absent.
- Truth check: not false in substance (no rating or URL exists), but "not checked in this run" or "no rating published" would match the contract better.
- The other two sentences are true against `packages/contract/src/columns.ts` and `UNCARRIED`:
  - "contractor not printed": `contractor_name_raw`/`contractor.name_as_printed` is `no_lexicon_carrier`.
  - "owner's mailing location is not in the published export": `owner_mailing_postal_code` is `not_in_export`, `owner_area_class` is `unknown`, and `owner_is_out_of_area` is null.

**m4. `unknown_excluded` over-counts.** It is `count(*) WHERE radius AND field IS NULL`, regardless of the other filters. It is not "rows excluded because that field is null". The direction is conservative (never under-reports), but the number is not what the schema comment says.

**m5. Empty provenance is silently filled with `""`.**
- `citations.ts` `toMatch` writes `""` for missing `captured_at`, `table`, `table_cid`, `run_id`, `manifest_cid` and `as_of`, and `source_url: null` when absent.
- Nothing flags it. `source_url: null` is allowed only with a `not_in_export` entry, but the `missing` entry is not checked here.
- A malformed row would look like a valid citation. All 22 TC-016 rows and the G5 row were checked and are complete, so this is a robustness point, not an observed defect.

**m6. The MCP owner filter on an empty radius returns `no_match`, not the ERR-62 wording.**
- `owner_is_out_of_area` is always null in v1.
- With no property in the radius it returns `no_match` and `unknown_excluded: 0`. With properties in range it correctly gives `field_not_published`.
- Combined with another blocking filter, relaxing the owner field alone does not unblock, so it also reports `no_match`.
- The evidence (`A-14-mcp.md`) already discloses this and `donphan` worked around it through `get_coverage`. It is a known gap, not hidden. The agent path adds a question-text flag for it; the MCP path has no equivalent.

**m7. Stale or loose evidence text.**
- `docs/evidence/A-14-agent.md` § Gaps says the `donphan` MCP transcript is "pending". It is in `A-14-mcp.md`.
- `docs/evidence/A-14.md` line 52 lists "agrees with the agent on `property_cid`s" as an AC outcome. Line 79 and the MCP evidence correctly say the agreement is vacuous.

## What I verified

- **Row-level provenance (MCP).**
  - `docs/evidence/mcp/A-14-TC-016-open-or-stalled.json`: all 22 rows have `source_url`, `captured_at`, `table_cid`, `run_id`, `manifest_cid`, `property_cid`, `permit_cid` and `as_of`. 0 rows missing any. `profile_version`/`profile_sha256` are present. `missing[]` per row uses contract names and reasons.
  - Unmodified: `tools.ts` returns the query-core envelope as-is.
- **Agent citations (G5).** The `Match` carries the full provenance and every row-level field (`bbb_status` is `not_checked`, `contractor_resolution` is `unresolved`). `postCheck` strips unregistered `[n]` and CID-shaped tokens; the registry is keyed by the row's own `cid`.
- **Limits and gaps stated.** `truncated = total > returned`. The server-side registry cap makes `truncated` true, never silent. Unknown, `not_found` (A-14-TC-024) and `out_of_scope` (A-14-TC-025, G6) are typed and have no fabricated rows. `field_not_published` is a provable single-field relaxation test (review F1), and the code matches the comment.
- **Honesty sentences.** `ask.ts` appends them only when `missing[]` or the question warrants them. They are true against the contract (see m3). The evidence discloses them as a safety net, not model reasoning, and that two sentences are keyed on question regexes.
- **AC-8 and vacuous passes.** `A-14-mcp.md` (AC-8 section), `A-14-agent.md` (the "Read this first" section: G1 to G4 vacuous, G4 and G6 inconclusive, tautological `empty_reason`), the test report and `DEC-A-14-agent-mcp-full-county` all label the agreement vacuous and the Explore leg unmeasured. Not overstated, apart from m7.
- **Full-county gap.** Disclosed in `DEC-A-14-agent-mcp-full-county` and `DEC-A-14-mcp-burst-503`. The burst deviation is documented and the test is left red on purpose.
- **Gazetteer on MCP.** Version `travis-places@1.0.0` and SHA-256 `0f4c08a8bda573737adecc7d62e84d629aadc5005b987f2f787e4fd31ab5d17f` are on every area-resolving MCP response, plus the Census source stamp. Raw lat/lon areas use empty-string source fields (`url: ""`, `file_date: ""`, `sha256: ""`). That is a placeholder rather than an invented value, but `null` would be cleaner.

## What I could not verify

- **Any hosted behaviour.** No agent, MCP or AWS call was made, as instructed. I relied on committed JSON and transcripts.
- **Full-county behaviour.** None exists: M2 and m4 cannot be shown either way on the 14-parcel run.
- **Whether `exploreSearchSql`'s `total_within_r` is the filtered count.** I believe it is, from the column's use in `searchProperties` and `truncated`, but I did not read the Explore SQL line by line.
- **The golden run's exact deployed build for runs 2 and 3.** The evidence says it is not recorded.
- **Unit test results.** I did not run them; the test report states 1,947 passing.

## Score rationale

- Honest evidence, correct typed empty reasons, complete row provenance on the MCP side, true honesty sentences, and no fabricated values: about 85.
- Deductions: the agent's empty answers carry no run or scope (M1, −6); radius searches drop rows silently with no `unknown_excluded` for permits (M2, −4); the agent does not cite the gazetteer version or SHA (M3, −2); minor vocabulary and wording items (−3 combined).
- Result: **80**, down from 83 only because this pass read the agent's response shape more closely than the earlier one. Nothing regressed since `cf741bd`.
