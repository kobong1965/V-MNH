#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${VELA_H3_ROOT:-/root/autodl-tmp/vela-h3}"
TOOLS_DIR="$ROOT_DIR/tools"
MAMBA_DIR="$TOOLS_DIR/micromamba"
MAMBA_BIN="$MAMBA_DIR/bin/micromamba"
MAMBA_DOWNLOAD="$MAMBA_BIN.download"
MAMBA_URL="https://github.com/mamba-org/micromamba-releases/releases/latest/download/micromamba-linux-64"
MAMBA_MIN_BYTES=15000000
CUDA_PREFIX="$ROOT_DIR/cuda-12.8"
MAMBA_ROOT_PREFIX="$ROOT_DIR/micromamba-root"

mkdir -p "$MAMBA_DIR" "$MAMBA_ROOT_PREFIX"

if [[ -x "$MAMBA_BIN" ]] && ! "$MAMBA_BIN" --version >/dev/null 2>&1; then
  rm -f "$MAMBA_BIN"
fi

if [[ ! -x "$MAMBA_BIN" ]]; then
  if [[ -f /etc/network_turbo ]]; then
    source /etc/network_turbo
  fi
  mkdir -p "$(dirname "$MAMBA_BIN")"
  # Some transparent accelerators terminate a large response early while still
  # returning exit code 0. Resume until the complete executable is present and
  # reject the truncated ELF before it can crash during environment creation.
  for attempt in $(seq 1 20); do
    curl -L --fail --retry 5 --retry-all-errors --connect-timeout 15 \
      --continue-at - --output "$MAMBA_DOWNLOAD" "$MAMBA_URL"
    downloaded_bytes="$(wc -c < "$MAMBA_DOWNLOAD")"
    if [[ "$downloaded_bytes" -ge "$MAMBA_MIN_BYTES" ]]; then
      break
    fi
    echo "micromamba download is incomplete (${downloaded_bytes} bytes); resuming (${attempt}/20)" >&2
    sleep 2
  done
  if [[ "$(wc -c < "$MAMBA_DOWNLOAD")" -lt "$MAMBA_MIN_BYTES" ]]; then
    echo "micromamba download remained incomplete after retries" >&2
    exit 4
  fi
  mv "$MAMBA_DOWNLOAD" "$MAMBA_BIN"
  chmod +x "$MAMBA_BIN"
fi

"$MAMBA_BIN" --version

if [[ ! -x "$CUDA_PREFIX/bin/nvcc" ]]; then
  "$MAMBA_BIN" create -y --no-rc --override-channels \
    -r "$MAMBA_ROOT_PREFIX" \
    -p "$CUDA_PREFIX" \
    -c nvidia \
    -c conda-forge \
    cuda-nvcc=12.8.93
fi

"$CUDA_PREFIX/bin/nvcc" --version
echo "CUDA 12.8 compiler toolchain is ready at $CUDA_PREFIX"
