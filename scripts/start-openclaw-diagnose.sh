#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "$0")" && pwd)
APP_ROOT=$(cd -- "$SCRIPT_DIR/.." && pwd)
LOG_FILE="${CODEX_IM_OPENCLAW_LOG_FILE:-/tmp/codex-im-openclaw.log}"

mkdir -p "$(dirname "$LOG_FILE")"

bash "$APP_ROOT/scripts/stop-openclaw-bot.sh"

cd "$APP_ROOT"
nohup env \
  CODEX_IM_VERBOSE_LOGS=true \
  node ./bin/codex-im.js openclaw-bot > "$LOG_FILE" 2>&1 &

echo "[codex-im] openclaw diagnose started pid=$!"
echo "[codex-im] log file: $LOG_FILE"
