---
id: A-05
type: user-story
title: Attach coordinates to every property and reconcile GIS with the roll
parent: FEAT-A05
vision: VIS-A
ard: ARD-A
eval_point: A1
priority: P1
moscow: Must
branch: 005-coordinates
spec: specs/005-coordinates/
depends_on: [A-04]
size_days: 0.5
agents:
  design: [oracle]
  builder: oracle
  reviewers: [oracle, donphan]
  verify: "coverage SQL ≥ 99%"
skills: [use-oracle, query-db-loading-matching, apply-engineering-guidelines]
ui: false
status: Merged
merged_into: A-04
merged_on: 2026-10-21
gate: G4
qc_testability_signoff: false
created: 2026-10-19
---

# A-05 Attach coordinates to every property and reconcile GIS with the roll

> Merged into **A-04** on 2026-10-21 ([../A-04-property-backbone.md](../A-04-property-backbone.md)). Kept for history; the ACs live there now.

| Field | Value |
| --- | --- |
| Evaluation point | A1 (primary) · A5 |
| Demo line(s) | D-3 (coordinate records), D-8 (radius results with coordinates) |
| Agents | design `oracle` · builder `oracle` · reviewers `oracle`, `donphan` · verify coverage SQL ≥ 99% (source: [AGENT-MAP.md](../../assessment-guide/AGENT-MAP.md) § 4) |
| Depends on | A-04 |
| Size | 0.5 days |
| Branch | `005-coordinates`, merged into `feature/oracle-pipeline` |

## Context

Radius search ("within five miles of Pflugerville") is the CRM's core interaction (AC-10, AC-35), so a property without coordinates is invisible to every lead query. The **CRM developer** needs a coordinate on nearly every property, plus an honest reason for the rest.

Facts: the Travis County GIS layer `TCAD.TC_USER.TCAD_PARCELS` returns at most **2,000 features per request**, is refreshed by TCAD every one to two months, has some parcels with null attributes, and **timed out** from the operator machine on 2026-10-17 and 2026-10-19. The Austin permit dataset carries `latitude` / `longitude` and `tcad_id` on most rows (63,019 of 2,380,507 rows lack `tcad_id`, 2026-10-17).

## Description

As a **Roofing CRM developer**, I want **a coordinate on at least 99% of roll properties, each labelled with where it came from, and every missing one classified**, so that **radius searches return every eligible property and say why any are left out**.

When done: parcel centroids from `TCAD_PARCELS` through the kit runtime's `arcgis-feature-service` adapter (2,000 per page, concurrency ≤ 2), joined on the TCAD id; the fallback is the Austin permit latitude/longitude through `tcad_id`. `coordinate_source` is recorded per property. GIS is compared with the roll; it is never used as the population.

**Independent test:** the coverage SQL `SELECT avg((lat IS NOT NULL)::int) FROM v_property` over the Query DB pilot tables returns ≥ 0.99, and the gap report lists every property without coordinates by reason.

## Acceptance Criteria

1. **AC-1** · **Given** TCAD id `0208011301`, **When** coordinates are attached, **Then** the property has `lat`, `lon` and `coordinate_source = gis_parcel_centroid` with the GIS layer URL, capture time and digest as provenance. ☐ testable
2. **AC-2** (scale) · **Given** the full roll from A-04 (N accounts), **When** the GIS layer is paged at 2,000 features per request, **Then** at least 99% of the N properties have coordinates, the GIS feature count and its difference from N are recorded, and the page count, duration and throughput are recorded for `docs/source-limits.md`. ☐ testable
3. **AC-3** · **Given** a property with no GIS feature but an Austin permit carrying its `tcad_id` and a latitude/longitude, **When** the fallback runs, **Then** the property gets that point with `coordinate_source = permit_point` and the permit's source URL. ☐ testable
4. **AC-4** (missing data) · **Given** a property with neither a GIS feature nor a permit point, **When** coverage is reported, **Then** it keeps `lat`/`lon` null with a reason (`no_gis_feature`, `gis_null_geometry`, `no_permit_point`) and is counted in the gap; no coordinate is geocoded from an address or invented. ☐ testable
5. **AC-5** (error) · **Given** the GIS service times out (as on 2026-10-17 and 2026-10-19), **When** the adapter pages, **Then** it retries with backoff (1 s base, 60 s cap, 5 attempts), resumes from the last completed page after a restart, and if it still fails records `blocked` with the timestamp instead of publishing partial coverage as complete. ☐ testable

## Edge cases (at least two)

- A parcel polygon whose centroid falls outside the polygon (L-shaped lots) → use the adapter's interior point if available; record which.
- One TCAD id with several GIS features (split parcels) → one coordinate by a recorded rule; others counted.
- A permit point far from the GIS centroid of the same parcel (> 0.5 mi) → keep GIS, flag the permit for review.

## Requirements

| REQ | Requirement | Traces to |
| --- | --- | --- |
| FR-001 | System MUST attach GIS centroids by TCAD id with provenance | AC-1, AC-2 |
| FR-002 | System MUST fall back to permit points through `tcad_id` and label the source | AC-3 |
| FR-003 | System MUST classify every property without coordinates | AC-4 |
| FR-004 | System MUST page GIS politely and resume after failure | AC-5 |
| NFR-001 | Coordinate coverage ≥ 99% of the roll | AC-2 |
| NFR-002 | GIS concurrency ≤ 2, backoff on failure (NFR-07) | AC-5 |

## Prototype reference

Not a UI story. Coordinates show as "Lat, lon" and "Mi + bearing" columns on `design/prototype/ExploreQ-roof15.dc.html` (through A-13).

## Demo Script

1. Presenter: "Using the UI, show properties within a sample radius that have roofs older than 15 years." → Expected: each result carries coordinates and their source.

## Out of scope

- Address geocoding services (no invented coordinates).
- The map view (not Task A scope, `docs/02-design.md` § 3).

## Evidence to capture

- `docs/evidence/A-05.md`: coverage SQL output, GIS count vs roll count, gap by reason, paging throughput.
- `testplans/A-05-test-cases.md` results, `docs/reviews/CR-A-05.md`.

---

## Gate G4: Story ready for planning

| # | Criterion | Status |
| --- | --- | --- |
| G4-1 | Front matter complete (parent FEAT, eval point, branch, priority, **agents and skills from AGENT-MAP.md**) | ☐ |
| G4-2 | "As a / I want / So that" stated, with an independent test | ☐ |
| G4-3 | Every AC is Given / When / Then, and its testable box is ticked | ☐ |
| G4-4 | One scale AC and one missing-data or error AC | ☐ |
| G4-5 | At least two edge cases | ☐ |
| G4-6 | Every requirement traces to an AC; NFRs have thresholds | ☐ |
| G4-7 | Prototype screen linked (UI stories) | ☐ |
| G4-8 | Dependencies done, or stubbed with **real** sample data | ☐ |
| G4-9 | No `[NEEDS CLARIFICATION]` left | ☐ |
| G4-10 | AI pre-check (`developmentsupport-g4-precheck`): PASS | ☐ |

**Decision:** ☐ Ready ☐ Returned, reason: {…} · {date}
