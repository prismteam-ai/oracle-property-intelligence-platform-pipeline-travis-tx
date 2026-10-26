#!/bin/sh
# P4: County group re-write into a fresh dir. Skips if the done marker exists.
R=/Users/hebagaber/Github/oracle-property-intelligence-platform-pipeline-travis-tx-p/pipeline/data/runs/travis-a11-county-run3-20261025
[ -f $R/.done-p4-county ] && { echo "already done"; echo exit=0; exit 0; }
cd /Users/hebagaber/Github/run3-integration
OWNER_PERSONS=publish npm --prefix pipeline/oracle-runtime run backbone -- ingest --write-group --job travis-a04-20261022052658 --out $R/groups/county
rc=$?
echo exit=$rc
[ $rc -eq 0 ] && echo "commit=$(git rev-parse --short HEAD) job=travis-a04-20261022052658 coords=travis-a04-coords-20261025083149 link=travis-a04-permits-link-20261025082311" > $R/.done-p4-county
