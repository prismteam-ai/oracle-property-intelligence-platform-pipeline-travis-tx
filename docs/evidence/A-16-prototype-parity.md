# A-16 prototype parity (AC-12)

**Scope (PO, 2026-10-26): demo path first.** Shell/header, Explore workspace and drawer, Runs, Compare, Log, Coverage and Data are matched to their boards at 390/768/1440 (light theme). Board features with no data source or outside the architecture are recorded as Justified with their reason. Hub, Help MCP and Legal: structure and copy only.

## Baseline, before A-16 fixes (smeargle, production `cb0a4d2`, 2026-10-26)

Before images: `docs/evidence/img/A-16-parity-before/`. After-fix verdicts are added in the final section by the re-run (TZ04).

# AC-12 parity matrix: hosted CountyLens vs prototype boards

Hosted: https://countylens.aldarraj.com (light theme, production). Boards: `design/prototype/*.dc.html`, served over http from a local static server (file:// cannot load sibling boards). `ds/atlas/components/bundle.css` is missing from this repo, so the Atlas component CSS was taken read-only from `/Users/hebagaber/Github/roofing-crm/design/prototype/ds/atlas/components/bundle.css` (same tokens.css apart from one CRM-only token). Data values were not compared.
Images (board left, hosted right): `img/<cell>.png` in `/private/tmp/claude-501/-Users-hebagaber-Github-oracle-property-intelligence-platform-pipeline-travis-tx/2d0f647c-dca9-46ae-9b35-795965af8f06/scratchpad/parity/img/`. Raw captures: `board/`, `app/`, text dumps `txt/`.

Method notes
- One load per hosted page per width (Explore states at 1440 and 390 only; SQL/AI also 768). The hosted shell scrolls inside a container, so hosted screenshots show the first viewport only (about 900/1024/844 px); section order and copy for the rest were read from the page text dump (`txt/app-*.txt`). The AI answered state and SQL result state were not run (model and Filebase quotas); only the idle AI and SQL panels were captured.
- Boards with no width variant were compared at the nearest width (stated per row). Shell, drawer and state boards compare against the closest hosted page.
- Boards are wrappers: `Explore390/768`, `ExploreQ*`, `Hub390/768`, etc. import the 1440 component with `device`/`preset` props.

Legend: Match / Differs / Not built. "CJ" = candidate justified by architecture.

## Recurring differences (referenced by code below as R1..R9)
- R1 Header: board has a top bar with location chip (Travis County, TX), global Search box ("Search an address, place, ZIP or permit, or ask a question"), sync badge ("Run 3 · Oct 17", opens Runs), help (?) menu, "Ask" button, apps grid; at 390 location pin, help, bot, apps icons and a search pill. App has a bare "CountyLens" title bar only. Files: `components/AppShell.tsx`, `AppShell.module.css`, new `components/SearchBox.tsx`, `components/SyncBadge.tsx`.
- R2 Rail: board rail = Explore, Runs, Coverage, Data, Admin (Activity + Signed in when admin); app rail = Explore, Runs, Coverage, Data, More. Board 390 bottom nav = 4 items (Explore, Runs, Data, More; Coverage lives in More); app shows 5 (Coverage is its own tab). `AppShell.tsx`.
- R3 Board pages have a page title row with a Run picker ("Run 3 · current"), Download CSV buttons and a back arrow on sub-pages; app pages use a monospace "Data · Manifest" style heading and no run picker. Files: each `routes/*.tsx` header.
- R4 Board typography/layout uses Atlas cards, chips, tables and bars; app pages are mostly plain text blocks with monospace labels (`Run travis-full-run2-...`). Files: `routes/*.module.css`, `components/StatusPill.tsx`.
- R5 Board footer strip: Terms · Privacy · Data licences + "Street View: coming soon" at the bottom of every desktop page; app has links only on the Hub (and they are hidden under the 390 bottom nav). `AppShell.tsx`.
- R6 Board "Prototype" state-preview toggles are prototype chrome, not product. Not required.
- R7 Run identity: board hero says "Run 3 · Oct 17"; app shows `travis-full-run2-20261024` raw ids on Runs/Manifest/Catalog. Use "Run N · date" label plus the id as secondary. `data/runs-index.ts`, `Runs.shared.tsx`.
- R8 Hosted shows "Other counties and states · Coming soon" plus the three Coming soon links (Builder mode, Saved searches, Area matrix) as a text strip above the Explore tabs; board has none of these on Explore (Builder is a rail item, saved searches is "Save"). Likely justified by spec (coming-soon entries are required by A-13); keep but restyle as chips.
- R9 County selector is a native `<select>`; board is a location chip opening a menu (desktop) or bottom sheet (390) with Live / Coming soon rows. `components/CountySelect.tsx`.

## 1. Shell + Hub + Welcome

| Board | Hosted route | Width | States | Verdict | What differs and fix (element: board / app / file) |
|---|---|---|---|---|---|
| Hub1440 | / | 1440 | loaded | Differs | Header "Apps" + MCP and API docs link (board) vs CountyLens shell with rail (app). Board hero "Open property data tools / Two apps built on the same published runs..." with Run chip, "Watch demo" and "Pull requests" buttons; app hero "Old roofs and long-open permits, from files you can verify". Board app cards have feature check lists (3 checks), status pills (Live · Travis County / Coming soon / Not deployed yet), "Open CountyLens" with arrow, "What can I ask?"; app cards have short sentence + Open / What can I ask? / Open CRM (disabled). Board "Shared by both apps" tiles (Runs and CIDs, Coverage, MCP and API, Data use and licences) are missing in app. Board counties line "Counties: Travis County, TX live · Williamson County, TX coming soon" missing. `routes/Hub.tsx`, `Hub.module.css`. Image `img/A-16-parity-before/hub-1440.jpg` |
| Hub768 | / | 768 | loaded | Differs | Same as 1440; cards stack in board (2 rows), side by side in app. `img/A-16-parity-before/hub-768.jpg` |
| Hub390 | / | 390 | loaded | Differs | Same content gaps; board has no bottom nav on Hub, app shows 5-tab bottom nav that also hides the Data sources / Privacy / Terms links (R5). `img/A-16-parity-before/hub-390.jpg` |
| Hub states (run status Loaded/Loading/Unavailable, CRM Not deployed/Live) | / | 1440 | loading, unavailable | Differs | Board Run chip has Loading and Unavailable variants and CRM Live variant. App chip only seen in loaded state; not triggerable on hosted. Check `Hub.tsx` renders chip for loading and error. |
| Shell1440 (help menu open over Explore) | /tx/travis/explore | 1440 | help menu open | Differs | No help (?) button or menu (What can I ask?, Glossary, MCP and API docs...). R1. `AppShell.tsx` |
| Shell390Location | /tx/travis/explore | 390 | location picker sheet | Differs (CJ in part) | Board bottom sheet "Choose a location" with Texas/Other states groups, Live and Coming soon pills, "Sample · illustrative list" note. App native select + "Other counties and states · Coming soon" link. CJ: states other than Texas are not in scope; the sheet itself is still buildable. R9. `components/CountySelect.tsx` |
| Shell390More | any | 390 | More sheet open | Differs | Not opened on hosted (nav code only). Board list: Coverage, SQL, What can I ask?, Glossary, MCP and API docs, Apps, Admin sign-in, Settings, footer links, "Street View: coming soon". App MORE_PAGES: Data catalog, Runs log, Runs compare, Help MCP, Legal x3 + Coming soon items. Align labels and items. `AppShell.tsx` (`MORE_PAGES` in `routes/route-list.ts`) |
| Shell390ComingSoon | /tx/williamson/explore | 390 | other-county | Differs (CJ) | Board: modal card "Williamson County, TX is coming soon", sentence, sample note, button "Stay on Travis County". App: full page "Other counties" + "CountyLens has data for Travis County, TX only" + link "Open Travis County Explore". Same message intent; make it a dialog from the county picker. CJ because there is no other-county data, but the modal and button copy differ. `routes/ComingSoon.tsx` |
| Shell coming soon 1440/768 (nearest: Shell390ComingSoon) | /tx/williamson/explore | 1440, 768 | other-county | Differs (CJ) | Same as above. `img/A-16-parity-before/soon-1440.jpg`, `soon-768.png` |
| ShellStates (sync badge: Loading, Populated, Partial data, Stale, Rate-limited, Error, Empty) | header | 1440 | 7 states | Not built | No sync badge exists in the header (only a Run chip on Hub). Build `SyncBadge` with the 7 states and copy ("Checking sync...", "Run 3 · Oct 17", "Run 3 · 3 of 4 sources", "Stale · synced 3 days ago", "Status check rate-limited, retrying in 4 s", "Sync status unavailable · Retry", "No runs yet for this county"). |
| Welcome1440 | /tx/travis/explore | 1440 | first visit | Differs | Board shows a "What can I ask?" card over Explore on first visit; app Explore shows no card (the "What can I ask?" button on Hub goes elsewhere). Add a dismissible first-visit card with the sample questions. `routes/Explore.tsx` |
| Welcome768 | same | 768 | first visit | Differs | Same. |
| Welcome390 | same | 390 | first visit | Differs | Same. |

## 2. Explore + drawer + filters + Search

| Board | Hosted route | Width | States | Verdict | What differs and fix |
|---|---|---|---|---|---|
| Explore1440 (Filters, Pflugerville, roof >= 15, 9 rows + Close 3) | /tx/travis/explore | 1440 | results | Differs | Board = workspace: left panel "Filters · query" with preset chips (Roof age at least 10/13/15/20/25), Roofing permit segmented Any/Open or stalled/Stalled, "Open >= any time" menu, Owner chips (Tenure > 10 yrs, Out-of-area), Suggestions, footer "128 properties match · Clear · Save"; centre = Matches 9 / Close 3 tabs, dense table (Address, Roof, Basis, Conf., Permit, Mi, Lat/lon, Source, Info) with row checkboxes, pager, radius slider; top toolbar "Area: Pflugerville" and "Sort: Oldest roof". App = single column: Explore h2, Filters/SQL/AI tabs, text inputs (Place, Radius number, Roof age number, Open or stalled checkbox, Open >=, Sort select, Tenure, Out-of-area), then property cards (grid of labelled fields). Fixes: replace number inputs with chip/segmented controls (`components/FilterSheet.tsx`), result table (`components/ResultRow.tsx`, `ExploreFilters.tsx Results`), Matches/Close tabs, pager instead of "Load more", radius slider, Clear/Save, suggestion chips. Map view: CJ (Coming soon). |
| Explore768 | same | 768 | results | Differs | Board 768 two panes (filters collapsed to a rail/sheet); app single column. Same fixes. |
| Explore390 | same | 390 | results | Differs | Board: search pill, "128 within 5 mi", place chip + radius slider, Filters and "roof >= 15 yrs" chips, bottom sheet list Matches 9 / Close 3, "Edit query" FAB, pager "1-2 of 9". App: County select, coming-soon links, Filters button, plain card list. |
| ExploreStates (results pane: loading, empty, close matches, error...) | /tx/travis/explore | 1440 | loading, zero, error | Differs | App has skeleton cards, zero-result line "No properties within 5 mi · N close matches just outside", "+0.605 mi" label, ErrorBanner with retry. Board uses table skeleton rows and a "Close 3" tab rather than inline list; copy to align per `txt/board-ExploreStates.txt`. `ExploreFilters.tsx` |
| EmptyHints | /tx/travis/explore | 1440 | empty | Differs | Board shows hint chips ("Try roof >= 15", "Open permits 5+ yrs") when no results; app only says "No properties within 5 mi". Add suggestion chips. `ExploreFilters.tsx` |
| HelperStates (helper text, tooltips, inline validation) | /tx/travis/explore | 1440 | helper | Differs | Board Owner help text ("= mailing address outside Travis County", "Tenure = years since last sale"); app has similar helper lines but also leaks a stray token "ooa78753" under Out-of-area owner (bug, `components/FilterSheet.tsx`). |
| ContractorBadge | drawer/row | 1440 | resolved, candidate, ambiguous, conflicting, unresolved | Differs | App shows "Contractor unresolved" chip and BBB line; verify all five identity states render with the board labels. `components/ContractorBadge.tsx` |
| SearchStates / SearchBox (header search, suggestions, recent, no match, permit and CID results) | none | 1440, 390 | all | Not built | Board search box lives in the header (and as a 390 pill) with place, address, ZIP, permit number, "ask a question" modes and suggestion groups. App has no global search; only a Place field inside Filters. |
| Property1440 (drawer over Explore) | /tx/travis/explore?sel=... | 1440 | open | Differs | Board drawer: address title, Sample/TCAD id, chips (Roof 23 yrs · High, Stalled 6.4 yrs, Out-of-area owner), Street View coming-soon box, "Open the area in Google Maps", buttons Show in the list / Ask about this property / Open in CRM (CJ: CRM not deployed), Roof section with evidence chain (Reroof permit -> Austin permits -> CID), warning when permit not counted. App drawer: "Property bagu...jkdq" title + Close, field grid, missing-reason pills, Source line. Fixes: title by address, chip row, evidence chain, "Ask about this property" (opens AI), keep CID display. `routes/PropertyDrawer.tsx`, `components/ResultRow.tsx` |
| Property768 | same | 768 | open | Differs | Board full page beside rail; app inline card. Same fixes. |
| Property390 | same | 390 | open sheet | Differs | Board bottom sheet with grabber, address title, copy-link and close, chips, buttons; app inline card with Close (no grabber, no address). Missing-reason pills are good (Match for that element). |
| Property390Full | same | 390 | full length | Differs | Sections after Roof: Permit, Owner, Contractor, Sources/provenance (see board). App has one field list + "Not included in the published tables" + Source line. |
| Property390NoImagery | same | 390 | no street view | Differs (CJ) | Board "Street View: coming soon" dashed box; app only links Street View under Coming soon. CJ because imagery is out of scope, but the box and copy "No street photo yet. The property data below is unaffected." should still show. |
| PropertyStates | drawer | 1440 | loading, missing fields, not in results | Differs | App has "not in results" status text and per-field reasons (Match); no loading skeleton for the drawer; board grouped "What is missing" panel. `PropertyDrawer.tsx` |

## 3. ExploreQ states (Filters, AI, SQL)

Boards are `ExploreQ-*` (1440), `ExploreQ390-*`, `ExploreQ768-*`. Hosted comparisons use `x-roof15`, `x-permits5`, `x-ooa78753`, `x-stalled78753`, `x-sql`, `x-ai` captures.

| Board | Hosted route | Width | States | Verdict | What differs and fix |
|---|---|---|---|---|---|
| ExploreQ-roof15 / 390-roof15 | ?place=Pflugerville&roof=15&r=5 | 1440, 390 | results | Differs | Same as Explore1440/390 (table + chip panel). App header "N within 5 mi of Pflugerville · roof >= 15 yrs" matches the board's header sentence (Match for that string). |
| ExploreQ-permits5 / 390-permits5 | ?permit=open_stalled&openYrs=5 | 1440, 390 | results (D-9) | Differs | Board "57 within 5 mi ... open permits 5+ yrs" with Roofing permit segmented "Open or stalled" and "Open >= 5 yrs" menu; app checkbox + number. Header text not shown with the permit filter on app. |
| ExploreQ-ooa78753 / 390 | ?place=78753&ooa=1 | 1440, 390 | results | Differs | Board chip "Out-of-area" selected plus table with "Out-of-area owner" blue badge; app checkbox and cards. |
| ExploreQ-stalled78753 / 390 | ?place=78753&permit=stalled | 1440, 390 | results | Differs | Board Stalled segment active and Stalled N yrs chips; app select/checkbox. |
| ExploreQ-builder / 390 | none (Coming soon) | 1440, 390 | empty builder | Not built (CJ) | Board query-builder empty start; app shows "Builder mode · Coming soon" link and `/soon/builder-mode` page. CJ: coming-soon is required by A-13. |
| ExploreQ-crmmap | none | 1440 | map view | Not built (CJ) | Prototype-only CRM map preview; app falls back `view=map` to list by design. CJ. |
| ExploreQ-sql / 390-sql | ?mode=sql | 1440, 390 | empty start | Differs | Board SQL panel: "SQL · query" editor with Schema and Run, sample query, "DuckDB-WASM in your browser · read-only" line, Suggestions, table with Matches/Close. App: tab + "SQL checks · Coming soon", "DuckDB-WASM in your browser · read-only", progress "Reading the run manifest", then editor (not shown in capture). Editor chrome (Schema button, Run, suggestions) to verify at idle; `routes/ExploreSql.tsx` |
| ExploreQ-sqlperm / 390-sqlperm | ?mode=sql | 1440, 390 | query run | Differs | Result renders as a plain grid (`table[aria-label="Query result"]`) not as the Explore results table with Matches/Close tabs and row badges. Not run (Filebase quota). |
| SqlStates (loading, running, empty, rate-limited, partial, errors in plain words) | ?mode=sql | 1440 | 6+ | Differs | Board copy e.g. "Starting DuckDB in your browser...", "There is no column called 'roof_age'. Did you mean roof_age_years?", "This panel is read-only." Verify each string in `ExploreSql.tsx` / `ExploreSql.engine.ts` and `packages/shared/src/texts.ts`; only the loading text was seen. |
| ExploreQ-ai / 390-ai | ?mode=ai | 1440, 390 | answered | Differs | Board AI panel: left "Ask in plain English" textarea with "10 of 10 AI questions left this session" + Find button, Suggestions, "Read as - tap to change, x to drop" assumption chips (Centre, Within 5 mi, Roof age); centre Answer/Close tabs, "How I read this" steps, numbered sources, warning band; right results table. App: "Ask about roofing leads in Travis County" textarea + disabled Ask + "0 of 10 questions used this session"; answered layout (How I read this, What is missing, Sources) exists in code but not run. Fixes: suggestions, assumption chips, split layout. `routes/ExploreAi.tsx` |
| ExploreQ-aiworking / 390 / 768 | ?mode=ai | all | working | Differs | Board "Working... (one response, no streaming)" with elapsed counter and Cancel; app has "Working... N s" + progress bar (copy Match); layout differs. |
| ExploreQ-aislow / 390 / 768 | ?mode=ai | all | 25 s timeout | Differs | Board: "Took too long. The answer stopped at the 25 s limit. Nothing was counted, and your question is kept." App: "Took too long · try again, or use Filters instead" (`AI_TEXTS.timedOut`, `packages/shared/src/texts.ts`). |
| ExploreQ-ailimit | ?mode=ai | 1440 | free questions used | Differs | Board dedicated limit card with "Sign in to keep asking" (user sign-in CJ: Coming soon); app ErrorBanner "Question limit reached · 10 questions per session · ..." |
| ExploreQ-aipaused | ?mode=ai | 1440 | paused | Differs | Board title "AI is paused for today" + "Today's AI budget is used up, so AI mode is paused until 00:00 UTC. Filters and SQL still work."; app one-line banner "AI answers are paused for today · the daily budget is used up and resets at 00:00 UTC". Align copy. |
| ExploreQ-aiooa / aicontractor | ?mode=ai | 1440, 390 | answered (out-of-area, contractor) | Differs | As ExploreQ-ai; contractor variant shows resolution badge in table and "Candidate" note. Not run. |

## 4. Data catalog / manifest / verify

| Board | Hosted route | Width | States | Verdict | What differs and fix |
|---|---|---|---|---|---|
| DataManifest1440 | /data/manifest | 1440 | loaded | Differs | Board: tabs Manifest / Verify / Catalog, Run picker, "manifest.json" download, Run chain as 3 cards (Run 3 this run, Run 2, Run 1) with Verify + copy, summary strip, files table with Name, CID, Codec, Size (KB/MB), SHA-256 (short), Verify column, pager "1-7 of 13". App: "Data · Manifest" text heading, no tabs, chain as vertical text list, 255-row artifact table of full paths with raw byte sizes and full SHA-256. Fixes: tab bar (`routes/Data*.tsx` shared header), run chain cards, human sizes, short hashes, pager. `routes/DataManifest.tsx` |
| DataManifest768 | same | 768 | loaded | Differs | Same. |
| Data390 (manifest, nearest) | same | 390 | loaded | Differs | Board stacked cards, sheet-like file rows; app table (check overflow). `img/A-16-parity-before/data-390.jpg` |
| DataVerify1440 | /data/verify/{cid} | 1440 | loaded | Differs | Board: file picker chips, big "Verify" button, "Checking on 2 public gateways...", Lane A ipfs.io and Lane B dweb.link cards with URL, byte progress, retry countdown, explanatory note. App: "Run manifest" card, two result cards named "Pinata" and "Filebase" (gateway names differ), "Gateway race · Coming soon" link, verified pills. Board states that lane A/B are ipfs.io and dweb.link, not Filebase/Pinata (copy decision to confirm vs constitution). `routes/DataVerify.tsx`, `components/VerifyLane.tsx` |
| DataVerify768 | same | 768 | loaded | Differs | Same. |
| Data390 (verify, nearest) | same | 390 | loaded | Differs | Same. `img/A-16-parity-before/verify-390.jpg` |
| DataCatalog1440 | /data/catalog | 1440 | loaded | Differs | Board: tabs, "Find a table or field" search, left list of tables with row counts and icons (properties, property_improvement...), right detail with field table (Field, Type, Meaning, Source, Licence), "Query in SQL" + "Copy schema" buttons, "In SQL and MCP use the views" note, "v_roofing_permit reads this table and adds" box. App: grid of cards "county.address ... Size ... Rows ... 4 columns" with CID chips; no search, no field table, no Query in SQL. `routes/DataCatalog.tsx` |
| DataCatalog768 | same | 768 | loaded | Differs | Same. |
| Data390 (catalog, nearest) | same | 390 | loaded | Differs | Same. `img/A-16-parity-before/catalog-390.jpg` |
| DataStates (lane and screen states: loading, partial, CAR-only, mismatch, error) | /data/* | 1440 | many | Differs | App has verified, "no CAR listed" and "Verify via CAR" states; verify the mismatch and gateway-failed copy against `txt/board-DataStates.txt`. |

## 5. Runs / Compare / Log

| Board | Hosted route | Width | States | Verdict | What differs and fix |
|---|---|---|---|---|---|
| Runs1440 | /runs | 1440 | completed | Differs | Board: "Pipeline runs" title, Run menu "Run 3 · latest ... Completed", Sync status card (Fresh, Last sync, Next sync, County coverage, "Admin sign-in" link), Pipeline diagram (Fetch sources list + Check and join/Derive/Publish/Verify steps), selected-source strip, Gantt timeline with "Show as table", Latest events, "What Run 3 changed" bars + manifest CIDs + Verify. App: two "Coming soon" links (Pipeline diagram and Gantt, Timeline scrubber), run id header, sources list, coverage, data groups, limitations text. Pipeline/Gantt/timeline are CJ (Coming soon in A-13 spec) but Sync status, Latest events, "What changed" and Run picker are buildable. `routes/Runs.tsx`, `Runs.shared.tsx` |
| Runs768 | same | 768 | completed | Differs | Same. |
| Runs390 | same | 390 | stacked | Differs | Board stacked cards, charts as tables (timeline rows "Start / End / Took"). App stacked text. |
| RunsStates (running, partial, stale, rate-limited, failed, no runs) | /runs | 1440 | 6 | Differs | App shows run/limitations text; no state preview or equivalent badges. Verify the "Stale" and "Failed" copy exists. |
| RunChain (component on Runs/Data) | /data/manifest | 1440 | chain | Differs | See manifest row. |
| RunsCompare1440 | /runs/compare | 1440 | Run 3 vs Run 2 | Differs | Board: back arrow, "Run 3 vs Run 2" with Run pickers, 3 summary cards (Run 2 previous, Run 3 current, CAR available), per-source change table (Run 2, Run 3, Added, Changed, Removed, CID change), Immutability checks chips, buttons "Directory CAR, Run 3" and "Verify both on gateways". App: two stacked run blocks with finished date, previous manifest, artifacts count, per-source records; no pickers, no added/changed/removed table (shows "first run, nothing to compare against" for each), no immutability chips. `routes/RunsCompare.tsx` |
| RunsCompare768 | same | 768 | | Differs | Same. |
| RunsCompare390 | same | 390 | | Differs | Same; board has its own 390 board with stacked cards. |
| RunsLog1440 | /runs/log | 1440 | loaded | Differs | Board "Pipeline history log": filter chips (All events, Run started 3, Source fetched 15, ...), run chips, table (Time UTC, Run, Event, Source, Count, Status pill), pager, Download CSV. App: vertical list of events with ISO timestamp, event text and run id, no filters, no table, no status pills, no pager. `routes/RunsLog.tsx` |
| RunsLog768 | same | 768 | | Differs | Same. |
| RunsAdmin1440 | none | 1440 | admin | Not built | Runs page for admins: Admin chip in header, Sync status card with "Start run" button (instead of "Admin sign-in" link), state preview, "Signed in" rail item. Needs admin auth and run control. |
| Activity1440/768/390, ActivityStates | none | all | admin only | Not built | Admin-only Activity page: "Last week" stat tiles (events, median response, p95, failure rate), Top areas / Top questions and tools / Top failure reasons bars, "Most searched this week" re-run list, Query log table with type filters (AI, MCP, Try a tool, Search, Failed), time range menu, Download CSV, pager. States: not enough activity. |

## 6. Coverage

| Board | Hosted route | Width | States | Verdict | What differs and fix |
|---|---|---|---|---|---|
| Coverage1440 | /tx/travis/coverage | 1440 | loaded | Differs | Board: title + Run picker + Download CSV; 4 KPI tiles (Record kinds complete 3 of 7, Records loaded, Areas with permit data, Counted from Run 3); "Loaded vs each source's own total" table with bars, status pills (Complete/Partial/Blocked), trend and provenance links; "Coverage by area" heatmap (Austin, Pflugerville, Manor, Unincorp.); Known limitations; Reconciliation (duplicates merged); Source speed and constraints table; Cost with Last bill and Budget alert. App: heading "Coverage" + run id and one card per kind (Property, Ownership...) showing missing reasons ("not in this run's coverage section", "denominator not in this run's manifest") because Run 2's manifest has no coverage section. Missing-reason handling is a Match with the board's Blocked/No source idea; everything else needs building. `routes/Coverage.tsx`, `Coverage.kinds.ts` |
| Coverage768 | same | 768 | | Differs | Same. |
| Coverage390 | same | 390 | stacked, charts as tables | Differs | Same; board uses stacked tables. `img/A-16-parity-before/coverage-390.jpg` |
| CoverageStates (Loaded, Loading, Gaps only, Rate-limited, Error, Empty) | same | 1440 | 6 | Differs | App has only the missing-reason form; no Gaps-only filter or loading/empty variants. |

## 7. Help MCP

| Board | Hosted route | Width | States | Verdict | What differs and fix |
|---|---|---|---|---|---|
| HelpMcp1440 | /help/mcp | 1440 | loaded | Differs | Board: back arrow header "CountyLens · Help", "MCP and API" title, 3 cards (Endpoint with copy, Access with tools/list and tools/call pills, "Connect a client" with Claude Desktop / Claude Code / MCP Inspector tabs + config JSON + Copy), Tools list (6) with search_properties detail (input schema table, Example request, Response), "Try a tool" form (Latitude, Longitude, Radius, Roof age, Run, Error 401 / Throttled 429 states). App: "Help · MCP" heading, intro, vertical list of tool names with parameter lines, "Connect a client" paragraph, Try a tool further down. Fixes: card layout, client tabs, schema tables, side-by-side Try a tool. `routes/HelpMcp.tsx` |
| HelpMcp768 | same | 768 | | Differs | Same. |
| HelpMcp390 | same | 390 | | Differs | Same; board stacks cards. |

## 8. Legal

| Board | Hosted route | Width | States | Verdict | What differs and fix |
|---|---|---|---|---|---|
| LegalData1440 | /legal/data | 1440 | loaded | Differs | Board: "On this page" side TOC (Your rights, Sources and licences, How to cite, Corrections), "Data use and licences", sample-text info banner, "Your rights", Sources table (Source, Provides, Licence or terms, Use notes), "How to cite" with example. App: "Legal · Data sources", list of 7 source cards with disclaimer links and "Page requested ... HTTP 200"; no licence table, no TOC, no How to cite, no Corrections. `routes/LegalData.tsx` |
| LegalData768 | same | 768 | | Differs | Same. |
| LegalData390 | same | 390 | | Differs | Same. |
| LegalPrivacy1440 | /legal/privacy | 1440 | loaded | Differs | Board sections: In short, What we record, What stays in your browser, Admin accounts, Other services, Your choices, with TOC + banner. App: 3 short cards (What CountyLens asks of you, Where your browser connects, What the records contain). Content differs materially (board describes the query log and admin accounts). `routes/LegalPrivacy.tsx`, `content/legal.ts` |
| LegalPrivacy768 | same | 768 | | Differs | Same. |
| LegalTerms1440 | /legal/terms | 1440 | loaded | Differs | Same structure as Privacy (TOC, banner, sections); app uses cards. `routes/LegalTerms.tsx` |
| LegalTerms768 | same | 768 | | Differs | Same. |

## 9. Coming soon / UserSignIn

| Board | Hosted route | Width | States | Verdict | What differs and fix |
|---|---|---|---|---|---|
| UserSignIn1440/768/390 | none (`/soon/ai-user-sign-in` is an unlinked item and returns "Page not found") | all | Email, Sending, Code, Wrong code, Expired, Too many attempts | Not built (CJ) | Board: centred card, sparkle icon, "Sign in to keep asking", text about the 10-question limit, info banner "Coming soon: AI-user sign-in is not in the first release...", Email field, "Email me a code" button, Cognito note. CJ: user sign-in is planned as Coming soon; if AC-12 needs a visible screen, add a static `/soon/ai-user-sign-in` page using this board's layout (the item exists in `content/coming-soon.ts` with `linked: false`). |
| Coming soon pages (/soon/...) | /soon/other-counties etc. | all | | Match? | No board for item pages (title, "Coming soon" label, sentence, skeleton). Nothing to compare; not scored. |

## 10. Admin

| Board | Hosted route | Width | States | Verdict | What differs and fix |
|---|---|---|---|---|---|
| AdminSignIn1440/768/390 | none | all | Email, Sending, Code, Wrong code, Expired, Too many attempts | Not built | Admin sign-in card: shield icon, "Admin sign-in", "Admins can start, stop and retry runs and see Activity. Every other page is public and needs no sign-in.", info banner "The demo needs no admin access...", Admin email field, "Email me a code", Cognito note. No route, no auth. |
| RunsAdmin1440 | none | 1440 | | Not built | See section 5. |
| Activity1440/768/390/States | none | all | | Not built | See section 5. |

## Not compared (not page boards)
`ProtoBar`, `canvas.json`, `Flows`, `A11yAudit`, `Extensions`, `Main` (site map), `Pager` and `SearchBox`/`RunChain`/`PropertyDetail` components (covered through the pages that use them).

## Justified differences (kept on purpose, with reason)

### Runs, Compare, Log, Coverage, Admin, Activity (G2a, merge `38ea8b3`)

| Board | Element | What the app shows instead | Reason |
| --- | --- | --- | --- |
| Runs1440/768/390 | Gantt chart, selected-source strip | Coming soon | The run manifest records no per-step timings; drawing them would invent data |
| Runs | Fresh / Stale / Failed pills | "Published" for published runs; Running / Failed / Stopped live from the bridge (admin only) | No freshness threshold is defined in the contract |
| Runs | Run menu "view earlier run card" | Menu lists each run with CID, Verify and Compare | Earlier-run card view not built (time); every run is still reachable by CID |
| RunsLog | Verified, Records added, Warning event types | Only the event types the manifest records; 50 rows per page | Those events are not in a manifest |
| RunsCompare | Artifact CID column | Counts of kept, changed and new CIDs | A per-artifact CID diff of ~285 artifacts is not readable on 390 px; counts come from the two manifests |
| Coverage | Area heatmap, trend, Reconciliation, "Gaps only" | Area card and Areas tile say why | No per-area or merge data is published |
| Coverage · Cost | "Last bill" tile | Gross and Credits tiles | The free plan nets usage with credits; showing both is AC-1 edge case 1 |
| AdminSignIn | "Code sent" state | Email + password; success goes to Runs | AC-6 amended (Task B sign-in, PO 2026-10-26) |
| RunsAdmin1440 | One primary button | Start, Stop and Retry always visible to the admin; a dry-run checkbox | AC-6 lists all three; dry run keeps demos from publishing by accident |
| Activity | Top lists, query-log table | Three metrics + questions per day, each linked to its Logs Insights query | AC-10 scope; the API returns only those |


## After the A-16 fixes (smeargle re-check, preview `1b7f627`, 2026-10-26 03:00 EEST)

Scope "demo path first" (PO). 52 cells: **10 Match, 6 Justified, 36 Differs** before the last fix round. The four layout bugs it found (D-4 Explore table overflow, D-6 Runs · Log letter-by-letter wrapping, D-7 Compare at 390, D-10 run numbering in the Manifest chain) and the Coverage · Cost copy (D-9) were fixed in the final round; the remaining Differs are layout and feature gaps against a larger design, recorded as the A-16 exception "prototype parity beyond the demo path" (below). No horizontal page scroll, no console error and no target under 48 px on any cell.

# A-16 AC-12 parity re-check (after fixes)

Preview: https://016-cost-and-admin.d2lx0utip89u18.amplifyapp.com (`/build.json` sha 1b7f6272…, branch 016-cost-and-admin), light theme, 2026-10-26.
Boards: baseline captures reused from `scratchpad/parity/board/` (`design/prototype` has not changed since `3f4de6f`; served over local http with roofing-crm Atlas bundle.css as the baseline did).
Side-by-sides (board left, preview right): `scratchpad/parity-after/img/<family>-<width>.png`; raw captures `app/` (first viewport plus `-tall` = full scroll container, capped at 7000 px); text dumps `txt/`; metrics `metrics.json`.
Loads: one per page per width, plus one extra Explore load per width to open the drawer (the first click hit the copy button). Data values were not compared.

## Global checks (all 49 page loads)
- Horizontal page scroll: **none** at any width (document and main scroll container both fit).
- Console errors / page errors: **0**.
- Targets < 48 px: none except four 1×1 visually hidden radio/checkbox inputs on Explore 1440 (their labels are the targets); one inline text link on Legal Data. No real gaps.
- Wide content inside its own scroller (not page scroll): Explore 1440 results table 1606 px wide in a ~970 px column; Compare/Log/Manifest/Coverage tables at 390.
- Broken states: see D-6, D-7, D-9 (Log/Compare tables crushed at 390 and 1440, Explore missing-reason pill wraps into a circle, Run numbering mismatch).

## Matrix

| Family | 1440 | 768 | 390 |
|---|---|---|---|
| Shell / header / nav | Differs: no header search box or apps grid; no footer strip; help menu lacks Keyboard shortcuts (D-1) | Differs: same (D-1) | Differs: county is a native select, not the location sheet; More sheet labels and icons differ (D-1, D-2) |
| Hub (structure and copy) | Differs (low): no Watch demo / Pull requests buttons or app icon tiles; otherwise order and copy match (D-3) | Differs (low): same (D-3) | Differs (low): same (D-3) |
| Welcome card | Match: the same title, intro, three questions and "Got it" (shown inline, not as an overlay) | Match | Match |
| Explore workspace (filters, table, tabs, pager) | Differs: the table has 10 cramped columns and is wider than its pane, rows are about 150 px tall, the missing-address pill wraps into a circle, 200 rows per page, no radius/pager footer bar, "Open ≥" placeholder is cut off (D-4) | Differs: a long card per property instead of the compact table, 200 per page (D-4) | Differs: cards about 750 px tall, no results summary bar, place chip or radius above the list, no Edit-query FAB (D-4) |
| Property drawer | Differs: chips, Street View box, Show in list, Ask and the Roof evidence chain now match. Missing: Google Maps link; Permit/Owner/Location/Metadata sections (a generic Fields grid instead); the drawer replaces the results instead of sitting beside them (D-5) | Differs: same (D-5) | Differs: same, plus an inline card instead of a bottom sheet with a grabber, and a "Close" text button instead of copy-link + X (D-5) |
| Runs | Differs (low): order (picker, Sync status, Pipeline, Latest events, What changed) matches, and Gantt is Justified. The layout is one column instead of the board's two, and a long run-detail block follows that the board does not have: 15 "Data groups" batch rows and raw Limitations text (D-8) | Differs (low): same (D-8) | Differs (low): extra run-detail block (D-8) |
| Runs · Compare | Differs: the two runs are long stacked blocks instead of 3 compact summary cards in a row; the change table comes after them (D-7) | Differs: same (D-7) | Differs: the change table at 390 breaks source ids letter by letter ("austi n- 3syk-"), Removed column is cut off; the board stacks per-source rows (D-7) |
| Runs · Log | Differs: chips, table, pager and CSV match the board, but the Run column wraps the raw run id letter by letter, status pills wrap ("Sta rte d"), long Limitations bullets make rows 100–300 px tall, and the default sort is oldest first (the board shows newest first) (D-6) | Differs: same (D-6) | Differs: **broken**: the table is crushed to 2–3 characters per line, so one row runs to thousands of px (D-6) |
| Coverage (incl. Cost and Limits) | Differs: KPI tiles, Loaded-vs-total table, Known limitations, Source speed and Cost match in order. Gross/Credits tiles and missing area heatmap are Justified. "Counts by record kind" is a long run of text cards repeating the table; Source-speed cells are paragraphs; the Cost Filebase row shows a local config path and "this draft" (D-9) | Differs: same (D-9) | Differs: same; it stacks without overflow (D-9) |
| Data · Manifest | Differs: tabs and Run-chain cards now match. The chain labels the latest run "Run 3" while the header, Runs and Log call it "Run 4"; the artifact table lists all 285 full paths with no pager; no Run picker or manifest.json download (D-10) | Differs: same (D-10) | Differs: same (D-10) |
| Data · Catalog | Differs: search and Query in SQL added, but it is still a grid of cards with CID chips. It has no table list on the left with a field table (Field/Type/Meaning/Source/Licence), no Copy schema and no v_roofing_permit box (D-11) | Differs: same (D-11) | Differs: same (D-11) |
| Data · Verify | Differs (low): Pinata/Filebase lanes instead of ipfs.io/dweb.link are Justified (architecture: ipfs.io retired, pinning gateways). No file-picker chips, no Verify button, no "Checking on 2 public gateways" banner (D-12) | Differs (low): same (D-12) | Differs (low): same (D-12) |
| AdminSignIn | Justified: email + password + "Sign in" replaces the email-code flow (parity doc, AC-6 amended). Icon, title, intro, info banner and Cognito note match | Justified | Justified |
| Activity | Justified: admin-only; a signed-out visit shows the admin sign-in gate (correct). The signed-in layout could not be compared without admin credentials; the reduced metrics are in the parity doc (AC-10) | Justified | Justified |
| Help · MCP (structure and copy) | Differs (low): Endpoint, Access, Tools (6), Connect a client (3 tabs), Try a tool are all present. "Connect a client" comes after Tools, not beside Endpoint/Access; no per-tool input-schema table or example request/response (D-13) | Differs (low): same (D-13) | Differs (low): same (D-13) |
| Legal · Data (structure and copy) | Match: TOC, info banner, Sources and licences table, How to cite and Corrections, plus Access rules | Match | Match |
| Legal · Privacy | Match: the same 6 sections and TOC; the banner text is the Data page's ("links to each publisher's own terms") | Match | n/a (no 390 board) |
| Legal · Terms | Match: same TOC (the board's "Contact" is missing; there is no contact channel) | Match | n/a |

**Counts (52 cells): Match 10 · Justified 6 · Differs 36** (of which 12 are low-severity: Hub, Runs, Verify, Help MCP).

## Differs list (fixable)

- **D-1 Shell header and footer** (all widths). Board: header has a global Search box (390: search icon/pill) and an apps-grid icon; the help menu includes "Keyboard shortcuts"; every desktop page has a footer strip "Terms · Privacy · Data licences · Street View: coming soon". Preview: county select + "Other counties and states · Coming soon" link, sync badge, help, Ask. There is no search, no apps grid and no footer (footer links only on Hub). Files: `apps/web/src/components/AppShell.tsx`, `HelpMenu.tsx`.
- **D-2 County picker and More sheet (390).** Board: a "Choose a location" bottom sheet with Texas / Other states groups and Live / Coming soon pills; the More sheet has icon rows (Coverage, SQL, What can I ask?, Glossary, MCP and API docs, Apps, Admin sign-in, Settings) plus footer links. Preview: native `<select>`; More sheet is a plain text list "Pages" (Coverage, SQL, Admin sign-in, Runs · Compare, Runs · Log, Data · Catalog, Help · MCP, Legal ×3) + "Planned", no icons. Files: `components/CountySelect.tsx`, `AppShell.tsx` (`MoreSheet`), `routes/route-list.ts`.
- **D-3 Hub.** Board run line has "Watch demo" and "Pull requests" actions and icon tiles on the app cards; preview has neither. File: `routes/Hub.tsx`.
- **D-4 Explore results.** Board: a compact 9-row table (Address, Roof+chip, Basis, Conf. pill, Permit, Mi, Lat/lon, icons). Pages are small; the footer bar holds "Showing 1–9 of 9", radius slider, pager and download. 768 uses a 4-column table; 390 has a summary line, place chip, radius slider, Filters chip, compact rows with Roof/permit chips, an Edit-query FAB and a pager. Preview problems:
  - 1440: 10 columns (adds Owner, Contractor, full Source URL). The table is 1606 px wide in a ~970 px pane, cells wrap to 4–8 lines and rows are about 150 px tall. The "not published · no lexicon carrier" pill wraps into a circle ("publishe d").
  - 768 and 390: full field-grid cards (about 470/750 px each).
  - All widths: 200 rows per page ("Showing 1–200 of 28,062"). The "Open ≥" input placeholder is cut off ("any tim").

  Files: `components/ResultTable.tsx` / `.module.css`, `components/ResultRow.tsx`, `routes/ExploreFilters.tsx` (page size, footer bar).
- **D-5 Property drawer.**
  - Missing on all widths: the "Open the area in Google Maps" link (lat/lon are available) and the grouped Permit / Owner / Location / Metadata sections (the preview shows a generic "Fields" grid).
  - 1440 and 768: the drawer replaces the results column; on the board the list stays beside it.
  - 390: no bottom sheet with a grabber; copy-link + X icons are replaced by a "Close" text button.
  - Not counted as gaps (Justified): the title is "Property bagu…" because addresses are not published (real data), and Open in CRM is missing because the CRM is not deployed.

  File: `routes/PropertyDrawer.tsx`.
- **D-6 Runs · Log table (high).**
  - Run column prints the raw run id in mono and wraps it letter by letter; the board shows just "3", so the id should be secondary or a tooltip.
  - Status pills wrap ("Sta rte d", "Do ne wit h lim ita tio ns"); they need `white-space: nowrap`.
  - "Run finished" rows embed long Limitations bullet lists; collapse them.
  - Default sort is oldest first; the board shows newest first.
  - At 390 the table is not adapted: each column is 2–3 characters wide and one row spans thousands of px. Use a stacked list or a scroll wrapper with min column widths.

  Files: `routes/RunsLog.tsx`, `RunsLog.module.css`.
- **D-7 Runs · Compare.** Board: 3 summary cards in a row (previous, current, CAR available), then the change table, then Immutability checks. Preview: two full-width run blocks (manifest, finished, previous manifest URL, artifacts path, per-source lines) with large gaps, then the table, then the checks. At 390 the change table wraps source ids letter by letter and the Removed column is cut off; the board 390 stacks per-source rows. Files: `routes/RunsCompare.tsx`, `Runs.module.css`.
- **D-8 Runs (low).** Board 1440 puts Sync status at the right of the title, Pipeline and fetch-source list side by side, and Latest events beside the timeline. Preview: one column. Below "What Run 4 changed" the preview adds a run-detail block (Sources, Coverage, 15 "Data groups" batch rows with CIDs, long Limitations text) the board does not have; consider collapsing it. Files: `routes/Runs.tsx`, `Runs.shared.tsx`.
- **D-9 Coverage.**
  - "Counts by record kind" (Property, Ownership, Permit, Contractor, BBB, Business, Places, Coordinates) is a series of long text cards with repeated missing-reason pills and manifest lines. It repeats the "Loaded vs each source's own total" table, where the board uses one table with bars and status pills.
  - "Source speed and constraints" cells are full paragraphs (rows 200–400 px tall).
  - Copy issues in the Cost Filebase row: "~/.config/assessment/filebase.env exists with FILEBASE_ACCESS_KEY, FILEBASE_SECRET_KEY, FILEBASE_BUCKET … No dashboard was opened for this draft". This publishes a local path and env-var names (no values) plus draft wording. Also, the "Cognito user pool (Part 2, not deployed)" row may be stale now that admin sign-in exists.

  Files: `routes/Coverage.tsx`, `Coverage.kinds.ts`, `CoverageCostLimits.tsx` (or its cost data source / `docs/cost.md` extract).
- **D-10 Data · Manifest.**
  - **Run numbering mismatch:** the Run chain labels travis-full-run3-20261025 "Run 3 · this run", but the header badge, Runs, Compare and Log call it "Run 4 · Oct 25". The chain numbers by chain position (3 manifests linked) instead of `runs/index.json` position.
  - Artifact table: all 285 rows with full pipeline paths and no pager (board: short names with descriptions, pager "1–7 of 13").
  - No Run picker and no manifest.json download.
  - Dates print "…Z UTC" twice.

  File: `routes/DataManifest.tsx`.
- **D-11 Data · Catalog.** The board has a list of tables on the left (icons, row counts) with a detail pane on the right: a field table (Field, Type, Meaning, Source, Licence), Query in SQL and Copy schema buttons, and a "v_roofing_permit reads this table and adds" box. The preview is a 2-column grid of table cards (size, rows, CID chips, "N columns") with no field table and no Copy schema. File: `routes/DataCatalog.tsx`.
- **D-12 Data · Verify (low).** Board: file-picker chips (file, size), a primary "Verify" button and a "Checking on 2 public gateways…" banner above the two lanes. Preview: verification runs on load for the CID in the URL, with no picker or button. The gateway names are Justified. Files: `routes/DataVerify.tsx`, `components/VerifyLane.tsx`.
- **D-13 Help · MCP (low).** Board order: Endpoint | Access | Connect a client cards across the top, then Tools list | tool detail (input-schema table, example request, response) | Try a tool. Preview: Endpoint, Access, Tools (text list), Connect a client, Try a tool (one JSON box). File: `routes/HelpMcp.tsx`.
- Minor copy: the Legal · Privacy banner reuses the Data page sentence ("links to each publisher's own terms"); the board's banner is privacy-specific. File: `routes/LegalPrivacy.tsx` / `content/legal.ts`.


### Remaining differences (exception, PO scope "demo path first")

Not built in A-16: header search and apps grid; native county select; More sheet icons; Hub demo/PR buttons; Explore compact 9-column table with small pages (the product keeps 200-row pages for the full county and field cards at 768/390); drawer Google Maps link and Permit/Owner/Location sections; Runs two-column layout; Compare summary cards; Catalog field table and Copy schema; Verify file picker; Help MCP schema table. Each is a design difference, not a broken state; none hides data or a missing reason.


## Final hosted review (preview `03c0ebc`, 2026-10-26 07:20 EEST)

After the PO's UI notes, the responsive round (5 families), the board-by-board round reusing Task B layouts, the style pass from the PO's design screenshots and the run-numbering decision: **21 Match / 6 Justified / 25 Differs** on the same 52 cells (was 10/6/36, then 16/6/30); 27/6/33 on all 66 cells. No horizontal page scroll; panels use the width; AI answers render as formatted text; run names read Run 1–3 and Pilot slice everywhere. The broken states and PO-rule items it found were fixed in the next build (`2d17339`): Catalog and Coverage use the shared run dropdown; bare `/data/verify` opens the latest manifest; the Permits pager no longer covers rows; "SQL checks" removed; year built and owner on cards; no debug lines or raw field names in AI answers; no story IDs in page copy. Remaining differences are features the boards show and the product does not have (AI three-pane layout with editable "Read as" chips, Save, Area/Sort dropdowns, Manifest pager, Verify file chips and button, Log newest-first while TC-057 pins oldest-first, Gantt timeline, per-area heatmap, reconciliation) — recorded as the exception "prototype parity beyond the PO's style-only scope". Side-by-side images are kept with the review outside the repo.

# A-16 AC-12 parity, final review round 2 (read-only)

Preview: https://016-cost-and-admin.d2lx0utip89u18.amplifyapp.com. `/build.json` sha `03c0ebc…` (live about 8 minutes after polling started). Light theme, 2026-10-26.

**Boards:** baseline captures in `scratchpad/parity/board/` (`design/prototype` is unchanged since `3f4de6f`), plus the PO screenshots 6–14.png for Catalog, Verify, Manifest, Coverage, Runs, Explore Filters and Explore AI.

**Images:**
- Side-by-sides (board left, preview right) are in `img/<family>-<width>.png`. They live in `parity-final2/img/`, next to this file, not in `../img/`.
- Crops are in `img/crop-*.png`.
- Raw captures are in `app/`; `-tall` is the full scroll, capped at 7000 px.
- Text dumps are in `txt/`, metrics in `metrics.json`, and the scripts are `cap2.mjs`, `cap2v.mjs` and `sbs2.mjs`.

**Loads:** one per page per width. Verify had a second load per width because the bare `/data/verify` URL turned out to be a broken route (see B-6); the real page is `/data/verify/<cid>`. The README AI question was asked **once**, at 1440. The test-admin password was read from the env file and never printed.

## Global checks
- **Horizontal page scroll:** none at any width. Document and `main` widths equal the viewport.
- **Panels use the width:** yes. The right gap is 24 px (1440/768) and 16 px (390) on every page.
- **Inner sideways scroll:** none. B-4 is fixed: Log and Manifest at 768 now fit, with Manifest stacked as cards.
- **Targets < 48 px:** one, Catalog's "10 files" summary (46×48) at all widths. Inline links are ignored.
- **Console errors:**
  - `GET /api/trpc/admin.runs.live` 404 after admin sign-in, at all widths. The page handles it ("Bridge offline").
  - The React Router default ErrorBoundary on bare `/data/verify` (B-6).
  - Nothing else.
- **Page heights (px):**

  | Page | 1440 | 768 | 390 | Before |
  |---|---|---|---|---|
  | Explore | 3,042 | 3,222 | 4,509 | 15–39k |
  | Manifest | 1,348 | 1,467 | 1,941 | 19–61k |
  | Permits | 53,264 | 73,208 | 70,605 | 47–130k |
  | Coverage | 4,876 | 9,730 | 13,084 | |
  | Runs | 2,818 | 4,827 | 6,968 | |
  | AI after the answer | 16,313 | | | |

- **Raw markdown:** none anywhere. The AI answer renders as `P/STRONG/H4/A` with bar-quoted notes. There is no `**`, `###` or `|---|`.

## PO rules
| Rule | Result |
|---|---|
| Run lists use the shared dropdown | **Partly.** RunSelect is on Runs, Compare (two pickers), Log (with "All runs") and Manifest. Switching works on Runs (`?run=travis-full-run2-20261024`, content changes) and Manifest at all widths. **Two violations:** Catalog uses its own native `<select>` with different labels ("Run 3 · current", "Run 2 · Oct 24", no year). On Coverage, "Run 3 · Oct 25 · current ▾" is a link to `/runs` styled as a dropdown. |
| Runs read Run 1–3 and "Pilot slice", never "Run 4" | **Pass on every page.** The options are Run 3 · Oct 25, 2026 · latest / Run 2 / Run 1 / Pilot slice · Oct 21, 2026. Compare leaves the Pilot slice out of its pickers, which is reasonable. |
| Panels use the width | Pass. |
| Short missing-data pills | **Mostly pass.** Coverage · Cost has "Filebase usage: not available" (B-1 fixed). Permits pills name the field ("Expiry date: not in the data model"). **Still long or technical:** Coverage Loaded-vs-total pills say "denominator not in this run's manifest · A-01 source austin-3syk-w9eu". In the AI answer, each of 50 sources lists 7–16 raw snake_case lines ("unnormalized_address: Not included in the published tables"). The drawer has a raw "Not published: unnormalized_address, city_name, …" list. |
| Contractor names where the data has them | **Not shown on page 1 of Permits.** All 200 rows (the oldest permits, 1978 onward) read "Contractor name: not on record" and "Contractor company: not on record". Sorting oldest first hides any named contractor. The AI and drawer paths were not exercised with a contractor question (one AI question only). |
| Year built and owner names where present | **The drawer passes:** "Basis: Year built 1934 (no reroof permit found)", "Owner: William Smith", last sale 1997-04-01. **The Explore cards** show neither, only "Roof 92 yrs · Confidence low · Owned 29 yrs". **The AI answer list** shows only CIDs, distance and ages ("[1] · 1.19 mi · ~126 yrs · 4 yrs · baguqeer…"). |
| "Address not in the published export" | **The drawer passes**, both in the header and in Location. The cards use the short pill "No address", which is fine. **The AI answer and drawer "Not published" lists** say "Not included in the published tables" instead. |
| No SQL wording | **One violation:** the More sheet at 768/390 lists "SQL checks · Coming soon". The Hub, What-can-I-ask, Privacy and Activity SQL copy (C-1) is fixed. **Borderline:** Catalog says "views.sql defines them…" and "In MCP, use the views". Explore says "DuckDB on the server · same views". Permits says "DuckDB-WASM in your browser · read-only". |

## Matrix (1440 / 768 / 390)

| Family | 1440 | 768 | 390 |
|---|---|---|---|
| Shell / header / More | **Match:** one-row bar with search, Run chip, help, Ask and the Apps menu; the rail nests Filters, Builder and AI under Explore | Differs (low): no header search; the More sheet has "SQL checks" | Differs (low): the More sheet items differ from the board and include "SQL checks · Coming soon" |
| Search box | Match: "Austin" → "Austin city · Place" → `?place=4805000` | Differs (low): only inside Explore | Differs (low): same |
| Hub | Differs (low): no Watch demo / Pull requests; SQL copy fixed | Differs (low) | Differs (low) |
| Welcome / What-can-I-ask | Match (carried over; SQL copy gone) | Match | Match |
| Explore Filters | Differs (low). Filter pane per 13.png, Task B card list, 20 per page ("Showing 1–20 of 98,180", pager 1 2 … 4909). Remaining: a row of four "Coming soon" links above the results; the sticky pager lets cards show below it; no radius slider or download in the footer; header "98180 within 5 mi" without a separator; "Owned 0 yrs"; "· preset ooa78753"; "(owner_area_class)" in the help | **Match:** 20 cards with the pager | Differs (low): the four Coming-soon links and the Filters button push the list down; no Edit-query FAB; cards about 170 px tall |
| Property drawer | Match: beside the list, owner, year built, evidence chain | Differs (low): bottom sheet; the board shows a full page | Match: bottom sheet with grabber |
| Explore AI (answered at 1440, idle at 768/390) | Differs: single column (form, chips, answer) instead of 14.png's three panes (query + "Read as" chips / answer / numbered result table). The answer is formatted, but its list has no addresses and it shows "built_year" and debug lines ("1 tool call(s), 1 result(s) / 0 tool call(s), 0 result(s)") | Differs (low) | Differs (low) |
| Runs (+ RunSelect) | Differs (low). Header RunSelect, Sync status, pipeline strip, Timeline/Latest events and What-changed all follow 12.png. The run-detail block is still below (D-8). Counts print without separators ("2381886", "3341281") | Differs (low) | Differs (low): 6,968 px, with the detail block, Data groups and Limitations below |
| Runs · Compare | Match | Match | Match |
| Runs · Log | Differs (low): still sorted oldest first (D-6) | Differs (low): fits now (B-4 fixed); sort as at 1440 | Match |
| Coverage | Differs. Fixed: head, KPI tiles and the Cost list match 9–11.png. Remaining: Loaded-vs-total uses raw source IDs ("austin-3syk-w9eu") with "A-01 source …" pills; the "Counts by record kind" cards repeat the table (D-9); the run chip is a link, not a dropdown; the area grid shows "Not available" (justified by the data) | Differs | Differs (13k px) |
| Data · Manifest (+ RunSelect) | Differs (low). Title, RunSelect, manifest.json, run-chain cards with arrows and the table columns follow 8.png. All 285 artifacts sit in a 70vh inner-scroll panel instead of the board's pager (D-10) | Differs (low): stacked cards | Differs (low) |
| Data · Catalog | Differs (low). Table list, header card with Search in Explore and Copy schema, field table and views card follow 6.png. Remaining: a native run select (PO rule); a stray "table export not in this run's manifest" line at the top; counts without separators; "not described in contract/v1" | Differs (low) | Differs (low): the field table sits below the long list and the views card |
| Data · Verify (`/data/verify/<cid>`) | Differs (low): run-manifest card plus Pinata and Filebase lanes (justified); no file chips or Verify button (7.png, D-12) | Differs (low) | Differs (low) |
| Permits | Differs: fits the card, field-named pills (B-2 fixed). Still 200 per page with 9 pills per row (53k px) | Differs (73k px) | Differs: "Show 11" folds the pills, but the sticky pager covers about 130 px of the card (B-7); 70k px |
| Help · MCP | Match: example request added (D-13 fixed) | Match | Match |
| Admin sign-in | Justified (email + password, AC-6 amended); signs in to `/runs` | Justified | Justified |
| Activity | Justified (carried over; not re-loaded) | Justified | Justified |
| Legal · Data / Privacy / Terms | Match ×3 | Match ×3 | Match ×3 |
| Coming soon (`/tx/williamson/explore`) | Match | Match | Match |

### Counts
- **Same 52 cells as before:** **Match 21 · Justified 6 · Differs 25** (before: 16 / 6 / 30). Moved to Match: Shell 1440, Explore 768, Log 390 (kept), and MCP ×3. Nothing regressed to Differs.
- **All 66 cells** (adds Search ×3, AI ×3, Permits ×3, Coming soon ×3, Privacy/Terms 390): **Match 27 · Justified 6 · Differs 33** (before: 22 / 6 / 38).

## Broken states
- **B-6 (new): bare `/data/verify`** shows React Router's developer page, "Unexpected Application Error! 404 Not Found 💿 Hey developer 👋", with a console error, at all widths. There is no catch-all or errorElement. The in-app Verify tab links to `/data/verify/<cid>`, so only a typed or shared URL hits it. Any unknown route probably does the same.
- **B-7: sticky pagers overlap content.**
  - Permits 390: the pager block (about 130 px) covers a card.
  - Explore 1440: card content shows below the floating pager bar.
- **B-5: `admin.runs.live` 404** after sign-in (handled in the UI as "Bridge offline").
- **B-3 (partly fixed): Permits** is still 53k–73k px (200 rows per page × 9 pills each). Explore and Manifest are fixed.
- **B-8: the AI answer debug text.** "1 tool call(s), 1 result(s)" and "0 tool call(s), 0 result(s)" print under the answer. The 50 sources each repeat 7–16 raw field-name lines, which makes the page 16k px.
- Fixed since the last round: B-1 (Coverage pills), B-2 (Permits width and unnamed pills), B-4 (768 inner scroll), and the "…000Z UTC" dates.

## Top remaining differences
1. PO rule: Catalog's native run select and Coverage's fake run dropdown.
2. PO rule: "SQL checks · Coming soon" in the More sheet.
3. The Explore AI layout is one column, not 14.png's three panes. Its result list has no addresses, owner names or year built, and it shows raw field names and debug lines.
4. Permits: 200 rows per page, oldest first, with no contractor names on page 1.
5. Manifest has no pager (inner scroll of 285 rows). Verify has no file chips or Verify button. Log sorts oldest first. Runs still has the detail block below the board layout.
6. Copy:
   - Counts print without separators ("98180", "2381886", "851166").
   - "Owned 0 yrs".
   - "· preset ooa78753".
   - "(owner_area_class)".
   - Internal IDs in user copy: "A-01 source …" (Coverage) and "the A-03 pilot slice" (Compare).
   - "table export not in this run's manifest" (Catalog).
