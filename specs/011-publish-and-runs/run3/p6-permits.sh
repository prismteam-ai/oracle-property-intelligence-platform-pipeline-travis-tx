#!/bin/sh
cd /Users/hebagaber/Github/run3-integration
bash pipeline/publish/scripts/batch-hash-validate-export.sh /Users/hebagaber/Github/oracle-property-intelligence-platform-pipeline-travis-tx-p/pipeline/data/runs/travis-a11-permits-run3-20261025/groups/property_improvement /Users/hebagaber/Github/oracle-property-intelligence-platform-pipeline-travis-tx-p/pipeline/data/runs/travis-a11-permits-run3-20261025/publish-run3/permits-batched 5 ${WORKERS:-2} travis-permits
echo exit=$?
