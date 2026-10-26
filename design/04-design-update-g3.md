# CountyLens: design update after the architecture decisions (G3)

Oct 19, 2026 · HebaGaber · Why: the architecture decisions in [docs/decisions/0000-agent-architecture.md](../docs/decisions/0000-agent-architecture.md) (AD-01…AD-16) **override the design handoff**. Ten of them change what some screens show. This page explains how to redo that design work: one prompt in the same Claude Design project, a new export, then a review in Claude Code.

Estimated time: 1–2 hours.

---

## What changes, and on which boards

| Decision | What changes on screen | Boards to update |
|---|---|---|
| **AD-03** No CountyLens IPNS | Remove every IPNS card, "IPNS before / after", "IPNS → CID". Data → Manifest starts with the **run chain** (this manifest CID → previous manifest CID → …). Runs → Compare shows "new manifest CID; the old one still resolves on both gateways; CAR available". | `DataManifest1440`, `DataManifest768`, `Data390`, `DataStates`, `Runs1440`, `RunsLog1440`, `RunsCompare1440`, `RunsCompare768`, `Coverage1440`, `HelpMcp1440`, `Hub1440`, `Main`, `Flows` |
| **AD-01** No hand-built serving table | Remove "slim geo-sorted serving Parquet" from Data → Catalog and the loading copy. The loading state still shows "MB of the needed columns". | `DataCatalog1440`, `DataCatalog768`, `ExploreStates` |
| **AD-04** Counts come from the run manifest | Every count's source chip on Coverage says "Run manifest · `coverage` section" instead of `coverage.json` / `merge_stats.json`. | `Coverage1440`, `Coverage768`, `Coverage390`, `CoverageStates` |
| **AD-13** No Route 53 | Cost card: **$0.00 fixed per month** + a few cents of usage. Remove the "$0.50 Route 53 hosted zone" line, and the IPNS publisher and IPNS key lines. Add "S3 copy of published files (cents)". | `Coverage1440`, `Coverage768`, `Coverage390` |
| **AD-05** Five contractor states | The contractor badge has five variants: **Resolved** (official TX Comptroller match), **Candidate**, **Ambiguous**, **Conflicting**, **Unresolved**. The permit's contractor name is labelled "as printed on permit". | Result cards in `Explore*`, `ExploreQ-aicontractor`, `ExploreQ390-aicontractor`, `Property*`, `PropertyDetail`, `PropertyStates` |
| **AD-06** No Texas roofing licence | Remove any contractor "licence" line. Show the reason "No Texas roofing licence register exists". (Data licences in Legal pages stay as they are.) | `Property1440`, `PropertyDetail`, `Explore1440` |
| **AD-07** Final column names | SQL examples, view lists and schema tables use `roof_age_years`, `tenure_years`, `owner_is_out_of_area`, `contractor_company_cid`, `coordinate_source`. BBB states are **Rated / Not found / Blocked / Not checked**. | `ExploreQ-sql`, `ExploreQ-sqlperm`, `ExploreQ390-sql`, `ExploreQ390-sqlperm`, `SqlStates`, `DataCatalog1440`, `Explore1440`, `HelpMcp1440` |
| **AD-08** Raw permit status shown | Permit cards show the class and the source's own word, for example "Stalled · source says *Expired*". | `ExploreQ-stalled78753`, `ExploreQ390-stalled78753`, `ExploreQ-permits5`, `ExploreQ390-permits5`, `Property*` |
| **AD-09** Agent answers in one go | Replace "steps streamed one by one" with a **Working…** state (elapsed timer, Cancel), then the answer with all its steps at once. Add a **"Took too long"** state at 25 s with "Try again" and "Use Filters instead". | `ExploreQ-ai`, `ExploreQ390-ai`, `ExploreQ-aiooa`, `ExploreQ390-aiooa`, `HelperStates`, `Explore1440` |
| **AD-10** MCP needs a token | Help → MCP: "Bearer token required, shared privately with reviewers". The connect snippets add an `Authorization: Bearer <token>` header. **Try a tool** says "Runs through the CountyLens API, which adds the token for you". Remove "public, read-only, no token". | `HelpMcp1440`, `HelpMcp768`, `HelpMcp390` |

The other decisions (AD-02, AD-11, AD-12, AD-14, AD-15, AD-16) change nothing on screen.

---

## Step 1. Save the current design (in Claude Code)

The new export replaces files in `design/`, so commit the current version first. Git then shows exactly what changed. Paste:

```text
Commit design/ and docs/decisions/0000-agent-architecture.md on feature/oracle-pipeline with the
message "docs: G3 architecture decisions (AD-01..AD-16) and design update brief". Do not push.
```

## Step 2. Update the design (in Claude Design)

1. Open the **existing CountyLens project** in Claude Design. Keep the Atlas design system selected.
2. Attach `docs/decisions/0000-agent-architecture.md` from the repo, so it can read the decisions.
3. Paste this prompt:

```text
Engineering has made architecture decisions that override parts of this design. They are in the
attached 0000-agent-architecture.md, section 5 (AD-01 to AD-16). Update only what they change;
keep every other screen, state, token and component as it is. Use only Atlas tokens and
components; log anything new in Extensions.

Changes:
1. AD-03 No IPNS. Remove every IPNS card, "IPNS before/after" and "IPNS -> CID" (Data, Runs,
   Runs Compare, Coverage, Help, Hub, Main, Flows). Data > Manifest now starts with the run chain:
   this run's manifest CID -> previous manifest CID -> ... (each tappable, each with "Verify").
   Runs > Compare shows: new manifest CID, the old one still resolves on ipfs.io and dweb.link,
   CAR available.
2. AD-01 Remove "slim geo-sorted serving Parquet" everywhere. Data > Catalog lists only the
   tables elephant-cli exports, plus the manifest and the gazetteer.
3. AD-04 Every count's source on Coverage is "Run manifest - coverage section", not
   coverage.json or merge_stats.json.
4. AD-13 Cost card: "$0.00 fixed per month" plus usage in cents. Remove the Route 53 hosted
   zone, IPNS publisher and IPNS key lines. Add "S3 copy of published files (cents)".
5. AD-05 Contractor badge with five variants: Resolved (official TX Comptroller match),
   Candidate, Ambiguous, Conflicting, Unresolved, each with a one-line reason. The permit's
   contractor text is labelled "as printed on permit".
6. AD-06 Remove any contractor licence line; show "No Texas roofing licence register exists"
   as the reason. Leave data licences on the Legal pages alone.
7. AD-07 Column names in SQL examples, schema and view lists: roof_age_years, tenure_years,
   tenure_basis, owner_is_out_of_area, owner_area_class, contractor_company_cid,
   coordinate_source. BBB states: Rated / Not found / Blocked / Not checked.
8. AD-08 Permit cards show the class and the source's own status word, for example
   "Stalled - source says Expired".
9. AD-09 AI mode no longer streams steps. Show a "Working..." state with an elapsed timer and
   Cancel, then the full answer with all steps at once. Add a "Took too long" state at 25 s
   with "Try again" and "Use Filters instead".
10. AD-10 Help > MCP: "Bearer token required, shared privately with reviewers". Add an
   Authorization: Bearer <token> header to the Claude Desktop and Claude Code snippets. Try a
   tool says "Runs through the CountyLens API, which adds the token for you". Remove "public,
   read-only, no token".

Do this at 390, 768 and 1440 for every board you touch, with all six states. When done, list
every board you changed and what changed on it, then update the handoff document to match.
```

4. Check each changed board at 390, 768 and 1440. Search the canvas for "IPNS", "Route 53", "serving Parquet" and "no token": none should remain.
5. Export with **Handoff to Claude Code** (or download the zip) into the repo's `design/` folder, the same way as before.

## Step 3. Review the new export (in Claude Code)

Paste:

```text
/developmentsupport-prototype-review
Then use the soofi-xyz-team-kit:metagross subagent as a read-only reviewer: review design/
against docs/01-intent.md, the README demo transcript and the architecture decisions AD-01 to
AD-16 in docs/decisions/0000-agent-architecture.md. Where the design and a decision disagree,
the decision wins: list it as Blocking. Do not write code. Add its findings to
design/design-review-log.md and update docs/02-design.md (demo line -> screen -> state).
Then search design/ for "IPNS", "Route 53", "serving Parquet", "coverage.json",
"merge_stats", "roof_age_yrs", "tenure_yrs" and "no token" and list every hit.
```

## Step 4. Final round (after review round 9)

Round 9 left five copy and component fixes (log rows #113, #117, #118, #120, #121). Everything else in that round was either sample data or a repo doc, and is already closed.

**Sample data is out of scope (PO, 2026-10-19, log #123).** The prototype's totals, counts, CIDs, sizes and sample rows are placeholders. Reviews don't count or compare them, and Claude Design gets no instructions about which data to show. The build fills every value from the published manifest and the elephant-cli tables ([02-design.md § 2](../docs/02-design.md), "Sample data → build rules").

### 4a. In Claude Design (same project), paste:

```text
Final small fixes. Change only the copy and components listed below. Leave every number, count,
CID, size, sample row and other screen exactly as it is. Use only Atlas tokens and components.

1. PropertyStates: replace "Show on map" with "Show in the list" (every board where it
   appears), and "The map and results still work" with "Filters, SQL and the list still work".
   Remove the "Daily Street View limit reached" card; Street View is Coming soon, so show the
   Coming-soon card there instead. The partial-data row's bare "Unresolved" pill becomes the
   shared ContractorBadge, with its one-line reason and the contractor text labelled
   "as printed on permit".
2. Map wording with the map off: in the Explore drawer, "mi from the pin" becomes
   "mi from the area centre". On Coverage, "placed on the map with Overture" becomes
   "located with Overture places".
3. Retitle the ExploreQ-ai board "Explore · AI · D-10 answered (populated)".
4. Help > MCP: replace "'Try a tool' below goes through the CountyLens API instead, so you need
   no token there." with "You don't paste a token here: the CountyLens API adds it on the server."
5. Explore drawer Roof card and Property detail: the field label "roof_age" becomes
   "roof_age_years".

Apply each change at 390, 768 and 1440 where the board exists. When done, list each board you
changed, then update the handoff document to match.
```

Export into `design/` the same way as before.

### 4b. In Claude Code, paste (a narrow check, not a full review):

```text
Check the new design/ export against design/04-design-update-g3.md Step 4a only, items 1 to 5,
at 390, 768 and 1440. Do not review sample data (log #123). For each of log rows #113, #117,
#118, #120 and #121, set the Resolution in design/design-review-log.md to "Incorporated
(final export)" if the board shows the fix, or keep it open with what is missing. Then repeat
the keyword search from Step 3, list every hit outside the review log and this file, and
update docs/02-design.md (remove the "in the final export" notes that are now done).
```

## Done when

- The review log has no open **Blocking** item.
- Sample-data findings are closed under log #123, never sent to Claude Design.
- The search in Step 3 finds no hits, except in `design-review-log.md` history or this file.
- `docs/02-design.md` still maps every README demo line to a screen and state.

Then go on to Gate G3 (step 9.3 in the architecture document).
