#!/usr/bin/env bash
set -euo pipefail

LOCK_DIR="${HOME}/.codex-im/openclaw-bot.lock"
SUPERVISOR_PID_FILE="${LOCK_DIR}/pid"
CHILD_PID_FILE="${LOCK_DIR}/child-pid"
HEARTBEAT_FILE="${CODEX_IM_OPENCLAW_HEARTBEAT_FILE:-${LOCK_DIR}/heartbeat.json}"
LABEL="com.dy3000.codex-im.openclaw"
LAUNCH_AGENT_PLIST="${HOME}/Library/LaunchAgents/${LABEL}.plist"
LAUNCHD_TARGET="gui/$(id -u)/${LABEL}"
LOG_FILE="${CODEX_IM_OPENCLAW_LOG_FILE:-/tmp/codex-im-openclaw.log}"
HEARTBEAT_TIMEOUT_MS="${CODEX_IM_OPENCLAW_HEARTBEAT_TIMEOUT_MS:-10800000}"

echo "[codex-im] openclaw status"
echo "lock_dir=${LOCK_DIR}"
echo "log_file=${LOG_FILE}"
echo "heartbeat_file=${HEARTBEAT_FILE}"
echo "heartbeat_timeout_ms=${HEARTBEAT_TIMEOUT_MS}"
if [ -f "$LAUNCH_AGENT_PLIST" ]; then
  echo "launchd_plist=${LAUNCH_AGENT_PLIST} (present)"
else
  echo "launchd_plist=${LAUNCH_AGENT_PLIST} (missing)"
fi
if command -v launchctl >/dev/null 2>&1 && launchctl print "$LAUNCHD_TARGET" >/dev/null 2>&1; then
  echo "launchd_status=loaded"
else
  echo "launchd_status=not_loaded"
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
  echo "heartbeat_updated_at=<missing>"
  echo "heartbeat_age_ms=<missing>"
  echo "heartbeat_reason=<missing>"
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

process_lines="$(
  ps aux 2>/dev/null | grep -E "start-openclaw-bot\.js|codex-im.js openclaw-bot" | grep -v grep || true
)"
if [ -n "$process_lines" ]; then
  process_count="$(printf "%s\n" "$process_lines" | wc -l | tr -d ' ')"
  echo "process_count=${process_count}"
  printf "%s\n" "$process_lines"
else
  echo "process_count=0"
fi

if [ -f "$LOG_FILE" ]; then
  echo "[codex-im] recent log tail:"
  tail -n 40 "$LOG_FILE"
else
  echo "[codex-im] log file missing"
fi
