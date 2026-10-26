# Vendored kit files

These files are copied **unmodified** from the soofi-xyz-team-kit. Do not edit them here.
To update, copy the new kit version over them and refresh every hash below.
`travis/discovery/run-validator.ts` checks the validator hash against this table before running it.

- Kit: `soofi-xyz-team-kit`
- Kit version: `0.99.1`
- Source root: `skills/use-oracle/` in the kit (plugin cache path `soofi-xyz/soofi-xyz-team-kit/0.99.1/skills/use-oracle/`)
- Vendored on: 2026-10-19 (story A-01, task T003)
- Self-test: `python3 pipeline/oracle-runtime/kit/use-oracle/scripts/validate-county-readiness.py --self-test` prints `readiness self-test passed` and exits 0

| Vendored path (under `pipeline/oracle-runtime/kit/`) | Kit source path | SHA-256 |
| --- | --- | --- |
| `use-oracle/scripts/validate-county-readiness.py` | `skills/use-oracle/scripts/validate-county-readiness.py` | `5c5b85159371184d24b929e4fd9610ed0373399a9b890715b0683ef8929abb3d` |
| `use-oracle/fixtures/readiness/advertised-listing-count-is-not-harvestable.yaml` | `skills/use-oracle/fixtures/readiness/advertised-listing-count-is-not-harvestable.yaml` | `3b722a6ef7425e159e5d33aa9fd09ac440b3d02fc7368cf63ad5dee6f42dc50d` |
| `use-oracle/fixtures/readiness/blocked-without-request-route.yaml` | `skills/use-oracle/fixtures/readiness/blocked-without-request-route.yaml` | `35300a4ee12fada7b33ac37cd004adcf336bf11744d6313efbe5207012a9e20c` |
| `use-oracle/fixtures/readiness/material-gis-assessed-discrepancy.yaml` | `skills/use-oracle/fixtures/readiness/material-gis-assessed-discrepancy.yaml` | `d0ac16c415db89756bcda38f2f5cf11e5851a4430acaebb875517eca49d372b7` |
| `use-oracle/fixtures/readiness/ready-minimal.yaml` | `skills/use-oracle/fixtures/readiness/ready-minimal.yaml` | `76ee71f4892d1f5bf4c3e63a995c24b8cea2b9f3eec3b5bcb90c0b9044140f72` |
| `use-oracle/fixtures/readiness/unclassified-permit-jurisdiction.yaml` | `skills/use-oracle/fixtures/readiness/unclassified-permit-jurisdiction.yaml` | `58d4be7e7d078f4fdbe5f0e46c2d0b9153a43cbd8a2b42ad3a9ec2562c4a3347` |
| `use-oracle/fixtures/readiness/unified-portal-not-municipal-history.yaml` | `skills/use-oracle/fixtures/readiness/unified-portal-not-municipal-history.yaml` | `f36d7b38a9118f3fbc79cf620da3b04b809e156a7ec84a65ae34c473edf0c431` |
| `use-oracle/runtime/src/roof-age/estimator.ts` | `skills/use-oracle/runtime/src/roof-age/estimator.ts` | `919b8bd69ae56afb20c10dfcec45bd4ed825eced0cdfdd74d661a8a54da58051` |

## A-04 additions (story A-04, task T006, vendored 2026-10-21, kit version `0.99.1`)

Copied unmodified from `soofi-xyz/soofi-xyz-team-kit/0.99.1/skills/use-oracle/runtime/src/` (the ArcGIS feature-service permit adapter, every module it imports, and the `address:v1` signature). `backfill-inputs.mjs` requires `@dsnp/parquetjs`, added to `package.json`. `test/kit/vendored-a04.test.ts` re-hashes each file against this table.

| Vendored path (under `pipeline/oracle-runtime/kit/`) | Kit source path | SHA-256 |
| --- | --- | --- |
| `use-oracle/runtime/src/permits/adapters/arcgis-feature-service.mjs` | `skills/use-oracle/runtime/src/permits/adapters/arcgis-feature-service.mjs` | `409b03de4cd3df718c67362532ea85216c622f2525a909d0117797f457c32ef5` |
| `use-oracle/runtime/src/permits/contracts.mjs` | `skills/use-oracle/runtime/src/permits/contracts.mjs` | `51aded9716cd453d969f2ae61d8982c75baa84db03daf1e2467b4b2c32c58990` |
| `use-oracle/runtime/src/permits/backfill-inputs.mjs` | `skills/use-oracle/runtime/src/permits/backfill-inputs.mjs` | `55de5477ab946729efdce005b47a0b32a7cc7bc7b09b997c0f0fcd7102d18083` |
| `use-oracle/runtime/src/permits/normalization.mjs` | `skills/use-oracle/runtime/src/permits/normalization.mjs` | `3cc7c2f39b5fa0de4059342ddc527abe98133a41ffb9110b3fcbdf46be33b8c6` |
| `use-oracle/runtime/src/permits/http.mjs` | `skills/use-oracle/runtime/src/permits/http.mjs` | `7c302d48051e194838e8b3efec05076442a207016500ad558d8b2e04b8e49031` |
| `use-oracle/runtime/src/permits/errors.mjs` | `skills/use-oracle/runtime/src/permits/errors.mjs` | `2d05b6159cb2330eb6e9e4e796c39e251bcc0ee9360771fadc6908392d311161` |
| `use-oracle/runtime/src/core/address-signature.mjs` | `skills/use-oracle/runtime/src/core/address-signature.mjs` | `bd0bcdf2724230d34b81967a95621699e8ec8a574e023f6db7833fe755cddedf` |

## Seams used in A-04

The vendored files are used only through their documented options, never edited:

- `createArcgisFeatureServiceAdapter(jurisdiction, options)`: the injected `options.client` replaces the kit `PermitHttpClient`, so every GIS request goes through `travis/lib/source-client.ts` (one User-Agent, `HOST_POLICY`, StopOnBlocked).
- `enumerateAll({ loadPageCheckpoint, onPage })`: `loadPageCheckpoint` resumes from saved pages; `onPage` writes each page artifact. The adapter's Broward-shaped `records` in the `onPage` payload are ignored; A-04 keeps only IDs and geometry from the raw features.
- `core/address-signature.mjs`: `mintSitusAddressIdentity` for the `address:v1` signature (no ROAD→RD or NORTH→N expansion).
