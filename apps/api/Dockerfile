# One arm64 image for both Lambda functions (CMD selects api.handler or chat.handler).
# Build context: apps/api/ with dist/*.mjs (npm run build -w @travis/api) and build/db/ (just stage-db): the serving file
# (decisions.md section 30: the small tables and the text index; the large tables are Parquet in the private deploy
# bucket, read through httpfs) and its deploy.json.
# Layer order matters: the heavy, rarely-changing layers (native binding, extensions, serving file) come before the code,
# so a code-only deploy reuses them from the registry cache.

ARG LAMBDA_BASE=public.ecr.aws/lambda/nodejs:22-arm64

FROM ${LAMBDA_BASE} AS deps
WORKDIR /build
# DuckDB 1.5.6 Node bindings, installed for linux-arm64 inside the Lambda base image.
RUN npm init -y >/dev/null \
 && npm install --omit=dev --no-audit --no-fund --os=linux --cpu=arm64 --libc=glibc @duckdb/node-api@1.5.6-r.1 \
 && test -d node_modules/@duckdb/node-bindings-linux-arm64

FROM ${LAMBDA_BASE} AS extensions
ARG DUCKDB_VERSION=1.5.6
ARG FTS_GZ_SHA256=85cb92507e4b2a385a2e0228be301f45253ac1888ea454863b8e7eb0e6369410
ARG HTTPFS_GZ_SHA256=b18472a0e85cbf15ca4ebbe335173f87b62a074cd0f26072d4c756205c6239d0
COPY docker/fetch-extension.mjs /tmp/fetch-extension.mjs
RUN node /tmp/fetch-extension.mjs fts "${DUCKDB_VERSION}" linux_arm64 "${FTS_GZ_SHA256}" /duckdb_extensions \
 && node /tmp/fetch-extension.mjs httpfs "${DUCKDB_VERSION}" linux_arm64 "${HTTPFS_GZ_SHA256}" /duckdb_extensions

FROM ${LAMBDA_BASE}
COPY --from=deps /build/node_modules ${LAMBDA_TASK_ROOT}/node_modules
COPY --from=extensions /duckdb_extensions /opt/duckdb_extensions
# The checkpointed, read-only serving file and its deploy.json. Missing => this step fails with "not found": run `just stage-db`.
COPY --chmod=0444 build/db/serving.duckdb build/db/deploy.json /opt/db/
COPY dist/api.mjs dist/chat.mjs ${LAMBDA_TASK_ROOT}/
CMD ["api.handler"]
