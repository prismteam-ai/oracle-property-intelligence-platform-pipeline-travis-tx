---
id: ERR-20
type: defect
feature: FEAT-A03
story: A-03
test_case: A-03-TC-022
ac_reference: A-03-AC-5
severity: Medium
status: Deferred
found_by: PO (private-window review)
found_date: 2026-10-21
fix_branch: A-13 (Explorer UI)
fix_commit:
retest_date:
---

# ERR-20: Permits list – missing-data pills do not name their field and repeat the same reason

## Brief description

Every missing reason is shown as a labelled pill (AC-5 met, never blank), but a pill does not say which field it is about, so a row carries about ten pills of which seven read "No place for this field in the published data model". A reader cannot tell that one is the printed status, another the printed contractor name, the description, the expiry date and so on. The contractor cell repeats part of the same story. The data and its retrieval are correct; this is presentation only.

## Related requirement

- **Story:** A-03 · **AC:** A-03-AC-3, AC-5 · **Requirement:** FR-005, FR-011 · **Test case:** A-03-TC-022

## Environment

| Item | Value |
| --- | --- |
| URL | https://003-walking-skeleton.d2lx0utip89u18.amplifyapp.com/permits |
| Build | `86694cc` (no app code change to `c518d87`) |
| Data snapshot | manifest `bafkreiasycmsr2qdlxqcfg3yc2conpn3jxmohz7gs55hkseipplhpqsk5i` |
| Browser / OS / device | desktop, wide window (PO screenshot) |

## Steps

1. Open the Permits page and wait for the 35 rows.
2. Read the "Missing data" column of any row.

**Expected:** each missing field is identifiable (field name + reason), identical reasons grouped, a compact summary per row.
**Actual:** about 10 unnamed pills per row, 7 identical.

## Decision

PO decision at the G7 merge (2026-10-21): "Merge now, fix in A-13". A-13 (Explorer UI) rebuilds this page; the fix there: each pill names its field (e.g. "Status as printed: not in the published data model"), identical reasons grouped with their fields, a compact expandable summary per row, and a hosted TC asserting a field name on every pill.
