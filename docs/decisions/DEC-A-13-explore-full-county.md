---
id: DEC-A-13-explore-full-county
type: decision
story: A-13
title: "Close A-13 with Explore search unproven on the full county; the gap moves to A-16 (PO exception to AC-4, AC-5, AC-8 and NFR-001 at full-county scale)"
superseded: "A-16 closed it on 2026-10-26: Explore search reads a per-run index (ADR-0001 Amendment 1); hosted Run 3 search 1.0–1.9 s; the parked cases are unparked (see docs/evidence/A-16.md § Closure, A13-1, A13-8)"
status: Approved by the PO (HebaGaber) on 2026-10-25 ("go to option 3 and document the gaps in a16")
created: 2026-10-25
---

# Explore search on the full county (A-13 exception)

## Decision

A-13 is closed and merged with its Explorer search (List view: area, radius, roof age, open or stalled permits, tenure, out-of-area owners) **verified only on the earlier 14-property slice**, not on Run 2. On Run 2 (441,961 properties, 15,025 permits) the search returns HTTP 500 after about 29 seconds. The gap, its measurements and the way to close it are carried to A-16 (`stories/A-16-cost-and-admin.md`, "Carried forward from A-13").

## Measurements (hosted, 2026-10-25)

| Step | Result |
| --- | --- |
| Slice (14 properties), earlier in A-13 | `explore.search` p95 817 ms, all search cases pass |
| Run 2, API with 1 GB DuckDB limit | 500 after about 6 s: `Out of Memory Error: could not allocate block (953.5 MiB / 953.6 MiB used)` (reproduced from the laptop against the same bucket) |
| Run 2, 2 GB limit, 15 s Lambda timeout | 500 after about 16 s (Lambda timeout) |
| Run 2, 2 GB limit, 29 s Lambda timeout | 500 after about 29 s, four tries in a row (warm and cold) |
| Same query run from the laptop, 2 GB | bind 50 s, summary 74 s, 78,233 properties within 5 mi of Austin (correct result, too slow for a request) |

## What still works on the full county

Hub, Runs and Compare (Runs 1 and 2), Coverage (permit kinds), Data · Manifest and Verify, Data · Catalog (tables grouped across export batches), Runs · Log, Legal, Help, every Coming soon item; the in-browser SQL panel (`SELECT count(*) FROM v_property` = 441,961, first query about 97 s). Nothing shows sample data; the failing search shows an explicit error.

## Why not fixed here

The fix is a design change (a per-run Explore index and an ADR-0001 amendment), estimated at 5–7 hours plus 2–3 hosted CI cycles for a private derived file, or 1.5–2 days if published in a new run. The PO chose to close A-13 and carry it to A-16.

## What the evaluator will see

Demo lines D-8 and D-9 on live full-county data return an error state. The evidence (`docs/evidence/A-13.md`) and the G7 report list every affected case as failed, with this record as the reason.

## Cost and concurrency risk of the stop-gap settings (metagross review, 2026-10-25)

The API Lambda now runs with a 2 GB DuckDB limit and a 29 s timeout (CDK, deployed from the laptop). A failing Explore search can bill up to about 87 GB-s (about $0.0012); at the stage throttle of 10 requests per second that is about $40 an hour, and about 290 concurrent executions would reach the account concurrency quota. Every search fails at 29 s whether the timeout is 15 s or 29 s, so the longer timeout adds cost and no benefit. Recommended: return the timeout to 15 s, add a per-route throttle and a duration alarm (A-16 gap 6). Not done in this decision because it needs one more CDK deploy, which needs the PO's go.
