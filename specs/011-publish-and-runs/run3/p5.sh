#!/bin/sh
cd /Users/hebagaber/Github/run3-integration/pipeline/local-stack
P=../../specs/011-publish-and-runs/run3/permit-pids.txt
J=travis-a11-permits-run3-20261025
npx tsx scripts/reexport-permits.ts --pids $P --job $J --chunk 500 --concurrency 6
echo exit=$?
