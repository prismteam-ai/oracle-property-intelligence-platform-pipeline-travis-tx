#!/usr/bin/env python3
"""A-11: split a loose-file data-group directory into N contiguous batches by hard-linking
(never copying) each item into pipeline/data/runs/<run>/publish-dry-run/<group>/batches/bNN/.

This mirrors A-04's proven fix for elephant-cli validate at scale (specs/004-property-backbone/
run-log.md lines 95-99): batching lets `elephant-cli hash` build one CAR per batch so
`elephant-cli validate` runs against the CAR (fast) instead of the loose files (infeasible at
441,961 files). Written in Python, not a per-item bash loop, because hard-linking 441,961 items
one `ln`/`cp` process per item would itself take tens of minutes of pure fork overhead.

An item may be a single file (county: one .zip per property) or a directory (permits: one
<folio>/data/*.json tree per property) — both are hard-linked file-by-file, so no bytes are
duplicated on disk and the CAR hash step sees byte-identical content to the source run.

Usage:
  split-into-batches.py <group-dir> <out-dir> <n-batches>

Idempotent: a batch directory that already has an item count matching its planned share is left
untouched (resumable after a crash or Ctrl-C).
"""
import os
import sys


def hardlink_item(src: str, dst: str) -> None:
    if os.path.isdir(src):
        os.makedirs(dst, exist_ok=True)
        for root, dirs, files in os.walk(src):
            rel = os.path.relpath(root, src)
            dst_root = dst if rel == "." else os.path.join(dst, rel)
            os.makedirs(dst_root, exist_ok=True)
            for d in dirs:
                os.makedirs(os.path.join(dst_root, d), exist_ok=True)
            for f in files:
                s = os.path.join(root, f)
                d_ = os.path.join(dst_root, f)
                if not os.path.exists(d_):
                    os.link(s, d_)
    else:
        if not os.path.exists(dst):
            os.link(src, dst)


def main() -> int:
    if len(sys.argv) != 4:
        print(__doc__, file=sys.stderr)
        return 2
    group_dir, out_dir, n_batches = sys.argv[1], sys.argv[2], int(sys.argv[3])
    if not os.path.isdir(group_dir):
        print(f"error: {group_dir} is not a directory", file=sys.stderr)
        return 2

    items = sorted(os.listdir(group_dir))
    total = len(items)
    if total == 0:
        print("error: no items found in group dir", file=sys.stderr)
        return 2

    batches_root = os.path.join(out_dir, "batches")
    os.makedirs(batches_root, exist_ok=True)

    base = total // n_batches
    rem = total % n_batches
    start = 0
    plan = []
    for b in range(n_batches):
        size = base + (1 if b < rem else 0)
        plan.append((b + 1, items[start:start + size]))
        start += size
    assert start == total

    for b, batch_items in plan:
        bname = f"b{b:02d}"
        bdir = os.path.join(batches_root, bname)
        marker = os.path.join(batches_root, f"{bname}.done")
        if os.path.exists(marker):
            existing = len(os.listdir(bdir)) if os.path.isdir(bdir) else 0
            if existing == len(batch_items):
                print(f"{bname}: already linked ({existing} items), skipping")
                continue
            print(f"{bname}: stale marker (expected {len(batch_items)} items, found {existing}) — re-splitting")
            os.remove(marker)
        os.makedirs(bdir, exist_ok=True)
        done = 0
        for item in batch_items:
            hardlink_item(os.path.join(group_dir, item), os.path.join(bdir, item))
            done += 1
            if done % 20000 == 0:
                print(f"{bname}: linked {done}/{len(batch_items)}")
        with open(marker, "w") as fh:
            fh.write(str(len(batch_items)))
        print(f"{bname}: linked {len(batch_items)}/{len(batch_items)} items (done)")

    print(f"split complete: {total} items into {n_batches} batches under {batches_root}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
