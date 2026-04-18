#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "$0")" && pwd)
APP_ROOT=$(cd -- "$SCRIPT_DIR/.." && pwd)
source "$APP_ROOT/scripts/lib/openclaw-instance.sh"

setup_openclaw_instance_env "$APP_ROOT" "${1:-}"

LABEL="$OPENCLAW_LABEL"
PLIST_DIR="$HOME/Library/LaunchAgents"
PLIST_PATH="$PLIST_DIR/${LABEL}.plist"
TEMPLATE_PATH="$APP_ROOT/deploy/macos/com.dy3000.codex-im.openclaw.plist"
LOG_FILE="$OPENCLAW_LOG_FILE"
USER_ID="$(id -u)"
LAUNCHD_TARGET="gui/${USER_ID}/${LABEL}"
LAUNCHD_ROOT="$HOME/.codex-im/launchd-root"
NODE_BIN="$(resolve_openclaw_node_bin || true)"
INSTANCE_ARG_XML=""
if [ -n "$OPENCLAW_INSTANCE_ARG" ]; then
  INSTANCE_ARG_XML="    <string>${OPENCLAW_INSTANCE_ARG}</string>"
fi

cd "$APP_ROOT"

if [ -z "$NODE_BIN" ]; then
  echo "[codex-im] node binary not found; cannot install launchd agent" >&2
  exit 1
fi

if [ "$(uname -s)" != "Darwin" ]; then
  echo "[codex-im] launchd is only available on macOS; falling back to background daemon"
  exec bash ./scripts/start-openclaw-bot.sh "${OPENCLAW_INSTANCE_ID:-}"
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
bash ./scripts/stop-openclaw-bot.sh "${OPENCLAW_INSTANCE_ID:-}" || true

mkdir -p "$PLIST_DIR"

rendered_plist="$(mktemp "${TMPDIR:-/tmp}/codex-im-launchd.XXXXXX")"
ENV_FILE="${CODEX_IM_OPENCLAW_ENV_FILE:-}"
NODE_BIN="$NODE_BIN" \
LABEL="$LABEL" \
SCRIPT_PATH="$LAUNCHD_ROOT/scripts/start-openclaw-bot.js" \
WORKING_DIRECTORY="$LAUNCHD_ROOT" \
STDOUT_LOG="$LOG_FILE" \
STDERR_LOG="$LOG_FILE" \
INSTANCE_ARG_XML="$INSTANCE_ARG_XML" \
INSTANCE_ID="$OPENCLAW_INSTANCE_ID" \
ENV_FILE="$ENV_FILE" \
perl -0pe '
  s#__LABEL__#$ENV{LABEL}#g;
  s#__NODE_BIN__#$ENV{NODE_BIN}#g;
  s#__SCRIPT_PATH__#$ENV{SCRIPT_PATH}#g;
  s#__WORKING_DIRECTORY__#$ENV{WORKING_DIRECTORY}#g;
  s#__STDOUT_LOG__#$ENV{STDOUT_LOG}#g;
  s#__STDERR_LOG__#$ENV{STDERR_LOG}#g;
  s#__INSTANCE_ARG_XML__#$ENV{INSTANCE_ARG_XML}#g;
  s#__INSTANCE_ID__#$ENV{INSTANCE_ID}#g;
  s#__ENV_FILE__#$ENV{ENV_FILE}#g;
' "$TEMPLATE_PATH" > "$rendered_plist"

plutil -lint "$rendered_plist" >/dev/null
mv "$rendered_plist" "$PLIST_PATH"

launchctl bootout "$LAUNCHD_TARGET" >/dev/null 2>&1 || true
launchctl bootstrap "gui/${USER_ID}" "$PLIST_PATH"
launchctl enable "$LAUNCHD_TARGET" >/dev/null 2>&1 || true
launchctl kickstart -k "$LAUNCHD_TARGET"

sleep 2
bash ./scripts/check-openclaw-status.sh "${OPENCLAW_INSTANCE_ID:-}"
