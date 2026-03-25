#!/usr/bin/env bash
set -euo pipefail

LOG_FILE="${CODEX_IM_OPENCLAW_LOG_FILE:-/tmp/codex-im-openclaw.log}"

echo "[codex-im] openclaw quick"
bash ./scripts/check-openclaw-status.sh

if [ -f "$LOG_FILE" ]; then
  echo "[codex-im] key errors (last 80 lines)"
  tail -n 80 "$LOG_FILE" | grep -E "errcode=-14|openclaw poll failed|sendMessage|timeout|QR expired" || true
fi

