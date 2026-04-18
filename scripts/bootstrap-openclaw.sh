#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "$0")" && pwd)
APP_ROOT=$(cd -- "$SCRIPT_DIR/.." && pwd)
source "$APP_ROOT/scripts/lib/openclaw-instance.sh"

setup_openclaw_instance_env "$APP_ROOT" "${1:-}"

cd "$APP_ROOT"

echo "[codex-im] checking Node.js ..."
NODE_BIN="$(require_openclaw_node_bin)"

NODE_MAJOR=$("$NODE_BIN" -p "process.versions.node.split('.')[0]")
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "[codex-im] Node.js 18+ is required. current: $("$NODE_BIN" -v)"
  exit 1
fi

if [ ! -d "node_modules" ] && ! resolve_openclaw_npm_bin >/dev/null 2>&1; then
  echo "[codex-im] npm not found."
  exit 1
fi

if [ ! -f ".env" ]; then
  cp .env.example .env
  echo "[codex-im] created .env from .env.example"
fi

if [ ! -d "node_modules" ]; then
  NPM_BIN="$(resolve_openclaw_npm_bin)"
  echo "[codex-im] installing npm dependencies ..."
  "$NPM_BIN" install
fi

echo "[codex-im] preparing OpenClaw connection ..."
echo "[codex-im] if CODEX_IM_OPENCLAW_TOKEN is empty, startup will open browser for WeChat QR login."
exec bash ./scripts/openclaw-connect.sh "${1:-}"
