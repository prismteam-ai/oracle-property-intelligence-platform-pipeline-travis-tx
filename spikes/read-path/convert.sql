-- Proxy for elephant-cli export-tables (tables-export.service.js @ 44bb182): ZSTD level 3,
-- all strings UTF8, insertion order (no geo sort, AD-01), coordinates DOUBLE (like CLI geometry),
-- dates kept VARCHAR (like permit_issue_date). The CLI cuts row groups at a 64 MiB budget of its
-- row-size estimate (string length, else 8, + 8 per row); the measured mean estimate on this table
-- is 830.3 B/row (2026-10-21T00:22Z), so ROW_GROUP_SIZE = 64 MiB / 830.3 = 80,825 rows.
-- Run: duckdb ../austin-parquet/a.duckdb -c ".read convert.sql" from pipeline/data/raw/austin-full.
-- Output stays local (gitignored); never published.
SET preserve_insertion_order = true;
SET threads = 4;
SET memory_limit = '8GB';
SET temp_directory = '../austin-parquet/tmp';
CREATE OR REPLACE TABLE austin AS
SELECT * EXCLUDE (location, link, latitude, longitude, ":id"),
       link.url AS link,
       TRY_CAST(latitude AS DOUBLE) AS latitude,
       TRY_CAST(longitude AS DOUBLE) AS longitude,
       ":id" AS source_row_id
FROM read_json('page-*.json', format = 'array', union_by_name = true, sample_size = -1,
               maximum_object_size = 268435456, filename = false);
SELECT count(*) AS rows, count(latitude) AS with_lat FROM austin;
COPY austin TO '../austin-parquet/v1g/part-00000.parquet' (FORMAT parquet, COMPRESSION zstd, COMPRESSION_LEVEL 3, ROW_GROUP_SIZE 80825);
COPY austin TO '../austin-parquet/v256m' (FORMAT parquet, COMPRESSION zstd, COMPRESSION_LEVEL 3, ROW_GROUP_SIZE 80825, FILE_SIZE_BYTES '256MB', FILENAME_PATTERN 'part-{i}');
COPY austin TO '../austin-parquet/v128m' (FORMAT parquet, COMPRESSION zstd, COMPRESSION_LEVEL 3, ROW_GROUP_SIZE 80825, FILE_SIZE_BYTES '128MB', FILENAME_PATTERN 'part-{i}');
COPY austin TO '../austin-parquet/v48m' (FORMAT parquet, COMPRESSION zstd, COMPRESSION_LEVEL 3, ROW_GROUP_SIZE 80825, FILE_SIZE_BYTES '48MB', FILENAME_PATTERN 'part-{i}');
