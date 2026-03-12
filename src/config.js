const path = require("path");
const os = require("os");

function readConfig() {
  const mode = process.argv[2] || "";
  const workspaceAllowlist = String(process.env.CODEX_IM_WORKSPACE_ALLOWLIST || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  return {
    mode,
    workspaceAllowlist,
    codexEndpoint: process.env.CODEX_IM_CODEX_ENDPOINT || "",
    feishu: {
      appId: process.env.FEISHU_APP_ID || "",
      appSecret: process.env.FEISHU_APP_SECRET || "",
    },
    defaultWorkspaceId: process.env.CODEX_IM_DEFAULT_WORKSPACE_ID || "default",
    feishuBotName: process.env.CODEX_IM_FEISHU_BOT_NAME || "codex",
    sessionsFile: process.env.CODEX_IM_SESSIONS_FILE
      || path.join(os.homedir(), ".codex-im", "sessions.json"),
  };
}

module.exports = { readConfig };
