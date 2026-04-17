#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "$0")" && pwd)
APP_ROOT=$(cd -- "$SCRIPT_DIR/.." && pwd)
source "$APP_ROOT/scripts/lib/openclaw-instance.sh"

setup_openclaw_instance_env "$APP_ROOT" "${1:-}"

LOG_FILE="$OPENCLAW_LOG_FILE"

echo "[codex-im] openclaw quick"
bash "$APP_ROOT/scripts/check-openclaw-status.sh" "${OPENCLAW_INSTANCE_ID:-}"

if [ -f "$LOG_FILE" ]; then
  echo "[codex-im] key errors (last 80 lines)"
  tail -n 80 "$LOG_FILE" | grep -E "errcode=-14|openclaw poll failed|sendMessage|timeout|QR expired" || true
fi
