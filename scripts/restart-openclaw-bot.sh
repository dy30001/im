#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "$0")" && pwd)
APP_ROOT=$(cd -- "$SCRIPT_DIR/.." && pwd)

cd "$APP_ROOT"
bash ./scripts/stop-openclaw-bot.sh
node ./scripts/start-openclaw-bot.js
bash ./scripts/check-openclaw-status.sh

