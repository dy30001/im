#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "$0")" && pwd)
APP_ROOT=$(cd -- "$SCRIPT_DIR/.." && pwd)
DEFAULT_CREDENTIALS_FILE="${HOME}/.codex-im/openclaw-credentials.json"
CREDENTIALS_FILE="${CODEX_IM_OPENCLAW_CREDENTIALS_FILE:-$DEFAULT_CREDENTIALS_FILE}"
TS="$(date +%Y%m%d%H%M%S)"

echo "[codex-im] openclaw rescan starting"

pkill -f "codex-im.js openclaw-bot" 2>/dev/null || true
rm -rf "${HOME}/.codex-im/openclaw-bot.lock" || true

if [ -f "$CREDENTIALS_FILE" ]; then
  BACKUP_PATH="${CREDENTIALS_FILE}.bak.rescan.${TS}"
  mv "$CREDENTIALS_FILE" "$BACKUP_PATH"
  echo "[codex-im] backed up credentials to ${BACKUP_PATH}"
else
  echo "[codex-im] no credentials file found at ${CREDENTIALS_FILE}"
fi

echo "[codex-im] starting QR login flow ..."
cd "$APP_ROOT"
exec env CODEX_IM_OPENCLAW_TOKEN= npm run openclaw-bot:diagnose

