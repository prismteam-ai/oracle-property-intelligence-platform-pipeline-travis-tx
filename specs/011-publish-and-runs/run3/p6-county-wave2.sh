#!/bin/sh
# Waits for the orphaned first-wave workers (pids below) to end, then resumes the county batches
# with 3 workers (finished batches are skipped by the script's own .done markers).
for p in 99720 99723 99726 99729 99732; do
  while kill -0 $p 2>/dev/null; do sleep 15; done
done
echo "first wave ended $(date -u +%FT%TZ)"
WORKERS=3 sh /Users/hebagaber/Github/run3-integration/specs/011-publish-and-runs/run3/p6-county.sh
