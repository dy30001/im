#!/usr/bin/env bash
set -euo pipefail

LOCK_DIR="${HOME}/.codex-im/openclaw-bot.lock"
SUPERVISOR_PID_FILE="${LOCK_DIR}/pid"
CHILD_PID_FILE="${LOCK_DIR}/child-pid"
LABEL="com.dy3000.codex-im.openclaw"
LAUNCH_AGENT_PLIST="${HOME}/Library/LaunchAgents/${LABEL}.plist"
LAUNCHD_TARGET="gui/$(id -u)/${LABEL}"

read_pid_file() {
  local file_path="$1"
  if [ -f "$file_path" ]; then
    cat "$file_path" 2>/dev/null || true
  fi
}

is_alive() {
  local pid="$1"
  [ -n "$pid" ] && kill -0 "$pid" >/dev/null 2>&1
}

stop_pid() {
  local pid="$1"
  if ! is_alive "$pid"; then
    return 0
  fi

  kill "$pid" 2>/dev/null || true
  for _ in $(seq 1 30); do
    if ! is_alive "$pid"; then
      return 0
    fi
    sleep 0.2
  done

  kill -9 "$pid" 2>/dev/null || true
}

main() {
  local stopped=0
  if command -v launchctl >/dev/null 2>&1 && [ -f "$LAUNCH_AGENT_PLIST" ]; then
    launchctl bootout "$LAUNCHD_TARGET" >/dev/null 2>&1 || true
  fi

  local lock_pid=""
  lock_pid="$(read_pid_file "$SUPERVISOR_PID_FILE")"
  if [ -n "$lock_pid" ] && is_alive "$lock_pid"; then
    stop_pid "$lock_pid"
    stopped=1
    echo "[codex-im] stopped openclaw-bot pid=${lock_pid}"
  fi

  local child_pid=""
  child_pid="$(read_pid_file "$CHILD_PID_FILE")"
  if [ -n "$child_pid" ] && is_alive "$child_pid"; then
    stop_pid "$child_pid"
    stopped=1
    echo "[codex-im] stopped child pid=${child_pid}"
  fi

  local matched_pids
  matched_pids="$(
    ps aux 2>/dev/null \
      | grep -E "start-openclaw-bot\.js|codex-im.js openclaw-bot" \
      | grep -v grep \
      | awk '{print $2}' || true
  )"
  if [ -n "$matched_pids" ]; then
    while IFS= read -r pid; do
      [ -z "$pid" ] && continue
      if is_alive "$pid"; then
        stop_pid "$pid"
        stopped=1
        echo "[codex-im] stopped fallback pid=${pid}"
      fi
    done <<< "$matched_pids"
  fi

  rm -rf "$LOCK_DIR" || true

  if [ "$stopped" -eq 0 ]; then
    echo "[codex-im] no running openclaw-bot process found"
  fi
}

main
