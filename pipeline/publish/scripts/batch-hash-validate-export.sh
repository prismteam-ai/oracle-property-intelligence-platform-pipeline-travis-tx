#!/usr/bin/env bash
# A-11: batched hash -> validate(CAR) -> export-tables per data group, local only (no upload,
# no --atlas-page). Mirrors A-04's proven fix (specs/004-property-backbone/run-log.md lines
# 95-99, 101): `elephant-cli validate` over loose files measured at 0.5 s/file (infeasible at
# scale: county's 441,961 files would be ~61 h); batching into N CARs first and validating each
# CAR instead measured at 12.8 s per 1,000 properties (~40x faster), with hash ~16.3s/1,000 and
# export-tables ~1.7s/1,000 (also measured at that run).
#
# Usage:
#   batch-hash-validate-export.sh <group-dir> <out-dir> <n-batches> <workers> <car-prefix>
#
#   <group-dir>   loose-file data-group directory (one item per property: a .zip file for
#                 county, or a folio directory for permits)
#   <out-dir>     output root (created): batches/, hashed/, cars/, tables/, logs/
#   <n-batches>   number of batches to split into (A-04 precedent: ~44,000 items per batch)
#   <workers>     max concurrent batch workers (bounded; this is local CPU work, not an
#                 external source, so parallelism here is not the polite-rate-limit rule)
#   <car-prefix>  prefix for this group's CAR/tables file names, e.g. travis-county
#
# Each batch, once linked (pipeline/publish/scripts/split-into-batches.py, hard links only):
#   1. elephant-cli hash   <batch-dir>      -> hashed zip + CSV + one CAR for the batch
#   2. elephant-cli validate <batch-car>    -> validates the CAR, not the loose files
#   3. elephant-cli export-tables <batch-car> -> this batch's Parquet tables + tables.car
# No --atlas-page, no upload, no IPFS/S3/GitHub writes: this script is a local dry run only.
set -uo pipefail

GROUP_DIR="$1"
OUT_DIR="$2"
N_BATCHES="$3"
WORKERS="$4"
PREFIX="$5"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ELEPHANT_CLI="${ELEPHANT_CLI:-$HOME/.local/share/elephant-cli-main/node_modules/.bin/elephant-cli}"
[ -x "$ELEPHANT_CLI" ] || ELEPHANT_CLI="elephant-cli"
PYTHON="${PYTHON:-python3}"

# Run lock: one instance per output dir. The lock file sits NEXT TO the output dir (never inside
# it or inside any hashed directory) and holds the owner's PID. A lock whose PID is gone is stale
# and is taken over; a live owner makes this run refuse to start.
LOCK="${OUT_DIR%/}.lock"
# The lock sits next to OUT_DIR, so its parent must exist before the first run (A-11 Run 3 fix).
mkdir -p "$(dirname "$LOCK")"
# Atomic create: the pid goes into a private temp file first, then `ln` publishes it under the
# lock name. ln fails if the lock exists, and a reader never sees a half-written (empty) owner,
# which it would wrongly treat as stale.
try_create() {
  local tmp="$LOCK.$$.tmp"
  echo "$$" >"$tmp" || return 1
  if ln "$tmp" "$LOCK" 2>/dev/null; then rm -f "$tmp"; return 0; fi
  rm -f "$tmp"
  return 1
}
# Stale takeover (A-16 A11-10b): only the process that creates the takeover guard directory
# (mkdir is atomic) may replace the stale lock. It re-reads the owner after taking the guard
# (another process may already have finished a takeover), moves the stale file aside with mv
# (atomic rename), then creates the lock exclusively. Everyone else fails closed.
GUARD="$LOCK.takeover"
acquire_lock() {
  local owner current
  if try_create; then return 0; fi
  owner="$(cat "$LOCK" 2>/dev/null || true)"
  if [ -n "$owner" ] && kill -0 "$owner" 2>/dev/null; then
    echo "[lock] $OUT_DIR is in use by pid $owner ($LOCK); refusing to start" >&2
    return 1
  fi
  if ! mkdir "$GUARD" 2>/dev/null; then
    echo "[lock] another process is taking over $LOCK (guard $GUARD); refusing to start" >&2
    return 1
  fi
  current="$(cat "$LOCK" 2>/dev/null || true)"
  if [ "$current" != "$owner" ] && [ -n "$current" ]; then
    rmdir "$GUARD"
    echo "[lock] lost the race for $LOCK (owner changed to pid $current); refusing to start" >&2
    return 1
  fi
  echo "[lock] taking over stale lock $LOCK (pid ${owner:-unknown} is gone)" >&2
  mv "$LOCK" "$LOCK.stale.$$" 2>/dev/null || true
  if try_create; then
    rm -f "$LOCK.stale.$$"
    rmdir "$GUARD"
    return 0
  fi
  rm -f "$LOCK.stale.$$"
  rmdir "$GUARD"
  echo "[lock] lost the race for $LOCK; refusing to start" >&2
  return 1
}
acquire_lock || exit 1
trap 'rm -f "$LOCK"' EXIT

mkdir -p "$OUT_DIR/batches" "$OUT_DIR/hashed" "$OUT_DIR/cars" "$OUT_DIR/tables" "$OUT_DIR/logs"

# Resume (A-11): markers live in logs/, never inside batches/<b>/ (that tree is hashed).
# The split is skipped only when logs/split.done holds the hash of the group dir's listing
# (and N); otherwise batches/ is wiped and re-split, and per-batch .done markers are invalidated.
# Batches are hard links: a file replaced under the same name gets a new inode, so the listing
# carries each file's inode, size and mtime, never names alone (else old bytes would be reused).
file_stats() {
  if stat -f '%N %i %z %m' / >/dev/null 2>&1; then
    find . -type f -exec stat -f '%N %i %z %m' {} +
  else
    find . -type f -exec stat -c '%n %i %s %Y' {} +
  fi
}
listing_hash() {
  { echo "n=$N_BATCHES"; (cd "$GROUP_DIR" && find . -mindepth 1 -type d | LC_ALL=C sort && file_stats | LC_ALL=C sort); } |
    shasum -a 256 | cut -d' ' -f1
}
LISTING_HASH="$(listing_hash)"
if [ -f "$OUT_DIR/logs/split.done" ] && [ "$(cat "$OUT_DIR/logs/split.done")" = "$LISTING_HASH" ]; then
  echo "[split] unchanged group dir, reusing $OUT_DIR/batches"
else
  echo "[split] $GROUP_DIR -> $OUT_DIR/batches ($N_BATCHES batches)"
  rm -f "$OUT_DIR/logs/split.done" "$OUT_DIR"/logs/b*.done
  rm -rf "$OUT_DIR/batches"
  mkdir -p "$OUT_DIR/batches"
  if ! "$PYTHON" "$SCRIPT_DIR/split-into-batches.py" "$GROUP_DIR" "$OUT_DIR" "$N_BATCHES" \
    >"$OUT_DIR/logs/split.log" 2>&1; then
    echo "[split] FAILED, see $OUT_DIR/logs/split.log" >&2
    exit 1
  fi
  echo "$LISTING_HASH" >"$OUT_DIR/logs/split.done"
  echo "[split] done, see $OUT_DIR/logs/split.log"
fi

run_batch() {
  local bname="$1"
  local bdir="$OUT_DIR/batches/$bname"
  local hashed="$OUT_DIR/hashed/$bname"
  local car="$OUT_DIR/cars/${PREFIX}-${bname}.car"
  local csv="$OUT_DIR/cars/${PREFIX}-${bname}-hash.csv"
  local tables="$OUT_DIR/tables/$bname"
  local log="$OUT_DIR/logs/${bname}.log"
  local donef="$OUT_DIR/logs/${bname}.done"
  if [ -f "$donef" ] && [ -f "$car" ] && [ -f "$OUT_DIR/tables/${bname}-export.json" ]; then
    echo "[batch] $bname already done, skipping"
    return 0
  fi
  rm -f "$donef"
  # A failed earlier attempt leaves partial outputs; none of them may be reused.
  rm -rf "$hashed" "$tables"
  rm -f "$car" "$csv" "$OUT_DIR/cars/${PREFIX}-${bname}-validate-errors.csv" "$OUT_DIR/tables/${bname}-export.json"
  mkdir -p "$tables"

  {
    echo "=== $bname start $(date -u +%FT%TZ) ==="
    echo "-- hash --"
    t0=$(date +%s)
    "$ELEPHANT_CLI" hash "$bdir" \
      --output-zip "$hashed" \
      --output-csv "$csv" \
      --output-car "$car"
    rc=$?
    t1=$(date +%s)
    echo "hash exit=$rc elapsed=$((t1 - t0))s"
    [ "$rc" -eq 0 ] || { echo "=== $bname FAILED at hash ==="; exit "$rc"; }

    echo "-- validate (CAR) --"
    t0=$(date +%s)
    "$ELEPHANT_CLI" validate "$car" \
      --output-csv "$OUT_DIR/cars/${PREFIX}-${bname}-validate-errors.csv"
    rc=$?
    t1=$(date +%s)
    echo "validate exit=$rc elapsed=$((t1 - t0))s"
    [ "$rc" -eq 0 ] || { echo "=== $bname FAILED at validate ==="; exit "$rc"; }

    echo "-- export-tables --"
    t0=$(date +%s)
    "$ELEPHANT_CLI" export-tables "$car" \
      --output "$tables" \
      --part-size 48m \
      --output-json "$OUT_DIR/tables/${bname}-export.json"
    rc=$?
    t1=$(date +%s)
    echo "export-tables exit=$rc elapsed=$((t1 - t0))s"
    [ "$rc" -eq 0 ] || { echo "=== $bname FAILED at export-tables ==="; exit "$rc"; }

    echo "=== $bname done $(date -u +%FT%TZ) ==="
  } >"$log" 2>&1
  local brc=$?
  # The .done marker is written only after export-tables succeeded (the group above exits non-zero otherwise).
  [ "$brc" -eq 0 ] && date -u +%FT%TZ >"$donef"
  return "$brc"
}

# Bounded parallelism; every batch's exit status is collected (bash 3.2-safe: no wait -n).
declare -a pids=() names=()
failed=()
reap() {
  if ! wait "${pids[0]}"; then failed+=("${names[0]}"); fi
  pids=("${pids[@]:1}")
  names=("${names[@]:1}")
}
for i in $(seq 1 "$N_BATCHES"); do
  bname="$(printf 'b%02d' "$i")"
  run_batch "$bname" &
  pids+=("$!")
  names+=("$bname")
  if [ "${#pids[@]}" -ge "$WORKERS" ]; then reap; fi
done
while [ "${#pids[@]}" -gt 0 ]; do reap; done

if [ "${#failed[@]}" -gt 0 ]; then
  echo "[batch-hash-validate-export] FAILED batches for $PREFIX: ${failed[*]} (see $OUT_DIR/logs/<batch>.log); rerun to resume" >&2
  exit 1
fi
echo "[batch-hash-validate-export] all $N_BATCHES batches finished for $PREFIX; logs in $OUT_DIR/logs"
