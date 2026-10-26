# CR-A-11 — oracle review: permits/county shared-file identity fix

Reviewer: oracle (read-only). Branch `011-publish-and-runs`. Commits `75a0eaf`, `3fcb665`, `5bb47d8`, `421e888`.
Date: 2026-10-24.

## Score: 82 / 100 (pass bar 75) — PASS, no blocking finding

The fix itself is correct and complete for every field `buildSharedFiles()` reads today, and the
County output is unchanged. What's left is hardening: two silent-reuse/fail-open paths that the
identity gate would catch only partly, and some small holes in the gate.

## What I checked and found correct

1. **Completeness (Q1).** These are the fields the shared files read, each compared with what the permits path now receives:
   - `pID`, `propType`: stored by `slimPayload` (`travis/tcad/fields.ts:258-259`).
   - `geometry`: overridden in both paths by `sharedFilesInputOf` → `geometryFor` (`tcad/write-group.ts:73-91,114-123`). Both paths read the coordinate from the same `parcels` columns. County gets them from `coordinateRows`, `tcad-backbone.ts:110-123`. Permits gets them from `parcelsFor`, `permits-backbone.ts:77-81`. Both use the same `?? "none"` (`tcad-backbone.ts:122`, `permits/write-group.ts:131`).
   - `situses[*]`: `SITUS_KEEP` (`fields.ts:210-220`) equals the zod fields `situsOf` reads (`shared-seed.ts:42-52,109-122`).
   - `propertyProfile[0].stateCd`: kept (`fields.ts:267-269`). `imprvActualYearBuilt` is now unused because `yearBuilt` is always passed.
   - `propertyLegalDescription[0].legalDescription`: kept, with array order preserved (`fields.ts:264-266`, read at `shared-seed.ts:274`).
   - Improvement count (`improvementsOf`, `year-built.ts:57-79`, used at `shared-seed.ts:270`): `slimValuations` (`redact.ts:106-119`) keeps every improvement object under `cost-local`, using the same object filter. Only the count is read, so the count is equal. `slimValuations` is idempotent, so the redacted record, which is already slim, still matches.
   - `yearBuilt`: county gets `l.parcel.property_structure_built_year` (`tcad-backbone.ts:223`). Permits reads the same column, written by the same `yearBuiltOf(redaction.record, ctx.asOf)` (`fields.ts:339`), and the parcels PK is `request_identifier` (`0101_tcad.sql:7`). It is passed as `number|null`, never `undefined`, so the profile-year fallback is never taken (`shared-seed.ts:273`).
   - `geo_id`: same column. The seed's `geo_id` is not printed in any shared file.
   - None of the files that drive shared bytes changed between Run 1 (2026-10-23) and `75a0eaf` (git log).
2. **County bytes unchanged (Q2).** `planCountyGroup` (`tcad/write-group.ts:126-151`) is a pure extraction of the old inline code. The geometry override, `parseTcadRecord`, `buildSeedRow` and `yearBuilt` passthrough are identical, and `transformTcadCounty` is untouched. The only other caller, `process.ts:243` (validate hook), is unaffected.
3. **Redaction (Q3).** `propertyLegalDescription` keeps only `legalDescription`. `slimValuations` keeps ids, types, state codes, years and floor areas: no value, price, comment or party (`redact.ts:91-99`). `owners` is still `[]` when redacted. The legal text is already published in county `property.json` for every R account, including §25.025 accounts, so storing it adds no exposure. Note: some TCAD legal descriptions carry survey/abstract names (e.g. `ABS 12 SUR 40 <name>`). These are historical grantees that TCAD publishes, not owners, so they are acceptable under the A-04 rule.
4. **Tests run green.** `shared-files-identity.test.ts`, `permits/write-group.test.ts`, `reexport-permits.test.ts` and `permits-write-group.test.ts` give 34/34. The pilot pID list (287) is a subset of `run1-permit-pids.txt` (10,867), so no orphan pilot folders are left in the full group dir.
5. **No marker inside a hashed tree.** Re-export state is in `reexport-state/`, temp files in `reexport-tmp/` (`reexport-permits.ts:62-68`). Batch markers are in `logs/` (`batch-hash-validate-export.sh`). `split-into-batches.py` writes `batches/bNN.done` beside `bNN/`, not inside it.

## Findings (by severity)

### M1 — The permits builder silently accepts a stored payload that was not backfilled
`permits/write-group.ts:105-133` takes any object as `payload_redacted`. A row still in the old slim format (no `propertyLegalDescription`, no `valuations`) parses fine, because zod defaults both to `[]` (`shared-seed.ts:29-31`). Its `property.json` then comes out with `property_legal_description_text: null` and `improvementCount 0`, so the type falls back to `LandParcel` instead of `Building`. The bytes diverge with no error.

**Scenario:** the backfill skips a batch on `record_sha256_mismatch` (core.ts:220), or a pID's row belongs to another `job_id` (the UPDATE is guarded by `p.job_id = $1`, core.ts:183). The re-export writes divergent files for those pIDs. Only `identity-gate.ts` notices, and only as an unmatched count.

**Fix:** fail closed in `recordAndSeedOf` unless both keys are present (`Object.hasOwn(stored,"propertyLegalDescription") && Object.hasOwn(stored,"valuations")`). Better still, stamp a payload format version.

### M2 — Batch-split reuse is keyed on file names only, so hard links can serve stale content
`batch-hash-validate-export.sh` `listing_hash` hashes `find . | sort` (names, not contents). `split-into-batches.py` hard-links files (`hardlink_item`). `reexport-permits.ts:269-271` replaces a folder with `rm` + `rename`, which creates new inodes. The old hard links in `batches/bNN/` keep the old bytes.

**Scenario:** batch the group, then re-export after a code or DB change that keeps file names (for example, any shared-file content fix). `split.done` still matches, every `bNN.done` is kept, and the old CARs and tables are re-used and published.

**Fix:** include content in the listing hash (e.g. `find . -type f -exec shasum` or size+mtime+inode), or always re-split after a re-export.

### M3 — The fingerprint's `CODE_FILES` omits modules that shape the output
`reexport-permits.ts:73-81` leaves out these modules: `travis/pilot/profile-api.ts` (roofing/status classification, which decides emit vs empty), `travis/identity/resolver.ts` and `identity/crosswalk.ts` (called per permit, `austin-property-improvement.ts:174-180`), `transforms/lexicon-manifest.ts`, and the zod version that does the parse.

**Scenario:** edit `profile-api.ts` and re-run. Every pID is `reused` with stale permit files. `--compare-run` would surface permit-only diffs only if the operator runs it.

**Fix:** hash the transitive import closure (or the bundled output), not a hand list. Optionally re-verify the file count or digest inside a reused folder.

### L1 — `identity-gate.ts` can pass with a NULL CID, or without any count check
- `identity-gate.ts:83-86`: `p.cid NOT IN (SELECT cid FROM county.property)`. A single NULL `cid` in `county.property` makes every comparison NULL, so `unmatched = 0` and the gate passes. Use `NOT EXISTS` or a `LEFT JOIN … IS NULL` anti-join.
- `:111-113`: when the manifest has no `coverage.permits_emitted` and `--expect-permits` is omitted, the only remaining check is `meta.permit > 0` plus the unmatched-property check. A partial join of permits would pass. Require one of the two counts, and assert `joined` against it.
- `:76-79`: when a local file exists under `--root`, the part is read from it with no check that its bytes hash to the manifest's `cid`. The gate can prove local bytes that are not the uploaded ones. That is fine pre-upload, but rerun the gate against the CID copy after upload (no `--root`).
- `:87-95`: a `--pids` entry missing from `property_improvement.property` entirely is not reported.

### L2 — The identity test cannot see some kinds of divergence (limits it already states, plus one)
`shared-files-identity.test.ts`:
- Fixture records are already reduced to the redacted shape, with `valuations` already slimmed. So a future `buildSharedFiles`/`improvementsOf` read of a key that `slimValuations`/`slimPayload` drops would pass on both sides.
- Both paths go through `sharedFilesInputOf`, so a bug inside it is invisible.
- The DB columns (`property_structure_built_year`, coordinates) are copied from the same in-process `l.parcel` (`:161-173`), so as_of drift or the unassembled-county case (no `coordinate`, `tcad-backbone.ts:228`) is not exercised.
- Added: it has no golden assertion against Run 1's published County bytes. Run 2 reuses immutable Run 1 County batches, so the real contract is "permits == Run 1 County bytes". Add the Run 1 `property.json` sha256 for the 8 fixture pIDs as a golden check.

On the plus side, the test drives the real `processRecord` → `slimPayload`. Dropping any field that is read today from `slimPayload` fails it.

### L3 — The DB-input digest leaves out the permit payload itself
`reexport-permits.ts:129-135` digests `content_sha256` and `captured_at`, but not `psr.payload`, which is what `captureOf` reads. This is safe only while `content_sha256` is always recomputed when `payload` changes. Either add `md5(psr.payload::text)` or document that invariant.

### Info
- `pipeline/publish/scripts/split-into-batches.py` is Python outside PySpark/Glue (constitution line 25). It predates these commits, which only call it, but it should move to TypeScript.
- Backfill round trip (Q7) is sound. JSON text is bound as `::text::jsonb` (core.ts:182). jsonb keeps the shortest-roundtrip decimal text and array order, and the key reordering is covered by the test. A `\u0000` or a lone surrogate makes the UPDATE fail loudly; it cannot produce a silent diff. A double-encoded legacy row now throws in `recordAndSeedOf` (`permits/write-group.ts:106-110`). Only M1 is a residual silent path.

## Verdict
Pass at 82. Nothing blocks merge. Fix M1 and M2 before the full Run 2 batch/publish step, because both can publish wrong bytes without an error. Fix L1 (anti-join and required count) before relying on the gate as the publish stop.
