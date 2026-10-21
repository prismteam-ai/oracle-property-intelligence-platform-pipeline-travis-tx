# Intent — Travis County pipeline

**The Roofing CRM, its agent or a reviewer can ask which Travis County properties near a point have old roofs or
long-open roofing permits, and get answers from all of the county's available public property and permit records.
Each answer traces back to its source and to a public IPFS CID. The data keeps refreshing run after run, stays
retrievable after our servers are gone, and Oracle carries no standing infrastructure cost for it.**

`README.md` is the assignment and the specification. `docs/decisions.md` records how it is met, `docs/progress.md` how
each increment was verified, and `docs/runbook.md` how to run it again from a clean clone.

## The outcome, in the README's terms

- **Load** (Data loading). The TCAD 2026 Certified Appraisal Export (441,961 accounts) gives 441,939 properties with their
  owners. Austin's issued construction permits (Socrata `3syk-w9eu`, 2,380,939 rows) give 1,986,694 permits linked to
  those properties, with status, dates and how long each has been open. The Travis TNR parcel layer gives coordinates.
  Contractors come from the names printed on permits, cross-matched to Comptroller and Secretary of State business
  records and TDLR, TSBPE and Austin license files. Roof age is the last roofing permit, else the year built, and each
  property shows which one was used. Every record carries its source URL, capture time and run. BBB blocks scripted
  access, so ratings ship as `blocked` with the evidence. Sources that need a records request are classified in
  `travis-sources.yaml`, not skipped silently.
- **Publish** (IPFS publication). Records are lexicon-valid and built with the kit's `elephant-county` CLI. Each shard is
  a CAR whose root is a CIDv1 directory. Each run has a manifest listing every object with its `cid`, name, size,
  codec and SHA-256. Filebase and Pinata pin every object, and every one was fetched from `ipfs.filebase.io` and
  `gateway.pinata.cloud` and matched byte for byte. The CARs are GitHub Release assets, so anyone can re-pin them.
- **Continue** (continuous and incremental). Run 2 is the next run after run 1. It re-reads the sources, keeps every
  unchanged shard and its CID, rebuilds the shards that changed, and gets its own manifest CID. Run 1's CIDs still
  resolve. Run history lists both runs with their deltas, their previous run and their roots.
- **Serve** (Infrastructure and access; Roofing CRM queries). A DuckDB query layer is built from the published tables.
  It answers the README's five lead questions: radius, roof age, open and long-open roofing permits with contractor
  and BBB, owner tenure, and out-of-area owners. Clients reach it as REST and MCP on Lambda, as an explorer that runs
  DuckDB-WASM in the browser, and as a Bedrock agent whose tools are the same queries.
- **Cost** (no ongoing Oracle infrastructure cost). Ingestion runs on demand from the kit CLI and costs nothing when
  idle. AWS scales to zero, and the search API and the agent each stop themselves at a daily cap. The only standing
  costs are the two pinning plans and about $2 a month of storage.

As both Oracle and builder: we ran the ingestion, published and pinned the data and pay for the pinning. We also built
the Travis adapter in the kit (mirrored under `oracle/travis/`) and the hosted layer in this repository.

## Boundaries

```
TCAD export · Austin permits (Socrata) · TNR parcels · Comptroller / SOS · TDLR / TSBPE / Austin licenses
   │  kit CLI elephant-county, run on demand (laptop); one run = 89 shards
   ▼
lexicon records ─▶ CARs ─▶ Filebase + Pinata pins ─▶ any public IPFS gateway (checked: ipfs.filebase.io, gateway.pinata.cloud)
                     │      manifest per run (publish/, runs/); CARs on GitHub Releases
                     ▼
published Parquet tables ─▶ deploy-build (DuckDB) ─▶ serving set: 77 MB file in the image + 6 Parquet files in S3

browser ──▶ CloudFront: explorer (S3), DuckDB-WASM over the Parquet mirror
CRM, MCP clients, curl ──▶ API Gateway ─┬─▶ API Lambda: REST /v1/*, MCP /v1/mcp ─▶ DuckDB
                                        └─▶ chat Lambda: POST /v1/agent/chat ─▶ Bedrock, Claude Sonnet 4.6 (tools = the API's queries)
```

The CRM (prismteam-ai/roofing-crm #14) is a separate story. It reads this API and ingests nothing.

## One input and its output

The README's first UI question, around central Austin, as the CRM sends it:

```
GET {API_BASE}/v1/properties/search?lat=30.2672&lon=-97.7431&radius_miles=5&roof_age_min=15&open_permits=false
```

On run 2 it answers 53,305 matches. The first row is 802 BARTON BLVD (TCAD account 103857), 1.5 miles away. Its roof
year is 2008, taken from a permit (basis `new_construction`, confidence medium; TCAD's year built is 1910), so the roof
is 18 years old. The row cites the TCAD export URL, its capture time (2026-10-16), the run, and the CID of the
published record. Adding `open_permits=true` brings in the properties with an open roofing permit (54,170) and lists
the long-open ones first, each with its match reasons. `/v1/permits/search` gives each permit's status, open-since
date, days open, the contractor as printed, and BBB `blocked` with the 403 evidence.
