# Report contract: manifest `coverage` contributions (AD-28)

Each track hands one or more rows of this shape to the A-03 manifest builder (`pipeline/publish/`). This story computes and hands off; it never writes the public manifest itself (A-11 publishes).

```json
{
  "metric": "contractor_five_state_totals",
  "value": { "resolved": 0, "candidate": 0, "ambiguous": 0, "conflicting": 0, "unresolved": 0 },
  "derivation": "aggregate_match",
  "limitation": null
}
```

## Required metrics, one row each

| Metric | Track | `derivation` | `limitation` example |
| --- | --- | --- | --- |
| `contractor_five_state_totals` | A | `aggregate_match` | — (sum must equal permit total) |
| `bbb_status_counts` + coverage % | B | `aggregate_match` | `"not computable: 0 resolved companies"` when resolved = 0 |
| `business_count` | C | `capture_receipt` | — |
| `places_count_by_category` | C | `published_rows` | `"Places: not loaded · licence_gate_failed"` if D-15 fails |
| `merge_counts` (per entity type) | D | `aggregate_match` | — |
| `roof_age_coverage` (by basis/confidence) | D | `aggregate_match` | — |

## Rules

- `derivation` is never omitted; a reviewer (`porygon`) checks every metric carries one.
- `limitation` is `null` only when nothing is missing; coverage % is never literally `0%` or `NaN` — it is the string above when there is no denominator.
- No metric here is itself published; A-11's manifest builder reads these plus capture receipts, never a direct Query DB read (AD-04).
