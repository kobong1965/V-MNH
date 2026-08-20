#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${VELA_H3_ROOT:-/root/autodl-tmp/vela-h3}"
COMFY_DIR="${COMFYUI_DIR:-$ROOT_DIR/ComfyUI}"
PYTHON_BIN="${COMFY_PYTHON:-$ROOT_DIR/venv/bin/python}"
CUSTOM_NODES="$COMFY_DIR/custom_nodes"

if [[ ! -d "$COMFY_DIR" ]]; then
  echo "ComfyUI directory not found: $COMFY_DIR" >&2
  exit 2
fi
if [[ ! -x "$PYTHON_BIN" ]]; then
  echo "ComfyUI Python not found: $PYTHON_BIN" >&2
  exit 2
fi

install_node() {
  local name="$1"
  local repository="$2"
  local commit="$3"
  local target="$CUSTOM_NODES/$name"

  if [[ -d "$target/.git" ]]; then
    git -C "$target" fetch --depth 1 origin "$commit"
  else
    if [[ -e "$target" ]]; then
      mv "$target" "$target.backup-$(date +%Y%m%d-%H%M%S)"
    fi
    git clone --filter=blob:none "$repository" "$target"
    git -C "$target" fetch --depth 1 origin "$commit"
  fi
  git -C "$target" checkout --detach "$commit"

  if [[ -f "$target/requirements.txt" ]]; then
    "$PYTHON_BIN" -m pip install --disable-pip-version-check -r "$target/requirements.txt"
  fi
  echo "Installed $name at $commit"
}

mkdir -p "$CUSTOM_NODES"

install_node "ComfyUI-VideoHelperSuite" \
  "https://github.com/Kosinkadink/ComfyUI-VideoHelperSuite.git" \
  "4ee72c065db22c9d96c2427954dc69e7b908444b"
install_node "ComfyUI-WanVideoWrapper" \
  "https://github.com/kijai/ComfyUI-WanVideoWrapper.git" \
  "088128b224242e110d3906c6750e9a3a348a659b"
install_node "comfyui_controlnet_aux" \
  "https://github.com/Fannovel16/comfyui_controlnet_aux.git" \
  "e8b689a513c3e6b63edc44066560ca5919c0576e"
install_node "ComfyUI-KJNodes" \
  "https://github.com/kijai/ComfyUI-KJNodes.git" \
  "3f20054214fec9f9234fd3841ae6f1e4287948f6"
install_node "rgthree-comfy" \
  "https://github.com/rgthree/rgthree-comfy.git" \
  "d92cad68a6e92a1c5d4032d3ac53f79ea44b08e4"
install_node "ComfyUI_LayerStyle" \
  "https://github.com/chflame163/ComfyUI_LayerStyle.git" \
  "557d882e184c7b702208cc7805659b10dfa06c59"
install_node "ComfyUI-Easy-Use" \
  "https://github.com/yolain/ComfyUI-Easy-Use.git" \
  "4de1ab3b66e48da916b6f263bacd001df53a2720"
install_node "ComfyUI_essentials" \
  "https://github.com/cubiq/ComfyUI_essentials.git" \
  "9d9f4bedfc9f0321c19faf71855e228c93bd0dc9"
install_node "comfyui-various" \
  "https://github.com/jamesWalker55/comfyui-various.git" \
  "ddf36c68c5fd6715b35b5c8c9b63e2eef8043bad"
install_node "cg-use-everywhere" \
  "https://github.com/chrisgoringe/cg-use-everywhere.git" \
  "50ae9f8c5d8b9538589663c90a15d4067a02969c"
install_node "ComfyUI-Custom-Scripts" \
  "https://github.com/pythongosssss/ComfyUI-Custom-Scripts.git" \
  "609f3afaa74b2f88ef9ce8d939626065e3247469"
install_node "facerestore_cf" \
  "https://github.com/mav-rik/facerestore_cf.git" \
  "ff4d7a5c102441d8f058dd6135797ffb57b6c6ad"

echo "All Wan custom nodes are installed. Run install-converter.sh, then restart ComfyUI."
