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

exec "$NODE_BIN" "$APP_ROOT/bin/codex-im.js" openclaw-bot
