#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${VELA_H3_ROOT:-/root/autodl-tmp/vela-h3}"
VENV_DIR="$ROOT_DIR/venv"
LOG_DIR="$ROOT_DIR/logs"
UPSCALER_DIR="$ROOT_DIR/ComfyUI/models/upscale_models"
UPSCALER_PATH="$UPSCALER_DIR/RealESRGAN_x2plus.pth"
UPSCALER_SHA256="49fafd45f8fd7aa8d31ab2a22d14d91b536c34494a5cfe31eb5d89c2fa266abb"
UPSCALER_URL="${UPSCALER_URL:-https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.1/RealESRGAN_x2plus.pth}"

mkdir -p "$LOG_DIR" "$UPSCALER_DIR"
if [[ -x "$ROOT_DIR/cuda-12.8/bin/nvcc" ]]; then
  export CUDA_HOME="${CUDA_HOME:-$ROOT_DIR/cuda-12.8}"
else
  export CUDA_HOME="${CUDA_HOME:-/usr/local/cuda}"
fi
export PATH="$CUDA_HOME/bin:$VENV_DIR/bin:$PATH"
export LD_LIBRARY_PATH="$CUDA_HOME/lib:$CUDA_HOME/lib64:$VENV_DIR/lib/python3.12/site-packages/nvidia/cuda_runtime/lib:${LD_LIBRARY_PATH:-}"
export CC="${CC:-$CUDA_HOME/bin/x86_64-conda-linux-gnu-cc}"
export CXX="${CXX:-$CUDA_HOME/bin/x86_64-conda-linux-gnu-c++}"
NVIDIA_SITE="$VENV_DIR/lib/python3.12/site-packages/nvidia"
NVIDIA_INCLUDE_PATHS="$(find "$NVIDIA_SITE" -mindepth 2 -maxdepth 2 -type d -name include -print | paste -sd: -)"
NVIDIA_LIBRARY_PATHS="$(find "$NVIDIA_SITE" -mindepth 2 -maxdepth 2 -type d -name lib -print | paste -sd: -)"
CUDA_TARGET_INCLUDE="$CUDA_HOME/targets/x86_64-linux/include"
CUDA_TARGET_LIB="$CUDA_HOME/targets/x86_64-linux/lib"
export CPATH="$CUDA_HOME/include:$CUDA_TARGET_INCLUDE${NVIDIA_INCLUDE_PATHS:+:$NVIDIA_INCLUDE_PATHS}:${CPATH:-}"
export CPLUS_INCLUDE_PATH="$CUDA_HOME/include:$CUDA_TARGET_INCLUDE${NVIDIA_INCLUDE_PATHS:+:$NVIDIA_INCLUDE_PATHS}:${CPLUS_INCLUDE_PATH:-}"
export LIBRARY_PATH="$CUDA_HOME/lib:$CUDA_TARGET_LIB${NVIDIA_LIBRARY_PATHS:+:$NVIDIA_LIBRARY_PATHS}:${LIBRARY_PATH:-}"
export LD_LIBRARY_PATH="$CUDA_HOME/lib:$CUDA_TARGET_LIB${NVIDIA_LIBRARY_PATHS:+:$NVIDIA_LIBRARY_PATHS}:$LD_LIBRARY_PATH"
export TORCH_CUDA_ARCH_LIST="12.0"
export EXT_PARALLEL="${EXT_PARALLEL:-4}"
export NVCC_APPEND_FLAGS="${NVCC_APPEND_FLAGS:---threads 8}"
export MAX_JOBS="${MAX_JOBS:-22}"

"$CUDA_HOME/bin/nvcc" --version
"$VENV_DIR/bin/python" -m pip install --index-url http://mirrors.aliyun.com/pypi/simple \
  --trusted-host mirrors.aliyun.com ninja packaging

if ! "$VENV_DIR/bin/python" -c "import sageattention" >/dev/null 2>&1; then
  if [[ -f "$ROOT_DIR/sources/SageAttention/setup.py" ]]; then
    rm -rf "$ROOT_DIR/sources/SageAttention/build"
    "$VENV_DIR/bin/python" -m pip install "$ROOT_DIR/sources/SageAttention" --no-build-isolation 2>&1 | tee "$LOG_DIR/sageattention-build.log"
  else
    "$VENV_DIR/bin/python" -m pip install --index-url https://pypi.org/simple sageattention==2.2.0 --no-build-isolation 2>&1 | tee "$LOG_DIR/sageattention-build.log"
  fi
fi

"$VENV_DIR/bin/python" - <<'PY'
import torch
from sageattention import sageattn

q = torch.randn((1, 4, 128, 64), device="cuda", dtype=torch.float16)
k = torch.randn_like(q)
v = torch.randn_like(q)
out = sageattn(q, k, v, tensor_layout="HND", is_causal=False)
torch.cuda.synchronize()
assert out.shape == q.shape
assert torch.isfinite(out).all()
print("SageAttention smoke test passed:", tuple(out.shape))
PY

if [[ ! -s "$UPSCALER_PATH" || -f "$UPSCALER_PATH.aria2" ]]; then
  aria2c --continue=true --max-connection-per-server=8 --split=8 --min-split-size=1M \
    --file-allocation=none --auto-file-renaming=false --allow-overwrite=true \
    --dir="$UPSCALER_DIR" --out="$(basename "$UPSCALER_PATH")" "$UPSCALER_URL"
fi
echo "$UPSCALER_SHA256  $UPSCALER_PATH" | sha256sum --check

if "$VENV_DIR/bin/python" -c "import nvvfx" >/dev/null 2>&1; then
  echo "Optional NVIDIA RTX VSR bindings are installed; the production workflow uses Real-ESRGAN because RTX PRO 6000 runtime support must be smoke-tested per host."
else
  echo "Optional NVIDIA RTX VSR bindings are unavailable; Real-ESRGAN AI upscaling remains available." >&2
fi
