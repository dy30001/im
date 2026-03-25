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

if command -v python3 >/dev/null 2>&1; then
  echo "[codex-im] installing optional local voice dependencies (faster-whisper, ffmpeg-python) ..."
  python3 -m pip install --disable-pip-version-check faster-whisper ffmpeg-python || true
else
  echo "[codex-im] python3 not found, skip local voice dependencies."
fi

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "[codex-im] warning: ffmpeg not found. voice transcription may fail."
fi

echo "[codex-im] starting OpenClaw bot ..."
echo "[codex-im] if CODEX_IM_OPENCLAW_TOKEN is empty, startup will open browser for WeChat QR login."
exec npm run openclaw-bot
