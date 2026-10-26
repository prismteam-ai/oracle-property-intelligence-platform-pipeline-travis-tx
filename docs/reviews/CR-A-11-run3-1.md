# CR-A-11 — Run 3.1 corrections (ERR-72, ERR-73, ERR-74): reviewer scores and /code-review

Reviewers (story front matter `agents.reviewers`): oracle (two rounds), donphan, machamp, porygon, all read-only; plus `/code-review medium`. Branch `011e-run3-1-permit-contractors`. Dates: 2026-10-26.

| Reviewer | Score | Verdict | Reviewed |
| --- | --- | --- | --- |
| oracle | 70 → **80** | PASS | `e098063`, then `d53b055` |
| donphan | **77** | PASS (published numbers checked document against document; no MCP access to Travis) | `f3ac319` |
| machamp | **78** | PASS | `f3ac319` |
| porygon | **82** | PASS (numbers reproduced with DuckDB on the Run 3.1 tables) | `f3ac319` |

No Critical finding from any reviewer or from `/code-review`.

## Score: round 1 70 / 100 (FAIL) → round 2 80 / 100 (PASS, pass bar 75)

## Round 1 (ERR-72, ERR-73): 70 / 100

The transform change was correct and safe; the manifest config would have published two false statements.

| # | Severity | Finding | Fix (commit) |
| --- | --- | --- | --- |
| F1 | High | Manifest dropped the `austin-address-points` source although the reused County data takes coordinates from it | `carryAddressPoints` carries it with delta 0 (`8381495`) |
| F2 | High/Medium | Run id and times were local time labelled UTC | UTC everywhere (`8381495`) |
| F3 | Medium | README edited by hand; the generator would restore the old ERR-32 wording | wording moved into `contract-docs.ts` and `columns.ts` (`8381495`) |
| F4 | Low/Medium | Stale "2007514 linked permits" note carried | dropped and restated as 2,008,095 (`8381495`) |
| F5 | Low | `dropLimitationPrefixes` silently ignored a prefix that matched nothing | refused (`8381495`) |
| F6 | Low | Contractor counts hand-copied into the config | `contractorCoverage` cross-check; registry sha256 in the note (`8381495`) |
| F7 | Info | `manifest.ts` comment described three buckets | five states (`8381495`) |

## Round 2 (round-1 fixes + ERR-74 address columns, contract v1.2): 80 / 100

All round-1 findings confirmed fixed. Patch confirmed correct (applies cleanly to 44bb182; deterministic first-seen column order; type conflicts become STRING; EXTRAS not duplicated). Numbers re-checked against the re-exported tables. Old runs still bind.

| # | Severity | Finding | Fix (commit) |
| --- | --- | --- | --- |
| 1 | Medium | `owner_mailing_reason` said `no_mailing_address` when the address exists without a ZIP/state (372 / 374 properties); the state reason checked the ZIP flag | `source_missing` when a mailing address exists; state checks `state_code` (`round-2 fixes`) |
| 2 | Medium | Contract docs and ADR-0002 still said addresses are not exported | `contract-docs.ts` passages rewritten; ADR-0002 dated update |
| 3 | Medium | Correction note said "every other table holds the same rows" (false for the 413 contractor rows); comparison not in the repo | note states per group; `run3-1/compare-tables.sh` + `table-compare.md` committed |
| 4 | Low | Patch provenance thin | patch and file sha256 in the note; `pipeline/publish/patches/README.md` with rebuild steps (verified to reproduce the patched file) |
| 5 | Low | Situs city/ZIP reason changes for older runs too, unannounced | stated in the v1.2 section |
| 6 | Low | ERR-74 paperwork pending | `fix_commit`, `retest_date`, Result filled |
| 7 | Low | `finishedAt` before the last export | 2026-10-25T22:55:00Z |
| 8 | Note | ERR-72 stores a person's name in `company` | PO decision; accepted risk, disclosed as "as printed, not verified" |

Round-2 fixes are in the commit "A-11: Run 3.1 review round 2 fixes (oracle 80/100)" and the manifest was rebuilt after them (`bafkreidbqsav3rsbxqy5fx3li73uskfth254nz5zw34xwac5w3fd4tmbai`).

## Not checked by the reviewer

Hosted pages and Playwright; gateway readback (not published at review time); `$ref` branches in other lexicon classes (none needed for `address`).

## Round 3: donphan, machamp, porygon and /code-review medium (on `f3ac319`)

Fixed on the branch before the merge (code: tests added or updated; data: none, the run is published and immutable):

| Source | Finding | Fix |
| --- | --- | --- |
| code-review 1, machamp H1 | `presentOnly` planned a missing CAR file as `skip`, so the step's completion check and the index gate could treat it as done | planned as `run` (no receipt), execute leaves it for a later call |
| machamp H2 | Nothing enforced "CAR before its tables folder" (Run 3.1: a folder uploaded first never pinned) | a tables unit waits until a receipt records its batch CAR; test |
| code-review 8 | A typo in `PUBLISH_FILEBASE_UNITS` silently skipped every unit | unknown unit ids are refused; test |
| code-review 5 | `registryNote` could leave the carried "baseline not loaded" note beside the new one | the carried note is dropped; test |
| code-review 6, porygon 5 | `contractorCoverage` did not check the report's own sum or missing states | all five states required and must sum to the report's permits; test |
| machamp M3 | The 10 adopted County car-files receipts still said `adopted: false`, Run 3's paths and time | rewritten: `adopted: true`, Run 3.1 paths, `adoptedFrom` (Run 3 receipt, time, gateways), `readback` (Run 3.1 CloudFront readback) |
| porygon 1 | `owner_area_class` said `no_mailing_address` for an owner whose mailing address has no ZIP (372 properties), while `owner_mailing_*` said `source_missing` | both `source_missing`; test |
| code-review 7 | Situs `city_name`/`postal_code` read `source_missing` for runs without address fields | `not_in_export` for those runs, `source_missing` from Run 3.1; test |
| code-review 2 | The transform resolved the raw company name, not the published (company, else person; placeholders none) name | resolver input = the published name (internal ledger only) |
| code-review 10 | `v_property` joined the address table twice | one join on `meta.address_fields` |
| donphan M1, porygon 8 | README promised owner reasons the Run 3/3.1 manifests never emit | stated as a known gap (PO decision) |
| donphan M2, porygon 3 | Mailing-ZIP coverage counted addresses; "24,532 outside Texas" read as a subset | property-level figure added (408,780 of 441,961); 24,532 reworded |
| donphan L2, L3, L5; porygon 7 | Stale "true of Run 2", missing reason list, "stays v1.1", contradictory `resolved` sentence | contract docs regenerated |
| porygon 2 | 242 registry-matched permits vs 375 / 389 earlier | stated as not reconciled in ERR-73 (follow-up) |

Carried to A-16 (tooling, no published data affected):

- machamp M4: load the ERR-67 retry wrapper inside `publish-run.ts` (not optional via `NODE_OPTIONS`) and time-box each upload attempt.
- machamp M5: build `registryNote` from the coverage report (rows, digest, watermark) instead of free text.
- code-review 3: `contractor_unresolved` means "unresolved only" in Run 3.1 (ambiguous/conflicting published separately) but `run-month.ts` still folds them in; align the monthly run on five keys.
- code-review 4: `carryAddressPoints` does not compare the receipt's records/captured_at with the base source.
- code-review 9: `contractor-coverage.ts` duplicates the registry load and index of `services/tracks/comptroller.ts`.
- donphan M3: no per-row flag tells the 413 person names in `company` from companies (lexicon carrier needed; ERR-72 is a PO decision).
- machamp L8–L10: finish job fetches all CARs; one-off workflows ask for `contents: write`; `p7-reexport-tables.sh` treats `-export.json` as done whatever the exit code.
- porygon 2: reconcile the registry match counts.
