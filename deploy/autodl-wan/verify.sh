#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${VELA_H3_ROOT:-/root/autodl-tmp/vela-h3}"
PORT="${COMFY_PORT:-6006}"
OBJECT_INFO="$ROOT_DIR/wan-object-info.json"
CONVERT_RESULT="$ROOT_DIR/wan-converter-check.json"

curl --silent --show-error --fail "http://127.0.0.1:$PORT/system_stats" >/dev/null
curl --silent --show-error --fail "http://127.0.0.1:$PORT/object_info" > "$OBJECT_INFO"
curl --silent --show-error --fail \
  -H 'Content-Type: application/json' \
  -X POST \
  --data '{"nodes":[],"links":[]}' \
  "http://127.0.0.1:$PORT/workflow/convert" > "$CONVERT_RESULT"

python3 - "$OBJECT_INFO" <<'PY'
import json
import sys

with open(sys.argv[1], "r", encoding="utf-8") as handle:
    object_info = json.load(handle)

required = {
    "VHS_LoadVideo", "VHS_VideoCombine", "LoadImage", "DWPreprocessor",
    "WanVideoAnimateEmbeds", "WanVideoClipVisionEncode", "WanVideoDecode",
    "WanVideoModelLoader", "WanVideoSampler", "WanVideoVAELoader",
}
missing = sorted(required.difference(object_info))
if missing:
    raise SystemExit("Missing required Wan nodes: " + ", ".join(missing))
print("Core Wan nodes verified:", ", ".join(sorted(required)))
PY

echo "Workflow converter endpoint and core Wan nodes verified."
