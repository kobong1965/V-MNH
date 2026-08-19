#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${VELA_H3_ROOT:-/root/autodl-tmp/vela-h3}"
COMFY_DIR="$ROOT_DIR/ComfyUI"
COMFY_REF="${COMFY_REF:-master}"
COMFY_ARCHIVE_URL="${COMFY_ARCHIVE_URL:-https://github.com/comfyanonymous/ComfyUI/archive/refs/heads/$COMFY_REF.tar.gz}"
SAGE_REF="${SAGE_REF:-main}"
SAGE_DIR="$ROOT_DIR/sources/SageAttention"
SAGE_REPOSITORY_URL="${SAGE_REPOSITORY_URL:-https://github.com/thu-ml/SageAttention.git}"

mkdir -p "$ROOT_DIR" "$ROOT_DIR/logs" "$ROOT_DIR/packages" "$ROOT_DIR/sources"

if [[ -f /etc/network_turbo ]]; then
  # AutoDL's official accelerator keeps GitHub fetches from stalling in CN regions.
  source /etc/network_turbo
fi

if [[ ! -f "$COMFY_DIR/main.py" ]]; then
  ARCHIVE_PATH="$ROOT_DIR/packages/ComfyUI-$COMFY_REF.tar.gz"
  EXTRACT_DIR="$ROOT_DIR/ComfyUI-$COMFY_REF"
  curl -L --fail --retry 5 --connect-timeout 15 --continue-at - --output "$ARCHIVE_PATH" "$COMFY_ARCHIVE_URL"
  rm -rf "$COMFY_DIR" "$EXTRACT_DIR"
  tar -xzf "$ARCHIVE_PATH" -C "$ROOT_DIR"
  mv "$EXTRACT_DIR" "$COMFY_DIR"
fi

if [[ ! -f "$SAGE_DIR/setup.py" ]]; then
  rm -rf "$SAGE_DIR"
  git clone --depth 1 --filter=blob:none --no-checkout --branch "$SAGE_REF" \
    "$SAGE_REPOSITORY_URL" "$SAGE_DIR"
  (
    cd "$SAGE_DIR"
    git sparse-checkout init --no-cone
    git sparse-checkout set '/setup.py' '/README.md' '/sageattention/' '/csrc/'
    git checkout "$SAGE_REF"
  )
fi

printf '%s\n' "$COMFY_REF" > "$ROOT_DIR/comfyui.commit"
printf '%s\n' "$SAGE_REF" > "$ROOT_DIR/sageattention.commit"
echo "ComfyUI source prepared at $COMFY_DIR"
echo "SageAttention source prepared at $SAGE_DIR"
