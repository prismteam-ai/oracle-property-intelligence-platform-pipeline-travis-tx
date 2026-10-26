---
id: ERR-69
type: defect
feature: FEAT-A11
story: A-11
test_case: Task B validation of published Run 2 (owner columns); unit pins in oracle-runtime test/transforms/owner-name.test.ts and test/transforms/tcad-county.test.ts
ac_reference: A-11
severity: High
status: Closed 2026-10-25: re-tested on Run 3 (manifest bafkreifndsdibdllvgpzwmif6getzwvc6rupk5tgeak4eypccaw3t7vlfm): owner named for 409,389 of 441,961 properties (92.6%, Run 2: 23,556); specs/011-publish-and-runs/run3/run3-evidence.json
found_by: Task B validation of published Run 2, for HebaGaber
found_date: 2026-10-25
fix_branch: 011-publish-and-runs
fix_commit: pending (the lead commits after CI)
retest_date: pending
closed_date: pending
---

# ERR-69: Most individual owners are counted `owner_unparsed` and never published

## Brief description

In the published Run 2, only about 13% of properties with a dated sale have a published owner. TCAD prints an individual as `LAST FIRST [MIDDLE] [& OTHER]` and leaves `firstName` / `lastName` null for almost every entry. The County transform wrote a person only when both fields were set, and a company only when an entity word matched, so everything else was `owner_unparsed` and dropped. Owners of properties with no dated sale were never written at all, because the only link to an owner was `sales_history_has_person` / `sales_history_has_company` on the latest dated sale.

## Related requirement

- **Story:** A-11 · **Rules:** P0-15 (Texas section 25.025 confidential owners stay suppressed, unchanged), "a wrong person name is worse than an unparsed one", no invented data

## Impact and severity

- **Severity:** High. `owner_name`, `owner_kind` and the owner mailing area are headline columns of the Properties view; about 87% of dated-sale properties showed "owner not parsed".

## Resolution

| Field | Value |
| --- | --- |
| Root cause | `transformTcadCounty()` (pipeline/oracle-runtime/travis/transforms/tcad-county.ts) trusted only the explicit `firstName` / `lastName` fields (289 of 59,976 owners in the first 60,000 export records) and `ENTITY_NAME`. The printed `name` was never read as a person. Owners were linked to the property only through the latest dated sale. |
| Fix | New pure reader `parseOwner()` (travis/transforms/owner-name.ts). Order: entity word in the name gives a company (name as printed); explicit TCAD first/last gives one person (as before); a trust tail on `nameSecondary` ("REVOCABLE" + "TRUST") or an organisation continuation gives a company; otherwise `LAST FIRST [MIDDLE...] [JR/SR/II/III/IV]` gives a person. `A & B` and `A &` + `nameSecondary` give two people (second party read in natural order; one token or a middle initial shares the first party's surname). Trailing `ET AL` / `ETAL` / `ET UX` / `ET VIR` are dropped. Everything uncertain stays unparsed: single tokens, digits, slashes, `C/O`, estates, life estates, heirs, a particle (`DE`, `LA`, `VAN`, `LE`...) at token 1 or 2, a trailing `LE` with 3+ tokens, a one-letter first name, 5+ tokens, three-way `A & B & C`, organisation lookalike words (`SERVICES`, `PLUMBING`, `COUNTY`...), a double-surname hint (`DULANEY RADOMSKI DIANA D`). A co-owner that cannot be read is skipped and counted (`owners_co_owner_skipped`); the first-named owner is kept. `person_has_property` / `company_has_property` now link every written owner to the property, so an owner no longer depends on the latest dated sale (the sales links are still written when a dated sale exists). `ENTITY_NAME` also matches the spaced forms `L L C`, `P L L C`, `L L P`; an entity word in the name now wins over explicit first/last (a trust with a trustee contact is a company, not the contact as person). The Texas confidential rule is untouched: a confidential record never reaches the reader. |
| Tallies | `counts.persons_written`, `companies_written`, `owners_unparsed`, `owners_co_owner_skipped` per property; `writeGroup` sums them into `owners`. |
| How it escaped | The earlier test pinned "does not guess a person from an unsplit name" with the explicit fields absent, so the safe choice (write nothing) was frozen as the expected behaviour, and no test measured the share of owners published on real export data. |
| Tests that pin it | oracle-runtime `test/transforms/owner-name.test.ts` (62 rows: LAST FIRST M, suffixes, joint names, `&` with `nameSecondary`, hyphen, apostrophe, `ET AL`, trust tails, and about 20 must-stay-unparsed strings; every written name matches the lexicon person patterns); `test/transforms/tcad-county.test.ts` (person from an unsplit name, single token unparsed, property edges, no-dated-sale owner is linked to the property only); local-stack `test/write-group-pids.test.ts` (owner tally). `elephant-cli validate`, `hash` and `export-tables` of a three-property sample group pass and emit `person`, `person_has_property`, `company_has_property` tables. |
| Measured on the first 59,976 owners of the real export (read-only) | Before: person 288, company 10,205, unparsed 49,483. After: person entries 46,272 (71,774 people), company 11,250, unparsed 2,454; 2,427 entries with a skipped co-owner. Properties with a dated sale and a published owner: 5,054 of 33,199 (15.2%) before, 32,058 (96.6%) after. 71,774 of 71,774 written names match the lexicon person patterns. |
| Residual risk | A two-word business name that is not an entity word and not on the lookalike list (for example a surname-like word plus `PIZZA`) can still read as a person; the list is a conservative filter, not proof. The reader never sees a redacted owner. |
| Not carried | The owner mailing ZIP is still not in the published tables (`export-tables` does not emit the `oneOf` `address` properties), so the owner area stays unknown with its explicit reason. Spouse names, the care-of party in `nameSecondary`, `ownerPct`, and mailing coordinates have no exporting lexicon carrier. Exemptions are not written: see the report of this fix. |
| View change (integration) | `v_property` now reads owners through `person_has_property` / `company_has_property` (packages/query-core/views.sql, CTEs `person_link` / `company_link`), and `owner_mailing` follows the same links. `owner_name` no longer carries `no_dated_sale`; a property without an owner lists the run's owner gap reason (`owner_unparsed`, `owner_confidential`, `no_owner_record`, `needs_review`). `no_dated_sale` stays a tenure reason. A run written before Run 3 has no property edges, so its owners are still the persons and companies of the latest dated sale (the same rows keep reading; the two sources are unioned and de-duplicated). The macro `owner_missing_reason` and `ownerMissingReason()` are removed. The County transform now counts a property whose owners could not be written as `unparsed` even without a dated sale (the view relies on that count). |
| Switch: individuals' names | PO decision on publishing individuals' names county-wide is **pending**. `OWNER_PERSONS=publish\|omit` (environment variable, default `publish`; `ownerPersonsMode()` in owner-name.ts, input `ownerPersons` of `transformTcadCounty`) leaves every person and their mailing address out without a code change; companies are unaffected. A typo throws. Omitted individuals are counted in `persons_omitted`; a property whose only owners were omitted is tallied as `suppressed`, so the view shows `owner_confidential` (withheld) until a dedicated reason exists. |
| Re-test | Pending: needs a full County re-write, new CARs and a Run 3 manifest (PO approval for the publish). |
| Status | Closed in Run 3: owner named for 409,389 of 441,961 (92.6%). |
