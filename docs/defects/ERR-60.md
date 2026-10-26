---
id: ERR-60
type: defect
kind: product limit (design) — accepted gap
feature: FEAT-A13
story: A-13
test_case: A-13-TC-008, 009, 025 to 027, 029 to 037, 041, 043, 062, 065, 073, 074, 086 (parked)
ac_reference: AC-4, AC-5, AC-8, NFR-001
severity: High
status: Open — accepted by the PO on 2026-10-25 and carried to A-16 (docs/decisions/DEC-A-13-explore-full-county.md; stories/A-16-cost-and-admin.md, "Carried forward from A-13", item 1)
found_by: hosted run 40172676788 (HTTP 404, API not deployed), then 40175493042 (HTTP 500), then direct calls to the live API
found_date: 2026-10-25
fix_branch: none (A-16)
fix_commit: none
retest_date:
---

# ERR-60: Explore search does not run on the full county

## Root cause

One `explore.search` joins `v_property` and `v_roofing_permit` over 441,961 properties inside the API Lambda. At a 1 GB DuckDB limit it ran out of memory ("953.5 MiB / 953.6 MiB used"). At 2 GB it works but takes about 50 s to bind and 74 s to answer from a laptop; the Lambda times out at 15 s and at 29 s (the HTTP API limit), and every call returns HTTP 500 after about 29 s. On the 14-property slice it answered in 817 ms.

## What was done

API memory limit 2 GB and timeout 29 s (deployed, `CountyLensApi`); the page no longer retries (ERR-59); the 21 affected cases are parked under A-16 gap 1.

## To close

A per-run Explore index (private derived file, about 5 to 7 h plus 2 or 3 CI cycles; or a published artifact, 1.5 to 2 days) and an ADR-0001 amendment. Measure first (1 h): cold file reads versus the query itself.
