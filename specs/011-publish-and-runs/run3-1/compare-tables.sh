#!/bin/bash
# Run 3.1 (ERR-74): row-for-row comparison of every table with Run 3 (EXCEPT ALL both ways).
# address is compared on Run 3's four columns (the patched export adds the address fields).
R=/Users/hebagaber/Github/oracle-property-intelligence-platform-pipeline-travis-tx-p/pipeline/data/runs
cmp_group() { # <label> <old tables dir> <new tables dir>
  local O=$2 N=$3 q=""
  for t in $(ls "$O/b01" | grep -v '\.car$'); do
    if [ "$t" = address ]; then cols="cid, property_cid, data_group_cid, request_identifier"; else cols="*"; fi
    q="$q select '$1' grp, '$t' tbl, (select count(*) from read_parquet('$O/b*/$t/*.parquet')) run3_rows, (select count(*) from read_parquet('$N/b*/$t/*.parquet')) run3_1_rows, (select count(*) from (select $cols from read_parquet('$O/b*/$t/*.parquet') except all select $cols from read_parquet('$N/b*/$t/*.parquet'))) only_run3, (select count(*) from (select $cols from read_parquet('$N/b*/$t/*.parquet') except all select $cols from read_parquet('$O/b*/$t/*.parquet'))) only_run3_1 union all"
  done
  duckdb -markdown -c "${q% union all};"
}
cmp_group county "$R/travis-a11-county-run3-20261025/publish-run3/county-batched/tables" "$R/travis-a11-county-run3-20261025/publish-run3-1/county-batched/tables"
cmp_group permits "$R/travis-a11-permits-run3-20261025/publish-run3/permits-batched/tables" "$R/travis-a11-permits-run3-1-20261026/publish-run3-1-oneof/permits-batched/tables"
