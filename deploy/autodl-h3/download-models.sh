#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${VELA_H3_ROOT:-/root/autodl-tmp/vela-h3}"
MODEL_DIR="$ROOT_DIR/ComfyUI/models"
MODE="${1:-fl2va}"
HF_ENDPOINT="${HF_ENDPOINT:-https://hf-mirror.com}"
MS_ENDPOINT="${MS_ENDPOINT:-https://www.modelscope.cn/models/Comfy-Org/MiniMax-H3/resolve/master}"

mkdir -p "$MODEL_DIR/vae" "$MODEL_DIR/diffusion_models" "$MODEL_DIR/text_encoders" "$MODEL_DIR/loras"

download() {
  local url="$1"
  local output="$2"
  local expected_sha256="${3:-}"
  if [[ -s "$output" && ! -f "$output.aria2" ]]; then
    if [[ -n "$expected_sha256" ]]; then
      echo "$expected_sha256  $output" | sha256sum --check --status || {
        echo "Checksum mismatch: $output" >&2
        return 1
      }
    fi
    echo "Already present: $output"
    return
  fi
  aria2c --continue=true --max-connection-per-server=16 --split=16 --min-split-size=4M \
    --file-allocation=none --auto-file-renaming=false --allow-overwrite=true \
    --dir="$(dirname "$output")" --out="$(basename "$output")" "$url"
  if [[ -n "$expected_sha256" ]]; then
    echo "$expected_sha256  $output" | sha256sum --check
  fi
}

download "$MS_ENDPOINT/vae/minimax_h3_video_vae_fp16.safetensors" \
  "$MODEL_DIR/vae/minimax_h3_video_vae_fp16.safetensors" \
  "7c1f131492e7eddacaac9069a61b81bdd39de5cc96561e677c5eab1cdce5e522" &
download "$MS_ENDPOINT/vae/minimax_h3_audio_vae_fp32.safetensors" \
  "$MODEL_DIR/vae/minimax_h3_audio_vae_fp32.safetensors" \
  "8e505d95dd1561d47abd43d4238fd40d9bb1ae9e147ed0a4cba778d76ae4db48" &
download "$MS_ENDPOINT/text_encoders/qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors" \
  "$MODEL_DIR/text_encoders/qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors" \
  "35a88d51044231fe332301d7a62aa81e3f2cba62febeb446e2c1e3e0ef76f2c6" &

if [[ "$MODE" == "fl2va" || "$MODE" == "all" ]]; then
  download "$MS_ENDPOINT/diffusion_models/minimax_h3_fl2va_pruned_int8_convrot.safetensors" \
    "$MODEL_DIR/diffusion_models/minimax_h3_fl2va_pruned_int8_convrot.safetensors" \
    "e889202c41dafb67b10d67b97f0d8541508036a6090af23425a5c2615d03c47a" &
  download "$MS_ENDPOINT/loras/minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors" \
    "$MODEL_DIR/loras/minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors" \
    "2339acdf19bfe123f46b971ea35d367a84adb85de43627e1eceafa5a5b2b111e" &
  download "$MS_ENDPOINT/loras/minimax_h3_fl2v_turbo_4step_v1.0_768p_comfyui_bf16.safetensors" \
    "$MODEL_DIR/loras/minimax_h3_fl2v_turbo_4step_v1.0_768p_comfyui_bf16.safetensors" \
    "c396a9a06f58399e9df9754b18299818d84a2ddd371724ba48fe4a41221437dc" &
fi

if [[ "$MODE" == "ref2va" || "$MODE" == "all" ]]; then
  download "$MS_ENDPOINT/diffusion_models/minimax_h3_ref2va_pruned_int8_convrot.safetensors" \
    "$MODEL_DIR/diffusion_models/minimax_h3_ref2va_pruned_int8_convrot.safetensors" &
  download "$MS_ENDPOINT/loras/minimax_h3_ref2v_turbo_4step_v0.1_comfyui_bf16.safetensors" \
    "$MODEL_DIR/loras/minimax_h3_ref2v_turbo_4step_v0.1_comfyui_bf16.safetensors" &
fi

wait
echo "Model download completed for mode: $MODE"
