#!/bin/sh
# Run 4 P5: rebuild the Property Improvement group (Run 3 p5.sh / Run 3.1 reexport), seeded by a
# hard-link copy of Run 3.1's job dir (groups + reexport-state only; reexport writes temp+rename,
# so Run 3.1's files are never modified). pIDs = Run 3.1's list (run3/permit-pids.txt) + Run 4 affected.
set -u
R=/Users/hebagaber/Github/oracle-property-intelligence-platform-pipeline-travis-tx
D=$R/pipeline/data/runs
J=travis-a11-permits-run4-20261026
P=$R/specs/011-publish-and-runs/run4/permit-pids.txt
sort -u $R/specs/011-publish-and-runs/run3/permit-pids.txt $R/specs/011-publish-and-runs/run4/affected-pids.txt > $P
echo "pids=$(wc -l < $P)"
if [ ! -d $D/$J ]; then
  mkdir -p $D/$J
  cp -Rl $D/travis-a11-permits-run3-1-20261026/groups $D/$J/groups
  [ -d $D/travis-a11-permits-run3-1-20261026/reexport-state ] && cp -Rl $D/travis-a11-permits-run3-1-20261026/reexport-state $D/$J/reexport-state
fi
cd $R/pipeline/local-stack
npx tsx scripts/reexport-permits.ts --pids $P --job $J --chunk 500 --concurrency 6
echo exit=$?
