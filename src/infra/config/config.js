const path = require("path");
const os = require("os");

const TRUE_ENV_VALUES = new Set(["1", "true", "yes", "on"]);
const FALSE_ENV_VALUES = new Set(["0", "false", "no", "off"]);
const ALLOWED_ACCESS_MODES = new Set(["default", "full-access"]);
const DEFAULT_OPENCLAW_BASE_URL = "https://ilinkai.weixin.qq.com";
const DEFAULT_OPENCLAW_LONG_POLL_TIMEOUT_MS = 35_000;
const DEFAULT_OPENCLAW_CREDENTIALS_FILE = path.join(os.homedir(), ".codex-im", "openclaw-credentials.json");

function readConfig() {
  const mode = process.argv[2] || "";
  const openClawBaseUrl = readTextEnv("CODEX_IM_OPENCLAW_BASE_URL");

  return {
    mode,
    workspaceAllowlist: readListEnv("CODEX_IM_WORKSPACE_ALLOWLIST"),
    codexEndpoint: process.env.CODEX_IM_CODEX_ENDPOINT || "",
    codexCommand: process.env.CODEX_IM_CODEX_COMMAND || "",
    defaultCodexModel: readTextEnv("CODEX_IM_DEFAULT_CODEX_MODEL"),
    defaultCodexEffort: readTextEnv("CODEX_IM_DEFAULT_CODEX_EFFORT"),
    defaultCodexAccessMode: readAccessModeEnv("CODEX_IM_DEFAULT_CODEX_ACCESS_MODE"),
    verboseCodexLogs: readBooleanEnv("CODEX_IM_VERBOSE_LOGS", false),
    feishu: {
      appId: process.env.FEISHU_APP_ID || "",
      appSecret: process.env.FEISHU_APP_SECRET || "",
    },
    openclaw: {
      baseUrl: openClawBaseUrl || DEFAULT_OPENCLAW_BASE_URL,
      baseUrlExplicit: Boolean(openClawBaseUrl),
      token: readTextEnv("CODEX_IM_OPENCLAW_TOKEN"),
      longPollTimeoutMs: readIntegerEnv(
        "CODEX_IM_OPENCLAW_LONG_POLL_TIMEOUT_MS",
        DEFAULT_OPENCLAW_LONG_POLL_TIMEOUT_MS
      ),
      credentialsFile: readTextEnv("CODEX_IM_OPENCLAW_CREDENTIALS_FILE") || DEFAULT_OPENCLAW_CREDENTIALS_FILE,
    },
    defaultWorkspaceId: process.env.CODEX_IM_DEFAULT_WORKSPACE_ID || "default",
    feishuStreamingOutput: readBooleanEnv("CODEX_IM_FEISHU_STREAMING_OUTPUT", true),
    openclawStreamingOutput: readBooleanEnv("CODEX_IM_OPENCLAW_STREAMING_OUTPUT", false),
    sessionsFile: process.env.CODEX_IM_SESSIONS_FILE
      || path.join(os.homedir(), ".codex-im", "sessions.json"),
  };
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

module.exports = {
  DEFAULT_OPENCLAW_BASE_URL,
  DEFAULT_OPENCLAW_CREDENTIALS_FILE,
  DEFAULT_OPENCLAW_LONG_POLL_TIMEOUT_MS,
  readConfig,
};
