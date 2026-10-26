#!/bin/sh
cd /Users/hebagaber/Github/run3-integration
npm --prefix pipeline/oracle-runtime run backbone -- permits --mode incremental
echo "exit=$?"
