const path = require("path");
const os = require("os");

const TRUE_ENV_VALUES = new Set(["1", "true", "yes", "on"]);
const FALSE_ENV_VALUES = new Set(["0", "false", "no", "off"]);
const ALLOWED_ACCESS_MODES = new Set(["default", "full-access"]);
const DEFAULT_OPENCLAW_BASE_URL = "https://ilinkai.weixin.qq.com";
const DEFAULT_OPENCLAW_LONG_POLL_TIMEOUT_MS = 35_000;
const DEFAULT_OPENCLAW_TURN_STALL_TIMEOUT_MS = 30 * 60 * 1_000;
const DEFAULT_OPENCLAW_TURN_STALL_CHECK_INTERVAL_MS = 30 * 1_000;
const OPENCLAW_LAUNCHD_LABEL_PREFIX = "com.dy3000.codex-im.openclaw";
const DEFAULT_OPENCLAW_LOG_FILE = "/tmp/codex-im-openclaw.log";
const DEFAULT_OPENCLAW_CREDENTIALS_FILE = path.join(os.homedir(), ".codex-im", "openclaw-credentials.json");
const DEFAULT_SESSION_STATE_DIR = path.join(os.homedir(), ".codex-im");
const LEGACY_DEFAULT_SESSIONS_FILE = path.join(DEFAULT_SESSION_STATE_DIR, "sessions.json");
const DEFAULT_ACPX_SESSIONS_DIR = path.join(os.homedir(), ".acpx", "sessions");
const DEFAULT_ACPX_SESSION_INDEX_FILE = path.join(DEFAULT_ACPX_SESSIONS_DIR, "index.json");

function readConfig() {
  const mode = process.argv[2] || "";
  const openclawInstanceId = resolveOpenClawInstanceId();
  const openClawBaseUrl = readTextEnv("CODEX_IM_OPENCLAW_BASE_URL");
  const openclawMinimalMode = readBooleanEnv("CODEX_IM_OPENCLAW_MINIMAL_MODE", false);
  const explicitThreadSource = readTextEnv("CODEX_IM_OPENCLAW_THREAD_SOURCE");
  const explicitSessionsFile = readTextEnv("CODEX_IM_SESSIONS_FILE");
  const sessionsFile = explicitSessionsFile || resolveDefaultSessionsFile(mode, openclawInstanceId);
  const defaultWorkspaceRoot = readTextEnv("CODEX_IM_DEFAULT_WORKSPACE_ROOT") || process.cwd();

  return {
    mode,
    workspaceAllowlist: readListEnv("CODEX_IM_WORKSPACE_ALLOWLIST"),
    defaultWorkspaceRoot,
    codexEndpoint: process.env.CODEX_IM_CODEX_ENDPOINT || "",
    codexCommand: process.env.CODEX_IM_CODEX_COMMAND || "",
    defaultCodexModel: readTextEnv("CODEX_IM_DEFAULT_CODEX_MODEL"),
    defaultCodexEffort: readTextEnv("CODEX_IM_DEFAULT_CODEX_EFFORT"),
    defaultCodexAccessMode: readAccessModeEnv("CODEX_IM_DEFAULT_CODEX_ACCESS_MODE"),
    verboseCodexLogs: readBooleanEnv("CODEX_IM_VERBOSE_LOGS", false),
    performanceLogs: readBooleanEnv("CODEX_IM_PERF_LOGS", false),
    feishu: {
      appId: process.env.FEISHU_APP_ID || "",
      appSecret: process.env.FEISHU_APP_SECRET || "",
    },
    openclaw: {
      instanceId: openclawInstanceId,
      baseUrl: openClawBaseUrl || DEFAULT_OPENCLAW_BASE_URL,
      baseUrlExplicit: Boolean(openClawBaseUrl),
      minimalMode: openclawMinimalMode,
      token: readTextEnv("CODEX_IM_OPENCLAW_TOKEN"),
      threadSource: readThreadSourceEnv(explicitThreadSource, openclawMinimalMode ? "codex" : "acpx"),
      longPollTimeoutMs: readIntegerEnv(
        "CODEX_IM_OPENCLAW_LONG_POLL_TIMEOUT_MS",
        DEFAULT_OPENCLAW_LONG_POLL_TIMEOUT_MS
      ),
      turnStallTimeoutMs: readIntegerEnv(
        "CODEX_IM_OPENCLAW_TURN_STALL_TIMEOUT_MS",
        DEFAULT_OPENCLAW_TURN_STALL_TIMEOUT_MS
      ),
      turnStallCheckIntervalMs: readIntegerEnv(
        "CODEX_IM_OPENCLAW_TURN_STALL_CHECK_INTERVAL_MS",
        DEFAULT_OPENCLAW_TURN_STALL_CHECK_INTERVAL_MS
      ),
      lockDir: readTextEnv("CODEX_IM_OPENCLAW_LOCK_DIR") || resolveOpenClawDefaultLockDir(openclawInstanceId),
      heartbeatFile: readTextEnv("CODEX_IM_OPENCLAW_HEARTBEAT_FILE")
        || resolveOpenClawDefaultHeartbeatFile(openclawInstanceId),
      logFile: readTextEnv("CODEX_IM_OPENCLAW_LOG_FILE") || resolveOpenClawDefaultLogFile(openclawInstanceId),
      envFile: resolveOpenClawEnvFile(openclawInstanceId),
      launchdLabel: resolveOpenClawLaunchdLabel(openclawInstanceId),
      credentialsFile: readTextEnv("CODEX_IM_OPENCLAW_CREDENTIALS_FILE")
        || resolveOpenClawDefaultCredentialsFile(openclawInstanceId),
      acpxSessionsDir: readTextEnv("CODEX_IM_OPENCLAW_ACPX_SESSIONS_DIR") || DEFAULT_ACPX_SESSIONS_DIR,
      acpxSessionIndexFile: readTextEnv("CODEX_IM_OPENCLAW_ACPX_SESSION_INDEX_FILE") || DEFAULT_ACPX_SESSION_INDEX_FILE,
    },
    defaultWorkspaceId: process.env.CODEX_IM_DEFAULT_WORKSPACE_ID || "default",
    feishuStreamingOutput: readBooleanEnv("CODEX_IM_FEISHU_STREAMING_OUTPUT", true),
    openclawStreamingOutput: readBooleanEnv("CODEX_IM_OPENCLAW_STREAMING_OUTPUT", mode === "openclaw-bot"),
    openclawReplyFlushDelayMs: readIntegerEnv(
      "CODEX_IM_OPENCLAW_REPLY_FLUSH_DELAY_MS",
      50
    ),
    openclawProgressNoticeDelayMs: readIntegerEnv(
      "CODEX_IM_OPENCLAW_PROGRESS_NOTICE_DELAY_MS",
      200
    ),
    openclawProgressFollowupDelayMs: readIntegerEnv(
      "CODEX_IM_OPENCLAW_PROGRESS_FOLLOWUP_DELAY_MS",
      5 * 60 * 1000
    ),
    sessionsFile,
    sessionFallbackFiles: explicitSessionsFile ? [] : buildSessionFallbackFiles(sessionsFile),
  };
}

function resolveDefaultSessionsFile(mode, openclawInstanceId = resolveOpenClawInstanceId()) {
  if (mode === "openclaw-bot") {
    return resolveOpenClawDefaultSessionsFile(openclawInstanceId);
  }
  return path.join(DEFAULT_SESSION_STATE_DIR, "feishu-sessions.json");
}

function resolveOpenClawInstanceId(value = readTextEnv("CODEX_IM_OPENCLAW_INSTANCE_ID")) {
  return normalizeOpenClawInstanceId(value);
}

function normalizeOpenClawInstanceId(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+/g, "")
    .replace(/-+$/g, "");
}

function resolveOpenClawDefaultSessionsFile(instanceId = resolveOpenClawInstanceId()) {
  const suffix = buildOpenClawInstanceSuffix(instanceId);
  return path.join(DEFAULT_SESSION_STATE_DIR, `openclaw-sessions${suffix}.json`);
}

function resolveOpenClawDefaultCredentialsFile(instanceId = resolveOpenClawInstanceId()) {
  const suffix = buildOpenClawInstanceSuffix(instanceId);
  return path.join(DEFAULT_SESSION_STATE_DIR, `openclaw-credentials${suffix}.json`);
}

function resolveOpenClawDefaultLockDir(instanceId = resolveOpenClawInstanceId()) {
  const suffix = buildOpenClawInstanceSuffix(instanceId);
  return path.join(DEFAULT_SESSION_STATE_DIR, `openclaw-bot${suffix}.lock`);
}

function resolveOpenClawDefaultHeartbeatFile(instanceId = resolveOpenClawInstanceId()) {
  return path.join(resolveOpenClawDefaultLockDir(instanceId), "heartbeat.json");
}

function resolveOpenClawDefaultLogFile(instanceId = resolveOpenClawInstanceId()) {
  const normalizedInstanceId = normalizeOpenClawInstanceId(instanceId);
  return normalizedInstanceId
    ? `/tmp/codex-im-openclaw-${normalizedInstanceId}.log`
    : DEFAULT_OPENCLAW_LOG_FILE;
}

function resolveOpenClawLaunchdLabel(instanceId = resolveOpenClawInstanceId()) {
  const normalizedInstanceId = normalizeOpenClawInstanceId(instanceId);
  return normalizedInstanceId
    ? `${OPENCLAW_LAUNCHD_LABEL_PREFIX}.${normalizedInstanceId}`
    : OPENCLAW_LAUNCHD_LABEL_PREFIX;
}

function resolveOpenClawDefaultEnvFile(instanceId = resolveOpenClawInstanceId(), homeDir = os.homedir()) {
  const normalizedInstanceId = normalizeOpenClawInstanceId(instanceId);
  if (!normalizedInstanceId) {
    return "";
  }
  return path.join(homeDir, ".codex-im", `openclaw-${normalizedInstanceId}.env`);
}

function resolveOpenClawEnvFile(instanceId = resolveOpenClawInstanceId()) {
  return readTextEnv("CODEX_IM_OPENCLAW_ENV_FILE") || resolveOpenClawDefaultEnvFile(instanceId);
}

function buildOpenClawEnvLoadPaths({
  cwd = process.cwd(),
  homeDir = os.homedir(),
  instanceId = resolveOpenClawInstanceId(),
  explicitEnvFile = readTextEnv("CODEX_IM_OPENCLAW_ENV_FILE"),
} = {}) {
  const paths = [
    path.join(cwd, ".env"),
    path.join(homeDir, ".codex-im", ".env"),
  ];
  const defaultInstanceEnvFile = resolveOpenClawDefaultEnvFile(instanceId, homeDir);
  if (explicitEnvFile) {
    paths.push(explicitEnvFile);
  } else if (defaultInstanceEnvFile) {
    paths.push(defaultInstanceEnvFile);
  }
  return [...new Set(paths.filter(Boolean))];
}

function buildOpenClawInstanceSuffix(instanceId = "") {
  const normalizedInstanceId = normalizeOpenClawInstanceId(instanceId);
  return normalizedInstanceId ? `.${normalizedInstanceId}` : "";
}

function buildSessionFallbackFiles(primaryFilePath) {
  if (!primaryFilePath || primaryFilePath === LEGACY_DEFAULT_SESSIONS_FILE) {
    return [];
  }
  return [LEGACY_DEFAULT_SESSIONS_FILE];
}

function readListEnv(name) {
  return String(process.env[name] || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function readBooleanEnv(name, defaultValue) {
  const rawValue = process.env[name];
  if (typeof rawValue !== "string" || !rawValue.trim()) {
    return defaultValue;
  }

  const normalized = rawValue.trim().toLowerCase();
  if (TRUE_ENV_VALUES.has(normalized)) {
    return true;
  }
  if (FALSE_ENV_VALUES.has(normalized)) {
    return false;
  }
  return defaultValue;
}

function readTextEnv(name) {
  const value = process.env[name];
  return typeof value === "string" ? value.trim() : "";
}

function readIntegerEnv(name, defaultValue) {
  const value = Number.parseInt(readTextEnv(name), 10);
  return Number.isFinite(value) && value > 0 ? value : defaultValue;
}

function readAccessModeEnv(name) {
  const value = readTextEnv(name).toLowerCase();
  return ALLOWED_ACCESS_MODES.has(value) ? value : "";
}

function readThreadSourceEnv(value, defaultValue) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "codex" || normalized === "acpx") {
    return normalized;
  }
  return defaultValue;
}

module.exports = {
  DEFAULT_ACPX_SESSION_INDEX_FILE,
  DEFAULT_ACPX_SESSIONS_DIR,
  DEFAULT_OPENCLAW_LOG_FILE,
  DEFAULT_SESSION_STATE_DIR,
  DEFAULT_OPENCLAW_BASE_URL,
  DEFAULT_OPENCLAW_CREDENTIALS_FILE,
  DEFAULT_OPENCLAW_LONG_POLL_TIMEOUT_MS,
  DEFAULT_OPENCLAW_TURN_STALL_CHECK_INTERVAL_MS,
  DEFAULT_OPENCLAW_TURN_STALL_TIMEOUT_MS,
  LEGACY_DEFAULT_SESSIONS_FILE,
  OPENCLAW_LAUNCHD_LABEL_PREFIX,
  buildOpenClawEnvLoadPaths,
  normalizeOpenClawInstanceId,
  readConfig,
  resolveDefaultSessionsFile,
  resolveOpenClawDefaultCredentialsFile,
  resolveOpenClawDefaultEnvFile,
  resolveOpenClawDefaultHeartbeatFile,
  resolveOpenClawDefaultLockDir,
  resolveOpenClawDefaultLogFile,
  resolveOpenClawDefaultSessionsFile,
  resolveOpenClawEnvFile,
  resolveOpenClawInstanceId,
  resolveOpenClawLaunchdLabel,
};
