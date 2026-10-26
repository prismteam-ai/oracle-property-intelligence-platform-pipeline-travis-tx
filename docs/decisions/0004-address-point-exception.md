---
id: ADR-0004
type: decision
parent: ARD-A
story: A-11
title: "One narrow exception to 'no address is ever turned into a point': an exact, unique match to the City of Austin address-point layer"
status: Approved by the PO (HebaGaber) on 2026-10-25 (Run 3 gap 4, answer YES)
date: 2026-10-25
supersedes: the A-04 design rule "No address is ever turned into a point" (specs/004-property-backbone/agent-design.md, assemble-coordinates.ts header), for this one case only
---

# Address points for condo units without a polygon (A-11 Run 3, gap 4)

## Context

In the published Run 2, 51,900 of 441,961 real-estate accounts (11.7%) have no latitude or longitude: 46,945 `no_gis_feature`, 423 `no_permit_point`, and 4,532 that have only a permit point (a permit point is correctly never written as geometry). 85.5% are state code A4 condo or townhome units: the county GIS layer draws one polygon per building and the TCAD export prints `[null, null]` for the unit (ERR-65, `specs/011-publish-and-runs/run3-gaps-investigation.md` gap 4). The A-04 rule said no address is ever turned into a point (never geocode).

The City of Austin publishes a public ArcGIS layer of address points (`LOCATION_address_points`, FeatureServer 0, 466,149 records, edited 2026-10-24). Joining a situs to it is a string equality on a house number and a street, not a geocoder: there is no nearest search, no scoring and no free-text service.

## Decision

The PO approved reversing the rule for **one narrow case**. A parcel gets a point from the address layer only when all of these hold:

1. Ranks 1 to 3 gave no point (no GIS feature point, no real export point, no condo building point). **A GIS centroid is never overridden.** The rank is below `condo_building_point` and above the internal-only `permit_point`.
2. The normalised situs equals the normalised address of **exactly one distinct point** (7-decimal key) in the layer. Two or more distinct points: stays unmatched, reason `address_point_ambiguous`.
3. The matched point lies inside the Travis County bounding box (lat 30.02 to 30.63, lon -98.18 to -97.36). Otherwise stays unmatched, reason `address_point_outside_county`.
4. No match, or a situs with no house number or no street name: stays unmatched with the existing reason (`no_gis_feature` or `no_permit_point`).

Nothing else changes: no free-text geocoder (Census or other) is used, no nearest or fuzzy match, and a permit point is still never published as geometry.

### Normalisation (`pipeline/oracle-runtime/travis/gis/address-normalise.ts`, applied identically to both sides)

| Step | Rule |
| --- | --- |
| Case and punctuation | upper-case; remove `. , ' " backtick`; other symbols to a space; collapse spaces |
| House number | digits, leading zeros dropped; a fraction (`1/2`) or letter suffix is the number's qualifier and is part of the key (`9605 1/2` and `9605` are two addresses); a situs without a number gives no key |
| Unit designators | a trailing `APT, APARTMENT, UNIT, STE, SUITE, BLDG, BUILDING, FL, FLOOR, RM, ROOM, LOT, SPC, SPACE, TRLR, TRAILER, #` group is cut off; the structured `street_secondary` is never part of the key (the layer holds building points). The unit is reported back as `unit_ignored` for the evidence |
| Suffix abbreviations | the street type goes to the USPS Publication 28 primary abbreviation (`STREET`, `STR` to `ST`; `DRIVE` to `DR`; `BOULEVARD` to `BLVD`; `CI`, `RG`, `TR`, `HY` seen on TCAD situs to `CIR`, `RDG`, `TRL`, `HWY`); applied to the last street token, or the one before a trailing directional, never to a word in the middle of a name (`ST JOHNS AVE` keeps its `ST`) |
| Directionals | `NORTH`/`N` to `N` and so on (also `NE NW SE SW`), as the first token of a multi-token street, or after the street type |
| ZIP | reduced to its first five digits and reported; **not part of the key**, because the layer carries no ZIP. Two points on the same number and street (for example in two cities) are therefore ambiguous and stay unmatched |
| Layer records | only `ADDRESS_TYPE = 1` (Address) are indexed; hydrants, towers, meters and dormant records never match |

## Provenance and public label

- Each matched point is written to the County group with `geometry.source_http_request` = a GET on the layer record (`.../FeatureServer/0/query?objectIds=<OBJECTID>&outFields=*&outSR=4326&f=json`), not the TCAD export request. In the Query DB the row also carries the retrieval time and the sha256 of the cached layer file.
- `coordinate_source` in `contract/v1` gains the value `address_point` (additive; `gis_centroid`, `permit_point` and `none` keep their meaning). The view derives it from the geometry's source URL (`packages/query-core/views.sql`, macro `coordinate_source`). UI wording: **address point (City of Austin)** (`packages/shared` `COORDINATE_SOURCE_LABELS`) with the provenance line `ADDRESS_POINT_PROVENANCE_TEXT`.
- The loader (`npm run fetch-address-layer` in `pipeline/oracle-runtime`) makes public GET requests only, with the project User-Agent, at most 1 request per second to `services.arcgis.com`, backoff on 429/5xx (full jitter, 1 s base, 60 s cap, 5 attempts), a stop on 403 or a challenge, 2,000 records per page, resumable pages, and a cache under the gitignored `pipeline/data/raw/austin-address-points` with `receipt.json` (layer URL, retrieved-at, record count, source count, sha256 of the cached file, layer edit date, per-request receipts). A cache written for another edit of the layer is discarded.

## Evidence (2026-10-25, read-only over all 51,900 accounts; layer retrieved 2026-10-25T00:49:51Z, sha256 `4683eec602e1788ab3f2ce501fa9adf176ebdf6970d9b69a10602a20ea28b03c`)

| Measure | Value |
| --- | --- |
| Accounts with a public point before | 390,061 of 441,961 (88.26%) |
| Accounts reaching the rule | 51,900 (47,368 `none`, 4,532 `permit_point`) |
| Unique matches | 43,955 (84.7% of 51,900) |
| Ambiguous / outside county | 0 / 0 |
| No match / no address (no house number or street) | 6,700 / 1,245 |
| Coverage after | 434,016 of 441,961 (98.20%); remainder 7,945 (1.80%) |
| Distance, address point versus GIS centroid, 341,068 accounts that have both | median 5.8 m, p75 9.9 m, p90 19.6 m, p99 161 m; 1,552 over 250 m, 64 over 1 km (large rural parcels where the centroid is far from the house) |
| Same, condo accounts (A4 with a unit) that have both (7,430) | median 38 m, p75 70 m, p90 161 m, p99 293 m |

The investigation's sample projected 96.9%; the full run is higher because the normalisation maps suffix spellings (`DRIVE` to `DR`) that an exact string match on `FULL_STREET_NAME` missed. Full report and 30 random matches: `specs/011-publish-and-runs/run3-address-point-evidence.md`.

## Consequences

- Public County geometry for about 43,955 more properties; the County CIDs change (Run 3).
- One more upstream dependency (the City of Austin layer); its absence only skips rank 4 and changes nothing else.
- Risk: a wrong match is possible where the layer lacks the true address and holds the same number and street in another city (the layer carries no ZIP). It is bounded by the uniqueness rule and the county box, and measured: 64 of 341,068 accounts with a centroid disagree by more than 1 km and the ones inspected are large rural parcels, not mismatches. Revisit if a ZIP or city field appears in the layer.
- A permit point stays internal. Most of the 4,532 permit-point accounts (4,522) now take an address point instead.

## Alternatives rejected

- Keep the rule: leaves 11.7% of properties off the map, mostly condos.
- A free-text geocoder (Census or others): accuracy unknown, and it is the thing the original rule forbids.
- Publishing permit points as `gis_centroid`: mislabels the source.
