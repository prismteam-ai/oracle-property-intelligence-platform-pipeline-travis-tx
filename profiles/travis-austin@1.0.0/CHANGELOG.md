# Changelog: travis-austin profile

Every change to `rules.json` needs a new version (directory, `package.json`, `rules.json`), a new `DIGEST` and an entry here. `expectations.json` is outside the digest, so re-measuring does not change the version.

## 1.0.0 (2026-10-21)

- sha256: `c8fd15cf8deb654c2959d7cca3b05560bc9830de2518c56a092bd87bdf53dfa6`
- Story A-02 (FR-003, FR-004, FR-005; AD-08, AD-26).
- Include (description, case-insensitive substring, same as SoQL `upper(x) like '%T%'`): REROOF, RE-ROOF, ROOF REPLACE.
- Token-aware excludes, with reason ids: `aux_power` (work class Auxiliary Power), `solar_pv` (PVC is not PV), `rtu` (OPPORTUNITY is not RTU), `roof_mounted`, `roof_deck` (a rooftop deck only; roof decking and the structural deck under a reroof are not excluded).
- Trade sub-permits: only BP can be Roofing (PO decision D-4b).
- needs_review: work class Roof with no include term, and any unmapped status word.
- Precedence: exclude > trade permit > include > needs_review.
- Status map per AD-08; `Cancelled*` by prefix. Expired and Expired - License → `stalled`, published `improvement_status` null (PO decision D-4a). Exclude and needs_review are never emitted.
