#!/usr/bin/env bash
# Stamps asset_server_workflow into each workflow's save-node _meta.
# Run this once when adding a new workflow, then commit the updated .api.json.
set -euo pipefail

WORKFLOWS_DIR="$(cd "$(dirname "$0")/../workflows" && pwd)"

stamp() {
  local file="$WORKFLOWS_DIR/$1"
  local node_id="$2"
  local name="$3"
  jq --arg id "$node_id" --arg name "$name" \
    '.[$id]._meta.asset_server_workflow = $name' \
    "$file" > "${file}.tmp" && mv "${file}.tmp" "$file"
  echo "  $1  [node $node_id] → $name"
}

echo "Labeling workflows..."
stamp "zit-txt2img.api.json"          "9"  "zit-txt2img"
stamp "qwen-i2i-nsfw.api.json"        "6"  "qwen-i2i-nsfw"
stamp "qwen-image-edit.api.json"      "45" "qwen-image-edit"
stamp "ltx-i2v.api.json"              "75" "ltx-i2v"
stamp "qwen-pose-options.api.json"    "72" "qwen-pose"
echo "Done."
