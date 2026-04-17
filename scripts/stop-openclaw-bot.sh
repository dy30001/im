#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "$0")" && pwd)
APP_ROOT=$(cd -- "$SCRIPT_DIR/.." && pwd)
source "$APP_ROOT/scripts/lib/openclaw-instance.sh"

setup_openclaw_instance_env "$APP_ROOT" "${1:-}"

LOCK_DIR="$OPENCLAW_LOCK_DIR"
SUPERVISOR_PID_FILE="$OPENCLAW_SUPERVISOR_PID_FILE"
CHILD_PID_FILE="$OPENCLAW_CHILD_PID_FILE"
LAUNCH_AGENT_PLIST="$OPENCLAW_LAUNCH_AGENT_PLIST"
LAUNCHD_TARGET="$OPENCLAW_LAUNCHD_TARGET"

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
    list_openclaw_process_lines all \
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
