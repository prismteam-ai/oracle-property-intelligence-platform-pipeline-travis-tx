#!/usr/bin/env bash
# Deploy the API stack (just deploy-api) from a clean shell: Homebrew on PATH, the cdk-lab profile, Docker through
# Colima (started if it is not running). Code-only for run 2: the serving set and the image change, no IAM change.
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="/opt/homebrew/bin:$HOME/.nvm/versions/node/v22.22.0/bin:$PATH"
export AWS_PROFILE=cdk-lab
docker info >/dev/null 2>&1 || colima start --arch aarch64 --disk 60
just deploy-api
