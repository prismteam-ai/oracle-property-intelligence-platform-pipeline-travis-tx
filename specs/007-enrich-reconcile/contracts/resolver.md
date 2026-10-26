# Resolver contract: Track A five-state verdict

Input: one Austin reroof permit row (printed contractor name, permit metadata) + the loaded Comptroller registry snapshot.

Output: one `Contractor resolution ledger row` (data-model.md), append-only.

## Decision order (must short-circuit in this order — never fall through to a name match)

1. No printed name → `unresolved`, reason `contractor_not_printed`. Stop.
2. Registry not loaded / unreachable → `unresolved`, reason `registry_unavailable`. Stop.
3. An official identifier crosswalk match exists (none found this run, D-10) → `resolved`, write the company record. Stop.
4. Printed name, normalised (versioned rule), matches exactly one **active** Travis legal name → `candidate`. No company record.
5. Printed name matches two or more active legal names → `ambiguous`. No company record; all candidates kept in the ledger.
6. Printed name matches a legal name whose `sos_status_code` is not active → `conflicting`, status shown. No company record.
7. No match → `unresolved`, no reason code beyond "no match" (distinct from steps 1–2).

## Invariants

- The five-state totals over all permits sum exactly to the permit total (SC-001).
- A `resolved` row always cites `matchRule`, `resolverVersion`, `registrySnapshotDigest`, and both source URLs.
- A BBB, Overture, or places name match never changes a state (FR-014; identity is Track A only).
- Abbreviation/punctuation normalisation ("Roofing Co." vs "ROOFING COMPANY") changes nothing about the state boundary between `candidate` and `resolved` — only an identifier crosswalk can produce `resolved`.
