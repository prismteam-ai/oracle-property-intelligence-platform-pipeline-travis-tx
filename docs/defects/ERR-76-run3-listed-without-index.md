---
id: ERR-76
type: defect
feature: FEAT-A13
story: A-16
test_case: A-13-TC-083 (feature CI run 40241787740); hosted explore.search on Run 3
ac_reference: AC-13
severity: High
status: Closed 2026-10-26 02:15 EEST: Run 3 index uploaded; hosted explore.search on Run 3 answers 200 in 1.0–1.9 s
found_by: Run 3 session (cross-session message) for HebaGaber
found_date: 2026-10-26
fix_branch: 016-cost-and-admin
fix_commit: 2b424b1 (bridge builds the index after cid-copy); operator upload 02:14 EEST
retest_date: 2026-10-26
closed_date: 2026-10-26
---

# ERR-76: Run 3 was listed before its Explore index existed

## Brief description
The A-16 deploy (01:45 EEST) moved the shared API to the per-run Explore index (ADR-0001 Amendment 1): a full-county run without an index answers `index_not_built`. Run 3 was then published by the other session's manual publish (all 8 steps), which has no index step, so the latest run was listed with no index. Hosted Explore showed "Search index for this run is not built yet (index_not_built)" and A-13-TC-083 failed in feature CI.

## Cause
Two changes landed close together in separate sessions; the manual publish path did not know about the new index requirement. A first upload attempt also failed because the operator's AWS session had expired.

## Fix
- Operator step: `build-explore-index.ts --source cidcopy --copy-host … --verify --upload` for Run 3 (190 parts, 783 MB, SHA-256 checked, parity 0; uploaded 02:14 EEST).
- Prevention: the bridge runner now builds, verifies and uploads the index right after the `cid-copy` step and before the `index` step (machamp review M1, commit 2b424b1), and the bridge README tells manual publishers to do the same.

## Re-test
`explore.search` on Run 3 (5 mi, roof ≥ 15): 200 in 1.88 s cold, 1.02–1.10 s warm; 68,527 matches.
