#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "$0")" && pwd)
APP_ROOT=$(cd -- "$SCRIPT_DIR/.." && pwd)

cd "$APP_ROOT"
bash ./scripts/stop-openclaw-bot.sh
bash ./scripts/install-openclaw-launch-agent.sh
bash ./scripts/check-openclaw-status.sh
