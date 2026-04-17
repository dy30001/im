#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "$0")" && pwd)
APP_ROOT=$(cd -- "$SCRIPT_DIR/.." && pwd)
source "$APP_ROOT/scripts/lib/openclaw-instance.sh"

setup_openclaw_instance_env "$APP_ROOT" "${1:-}"

LOCK_DIR="$OPENCLAW_LOCK_DIR"
PID_FILE="$OPENCLAW_SUPERVISOR_PID_FILE"
SUPERVISOR_STATE_FILE="$OPENCLAW_SUPERVISOR_STATE_FILE"
HEARTBEAT_FILE="$OPENCLAW_HEARTBEAT_FILE"
LOG_FILE="$OPENCLAW_LOG_FILE"
CREDENTIALS_FILE="$OPENCLAW_CREDENTIALS_FILE"
HEARTBEAT_TIMEOUT_MS="${CODEX_IM_OPENCLAW_HEARTBEAT_TIMEOUT_MS:-600000}"
STARTUP_HEARTBEAT_TIMEOUT_MS="${CODEX_IM_OPENCLAW_STARTUP_HEARTBEAT_TIMEOUT_MS:-180000}"
INSTANCE_CMD_SUFFIX=""
if [ -n "$OPENCLAW_INSTANCE_ID" ]; then
  INSTANCE_CMD_SUFFIX=" -- ${OPENCLAW_INSTANCE_ID}"
fi

echo "[codex-im] openclaw doctor"
echo "instance_id=${OPENCLAW_INSTANCE_ID:-default}"
echo "label=${OPENCLAW_LABEL}"
echo "workdir=$(pwd)"
echo "lock_dir=${LOCK_DIR}"
echo "pid_file=${PID_FILE}"
echo "log_file=${LOG_FILE}"
echo "supervisor_state_file=${SUPERVISOR_STATE_FILE}"
echo "heartbeat_file=${HEARTBEAT_FILE}"
echo "heartbeat_timeout_ms=${HEARTBEAT_TIMEOUT_MS}"
echo "startup_heartbeat_timeout_ms=${STARTUP_HEARTBEAT_TIMEOUT_MS}"
echo "credentials_file=${CREDENTIALS_FILE}"
if [ -f "$OPENCLAW_LAUNCH_AGENT_PLIST" ]; then
  echo "launchd_plist=${OPENCLAW_LAUNCH_AGENT_PLIST} (present)"
else
  echo "launchd_plist=${OPENCLAW_LAUNCH_AGENT_PLIST} (missing)"
fi

if [ -f "$HEARTBEAT_FILE" ]; then
  heartbeat_summary="$(node -e 'const fs=require("fs"); try { const p=JSON.parse(fs.readFileSync(process.argv[1], "utf8")); const updatedAt=Number(p.updatedAt||0); const reason=String(p.reason||"").trim()||"unknown"; const age=Math.max(0, Date.now()-updatedAt); process.stdout.write(`${updatedAt}|${age}|${reason}`); } catch { process.stdout.write("||"); }' "$HEARTBEAT_FILE")"
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
  supervisor_summary="$(node -e 'const fs=require("fs"); try { const p=JSON.parse(fs.readFileSync(process.argv[1], "utf8")); const updatedAt=Number(p.updatedAt||0); const status=String(p.status||"").trim()||"unknown"; const restartAttempt=Number(p.restartAttempt||0); const restartDelayMs=Number(p.restartDelayMs||0); const nextRestartAt=Number(p.nextRestartAt||0); const nextRestartInMs=nextRestartAt > 0 ? Math.max(0, nextRestartAt - Date.now()) : 0; const stableRunResetMs=Number(p.stableRunResetMs||0); const lastExitAt=Number(p.lastExitAt||0); const lastExitReason=String(p.lastExitReason||"").trim()||"unknown"; const heartbeatTimeoutMs=Number(p.heartbeatTimeoutMs||0); const startupHeartbeatTimeoutMs=Number(p.startupHeartbeatTimeoutMs||0); process.stdout.write(`${updatedAt}|${status}|${restartAttempt}|${restartDelayMs}|${nextRestartAt}|${nextRestartInMs}|${stableRunResetMs}|${lastExitAt}|${lastExitReason}|${heartbeatTimeoutMs}|${startupHeartbeatTimeoutMs}`); } catch { process.stdout.write("||0|0|0|0|0|0||0|0"); }' "$SUPERVISOR_STATE_FILE")"
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
  supervisor_stable_run_reset_ms="${supervisor_rest%%|*}"
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
  echo "supervisor_stable_run_reset_ms=${supervisor_stable_run_reset_ms:-0}"
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
  echo "supervisor_stable_run_reset_ms=<missing>"
  echo "supervisor_last_exit_at=<missing>"
  echo "supervisor_last_exit_reason=<missing>"
  echo "supervisor_heartbeat_timeout_ms=<missing>"
  echo "supervisor_startup_heartbeat_timeout_ms=<missing>"
fi
if command -v launchctl >/dev/null 2>&1 && launchctl print "$OPENCLAW_LAUNCHD_TARGET" >/dev/null 2>&1; then
  echo "launchd_status=loaded"
else
  echo "launchd_status=not_loaded"
fi

lock_pid=""
if [ -f "$PID_FILE" ]; then
  lock_pid="$(cat "$PID_FILE" 2>/dev/null || true)"
fi

if [ -n "$lock_pid" ] && kill -0 "$lock_pid" >/dev/null 2>&1; then
  echo "lock_pid=${lock_pid} (alive)"
else
  if [ -n "$lock_pid" ]; then
    echo "lock_pid=${lock_pid} (stale)"
  else
    echo "lock_pid=<none>"
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
  echo "service_state=restarting"
elif [ -n "$lock_pid" ] && kill -0 "$lock_pid" >/dev/null 2>&1 && [ "${heartbeat_updated_at:-}" = "<missing>" ]; then
  echo "service_state=starting"
elif [ "${heartbeat_updated_at:-}" != "<missing>" ] && [ "${heartbeat_age_ms:-0}" != "<unknown>" ] && [ "${heartbeat_age_ms:-0}" -lt "$HEARTBEAT_TIMEOUT_MS" ]; then
  echo "service_state=running"
elif [ -n "$lock_pid" ] && kill -0 "$lock_pid" >/dev/null 2>&1; then
  echo "service_state=supervising"
else
  echo "service_state=stopped"
fi

if [ -n "${CODEX_IM_OPENCLAW_TOKEN:-}" ]; then
  echo "env_token_status=set (length=${#CODEX_IM_OPENCLAW_TOKEN})"
else
  echo "env_token_status=empty"
fi

if [ -f "$CREDENTIALS_FILE" ]; then
  saved_at="$(node -e 'const fs=require("fs");try{const p=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write(String(p.savedAt||""));}catch{process.stdout.write("");}' "$CREDENTIALS_FILE")"
  token_len="$(node -e 'const fs=require("fs");try{const p=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write(String((p.token||"").length));}catch{process.stdout.write("0");}' "$CREDENTIALS_FILE")"
  echo "credentials_status=present"
  echo "credentials_saved_at=${saved_at:-<unknown>}"
  echo "credentials_token_length=${token_len}"
else
  echo "credentials_status=missing"
fi

if [ -f "$LOG_FILE" ]; then
  echo "[codex-im] recent log tail (last 50 lines):"
  tail -n 50 "$LOG_FILE"
else
  echo "[codex-im] log file missing"
fi

echo "[codex-im] diagnosis hints"
if [ -f "$LOG_FILE" ] && grep -q "errcode=-14" "$LOG_FILE"; then
  echo "- errcode=-14: OpenClaw session timeout. Run: npm run openclaw-bot:diagnose${INSTANCE_CMD_SUFFIX}"
fi
if [ -f "$LOG_FILE" ] && grep -qi "timeout" "$LOG_FILE"; then
  echo "- timeout detected: check network and OpenClaw base URL, then retry."
fi
if [ -f "$LOG_FILE" ] && grep -q "sendMessage" "$LOG_FILE"; then
  echo "- sendMessage errors found: verify token validity and message payload shape."
fi
if [ -f "$HEARTBEAT_FILE" ]; then
  if node -e 'const fs=require("fs"); try { const p=JSON.parse(fs.readFileSync(process.argv[1], "utf8")); const updatedAt=Number(p.updatedAt||0); const timeoutMs=Number(process.argv[2]||0); process.exit(updatedAt > 0 && Date.now() - updatedAt >= timeoutMs ? 0 : 1); } catch { process.exit(1); }' "$HEARTBEAT_FILE" "$HEARTBEAT_TIMEOUT_MS"; then
    echo "- heartbeat stale: supervisor should restart the child automatically."
  fi
fi
if [ "$supervisor_status" = "restarting" ]; then
  echo "- supervisor backoff active: next restart in ${supervisor_next_restart_in_ms:-0}ms."
fi
if [ ! -f "$LOG_FILE" ]; then
  echo "- missing log file: start daemon first with npm run openclaw-bot:daemon${INSTANCE_CMD_SUFFIX}"
fi
