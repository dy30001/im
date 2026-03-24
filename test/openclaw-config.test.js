const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const { readConfig } = require("../src/infra/config/config");

test("readConfig loads openclaw bot settings from env", () => {
  const previousArgv = process.argv.slice();
  const previousEnv = {
    CODEX_IM_OPENCLAW_BASE_URL: process.env.CODEX_IM_OPENCLAW_BASE_URL,
    CODEX_IM_OPENCLAW_TOKEN: process.env.CODEX_IM_OPENCLAW_TOKEN,
    CODEX_IM_OPENCLAW_LONG_POLL_TIMEOUT_MS: process.env.CODEX_IM_OPENCLAW_LONG_POLL_TIMEOUT_MS,
    CODEX_IM_OPENCLAW_STREAMING_OUTPUT: process.env.CODEX_IM_OPENCLAW_STREAMING_OUTPUT,
  };

  process.argv = [previousArgv[0], previousArgv[1], "openclaw-bot"];
  process.env.CODEX_IM_OPENCLAW_BASE_URL = "https://ilinkai.weixin.qq.com";
  process.env.CODEX_IM_OPENCLAW_TOKEN = "bot-token";
  process.env.CODEX_IM_OPENCLAW_LONG_POLL_TIMEOUT_MS = "42000";
  process.env.CODEX_IM_OPENCLAW_STREAMING_OUTPUT = "false";

  try {
    const config = readConfig();
    assert.equal(config.mode, "openclaw-bot");
    assert.equal(config.openclaw.baseUrl, "https://ilinkai.weixin.qq.com");
    assert.equal(config.openclaw.token, "bot-token");
    assert.equal(config.openclaw.longPollTimeoutMs, 42000);
    assert.equal(config.openclawStreamingOutput, false);
    assert.equal(
      config.sessionsFile,
      path.join(require("node:os").homedir(), ".codex-im", "sessions.json")
    );
  } finally {
    process.argv = previousArgv;
    restoreEnv(previousEnv);
  }
});

function restoreEnv(previousEnv) {
  for (const [name, value] of Object.entries(previousEnv)) {
    if (typeof value === "string") {
      process.env[name] = value;
    } else {
      delete process.env[name];
    }
  }
}
