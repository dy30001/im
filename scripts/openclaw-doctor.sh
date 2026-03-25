#!/usr/bin/env bash
set -euo pipefail

LOCK_DIR="${HOME}/.codex-im/openclaw-bot.lock"
PID_FILE="${LOCK_DIR}/pid"
LOG_FILE="${CODEX_IM_OPENCLAW_LOG_FILE:-/tmp/codex-im-openclaw.log}"
CREDENTIALS_FILE="${CODEX_IM_OPENCLAW_CREDENTIALS_FILE:-${HOME}/.codex-im/openclaw-credentials.json}"

echo "[codex-im] openclaw doctor"
echo "workdir=$(pwd)"
echo "lock_dir=${LOCK_DIR}"
echo "pid_file=${PID_FILE}"
echo "log_file=${LOG_FILE}"
echo "credentials_file=${CREDENTIALS_FILE}"

lock_pid=""
if [ -f "$PID_FILE" ]; then
  lock_pid="$(cat "$PID_FILE" 2>/dev/null || true)"
fi

if [ -n "$lock_pid" ] && kill -0 "$lock_pid" >/dev/null 2>&1; then
  echo "lock_pid=${lock_pid} (alive)"
else
  if [ -n "$lock_pid" ]; then
    echo "lock_pid=${lock_pid} (stale)"
  else
    echo "lock_pid=<none>"
  fi
fi

process_lines="$(
  ps aux 2>/dev/null | grep -E "codex-im.js openclaw-bot|node ./bin/codex-im.js openclaw-bot" | grep -v grep || true
)"
if [ -n "$process_lines" ]; then
  process_count="$(printf "%s\n" "$process_lines" | wc -l | tr -d ' ')"
  echo "process_count=${process_count}"
  printf "%s\n" "$process_lines"
else
  echo "process_count=0"
fi

if [ -n "${CODEX_IM_OPENCLAW_TOKEN:-}" ]; then
  echo "env_token_status=set (length=${#CODEX_IM_OPENCLAW_TOKEN})"
else
  echo "env_token_status=empty"
fi

if [ -f "$CREDENTIALS_FILE" ]; then
  saved_at="$(node -e 'const fs=require("fs");try{const p=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write(String(p.savedAt||""));}catch{process.stdout.write("");}' "$CREDENTIALS_FILE")"
  token_len="$(node -e 'const fs=require("fs");try{const p=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write(String((p.token||"").length));}catch{process.stdout.write("0");}' "$CREDENTIALS_FILE")"
  echo "credentials_status=present"
  echo "credentials_saved_at=${saved_at:-<unknown>}"
  echo "credentials_token_length=${token_len}"
else
  echo "credentials_status=missing"
fi

if [ -f "$LOG_FILE" ]; then
  echo "[codex-im] recent log tail (last 50 lines):"
  tail -n 50 "$LOG_FILE"
else
  echo "[codex-im] log file missing"
fi

echo "[codex-im] diagnosis hints"
if [ -f "$LOG_FILE" ] && grep -q "errcode=-14" "$LOG_FILE"; then
  echo "- errcode=-14: OpenClaw session timeout. Run: npm run openclaw-bot:rescan"
fi
if [ -f "$LOG_FILE" ] && grep -qi "timeout" "$LOG_FILE"; then
  echo "- timeout detected: check network and OpenClaw base URL, then retry."
fi
if [ -f "$LOG_FILE" ] && grep -q "sendMessage" "$LOG_FILE"; then
  echo "- sendMessage errors found: verify token validity and message payload shape."
fi
if [ ! -f "$LOG_FILE" ]; then
  echo "- missing log file: start daemon first with npm run openclaw-bot:daemon"
fi

