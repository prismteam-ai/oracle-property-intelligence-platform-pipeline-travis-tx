---
id: ERR-65
type: defect
feature: FEAT-A11
story: A-11
test_case: Task B validation of published Run 2 (coordinates); unit pins in oracle-runtime test/travis/a11/address-point-rank.test.ts, address-points.test.ts, address-normalise.test.ts, address-point-loader.test.ts; local-stack test/tracks/address-points.test.ts; query-core test/views.fixture.test.ts and derive.test.ts
ac_reference: A-11
severity: High
status: Closed 2026-10-25: re-tested on Run 3 (manifest bafkreifndsdibdllvgpzwmif6getzwvc6rupk5tgeak4eypccaw3t7vlfm): coordinates for 434,016 of 441,961 (98.2%; 43,955 from address points; Run 2: 390,061); specs/011-publish-and-runs/run3/run3-evidence.json
found_by: Task B validation of published Run 2, for HebaGaber
found_date: 2026-10-25
fix_branch: 011b-run3-corrections
fix_commit: pending (the lead commits after the merge)
retest_date: pending
closed_date: pending
---

# ERR-65: 51,900 properties (11.7%) have no latitude or longitude, mostly condo units

## Brief description

In the published Run 2, 51,900 of 441,961 properties have no coordinates (88.26% coverage). 85.5% of the accounts without a point are state code A4 condominium or townhome units. A map or radius search misses them.

## Related requirement

- **Story:** A-11 · **Rule:** A-04 AC-8 / NFR-003 (coordinate coverage; PO exception `DEC-A-04-coverage-exception`) · **Decision:** `docs/decisions/0004-address-point-exception.md`

## Impact and severity

- **Severity:** High. Coordinates are a headline column of the Properties view and the only input of the map and radius searches.

## Resolution

| Field | Value |
| --- | --- |
| Root cause | Not a join or assembly bug. The county GIS layer draws one polygon per building and the TCAD export prints `[null, null]` for a unit, so a condo unit has no point of its own (46,945 `no_gis_feature`, 423 `no_permit_point`). The existing `condo_building_point` rule only fires when several accounts share a geoID; here each unit has its own geoID. 4,532 more accounts have only a permit point, which `write-group.ts` correctly never writes as geometry. The A-04 design rule "no address is ever turned into a point" ruled out the one dataset that has a building point per address. |
| PO decision | 2026-10-25, YES: one narrow exception, an exact and unique match of the situs to the City of Austin public address-point layer (ADR 0004). |
| Fix | New lowest-priority public rank `address_point` in `assemble-coordinates.ts`: used only when ranks 1 to 3 gave no point; unique match on the normalised house number and street (`address-normalise.ts`: case, suffix abbreviations, directionals, unit designators cut off, ZIP reduced and not part of the key); the point must lie inside the Travis County box; ambiguous matches stay unmatched with `address_point_ambiguous`, out-of-county with `address_point_outside_county`. A polite resumable loader caches the layer with a receipt (`address-point-loader.ts`, `npm run fetch-address-layer`); the Loader `gis` track gains the `address_points` kind and `0202_address_points.sql` (table, layer receipt, widened coordinate CHECKs). `geometryFor` publishes the point with the layer record as `geometry.source_http_request`; `contract/v1` `coordinate_source` gains `address_point`; the view derives it from that URL; the UI label is "address point (City of Austin)". |
| Measured | Read-only over all 51,900 accounts: 43,955 unique matches, 0 ambiguous, 0 outside the county, 6,700 no point in the layer, 1,245 no house number. Coverage 88.26% to 98.20% (434,016 of 441,961). Against the GIS centroid on 341,068 accounts that have both: median 5.8 m, p90 19.6 m, p99 161 m. See `specs/011-publish-and-runs/run3-address-point-evidence.md`. |
| How it escaped | The A-04 coverage exception accepted the condo gap as a data limit and the A-04 rule forbade any address-to-point step, so no one evaluated an official address-point dataset until Task B measured the 11.7%. |
| Tests that pin it | See `test_case` above: normalisation (case, suffix, directional, unit, ZIP, fraction), matching (unique, ambiguous, no match, outside county, non-Address records, no nearest), ranking (never over a centroid, an export point or a condo building point; beats a permit point; ambiguous keeps the permit fallback; non-land accounts never), `geometryFor` (provenance URL required, gis_centroid keeps the TCAD request, permit point and none write nothing), the loader (identified User-Agent, GET only, 1 request/s, backoff on 503, stop on 403, resume, restart on a layer edit, sha256 check), the migration text, the Loader kind, and the view label. |
| Re-test | Pending: needs the loader run into the Query DB (`gis` track kind `address_points`), a coordinate re-assembly, a full County re-write, new CARs and a Run 3 manifest (PO approval for the publish). |
| Status | Closed in Run 3: coordinates for 434,016 of 441,961 (98.2%). |
