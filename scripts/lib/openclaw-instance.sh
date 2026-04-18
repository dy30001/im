#!/usr/bin/env bash

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"

load_openclaw_env_file() {
  local env_path="${1:-}"
  if [ -z "$env_path" ] || [ ! -f "$env_path" ]; then
    return
  fi

  set -a
  # shellcheck disable=SC1090
  . "$env_path"
  set +a
}

normalize_openclaw_instance_id() {
  local raw_value="${1:-}"
  printf '%s' "$raw_value" \
    | tr '[:upper:]' '[:lower:]' \
    | sed -E 's/[^a-z0-9._-]+/-/g; s/^-+//; s/-+$//'
}

setup_openclaw_instance_env() {
  local app_root="$1"
  local requested_instance_id="${2:-}"
  local requested_normalized=""
  local instance_id=""
  local default_env_file=""

  requested_normalized="$(normalize_openclaw_instance_id "$requested_instance_id")"
  load_openclaw_env_file "${app_root}/.env"
  load_openclaw_env_file "${HOME}/.codex-im/.env"

  if [ -n "$requested_normalized" ]; then
    export CODEX_IM_OPENCLAW_INSTANCE_ID="$requested_normalized"
  fi

  instance_id="$(normalize_openclaw_instance_id "${CODEX_IM_OPENCLAW_INSTANCE_ID:-}")"
  if [ -n "${CODEX_IM_OPENCLAW_ENV_FILE:-}" ]; then
    load_openclaw_env_file "${CODEX_IM_OPENCLAW_ENV_FILE}"
  fi

  if [ -z "${CODEX_IM_OPENCLAW_ENV_FILE:-}" ] && [ -n "$instance_id" ]; then
    default_env_file="${HOME}/.codex-im/openclaw-${instance_id}.env"
    export CODEX_IM_OPENCLAW_ENV_FILE="$default_env_file"
    load_openclaw_env_file "$default_env_file"
  fi

  if [ -n "$requested_normalized" ]; then
    instance_id="$requested_normalized"
    export CODEX_IM_OPENCLAW_INSTANCE_ID="$instance_id"
  else
    instance_id="$(normalize_openclaw_instance_id "${CODEX_IM_OPENCLAW_INSTANCE_ID:-}")"
    if [ -n "$instance_id" ]; then
      export CODEX_IM_OPENCLAW_INSTANCE_ID="$instance_id"
    fi
  fi

  OPENCLAW_INSTANCE_ID="$instance_id"
  OPENCLAW_INSTANCE_ARG=""
  if [ -n "$OPENCLAW_INSTANCE_ID" ]; then
    OPENCLAW_INSTANCE_ARG="--instance=${OPENCLAW_INSTANCE_ID}"
  fi

  OPENCLAW_LABEL="com.dy3000.codex-im.openclaw"
  if [ -n "$OPENCLAW_INSTANCE_ID" ]; then
    OPENCLAW_LABEL="${OPENCLAW_LABEL}.${OPENCLAW_INSTANCE_ID}"
  fi

  OPENCLAW_LOCK_DIR="${CODEX_IM_OPENCLAW_LOCK_DIR:-${HOME}/.codex-im/openclaw-bot${OPENCLAW_INSTANCE_ID:+.${OPENCLAW_INSTANCE_ID}}.lock}"
  OPENCLAW_SUPERVISOR_PID_FILE="${OPENCLAW_LOCK_DIR}/pid"
  OPENCLAW_CHILD_PID_FILE="${OPENCLAW_LOCK_DIR}/child-pid"
  OPENCLAW_SUPERVISOR_STATE_FILE="${OPENCLAW_LOCK_DIR}/supervisor-state.json"
  OPENCLAW_HEARTBEAT_FILE="${CODEX_IM_OPENCLAW_HEARTBEAT_FILE:-${OPENCLAW_LOCK_DIR}/heartbeat.json}"
  OPENCLAW_LOG_FILE="${CODEX_IM_OPENCLAW_LOG_FILE:-/tmp/codex-im-openclaw${OPENCLAW_INSTANCE_ID:+-${OPENCLAW_INSTANCE_ID}}.log}"
  OPENCLAW_CREDENTIALS_FILE="${CODEX_IM_OPENCLAW_CREDENTIALS_FILE:-${HOME}/.codex-im/openclaw-credentials${OPENCLAW_INSTANCE_ID:+.${OPENCLAW_INSTANCE_ID}}.json}"
  OPENCLAW_LAUNCH_AGENT_PLIST="${HOME}/Library/LaunchAgents/${OPENCLAW_LABEL}.plist"
  OPENCLAW_LAUNCHD_TARGET="gui/$(id -u)/${OPENCLAW_LABEL}"

  export CODEX_IM_OPENCLAW_LOCK_DIR="$OPENCLAW_LOCK_DIR"
  export CODEX_IM_OPENCLAW_HEARTBEAT_FILE="$OPENCLAW_HEARTBEAT_FILE"
  export CODEX_IM_OPENCLAW_LOG_FILE="$OPENCLAW_LOG_FILE"
  export CODEX_IM_OPENCLAW_CREDENTIALS_FILE="$OPENCLAW_CREDENTIALS_FILE"
  if [ -n "$OPENCLAW_INSTANCE_ID" ] && [ -z "${CODEX_IM_SESSIONS_FILE:-}" ]; then
    export CODEX_IM_SESSIONS_FILE="${HOME}/.codex-im/openclaw-sessions.${OPENCLAW_INSTANCE_ID}.json"
  fi
}

resolve_openclaw_node_bin() {
  local candidate=""

  if [ -n "${CODEX_IM_NODE_BIN:-}" ] && [ -x "${CODEX_IM_NODE_BIN}" ]; then
    printf '%s\n' "${CODEX_IM_NODE_BIN}"
    return 0
  fi

  if command -v node >/dev/null 2>&1; then
    command -v node
    return 0
  fi

  for candidate in \
    /Applications/Codex.app/Contents/Resources/node \
    /opt/homebrew/bin/node \
    /usr/local/bin/node \
    /usr/bin/node
  do
    if [ -x "$candidate" ]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done

  return 1
}

require_openclaw_node_bin() {
  local node_bin=""
  node_bin="$(resolve_openclaw_node_bin)" || {
    echo "[codex-im] node binary not found; install Node.js 18+ first" >&2
    exit 1
  }
  printf '%s\n' "$node_bin"
}

run_openclaw_node() {
  local node_bin=""
  node_bin="$(require_openclaw_node_bin)"
  "$node_bin" "$@"
}

resolve_openclaw_npm_bin() {
  local candidate=""

  if command -v npm >/dev/null 2>&1; then
    command -v npm
    return 0
  fi

  for candidate in /opt/homebrew/bin/npm /usr/local/bin/npm /usr/bin/npm; do
    if [ -x "$candidate" ]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done

  return 1
}

build_openclaw_script_path() {
  local script_name="$1"

  case "$script_name" in
    openclaw-bot:connect)
      printf '%s\n' "$APP_ROOT/scripts/openclaw-connect.sh"
      ;;
    openclaw-bot:daemon)
      printf '%s\n' "$APP_ROOT/scripts/start-openclaw-bot.sh"
      ;;
    openclaw-bot:doctor)
      printf '%s\n' "$APP_ROOT/scripts/openclaw-doctor.sh"
      ;;
    openclaw-bot:fix)
      printf '%s\n' "$APP_ROOT/scripts/openclaw-fix.sh"
      ;;
    openclaw-bot:launchd)
      printf '%s\n' "$APP_ROOT/scripts/install-openclaw-launch-agent.sh"
      ;;
    openclaw-bot:quick)
      printf '%s\n' "$APP_ROOT/scripts/openclaw-quick.sh"
      ;;
    openclaw-bot:restart)
      printf '%s\n' "$APP_ROOT/scripts/restart-openclaw-bot.sh"
      ;;
    openclaw-bot:status)
      printf '%s\n' "$APP_ROOT/scripts/check-openclaw-status.sh"
      ;;
    openclaw-bot:stop)
      printf '%s\n' "$APP_ROOT/scripts/stop-openclaw-bot.sh"
      ;;
    *)
      return 1
      ;;
  esac
}

build_openclaw_cli_command() {
  local script_name="$1"
  local instance_cmd_suffix="${2:-}"
  local script_path=""
  local node_bin=""

  if resolve_openclaw_npm_bin >/dev/null 2>&1; then
    printf 'npm run %s%s\n' "$script_name" "$instance_cmd_suffix"
    return 0
  fi

  if [ "$script_name" = "openclaw-bot:diagnose" ]; then
    node_bin="$(resolve_openclaw_node_bin)" || return 1
    printf 'CODEX_IM_VERBOSE_LOGS=true %s ./bin/codex-im.js openclaw-bot\n' "$node_bin"
    return 0
  fi

  script_path="$(build_openclaw_script_path "$script_name")" || return 1
  if [ -n "$OPENCLAW_INSTANCE_ID" ]; then
    printf 'bash %s %s\n' "$script_path" "$OPENCLAW_INSTANCE_ID"
  else
    printf 'bash %s\n' "$script_path"
  fi
}

run_openclaw_cli_command() {
  local script_name="$1"
  local npm_bin=""
  local script_path=""
  local node_bin=""

  if npm_bin="$(resolve_openclaw_npm_bin)"; then
    if [ -n "$OPENCLAW_INSTANCE_ID" ]; then
      "$npm_bin" run "$script_name" -- "$OPENCLAW_INSTANCE_ID"
    else
      "$npm_bin" run "$script_name"
    fi
    return 0
  fi

  if [ "$script_name" = "openclaw-bot:diagnose" ]; then
    node_bin="$(require_openclaw_node_bin)"
    CODEX_IM_VERBOSE_LOGS=true "$node_bin" "$APP_ROOT/bin/codex-im.js" openclaw-bot
    return 0
  fi

  script_path="$(build_openclaw_script_path "$script_name")" || {
    echo "[codex-im] unsupported script fallback: ${script_name}" >&2
    return 1
  }

  if [ -n "$OPENCLAW_INSTANCE_ID" ]; then
    bash "$script_path" "$OPENCLAW_INSTANCE_ID"
  else
    bash "$script_path"
  fi
}

openclaw_process_matches_instance() {
  local line="$1"
  local token=""
  if [ -n "$OPENCLAW_INSTANCE_ID" ]; then
    for token in $line; do
      if [ "$token" = "--instance=${OPENCLAW_INSTANCE_ID}" ]; then
        return 0
      fi
    done
    return 1
  fi

  for token in $line; do
    if [[ "$token" == --instance=* ]]; then
      return 1
    fi
  done
  return 0
}

list_openclaw_process_lines() {
  local process_kind="${1:-all}"
  local pattern=""

  case "$process_kind" in
    supervisor)
      pattern='start-openclaw-bot\.js'
      ;;
    child)
      pattern='codex-im\.js openclaw-bot'
      ;;
    *)
      pattern='start-openclaw-bot\.js|codex-im\.js openclaw-bot'
      ;;
  esac

  ps aux 2>/dev/null | while IFS= read -r line; do
    if ! printf '%s\n' "$line" | grep -Eq "$pattern"; then
      continue
    fi
    if ! openclaw_process_matches_instance "$line"; then
      continue
    fi
    printf '%s\n' "$line"
  done
}

collect_openclaw_log_window() {
  local log_file="${1:-}"
  local supervisor_pid="${2:-}"
  local child_pid="${3:-}"
  local max_lines="${4:-0}"

  if [ -z "$log_file" ] || [ ! -f "$log_file" ]; then
    return
  fi

  run_openclaw_node - "$log_file" "$supervisor_pid" "$child_pid" "$max_lines" <<'NODE'
const fs = require("node:fs");

const [logFile, supervisorPid, childPid, maxLinesText] = process.argv.slice(2);
const maxLines = Number(maxLinesText || 0);
let content = "";

try {
  content = fs.readFileSync(logFile, "utf8");
} catch {
  process.exit(0);
}

const lines = content.split(/\r?\n/);
if (lines.length && lines[lines.length - 1] === "") {
  lines.pop();
}

const anchorMarkers = [
  supervisorPid ? `openclaw-bot supervisor ready pid=${supervisorPid}` : "",
  childPid ? `openclaw child started pid=${childPid}` : "",
].filter(Boolean);

let startIndex = -1;
for (const marker of anchorMarkers) {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (lines[index].includes(marker)) {
      startIndex = index;
      break;
    }
  }
  if (startIndex >= 0) {
    break;
  }
}

let selectedLines = startIndex >= 0 ? lines.slice(startIndex) : lines;
if (maxLines > 0 && selectedLines.length > maxLines) {
  selectedLines = selectedLines.slice(selectedLines.length - maxLines);
}

if (selectedLines.length > 0) {
  process.stdout.write(`${selectedLines.join("\n")}\n`);
}
NODE
}

print_openclaw_next_action() {
  local instance_cmd_suffix="${1:-}"
  local action_key=""
  local action_text=""
  local action_command=""
  local heartbeat="${heartbeat_reason:-}"
  local service="${service_state:-}"
  local supervisor="${supervisor_status:-}"
  local launchd="${launchd_status:-}"
  local log_window="${current_log_window:-}"
  local token_present="${env_token_present:-0}"
  local credentials_present="${has_saved_credentials:-0}"

  if [ "$launchd" = "not_loaded" ] && [ "$service" = "running" ]; then
    action_key="rearm-launchd"
    action_text="服务在线，但 launchd 常驻保护层没挂上，立即补装常驻保护。"
    action_command="$(build_openclaw_cli_command "openclaw-bot:launchd" "$instance_cmd_suffix" || printf 'bash ./scripts/install-openclaw-launch-agent.sh')"
  elif [ "$launchd" = "not_loaded" ] && [ "$service" = "stopped" ] && { [ "$token_present" = "1" ] || [ "$credentials_present" = "1" ]; }; then
    action_key="restore-launchd"
    action_text="常驻保护层丢了，重新挂回 launchd 并拉起服务。"
    action_command="$(build_openclaw_cli_command "openclaw-bot:launchd" "$instance_cmd_suffix" || printf 'bash ./scripts/install-openclaw-launch-agent.sh')"
  elif [ "$heartbeat" = "qr-login-scaned" ] || [ "$heartbeat" = "qr-login-scanned" ]; then
    action_key="confirm-login"
    action_text="回到手机微信里点确认登录。"
    action_command="在微信里点确认"
  elif [ "$heartbeat" = "qr-login-ready" ] \
    || [ "$heartbeat" = "qr-login-refresh" ] \
    || [ "$heartbeat" = "qr-login-wait" ] \
    || [ "$heartbeat" = "qr-login-start" ] \
    || [ "$heartbeat" = "qr-relogin-start" ]; then
    action_key="scan-qr"
    action_text="用手机微信扫码浏览器里的二维码。"
    action_command="在微信里扫码"
  elif [ "$heartbeat" = "qr-login-confirmed" ]; then
    action_key="wait-runtime"
    action_text="扫码已确认，等待服务就绪。"
    action_command="$(build_openclaw_cli_command "openclaw-bot:fix" "$instance_cmd_suffix" || printf 'bash ./scripts/openclaw-fix.sh')"
  elif [ "$service" = "running" ] && { \
    [ "$heartbeat" = "runtime-ready" ] \
    || [ "$heartbeat" = "poll" ] \
    || [ "$heartbeat" = "send" ] \
    || [ "$heartbeat" = "send-recover" ] \
    || [ "$heartbeat" = "send-retry" ]; \
  }; then
    action_key="ready"
    action_text="服务已连好，可以直接去手机发消息测试。"
    action_command="在微信里发一条消息"
  elif [ "$service" = "restarting" ] || [ "$supervisor" = "restarting" ]; then
    action_key="wait-restart"
    action_text="服务正在自动自愈，先等它重启完成。"
    action_command="$(build_openclaw_cli_command "openclaw-bot:fix" "$instance_cmd_suffix" || printf 'bash ./scripts/openclaw-fix.sh')"
  elif [ "$service" = "starting" ] || [ "$service" = "supervising" ] || [ "$heartbeat" = "runtime-ready" ]; then
    action_key="wait-startup"
    action_text="服务正在启动，先等几秒再看状态。"
    action_command="$(build_openclaw_cli_command "openclaw-bot:fix" "$instance_cmd_suffix" || printf 'bash ./scripts/openclaw-fix.sh')"
  elif [ "$service" = "stopped" ]; then
    action_key="start-service"
    if [ "$token_present" = "1" ] || [ "$credentials_present" = "1" ]; then
      action_text="把连接服务重新拉起来。"
    else
      action_text="启动连接流程并准备扫码。"
    fi
    action_command="$(build_openclaw_cli_command "openclaw-bot:fix" "$instance_cmd_suffix" || printf 'bash ./scripts/openclaw-fix.sh')"
  elif printf '%s\n' "$log_window" | grep -Eq 'errcode=-14|sendMessage invalid token'; then
    action_key="relogin"
    action_text="微信会话可能过期，重新走连接流程。"
    action_command="$(build_openclaw_cli_command "openclaw-bot:fix" "$instance_cmd_suffix" || printf 'bash ./scripts/openclaw-fix.sh')"
  elif printf '%s\n' "$log_window" | grep -qi 'timeout'; then
    action_key="check-network"
    action_text="先检查网络或代理，再做一次健康检查。"
    action_command="$(build_openclaw_cli_command "openclaw-bot:fix" "$instance_cmd_suffix" || printf 'bash ./scripts/openclaw-fix.sh')"
  else
    action_key="doctor"
    action_text="先做一次健康检查定位问题。"
    action_command="$(build_openclaw_cli_command "openclaw-bot:doctor" "$instance_cmd_suffix" || printf 'bash ./scripts/openclaw-doctor.sh')"
  fi

  echo "[codex-im] next action"
  echo "action_key=${action_key}"
  echo "action_text=${action_text}"
  echo "action_command=${action_command}"
}
