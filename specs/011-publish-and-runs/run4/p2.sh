#!/bin/sh
# Run 4 P2a: incremental Austin permits capture + merge (durable, through Restate), as Run 3 p2.sh.
cd /Users/hebagaber/Github/oracle-property-intelligence-platform-pipeline-travis-tx
npm --prefix pipeline/oracle-runtime run backbone -- permits --mode incremental
echo "exit=$?"
