---
id: DEC-A-04-gis-runner
type: decision
story: A-04
title: "Page the Travis County GIS parcel layer from a GitHub-hosted US runner (Round 1 D-2)"
status: "Approved by the PO (HebaGaber) on 2026-10-21 (Round 1 D-2 and D-13: \"US GitHub runner, 2 pushes (Recommended)\")"
created: 2026-10-22
---

# GIS paging runs on a US GitHub runner (A-04)

## Decision

The operator machine never connects to the Travis County GIS host (geo block; `docs/evidence/A-01-us-gis-runner.md`, DEC-A-01-source-access D-3). A-04 therefore pages the parcel layer `TCAD.TC_USER.TCAD_PARCELS` (`https://gis.traviscountytx.gov/server1/rest/services/CIPStoryMap/Main_Location_Map2/MapServer/6`) from a **new fetch-only workflow on a GitHub-hosted US runner** (`.github/workflows/a04-gis-capture.yml`), as A-01's probe did.

## Conditions (PO answer, word for word, and how each was met)

| Condition | Met by |
| --- | --- |
| Fetch-only workflow on a GitHub-hosted US runner | `runs-on: ubuntu-latest`; no transform, no Query DB, no publish |
| Triggered by a push to `004-property-backbone` with a `paths` filter | `on.push.branches: [004-property-backbone]`, `paths`: the workflow file and `pipeline/oracle-runtime/travis/gis/runner-config.json`; no manual dispatch |
| `contents: read`, no secrets | `permissions: contents: read`; no secret referenced |
| Egress country logged | every run writes `egress.txt` (`loc=US`; also a Cloudflare `colo=` line) |
| Raw pages as an artifact | uploaded artifact `a04-gis-capture`, 7-day retention; downloaded with `gh run download` into `pipeline/data/raw/gis/us-runner-<run id>` (gitignored) |
| Never touches the Query DB | no database client in the workflow or the fetch script (grep gate) |
| Disabled afterwards | the config flag `"enabled": false` (the workflow's `gate` job then skips `capture`); set on 2026-10-22 after the full capture |
| Two pushes: pilot, then full | `mode: "pilot"` then `mode: "full"` in `runner-config.json` |

Added because the fork is public (artifacts are downloadable by any signed-in GitHub user): **minimal `outFields`** only (`OBJECTID`, `PROP_ID`, `geo_id`), never owner or address columns (guard `PRIVATE_FIELD` in `runner-fetch.ts`).

## Runs

| Run | Commit | Mode | Result |
| --- | --- | --- | --- |
| 39682166613 | `8a022bd` | pilot | metadata, count (373,683) and ids fine; first geometry page (2,000 ids in the URL, ~14 KB) answered HTTP 200 with a non-JSON body: failed. Cause found: URL length. |
| 39683448743 | `4a4910c` | pilot | success after the fix (ids sent as a POST form body): 2,000 features in 6 s |
| 39684063596 | `29e9767` | full | success: 187 pages, 373,683 features = source count, 81.6 s, concurrency 2, loc=US, 192 receipts (191 ok/200 + 1 checkpoint skip), `complete.json` present, snapshot sha256 `1a2fb451f9ad9d137d2b00912d45e59103403f9a86be510bd021dc38d91b18a6`, pages-tree sha256 `c8f19758c61799da625f89eb175349767405fba6b17b903d51c1d2052a2eb074` |
| 39685884714 | `c473a83` | full | success (a repeat capture: a later edit of the workflow file matched the path filter); the `enabled` gate was added to prevent repeats |

No 403, challenge or throttling was seen. Repository: `HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx` (the fork).
