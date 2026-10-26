# CR-A-11 (Donphan data spot-check): Run 2 permits correction vs Run 1

Reviewer: data consumer view (roofing CRM). Read-only DuckDB over local parquet. Scope: Run 2 permits tables b01-b05, Run 1 permits b01-b02, county tables b* (shared).
Score: **92 / 100** (pass bar 75). Blocking findings: none.

## What checked out
| Check | Query / evidence | Result |
|---|---|---|
| Only roofing replacements | `select improvement_type,improvement_action,count(*) from r2i group by all` | 15,025 rows, all Roofing/Replacement; 0 other. Run 1: Roofing/Replacement 15,025 + Electrical 940 + Plumbing 807 + MechanicalHVAC 615 (17,387). |
| Identity join | `select count(*) from r2p where cid not in (select cid from cp)` | 0 of 10,792 Run 2 property.cid missing in county (441,961 rows). Relationship `property_has_property_improvement`: 15,025 rows, 0 from_cid outside r2p/county, 0 dangling to_cid, no improvement without a relationship, no property without a permit. |
| Property fields equal county | join r2p/cp on cid, per-column `is distinct from` | 10,792 joined; 0 differences in legal description, structure/effective built year, property_type, usage, subdivision, zoning, area, units, structure_form, build_status, hoa/manager, request_identifier, source_http_request, property_cid. Only `data_group_cid` differs (expected, per group). Legal description null count = 0 (was null in Run 1). |
| Sample pIDs | 100027 LOT 8-9 BLK 18 SOUTH HEIGHTS, SingleFamily, 1933; 100039 LOT 8 BLK F CAPITAL HEIGHTS, SingleFamily, 2006; 228383 UNT 111 VILLAS OF CORONADO HILLS, Townhouse, 1977; 105471 ABS 14 SUR 21 HILL H P, LandParcel, null year | all equal county. |
| Permit fields unchanged | r2i join r1i on permit_number; compare issue/close/final/application/completion dates, status, fee, contractor_type, owner_builder, type, action | 15,025 joined, 0 differences in every field. No Run 2 permit absent from Run 1; no Run 1 roofing permit missing in Run 2; no duplicate permit_number. |
| Privacy | schemas of address, parcel, property, property_improvement, properties | No person/company/tax/owner/price tables or columns in the permits group. Address has only cid keys. |

## Findings (non-blocking)
1. **pIDs 124104 and 100022 are not in the permits group** (in county, absent from both Run 1 and Run 2 permits properties): they have no roofing permit published. Expected, but the request listed them as samples; confirm they were meant as no-permit controls.
2. **75 properties dropped vs Run 1** (10,867 to 10,792): checked `r1p` not in `r2p`; they carried only trade sub-permits (query: r1p whose parcel_identifier is not in r2p: 75 rows, 0 with any Roofing permit). Consumers using Run 1 will see them vanish; the supersede note should say so.
3. Permit-to-property relationship `from_cid` differs from Run 1 for all 15,025 permits. This is the intended fix (Run 1 cids matched nothing in county), but any consumer who cached Run 1 permit/property CIDs must re-key on parcel_identifier.
4. `improvement_status` is null for 1,674 roofing permits (11%), same as Run 1; ensure the UI says why.
5. Scope limit: Run 1 had only b01-b02 locally (dry run); comparison is by permit_number, not by batch. Not an exhaustive audit of geometry/valuation fields (not present in the permits group).
