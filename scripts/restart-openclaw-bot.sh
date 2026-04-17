#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "$0")" && pwd)
APP_ROOT=$(cd -- "$SCRIPT_DIR/.." && pwd)

cd "$APP_ROOT"
bash ./scripts/stop-openclaw-bot.sh "${1:-}"
bash ./scripts/install-openclaw-launch-agent.sh "${1:-}"
bash ./scripts/check-openclaw-status.sh "${1:-}"
