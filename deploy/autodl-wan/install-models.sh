#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${VELA_H3_ROOT:-/root/autodl-tmp/vela-h3}"
COMFY_DIR="${COMFYUI_DIR:-$ROOT_DIR/ComfyUI}"
MODELS_DIR="$COMFY_DIR/models"
MODEL_ENDPOINT="${MODEL_ENDPOINT:-https://modelscope.cn/models}"
HF_MIRROR_ENDPOINT="${HF_MIRROR_ENDPOINT:-https://hf-mirror.com}"

if [[ ! -d "$COMFY_DIR" ]]; then
  echo "ComfyUI directory not found: $COMFY_DIR" >&2
  exit 2
fi

download_model() {
  local relative_path="$1"
  local expected_bytes="$2"
  local expected_sha256="$3"
  local url="$4"
  local destination="$MODELS_DIR/$relative_path"
  local directory
  local filename
  local actual_bytes

  directory="$(dirname "$destination")"
  filename="$(basename "$destination")"
  mkdir -p "$directory"

  if [[ -f "$destination" ]]; then
    actual_bytes="$(stat -c '%s' "$destination")"
  else
    actual_bytes=0
  fi

  if [[ "$actual_bytes" != "$expected_bytes" || -f "$destination.aria2" ]]; then
    echo "Downloading $relative_path ($expected_bytes bytes)"
    aria2c \
      --allow-overwrite=true \
      --auto-file-renaming=false \
      --continue=true \
      --file-allocation=none \
      --max-connection-per-server=8 \
      --min-split-size=8M \
      --split=8 \
      --dir="$directory" \
      --out="$filename" \
      "$url"
  else
    echo "Already downloaded: $relative_path"
  fi

  actual_bytes="$(stat -c '%s' "$destination")"
  if [[ "$actual_bytes" != "$expected_bytes" ]]; then
    echo "Unexpected size for $relative_path: $actual_bytes (expected $expected_bytes)" >&2
    exit 3
  fi
  if ! echo "$expected_sha256  $destination" | sha256sum --check --status; then
    echo "Checksum mismatch for $relative_path" >&2
    exit 3
  fi
  echo "Verified $relative_path"
}

pids=()

download_model \
  "diffusion_models/Wan2_2-Animate-14B_fp8_e4m3fn_scaled_KJ.safetensors" \
  "18401760586" \
  "2936b31473a967e7a429a6646bba60e7862d0938e178b58b2a140f391dd5b8e6" \
  "$MODEL_ENDPOINT/Kijai/WanVideo_comfy_fp8_scaled/resolve/master/Wan22Animate/Wan2_2-Animate-14B_fp8_e4m3fn_scaled_KJ.safetensors" &
pids+=("$!")

download_model \
  "vae/Wan2_1_VAE_bf16.safetensors" \
  "253806278" \
  "1ab9a32cc2c740f6e39d80d367ce5dcc28db8c71b79b28670546b8973e9d75f9" \
  "$MODEL_ENDPOINT/Kijai/WanVideo_comfy/resolve/master/Wan2_1_VAE_bf16.safetensors" &
pids+=("$!")

download_model \
  "text_encoders/umt5-xxl-enc-fp8_e4m3fn.safetensors" \
  "6731333792" \
  "3fe5173588270c22505d4f9158bb1644b78331b8614206a97e92760b960c9ffa" \
  "$MODEL_ENDPOINT/Kijai/WanVideo_comfy/resolve/master/umt5-xxl-enc-fp8_e4m3fn.safetensors" &
pids+=("$!")

download_model \
  "text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors" \
  "6735906897" \
  "c3355d30191f1f066b26d93fba017ae9809dce6c627dda5f6a66eaa651204f68" \
  "$MODEL_ENDPOINT/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/master/split_files/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors" &
pids+=("$!")

download_model \
  "clip_vision/clip_vision_h.safetensors" \
  "1264219396" \
  "64a7ef761bfccbadbaa3da77366aac4185a6c58fa5de5f589b42a65bcc21f161" \
  "$MODEL_ENDPOINT/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/master/split_files/clip_vision/clip_vision_h.safetensors" &
pids+=("$!")

download_model \
  "loras/lightx2v_I2V_14B_480p_cfg_step_distill_rank64_bf16.safetensors" \
  "738005744" \
  "85c4a61c30e0497aa44b91d93a893b624708461a56fe5485183b28fa07e2dfb3" \
  "$MODEL_ENDPOINT/Kijai/WanVideo_comfy/resolve/master/Lightx2v/lightx2v_I2V_14B_480p_cfg_step_distill_rank64_bf16.safetensors" &
pids+=("$!")

download_model \
  "loras/WanAnimate_relight_lora_fp16.safetensors" \
  "1436672440" \
  "fc646c74c73f4b251f5fd9bc440ef21b03b27305f499966c68b2b3aa31498561" \
  "$MODEL_ENDPOINT/Kijai/WanVideo_comfy/resolve/master/LoRAs/Wan22_relight/WanAnimate_relight_lora_fp16.safetensors" &
pids+=("$!")

download_model \
  "../custom_nodes/comfyui_controlnet_aux/ckpts/yzd-v/DWPose/yolox_l.onnx" \
  "216746733" \
  "7860ae79de6c89a3c1eb72ae9a2756c0ccfbe04b7791bb5880afabd97855a411" \
  "$MODEL_ENDPOINT/zhangjin/DWPose/resolve/master/yolox_l.onnx" &
pids+=("$!")

download_model \
  "../custom_nodes/comfyui_controlnet_aux/ckpts/hr16/DWPose-TorchScript-BatchSize5/dw-ll_ucoco_384_bs5.torchscript.pt" \
  "135059124" \
  "d86a0b2b59fddc0901a7076e9f59c9f8602602133ed72511c693fd11eea23d91" \
  "$MODEL_ENDPOINT/svjack/DWPose-TorchScript-BatchSize5/resolve/master/dw-ll_ucoco_384_bs5.torchscript.pt" &
pids+=("$!")

download_model \
  "segformer_b2_clothes/config.json" \
  "1727" \
  "4b5127ca00fe61187b6cc6c232c9e19326ed228683f8f5c221790be9cc196a6e" \
  "$HF_MIRROR_ENDPOINT/mattmdjaga/segformer_b2_clothes/resolve/main/config.json" &
pids+=("$!")

download_model \
  "segformer_b2_clothes/preprocessor_config.json" \
  "271" \
  "a608e3a47dcfba8dc052a766babb4b6c963285ab4f176bc6c1eb2b257fd3ad93" \
  "$HF_MIRROR_ENDPOINT/mattmdjaga/segformer_b2_clothes/resolve/main/preprocessor_config.json" &
pids+=("$!")

download_model \
  "segformer_b2_clothes/model.safetensors" \
  "109493236" \
  "8f86fd90c567afd4370b3cc3a7e81ed767a632b2832a738331af660acc0c4c68" \
  "$HF_MIRROR_ENDPOINT/mattmdjaga/segformer_b2_clothes/resolve/main/model.safetensors" &
pids+=("$!")

download_model \
  "vitmatte/config.json" \
  "837" \
  "ae1006f5a83227048b563b2e60709d4203e432b2276949ebef41a8cfeeeaf45f" \
  "$MODEL_ENDPOINT/hustvl/vitmatte-small-composition-1k/resolve/master/config.json" &
pids+=("$!")

download_model \
  "vitmatte/preprocessor_config.json" \
  "284" \
  "0db558038b96a3f5c97e46d4ec8966fcc479e9aa58a391bca60b5094a5f7fee0" \
  "$MODEL_ENDPOINT/hustvl/vitmatte-small-composition-1k/resolve/master/preprocessor_config.json" &
pids+=("$!")

download_model \
  "vitmatte/model.safetensors" \
  "103294572" \
  "bda9289db1bb6762d978b42d1c62ae3f34daf7497171a347a1d09657efd788cb" \
  "$MODEL_ENDPOINT/hustvl/vitmatte-small-composition-1k/resolve/master/model.safetensors" &
pids+=("$!")

status=0
for pid in "${pids[@]}"; do
  wait "$pid" || status=1
done
if [[ "$status" != 0 ]]; then
  echo "One or more model downloads failed." >&2
  exit 4
fi

echo "All Wan Animate models are present and checksum-verified."
