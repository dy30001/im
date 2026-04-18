#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "$0")" && pwd)
APP_ROOT=$(cd -- "$SCRIPT_DIR/.." && pwd)
source "$APP_ROOT/scripts/lib/openclaw-instance.sh"

setup_openclaw_instance_env "$APP_ROOT" "${1:-}"

cd "$APP_ROOT"

HEARTBEAT_TIMEOUT_MS="${CODEX_IM_OPENCLAW_HEARTBEAT_TIMEOUT_MS:-600000}"
CONNECT_TIMEOUT_SEC="${CODEX_IM_OPENCLAW_CONNECT_TIMEOUT_SEC:-180}"
CONNECT_POLL_INTERVAL_SEC="${CODEX_IM_OPENCLAW_CONNECT_POLL_INTERVAL_SEC:-2}"
INSTANCE_CMD_SUFFIX=""
if [ -n "$OPENCLAW_INSTANCE_ID" ]; then
  INSTANCE_CMD_SUFFIX=" -- ${OPENCLAW_INSTANCE_ID}"
fi

require_command() {
  local command_name="$1"
  local message="$2"
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "[codex-im] ${message}" >&2
    exit 1
  fi
}

refresh_connect_state() {
  heartbeat_reason=""
  heartbeat_age_ms="-1"
  heartbeat_fresh="0"
  supervisor_status=""
  has_credentials="0"
  credentials_token_length="0"
  env_token_set="0"

  while IFS='=' read -r key value; do
    case "$key" in
      heartbeat_reason) heartbeat_reason="$value" ;;
      heartbeat_age_ms) heartbeat_age_ms="$value" ;;
      heartbeat_fresh) heartbeat_fresh="$value" ;;
      supervisor_status) supervisor_status="$value" ;;
      has_credentials) has_credentials="$value" ;;
      credentials_token_length) credentials_token_length="$value" ;;
      env_token_set) env_token_set="$value" ;;
    esac
  done < <(
    run_openclaw_node - "$OPENCLAW_HEARTBEAT_FILE" "$OPENCLAW_SUPERVISOR_STATE_FILE" "$OPENCLAW_CREDENTIALS_FILE" "$HEARTBEAT_TIMEOUT_MS" <<'NODE'
const fs = require("node:fs");

const [heartbeatFile, supervisorFile, credentialsFile, timeoutText] = process.argv.slice(2);
const timeoutMs = Number(timeoutText || 0);
const output = {
  heartbeat_reason: "",
  heartbeat_age_ms: "-1",
  heartbeat_fresh: "0",
  supervisor_status: "",
  has_credentials: "0",
  credentials_token_length: "0",
  env_token_set: String(process.env.CODEX_IM_OPENCLAW_TOKEN || "").trim() ? "1" : "0",
};

try {
  const heartbeat = JSON.parse(fs.readFileSync(heartbeatFile, "utf8"));
  const updatedAt = Number(heartbeat.updatedAt || 0);
  output.heartbeat_reason = String(heartbeat.reason || "").trim();
  output.heartbeat_age_ms = updatedAt > 0 ? String(Math.max(0, Date.now() - updatedAt)) : "-1";
  output.heartbeat_fresh = updatedAt > 0 && timeoutMs > 0 && (Date.now() - updatedAt) < timeoutMs ? "1" : "0";
} catch {}

try {
  const supervisor = JSON.parse(fs.readFileSync(supervisorFile, "utf8"));
  output.supervisor_status = String(supervisor.status || "").trim();
} catch {}

try {
  const credentials = JSON.parse(fs.readFileSync(credentialsFile, "utf8"));
  const token = String(credentials.token || "").trim();
  output.has_credentials = token ? "1" : "0";
  output.credentials_token_length = String(token.length);
} catch {}

for (const [key, value] of Object.entries(output)) {
  process.stdout.write(`${key}=${value}\n`);
}
NODE
  )

  supervisor_pid=""
  child_pid=""
  supervisor_alive="0"
  child_alive="0"
  service_state="stopped"

  if [ -f "$OPENCLAW_SUPERVISOR_PID_FILE" ]; then
    supervisor_pid="$(cat "$OPENCLAW_SUPERVISOR_PID_FILE" 2>/dev/null || true)"
  fi
  if [ -f "$OPENCLAW_CHILD_PID_FILE" ]; then
    child_pid="$(cat "$OPENCLAW_CHILD_PID_FILE" 2>/dev/null || true)"
  fi

  if [ -n "$supervisor_pid" ] && kill -0 "$supervisor_pid" >/dev/null 2>&1; then
    supervisor_alive="1"
  fi
  if [ -n "$child_pid" ] && kill -0 "$child_pid" >/dev/null 2>&1; then
    child_alive="1"
  fi

  if [ "$child_alive" = "1" ] && [ "$heartbeat_fresh" = "1" ]; then
    service_state="running"
  elif [ "$child_alive" = "1" ]; then
    service_state="starting"
  elif [ "$supervisor_alive" = "1" ]; then
    service_state="supervising"
  fi
}

is_connected() {
  if [ "$service_state" != "running" ]; then
    return 1
  fi

  case "$heartbeat_reason" in
    runtime-ready|poll|send|send-recover|send-retry)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

print_next_step() {
  local next_step="$1"
  if [ "$next_step" = "$last_step" ]; then
    return
  fi
  echo "[codex-im] ${next_step}"
  last_step="$next_step"
}

require_openclaw_node_bin >/dev/null

echo "[codex-im] openclaw connect"
echo "instance_id=${OPENCLAW_INSTANCE_ID:-default}"

refresh_connect_state
if is_connected; then
  echo "[codex-im] OpenClaw is already connected."
  echo "[codex-im] service_state=${service_state} heartbeat_reason=${heartbeat_reason} log_file=${OPENCLAW_LOG_FILE}"
  exit 0
fi

if [ ! -f ".env" ]; then
  cp .env.example .env
  echo "[codex-im] created .env from .env.example"
fi

if [ ! -d "node_modules" ]; then
  require_command npm "npm not found."
  echo "[codex-im] installing npm dependencies ..."
  npm install
fi

if [ "$env_token_set" = "1" ] || [ "$has_credentials" = "1" ]; then
  echo "[codex-im] found existing OpenClaw credentials, starting service ..."
else
  echo "[codex-im] no saved OpenClaw credentials found. browser should open for WeChat QR login."
fi

if [ "$(uname -s)" != "Darwin" ]; then
  require_command npm "npm not found."
fi

bash "$APP_ROOT/scripts/install-openclaw-launch-agent.sh" "${OPENCLAW_INSTANCE_ID:-}"

deadline_at=$(( $(date +%s) + CONNECT_TIMEOUT_SEC ))
last_step=""

while [ "$(date +%s)" -lt "$deadline_at" ]; do
  refresh_connect_state
  if is_connected; then
    echo "[codex-im] OpenClaw connected successfully."
    echo "[codex-im] service_state=${service_state} heartbeat_reason=${heartbeat_reason} log_file=${OPENCLAW_LOG_FILE}"
    next_status_command="$(build_openclaw_cli_command "openclaw-bot:status" "$INSTANCE_CMD_SUFFIX" || printf 'bash ./scripts/check-openclaw-status.sh')"
    echo "[codex-im] next: ${next_status_command}"
    exit 0
  fi

  case "$heartbeat_reason" in
    qr-login-ready|qr-login-refresh|qr-login-wait|qr-login-start|qr-relogin-start)
      print_next_step "waiting for WeChat QR scan ..."
      ;;
    qr-login-scaned|qr-login-scanned)
      print_next_step "QR scanned. confirm the login in WeChat ..."
      ;;
    qr-login-confirmed)
      print_next_step "QR login confirmed. waiting for runtime-ready ..."
      ;;
    runtime-ready)
      print_next_step "runtime is starting ..."
      ;;
    "")
      case "$service_state" in
        starting|supervising)
          print_next_step "starting OpenClaw service ..."
          ;;
        *)
          print_next_step "waiting for OpenClaw service ..."
          ;;
      esac
      ;;
    *)
      print_next_step "waiting for stable connection (${heartbeat_reason}) ..."
      ;;
  esac

  sleep "$CONNECT_POLL_INTERVAL_SEC"
done

refresh_connect_state
echo "[codex-im] OpenClaw connect timed out after ${CONNECT_TIMEOUT_SEC}s."
echo "[codex-im] service_state=${service_state} heartbeat_reason=${heartbeat_reason:-unknown} log_file=${OPENCLAW_LOG_FILE}"
doctor_command="$(build_openclaw_cli_command "openclaw-bot:doctor" "$INSTANCE_CMD_SUFFIX" || printf 'bash ./scripts/openclaw-doctor.sh')"
echo "[codex-im] try: ${doctor_command}"
echo "[codex-im] or:  tail -f ${OPENCLAW_LOG_FILE}"
exit 1
