#!/usr/bin/env bash
set -euo pipefail

echo "--- host ---"
hostname

echo "--- python/conda ---"
/root/miniconda3/bin/python --version
/root/miniconda3/bin/conda env list
/root/miniconda3/bin/python -m pip show torch torchvision torchaudio transformers av 2>/dev/null || true

echo "--- torch ---"
/root/miniconda3/bin/python - <<'PY'
import torch

print("torch:", torch.__version__)
print("torch cuda:", torch.version.cuda)
print("cuda available:", torch.cuda.is_available())
if torch.cuda.is_available():
    print("device:", torch.cuda.get_device_name(0))
    print("capability:", torch.cuda.get_device_capability(0))
PY

echo "--- tools ---"
git --version
if command -v ffmpeg >/dev/null 2>&1; then
  ffmpeg -version | head -n 1
else
  echo "ffmpeg: missing"
fi
if command -v gcc >/dev/null 2>&1; then
  gcc --version | head -n 1
else
  echo "gcc: missing"
fi
command -v nvcc || true
if [[ -x /usr/local/cuda/bin/nvcc ]]; then
  /usr/local/cuda/bin/nvcc --version | tail -n 1
fi

echo "--- storage ---"
df -h / /root/autodl-tmp

echo "--- cuda directories ---"
ls -ld /usr/local/cuda* 2>/dev/null || true
