#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "$0")" && pwd)
APP_ROOT=$(cd -- "$SCRIPT_DIR/.." && pwd)
source "$APP_ROOT/scripts/lib/openclaw-instance.sh"

setup_openclaw_instance_env "$APP_ROOT" "${1:-}"

cd "$APP_ROOT"

run_openclaw_command() {
  local script_name="$1"
  run_openclaw_cli_command "$script_name"
}

extract_status_value() {
  local key="$1"
  printf '%s\n' "$STATUS_OUTPUT" \
    | awk -F= -v expected_key="$key" '$1 == expected_key { print substr($0, index($0, "=") + 1); exit }'
}

echo "[codex-im] openclaw fix"
echo "instance_id=${OPENCLAW_INSTANCE_ID:-default}"

STATUS_OUTPUT="$(bash "$APP_ROOT/scripts/check-openclaw-status.sh" "${OPENCLAW_INSTANCE_ID:-}")"
printf '%s\n' "$STATUS_OUTPUT"

ACTION_KEY="$(extract_status_value "action_key")"

case "$ACTION_KEY" in
  ready)
    echo "[codex-im] service is already ready."
    ;;
  scan-qr)
    echo "[codex-im] waiting for WeChat QR scan."
    ;;
  confirm-login)
    echo "[codex-im] QR scanned. confirm the login in WeChat."
    ;;
  wait-runtime|wait-startup|wait-restart|start-service|relogin)
    echo "[codex-im] running automatic recovery ..."
    run_openclaw_command "openclaw-bot:connect"
    ;;
  check-network|doctor|"")
    echo "[codex-im] running diagnosis ..."
    run_openclaw_command "openclaw-bot:doctor"
    ;;
  *)
    echo "[codex-im] unsupported next action: ${ACTION_KEY}. falling back to diagnosis."
    run_openclaw_command "openclaw-bot:doctor"
    ;;
esac
