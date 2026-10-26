#!/usr/bin/env bash
# Stops a GitHub Actions run at its first failed job, so a red run never keeps burning runner
# minutes (and your waiting time) while other shards carry on.
#   bash scripts/ci-watch.sh [RUN_ID]      RUN_ID defaults to the latest run of the current branch.
# Polls every 30 s. Exit 0: the run finished green. Exit 1: a job failed and the run was cancelled
# (the failed job names are printed). Exit 2: the run ended some other way (for example cancelled).
set -euo pipefail

run_id="${1:-}"
if [ -z "$run_id" ]; then
  branch="$(git branch --show-current)"
  run_id="$(gh run list --branch "$branch" --limit 1 --json databaseId -q '.[0].databaseId')"
fi
echo "watching run $run_id"

while true; do
  status="$(gh run view "$run_id" --json status -q .status)"
  failed="$(gh run view "$run_id" --json jobs -q '[.jobs[] | select(.conclusion == "failure") | .name] | join(", ")')"
  if [ -n "$failed" ]; then
    echo "FAILED: $failed - cancelling run $run_id"
    gh run cancel "$run_id" >/dev/null 2>&1 || true
    exit 1
  fi
  if [ "$status" = "completed" ]; then
    conclusion="$(gh run view "$run_id" --json conclusion -q .conclusion)"
    echo "run $run_id finished: $conclusion"
    [ "$conclusion" = "success" ] && exit 0
    exit 2
  fi
  sleep 30
done
