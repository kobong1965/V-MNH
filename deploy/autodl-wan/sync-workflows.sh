#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${VELA_H3_ROOT:-/root/autodl-tmp/vela-h3}"
COMFY_DIR="${COMFYUI_DIR:-$ROOT_DIR/ComfyUI}"
SOURCE_DIR="${1:-}"
TARGET_DIR="$COMFY_DIR/user/default/workflows/vela"

if [[ -z "$SOURCE_DIR" || ! -d "$SOURCE_DIR" ]]; then
  echo "Usage: sync-workflows.sh <directory-containing-bundled-workflows>" >&2
  exit 2
fi

mkdir -p "$TARGET_DIR"
for file in wan22-animate-face-outfit.json wan22-character-replace.json; do
  if [[ ! -f "$SOURCE_DIR/$file" ]]; then
    echo "Missing workflow: $SOURCE_DIR/$file" >&2
    exit 3
  fi
  install -m 0644 "$SOURCE_DIR/$file" "$TARGET_DIR/$file"
done

echo "Wan workflows copied to $TARGET_DIR"
