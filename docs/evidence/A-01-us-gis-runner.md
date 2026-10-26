---
id: EV-A-01-us-gis-runner
parent: A-01
subject: source:tcad_gis
captured_at: 2026-10-20T07:31:05Z
url: https://gis.traviscountytx.gov/server1/rest/services/CIPStoryMap/Main_Location_Map2/MapServer/6/query?where=1%3D1&returnCountOnly=true&f=json
method: GET
attempts: 1
user_agent: oracle-travis-discovery/0.1 (PrismTeam Oracle Travis County pipeline; +https://github.com/prismteam-ai/oracle-property-intelligence-platform-pipeline-travis-tx)
run_url: https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/actions/runs/39387019700
egress_loc: US
egress_colo: MSP
http_status: 200
time_seconds: 0.579933
body_bytes: 16
body_sha256: 751ea63e3a6565108c8af9faa18aedf81990818d913a97002fcd8887aa160b6f
count: 373683
---

# Evidence: Travis County GIS count from a US GitHub Actions runner

The Travis County GIS parcel layer never answers from the operator machine (egress EG, TCP connect never completes; [operator evidence](blocked/tcad_gis-20261020T072223Z.md)). The PO approved ONE identified count request from a US GitHub Actions runner on 2026-10-20 (ARD § 8, A-01 AC-6). Workflow `.github/workflows/a01-us-gis-probe.yml` made it once, with the same URL and project User-Agent as the discovery probe, no retry and no identity change.

| Item | Value |
| --- | --- |
| Run | https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/actions/runs/39387019700 |
| Runner egress (Cloudflare trace) | `loc=US`, `colo=MSP` |
| URL | https://gis.traviscountytx.gov/server1/rest/services/CIPStoryMap/Main_Location_Map2/MapServer/6/query?where=1%3D1&returnCountOnly=true&f=json |
| User-Agent | `oracle-travis-discovery/0.1 (PrismTeam Oracle Travis County pipeline; +https://github.com/prismteam-ai/oracle-property-intelligence-platform-pipeline-travis-tx)` |
| Captured at (UTC) | 2026-10-20T07:31:05Z |
| HTTP status | 200 |
| Time | 0.579933 s |
| Body | 16 bytes, SHA-256 `751ea63e3a6565108c8af9faa18aedf81990818d913a97002fcd8887aa160b6f` |
| GIS feature count | 373,683 |

Recorded into `pipeline/docs/travis-sources.yaml` by `npm --prefix pipeline/oracle-runtime run record-gis-runner` as `parcel.gis_feature_count_measurement` (method `returnCountOnly`). The certified roll stays the canonical denominator; GIS is never substituted for it.

## Body

```json
{"count":373683}
```

## Response headers

Safe headers only: cookie, auth and token-bearing headers are dropped (`safeHeaders`).

| Header | Value |
| --- | --- |
| `cache-control` | must-revalidate,max-age=0,public |
| `content-length` | 16 |
| `content-type` | application/json; charset=UTF-8 |
| `etag` | "1761106816" |
| `vary` | Origin |
| `x-content-type-options` | nosniff |
| `date` | Tue, 20 Oct 2026 07:31:05 GMT |

The raw artifact stays gitignored at `pipeline/data/raw/gis/us-runner-39387019700/`.
