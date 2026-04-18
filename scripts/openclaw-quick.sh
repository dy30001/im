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
  echo "[codex-im] key errors (current run)"
  supervisor_pid="$(cat "$OPENCLAW_SUPERVISOR_PID_FILE" 2>/dev/null || true)"
  child_pid="$(cat "$OPENCLAW_CHILD_PID_FILE" 2>/dev/null || true)"
  collect_openclaw_log_window "$LOG_FILE" "$supervisor_pid" "$child_pid" 80 \
    | grep -E "errcode=-14|openclaw poll failed|sendMessage|timeout|QR expired" || true
fi
