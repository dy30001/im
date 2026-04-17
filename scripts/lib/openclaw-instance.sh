#!/usr/bin/env bash

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
