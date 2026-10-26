#!/bin/sh
# Run 4: contractor five-state coverage over the permits Run 4 publishes (Run 3.1 ERR-73 approach).
R=/Users/hebagaber/Github/oracle-property-intelligence-platform-pipeline-travis-tx
cd $R/pipeline/local-stack
npx tsx scripts/contractor-coverage.ts --group $R/pipeline/data/runs/travis-a11-permits-run4-20261026/groups/property_improvement \
  --out $R/specs/011-publish-and-runs/run4/contractor-coverage.json
echo exit=$?
