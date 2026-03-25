#!/usr/bin/env bash
set -euo pipefail

LOCK_DIR="${HOME}/.codex-im/openclaw-bot.lock"
PID_FILE="${LOCK_DIR}/pid"
LOG_FILE="${CODEX_IM_OPENCLAW_LOG_FILE:-/tmp/codex-im-openclaw.log}"

echo "[codex-im] openclaw status"
echo "lock_dir=${LOCK_DIR}"
echo "log_file=${LOG_FILE}"

pid_from_file=""
if [ -f "$PID_FILE" ]; then
  pid_from_file="$(cat "$PID_FILE" 2>/dev/null || true)"
fi

if [ -n "$pid_from_file" ] && kill -0 "$pid_from_file" >/dev/null 2>&1; then
  echo "lock_pid=${pid_from_file} (alive)"
else
  if [ -n "$pid_from_file" ]; then
    echo "lock_pid=${pid_from_file} (stale)"
  else
    echo "lock_pid=<none>"
  fi
fi

process_lines="$(
  ps aux 2>/dev/null | grep -E "codex-im.js openclaw-bot|node ./bin/codex-im.js openclaw-bot" | grep -v grep || true
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
