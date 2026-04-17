#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "$0")" && pwd)
APP_ROOT=$(cd -- "$SCRIPT_DIR/.." && pwd)

cd "$APP_ROOT"

echo "[codex-im] checking Node.js ..."
if ! command -v node >/dev/null 2>&1; then
  echo "[codex-im] node not found. install Node.js 18+ first."
  exit 1
fi

NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]")
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "[codex-im] Node.js 18+ is required. current: $(node -v)"
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "[codex-im] npm not found."
  exit 1
fi

if [ ! -f ".env" ]; then
  cp .env.example .env
  echo "[codex-im] created .env from .env.example"
fi

echo "[codex-im] installing npm dependencies ..."
npm install

echo "[codex-im] installing OpenClaw macOS LaunchAgent ..."
echo "[codex-im] if CODEX_IM_OPENCLAW_TOKEN is empty, startup will open browser for WeChat QR login."
if [ -n "${1:-}" ]; then
  exec bash ./scripts/install-openclaw-launch-agent.sh "$1"
fi
exec npm run openclaw-bot:launchd
