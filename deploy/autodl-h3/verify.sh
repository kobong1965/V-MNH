#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${VELA_H3_ROOT:-/root/autodl-tmp/vela-h3}"
COMFY_DIR="$ROOT_DIR/ComfyUI"
VENV_DIR="$ROOT_DIR/venv"
PORT="${COMFY_PORT:-6006}"

curl --silent --fail "http://127.0.0.1:$PORT/system_stats" >/dev/null
curl --silent --fail "http://127.0.0.1:$PORT/object_info" > "$ROOT_DIR/object_info.json"

"$VENV_DIR/bin/python" - "$ROOT_DIR/object_info.json" <<'PY'
import json
import sys

with open(sys.argv[1], "r", encoding="utf-8") as handle:
    object_info = json.load(handle)

required = {
    "EmptyMiniMaxH3LatentAV",
    "MiniMaxH3ImageToVideo",
    "UpscaleModelLoader",
    "ImageUpscaleWithModel",
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
e889202c41dafb67b10d67b97f0d8541508036a6090af23425a5c2615d03c47a  diffusion_models/minimax_h3_fl2va_pruned_int8_convrot.safetensors
2339acdf19bfe123f46b971ea35d367a84adb85de43627e1eceafa5a5b2b111e  loras/minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors
c396a9a06f58399e9df9754b18299818d84a2ddd371724ba48fe4a41221437dc  loras/minimax_h3_fl2v_turbo_4step_v1.0_768p_comfyui_bf16.safetensors
49fafd45f8fd7aa8d31ab2a22d14d91b536c34494a5cfe31eb5d89c2fa266abb  upscale_models/RealESRGAN_x2plus.pth
CHECKSUMS
)

echo "AutoDL MiniMax-H3 deployment verified."
