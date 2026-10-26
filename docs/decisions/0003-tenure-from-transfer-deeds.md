---
id: ADR-0003
type: decision
parent: ARD-A
story: A-11
title: "Owner tenure from TCAD transfer deeds (deed_date)"
status: Accepted (marker convention in Decision 3 confirmed by the PO on 2026-10-25)
date: 2026-10-25
---

# Owner tenure from TCAD transfer deeds (A-11 Run 3, ERR-71)

## Context

Tenure was the age of the latest `sales[].saleDt`. That array is a thin history: 266,554 of 441,961 R accounts (60.3%) print no dated sale, and for the accounts that do, the latest sale is often old, so 44% of dated accounts read "long tenure" while a later transfer deed says 10 years or less. The same TCAD record carries `deeds[]` (`deedType`, `deedDt`, `deedRecordedDt`). Texas non-disclosure hides sale prices, not the recorded deed or its date. PO decision 2026-10-25: use TCAD transfer-deed dates as a tenure source, labelled `deed_date`.

## Decision

1. **Dated transfers** of an account are the `sales[]` rows with a valid `saleDt` plus the `deeds[]` rows whose type is on the allow-list below and that print a valid `deedDt` (else `deedRecordedDt`, the recording date, never earlier than signing). A date counts only when it is a real calendar date, not before 1900 and not after the run's as_of. One row per calendar day: a sale beats a deed on the same day, then the lowest `saleID` / `deedID`. Order is date, sale before deed, id, so `sales_history_N.json` names and the relationship wiring are deterministic.
2. **Each dated transfer is one `sales_history` row** (`ownership_transfer_date` only, no price). The current owner links to the latest row. `tenure_years` and `is_long_tenure` use the latest transfer from either source; `is_long_tenure` is true only above 10 years; no dated transfer still gives `unknown`, null tenure and reason `no_dated_sale`.
3. **Carrier of the basis.** The lexicon `sales_history` class has no field for the source of a date (`sale_type` is a distress enum). A row built from a deed therefore says so in `source_http_request.multiValueQueryString.transfer_source = ["deed"]` (the schema allows `multiValueQueryString` on a GET and the Austin permit rows already use it for their key). The URL, method and `request_identifier` (the pID) are unchanged, so the property still joins and the source lookup by URL still works. A sale row keeps the plain request. `v_property.tenure_basis` is `deed_date` when the latest transfer row carries the marker, `sale_date` when it does not, `unknown` when there is none. The marker is an internal convention of this repo; it needs no lexicon change, and a future lexicon field would replace it.
4. **Contract.** `tenure_basis` gains `deed_date` (additive, stays in contract/v1). `parcels.tenure_basis` accepts it (migration 0410).

## Deed-type allow-list

The export layout (Legacy 8.0.33) lists `deed_dt`, `deed_num`, `deed_book_*` but no deed-type code table, so the codes are judged from their standard Texas meaning plus the full-export evidence (R accounts, 493,246 records): frequency, how often the deed prints both parties, and the comments TCAD staff attach.

| Code | Count (R deeds) | Meaning used          | Decision                                                                                    |
| ---- | --------------- | --------------------- | ------------------------------------------------------------------------------------------- |
| WD   | 1,346,684       | warranty deed         | **include**: conveys title to the buyer                                                     |
| SW   | 408,529         | special warranty deed | **include**: conveys title                                                                  |
| QD   | 23,688          | quitclaim deed        | **include**: conveys whatever title the grantor holds, a real change of the owner of record |
| GD   | 651             | gift deed             | **include**: conveys title without a sale                                                   |
| ED   | 7,923           | executor's deed       | **include**: probate conveyance to the buyer or heir                                        |
| TD   | 12,260          | trustee's deed        | **include**: trustee conveys to the buyer (including a foreclosure sale)                    |

Excluded, with the reason:

- **No conveyance, by the code or its comments:** `L` (listing: comments "see listing info / list price", almost no buyer or seller), `MS` (marriage license, a name change), `DC` (death certificate), `DV` (divorce decree: a court order, not a deed; left out until a legend confirms it), `AH` (affidavit of heirship), `WC` and `WS` (will plus death certificate), `LT` (letters testamentary), `CD` (correction deed: comments "filed to correct legal"; it repeats an earlier conveyance), null type (147,850 deeds, mostly undated).
- **Meaning not confirmed by any legend, so not guessed:** `ST`, `AD`, `DW`, `OD`, `PD`, `SD`, `DS`, `CS`, `GF`, `CN`, `AM`, `DD`, `RO`, `BS`, `MH`, `SIP`. They are small or ambiguous; any of them may be added later by a new ADR once TCAD's code table is in hand.
- Liens, releases, easements, plats and security instruments do not appear as deed types in this export.

Conservative by construction: a non-included type can only leave the tenure older than the truth, never invent a transfer. The full-export run reports how many accounts have an excluded-type deed dated after their final allowed transfer (ERR-71).

## Consequences

- County group: `sales_history` rows and (for the owner link) the latest dated row change for many accounts, so County CIDs change for hundreds of thousands of properties. Run 3's manifest delta must say so.
- Owner linking is unchanged in rule (the latest dated row), but the latest row may now be a deed; the deed's `buyerLine` agreed with the current owner name on 66% of the 12,000-record sample, which supports reading it as the transfer into the current owner.
- `meta` and the Properties view show `deed_date` as the evidence label; missing data keeps `no_dated_sale`.
- Alternatives rejected: a new lexicon property for the date source (needs a schema request and a new lexicon CID, out of scope for Run 3); a side table (tables come only from `export-tables`); treating every deed type as a transfer (counts corrections and affidavits as conveyances); inferring "no sale since 1988 means long tenure" (invented data).
