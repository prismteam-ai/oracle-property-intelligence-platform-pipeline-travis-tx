---
id: DEC-A-04-permit-match-rate
type: decision
story: A-04
title: "Report the measured Austin roofing-permit match rate instead of the 97% target (PO exception to AD-16 / AC-13 / NFR-005)"
status: Approved by the PO (HebaGaber) on 2026-10-22 (Round 1 stop D-18, answer "Record as PO exception")
created: 2026-10-22
---

# Permit match rate exception (A-04)

## Decision

AD-16 and AC-13 asked for at least 97% of Austin roofing permits linked to a roll property. The number was set on 2026-10-19 by reconciling two agents' estimates, before any permit was linked. On 2026-10-22 the full link was measured. The PO approved this exception: AC-13 and NFR-005 are met by **reporting the measured rate with every unmatched permit kept, counted and given its reason**, not by reaching 97%. No link is guessed to raise the rate (P0 rules: a shared `geoID` or a shared address is never silently linked).

## Measurements (Query DB, link job `travis-a04-permits-link-20261022061433`, code `9d0fff3`, Austin backfill watermark 2026-10-21T14:42:23Z, 2,381,226 permits)

| Population | Permits | Linked | Rate |
| --- | --- | --- | --- |
| All Austin permits | 2,381,226 | 2,007,514 | 84.3% |
| Roofing (A-02 profile verdict `roofing`) | 19,031 | 16,816 | **88.36%** |
| Include-term candidates (the 22,084 baseline) | 22,084 | 19,599 | 88.75% |
| Open roofing | 96 | 80 | 83.3% |
| Stalled roofing | 2,016 | 1,674 | 83.0% |

How the links were made (all permits): 1,979,451 by a unique `tcad_id` (`geoid_unique_r`); 1,691 by `tcad_id` on a shared `geoID` plus a unique exact address (`geoid_plus_address`); 1,633 by exact address when there is no `tcad_id`; 24,739 by exact address when the `tcad_id` is on no 2026 roll account (`stale_tcad_id = true`).

## Why 97% is out of reach (the 2,215 unmatched roofing permits)

| Reason | Roofing permits | Cause |
| --- | --- | --- |
| `no_tcad_geoid` | 1,447 | the `tcad_id` is on no account of the 2026 certified roll: retired or re-platted parcels (not as `pID`, not as `geoID`, not ignoring leading zeros); the rate falls with permit age (1980s 91%, 2000s 79%); the exact address matches no single parcel |
| `ambiguous_geoid` | 359 | shared `geoID` and the address does not pick exactly one account |
| `no_tcad_id` | 237 | the permit carries no `tcad_id` and its address matches no single parcel |
| `address_unmatched` | 172 | an address the exact-signature rule could not place |

Of the 1,977 unmatched roofing permits that have a street number, a looser comparison would yield at most about 93 unique candidates; about 980 more match several accounts at one address (condos and multi-account addresses), which cannot be linked without guessing; 35 street numbers exist nowhere on the roll. The honest one-to-one ceiling is about 89%.

Permit 1982-012866 BP (the oldest open roofing permit, `Suspended`) is unmatched with `no_tcad_geoid` (geoID `0208011301` is on no 2026 account); it keeps its raw status, `status_class = open`, `open_days`, address and permit point in the Query DB.

## What stays true

- Every unmatched permit is kept and counted with its reason (AC-13, AD-16): 0 unmatched permits without a reason.
- The rate is reported by population (above) in `docs/evidence/A-04.md` and the run report (`permits` section), with the link job id and the watermark.
- This exception does not change `contract/v1`. It must be revisited if the roll is refreshed or the address rule is widened (a looser rule needs a PO decision and a version of the link rule).
