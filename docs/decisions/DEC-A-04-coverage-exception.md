---
id: DEC-A-04-coverage-exception
type: decision
story: A-04
title: "Measure the 99% coordinate coverage on ordinary land parcels and report condo-coded accounts separately (PO exception to AC-8 / NFR-003)"
status: Approved by the PO (HebaGaber) on 2026-10-22 (Round 1 stop D-17, answer "Record as PO exception")
created: 2026-10-22
---

# Coordinate coverage exception (A-04)

## Decision

AC-8 and NFR-003 asked for coordinates on at least 99% of the 441,961 real-estate (R) accounts (D-1, 2026-10-21). The full assembly was measured on 2026-10-22. The PO approved this exception: the **99% is measured on the 371,352 R accounts that are not condo-coded** (state code not A4, F4 or O1), where it is met; the **70,609 condo-coded accounts are reported separately** with their counts and reason. Nothing is geocoded, nothing is guessed (P0 rules): a condo unit gets a point only when an allowed source carries one.

## Measurements (Query DB `parcels`, coordinates job `travis-a04-coords-20261022062359`, code `9d0fff3`, GIS capture run 39684063596 (373,683 features, 187 pages, US runner), TCAD roll run `travis-a04-20261022052658`)

| Group | Accounts | Public point (`gis_centroid`) | Point incl. permit-derived (Query DB only) | No point |
| --- | --- | --- | --- | --- |
| Ordinary land parcels (R, not A4/F4/O1) | 371,352 | **369,990 = 99.63%** | 370,027 = 99.64% | 1,325 (`no_gis_feature` 1,296 · `no_permit_point` 29) |
| Condo-coded (A4, F4, O1) | 70,609 | 20,071 = 28.43% | 24,566 = 34.79% | 46,043 |
| **All R accounts** | **441,961** | **390,061 = 88.26%** | 394,593 = 89.28% | 47,368 |
| Non-land (P 39,536 · MH 11,744 · MN 5) | 51,285 | counted separately, `out_of_scope` | | |

Sources of the R points: GIS polygon centroid or interior point 365,489 (centroid 363,675 · interior point 1,814), split parcel largest area 917, TCAD export point 14,055, condo building point 9,600 (a unit sharing a `geoID` with a pointed account), permit point 4,532.
GIS join proof: 373,683 features; 367,491 matched by exact `PROP_ID` = `pID` (98.3%); 4,192 features carry a `PROP_ID` that is on no R account of the roll; 2,000 features carry no `PROP_ID` and found no unique `geoID` match.

## Why the condo-coded accounts cannot reach 99%

The county GIS layer draws one polygon per building; a condo unit has none. The TCAD export prints the placeholder point `[null, null]` for these units (112,784 records in total). A second factual rule was measured and found insufficient: the same base street address as an account that has a point rescues only 511 more accounts uniquely (803 addresses have several different points; 46,050 gap accounts have no pointed account at the same address; 42,965 of the gap carry a unit designator). The rest would need geocoding or guessing, which the data rules forbid.

## What stays true

- Every account without a point keeps `latitude`/`longitude` null with a reason (`no_gis_feature`, `no_permit_point` internally; publicly `coordinate_source = none`, reason `no_coordinates`).
- The public `v_property` shows `gis_centroid` or `none` only; permit points stay in the Query DB (frozen v1 cannot label them).
- The coverage SQL is run both ways (Query DB and the local `export-tables` run, never uploaded) and reported in `docs/evidence/A-04.md` and the run report with this split.
- Revisit if the county publishes unit-level points or a condo master-account key becomes available (then add a rule version, with a PO decision).

## Postscript, 2026-10-25 (A-11 Run 3, ADR 0004)

The last bullet above ("revisit if the county publishes unit-level points") is answered by a different public source: the PO approved one narrow exception to the A-04 rule that no address is turned into a point. An exact, unique match of the situs to the City of Austin address-point layer now gives a point (rule `address_point`, lowest priority, never over a GIS point). Measured read-only over the 51,900 accounts without a public point: 43,955 matched; coverage of all 441,961 R accounts rises from 88.26% to 98.20% (434,016); 7,945 remain (6,700 no point in the layer, 1,245 no house number). The permit-point exception in the second bullet above is now mostly moot (4,522 of the 4,532 permit-point accounts take an address point). The coverage figures above are the Run 2 state; the Run 3 figures are in `docs/decisions/0004-address-point-exception.md` and `specs/011-publish-and-runs/run3-address-point-evidence.md`. The public `v_property` now shows `gis_centroid`, `address_point` or `none`.
