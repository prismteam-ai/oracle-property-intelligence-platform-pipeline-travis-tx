#!/bin/sh
# A-03 T021: the CI grep gates (plan research R-10; tasks T020/T021). POSIX sh, GNU or BSD grep.
# Prints every offending line as `<gate>  <path>:<line>:<text>` and exits 1 when there is one;
# exits 0 with `grep-gates: OK` otherwise; exits 2 on a usage or grep error.
#
# Usage: sh scripts/grep-gates.sh [repo-root]      (default: the parent of this script's folder)
#
# Gates (node_modules, dist, cdk.out and .turbo are never scanned):
#   reroof-terms    pipeline/oracle-runtime/travis/adapters/** (incl. socrata/socrata-pages.ts),
#                   pipeline/oracle-runtime/travis/permits/** (A-04)
#                   classification lives only in the versioned profile (P0-9; agent-design oracle § 1)
#   like-roof       packages/query-core/views.sql
#                   no LIKE / ILIKE / SIMILAR TO / GLOB against a literal and no '%…%' wildcard
#                   literal: roofing is enum equality, never text matching (P0-9)
#   query-db        pipeline/publish, apps, infra, packages
#                   no `pg` or `postgres` module (import, require, dependency), no
#                   @elephant-xyz/query-db, no DATABASE_URL, no postgres:// URL (AD-26, P0-1, P0-17)
#                   A-04 (TC-NF-02): also pipeline/oracle-runtime/travis/**: no pg word, no postgres,
#                   no DATABASE_URL (the runtime never holds a Query DB client; only
#                   pipeline/local-stack/services do: loader, tracks, report*, migrate, and the
#                   read-only clients of workflows/austin-permits.ts and tcad-backbone.ts; none
#                   of those is under the scanned paths) and no
#                   elephant-cli upload / upload to ipfs|pinata|filebase (nothing is published)
#   region-literal  apps/**/src/**, infra/{bin,src}/**, pipeline/publish/src/**, scripts/*.ts,
#                   tests/e2e/**/*.ts
#                   the region comes from configuration only (P0-18); this script and .github/
#                   are the only places a region string may appear
#   atlas-phrase    apps/web/src, docs/evidence
#                   "published to Atlas" is never said before A-11 merges Travis (P0-4, FR-002)
#
# Allow-list (documented exceptions, nothing else is skipped):
#   - a line that carries `grep-gates:allow` is skipped by every gate; put the reason on the line;
#   - the query-db gate skips the files that *are* the ban and must spell its words out:
#       packages/eslint-config/index.js            the ESLint no-restricted-imports list
#       packages/eslint-config/test/rules.test.ts  the T080 test that proves the ESLint ban fires
#       pipeline/publish/test/manifest.test.ts     the T027 test that asserts the ban on the publisher
#       infra/test/no-connection-string.test.ts    the A-11 T025 test that asserts no Postgres
#                                                   connection string or hardcoded DB host exists;
#                                                   its own pattern literals must say "postgres"
#   - the A-04 runtime scan of the query-db gate skips two A-01 files that name the words without
#     a client: travis/discovery/check-catalog.ts (the catalog secret-pattern ban list) and
#     travis/discovery/destination-proof.ts (the Docker service name and the variable name for
#     the destination proof; it runs psql inside the container, never a client library)
set -u

root=${1:-$(cd "$(dirname "$0")/.." && pwd)}
cd "$root" || exit 2

tmp=$(mktemp -d) || exit 2
trap 'rm -rf "$tmp"' EXIT

ALLOW_MARK='grep-gates:allow'
QUERY_DB_RT_ALLOW='^pipeline/oracle-runtime/travis/discovery/(check-catalog|destination-proof)\.ts:'
QUERY_DB_ALLOW='^(packages/eslint-config/index\.js|packages/eslint-config/test/rules\.test\.ts|pipeline/publish/test/manifest\.test\.ts|infra/test/no-connection-string\.test\.ts):'
# shellcheck disable=SC2089
EXCLUDE_DIRS='--exclude-dir=node_modules --exclude-dir=dist --exclude-dir=cdk.out --exclude-dir=.turbo'

violations=0

# fail_grep GATE STATUS: a grep status of 2 is an error, never a clean pass.
fail_grep() {
  if [ "$2" -gt 1 ]; then
    printf 'grep-gates: grep failed in gate %s (status %s)\n' "$1" "$2" >&2
    exit 2
  fi
}

# report GATE HITS-FILE ALLOW-REGEX: print the hits not allow-listed, count them.
report() {
  gate=$1
  hits=$2
  allow=$3
  kept="$tmp/$gate.kept"
  grep -v -- "$ALLOW_MARK" "$hits" | grep -Ev -- "$allow" > "$kept"
  if [ -s "$kept" ]; then
    n=$(wc -l < "$kept" | tr -d ' ')
    violations=$((violations + n))
    sed "s/^/$gate  /" "$kept"
  fi
}

# scan_dirs GATE PATTERN ALLOW-REGEX DIR...: recursive, case-insensitive grep over the dirs that exist.
scan_dirs() {
  gate=$1
  pat=$2
  allow=$3
  shift 3
  hits="$tmp/$gate.hits"
  : > "$hits"
  dirs=""
  for d in "$@"; do
    [ -e "$d" ] && dirs="$dirs $d"
  done
  if [ -n "$dirs" ]; then
    # shellcheck disable=SC2086
    grep -rEniIH $EXCLUDE_DIRS -e "$pat" $dirs > "$hits"
    fail_grep "$gate" $?
  fi
  report "$gate" "$hits" "$allow"
}

# scan_list GATE PATTERN ALLOW-REGEX LIST-FILE: the same over an explicit file list.
scan_list() {
  gate=$1
  pat=$2
  allow=$3
  list=$4
  hits="$tmp/$gate.hits"
  : > "$hits"
  if [ -s "$list" ]; then
    # The list becomes grep's own arguments (one path per line), not an xargs pipe: GNU xargs
    # turns grep's "no match" status 1 into 123, which fail_grep would read as an error, while
    # BSD xargs keeps 1. Calling grep directly keeps its 0/1/2 meaning on both.
    set --
    while IFS= read -r f; do
      set -- "$@" "$f"
    done < "$list"
    grep -EniIH -e "$pat" -- "$@" > "$hits"
    fail_grep "$gate" $?
  fi
  report "$gate" "$hits" "$allow"
}

NONE='^$'

# 1. reroof-terms: any roof word (reroof, re-roof, roof replace, roofing, rooftop …) or shingle.
scan_dirs reroof-terms \
  'reroof|(^|[^[:alnum:]_])roof|shingle' \
  "$NONE" \
  pipeline/oracle-runtime/travis/adapters pipeline/oracle-runtime/travis/permits

# 2. like-roof: LIKE-style operators against a literal, or any '%…' / '…%' wildcard literal.
views_list="$tmp/views.list"
: > "$views_list"
[ -f packages/query-core/views.sql ] && printf '%s\n' packages/query-core/views.sql > "$views_list"
scan_list like-roof \
  "(^|[^[:alnum:]_])(i?like|similar[[:space:]]+to|glob)[[:space:]]+'|'%[^']*'|'[^']*%'" \
  "$NONE" \
  "$views_list"

# 3. query-db: module references to pg (import/require/dependency key), postgres anywhere,
#    the Query DB client, DATABASE_URL.
scan_dirs query-db \
  "(from|import|require\()[[:space:]]*[\"']pg[\"']|\"pg\"[[:space:]]*:|postgres|@elephant-xyz/query-db|DATABASE_URL" \
  "$QUERY_DB_ALLOW" \
  pipeline/publish apps infra packages

# 3b. query-db over the oracle runtime (A-04 T012): any pg word, postgres, DATABASE_URL, and
#     any elephant-cli upload or upload to an IPFS pinning service.
scan_dirs query-db \
  "(^|[^[:alnum:]_])pg([^[:alnum:]_]|\$)|postgres|DATABASE_URL|elephant-cli.*upload|(^|[^[:alnum:]_])upload([^[:alnum:]_]).*(ipfs|pinata|filebase)" \
  "$QUERY_DB_RT_ALLOW" \
  pipeline/oracle-runtime/travis

# 4. region-literal: every AWS region id shape (eu-north-1, us-east-1, us-west-2 …).
region_pat='(af|ap|ca|cn|eu|il|me|mx|sa|us)(-gov)?-(central|north|south|east|west|northeast|northwest|southeast|southwest)-[0-9]'
region_list="$tmp/region.list"
: > "$region_list"
if [ -d apps ]; then
  find apps \( -name node_modules -o -name dist -o -name cdk.out -o -name .turbo \) -prune \
    -o -type f -path '*/src/*' -print >> "$region_list"
fi
for d in infra/bin infra/src pipeline/publish/src; do
  if [ -d "$d" ]; then
    find "$d" \( -name node_modules -o -name dist -o -name cdk.out \) -prune \
      -o -type f -print >> "$region_list"
  fi
done
[ -d scripts ] && find scripts -maxdepth 1 -type f -name '*.ts' >> "$region_list"
if [ -d tests/e2e ]; then
  find tests/e2e \( -name node_modules -o -name dist -o -name test-results -o -name playwright-report \) -prune \
    -o -type f -name '*.ts' -print >> "$region_list"
fi
scan_list region-literal "$region_pat" "$NONE" "$region_list"

# 5. atlas-phrase: the forbidden claim, any case.
scan_dirs atlas-phrase \
  'published[[:space:]]+to[[:space:]]+atlas' \
  "$NONE" \
  apps/web/src docs/evidence

if [ "$violations" -gt 0 ]; then
  printf 'grep-gates: %s violation(s)\n' "$violations" >&2
  exit 1
fi
printf 'grep-gates: OK (5 gates, root %s)\n' "$root"
exit 0
