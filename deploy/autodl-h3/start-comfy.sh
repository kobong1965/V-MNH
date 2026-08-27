#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${VELA_H3_ROOT:-/root/autodl-tmp/vela-h3}"
COMFY_DIR="$ROOT_DIR/ComfyUI"
VENV_DIR="$ROOT_DIR/venv"
LOG_DIR="$ROOT_DIR/logs"
SESSION_NAME="vela-comfy"
PORT="${COMFY_PORT:-6006}"
HF_ENDPOINT="${HF_ENDPOINT:-https://hf-mirror.com}"
HEALTH_URL="http://127.0.0.1:$PORT/system_stats"

mkdir -p "$LOG_DIR"

health_ready() {
  # A wedged ComfyUI process may still accept TCP connections while never
  # answering HTTP. Bound both phases so the recovery script can replace it.
  curl --silent --fail --connect-timeout 3 --max-time 10 "$HEALTH_URL" >/dev/null
}

# AutoDL may execute the instance start command at the same time that Vela
# connects over SSH and asks ComfyUI to start. Serialize both callers so one
# invocation cannot kill the tmux session that the other one just created.
LOCK_FILE="$ROOT_DIR/start-comfy.lock"
exec 9>"$LOCK_FILE"
if ! flock -w 240 9; then
  echo "Timed out waiting for the ComfyUI startup lock" >&2
  exit 1
fi

if health_ready; then
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
  "cd '$COMFY_DIR' && export HF_ENDPOINT='$HF_ENDPOINT' && exec '$VENV_DIR/bin/python' main.py --listen 127.0.0.1 --port '$PORT' --output-directory '$COMFY_DIR/output' $ATTENTION_FLAG 2>&1 | tee '$LOG_DIR/comfyui.log'" \
  9>&-

for _ in $(seq 1 90); do
  if health_ready; then
    echo "ComfyUI is ready at http://127.0.0.1:$PORT"
    exit 0
  fi
  sleep 2
done

tail -n 200 "$LOG_DIR/comfyui.log" >&2 || true
exit 1
