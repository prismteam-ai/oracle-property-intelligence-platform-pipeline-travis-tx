---
id: EV-A-13-roof-age
type: evidence
story: A-13
feature: FEAT-A13
test_cases: [A-13-TC-008, A-13-TC-025, A-13-TC-026, A-13-TC-027, A-13-TC-041]
runtime_url: https://013-explorer-and-pages.d2lx0utip89u18.amplifyapp.com/tx/travis/explore?place=austin&r=5&roof=15
data_snapshot: bafkreiasycmsr2qdlxqcfg3yc2conpn3jxmohz7gs55hkseipplhpqsk5i
branch: 013-explorer-and-pages
created: 2026-10-22
---

# A-13 evidence: properties with roofs of 15 years or more near the demo area (demo line D-8, AC-4)

Hosted preview `https://013-explorer-and-pages.d2lx0utip89u18.amplifyapp.com`, build `015fbf9`. Demo area: **Austin city, 5 mi, roof ≥ 15 yrs** (PO decision D-11, 2026-10-22, "Austin city (Recommended)"; why, in [A-13-open-permits.md](A-13-open-permits.md)). The published run `travis-202609-permits-20261021t103516z` holds 14 properties, so every count here is from that slice.

## Action

1. Open `https://013-explorer-and-pages.d2lx0utip89u18.amplifyapp.com/tx/travis/explore?place=austin&r=5&roof=15` in a fresh browser context.
2. Read the engine line, the header and each result row.
3. Change the Radius field from 5 to 3 and read the header again (URL becomes `...?place=austin&r=3&roof=15`).

## Observed (read on the page, 2026-10-22 09:07 UTC)

| What | 5 mi | 3 mi |
| --- | --- | --- |
| Place line | `Austin city · Census 2024 Gazetteer · 30.298622, −97.754134` | same |
| Engine line | `DuckDB on the server · same views` | same |
| Header | **3 within 5 mi of Austin · roof ≥ 15 yrs** | **1 within 3 mi of Austin · roof ≥ 15 yrs** |
| Rows listed | 3 | 1 |
| Time from the radius change to the new header | | 765 ms (page measure, no reload) |
| Server `queryDurationMs` of the search | 173 ms | 156 ms |

The count changes from **3 to 1** when the radius goes from 5 to 3 mi. The distances in the rows explain it: the three properties are 2.386, 3.972 and 4.233 mi from the Austin city point, so only the nearest stays inside 3 mi.

## The rows (5 mi)

Each row shows the fields the story asks for. Nothing is blank: a value that the published tables do not carry says why.

| Property (CID, shortened) | Roof age | Basis | Confidence | Distance, bearing | Latitude, longitude | Source |
| --- | --- | --- | --- | --- | --- | --- |
| `bagu…stmq` | 41 yrs | `built_year` | low | 2.386 mi S | 30.2654597712, −97.7430056587 | TCAD certified export, run `travis-202609-permits-20261021t103516z`, table `property`, captured 2026-10-21T10:40:04.525Z |
| `bagu…geiq` | 41 yrs | `built_year` | low | 3.972 mi S | 30.2429925426, −97.7373585692 | same |
| `bagu…5daq` | 48 yrs | `built_year` | low | 4.233 mi N | 30.3598472397, −97.7514278191 | same |

- The row's Source link names the TCAD file `2026 Certified JSON SUPP 0 07182026.zip` at `traviscad.org`, the run ID, the table (`property`), the table CID `bafkreigmdptzc3zbq2f6bhqs2xmthuvlduwf3a7kcqtb4eb6wicxx6d7lm` and the manifest `bafkreiasycmsr2qdlxqcfg3yc2conpn3jxmohz7gs55hkseipplhpqsk5i`. All 3 rows carry a Source (3 of 3 provenance blocks; TC-026 asserts 100 % on every run).
- Roof age is the year-built proxy at low confidence: the run saw one month of each parcel's Austin permits (`partial_history`), so no roofing permit date backs it.
- Each row also shows its newest reroof permit ("Open 0.1 yrs", "Open 0.1 yrs", "Open 0 yrs"; source status "not published · no lexicon carrier"), the contractor as "not published · no lexicon carrier" with "Contractor unresolved", "BBB not checked · contractor_unresolved", tenure (19 yrs, unknown, 21 yrs) and "owner area unknown · mailing address not in the published export". The address is "not published · no lexicon carrier".
- The server's `tenure_unknown` count for this search is 1 (the second row).

## Timing (TC-041)

`docs/evidence/A-13-TC-041-timings.json`, 20 distinct radii (3 to 8 mi) per series, from the input change to the updated header, limit p95 < 3,000 ms:

| Series | p50 | p95 | max |
| --- | --- | --- | --- |
| Radius + roof age | 1,320 ms | 1,837 ms | 5,348 ms |
| Open permit (D-9) | 812 ms | 1,313 ms | 1,322 ms |

Provisional (`"provisional": true`): measured on the 14-property slice. The server-side query itself took 203 to 245 ms in those runs. These numbers are from the final run on `2e14516` (the first run on `015fbf9` gave p95 817 ms and 812 ms; the later link was slower, and one radius + roof run took 5,348 ms).

## Screenshots

- Austin, from this read (extra captures, not from a test): `docs/evidence/img/A-13-roof-age-austin-5mi.png` (3 rows) and `docs/evidence/img/A-13-roof-age-austin-3mi.png` (1 row).
- The test checkpoints for TC-008 and TC-027 use **Pflugerville** (the AC-4 text names it; the gazetteer point is 30.447765, −97.602116). That area holds 0 properties on this run, so they show the zero-results state "0 within 5 mi of Pflugerville · roof ≥ 15 yrs", "No properties within 5 mi · 2 close matches just outside", the first close match "+1.718 mi": `A-13-TC-008-2.png` (place suggestion), `A-13-TC-008-6.png` (engine line and header), `A-13-TC-008-8.png` (rows and close matches), `A-13-TC-027-2.png` (before) and `A-13-TC-027-4.png` (after 5 → 3 mi).
- Row fields and Source on the drawer: `A-13-TC-030-3.png`, `A-13-TC-030-4.png`; the per-row fields test: `A-13-TC-026-3.png`.

## Missing data or limitations seen

- The Austin numbers above were read by a separate scripted browser on `015fbf9`, not by a Playwright case: TC-008 and TC-027 still run the Pflugerville area of the story text on `2e14516` (TC-009 runs Austin city). The count 3 equals the demo-area measurement in `A-13-open-permits.md` ("Roof ≥ 15 yrs" for Austin city: 3). No browser-SQL cross-check was run for Austin (TC-008 does it for Pflugerville).
- Roof basis is `built_year` and confidence is low for all three rows. Roofing-permit-based age needs the full permit history (A-04, A-07, A-11).
- Address, contractor name and status text are "not published · no lexicon carrier": the lexicon has no carrier yet (ADR-0002).
