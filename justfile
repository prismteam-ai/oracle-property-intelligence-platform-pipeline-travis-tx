# Travis County pipeline: hosted layer (T7 API, T8 explorer).
# The kit's six recipes (format, lint, type-check, test, build, deploy) plus the hosted-layer steps.
# Deploy recipes are run by the operator only, never from CI:  just profile=<aws-profile> deploy-api

set shell := ["bash", "-euo", "pipefail", "-c"]

profile := env_var_or_default("AWS_PROFILE", "")
region := "us-east-2"
cdk_dir := justfile_directory() + "/apps/api/cdk"
cdk_config := env_var_or_default("CDK_CONFIG", cdk_dir + "/config.json")

default:
    @just --list

# ---- the kit's six recipes -------------------------------------------------

setup:
    PUPPETEER_SKIP_DOWNLOAD=1 npm ci

format:
    npx prettier --check .

lint:
    npm run lint

type-check:
    npm run typecheck

test:
    npm test

build:
    npm run build

# Full ordered hosted deploy: TravisApi, explorer build against its ApiBase, TravisWeb. Operator only.
deploy: deploy-api build-explorer deploy-web

# ---- hosted layer ----------------------------------------------------------

# Export the serving set of data/deploy/current (decisions.md section 30; skipped when it is up to date).
serving:
    npm run serving -w @travis/deploy-build

# `just stage-db` takes data/deploy/current (after `just serving`); `just stage-db fixture` the fixture DB in
# full-file mode (synth, SAM local).
# Copy the serving file and deploy.json into the Docker build context.
stage-db source="current":
    #!/usr/bin/env bash
    set -euo pipefail
    case "{{ source }}" in
      current) src="data/deploy/current/serving/serving.duckdb"; meta="data/deploy/current/deploy.json" ;;
      fixture) src="packages/query/fixtures/travis-fixture.duckdb"; meta="" ;;
      *) echo "stage-db: source must be 'current' or 'fixture'" >&2; exit 1 ;;
    esac
    if [ ! -f "$src" ]; then
      echo "stage-db: $src does not exist." >&2
      if [ "{{ source }}" = "current" ]; then
        echo "  Run deploy-build first (data/deploy/current), then: just serving" >&2
      else
        echo "  The fixture DB is built by deploy-build (packages/query/fixtures)." >&2
      fi
      exit 1
    fi
    rm -rf apps/api/build/db
    mkdir -p apps/api/build/db
    cp "$src" apps/api/build/db/serving.duckdb
    if [ -n "$meta" ]; then cp "$meta" apps/api/build/db/deploy.json; else echo '{}' > apps/api/build/db/deploy.json; fi
    ls -l apps/api/build/db/

# cdk synth --strict with no AWS calls. CI: just cdk_config=apps/api/cdk/config.example.json synth
synth:
    cd "{{ cdk_dir }}" && CDK_CONFIG="{{ cdk_config }}" npx cdk synth --strict --quiet

[private]
_need-profile:
    #!/usr/bin/env bash
    if [ -z "{{ profile }}" ]; then
      echo "Set the AWS profile: just profile=<name> <recipe>   (or export AWS_PROFILE)" >&2
      exit 1
    fi

[private]
_need-docker:
    #!/usr/bin/env bash
    export PATH="/opt/homebrew/bin:$PATH"
    docker info >/dev/null 2>&1 || { echo "Docker is not running. Start it: colima start --arch aarch64 --disk 60" >&2; exit 1; }

# The upload comes first so the new image finds its files; on a first deploy (no stack yet) it follows the deploy.
# Bundle, export and stage the serving set, upload its Parquet files to the deploy bucket, `cdk deploy TravisApi`. Operator only.
deploy-api: _need-profile _need-docker build-api serving (stage-db "current")
    #!/usr/bin/env bash
    set -euo pipefail
    export PATH="/opt/homebrew/bin:$PATH"
    bucket() { aws cloudformation describe-stacks --stack-name TravisApi --region {{ region }} --profile "{{ profile }}" \
      --query "Stacks[0].Outputs[?OutputKey=='DeployBucketName'].OutputValue" --output text 2>/dev/null || true; }
    upload() { AWS_PROFILE="{{ profile }}" AWS_REGION={{ region }} npm run upload-serving -w @travis/deploy-build -- --bucket "$1"; }
    b="$(bucket)"
    if [ -n "$b" ] && [ "$b" != "None" ]; then upload "$b"; fi
    (cd "{{ cdk_dir }}" && AWS_PROFILE="{{ profile }}" CDK_CONFIG="{{ cdk_config }}" npx cdk deploy TravisApi --outputs-file "{{ cdk_dir }}/cdk.out/TravisApi.outputs.json")
    if [ -z "$b" ] || [ "$b" = "None" ]; then upload "$(bucket)"; fi
    just profile="{{ profile }}" warm

# After a deploy (deploy-api runs it) and before a live demo (decisions.md sections 31 and 32); no model call.
# Open and prime n API instances and c chat instances now.
warm n="3" c="2": _need-profile
    #!/usr/bin/env bash
    set -euo pipefail
    export PATH="/opt/homebrew/bin:$PATH"
    out() { aws cloudformation describe-stacks --stack-name TravisApi --region {{ region }} --profile "{{ profile }}" \
      --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text; }
    fn="$(out ApiFunctionName)"
    chat="$(out ChatFunctionName)"
    send() {
      for ((i = 0; i < $2; i++)); do
        aws lambda invoke --region {{ region }} --profile "{{ profile }}" --function-name "$1" --invocation-type Event \
          --cli-binary-format raw-in-base64-out --payload '{"warm":{"hold_ms":1500}}' /dev/null >/dev/null &
      done
    }
    send "$fn" "{{ n }}"
    send "$chat" "{{ c }}"
    wait
    echo "warm: {{ n }} warm-ups sent to $fn, {{ c }} to $chat (each opens and primes one instance)"

# The README two-turn conversation, one out-of-scope and one prompt injection, with the operator's credentials and real Bedrock.
# SAM local for the chat function (decisions.md section 32): SAM builds the image from cdk.out, then runs three cases.
sam-local: _need-profile _need-docker build-api (stage-db "current")
    #!/usr/bin/env bash
    set -euo pipefail
    export PATH="/opt/homebrew/bin:$PATH" SAM_CLI_TELEMETRY=0
    export DOCKER_HOST="${DOCKER_HOST:-unix://$HOME/.colima/default/docker.sock}"
    (cd "{{ cdk_dir }}" && CDK_CONFIG="{{ cdk_config }}" npx cdk synth TravisApi --strict --quiet -c sam-local=1)
    sam build ChatFunction3D7C447E -t "{{ cdk_dir }}/cdk.out/TravisApi.template.json" --use-buildkit --build-dir apps/api/build/sam
    AWS_PROFILE="{{ profile }}" npx tsx apps/api/scripts/sam-local.ts apps/api/build/sam/template.yaml apps/api/build/sam

# Replay the golden set (fixtures/rag/queries) against a base URL: just golden "$API_BASE". Writes fixtures/rag/results/.
golden target:
    npx tsx apps/api/scripts/golden.ts --target "{{ target }}"

[private]
build-api:
    npm run build -w @travis/api

# Build the explorer with VITE_API_URL = the TravisApi ApiBase output (falls back to $VITE_API_URL).
build-explorer:
    #!/usr/bin/env bash
    set -euo pipefail
    url="${VITE_API_URL:-}"
    if [ -z "$url" ] && [ -n "{{ profile }}" ]; then
      url="$(aws cloudformation describe-stacks --stack-name TravisApi --region {{ region }} --profile "{{ profile }}" \
        --query "Stacks[0].Outputs[?OutputKey=='ApiBase'].OutputValue" --output text)"
    fi
    if [ -z "$url" ] || [ "$url" = "None" ]; then
      echo "build-explorer: no API URL. Deploy TravisApi first, then: just profile=<name> build-explorer" >&2
      exit 1
    fi
    echo "VITE_API_URL=$url"
    VITE_API_URL="$url" npm run build -w @travis/explorer

# `cdk deploy TravisWeb` (explorer files from apps/explorer/dist, invalidating /index.html). Operator only.
deploy-web: _need-profile
    cd "{{ cdk_dir }}" && AWS_PROFILE="{{ profile }}" CDK_CONFIG="{{ cdk_config }}" npx cdk deploy TravisWeb --outputs-file "{{ cdk_dir }}/cdk.out/TravisWeb.outputs.json"

# Upload the Parquet mirror with deploy-build's `mirror` command (SHA-256 checked against the manifest). Operator only.
mirror: _need-profile
    #!/usr/bin/env bash
    set -euo pipefail
    bucket="$(aws cloudformation describe-stacks --stack-name TravisWeb --region {{ region }} --profile "{{ profile }}" \
      --query "Stacks[0].Outputs[?OutputKey=='MirrorBucket'].OutputValue" --output text)"
    echo "mirror bucket: $bucket"
    AWS_PROFILE="{{ profile }}" AWS_REGION={{ region }} npm run mirror -w @travis/deploy-build -- --bucket "$bucket"
