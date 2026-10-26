#!/usr/bin/env bash
# A-16 A11-17 R6: runs ONE publish-run.ts step as a background worker and reports the step's REAL
# exit code. (The Run 3 worker scripts logged `$?` after an `echo "... $(date)"`, i.e. the exit
# code of `date`, so a failed upload looked like success in the worker's own log.)
#
# Usage:
#   bash pipeline/publish/scripts/publish-worker.sh <manifest> <run-id> <step> [publish-run flags...]
#   PUBLISH_FILEBASE_REVERSE=1 PUBLISH_FILEBASE_KINDS=car bash .../publish-worker.sh \
#     runs/<runId>/manifest.json <runId> filebase --copy-host <host>
#
# Prints `exit=<code> step=<step> at <utc time>` as its last line and exits with the same code.
# Environment flags (PUBLISH_*) pass through to publish-run.ts unchanged.
set -u

if [ "$#" -lt 3 ]; then
  echo "usage: publish-worker.sh <manifest> <run-id> <step> [publish-run flags...]" >&2
  exit 2
fi
MANIFEST="$1"
RUN_ID="$2"
STEP="$3"
shift 3

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
RUNNER="${PUBLISH_RUN_SCRIPT:-$SCRIPT_DIR/publish-run.ts}"

echo "worker start step=$STEP pid=$$ at $(date -u +%FT%TZ)"
npx tsx "$RUNNER" --manifest "$MANIFEST" --run-id "$RUN_ID" --step "$STEP" "$@"
rc=$? # the step's own exit code: read it BEFORE any other command (an echo with $(date) would reset it)
echo "exit=$rc step=$STEP at $(date -u +%FT%TZ)"
exit "$rc"
