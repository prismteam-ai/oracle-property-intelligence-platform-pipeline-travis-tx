---
id: DEC-A-01-parcel-gap-exception
type: decision
story: A-01
title: "Approve the GIS-vs-roll parcel gap as an exception to the 2% readiness threshold"
status: Approved by the PO (HebaGaber) on 2026-10-20
created: 2026-10-20
---

# Parcel gap exception (A-01)

## Decision

The readiness validator's parcel gate is passed with a PO-approved exception (`approved_exceptions`, gate `parcel`) for the measured gap between the county GIS parcel layer and the TCAD certified roll. The exception is bound to these values; if any of them changes, the exception no longer applies and the gate is judged again:

| Value | Approved |
| --- | --- |
| Certified roll accounts (`assessed_parcel_count`, the denominator) | 493,246 |
| GIS parcel features (`gis_feature_count`, US-runner count 2026-10-20T07:31:05Z) | 373,683 |
| Raw gap (`gap_pct`) | 24.24% (119,563 accounts) |

## Why

The kit validator compares only the two raw counts, so any roll with many accounts that have no land parcel of their own blocks, however well the gap is explained. The gap here is explained from the certified export itself (offline count, `reconcile-parcel-gap`):

| Part of the gap | Accounts | Basis |
| --- | --- | --- |
| Accounts that are not land: business personal property (P), mobile homes (MH), minerals (MN) | 51,285 | `propType`; meanings from the TCAD Export Layouts |
| Real-estate accounts with no export geometry point and state code A4 or F4 | 56,139 | state-code reading as condominium units; **the meaning is unverified** unless the catalog cites an official code table, and only 7,880 of these rows have `condoUnit` filled |
| Real-estate accounts with no export geometry point and state code O1 (inventory) | 3,534 | state-code reading; `condoUnit` is filled on 89% of these rows, so most are likely condominium inventory |
| **Explained** | **110,958** | |
| **Residual** | **8,605 (1.74% of the roll)** | unexplained; consistent with the county GIS refresh cycle (one to two months), not verified |

This is a count-level match, not a feature-to-account join, and "no export geometry point" is used as a stand-in for "no own GIS polygon". A sampled join is planned before A-05 relies on it.

## Coverage effect

- The certified roll stays the denominator (493,246). GIS is never used to seed alone, and never replaces the roll.
- Roughly 56,000 condominium accounts and 51,285 non-land accounts are not expected to get a parcel polygon of their own. A-05 must report coordinate coverage against real-estate accounts and say how condo units get coordinates (for example the building's parcel or the export's point), instead of counting them as missing.
- The readiness report shows the parcel gate as `PASS` because of this exception; its evidence line still reads `discrepancy=24.24%`. `docs/sources.md` lists the exception.

## Who and when

Approved by the PO, HebaGaber, on 2026-10-20, in the A-01 working session, after the account breakdown was shown. Recorded in `pipeline/docs/travis-sources.yaml` (`approved_exceptions`), written by the `approve-exception` command.
