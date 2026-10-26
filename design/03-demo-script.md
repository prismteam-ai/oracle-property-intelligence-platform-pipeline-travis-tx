# CountyLens: demo script

Oct 26, 2026 · HebaGaber · The recording follows this script in order on the hosted app at `https://countylens.aldarraj.com` (light theme, a 1440 px window). Section 1 is the recording guide: for each README line, the link to open, what to show and the figures on screen on 2026-10-26 (Run 4, `travis-full-run4-20261026`, the latest of six runs). Section 2 is the README transcript, copied word for word from `README.md`. Context: [01-ux-context.md](01-ux-context.md). Prompts: [02-claude-design-prompts.md](02-claude-design-prompts.md).

## 1. Recording guide: README line → link → what to show

Demo place: **Austin** (the permit source is the City of Austin, so long-open roofing permits exist there; Pflugerville has old roofs but almost no permits).

| # | The presenter says | Open | Show (figures on 2026-10-26) | Evidence |
| --- | --- | --- | --- | --- |
| D-1 | "I will demonstrate that the Oracle pipeline has loaded the available dataset for Travis County…" | `/` | The Hub: the run chip "Run 4 · Oct 26", Travis County live | — |
| D-2 | "First, I am opening the pipeline run summary." | `/runs` | Run 4 · latest: Sync status (county coverage 89.6 % of the TCAD roll), the pipeline steps, the three sources with records read and capture times (Austin re-read on 2026-10-26: 9 added, 35 changed), the limitations (open "Show all"); then `/runs/log` for the event history of all 6 runs | `docs/evidence/A-11.md`, `docs/evidence/A-16.md` |
| D-3 | "Show the total uploaded records by source." | `/tx/travis/coverage` | Published vs each source's own total: TCAD 441,961 of 493,246 (89.6 %), Austin permits 15,025 roofing of 2,381,886 read, address points; counts by kind (property, permit, contractor states 130 candidate / 112 conflicting); say BBB is not collected (bbb.org refuses automated access) and business records only feed the contractor match | `docs/evidence/A-01-coverage.md`, `docs/source-limits.md` |
| D-4 | "Now I am opening the DuckDB-backed query layer." | `/data/catalog`, then `/help/mcp` "Try a tool" | The tables and fields of the run (Parquet on IPFS); every Explore and MCP query runs DuckDB over those files on a Lambda that scales to zero ("DuckDB on the server · same views" under the Explore results). No database server runs while idle (Coverage · Cost: $0.00 fixed per month) | `docs/evidence/A-13-duckdb.md`, `docs/cost.md` |
| D-5 | "Show the published artifact manifest for this run." | `/data/manifest` | Run chain (this manifest CID → previous manifest CID), then the 285 artifacts with CID, size, name, codec and SHA-256; open `manifest.json`. No IPNS (AD-03): the run index and `previousManifestCid` link the snapshots. A directory's size and digest describe its CAR | `docs/evidence/A-11.md` |
| D-6 | "Retrieve one published artifact by CID from a public gateway…, then again from a second independent public gateway." | `/data/verify/bafkreig76n7d6oiaxwmzu2mpoww4lttnr2mkawmgkqqnekxl7x7cf4hsha` (the Run 4 manifest) | Pinata and orbitor (gateways this project does not operate) both answer and the browser's SHA-256 matches the manifest; say ipfs.io and dweb.link stopped serving HTTP on 2026-09-21 | `docs/evidence/A-16.md` § AM-10, `docs/evidence/A-16-am10/` |
| D-7 | "Show that a later incremental publish produced a new CID without mutating the previous one." | `/runs/compare?a=4&b=5` (Run 3.1 vs Run 4) | Two distinct manifest CIDs, Run 4 links Run 3.1 as previous, the old manifest still resolves on Pinata and orbitor, all 285 files kept their CIDs (the 44 changed Austin rows produced no change in published roofing permits), the CAR link; then pick Run 2 vs Run 3 (`?a=2&b=3`) for a run whose data changed (+660 added, ~9,922 changed Austin permits) | `docs/evidence/A-11.md` |
| D-8 | "Using the UI, show properties within a sample radius that have roofs older than 15 years." | `/tx/travis/explore?place=Austin&r=5&roof=15` | 75,433 properties within 5 mi of Austin: address and lat/lon, roof age with its basis (year built or reroof permit) and confidence, source per row; open one row for the property drawer and its evidence chain | `docs/evidence/A-13-roof-age.md` |
| D-9 | "Show properties in that area with open roofing permits…, including contractor and BBB rating where available." | `/tx/travis/explore?place=Austin&r=5&permit=open_stalled&openYrs=5&sort=open_desc` | Long-open roofing permits first (2001-000552 BP, ~25.5 yrs; an old permit whose property has a later finished roofing permit no longer counts, see below), status and years open, the contractor as printed (e.g. Steve Moore) or "No contractor printed on this permit", BBB status with the BBB search link; the note that every match is stalled (open past expiry, never closed) | `docs/evidence/A-13-open-permits.md` |
| D-10 | Agent: "Which properties in Travis County within five miles of Austin have roofs older than 15 years?" | `/tx/travis/explore?mode=ai`, first suggestion | About 75,430 matches, the nearest 10 with addresses and [n] sources, the filters it applied, what is unknown (3,923 roof ages); the full results list under the answer follows the answer's filters | `docs/evidence/A-14-agent.md` |
| D-11 | Agent: "Which properties near that area have open roofing permits that have been open for many years, and who is the listed contractor?" | same tab, second suggestion (or type it after D-10) | 286 permits open ≥ 5 years within 5 mi (all stalled: open past expiry), longest first, contractor per permit, BBB not available with the reason, the assumptions (5 mi, ≥ 5 years); the list below switches to the same search (225 properties) | `docs/evidence/A-14-agent.md` |
| D-12 | "Finally, I will show that the system is MCP-ready." | `/help/mcp` | Endpoint and bearer-token access, the six read-only tools over the same views as the UI, the client set-up, then "Try a tool" with `search_properties` (Austin, 5 mi, roof ≥ 15) | `docs/evidence/A-14-mcp.md` |

The video runs about 8–10 minutes. Keep this order. Close by saying the candidate ran the pipeline as Oracle (six published runs, CIDs, gateways) and built the platform (the hosted app, the agent and the MCP server).

## 2. README demo transcript (verbatim)

- Presenter: “I will demonstrate that the Oracle pipeline has loaded the available dataset for Travis County, Texas, that the data is queryable through DuckDB, that eligible artifacts are stored on IPFS as content-addressed snapshots, and that both the UI and agent can answer property intelligence questions that support roofing lead generation.”
- Presenter: “First, I am opening the pipeline run summary.”
  - Expected Result: The system displays the completed pipeline run, source list, county coverage, record counts, timestamps, and any documented source limitations.
- Presenter: “Show the total uploaded records by source.”
  - Expected Result: The system shows uploaded property, permit, ownership, contractor (with BBB rating where available), business, and coordinate records with collection timestamps and provenance.
- Presenter: “Now I am opening the DuckDB-backed query layer.”
  - Expected Result: The system confirms that the loaded data is available for structured querying without requiring Oracle-hosted database infrastructure.
- Presenter: “Show the published artifact manifest for this run.”
  - Expected Result: A JSON (or equivalent) listing every eligible artifact with CID, size, logical name, codec, and digest. Gateway URLs, if shown, are derived from those CIDs. An IPNS name, if used, is shown together with the resolved CID.
- Presenter: “Retrieve one published artifact by CID from a public gateway that this environment does not operate, then again from a second independent public gateway.”
  - Expected Result: Both fetches succeed and the bytes match the manifest size/digest. Serving the object only from a private, local, or authenticated gateway is a fail.
- Presenter: “Show that a later incremental publish produced a new CID without mutating the previous one.”
  - Expected Result: The prior CID still resolves; the new run has a distinct CID; IPNS (if used) now points at the new CID; both CIDs appear in run history. A CAR is available for any directory root.
- Presenter: “Using the UI, show properties within a sample radius that have roofs older than 15 years.”
  - Expected Result: Matching properties are returned with roof-age basis, coordinates, and source provenance.
- Presenter: “Show properties in that area with open roofing permits, prioritizing permits that have remained open for many years, including contractor and BBB rating where available.”
  - Expected Result: Results include permit status/open duration, contractor identity, BBB score when present, and clear source backing.
- Presenter: “Now I am asking the same type of questions through the agent.”
  - Agent Prompt: “Which properties in Travis County within five miles of [city xyz] have roofs older than 15 years?”
    - Expected Result: The agent returns matching properties, explains the reasoning, and includes source-backed evidence.
  - Agent Prompt: “Which properties near that area have open roofing permits that have been open for many years, and who is the listed contractor?”
    - Expected Result: The agent returns a filtered list with permit age/open duration, contractor details, BBB rating when available, and clearly identifies any assumptions or missing data.
- Presenter: “Finally, I will show that the system is MCP-ready.”
  - Expected Result: The system demonstrates an MCP-ready interface or documented MCP-compatible query structure that agents and the roofing CRM can use without changing the data model.

