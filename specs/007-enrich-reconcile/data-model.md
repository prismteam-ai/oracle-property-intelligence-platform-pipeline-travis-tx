# Phase 1 data model: A-07 enrich and reconcile

Entities below are internal Query DB rows (never published directly; the A-03 manifest builder reads CLI outputs and capture receipts to produce the public `coverage` counts, AD-04/AD-28). Field lists are the fields each track's independent test and the 19 ACs require; implementation may add bookkeeping columns, not fewer required ones.

## Contractor resolution ledger row (Track A)

One row per Austin reroof permit, append-only (a later resolution is a new row with a later `effectiveOn`, never an update in place).

| Field | Type | Notes |
| --- | --- | --- |
| `permitKey` | string | Austin permit identifier |
| `rawContractorName` | string \| null | as printed on the permit; null when `contractor_not_printed` |
| `state` | enum | `resolved` \| `candidate` \| `ambiguous` \| `conflicting` \| `unresolved` |
| `reasonCode` | string \| null | `contractor_not_printed`, `registry_unavailable`, or null for a positive match state |
| `matchedRecordIds` | string[] | Comptroller taxpayer number(s); 1 for `resolved`/`candidate`/`conflicting`, ≥2 for `ambiguous`, empty for `unresolved` |
| `matchRule` | string | normalisation rule name + semver |
| `resolverVersion` | string | semver of the resolver module |
| `registrySnapshotDigest` | string | sha256 of the Comptroller snapshot used |
| `effectiveOn` | timestamp | when this verdict was written |

**Validation**: exactly one of `reasonCode` set / `matchedRecordIds` non-empty holds per the state (never both empty with no reason). `state = resolved` requires an identifier crosswalk match, never a name-only match (FR-002).

## Company record (Track A)

Written only for `state = resolved`.

| Field | Type | Notes |
| --- | --- | --- |
| `taxpayerNumber` | string | Comptroller identifier, carried as `request_identifier` |
| `legalName` | string | |
| `sosStatusCode` | string | must be active for `resolved` |
| `sourceHttpRequest` | object | the captured request/response pair proving provenance (AD-06) |
| `propertyImprovementLink` | edge | `property_improvement_has_contractor`, written only here |

## BBB status record (Track B)

One per `resolved` company (expected count: 0 this run).

| Field | Type | Notes |
| --- | --- | --- |
| `companyId` | string | the resolved company's taxpayer number |
| `bbbStatus` | enum | `rated` \| `not_found` \| `blocked` \| `not_checked` |
| `reason` | string \| null | e.g. `http_403_source_block`, `robots_disallow`, `no_lexicon_carrier` |
| `evidence` | object | `{url, code, time, responseDigest}`; cites the two A-01 receipts when no new request was made |

**Validation**: never written for a `candidate`/`unresolved` contractor (FR-010).

## Business record (Track C, conditional)

One per Travis taxpayer in the Comptroller dataset, at the capture watermark.

| Field | Type | Notes |
| --- | --- | --- |
| `taxpayerNumber` | string | |
| `legalName` | string | |
| `mailingAddress` | string | |
| `sosFileNumber` | string | |
| `sourceUrl` | string | |
| `captureTime` | timestamp | |

**Validation**: loaded count == source count at the watermark (FR-011); if the source count changed during capture, both counts are stored in the receipt.

## Place record (Track C, conditional on D-15's licence gate)

| Field | Type | Notes |
| --- | --- | --- |
| `name` | string | |
| `category` | string | top-level Overture category |
| `address` | string \| null | |
| `phone` | string \| null | published only if D-17 approves |
| `website` | string \| null | |
| `overtureRelease` | string | pinned release id (`2026-09-23.0` per D-8) |

**Validation**: `expected_count` on the group is `null`, never `0`, when the release states no estimate (FR-012/013).

## Reconciled property/owner/contractor record (Track D)

Canonical, deduplicated, keyed by TCAD id (the only merge key, P0-5).

| Field | Type | Notes |
| --- | --- | --- |
| `tcadId` | string | fixed key; a merge spanning two TCAD ids is refused and counted (FR-018) |
| `entityType` | enum | `property` \| `owner` \| `contractor` |
| `inputRecords` | integer | count of source rows feeding this canonical entity |
| `canonicalId` | string | the merged, canonical identifier |

**Validation**: contractor-entity merges only exist where the underlying ledger state is `resolved`; with 0 `resolved`, 0 contractor merges is the correct, expected output (not a defect).

## Roof-age estimate (Track D)

One per reconciled property.

| Field | Type | Notes |
| --- | --- | --- |
| `tcadId` | string | |
| `roofAgeBasis` | enum | `permit` \| `new_construction` \| `built_year` \| `unknown` |
| `roofAgeConfidence` | enum | `high` \| `medium` \| `low` \| `none` |
| `roofAgeYears` | number \| null | null iff basis = `unknown` |
| `asOfDate` | date | `2026-10-22` per D-9, same value for both the estimator run and the view-derivation comparison |
| `sourceRecords` | object[] | every TCAD row / permit behind the estimate, with URL, capture time, digest (the worked-example shape for `0223120506`) |

**Validation**: an open replacement permit never resets roof age (FR-015); a re-run over the same scope writes `rowsWritten: 0` (FR-017/SC-005).

## Manifest coverage contribution (all tracks)

Not a stored entity — the shape each track hands to the A-03 manifest builder.

| Field | Type | Notes |
| --- | --- | --- |
| `metric` | string | e.g. `contractor_five_state_totals`, `bbb_status_counts`, `business_count`, `merge_counts`, `roof_age_coverage` |
| `value` | number \| object | the count(s) |
| `derivation` | enum | `published_rows` \| `capture_receipt` \| `aggregate_match` (AD-28) |
| `limitation` | string \| null | e.g. "not computable: 0 resolved companies", "Places: not loaded · {reason}" |
