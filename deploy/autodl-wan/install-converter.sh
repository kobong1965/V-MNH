#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${VELA_H3_ROOT:-/root/autodl-tmp/vela-h3}"
COMFY_DIR="${COMFYUI_DIR:-$ROOT_DIR/ComfyUI}"
TARGET="$COMFY_DIR/custom_nodes/comfyui-workflow-to-api-converter-endpoint"
REPOSITORY="https://github.com/SethRobinson/comfyui-workflow-to-api-converter-endpoint.git"
PINNED_COMMIT="bc8538278f82053b3ca10a44d62d02596f8e1a37"

if [[ ! -d "$COMFY_DIR" ]]; then
  echo "ComfyUI directory not found: $COMFY_DIR" >&2
  exit 2
fi

if [[ -d "$TARGET/.git" ]]; then
  git -C "$TARGET" fetch --depth 1 origin "$PINNED_COMMIT"
else
  git clone --filter=blob:none "$REPOSITORY" "$TARGET"
fi
git -C "$TARGET" checkout --detach "$PINNED_COMMIT"

echo "Workflow converter installed at pinned commit $PINNED_COMMIT"
echo "Restart ComfyUI before running verify.sh."
