# CR-A-11-machamp-fix: batch / resume review of today's A-11 fix work

Reviewer: Machamp (batch workflows). Read-only; nothing was run against the DB, `pipeline/data/` or uploads.
Scope: commits 5bb47d8, ca384d9, 1fc994a, 0cd4fe5, c85b4c8, e2c682f.

**Score: 80 / 100 (pass bar 75). No blocking finding.**

Evidence of real runs agrees with the code. The full backfill ended `rows_covered=493246 = db_rows_in_scope`, `checkpoint_low_water=493245`, fingerprint equal (`backfill-full.log`). The pilot crash-sim redid exactly the 5 deleted state files (`reexport-pilot-crashsim.log`). The full re-export gives 10,792 folders = 10,867 minus 75 empty, with 0 stray folders (checked against `run1-permit-pids.txt`). Compare reports Roofing lost = 0.

## Findings, by severity

### M1 (medium): `index` step reports "already done" after a failed post-write verification
`pipeline/publish/src/publish-run.ts:929-936` writes `runs/index.json`, then runs `verifyCommittedRuns`. If that check fails it throws, but the entry is already on disk. On rerun, `plan` (lines 912-921) sees the run listed with the same CID and returns `skip`, so the step reports `already-done` and the verification is never repeated.
Scenario: the verification fails because of a transient or real problem. The operator reruns, gets `ok`, and a bad index entry is committed.
Fix: re-run `verifyCommittedRuns` in `plan` or in an always-run post-step, and write the file atomically.

### M2 (medium): `runs/index.json` and gate/receipt JSON are written non-atomically
`writeFileSync` at `publish-run.ts:929`, and `writeJson` at `publish-run.ts:124-127`.
- Receipts: a crash mid-write leaves truncated JSON. `readJson` returns undefined, so the receipt is treated as absent and the step is redone. Safe, but it can redo a Release or CID-copy step.
- Index: a crash mid-write leaves a truncated public file. The next `parseRunsIndex` throws at `plan` (lines 909, 912) and the step is stuck until someone repairs it by hand. The file is in git, so it is recoverable.
Fix: temp file plus rename, as `reexport-permits.ts:writeStateAtomic` and `publish-run.ts:440` already do.

### M3 (medium): Release uploads local CARs without hashing them first
`publish-run.ts:871-888` checks only `existsSync` before `gh release create/upload`. A post-check (lines 784-788) detects a digest mismatch, but only after the wrong bytes are already a published asset. Every later run then refuses with "refusing to replace a published asset", so recovery is manual.
Scenario: a CAR on disk was regenerated after the manifest was built (the batch script keeps `cars/*.car` across reruns).
Fix: sha256 the local file against `want.sha256` before upload.

### M4 (medium): the batch script's resume and inode logic has no test and no run evidence
`pipeline/publish/scripts/batch-hash-validate-export.sh:45-71, 82-87, 125-128`. There is no test for `split.done`, the per-batch `.done` markers, or the `reap` failure collection. No log shows a "reusing" or "already done" path being exercised (`batch-full.log` is a single clean pass).
Also, `rm -rf "$hashed" "$tables"` (line 87) does not remove the stale `cars/*.car`, `*-hash.csv` or `tables/<b>-export.json` from a failed earlier attempt. Whether `elephant-cli hash --output-car` overwrites an existing CAR cleanly is unverified. The `.done` marker does protect against reusing a half-run batch.
Note that `file_stats | sort` and the `find` run under `pipefail` with no check, so a failed `find` still yields a hash.

### L1 (low): the re-export fingerprint's code list is hand-maintained
`reexport-permits.ts:67-84`. Real transitive imports are not listed: `loader.js` (imported at `permits-backbone.ts:29`), `transforms/tcad-county.js` and `tcad/account-class.js` (imported by `tcad/write-group.ts:17-18`). The `export-point.js` imports are type-only. M3 of CR-A-11-oracle-identity-fix already had to add four files, so more can be missed.
Scenario: an edit to one of those files is not detected and old folders are reused (silent stale bytes).
Fix: hash the transitive import closure, or key reuse on `git rev-parse HEAD:pipeline` plus a clean-tree check.

### L2 (low): no run lock
`reexport-permits.ts:218-221` wipes `reexport-tmp/` at start, and `writeStateAtomic` uses a fixed `<pid>.json.tmp`. A pilot run started during a full run would delete the other's in-flight chunk and collide on state temp files. Same for `rm -rf batches` in the batch script. Single-operator assumption, undocumented.

### L3 (low): the re-export group dir is hashed wholesale, but nothing removes stray folders
Reuse is per pID in the list. A folder left from a different list (an older pilot) would be published. Today it is clean (0 strays, checked), but nothing enforces it.

### L4 (low): backfill resume trusts the stored "before" fingerprint
`backfill-payload-redacted/core.ts` (`fingerprintBefore = cp?.fingerprint`). If any other column changes legitimately between the crash and the resume, the run does all the work and then fails with `fingerprint_changed`. Recovery is to delete the checkpoint. It fails closed, so this is safe but annoying.

### L5 (low): operational notes
- Run 1's top-level `upload-receipts/county-b*.json` are untracked in git. The "adopt Run 1 receipts" skip logic (`publish-run.ts:391-399`) depends on uncommitted files. If they are lost, the next run re-uploads about 2.3 GB of county CARs. This is idempotent and safe.
- `--compare-run` compares only `property_improvement_N.json` by permit number. The relationship files and the group-hub file are no longer compared. The mandatory identity gate (join and count) covers the join, so there is no silent hole, but byte equality of those files is unproven.
- `split-into-batches.py` is Python outside PySpark/Glue, which CLAUDE.md forbids. It predates today (A-04 precedent) but is still a rule violation.
- The Filebase step uploads units sequentially, although the PO asked for maximum parallelism within each step.

## Verified correct

- **Backfill write path** (`core.ts`):
  - `writeBatch` runs the record_sha256 check and the `IS DISTINCT FROM` UPDATE in one transaction, so a mismatch writes nothing.
  - The low-water mark advances only over contiguous completed ranges (`createLowWater`). A failed earlier batch pins the mark, and the records after it are redone on resume as no-ops.
  - The checkpoint is saved atomically (temp plus rename) after each commit, and `saveMark` runs only after `writeBatch` returned.
  - In-flight writes are settled before the checkpoint is considered final.
  - Memory is bounded by `hasCapacity` (workers*2 chunks, writers*2 batches), and the out-of-order `done` map is bounded by the in-flight chunks.
  - Completion requires `mark == lastOrdinal` and `rows_covered == db_rows_in_scope`.
  - The scope-keyed checkpoint stops a pilot checkpoint from touching the full run.
- **Re-export**:
  - Temp dir plus rename means a half-written folder is never visible.
  - The state file is written after the rename. Every crash window (before rename, between `rmSync(dst)` and rename, between rename and state) leads to a redo, never a wrong reuse.
  - The `empty` state is checked against folder absence.
  - The digest is computed before the write. A DB change in between gives a later fingerprint mismatch and a redo, which is the safe direction.
  - Failure stops new chunks and exits 1.
- **Batch script**:
  - The `.done` marker is written only after the group exits 0.
  - Failures are collected per batch.
  - The split is reused only when the inode, size and mtime listing is identical. A replaced file gets a new inode, so the old bytes are not reused. Markers live in `logs/`, not in the hashed tree.
- **Publish driver**:
  - The step order is fixed, and the gates cannot be skipped (strict `parseArgs`, `--step` forces `gate` and `gate-remote` first).
  - Gate receipts are keyed by manifest CID.
  - The Filebase upload goes to `.partial` and is renamed only after the root CID matches. A wrong root fails immediately without retry. Retries use exponential backoff capped at 120 s over 8 attempts.
  - Receipts are written after the work completes, and the driver re-plans after `execute` to prove they exist.
  - The `index` step is refused unless every earlier step has receipts.
  - The Release step handles partial assets (delete, then re-upload) and re-assesses after upload.
  - The index never alters a committed manifestCid.
- **Roofing-only change**: the fingerprint includes the changed transform and `profile-api.ts`, so pilot folders were redone, as the pilot-roofing log shows.
