#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "$0")" && pwd)
APP_ROOT=$(cd -- "$SCRIPT_DIR/.." && pwd)
source "$APP_ROOT/scripts/lib/openclaw-instance.sh"

setup_openclaw_instance_env "$APP_ROOT" "${1:-}"

LOG_FILE="$OPENCLAW_LOG_FILE"

mkdir -p "$(dirname "$LOG_FILE")"

bash "$APP_ROOT/scripts/stop-openclaw-bot.sh" "${OPENCLAW_INSTANCE_ID:-}"

cd "$APP_ROOT"
if [ -n "$OPENCLAW_INSTANCE_ARG" ]; then
  nohup env \
    CODEX_IM_VERBOSE_LOGS=true \
    CODEX_IM_OPENCLAW_INSTANCE_ID="$OPENCLAW_INSTANCE_ID" \
    node ./bin/codex-im.js openclaw-bot "$OPENCLAW_INSTANCE_ARG" > "$LOG_FILE" 2>&1 &
else
  nohup env \
    CODEX_IM_VERBOSE_LOGS=true \
    node ./bin/codex-im.js openclaw-bot > "$LOG_FILE" 2>&1 &
fi

echo "[codex-im] openclaw diagnose started pid=$!"
echo "[codex-im] log file: $LOG_FILE"
