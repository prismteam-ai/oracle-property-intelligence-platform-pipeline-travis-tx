# Contract: `travis-places@1.0.0` gazetteer

**Exports:**
- `lookup(query: string) → Found | OutOfScope`, as defined in [data-model.md](../data-model.md).
- `GAZETTEER = {version, sha256}`.
- `ownerArea(zip) → in_county|regional|out_of_area|unknown`, with a reason.

**Lookup behaviour:**
- The query is case-insensitive.
- An LSAD suffix ("city", "town", "village", "CDP") is optional.
- A 5-digit query is treated as a ZCTA.
- Outside Travis → `out_of_scope`, never a point.
