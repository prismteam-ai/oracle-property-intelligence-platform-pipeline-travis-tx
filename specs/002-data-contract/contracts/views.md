# Contract: the four views (`contract/v1`)

**Consumers:** Task B (CRM), A-13 (SQL panel), A-14 (agent tools), A-15 (MCP `get_schema`).

- **Views:** `v_property`, `v_roofing_permit`, `v_contractor`, `v_run`, defined in `packages/query-core/views.sql`.
- **Columns:** exactly [data-model.md](../data-model.md) § Views (mew § B.2 to B.6 with the D-4 adjustments). The source of truth is `packages/contract/src/columns.ts`, published as `contract/v1/columns.json`.
- **Binding:** `bindManifest(manifest, tablesDir)` creates the views over one manifest's `export-tables` output: the county tables for property, the property_improvement tables for permits. `as_of` = `finishedAt`.
- **Guarantees:**
  - Every row has non-null `cid`, `table`, `table_cid`, `run_id`, `manifest_cid` and `as_of`.
  - Every empty value has a `missing {field, reason}` entry from the closed reason enum.
  - No text matching in the SQL.
- **Change rule:** adding a column or an enum member is additive (v1). A rename, retype or change of meaning requires `contract/v2`.
- **Test:** `DESCRIBE` each view equals `columns.ts` (names, order, types). The Zod row schemas parse 100% of pilot rows.
