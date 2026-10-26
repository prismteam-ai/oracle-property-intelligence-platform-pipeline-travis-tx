# Data model: A-13 (read-only views of published files)

No new stored data. Every entity is read from a published file and validated with Zod at the boundary.

| Entity | Source | Fields used | Rules |
| --- | --- | --- | --- |
| RunIndexEntry | `runs/index.json` (`RunsIndexV1`) | `runId`, `manifestCid`, `finishedAt` | ordered by `finishedAt`; run number {n} = 1-based position |
| RunManifest | manifest by CID (`RunManifestV1`, strict) | `runId`, `startedAt`, `finishedAt`, `sources[]` (`name`, `url`, `captured_at`, `watermark`, `records`, `added`, `changed`, `removed`, `limitations[]`), `coverage{key: {count, derivation, note?}}`, `artifacts[]` (`cid`, `name`, `codec`, `size`, `sha256`, `carCid?`), `limitations[]`, `previousManifestCid` | unknown coverage keys tolerated; a missing denominator key → missing reason |
| RunChainLink | derived: manifest → `previousManifestCid` | `runId`, `manifestCid`, `previousManifestCid`, `resolves{pinata, filebase}` | "old manifest still resolves" only after both gateways answered |
| CoverageRow | derived from `coverage` + `sources[]` | kind, count, `derivation`, note, denominator (`source_total:*` if present), collected time, source table | count only from the coverage section (AD-04) |
| VerifyLane | live GET | gateway, URL, state (`idle`→`fetching`→`retrying(n)`→`verified`/`mismatch`/`failed`/`via_car`), size, digest | ✓ only when size and digest equal the manifest |
| Place | `travis-places@1.0.0` gazetteer | name, class, source label, lat, lon, GEOID | resolved in the browser |
| ExploreQuery | URL state | `place` / `at`, `r`, `roof`, `permit`, `openYrs`, `tenure`, `ooa`, `sort`, `sel`, `mode`, `view=list` | Zod-bounded; `view=map` → list |
| ExploreResult | `explore.search` | `total_within_r`, `tenure_unknown`, `rows[]` (property_cid, address, dist_mi, bearing, lat, lon, roof_age_years, roof_age_basis, roof_age_confidence, permit {number, status_raw, status_class, open_years, open_days}, contractor {name_as_printed, resolution}, bbb_status, tenure_years, tenure_basis, owner_area_class, provenance, missing[]), `close_matches[]` (row, miles_outside), `as_of` | every row carries provenance; every gap a `missing[{field, reason}]` |
| RunEvent | derived from manifests | time, runId, kind (`started`/`captured`/`finished`/`event`), source?, limitations? | sorted ascending by time across all runs |
| CatalogTable | manifest `artifacts[]` (table directories and parts) + Parquet footers | table name, columns (name, type), rows in the published file, `published_rows`, CID, size | from published files only; unreachable → "Catalog unavailable · {reason}" |
| SiteLinks | `public/site-links.json` | `crmUrl?`, `demoVideoUrl?`, `prUrl?` | https only; empty/invalid = hidden |
| ComingSoonItem | `content/coming-soon.ts` (static) | id, title, one sentence, skeleton layout | no numbers, rows or CIDs |
| LegalSource | `content/legal.ts` (static, from `docs/sources.md`) | name, URL, terms or licence link, access status | no legal advice |
