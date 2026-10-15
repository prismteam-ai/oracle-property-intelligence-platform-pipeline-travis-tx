FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends unzip ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json turbo.json ./
COPY packages/pipeline/package.json packages/pipeline/
COPY packages/mcp/package.json packages/mcp/
COPY apps/explorer/package.json apps/explorer/
COPY infra/package.json infra/
RUN npm ci --workspace @oracle/pipeline --include-workspace-root
COPY packages/pipeline packages/pipeline
RUN npm run build -w @oracle/pipeline
ENV ORACLE_DATA_DIR=/app/data ORACLE_RUNS_DIR=/app/runs HOME=/tmp
CMD ["node", "packages/pipeline/dist/cli/runner.js"]
