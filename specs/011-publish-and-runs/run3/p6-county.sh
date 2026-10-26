#!/bin/sh
cd /Users/hebagaber/Github/run3-integration
bash pipeline/publish/scripts/batch-hash-validate-export.sh /Users/hebagaber/Github/oracle-property-intelligence-platform-pipeline-travis-tx-p/pipeline/data/runs/travis-a11-county-run3-20261025/groups/county /Users/hebagaber/Github/oracle-property-intelligence-platform-pipeline-travis-tx-p/pipeline/data/runs/travis-a11-county-run3-20261025/publish-run3/county-batched 10 ${WORKERS:-5} travis-county
echo exit=$?
