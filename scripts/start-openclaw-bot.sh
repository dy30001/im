#!/bin/zsh
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "$0")" && pwd)
APP_ROOT=$(cd -- "$SCRIPT_DIR/.." && pwd)

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"

resolve_node_bin() {
  if command -v node >/dev/null 2>&1; then
    command -v node
    return 0
  fi

  for candidate in /opt/homebrew/bin/node /usr/local/bin/node /usr/bin/node; do
    if [ -x "$candidate" ]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done

  return 1
}

NODE_BIN=$(resolve_node_bin) || {
  echo "[codex-im] node binary not found; install Node.js 18+ first" >&2
  exit 1
}

mkdir -p "$HOME/.codex-im" "$HOME/Library/Logs/codex-im"
cd "$APP_ROOT"

LOCK_DIR="$HOME/.codex-im/openclaw-bot.lock"
PID_FILE="$LOCK_DIR/pid"

cleanup_lock() {
  rm -f "$PID_FILE"
  rmdir "$LOCK_DIR" >/dev/null 2>&1 || true
}

acquire_lock() {
  if mkdir "$LOCK_DIR" >/dev/null 2>&1; then
    echo "$$" > "$PID_FILE"
    return 0
  fi

  local existing_pid=""
  if [ -f "$PID_FILE" ]; then
    existing_pid=$(cat "$PID_FILE" 2>/dev/null || true)
  fi

  if [ -n "$existing_pid" ] && kill -0 "$existing_pid" >/dev/null 2>&1; then
    echo "[codex-im] openclaw-bot already running (pid=$existing_pid), skip duplicate start"
    return 1
  fi

  rm -rf "$LOCK_DIR"
  mkdir "$LOCK_DIR"
  echo "$$" > "$PID_FILE"
  return 0
}

if ! acquire_lock; then
  exit 0
fi

trap cleanup_lock EXIT INT TERM
"$NODE_BIN" "$APP_ROOT/bin/codex-im.js" openclaw-bot
