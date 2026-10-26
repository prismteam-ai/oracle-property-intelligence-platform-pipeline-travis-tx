---
id: DEC-A-01-source-access
type: decision
story: A-01
title: "Source access in A-01: VPN use, the US-runner GIS check, the BBB retest and no records requests"
status: Decided by the PO (HebaGaber) on 2026-10-20; D-3 is a recorded deviation
created: 2026-10-20
---

# Source access decisions (A-01)

The rules these decisions touch: FR-006a (never retry a 403 or a challenge, never change identity or network address), FR-006b and AC-6 (a US-runner check only on geo-block evidence), ARD § 8, and `research.md` R10 (a VPN counts as IP rotation and is forbidden).

## D-1. The 2026-10-19 live run went through a VPN (deviation, found in review)

- **What happened:** the operator machine was connected to a VPN during the 2026-10-19 discovery runs (`travis`, `travis-2`). This was not known to the run, and it was not recorded at intake: intake item 5 recorded the egress as `EG` from a check made outside the run.
- **What the receipts show:** Cloudflare edge codes in the saved responses are mixed within the same minute: `LHR` (TCAD export 21:01, Cedar Park 21:09:16.263, Leander 21:09:26) and `CAI` (BBB 21:08:55, Creedmoor 21:09:16.768). An edge code is not an exit address, so the exit address per request cannot be reconstructed.
- **Effect:** every request was made with the project User-Agent and one attempt each, with no automatic retry. But the egress was not the operator's own network, which R10 does not allow. Some sources were requested more than once, through a second run id and through `resolve … captured` rounds (FR-006f allows one more attempt per resolution, with the same identity; with the VPN on, the same identity cannot be confirmed).
- **Every contact with the GIS host** (`gis.traviscountytx.gov`), from the run journals and evidence files:

  | # | Time (UTC) | Run or command | How | Egress | Result |
  | --- | --- | --- | --- | --- | --- |
  | 1 | 2026-10-19 20:43:16 | run `travis`, first probe | count query | VPN on | no response |
  | 2 | 2026-10-19 21:08:45 | run `travis-2`, first probe (a new run id, so a second request) | count query | VPN on | no response (`tcad_gis-20261019T210845Z.md`) |
  | 3 | 2026-10-19 21:24:23 | run `travis-2`, `resolve tcad_gis captured` (attempt 1) | count query | VPN on | no response (`tcad_gis-20261019T212423Z.md`) |
  | 4 | 2026-10-20 05:33:44 | run `travis-2`, `resolve tcad_gis captured` (attempt 2) | count query | **not recorded** | no response (`tcad_gis-20261020T053344Z.md`) |
  | 5 | 2026-10-20 07:22:23 | operator retest at the PO's direction (D-3) | count query | VPN off, `EG` | timed out after 60 s (`tcad_gis-20261020T072223Z.md`) |
  | 6 | 2026-10-20 07:22–07:23 | operator check (D-3) | TCP connect test (`nc -z`, no HTTP) | VPN off, `EG` | no connection |
  | 7 | 2026-10-20 07:31:05 | US GitHub Actions runner (D-2) | count query | US | HTTP 200, `{"count":373683}` |

  Run `travis-2` then recorded `tcad_gis` as `still-blocked` (attempt 3, 2026-10-20T05:43:09Z). Contacts 1 to 4 each made one HTTP request; their evidence files' sentence "No retry with a changed identity was made" is qualified by this record.
- **Limit of the new guard:** it compares the egress **country** only, so a VPN or hotspot exit in the same country would pass. `discover` checks the country only when `ORACLE_EXPECT_EGRESS` is set (finding N3).
- **Decision:** recorded as a deviation. From 2026-10-20 every request-sending command checks and records the egress country first and refuses on a mismatch (finding OR-B1 in `docs/reviews/CR-A-01.md`). No 2026-10-19 result is relied on where a later request from the operator's own network exists.

## D-2. One US-runner count request for the county GIS layer (approved)

- **Evidence:** from the operator's own network (VPN off, egress `EG`), the GIS host `gis.traviscountytx.gov` resolves but never accepts a TCP connection, while `www.traviscountytx.gov` on the same domain answers HTTP 200 in about 1 s (`docs/evidence/blocked/tcad_gis-20261020T072223Z.md`).
- **Rule change:** FR-006b required a geo signal in the source's own response. The PO accepted the pattern above (no TCP connection from non-US egress while a sibling host on the same domain answers) as **suspected** geo evidence for one count request from a US GitHub Actions runner. FR-006b and AC-6 are amended with this clause.
- **What was done:** one identified request, same URL and User-Agent, no retry: HTTP 200, `{"count":373683}` ([run 39387019700](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/actions/runs/39387019700); body and SHA-256 kept in `docs/evidence/A-01-us-gis-runner.md`, the lasting record, since the run's artifact expires after 30 days). The workflow is disabled so it cannot fire again.
- **Not decided here:** paging GIS coordinates from a US runner in A-05 adds an execution venue (ARD rule 10); that needs its own decision in A-05.

## D-3. BBB and GIS were requested again from a different network (deviation)

- **What happened:** on 2026-10-20, at the PO's direction, two blocked sources were requested once more from the operator's own network (VPN off), after their 2026-10-19 attempts had gone through the VPN:
  - GIS count query at 07:22:23Z: timed out again (TCP connect never completed).
  - BBB at 07:23:23Z: the same Cloudflare challenge (HTTP 403, `cf-mitigated: challenge`). Nothing was solved or bypassed.
  - San Leanna's evidence page at 08:53:13Z (`reprobe-jurisdictions`): HTTP 406 again. Its body says the request was blocked by Mod Security, the site's web application firewall, so it was a block, not the content-negotiation refusal the run first assumed (finding OR-M2). The other three re-probes that day (Austin network error, Bee Cave and Rollingwood 404) were not blocks under FR-006.
- **Rules broken:** FR-006 counts a timeout as `blocked`, and FR-006a forbids retrying a blocked source with a changed network address. For BBB, AC-6 and FR-006a also say a challenge is never retried. FR-006f allows one more attempt only with the same identity. The earlier evidence text "no retry with a changed identity was made" was wrong for both requests and has been corrected.
- **Why it happened:** for GIS and BBB, the PO wanted to know whether the VPN caused the blocks. It did not: both answered the same way from the operator's own network. For San Leanna, the 406 was misread as a request-format problem; the re-probe command now treats a firewall-block body as a block and refuses it.
- **Decision:** recorded as a deviation. No further BBB or GIS requests from the operator machine in A-01; BBB stays `blocked`, and GIS was counted through D-2.

## D-4. No records requests or API applications are filed

- **Decision:** the PO files no records request, Public Information Act request or API application (including the BBB API) in this project. Every blocked or records-request row says why, what was tried, and what would unblock it, with "not filed (PO decision 2026-10-20)". The `records_request` blocks stay as documentation of the lawful route, as the validator requires.
- **Reason:** the PO will discuss these limits with the evaluator rather than do official work outside the build.

## D-5. The superseded durable run `travis` was killed

- Run `travis` (2026-10-19T20:40Z) was replaced by `travis-2`, which wrote the catalog. `travis` stayed suspended in `WAITING_HUMAN`, and `resolve` targeted it by default, so one `resolve` would have rewritten the catalog from its 2026-10-19 journal (finding CR-3 / OR-M1).
- A cancel (2026-10-20T14:14:47Z) could not complete: the code had changed since the run started, so its journal no longer replayed ("journal mismatch"). It was killed through the local Restate admin API at 2026-10-20T14:15:06Z (`[409] killed`). The catalog was unchanged (SHA-256 `31ea8fab…`). Run `travis-2` is completed.
