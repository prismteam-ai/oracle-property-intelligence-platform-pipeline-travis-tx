---
id: A-02-classifier-review
story: A-02
seed: "travis-austin@1.0.0/AC-3/2026-10-21"
population: "(upper(description) like '%ROOF%' OR upper(work_class) like '%ROOF%')"
population_count: 65437
population_rows: 65437
captured_at: 2026-10-20T21:34:28.982Z
sorted_keys_sha256: 8c729882fbad64da9faec06064e06c33cc6eed46d94de48355478f4fd7de4090
profile:
  name: travis-austin
  version: 1.0.0
  sha256: c8fd15cf8deb654c2959d7cca3b05560bc9830de2518c56a092bd87bdf53dfa6
source: https://data.austintexas.gov/resource/3syk-w9eu.json
---

# A-02 classifier review (AC-3, PO decision D-7)

Profile `travis-austin@1.0.0` (sha256 `c8fd15cf8deb654c2959d7cca3b05560bc9830de2518c56a092bd87bdf53dfa6`) applied to 25 Austin permits drawn from the 65437 permits whose description or work class mentions ROOF (captured 2026-10-20T21:34:28.982Z).

**How they were drawn:** every permit number in the population was ranked by `sha256(seed + "\n" + permit_number)` with the seed above; the 25 smallest digests are listed in rank order. Anyone can redo the draw from the seed and the population.

**Pass (FR-003, NFR-001):** at least 24 of 25 marked right, at most 1 `needs_review`, and 0 solar/PV/RTU permits accepted as roofing.

**Profile verdicts:** 9 roofing, 16 not roofing, 0 needs_review.

Mark the last column ✔ (the verdict is right) or ✘ (wrong). The status note says how the status word is published (D-4a: Expired stays Expired and is published with improvement_status null).

| # | permit_number | permittype | work_class | status_current | description | profile verdict | reason | PO ✔/✘ |
|---|---|---|---|---|---|---|---|---|
| 1 | 1987-014745 BP | BP | Remodel | VOID | Remodel Roof-Md Pharmacy | not roofing | `no_include_term`; status VOID → exclude (not emitted) | ✔ |
| 2 | 2020-159840 EP | EP | Auxiliary Power | Final | Install new 4.8 kW rooftop solar system service to new residential home in Whisper Valley at 9725 Evening Canopy | not roofing | `aux_power`; status Final → closed (Completed) | ✔ |
| 3 | 2023-140729 EP | EP | Auxiliary Power | Final | Install 8 (405W) roof mounted solar panels 3.240 kW solar service system tying into existing 225 AMP main service panel | not roofing | `aux_power`; status Final → closed (Completed) | ✔ |
| 4 | 2007-131673 PP | PP | Remodel | Final | Extensive fire damage to both rear-located structures on this property.  Replace roofs completely remodel interiors of both structures new siding on both structures.  New wndows electrical and plumbing will be part of this project as well. | not roofing | `no_include_term`; status Final → closed (Completed) | ✔ |
| 5 | 1986-002792 BP | BP | Remodel | Final | Re-Roof Duplex | roofing (Roofing / Replacement) | `include_term`; status Final → closed (Completed) | ✔ |
| 6 | 2025-029080 BP | BP | New | Final | New construction of a pool and spa with adjacent wood deck. The new portion of the deck will be 153 sq ft and will abut a previously <br>constructed deck (276 x 73) 199.375 sq ft. In total the old and new deck area will be 351.76 sq ft of wood deck. This deck will be no more <br>than 6 above grade does not serve a door and is outside of the existing roof line of the residence. | not roofing | `no_include_term`; status Final → closed (Completed) | ✔ |
| 7 | 2022-140434 EP | EP | Auxiliary Power | Expired | Installation of new solar system on existing residential roof | not roofing | `aux_power`; status Expired → stalled (improvement_status null) | ✔ |
| 8 | 2016-106770 BP | BP | Remodel | Final | Adding PV Solar to Existing School Rooftop | not roofing | `solar_pv`; status Final → closed (Completed) | ✔ |
| 9 | 1993-013243 BP | BP | Remodel | Final | Repair Roof & Remodel Kitchen | not roofing | `no_include_term`; status Final → closed (Completed) | ✔ |
| 10 | 1985-026112 BP | BP | Remodel | Final | Re-Roof Exist Res | roofing (Roofing / Replacement) | `include_term`; status Final → closed (Completed) | ✔ |
| 11 | 1985-021419 BP | BP | Remodel | VOID | Re Roof Existing Residence | not roofing | `no_include_term`; status VOID → exclude (not emitted) | ✘ |
| 12 | 2011-038236 BP | BP | Remodel | Final | Non-Structural Reroof to existing Group Residential (Sorority House) *MUST COMPLY W/2009 IECC* | roofing (Roofing / Replacement) | `include_term`; status Final → closed (Completed) | ✔ |
| 13 | 1985-005687 BP | BP | Remodel | Final | Reroofing Exist Res | roofing (Roofing / Replacement) | `include_term`; status Final → closed (Completed) | ✔ |
| 14 | 2019-233652 BP | BP | Addition and Remodel | Active | *Partial demo* Interior remodel converting existing basement to office and converting carport to garage. Adding roof top deck.<br>Changing few windows and doors | not roofing | `roof_deck`; status Active → open (Permitted) | ✔ |
| 15 | 2016-133342 EP | EP | Repair | Final | Interior renovations to bathrooms and kitchen. Replace all light/fans stove hoods install new under sink disposal replace sheet rock as. Re-roof. | not roofing | `trade_permit`; status Final → closed (Completed) | ✔ |
| 16 | 1991-011565 BP | BP | Remodel | Final | Reroof Existing Reilly Elem.School | roofing (Roofing / Replacement) | `include_term`; status Final → closed (Completed) | ✔ |
| 17 | 2016-043586 EP | EP | Addition and Remodel | Final | Partial demo Interior Remodel new siding windows and doors reroof back of home rebuilt exterior walls along back side **Rolling in expired BP 84-024090 (Addn To Exist Res To Create Second Floor Over garage) | not roofing | `trade_permit`; status Final → closed (Completed) | ✔ |
| 18 | 2017-124180 BP | BP | Repair | Final | re-roof residence with composite shingles replace rotted decking wood where necessary | roofing (Roofing / Replacement) | `include_term`; status Final → closed (Completed) | ✔ |
| 19 | 1986-008876 BP | BP | Remodel | Final | Reroof Exist Res | roofing (Roofing / Replacement) | `include_term`; status Final → closed (Completed) | ✔ |
| 20 | 1987-001998 BP | BP | Remodel | Final | Reroof Duplex | roofing (Roofing / Replacement) | `include_term`; status Final → closed (Completed) | ✔ |
| 21 | 2012-106780 BP | BP | Repair | VOID | Re-permitting for expired permit numbers 2011-049517 (exterior repairs to home as necessitated by CV - roof repairs as needed patch exterior walls and soffits replace all windows.)  (See 2013-041765) | not roofing | `no_include_term`; status VOID → exclude (not emitted) | ✔ |
| 22 | 2015-105375 MP | MP | Repair | Expired | Commercial unit change out to existing comm bldg (2 units on the roof top) | not roofing | `no_include_term`; status Expired → stalled (improvement_status null) | ✔ |
| 23 | 2024-106285 EP | EP | Remodel | Final | Building Envelope Renovation: new roof new siding new insulation new windows new mechanical BLDG C<br><br><br>R1C1 Reviewed & Approved (5 Eps): Installing 72 exterior wall packs and connecting power to a sliding gate motor. | not roofing | `no_include_term`; status Final → closed (Completed) | ✔ |
| 24 | 1994-003961 BP | BP | Remodel | Final | Reroof Commercial Bldg | roofing (Roofing / Replacement) | `include_term`; status Final → closed (Completed) | ✔ |
| 25 | 1994-006274 BP | BP | Demolition | Final | Demolish Portions Of Damaged Walls & Roof Only | not roofing | `no_include_term`; status Final → closed (Completed) | ✔ |

## Queries

- https://data.austintexas.gov/resource/3syk-w9eu.json?%24select=count%28*%29+AS+n&%24where=%28upper%28description%29+like+%27%25ROOF%25%27+OR+upper%28work_class%29+like+%27%25ROOF%25%27%29
- https://data.austintexas.gov/resource/3syk-w9eu.json?%24select=permit_number&%24where=%28upper%28description%29+like+%27%25ROOF%25%27+OR+upper%28work_class%29+like+%27%25ROOF%25%27%29&%24order=permit_number&%24limit=50000
- https://data.austintexas.gov/resource/3syk-w9eu.json?%24select=permit_number&%24where=%28upper%28description%29+like+%27%25ROOF%25%27+OR+upper%28work_class%29+like+%27%25ROOF%25%27%29+AND+permit_number+%3E+%272020-055599+BP%27&%24order=permit_number&%24limit=50000
- https://data.austintexas.gov/resource/3syk-w9eu.json?%24select=permit_number%2Cpermittype%2Cwork_class%2Cstatus_current%2Cdescription&%24where=permit_number+in+%28%271987-014745+BP%27%2C+%272020-159840+EP%27%2C+%272023-140729+EP%27%2C+%272007-131673+PP%27%2C+%271986-002792+BP%27%2C+%272025-029080+BP%27%2C+%272022-140434+EP%27%2C+%272016-106770+BP%27%2C+%271993-013243+BP%27%2C+%271985-026112+BP%27%2C+%271985-021419+BP%27%2C+%272011-038236+BP%27%2C+%271985-005687+BP%27%2C+%272019-233652+BP%27%2C+%272016-133342+EP%27%2C+%271991-011565+BP%27%2C+%272016-043586+EP%27%2C+%272017-124180+BP%27%2C+%271986-008876+BP%27%2C+%271987-001998+BP%27%2C+%272012-106780+BP%27%2C+%272015-105375+MP%27%2C+%272024-106285+EP%27%2C+%271994-003961+BP%27%2C+%271994-006274+BP%27%29&%24limit=1000

## Receipts

| # | status | bytes | sha256 | captured_at |
|---|---|---|---|---|
| 1 | 200 | 16 | `0bc146dbf81d0086d9c8052aaab2202f586b29e194b3dc4acff8a8a44a524ee9` | 2026-10-20T21:34:28.984Z |
| 2 | 200 | 1800001 | `54cf72c3efa5c5d8f9e442b5df64fee7cedd576a7451f95a9f213659e9c80675` | 2026-10-20T21:34:30.488Z |
| 3 | 200 | 555733 | `04eccc8d20492cc452cdb7cbf89a412d07edd6f1e2d585fd0d56aeb394305c25` | 2026-10-20T21:34:36.467Z |
| 4 | 200 | 16 | `0bc146dbf81d0086d9c8052aaab2202f586b29e194b3dc4acff8a8a44a524ee9` | 2026-10-20T21:34:38.434Z |
| 5 | 200 | 5409 | `3ccb2502a4d0abce0619bd707000b1efb71b5e41a894f6ea4b586555cc5ab016` | 2026-10-20T21:34:39.937Z |

## PO review (D-7, 2026-10-21)

- **Result: 24 / 25 right → PASS** (threshold ≥ 24), with `needs_review` 0 / 25 (≤ 1) and 0 solar/PV/RTU accepted as roofing (rows 2, 3, 7 and 8 are correctly not roofing).
- **Wrong: row 11** (`1985-021419 BP`, "Re Roof Existing Residence"). It is a real reroof that the profile misses, because "RE ROOF" with a space is not an include term. The permit is VOID, so it would not be published anyway.
- **PO answer (word for word):** "Yes, only row 11 (Recommended)".
- **Known miss carried to a later profile version:** the include spelling "RE ROOF" (with a space), and RTU mentions in passing ("Flash RTU curbs") that drop 10 real reroofs of 22,084. Neither is changed in `travis-austin@1.0.0`, because changing the term list changes AC-3/AC-5.
- Reviewer: HebaGaber (PO).
