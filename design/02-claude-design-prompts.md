# CountyLens: Claude Design prompt script

Oct 17, 2026 · HebaGaber · Source: the "CountyLens UX Research and Design Brief" doc. The context is in [01-ux-context.md](01-ux-context.md), and the demo script is in [03-demo-script.md](03-demo-script.md).

Paste these 15 prompts into one Claude Design project, in order, and check each result before the next. Step 0 sets the rules once; each later step builds one screen group.

**Step 0: Set up the project.** Open Claude Design, start a new project, select the **Atlas** design system, and attach `design/01-ux-context.md` and `design/03-demo-script.md` from the repo. Then paste:

```text
You are designing "CountyLens", a data-exploration web app for real, public property data in Travis County, Texas: properties, owners, sales, coordinates, building permits (especially roofing), contractors, BBB ratings, businesses and places. Users are an evaluator and CRM developers judging how easy it is to find, read and trust the data. It is NOT a sales or lead app. The attached 01-ux-context.md holds the product direction, benchmark, UX standards, helper features and screen map; 03-demo-script.md holds the demo script every screen must serve.

Rules for every screen:
- Use only the attached Atlas design system tokens and components (Material 3). If you need something new, extend the closest component with tokens only and list it in an Extensions log.
- Mobile-first: design 390 px first (full-bleed map, bottom sheet, bottom navigation), then 768 and 1440 (map and list side by side).
- Every value shows where it came from: source, capture time, run and CID, one tap away.
- Missing data is labelled with the reason, never blank.
- Roof age always shows its basis (reroof permit, new build, year built) and a confidence badge.
- Every screen has six states: loading, empty, error, partial data, rate-limited, populated.
- Items marked (nice to have) in later prompts are designed fully but stay secondary: they must never crowd or block the core screens.
- Sample data is marked "Sample" in the prototype. Real figures you may show: City of Austin permits 2,380,507 rows; 22,083 reroof permits; domain countylens.aldarraj.com.
- Travis County, TX is the first live county and the default. Other counties and states are shown as "Coming soon" only: visible in the location switcher, muted, never with data, counts or results.
- Make the value visible. The design must express three promises, in the welcome line, empty states, help text and the order of information: (1) everything in one place, (2) proof behind every value, (3) answers, not dead ends. The "Value" section of 01-ux-context.md lists the pains each screen removes; every screen should visibly solve at least one.

First, reply with a site map and the main user flows before drawing any screen. For each screen, name the pain it removes and the promise it shows.
```

**Step 1: App shell and navigation.**

```text
Design the app shell. Header: app name "CountyLens", a location switcher showing the active county ("Travis County, TX", selected by default) that opens a state → county picker where Texas: Travis County is live and other counties and states are listed as "Coming soon" (muted, not selectable for data; tapping one explains it is not available yet, with an optional "Notify me"; use an illustrative list such as Williamson County TX, Hays County TX, Harris County TX, and the states Florida and Arizona, marked as placeholders), one universal search box (addresses, places, owners, contractors, permit numbers or a plain question), a sync badge ("Synced 2 h ago · Run 3", tap opens Runs), a Help menu (tour, glossary) and an "Ask" button that opens the AI helper side panel. Navigation: Explore (map), Search, Runs, Coverage, Data (manifest, verify, metadata), SQL, Activity. At 390 px use bottom navigation with Explore, Search, Runs, Data, More. Footer: Terms, Privacy, data licences, Google Maps attribution note. Show the shell at 390, 768 and 1440.
```

**Step 2: Welcome, preferences and guided tour.**

```text
Design the first-visit experience, kept under 30 seconds. Screen 1: a one-line welcome that states the value ("Every Travis County property, permit and contractor in one place, with the source behind every value"), three small promise cards (everything in one place, proof behind every value, answers not dead ends), and three preference picks: area of interest within Travis County (city, ZIP, or "use my location"; a note that more counties are coming soon), what I care about (roof age, open permits, owners, contractors; multi-select chips), units (miles). Skip is always visible. Then a five-step coach-mark tour over the live map: 1 search box, 2 map layers, 3 tap a property, 4 the source chip, 5 the Ask button. Each step has Next, Back and Skip, and the tour can be replayed from Help. Also design one-line hints for empty states.
```

**Step 3: Explore map (the home screen).**

```text
Design the Explore map, the home screen. Map of Travis County opened on the user's chosen area. Layer toggles: roof age (hexagons when zoomed out, markers when zoomed in, coloured by the Atlas roof-age scale with numeric legend), open and stalled roofing permits (coloured by open duration), coverage gaps. Drop a pin, search a place or use GPS; a live radius ring with a draggable handle and a slider 0.5–25 mi kept in sync, and a count chip on the ring ("128 properties in 5 mi") that updates while dragging. A filter row with the most-used filters (roof age ≥ N years, permit status, owner tenure > N years, out-of-area owner) and "More filters". Results list beside the map (bottom sheet at 390): address, roof age + basis + confidence badge, open-permit duration, contractor, BBB rating or "not available", and a source chip. Under the results, a "Close matches" section: places that miss one criterion, each saying what it misses and by how much. A "Try next" row of suggestions. Search state is kept in the URL.
```

**Step 4: Property detail.**

```text
Design the property detail view (a drawer on desktop, a full sheet at 390). Top: address, a Street View photo of the property with its image date and the Google Maps logo inside the photo box, visually separated from our content; an "Open in Google Maps" link; a "No street imagery here" state. Sections: Roof (age, basis, confidence, the evidence chain as chips: reroof permit 2003 → source → captured date → CID), Permits (table with status, issue and final dates, open days, contractor, BBB), Owner (name, mailing location, out-of-area flag, last sale date, tenure or "unknown, no deed data"), Location (coordinates and their source), Metadata (every field's source, capture time, run, CID, licence). "Similar properties" carousel. Actions: copy link, "Show on map", "Ask about this property", "Open in CRM".
```

**Step 5: Search and advanced query builder.**

```text
Design the Search screen. A large search box with typed suggestions grouped by kind (place, address, owner, contractor, permit). AI search (nice to have): typing a plain-English question ("old roofs near Pflugerville") turns it into filters shown as editable chips, plus an "Ask the helper instead" link for complex questions. Below the box: the top 5 "Most searched" shortcut chips for the last 7 days (nice to have; labelled "Suggested starting points" until 5 real searches have been logged), recent searches and saved searches. An advanced query builder: add conditions with field, operator and value pickers (fields from properties, permits, owners, contractors), AND/OR groups, a live count of matches as you build, and "Show on map" or "Show as table". A table results view with sortable columns, column picker and CSV copy. Show the whole query as a plain-English sentence ("Properties within 5 mi of Pflugerville with roof age ≥ 15 years and an open roofing permit").
```

**Step 6: Runs, sync and pipeline history.**

```text
Design the Runs screen. A horizontal run timeline scrubber: dragging across runs updates the numbers and shows delta chips (+added, ~changed, −removed) and the manifest CID change from the previous run. A run card: run id, start and end time, duration, sources, record counts per source, deltas, limitations, manifest CID and previous manifest CID (both copyable, both linking to Verify). A run comparison view (Run N vs N−1). A pipeline history log: a table of every pipeline event, newest first (run started, source fetched, records added, published, verified, warning), with time, source, count and status. A sync status panel: last sync, next scheduled sync (or "scheduler off by default"), and a stale-data warning state.
```

**Step 7: Coverage and sources.**

```text
Design the Coverage screen. One row per source (property, permit, owner, contractor, BBB, business, places, coordinates): records loaded vs that source's own denominator with a % bar, collection timestamp, run, provenance link, and status (complete, partial, blocked, not public). A "Known limitations" panel in plain language (for example "BBB: source blocks automated access; ratings shown where available"). A source speed and constraints table (throughput, rate limits, slow sites). A cost panel: idle cost $0 per component with a link to the cost evidence.
```

**Step 8: Data: manifest, verify and metadata.**

```text
Design the Data screen. A manifest table for the selected run: name, CID (copyable), codec (file or directory), size, SHA-256, CAR link for directories. An IPNS card showing the IPNS name and the CID it resolves to for this run. A Verify action per artifact that runs a "gateway race": two lanes (ipfs.io and dweb.link) with bytes received, time, and a digest check that turns into "verified" when it matches the manifest; states for checking, rate-limited with countdown (inside the lane, not an error), retrying, mismatch and verified. A data catalog: every table with its fields, meanings, types, source, licence, row count and last update.
```

**Step 9: SQL panel.**

```text
Design the SQL panel for experts. A read-only query editor with example queries (radius + roof age, longest-open roofing permits, owners who have not sold in 10+ years, out-of-area owners), a schema browser of the four views (v_property, v_roofing_permit, v_contractor, v_run), a results grid with row count and run time, and a clear banner: "Runs in your browser with DuckDB. No database server." Errors explain what went wrong in plain words.
```

**Step 10: Activity: query log and popular searches.**

```text
Design the Activity screen (nice to have). Top: a "Last week" summary card with total searches, top areas, top filters, median and p95 response time, failure rate and the top failure reasons; a "Not enough activity yet" state. A "Most searched this week" panel with the top 5 searches and their counts. A query log table of searches, filters, AI searches, helper questions and SQL queries: time, type, query in plain English, result count, response time (ms), status (succeeded, or failed with the reason), run; filters by type, status and date; a "Run again" action; failed rows easy to spot. A note: "Kept for 30 days. No personal data is stored."
```

**Step 11: AI helper side panel.**

```text
Design the AI helper as a side panel that opens from any screen (a full sheet at 390) and knows the current screen and selection. Show suggested questions for the current context. An answer shows: a short answer, a result table, numbered citations beside each claim that preview the source record on hover and open it on tap, a stated-assumptions row of editable chips (centre point, radius, roof-age threshold, what "many years" means), and a "missing data" note. "Show on map" drops numbered pins that match the citation numbers. Include the two README prompts as worked examples: roofs older than 15 years within 5 miles of Pflugerville, and long-open roofing permits with their contractors.
```

**Step 12: States pass.**

```text
For every screen designed so far, add the six states: loading (skeletons), empty (with a one-line hint and a suggested search), error (what failed and how to retry), partial data (which sources are missing and why), rate-limited (countdown and retry), populated. Also design the "Coming soon" state for a county or state that is not live yet. Show them as a states board per screen.
```

**Step 13: Responsive and accessibility pass.**

```text
Check every screen at 390, 768 and 1440 px, in light and dark. Text contrast at least 4.5:1, touch targets at least 44 px, visible keyboard focus, map controls reachable by keyboard, reduced-motion versions of the radius ring, hexagons and gateway race. List any fixes you made.
```

**Step 14: Prototype and hand off.**

```text
Make these interactions clickable: live radius ring with count chip, roof-age heat to markers on zoom, "why is this a match?" chips opening lineage, helper answer to map handoff with editable assumption chips, run timeline scrubber, gateway race on Verify, close matches, the guided tour. Then produce a handoff: site map, user flows, every screen and state, the components used, the Extensions log, and a table mapping each README demo line to its screen and state.
```

Then export with **Handoff to Claude Code** into the repo's `design/` folder and run `/developmentsupport-prototype-review`.
