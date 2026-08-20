#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${VELA_H3_ROOT:-/root/autodl-tmp/vela-h3}"
COMFY_DIR="${COMFYUI_DIR:-$ROOT_DIR/ComfyUI}"
PORT="${COMFY_PORT:-6006}"
WORKFLOW_DIR="${1:-$COMFY_DIR/user/default/workflows/vela}"
OBJECT_INFO="$ROOT_DIR/wan-object-info.json"
CONVERTED_DIR="$ROOT_DIR/wan-converted"
PYTHON_BIN="${PYTHON_BIN:-$ROOT_DIR/venv/bin/python}"

workflow_files=(
  "wan22-animate-face-outfit.json"
  "wan22-character-replace.json"
)

curl --silent --show-error --fail "http://127.0.0.1:$PORT/system_stats" >/dev/null
curl --silent --show-error --fail "http://127.0.0.1:$PORT/object_info" > "$OBJECT_INFO"
mkdir -p "$CONVERTED_DIR"

for file in "${workflow_files[@]}"; do
  if [[ ! -f "$WORKFLOW_DIR/$file" ]]; then
    echo "Missing workflow: $WORKFLOW_DIR/$file" >&2
    exit 2
  fi
  curl --silent --show-error --fail \
    -H 'Content-Type: application/json' \
    -X POST \
    --data-binary "@$WORKFLOW_DIR/$file" \
    "http://127.0.0.1:$PORT/workflow/convert" > "$CONVERTED_DIR/$file"
done

"$PYTHON_BIN" - "$OBJECT_INFO" "$CONVERTED_DIR" "$COMFY_DIR" <<'PY'
import json
import pathlib
import sys

object_info_path = pathlib.Path(sys.argv[1])
converted_dir = pathlib.Path(sys.argv[2])
comfy_dir = pathlib.Path(sys.argv[3])

with object_info_path.open("r", encoding="utf-8") as handle:
    object_info = json.load(handle)

converted_files = sorted(converted_dir.glob("wan22-*.json"))
if len(converted_files) != 2:
    raise SystemExit("Expected two converted Wan workflows")

required_classes = set()
converted_text = []
converted_graphs = []
for converted_file in converted_files:
    with converted_file.open("r", encoding="utf-8") as handle:
        graph = json.load(handle)
    if not isinstance(graph, dict) or not graph:
        raise SystemExit(f"Converted workflow is empty: {converted_file.name}")
    for node in graph.values():
        if isinstance(node, dict) and node.get("class_type"):
            required_classes.add(node["class_type"])
    converted_graphs.append((converted_file.name, graph))
    converted_text.append(json.dumps(graph, ensure_ascii=False))

missing_classes = sorted(required_classes.difference(object_info))
if missing_classes:
    raise SystemExit("Missing required Wan nodes: " + ", ".join(missing_classes))

invalid_combos = []
runtime_media_inputs = {
    ("LoadImage", "image"),
    ("VHS_LoadVideo", "video"),
}
for filename, graph in converted_graphs:
    for node_id, node in graph.items():
        class_type = node.get("class_type")
        node_info = object_info.get(class_type, {})
        input_info = node_info.get("input", {})
        definitions = {
            **input_info.get("required", {}),
            **input_info.get("optional", {}),
        }
        for input_name, value in node.get("inputs", {}).items():
            if (class_type, input_name) in runtime_media_inputs:
                continue
            specification = definitions.get(input_name)
            if not isinstance(specification, list) or not specification:
                continue
            choices = specification[0]
            if isinstance(choices, list) and isinstance(value, str) and value not in choices:
                invalid_combos.append(f"{filename}:{node_id}:{class_type}.{input_name}={value}")
if invalid_combos:
    raise SystemExit("Invalid ComfyUI combo/model selections: " + ", ".join(invalid_combos))

required_models = [
    "diffusion_models/Wan2_2-Animate-14B_fp8_e4m3fn_scaled_KJ.safetensors",
    "vae/Wan2_1_VAE_bf16.safetensors",
    "text_encoders/umt5-xxl-enc-fp8_e4m3fn.safetensors",
    "text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors",
    "clip_vision/clip_vision_h.safetensors",
    "loras/lightx2v_I2V_14B_480p_cfg_step_distill_rank64_bf16.safetensors",
    "loras/WanAnimate_relight_lora_fp16.safetensors",
    "segformer_b2_clothes/config.json",
    "segformer_b2_clothes/preprocessor_config.json",
    "segformer_b2_clothes/model.safetensors",
    "vitmatte/config.json",
    "vitmatte/preprocessor_config.json",
    "vitmatte/model.safetensors",
]
missing_models = [
    path for path in required_models
    if not (comfy_dir / "models" / path).is_file()
]
if missing_models:
    raise SystemExit("Missing required Wan models: " + ", ".join(missing_models))

required_aux_models = [
    "custom_nodes/comfyui_controlnet_aux/ckpts/yzd-v/DWPose/yolox_l.onnx",
    "custom_nodes/comfyui_controlnet_aux/ckpts/hr16/DWPose-TorchScript-BatchSize5/dw-ll_ucoco_384_bs5.torchscript.pt",
]
missing_aux_models = [path for path in required_aux_models if not (comfy_dir / path).is_file()]
if missing_aux_models:
    raise SystemExit("Missing required DWPose models: " + ", ".join(missing_aux_models))

portable_names = {
    "clip_vision_h.safetensors",
    "lightx2v_I2V_14B_480p_cfg_step_distill_rank64_bf16.safetensors",
    "WanAnimate_relight_lora_fp16.safetensors",
}
all_converted = "\n".join(converted_text)
missing_references = sorted(name for name in portable_names if name not in all_converted)
if missing_references:
    raise SystemExit("Converted workflows do not reference portable model names: " + ", ".join(missing_references))

print(f"Verified {len(required_classes)} node classes across both Wan workflows")
print(f"Verified {len(required_models) + len(required_aux_models)} checksum-managed model files")
PY

echo "Both full Wan workflows, converter endpoint, nodes and models verified."
