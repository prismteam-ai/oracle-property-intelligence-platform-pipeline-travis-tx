#!/usr/bin/env bash
# A-04: the confidential-name check over the Query DB in SMALL SLICES (each psql call is short,
# so the Docker VM is never loaded by one huge scan). Prints counts per table only.
#
# Usage: scripts/verify-batched.sh <names-file>
#   <names-file>  one confidential string per line (never printed, never put on a command line:
#                 the SQL is sent to psql on stdin). Blank lines are ignored.
# Env (all optional):
#   PG_CONTAINER   container id/name; default: the `postgres` service of pipeline/local-stack
#   PGUSER         default postgres        PGDATABASE   default elephant
#   SLICE_ROWS     rows per psql call, at most 20000 (default 20000)
#   PAUSE_SECONDS  pause between slices (default 2)
#
# Tables: every ordinary table of the public schema. A table is read in heap-block ranges
# (ctid), each range sized from the table's average row density and halved until its row count
# is <= SLICE_ROWS. If Docker or the container stops answering, the script aborts cleanly
# (exit 3) and names the table to resume from with START_TABLE=<name>.
# Exit: 0 no hits, 1 hits found, 2 usage, 3 Docker unreachable.
set -u

NAMES_FILE="${1:-}"
[ -n "$NAMES_FILE" ] && [ -r "$NAMES_FILE" ] || { echo "usage: $0 <names-file>" >&2; exit 2; }
SLICE_ROWS="${SLICE_ROWS:-20000}"
[ "$SLICE_ROWS" -ge 1 ] && [ "$SLICE_ROWS" -le 20000 ] 2>/dev/null || { echo "SLICE_ROWS must be 1..20000" >&2; exit 2; }
PAUSE_SECONDS="${PAUSE_SECONDS:-2}"
PGUSER="${PGUSER:-postgres}"
PGDATABASE="${PGDATABASE:-elephant}"
START_TABLE="${START_TABLE:-}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

unreachable() {
  echo "abort: Docker or the database container is unreachable${1:+ at table $1}; nothing was changed." >&2
  [ -n "${1:-}" ] && echo "resume with: START_TABLE=$1 $0 <names-file>" >&2
  exit 3
}

docker info >/dev/null 2>&1 || unreachable
CONTAINER="${PG_CONTAINER:-$(docker compose -f "$ROOT/pipeline/local-stack/docker-compose.yml" ps -q postgres 2>/dev/null | head -n 1)}"
[ -n "$CONTAINER" ] || unreachable

# One short psql call; SQL on stdin (names stay off the process list).
q() { docker exec -i "$CONTAINER" psql -U "$PGUSER" -d "$PGDATABASE" -X -A -t -v ON_ERROR_STOP=1 -f - 2>/dev/null; }

# SQL array literal of LIKE patterns, quotes and LIKE wildcards escaped. Built once, in memory.
PATTERNS="$(awk 'NF { gsub(/\\/, "\\\\"); gsub(/%/, "\\%"); gsub(/_/, "\\_"); gsub(/\047/, "\047\047"); printf "%s\047%%%s%%\047", (n++ ? "," : ""), $0 }' "$NAMES_FILE")"
[ -n "$PATTERNS" ] || { echo "the names file has no names" >&2; exit 2; }

# Table list with block count and row density (average rows per block, at least 1).
TABLES="$(printf '%s\n' "select c.relname || '|' || (pg_relation_size(c.oid) / current_setting('block_size')::int) || '|' || greatest(1, coalesce(nullif(c.reltuples, -1), 0)::bigint / greatest(1, c.relpages)) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' order by c.relname;" | q)" || unreachable
[ -n "$TABLES" ] || unreachable

total_hits=0
started=1
[ -n "$START_TABLE" ] && started=0
while IFS='|' read -r tbl blocks density; do
  [ -n "$tbl" ] || continue
  [ "$started" -eq 1 ] || { [ "$tbl" = "$START_TABLE" ] && started=1 || continue; }
  step=$(( SLICE_ROWS / density )); [ "$step" -ge 1 ] || step=1
  start=0; hits=0; rows=0; slices=0
  [ "$blocks" -ge 1 ] || blocks=1
  while [ "$start" -lt "$blocks" ]; do
    end=$(( start + step ))
    lo="'($start,0)'::tid"; hi="'($end,0)'::tid"
    n="$(printf '%s\n' "select count(*) from \"$tbl\" where ctid >= $lo and ctid < $hi;" | q)" || unreachable "$tbl"
    if [ "${n:-0}" -gt "$SLICE_ROWS" ] && [ "$step" -gt 1 ]; then step=$(( step / 2 )); continue; fi
    h="$(printf '%s\n' "select count(*) from \"$tbl\" t where ctid >= $lo and ctid < $hi and row_to_json(t)::text ilike any (array[$PATTERNS]);" | q)" || unreachable "$tbl"
    hits=$(( hits + ${h:-0} )); rows=$(( rows + ${n:-0} )); slices=$(( slices + 1 ))
    start=$end
    sleep "$PAUSE_SECONDS"
  done
  echo "table=$tbl rows_scanned=$rows slices=$slices hits=$hits"
  total_hits=$(( total_hits + hits ))
done <<EOF
$TABLES
EOF

echo "total_hits=$total_hits"
[ "$total_hits" -eq 0 ]
