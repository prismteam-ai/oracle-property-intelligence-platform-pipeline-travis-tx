# A-13 evidence: demo area for D-8 and D-9 (AC-5 demo-area note)

**Decision:** Austin city (PO D-11, round R4, 2026-10-22: "Austin city (Recommended)"). A-14 reuses it for its demo lines D-10 and D-11.

Machine-readable demo area (read by the hosted tests, `tests/e2e/lib/a13-fixtures.ts` `demoArea()`; gazetteer name, radius):

- place: Austin
- radius: 5 mi

**Why not Pflugerville:** on the published run, Pflugerville (30.447765, −97.602116, 5 mi) holds 0 properties and 0 reroof permits. The story's 2026-10-19 reference (44 Austin reroofs, 3 Expired, 0 open) came from the full Austin dataset; the published run holds only one month of it.

## Measurement (2026-10-21 21:59–22:02 UTC; re-measured at run time by TC-009)

Run `travis-202609-permits-20261021t103516z`, manifest `bafkreiasycmsr2qdlxqcfg3yc2conpn3jxmohz7gs55hkseipplhpqsk5i`. All 23 table parts were fetched from the public Pinata gateway and matched the manifest sha256 and size; queried with the repo's own `bindManifest` and `exploreSearchSql` on the Node DuckDB engine. Within 5 mi of each gazetteer place (travis-places@1.0.0):

| Place | Properties with an open or stalled reroof | Open reroofs | Stalled | Longest open | Reroofs in radius (all statuses) | Roof ≥ 15 yrs |
| --- | --- | --- | --- | --- | --- | --- |
| **Austin city** | 3 | 16 | 0 | 0.13 yrs (47 d) | 17 | 3 |
| Rollingwood city | 3 | 3 | 0 | 0.13 yrs | 5 | 3 |
| Sunset Valley city | 3 | 4 | 0 | 0.13 yrs | 13 | 2 |
| Pflugerville | 0 | 0 | 0 | none | 0 | 0 |

The run holds 14 properties and 35 reroof permits (22 open, 13 closed, 0 stalled).

## What the demo shows today, honestly

- **D-8** (Austin city, 5 mi, roof ≥ 15 yrs): 3 properties, each with roof-age basis, confidence, coordinates and source.
- **D-9** (open or stalled, open ≥ 5 yrs, longest first): no permit has been open that long in this run, so the page shows "no open roofing permits in this radius on the current run". Stalled permits are not emitted yet (`improvement_status` has no Expired carrier, ADR-0002 D-4a).
- With A-04, A-07 and A-11 (full county, all permit years) the same area shows the long-open and stalled list; this file is re-measured then.

Hosted p95 and the 5 → 3 mi change are recorded in `A-13-roof-age.md` after the hosted run.

## Hosted result of D-9 on the final build (015fbf9, read 2026-10-22 09:07 UTC)

Preview `https://013-explorer-and-pages.d2lx0utip89u18.amplifyapp.com` (`/build.json` sha `015fbf99bed1d784c908714c56418c83ce2d5e4f`). Explore with the demo area and the D-9 filters, read by a scripted browser:

`/tx/travis/explore?place=austin&r=5&roof=15&permit=open_stalled&openYrs=5&sort=open_desc` (set on the page: "Open or stalled" ticked, "Open ≥" 5, Sort "Open longest")

| What the page shows | Value |
| --- | --- |
| Engine line | `DuckDB on the server · same views` |
| Header | `0 within 5 mi of Austin · roof ≥ 15 yrs` |
| Rows | 0 |
| Empty-state sentence (exact) | **no open roofing permits in this radius on the current run** |
| Server | HTTP 200, `explore.search`, `rows` 0, `queryDurationMs` 166 (CloudWatch, `CountyLensApi-FunctionLogs…`, 09:07:28Z) |

This is correct for the published run: the longest open permit is 47 days (0.13 yrs), far under 5 years, and no permit is `stalled`. The sentence appears because the permit filter is the only filter that excludes the rows (ERR-54 and the MG-10 review fix). Stalled permits stay at 0 until A-04, A-07 and A-11 publish the full permit history and a carrier for "Expired".

**Open-permit search timing (TC-041, series 2).** `docs/evidence/A-13-TC-041-timings.json`: 20 distinct radii, from the final run on `2e14516`: p50 812 ms, p95 **1,313 ms**, max 1,322 ms, against p95 < 3,000 ms (the first run on `015fbf9`: p95 812 ms). Provisional: measured on the 14-property slice. The radius + roof-age series is in [A-13-roof-age.md](A-13-roof-age.md): p50 1,320 ms, p95 1,837 ms.

**Test result.** TC-009 (D-9), TC-031 (chips and sort), TC-035 (empty open list) and TC-032 to TC-034 PASS on `015fbf9` and on `2e14516` (`docs/reports/A-13-test-report.md`). On `015fbf9` the file had no `place:` line, so TC-009 ran on its default area, Pflugerville (0 properties). Since the line `- place: Austin` was added, TC-009 runs Austin city on `2e14516` and passes with the same result: 0 rows and the exact sentence (a11-branch "today"). The assertion "today: no permit open ≥ 5 years" holds either way.

**Screenshots.** `docs/evidence/img/A-13-TC-009-3.png` (open filters and sort set) and `A-13-TC-009-6.png` (the empty state) are the test checkpoints, rewritten by the run on `2e14516` and now showing Austin city ("0 within 5 mi of Austin · roof ≥ 15 yrs"); `docs/evidence/img/A-13-d9-austin.png` is the Austin city page from the `015fbf9` read.

Hosted p95 and the 5 → 3 mi change for the roof-age search are recorded in `A-13-roof-age.md`.
