const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const { readConfig } = require("../src/infra/config/config");

test("readConfig loads openclaw bot settings from env", () => {
  const previousArgv = process.argv.slice();
  const previousEnv = {
    CODEX_IM_OPENCLAW_BASE_URL: process.env.CODEX_IM_OPENCLAW_BASE_URL,
    CODEX_IM_OPENCLAW_TOKEN: process.env.CODEX_IM_OPENCLAW_TOKEN,
    CODEX_IM_OPENCLAW_THREAD_SOURCE: process.env.CODEX_IM_OPENCLAW_THREAD_SOURCE,
    CODEX_IM_OPENCLAW_LONG_POLL_TIMEOUT_MS: process.env.CODEX_IM_OPENCLAW_LONG_POLL_TIMEOUT_MS,
    CODEX_IM_OPENCLAW_STREAMING_OUTPUT: process.env.CODEX_IM_OPENCLAW_STREAMING_OUTPUT,
    CODEX_IM_OPENCLAW_PROGRESS_NOTICE_DELAY_MS: process.env.CODEX_IM_OPENCLAW_PROGRESS_NOTICE_DELAY_MS,
    CODEX_IM_OPENCLAW_PROGRESS_FOLLOWUP_DELAY_MS: process.env.CODEX_IM_OPENCLAW_PROGRESS_FOLLOWUP_DELAY_MS,
    CODEX_IM_DEFAULT_WORKSPACE_ROOT: process.env.CODEX_IM_DEFAULT_WORKSPACE_ROOT,
    CODEX_IM_SESSIONS_FILE: process.env.CODEX_IM_SESSIONS_FILE,
  };

  process.argv = [previousArgv[0], previousArgv[1], "openclaw-bot"];
  process.env.CODEX_IM_OPENCLAW_BASE_URL = "https://ilinkai.weixin.qq.com";
  process.env.CODEX_IM_OPENCLAW_TOKEN = "bot-token";
  process.env.CODEX_IM_OPENCLAW_THREAD_SOURCE = "codex";
  process.env.CODEX_IM_OPENCLAW_LONG_POLL_TIMEOUT_MS = "42000";
  process.env.CODEX_IM_OPENCLAW_STREAMING_OUTPUT = "false";
  process.env.CODEX_IM_OPENCLAW_PROGRESS_NOTICE_DELAY_MS = "1500";
  process.env.CODEX_IM_OPENCLAW_PROGRESS_FOLLOWUP_DELAY_MS = "300000";
  process.env.CODEX_IM_DEFAULT_WORKSPACE_ROOT = "/Users/dy3000/code/im";
  delete process.env.CODEX_IM_SESSIONS_FILE;

  try {
    const config = readConfig();
    assert.equal(config.mode, "openclaw-bot");
    assert.equal(config.openclaw.baseUrl, "https://ilinkai.weixin.qq.com");
    assert.equal(config.openclaw.token, "bot-token");
    assert.equal(config.openclaw.threadSource, "codex");
    assert.equal(config.openclaw.longPollTimeoutMs, 42000);
    assert.equal(config.openclawStreamingOutput, false);
    assert.equal(config.openclawProgressNoticeDelayMs, 1500);
    assert.equal(config.openclawProgressFollowupDelayMs, 300000);
    assert.equal(config.defaultWorkspaceRoot, "/Users/dy3000/code/im");
    assert.equal(
      config.sessionsFile,
      path.join(require("node:os").homedir(), ".codex-im", "openclaw-sessions.json")
    );
    assert.deepEqual(config.sessionFallbackFiles, [
      path.join(require("node:os").homedir(), ".codex-im", "sessions.json"),
    ]);
  } finally {
    process.argv = previousArgv;
    restoreEnv(previousEnv);
  }
});

test("readConfig defaults openclaw to ACP desktop session mode", () => {
  const previousArgv = process.argv.slice();
  const previousEnv = {
    CODEX_IM_OPENCLAW_THREAD_SOURCE: process.env.CODEX_IM_OPENCLAW_THREAD_SOURCE,
  };

  process.argv = [previousArgv[0], previousArgv[1], "openclaw-bot"];
  delete process.env.CODEX_IM_OPENCLAW_THREAD_SOURCE;

  try {
    const config = readConfig();
    assert.equal(config.openclaw.threadSource, "acpx");
  } finally {
    process.argv = previousArgv;
    restoreEnv(previousEnv);
  }
});

test("readConfig enables openclaw streaming output by default in openclaw bot mode", () => {
  const previousArgv = process.argv.slice();
  const previousEnv = {
    CODEX_IM_OPENCLAW_STREAMING_OUTPUT: process.env.CODEX_IM_OPENCLAW_STREAMING_OUTPUT,
  };

  process.argv = [previousArgv[0], previousArgv[1], "openclaw-bot"];
  delete process.env.CODEX_IM_OPENCLAW_STREAMING_OUTPUT;

  try {
    const config = readConfig();
    assert.equal(config.openclawStreamingOutput, true);
  } finally {
    process.argv = previousArgv;
    restoreEnv(previousEnv);
  }
});

test("readConfig uses a dedicated default session file for Feishu mode", () => {
  const previousArgv = process.argv.slice();
  const previousEnv = {
    CODEX_IM_SESSIONS_FILE: process.env.CODEX_IM_SESSIONS_FILE,
  };

  process.argv = [previousArgv[0], previousArgv[1], "feishu-bot"];
  delete process.env.CODEX_IM_SESSIONS_FILE;

  try {
    const config = readConfig();
    assert.equal(
      config.sessionsFile,
      path.join(require("node:os").homedir(), ".codex-im", "feishu-sessions.json")
    );
    assert.deepEqual(config.sessionFallbackFiles, [
      path.join(require("node:os").homedir(), ".codex-im", "sessions.json"),
    ]);
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
