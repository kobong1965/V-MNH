#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${VELA_H3_ROOT:-/root/autodl-tmp/vela-h3}"
COMFY_DIR="$ROOT_DIR/ComfyUI"
VENV_DIR="$ROOT_DIR/venv"
PORT="${COMFY_PORT:-6006}"

curl --silent --fail --connect-timeout 3 --max-time 10 "http://127.0.0.1:$PORT/system_stats" >/dev/null
curl --silent --fail --connect-timeout 3 --max-time 30 "http://127.0.0.1:$PORT/object_info" > "$ROOT_DIR/object_info.json"

"$VENV_DIR/bin/python" - "$ROOT_DIR/object_info.json" <<'PY'
import json
import sys

with open(sys.argv[1], "r", encoding="utf-8") as handle:
    object_info = json.load(handle)

required = {
    "MiniMaxH3ReferenceToVideo",
    "ImageScale",
}
missing = sorted(required.difference(object_info))
if missing:
    raise SystemExit("Missing required ComfyUI nodes: " + ", ".join(missing))

print("MiniMax-H3 nodes found:", ", ".join(sorted(required)))
print("Optional RTX VSR node:", "installed" if "RTXVideoSuperResolution" in object_info else "unavailable")
PY

partial_file="$(find "$COMFY_DIR/models" -type f -name '*.aria2' -print -quit)"
if [[ -n "$partial_file" ]]; then
  echo "Incomplete model download: $partial_file" >&2
  exit 2
fi

(
  cd "$COMFY_DIR/models"
  sha256sum --check <<'CHECKSUMS'
7c1f131492e7eddacaac9069a61b81bdd39de5cc96561e677c5eab1cdce5e522  vae/minimax_h3_video_vae_fp16.safetensors
8e505d95dd1561d47abd43d4238fd40d9bb1ae9e147ed0a4cba778d76ae4db48  vae/minimax_h3_audio_vae_fp32.safetensors
35a88d51044231fe332301d7a62aa81e3f2cba62febeb446e2c1e3e0ef76f2c6  text_encoders/qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors
9255f52b6677845ad238f20dfaafa94727053694127ab7f255c048f0f9365779  diffusion_models/minimax_h3_ref2va_pruned_int8_convrot.safetensors
5b9ab5ade15d0775676d01a907268a69a1468dc6033b3b0d3ded5502f3ebb84c  loras/minimax_h3_ref2v_turbo_4step_v0.1_comfyui_bf16.safetensors
CHECKSUMS
)

echo "AutoDL MiniMax-H3 deployment verified."
