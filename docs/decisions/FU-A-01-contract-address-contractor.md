---
id: FU-A-01-contract-address-contractor
type: follow-up
story: after A-04 (not yet assigned)
title: "Publish the situs address and the contractor name as printed in contract/v1.1"
status: Open · requested by the Roofing CRM (Task B) design review; PO (HebaGaber) decided on 2026-10-21 to fix it in Task A
created: 2026-10-21
---

# Follow-up: address and contractor name in the contract

**Why:** the Roofing CRM (Task B) reads only this repo's published data. It shows an address on every property and the contractor on every permit. Task B's README demo line 5 says "review contractor details and BBB rating". The pipeline already captures both fields: A-04 AC-1 (situs address) and A-07 AC-1 (company name "as printed on permit"). But `contract/v1` does not export them:

| Field | contract/v1 status (`contract/v1/README.md`, lines 152–159) | Captured by |
| --- | --- | --- |
| `unnormalized_address`, `city_name`, `postal_code` on `v_property` | `not_in_export`: address is a top-level oneOf, and export-tables emits none of its properties | A-04 (situs address) |
| `contractor_name_raw` on `v_roofing_permit` | `no_lexicon_carrier` (ADR-0002) | A-07 (printed name) |

**Decision (PO, 2026-10-21):** fix it on the Task A side, in a story after A-04, because A-04 is in progress. That story extends the contract as `contract/v1.1` and adds these fields. If ADR-0002 still rules out a lexicon carrier for the printed contractor name, record how it is carried instead, for example a published side table with provenance.

**Also:** the Hub's Roofing CRM card says "Lead tools (visits, notes): coming soon". Leads and notes are live in the CRM, so change the line to "Map, Filters and AI search, plus leads; Campaigns and the rest are coming soon."

**Until it lands, the CRM** shows the TCAD account id + "near {place}" + lat/lon with "Address not published in Run {n}", and "Contractor not published" with its reason. It reads the new fields when a v1.1 manifest is synced, with no CRM code change.

**Done when:** a published manifest carries both fields for the pilot parcels (TCAD `0208011301`, `0223120506`) with source URL and capture time, and the CRM drawer shows them.

**Tracked in the CRM repo:** `docs/plan.md` EXT-11, EXT-12; `design/design-review-log.md` #1, #2, #23.
