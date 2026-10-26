---
id: CONTRACT-A-04-REPORT
type: contract
parent: PLAN-A-04
created: 2026-10-21
---

# Contract: `backbone report --job <jobId> --json`

`--job` is the TCAD job (pilot or `ingest`). The `coordinates` / `gis` sections use the latest complete `coords` job run after it, and the `permits` / `jurisdictions` sections the latest complete `permits` backfill/incremental and `--link` jobs; each section prints the `job_id`s it used (`source_jobs`). Counts, digests, URLs and timestamps only; never an owner name, mailing line or payload. Zod schema `BackboneReportV1` in `pipeline/local-stack/services/report.ts`; each section is built by its group's `report-sections/<key>.ts`.

```jsonc
{
  "job_id": "travis-a04-…", "as_of": "2026-10-22", "code_sha": "…",
  "roll": { "n": 493246, "by_prop_type": {"R":441961,"P":39536,"MH":11744,"MN":5}, "loaded": 0, "dead": 0, "invalid": 0, "transform_failure": 0,
            "difference": 0, "difference_pct": 0, "unexplained": 0, "export_sha256": "6f7a…", "key_inventory_sha256": "…" },          // G-TCAD
  "confidentiality": { "redacted": 15410, "rule": "sales_confidential_code" },                                                          // G-TCAD
  "coordinates": { "denominator_r": 441961, "with_point_r": 0, "coverage_r": 0.0, "non_land_account": 51285,
                   "by_source": {"gis_centroid":0,"permit_point":0,"none":0}, "by_rule": {}, "gap_by_reason": {},
                   "condo_building_point": {"accounts":0,"buildings":0,"rule":"condo_building_point"},
                   "multi_feature": {"pids":0,"extra_features":0,"rule":"largest_area"},
                   "gis_features_without_roll_account": 0, "permit_far_from_gis": 0, "interior_point": 0,
                   "gis_feature_count": 373683, "roll_count": 493246, "gis_minus_roll": -119563, "gap_pct": 24.24,
                   "anchors": [{"geo_id":"0223120506","request_identifier":"221829","on_roll":true,"coordinate_source":"gis_centroid"},
                               {"geo_id":"0208011301","request_identifier":null,"on_roll":false,"coordinate_source":null}] },             // G-GIS
  "gis": { "artifact_run_id": "…", "pages": 0, "duration_s": 0, "features_per_s": 0, "layer_last_edit_date": "…", "complete": true },     // G-GIS
  "permits": { "source_total_at_watermark": 0, "captured_at_watermark": 0, "above_watermark": 0, "watermark": "…",
               "outside_travis": 0, "reroof_candidates": 0, "linked": 0, "link_rate": 0.0, "unmatched_by_reason": {},
               "status_class_vs_baseline": {"open":{"run":0,"baseline":129},"stalled":{"run":0,"baseline":2213},"closed":{"run":0,"baseline":17251},"exclude":{"run":0,"baseline":2491}},
               "restamp": {"detected": false, "rows_written": 0}, "tombstones": 0, "profile_sha256": "c8fd15cf…",
               "throughput": {"pages":0,"duration_s":0,"rows_per_s":0} },                                                                  // G-PERMITS
  "jurisdictions": { "supported": [{"key":"austin","captured":0,"source_total":0,"captured_at":"…"}],
                     "absent": [{"key":"lakeway","name":"Lakeway","class":"records_request","evidence_url":"…","own_permits_captured":false,"austin_issued_located_here":6827}] }, // G-PERMITS
  "limitations": ["Confidential owner records redacted (Texas Tax Code §25.025): 15410",
                  "source export carries no §25.025 marker; conservative suppression on sale-confidentiality codes",
                  "source bulk re-stamp; delta by content digest",
                  "Lakeway: no public permit history captured (records request, not filed); evidence https://…",
                  "gis: blocked at 2026-10-22T03:00:00Z; coverage not complete"],
  "limitation_jobs": [{"job_id": "<job that stored the limitation>", "text": "<same string as in limitations[]>"}]   // added in the 2026-10-22 fix pass: limitations[] stays plain strings, this keeps each ones job id
}
```

Values shown are placeholders for shape only; every number in evidence comes from a real run.
