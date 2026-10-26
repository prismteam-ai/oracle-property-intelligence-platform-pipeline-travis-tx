# Contract: `travis-austin@1.0.0` profile

**Exports:** `classifyPermit(row) → {roofing: 'roofing'|'not_roofing'|'needs_review', reason, improvement_type, improvement_action}` · `classifyStatus(word) → {class: open|stalled|closed|exclude|needs_review, improvement_status|null}` · `digest()` · `toSoqlInclude()` · `toSqlStatusMap()` · `PROFILE = {name, version, sha256}`.

**Inputs:** an Austin `3syk-w9eu` row (`permit_number`, `permittype`, `work_class`, `status_current`, `description`), validated by Zod.

**Guarantees:**
- Expired is never relabelled.
- An unknown word → `needs_review`.
- Exclude > trade permit > include.
- Every result carries `PROFILE.sha256`.
