#!/bin/sh
# Run 3.1 (option A, PO 2026-10-26): re-export the Parquet tables of every batch with the patched
# elephant-cli (address oneOf columns, pipeline/publish/patches/elephant-cli-export-oneof.patch).
# CARs are not rebuilt: they are hard-linked from the batch dirs, so their CIDs stay the same.
set -u
CLI="$HOME/.local/share/elephant-cli-oneof/node_modules/.bin/elephant-cli"
R=/Users/hebagaber/Github/oracle-property-intelligence-platform-pipeline-travis-tx-p/pipeline/data/runs
one() { # <src batched dir> <dst batched dir> <prefix> <batch>
  src=$1; dst=$2; b=$4; car="$src/cars/$3-$b.car"
  mkdir -p "$dst/cars" "$dst/tables" "$dst/logs"
  ln -f "$car" "$dst/cars/$3-$b.car"
  rm -rf "$dst/tables/$b"
  "$CLI" export-tables "$car" --output "$dst/tables/$b" --part-size 48m \
    --output-json "$dst/tables/$b-export.json" > "$dst/logs/$b-export.log" 2>&1
  echo "$3 $b export-tables exit=$?"
}
C=$R/travis-a11-county-run3-20261025/publish-run3/county-batched
CN=$R/travis-a11-county-run3-20261025/publish-run3-1/county-batched
P=$R/travis-a11-permits-run3-1-20261026/publish-run3-1/permits-batched
PN=$R/travis-a11-permits-run3-1-20261026/publish-run3-1-oneof/permits-batched
# One batch at a time: five in parallel stalled in swap on this 16 GiB machine (2026-10-26).
# A batch whose -export.json exists is done and is skipped, so a rerun resumes.
for b in b01 b02 b03 b04 b05; do
  [ -f "$PN/tables/$b-export.json" ] || one "$P" "$PN" travis-permits $b
done
for b in b01 b02 b03 b04 b05 b06 b07 b08 b09 b10; do
  [ -f "$CN/tables/$b-export.json" ] || one "$C" "$CN" travis-county $b
done
echo done
