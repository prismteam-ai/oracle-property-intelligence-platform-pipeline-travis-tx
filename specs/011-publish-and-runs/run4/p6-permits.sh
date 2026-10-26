#!/bin/sh
# Run 4 P6: batch hash/validate/export of the permits group (Run 3 p6-permits.sh), with the oneof
# elephant-cli Run 3.1 used for export-tables (only dist/services/tables-export.service.js differs
# from the 44bb182 main copy, sha256 4b5e6a4a...; hash/validate code is identical).
R=/Users/hebagaber/Github/oracle-property-intelligence-platform-pipeline-travis-tx
D=$R/pipeline/data/runs/travis-a11-permits-run4-20261026
cd $R
ELEPHANT_CLI=$HOME/.local/share/elephant-cli-oneof/node_modules/.bin/elephant-cli \
  bash pipeline/publish/scripts/batch-hash-validate-export.sh $D/groups/property_improvement $D/publish-run4/permits-batched 5 ${WORKERS:-2} travis-permits
echo exit=$?
