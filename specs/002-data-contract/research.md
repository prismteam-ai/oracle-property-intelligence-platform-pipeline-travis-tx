# Research: A-02 data contract

Phase 0 of `/speckit-plan`. Every item in the Technical Context is resolved, and no `NEEDS CLARIFICATION` remains. The evidence comes from [agent-design.md](agent-design.md) (mew, oracle; live checks 2026-10-20).

## R-01 Lexicon source when the MCP tools fail

- **Decision:** use the live lexicon manifest (`https://lexicon.elephant.xyz/api/manifest`, HTTP 200 on 2026-10-20) and the class schemas that the CLI fetches into `~/.elephant-cli/schema-cache/` during the pilot's first `validate`. Cross-check them with the bundled `use-neutral-lexicon` reference. A verdict is final only when (a) the property is in the cached live schema and (b) it appears with a non-null value in a pilot Parquet row.
- **Rationale:** the MCP tools (`listClassesByDataGroup`, `listPropertiesByClassName`, `getPropertySchema`, kit and legacy) returned "Internal error" for both agents. The story's edge case allows "the schema bundled with the installed CLI plus a real pilot export", and the CLI fetches exactly the live schemas.
- **Alternatives:** wait for the MCP (rejected: blocks the story); names from memory (forbidden).

## R-02 Where classification runs

- **Decision:** at transform time, in `profiles/travis-austin@1.0.0`. The result is published as lexicon enums (`improvement_type`, `improvement_action`, `improvement_status`). Views compare enums by equality, and `status_class` comes from a generated `VALUES` table.
- **Rationale:** the live `property_improvement` class has no `description` or `work_class` (`additionalProperties: false`), so query-time text classification is impossible under A2/AD-25. Side files are forbidden (AD-25).
- **Alternatives:** query-time `LIKE` (forbidden, P0-9); `fact_sheet`/`file` side objects (break AD-25).

## R-03 Encoding Expired (PO D-4a)

- **Decision:** Expired and Expired - License → `improvement_status = null`. `status_class = 'stalled'` when the status is null and `permit_issue_date` is present. Excluded and needs_review permits are never emitted, and the transform asserts it. Mew's guard is added: the rule is in the generated status map and the README, and a test fails if any emitted permit's class is outside {open, stalled, closed}.
- **Rationale:** keeps AC-4/AC-8 and demo D-11; never relabels Expired (AD-08); the rule is explicit and digested (AD-26).
- **Alternatives:** null + reason only (mew; drops stalled leads); file the lexicon request now (blocks the story).

## R-04 Joining Austin permits to TCAD parcels

- **Decision:** Austin `tcad_id` (10-digit string) = TCAD `propertyIdentification[].geoID`, compared exactly as strings → `pID`. Exactly one residential `pID` means matched. Zero or more than one means unmatched, kept and counted with reason `no_tcad_geoid` / `ambiguous_geoid`.
- **Rationale:** oracle F6 (both are 10-digit strings in the same form); P0-5 key as printed.
- **Alternatives:** address matching (fuzzy, forbidden as identity); TCAD `permits[]` (kept for an A-07 cross-check).

## R-05 Reading the 29.9 GB TCAD entry

- **Decision:** stream the ZIP entry with the existing `travis/lib/zip-entry.ts`. Split records on depth-1 delimiters, prefilter on the raw text `"geoID": "<id>"`, and parse only the hits.
- **Rationale:** a full parse is not needed for ≤ 27 parcels; decompression is the bottleneck (minutes).

## R-06 Pilot manifest CID (PO D-2)

- **Decision:** serialize with RFC 8785 JCS (sorted keys, no whitespace, UTF-8). Hash with `ipfs-unixfs-importer` (cidVersion 1, rawLeaves true, 256 KiB chunker), giving `bafkrei…` below 256 KiB. Commit the exact bytes as `contract/v1/pilot-manifest.json`. Part CIDs are read from the `CountyTables` block in `tables.car` and re-derived from each file, failing on a mismatch.
- **Rationale:** it is the same CID a later `ipfs add --cid-version 1` would give; Task B can recompute it.

## R-07 Profile and gazetteer digests (AD-26)

- **Decision:** Zod-parse, recursively sort keys, `JSON.stringify(...) + "\n"`, then SHA-256 hex. This mirrors the kit's `permitProfileDigest`. `DIGEST` is committed, with a drift test, and `expectations.json` stays outside the digest. The gazetteer digest uses the JCS form of `{version, places, zctas, owner-area, sources}`.
- **Rationale:** reproducible from the public repo; re-measuring counts doesn't change the profile's identity.

## R-08 Gazetteer sources

- **Decision:**
  - Census 2024 Gazetteer `2024_Gaz_place_national.zip` and `2024_Gaz_zcta_national.zip`.
  - The ZCTA→county relationship file `rel2020/zcta520/tab20_zcta520_county20_natl.txt` (`AREALAND_PART > 0`).
  - `codes2020/place_by_cou/st48_tx_place_by_county2020.txt` for places (there is no rel2020 place file; it returns 404).
  - Raw files go to `pipeline/data/raw/census/` (gitignored); the filtered JSON is committed with URL, Last-Modified, bytes and SHA-256 per file.
- **Rationale:** public Census data only (FR-004); county membership by land area handles straddling places (`partial_in_travis`).
- **Note:** ZCTA ≠ USPS ZIP (PO-box ZIPs), so a ZIP that is not a ZCTA gives `owner_area_class = unknown`, reason `zip_not_zcta` (oracle R12; added to mew's reason enum by D-4c).

## R-09 AC-5 at full scale without ingesting

- **Decision:** generate the include predicate from the profile (`toSoqlInclude()`), count it, and count the whole dataset. Key-page only the include set (about 22k rows, ≤ 50,000 per page) with a receipt, and classify locally. Assert candidates = include − excluded − needs_review − trade permits, and that 0 candidates are Auxiliary Power. Write `expectations.json`. Count, fetch and re-count in one run, because the dataset changes daily (+214 rows/day).
- **Rationale:** token-aware excludes can't be expressed in SoQL; this is classification input, not ingestion.

## R-10 AC-3 sample

- **Decision:** the population is description or work class mentioning ROOF (65,437 on 2026-10-20). Rank by `sha256(seed + "\n" + permit_number)` and take the smallest 25. Seed `travis-austin@1.0.0/AC-3/2026-10-20`. The review sheet is `docs/evidence/A-02-classifier-review.md`, and the PO marks each one (D-7).
- **Rationale:** independent of page order and of PRNG state; reproducible.

## R-11 Workspace and test runner

- **Decision:** a root `pnpm-workspace.yaml` with `packages/*`, `profiles/*` and `pipeline/publish`; Vitest 5 + coverage-v8; TypeScript 6 / tsc 7 as in A-01. `elephant-cli` pinned as a devDependency `github:elephant-xyz/elephant-cli#44bb182b9f7f904662e9b33e1fde70bdeab62322`. `@duckdb/node-api` is a devDependency of `query-core` only, for tests. `pipeline/oracle-runtime` stays its own npm package.
- **Rationale:** the walkthrough's "smallest workspace"; the ARD bans engine packages from `query-core` runtime code.

## R-12 Risks carried into later stories (not A-02 scope)

- **ipfs.io and dweb.link now answer 429** ("service worker gateway only"; oracle F9/R8). This puts P0-14 Verify at risk from A-03 on, and needs a new ADR row in A-03.
- **build-county-transform step 8** (PR to the kit transform-scripts repo) is outside the fork: record it in `kit-usage.md`.
