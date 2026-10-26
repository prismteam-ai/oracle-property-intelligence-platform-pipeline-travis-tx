#!/bin/sh
# Every 15 min: does Filebase answer a dag/import of a small tables.car again? (Run 2's, already published.)
F=/Users/hebagaber/Github/oracle-property-intelligence-platform-pipeline-travis-tx-p/pipeline/data/runs/travis-a11-permits-fix-20261024/publish/permits-batched/tables/b05/tables.car
set -a; . ~/.config/assessment/filebase.env; set +a
TOKEN=$(printf '%s:%s:%s' "$FILEBASE_ACCESS_KEY" "$FILEBASE_SECRET_KEY" "$FILEBASE_BUCKET" | base64 | tr -d '\n')
while :; do
  r=$(curl -s -o /dev/null --max-time 180 -X POST -H "Authorization: Bearer $TOKEN" -F "file=@$F" "https://rpc.filebase.io/api/v0/dag/import?pin-roots=true&stats=true" -w "%{http_code} total=%{time_total}s")
  echo "$(date -u +%FT%TZ) dag/import probe: $r"
  case "$r" in 200*) echo "RECOVERED"; exit 0;; esac
  sleep 900
done
