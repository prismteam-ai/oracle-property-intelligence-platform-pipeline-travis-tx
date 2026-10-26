# Estimator contract: Track D roof age

The kit's `roof-age/estimator.ts` is invoked unmodified (vendored, kit 0.99.1) — never reimplemented in SQL or a view.

## Invocation

```
roof-age:audit    --limit 25 --offset 0 --as-of-date 2026-10-22 --source-system travis-austin-permits --report pipeline/data/roof-age/travis/<jobId>/audit.json
roof-age:backfill --as-of-date 2026-10-22 --source-system travis-austin-permits --report pipeline/data/roof-age/travis/<jobId>/apply.json [--apply]
```

## Basis/confidence derivation (frozen, ADR-0002 #7)

| Basis | Confidence | Trigger |
| --- | --- | --- |
| `permit` | `high` | latest **final** replacement/reroof permit (an open permit never qualifies, FR-015) |
| `new_construction` | `medium` | new-construction permit, no later replacement |
| `built_year` | `low` | TCAD built year only, no qualifying permit |
| `unknown` | `none` | neither — `roof_age_years` is `null`, excluded from "roof > 15" results, counted in the coverage gap |

## Sequence (must run in this order)

1. **Audit** (`--limit 25`, dry run) → human review (D-21).
2. **Apply the 25** (`--apply`, same flags) → **re-run the same 25** → must print `rowsWritten: 0`.
3. **Widen to the full roll**: audit (no `--limit`) → apply → re-run, same `rowsWritten: 0` requirement (SC-005).
4. **Worked example** for one property (`0223120506`, substituting the original anchor `0208011301` which has no 2026 TCAD account): every source record (TCAD row, each permit including the open 1982 one) with URL, capture time, digest, then the chosen anchor, basis, confidence and profile digest.

## View comparison (Track D3)

`packages/query-core`'s view-derived basis/confidence/age for the same 25 properties at the same `as-of-date` must match the estimator's output 25/25 (NFR-004/SC-006) before any apply is approved.
