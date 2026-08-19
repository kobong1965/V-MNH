#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${VELA_H3_ROOT:-/root/autodl-tmp/vela-h3}"
COMFY_DIR="$ROOT_DIR/ComfyUI"
VENV_DIR="$ROOT_DIR/venv"
LOG_DIR="$ROOT_DIR/logs"
SESSION_NAME="vela-comfy"
PORT="${COMFY_PORT:-6006}"

mkdir -p "$LOG_DIR"

if curl --silent --fail "http://127.0.0.1:$PORT/system_stats" >/dev/null; then
  echo "ComfyUI is already ready at http://127.0.0.1:$PORT"
  exit 0
fi

if tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
  tmux kill-session -t "$SESSION_NAME"
fi

ATTENTION_FLAG=""
if "$VENV_DIR/bin/python" -c "import sageattention" >/dev/null 2>&1; then
  ATTENTION_FLAG="--use-sage-attention"
fi

tmux new-session -d -s "$SESSION_NAME" \
  "cd '$COMFY_DIR' && exec '$VENV_DIR/bin/python' main.py --listen 127.0.0.1 --port '$PORT' --output-directory '$COMFY_DIR/output' $ATTENTION_FLAG 2>&1 | tee '$LOG_DIR/comfyui.log'"

for _ in $(seq 1 90); do
  if curl --silent --fail "http://127.0.0.1:$PORT/system_stats" >/dev/null; then
    echo "ComfyUI is ready at http://127.0.0.1:$PORT"
    exit 0
  fi
  sleep 2
done

tail -n 200 "$LOG_DIR/comfyui.log" >&2 || true
exit 1
