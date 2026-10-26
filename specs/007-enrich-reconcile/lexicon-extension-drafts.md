# Lexicon extension requests (drafted, not filed)

Drafted by the `mew` design agent during Stage 3's agent-design consult (A-07). **Not filed.** Per round R1's D-3/D-4 standing policy, A-07 never files anything outside the repo; filing these is a PO decision for a later story, at the PO's discretion (D-11, round R2: "keep as drafted-only").

These mirror ADR-0002's R4/R5 wording, tightened for this story's scope.

## 1. Texas Comptroller taxpayer number (new field on `company`)

- **Problem**: `company.name` carries the legal name, but there is no dedicated field for the Texas Comptroller's taxpayer number. Per AD-06, the number currently carries only as `request_identifier` + `source_http_request` on the matched record — a workable fallback, but not a first-class, queryable field.
- **Proposed change**: add a `taxpayer_number` (string) field to the `company` class, scoped to the County data group, alongside the existing `name` field.
- **Why**: a dedicated field would let future stories query and join on the taxpayer number directly, instead of parsing it out of a request/response pair every time.
- **Scope check**: this request covers only the Texas Comptroller's franchise-tax taxpayer number; it does not propose a field for the SOS file number, which currently uses the same fallback and is a separate, smaller gap (not requested here).

## 2. BBB rating / profile URL (new `business_rating` class)

- **Problem**: no lexicon carrier exists for a BBB rating or profile URL anywhere in the schema. `fact_sheet` (the closest existing class) has only `full_generation_command` and `ipfs_url` — no rating/grade field — and `company_has_fact_sheet` exists only in the County group, not Property Improvement.
- **Proposed change**: a new `business_rating` class with fields for the rating/grade value, the profile URL, the accreditation status, and the capture time; linked to `company` via a new edge (name TBD by the lexicon architect, e.g. `company_has_business_rating`).
- **Why**: without this, a BBB signal can never be published through the lexicon — every run falls back to `bbb_status = not_checked` / `no_lexicon_carrier` (AD-25), even when a rating was actually captured.
- **Scope check**: this request is for a rating/reputation class generically, not specific to BBB's exact schema — a future implementation should confirm field names against whichever reputation source is eventually integrated.

## Status

Both requests are **drafted only**. Neither has been filed with the lexicon architect or submitted as a PR. This file exists so the PO can review and file them in a later story if desired; A-07 takes no further action on them.
