#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${VELA_H3_ROOT:-/root/autodl-tmp/vela-h3}"
DEPLOY_DIR="$ROOT_DIR/deploy"

bash "$DEPLOY_DIR/prepare-source.sh"
bash "$DEPLOY_DIR/install-cuda-toolchain.sh"
bash "$DEPLOY_DIR/install-runtime.sh"
bash "$DEPLOY_DIR/download-models.sh" ref2va
bash "$DEPLOY_DIR/install-accelerators.sh"
bash "$DEPLOY_DIR/start-comfy.sh"
bash "$DEPLOY_DIR/verify.sh"

echo "AutoDL MiniMax-H3 instance provisioning completed."
