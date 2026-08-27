#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${VELA_H3_ROOT:-/root/autodl-tmp/vela-h3}"
COMFY_DIR="$ROOT_DIR/ComfyUI"
VENV_DIR="$ROOT_DIR/venv"
PYTHON_PREFIX="$ROOT_DIR/python312"
LOG_DIR="$ROOT_DIR/logs"
MAMBA_BIN="$ROOT_DIR/tools/micromamba/bin/micromamba"
MAMBA_ROOT_PREFIX="$ROOT_DIR/micromamba-root"
MAMBA_CONFIG="$ROOT_DIR/deploy/micromamba-no-shards.yaml"
PYTHON_CONDA_CHANNEL="${PYTHON_CONDA_CHANNEL:-https://mirrors.tuna.tsinghua.edu.cn/anaconda/cloud/conda-forge}"

mkdir -p "$LOG_DIR" "$COMFY_DIR/models" "$COMFY_DIR/input" "$COMFY_DIR/output"

# AutoDL provides an HTTP(S) accelerator for large upstream artifacts. Apply it
# to the entire install so PyTorch and native-node wheels do not fall back to a
# very slow direct route.
if [[ -f /etc/network_turbo ]]; then
  source /etc/network_turbo
fi
export PIP_DEFAULT_TIMEOUT="${PIP_DEFAULT_TIMEOUT:-120}"

if [[ ! -f "$COMFY_DIR/main.py" || ! -f "$COMFY_DIR/requirements.txt" ]]; then
  echo "ComfyUI source tree is incomplete at $COMFY_DIR" >&2
  exit 3
fi

if ! command -v ffmpeg >/dev/null 2>&1 || ! command -v aria2c >/dev/null 2>&1 || ! command -v tmux >/dev/null 2>&1; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update
  apt-get install -y --no-install-recommends ffmpeg aria2 tmux ca-certificates
  apt-get clean
fi

if [[ ! -x "$PYTHON_PREFIX/bin/python" ]] || ! "$PYTHON_PREFIX/bin/python" -c 'import sys; assert sys.version_info[:2] == (3, 12)' >/dev/null 2>&1; then
  if [[ ! -x "$MAMBA_BIN" ]] || ! "$MAMBA_BIN" --version >/dev/null 2>&1; then
    echo "A working micromamba installation is required before installing Python" >&2
    exit 5
  fi
  rm -rf "$PYTHON_PREFIX"
  (
    unset http_proxy https_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY all_proxy
    "$MAMBA_BIN" create -y --rc-file "$MAMBA_CONFIG" --override-channels \
      -r "$MAMBA_ROOT_PREFIX" \
      -p "$PYTHON_PREFIX" \
      -c "$PYTHON_CONDA_CHANNEL" \
      python=3.12 pip
  )
fi

if [[ ! -x "$VENV_DIR/bin/python" ]] || ! "$VENV_DIR/bin/python" -c 'import sys; assert sys.version_info[:2] == (3, 12)' >/dev/null 2>&1; then
  rm -rf "$VENV_DIR"
  "$PYTHON_PREFIX/bin/python" -m venv "$VENV_DIR"
fi

"$VENV_DIR/bin/python" -m pip install --upgrade pip setuptools wheel packaging ninja
# Install the ordinary Python-side dependencies through a fast mainland mirror
# before the CUDA wheels. The PyTorch index hosts the accelerator wheels well,
# but its PyPI fallbacks can be extremely slow from an AutoDL instance.
"$VENV_DIR/bin/python" -m pip install --index-url http://mirrors.aliyun.com/pypi/simple \
  --trusted-host mirrors.aliyun.com \
  filelock fsspec jinja2 networkx numpy pillow sympy typing-extensions
if ! "$VENV_DIR/bin/python" - <<'PY' >/dev/null 2>&1
import torch
import torchaudio
import torchvision

assert torch.__version__.startswith("2.8.0")
assert torch.version.cuda == "12.8"
assert torchaudio.__version__.startswith("2.8.0")
assert torchvision.__version__.startswith("0.23.0")
PY
then
  # Direct CloudFront/R2 access is reliable on AutoDL, while the optional
  # accelerator can leave the PyTorch index request waiting until timeout.
  unset http_proxy https_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY all_proxy
  "$VENV_DIR/bin/python" -m pip install --upgrade --index-url https://download.pytorch.org/whl/cu128 \
    torch==2.8.0+cu128 torchvision==0.23.0+cu128 torchaudio==2.8.0+cu128
fi

# The AutoDL GitHub/PyTorch accelerator intentionally slows ordinary package
# mirrors. Return ComfyUI requirements to the instance's native CN PyPI route.
unset http_proxy https_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY all_proxy
# Workflow-template demo media now pulls several hundred megabytes of sample
# assets. It is optional at runtime and irrelevant to this headless API worker,
# so keep the backend dependency set while omitting only that meta-package.
grep -v '^comfyui-workflow-templates==' "$COMFY_DIR/requirements.txt" > "$LOG_DIR/requirements-backend.txt"
"$VENV_DIR/bin/python" -m pip install -r "$LOG_DIR/requirements-backend.txt"

if [[ -f "$COMFY_DIR/custom_nodes/Nvidia_RTX_Nodes_ComfyUI/requirements.txt" ]]; then
  NVIDIA_VFX_WHEEL="$(find "$ROOT_DIR/packages" -maxdepth 1 -type f -name 'nvidia_vfx-*.whl' -print -quit 2>/dev/null || true)"
  if [[ -n "$NVIDIA_VFX_WHEEL" ]]; then
    "$VENV_DIR/bin/python" -m pip install "$NVIDIA_VFX_WHEEL"
  else
    "$VENV_DIR/bin/python" -m pip install -r "$COMFY_DIR/custom_nodes/Nvidia_RTX_Nodes_ComfyUI/requirements.txt"
  fi
fi

"$VENV_DIR/bin/python" - <<'PY'
import torch

assert torch.cuda.is_available(), "CUDA is not available"
assert torch.cuda.get_device_capability(0) == (12, 0), "Expected an SM120 Blackwell GPU"
print("torch", torch.__version__)
print("cuda", torch.version.cuda)
print("gpu", torch.cuda.get_device_name(0))
PY

echo "Runtime installation complete."
