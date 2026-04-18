#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "$0")" && pwd)
APP_ROOT=$(cd -- "$SCRIPT_DIR/.." && pwd)
source "$APP_ROOT/scripts/lib/openclaw-instance.sh"

setup_openclaw_instance_env "$APP_ROOT" "${1:-}"

LOCK_DIR="$OPENCLAW_LOCK_DIR"
SUPERVISOR_PID_FILE="$OPENCLAW_SUPERVISOR_PID_FILE"
CHILD_PID_FILE="$OPENCLAW_CHILD_PID_FILE"
SUPERVISOR_STATE_FILE="$OPENCLAW_SUPERVISOR_STATE_FILE"
HEARTBEAT_FILE="$OPENCLAW_HEARTBEAT_FILE"
LABEL="$OPENCLAW_LABEL"
LAUNCH_AGENT_PLIST="$OPENCLAW_LAUNCH_AGENT_PLIST"
LAUNCHD_TARGET="$OPENCLAW_LAUNCHD_TARGET"
LOG_FILE="$OPENCLAW_LOG_FILE"
HEARTBEAT_TIMEOUT_MS="${CODEX_IM_OPENCLAW_HEARTBEAT_TIMEOUT_MS:-600000}"
STARTUP_HEARTBEAT_TIMEOUT_MS="${CODEX_IM_OPENCLAW_STARTUP_HEARTBEAT_TIMEOUT_MS:-180000}"
INSTANCE_CMD_SUFFIX=""
if [ -n "$OPENCLAW_INSTANCE_ID" ]; then
  INSTANCE_CMD_SUFFIX=" -- ${OPENCLAW_INSTANCE_ID}"
fi

echo "[codex-im] openclaw status"
echo "instance_id=${OPENCLAW_INSTANCE_ID:-default}"
echo "label=${LABEL}"
echo "lock_dir=${LOCK_DIR}"
echo "log_file=${LOG_FILE}"
echo "supervisor_state_file=${SUPERVISOR_STATE_FILE}"
echo "heartbeat_file=${HEARTBEAT_FILE}"
echo "heartbeat_timeout_ms=${HEARTBEAT_TIMEOUT_MS}"
echo "startup_heartbeat_timeout_ms=${STARTUP_HEARTBEAT_TIMEOUT_MS}"
if [ -f "$LAUNCH_AGENT_PLIST" ]; then
  echo "launchd_plist=${LAUNCH_AGENT_PLIST} (present)"
else
  echo "launchd_plist=${LAUNCH_AGENT_PLIST} (missing)"
fi
if command -v launchctl >/dev/null 2>&1 && launchctl print "$LAUNCHD_TARGET" >/dev/null 2>&1; then
  launchd_status="loaded"
  echo "launchd_status=loaded"
else
  launchd_status="not_loaded"
  echo "launchd_status=not_loaded"
fi

if [ -f "$HEARTBEAT_FILE" ]; then
  heartbeat_summary="$(run_openclaw_node -e 'const fs=require("fs"); try { const p=JSON.parse(fs.readFileSync(process.argv[1], "utf8")); const updatedAt=Number(p.updatedAt||0); const reason=String(p.reason||"").trim()||"unknown"; const age=Math.max(0, Date.now()-updatedAt); process.stdout.write(`${updatedAt}|${age}|${reason}`); } catch { process.stdout.write("||"); }' "$HEARTBEAT_FILE")"
  heartbeat_updated_at="${heartbeat_summary%%|*}"
  heartbeat_rest="${heartbeat_summary#*|}"
  heartbeat_age_ms="${heartbeat_rest%%|*}"
  heartbeat_reason="${heartbeat_rest#*|}"
  echo "heartbeat_updated_at=${heartbeat_updated_at:-<unknown>}"
  echo "heartbeat_age_ms=${heartbeat_age_ms:-<unknown>}"
  echo "heartbeat_reason=${heartbeat_reason:-<unknown>}"
else
  heartbeat_updated_at="<missing>"
  heartbeat_age_ms="<missing>"
  heartbeat_reason="<missing>"
  echo "heartbeat_updated_at=<missing>"
  echo "heartbeat_age_ms=<missing>"
  echo "heartbeat_reason=<missing>"
fi

if [ -f "$SUPERVISOR_STATE_FILE" ]; then
  supervisor_summary="$(run_openclaw_node -e 'const fs=require("fs"); try { const p=JSON.parse(fs.readFileSync(process.argv[1], "utf8")); const updatedAt=Number(p.updatedAt||0); const status=String(p.status||"").trim()||"unknown"; const restartAttempt=Number(p.restartAttempt||0); const restartDelayMs=Number(p.restartDelayMs||0); const nextRestartAt=Number(p.nextRestartAt||0); const nextRestartInMs=nextRestartAt > 0 ? Math.max(0, nextRestartAt - Date.now()) : 0; const lastExitAt=Number(p.lastExitAt||0); const lastExitReason=String(p.lastExitReason||"").trim()||"unknown"; const heartbeatTimeoutMs=Number(p.heartbeatTimeoutMs||0); const startupHeartbeatTimeoutMs=Number(p.startupHeartbeatTimeoutMs||0); process.stdout.write(`${updatedAt}|${status}|${restartAttempt}|${restartDelayMs}|${nextRestartAt}|${nextRestartInMs}|${lastExitAt}|${lastExitReason}|${heartbeatTimeoutMs}|${startupHeartbeatTimeoutMs}`); } catch { process.stdout.write("||0|0|0|0|0||0|0"); }' "$SUPERVISOR_STATE_FILE")"
  supervisor_updated_at="${supervisor_summary%%|*}"
  supervisor_rest="${supervisor_summary#*|}"
  supervisor_status="${supervisor_rest%%|*}"
  supervisor_rest="${supervisor_rest#*|}"
  supervisor_restart_attempt="${supervisor_rest%%|*}"
  supervisor_rest="${supervisor_rest#*|}"
  supervisor_restart_delay_ms="${supervisor_rest%%|*}"
  supervisor_rest="${supervisor_rest#*|}"
  supervisor_next_restart_at="${supervisor_rest%%|*}"
  supervisor_rest="${supervisor_rest#*|}"
  supervisor_next_restart_in_ms="${supervisor_rest%%|*}"
  supervisor_rest="${supervisor_rest#*|}"
  supervisor_last_exit_at="${supervisor_rest%%|*}"
  supervisor_rest="${supervisor_rest#*|}"
  supervisor_last_exit_reason="${supervisor_rest%%|*}"
  supervisor_rest="${supervisor_rest#*|}"
  supervisor_heartbeat_timeout_ms="${supervisor_rest%%|*}"
  supervisor_startup_heartbeat_timeout_ms="${supervisor_rest#*|}"
  echo "supervisor_updated_at=${supervisor_updated_at:-<unknown>}"
  echo "supervisor_status=${supervisor_status:-<unknown>}"
  echo "supervisor_restart_attempt=${supervisor_restart_attempt:-0}"
  echo "supervisor_restart_delay_ms=${supervisor_restart_delay_ms:-0}"
  echo "supervisor_next_restart_at=${supervisor_next_restart_at:-0}"
  echo "supervisor_next_restart_in_ms=${supervisor_next_restart_in_ms:-0}"
  echo "supervisor_last_exit_at=${supervisor_last_exit_at:-0}"
  echo "supervisor_last_exit_reason=${supervisor_last_exit_reason:-<unknown>}"
  echo "supervisor_heartbeat_timeout_ms=${supervisor_heartbeat_timeout_ms:-0}"
  echo "supervisor_startup_heartbeat_timeout_ms=${supervisor_startup_heartbeat_timeout_ms:-0}"
else
  supervisor_status=""
  echo "supervisor_updated_at=<missing>"
  echo "supervisor_status=<missing>"
  echo "supervisor_restart_attempt=<missing>"
  echo "supervisor_restart_delay_ms=<missing>"
  echo "supervisor_next_restart_at=<missing>"
  echo "supervisor_next_restart_in_ms=<missing>"
  echo "supervisor_last_exit_at=<missing>"
  echo "supervisor_last_exit_reason=<missing>"
  echo "supervisor_heartbeat_timeout_ms=<missing>"
  echo "supervisor_startup_heartbeat_timeout_ms=<missing>"
fi

supervisor_pid=""
if [ -f "$SUPERVISOR_PID_FILE" ]; then
  supervisor_pid="$(cat "$SUPERVISOR_PID_FILE" 2>/dev/null || true)"
fi

child_pid=""
if [ -f "$CHILD_PID_FILE" ]; then
  child_pid="$(cat "$CHILD_PID_FILE" 2>/dev/null || true)"
fi

if [ -n "$supervisor_pid" ] && kill -0 "$supervisor_pid" >/dev/null 2>&1; then
  echo "lock_pid=${supervisor_pid} (alive)"
else
  if [ -n "$supervisor_pid" ]; then
    echo "lock_pid=${supervisor_pid} (stale)"
  else
    echo "lock_pid=<none>"
  fi
fi

if [ -n "$child_pid" ] && kill -0 "$child_pid" >/dev/null 2>&1; then
  echo "child_pid=${child_pid} (alive)"
else
  if [ -n "$child_pid" ]; then
    echo "child_pid=${child_pid} (stale)"
  else
    echo "child_pid=<none>"
  fi
fi

process_lines="$(list_openclaw_process_lines all || true)"
if [ -n "$process_lines" ]; then
  process_count="$(printf "%s\n" "$process_lines" | wc -l | tr -d ' ')"
  echo "process_count=${process_count}"
  printf "%s\n" "$process_lines"
else
  echo "process_count=0"
fi

if [ "$supervisor_status" = "restarting" ]; then
  service_state="restarting"
elif [ -n "$child_pid" ] && kill -0 "$child_pid" >/dev/null 2>&1; then
  if [ "${heartbeat_updated_at:-}" = "<missing>" ]; then
    service_state="starting"
  else
    service_state="running"
  fi
elif [ -n "$supervisor_pid" ] && kill -0 "$supervisor_pid" >/dev/null 2>&1; then
  service_state="supervising"
else
  service_state="stopped"
fi
echo "service_state=${service_state}"

if [ -f "$LOG_FILE" ]; then
  current_log_window="$(collect_openclaw_log_window "$LOG_FILE" "$supervisor_pid" "$child_pid" 40)"
  echo "[codex-im] current log window:"
  printf '%s\n' "$current_log_window"
else
  current_log_window=""
  echo "[codex-im] log file missing"
fi

env_token_present="0"
if [ -n "${CODEX_IM_OPENCLAW_TOKEN:-}" ]; then
  env_token_present="1"
fi

has_saved_credentials="0"
if [ -f "$OPENCLAW_CREDENTIALS_FILE" ]; then
  credentials_token_length="$(run_openclaw_node -e 'const fs=require("fs");try{const p=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write(String((p.token||"").trim().length));}catch{process.stdout.write("0");}' "$OPENCLAW_CREDENTIALS_FILE")"
  if [ "${credentials_token_length:-0}" -gt 0 ] 2>/dev/null; then
    has_saved_credentials="1"
  fi
fi

print_openclaw_next_action "$INSTANCE_CMD_SUFFIX"
