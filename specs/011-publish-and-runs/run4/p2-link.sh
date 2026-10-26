#!/bin/sh
# Run 4 P2b-d: pre-link facts, relink over every permit, final facts (as Run 3 P2). Arg: capture job id.
set -u
J=$1
R=/Users/hebagaber/Github/oracle-property-intelligence-platform-pipeline-travis-tx
cd $R/pipeline/local-stack && npx tsx scripts/incremental-facts.ts pre-link --job $J --out ../../specs/011-publish-and-runs/run4 || { echo "pre-link exit=$?"; exit 1; }
cd $R && npm --prefix pipeline/oracle-runtime run backbone -- permits --link; rc=$?; echo "link exit=$rc"; [ $rc -eq 0 ] || exit $rc
cd $R/pipeline/local-stack && npx tsx scripts/incremental-facts.ts final --job $J --out ../../specs/011-publish-and-runs/run4 \
  --base-manifest ../../runs/travis-full-run3-1-20261025/manifest.json
echo "final exit=$?"
