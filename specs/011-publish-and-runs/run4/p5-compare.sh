#!/bin/sh
R=/Users/hebagaber/Github/oracle-property-intelligence-platform-pipeline-travis-tx
cd $R/pipeline/local-stack
npx tsx scripts/reexport-permits.ts --pids $R/specs/011-publish-and-runs/run4/permit-pids.txt --job travis-a11-permits-run4-20261026 \
  --compare-run $R/pipeline/data/runs/travis-a11-permits-run3-1-20261026/groups/property_improvement
echo exit=$?
