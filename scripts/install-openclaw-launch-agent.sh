#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "$0")" && pwd)
APP_ROOT=$(cd -- "$SCRIPT_DIR/.." && pwd)
LABEL="com.dy3000.codex-im.openclaw"
PLIST_DIR="$HOME/Library/LaunchAgents"
PLIST_PATH="$PLIST_DIR/${LABEL}.plist"
TEMPLATE_PATH="$APP_ROOT/deploy/macos/${LABEL}.plist"
LOG_FILE="${CODEX_IM_OPENCLAW_LOG_FILE:-/tmp/codex-im-openclaw.log}"
USER_ID="$(id -u)"
LAUNCHD_TARGET="gui/${USER_ID}/${LABEL}"
LAUNCHD_ROOT="$HOME/.codex-im/launchd-root"
NODE_BIN="$(command -v node)"

cd "$APP_ROOT"

if [ -z "$NODE_BIN" ]; then
  echo "[codex-im] node binary not found; cannot install launchd agent" >&2
  exit 1
fi

if [ "$(uname -s)" != "Darwin" ]; then
  echo "[codex-im] launchd is only available on macOS; falling back to background daemon"
  exec npm run openclaw-bot:daemon
fi

if ! command -v launchctl >/dev/null 2>&1; then
  echo "[codex-im] launchctl not found; cannot install launchd agent" >&2
  exit 1
fi

if [ ! -f "$TEMPLATE_PATH" ]; then
  echo "[codex-im] launchd template missing: $TEMPLATE_PATH" >&2
  exit 1
fi

mkdir -p "$(dirname "$LAUNCHD_ROOT")"
ln -sfn "$APP_ROOT" "$LAUNCHD_ROOT"
bash ./scripts/stop-openclaw-bot.sh || true

mkdir -p "$PLIST_DIR"

rendered_plist="$(mktemp "${TMPDIR:-/tmp}/codex-im-launchd.XXXXXX")"
NODE_BIN="$NODE_BIN" \
SCRIPT_PATH="$LAUNCHD_ROOT/scripts/start-openclaw-bot.js" \
WORKING_DIRECTORY="$LAUNCHD_ROOT" \
STDOUT_LOG="$LOG_FILE" \
STDERR_LOG="$LOG_FILE" \
perl -0pe '
  s#__NODE_BIN__#$ENV{NODE_BIN}#g;
  s#__SCRIPT_PATH__#$ENV{SCRIPT_PATH}#g;
  s#__WORKING_DIRECTORY__#$ENV{WORKING_DIRECTORY}#g;
  s#__STDOUT_LOG__#$ENV{STDOUT_LOG}#g;
  s#__STDERR_LOG__#$ENV{STDERR_LOG}#g;
' "$TEMPLATE_PATH" > "$rendered_plist"

plutil -lint "$rendered_plist" >/dev/null
mv "$rendered_plist" "$PLIST_PATH"

launchctl bootout "$LAUNCHD_TARGET" >/dev/null 2>&1 || true
launchctl bootstrap "gui/${USER_ID}" "$PLIST_PATH"
launchctl enable "$LAUNCHD_TARGET" >/dev/null 2>&1 || true
launchctl kickstart -k "$LAUNCHD_TARGET"

sleep 2
bash ./scripts/check-openclaw-status.sh
