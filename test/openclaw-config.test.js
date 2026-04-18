const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  readConfig,
  resolveOpenClawDefaultCredentialsFile,
  resolveOpenClawDefaultEnvFile,
  resolveOpenClawDefaultHeartbeatFile,
  resolveOpenClawDefaultLockDir,
  resolveOpenClawDefaultLogFile,
  resolveOpenClawDefaultSessionsFile,
  resolveOpenClawLaunchdLabel,
} = require("../src/infra/config/config");

test("readConfig loads openclaw bot settings from env", () => {
  const previousArgv = process.argv.slice();
  const previousEnv = {
    CODEX_IM_OPENCLAW_BASE_URL: process.env.CODEX_IM_OPENCLAW_BASE_URL,
    CODEX_IM_OPENCLAW_MINIMAL_MODE: process.env.CODEX_IM_OPENCLAW_MINIMAL_MODE,
    CODEX_IM_OPENCLAW_TOKEN: process.env.CODEX_IM_OPENCLAW_TOKEN,
    CODEX_IM_OPENCLAW_THREAD_SOURCE: process.env.CODEX_IM_OPENCLAW_THREAD_SOURCE,
    CODEX_IM_OPENCLAW_LONG_POLL_TIMEOUT_MS: process.env.CODEX_IM_OPENCLAW_LONG_POLL_TIMEOUT_MS,
    CODEX_IM_OPENCLAW_REPLY_FLUSH_DELAY_MS: process.env.CODEX_IM_OPENCLAW_REPLY_FLUSH_DELAY_MS,
    CODEX_IM_OPENCLAW_TURN_STALL_TIMEOUT_MS: process.env.CODEX_IM_OPENCLAW_TURN_STALL_TIMEOUT_MS,
    CODEX_IM_OPENCLAW_TURN_STALL_CHECK_INTERVAL_MS: process.env.CODEX_IM_OPENCLAW_TURN_STALL_CHECK_INTERVAL_MS,
    CODEX_IM_OPENCLAW_STREAMING_OUTPUT: process.env.CODEX_IM_OPENCLAW_STREAMING_OUTPUT,
    CODEX_IM_OPENCLAW_PROGRESS_NOTICE_DELAY_MS: process.env.CODEX_IM_OPENCLAW_PROGRESS_NOTICE_DELAY_MS,
    CODEX_IM_OPENCLAW_PROGRESS_FOLLOWUP_DELAY_MS: process.env.CODEX_IM_OPENCLAW_PROGRESS_FOLLOWUP_DELAY_MS,
    CODEX_IM_OPENCLAW_INSTANCE_ID: process.env.CODEX_IM_OPENCLAW_INSTANCE_ID,
    CODEX_IM_OPENCLAW_CREDENTIALS_FILE: process.env.CODEX_IM_OPENCLAW_CREDENTIALS_FILE,
    CODEX_IM_OPENCLAW_LOCK_DIR: process.env.CODEX_IM_OPENCLAW_LOCK_DIR,
    CODEX_IM_OPENCLAW_HEARTBEAT_FILE: process.env.CODEX_IM_OPENCLAW_HEARTBEAT_FILE,
    CODEX_IM_OPENCLAW_LOG_FILE: process.env.CODEX_IM_OPENCLAW_LOG_FILE,
    CODEX_IM_OPENCLAW_ENV_FILE: process.env.CODEX_IM_OPENCLAW_ENV_FILE,
    CODEX_IM_PERF_LOGS: process.env.CODEX_IM_PERF_LOGS,
    CODEX_IM_DEFAULT_WORKSPACE_ROOT: process.env.CODEX_IM_DEFAULT_WORKSPACE_ROOT,
    CODEX_IM_SESSIONS_FILE: process.env.CODEX_IM_SESSIONS_FILE,
  };

  process.argv = [previousArgv[0], previousArgv[1], "openclaw-bot"];
  process.env.CODEX_IM_OPENCLAW_BASE_URL = "https://ilinkai.weixin.qq.com";
  process.env.CODEX_IM_OPENCLAW_MINIMAL_MODE = "false";
  process.env.CODEX_IM_OPENCLAW_TOKEN = "bot-token";
  process.env.CODEX_IM_OPENCLAW_THREAD_SOURCE = "codex";
  process.env.CODEX_IM_OPENCLAW_LONG_POLL_TIMEOUT_MS = "42000";
  process.env.CODEX_IM_OPENCLAW_REPLY_FLUSH_DELAY_MS = "250";
  process.env.CODEX_IM_OPENCLAW_TURN_STALL_TIMEOUT_MS = "3600000";
  process.env.CODEX_IM_OPENCLAW_TURN_STALL_CHECK_INTERVAL_MS = "45000";
  process.env.CODEX_IM_OPENCLAW_STREAMING_OUTPUT = "false";
  process.env.CODEX_IM_OPENCLAW_PROGRESS_NOTICE_DELAY_MS = "1500";
  process.env.CODEX_IM_OPENCLAW_PROGRESS_FOLLOWUP_DELAY_MS = "300000";
  process.env.CODEX_IM_OPENCLAW_INSTANCE_ID = "wx1";
  process.env.CODEX_IM_PERF_LOGS = "true";
  process.env.CODEX_IM_DEFAULT_WORKSPACE_ROOT = "/Users/dy3000/code/im";
  delete process.env.CODEX_IM_OPENCLAW_CREDENTIALS_FILE;
  delete process.env.CODEX_IM_OPENCLAW_LOCK_DIR;
  delete process.env.CODEX_IM_OPENCLAW_HEARTBEAT_FILE;
  delete process.env.CODEX_IM_OPENCLAW_LOG_FILE;
  delete process.env.CODEX_IM_OPENCLAW_ENV_FILE;
  delete process.env.CODEX_IM_SESSIONS_FILE;

  try {
    const config = readConfig();
    assert.equal(config.mode, "openclaw-bot");
    assert.equal(config.openclaw.baseUrl, "https://ilinkai.weixin.qq.com");
    assert.equal(config.openclaw.token, "bot-token");
    assert.equal(config.openclaw.threadSource, "codex");
    assert.equal(config.openclaw.longPollTimeoutMs, 42000);
    assert.equal(config.openclawReplyFlushDelayMs, 250);
    assert.equal(config.openclaw.turnStallTimeoutMs, 3600000);
    assert.equal(config.openclaw.turnStallCheckIntervalMs, 45000);
    assert.equal(config.openclawStreamingOutput, false);
    assert.equal(config.openclawProgressNoticeDelayMs, 1500);
    assert.equal(config.openclawProgressFollowupDelayMs, 300000);
    assert.equal(config.openclaw.instanceId, "wx1");
    assert.equal(config.performanceLogs, true);
    assert.equal(config.defaultWorkspaceRoot, "/Users/dy3000/code/im");
    assert.equal(
      config.sessionsFile,
      path.join(os.homedir(), ".codex-im", "openclaw-sessions.wx1.json")
    );
    assert.deepEqual(config.sessionFallbackFiles, [
      path.join(os.homedir(), ".codex-im", "sessions.json"),
    ]);
    assert.equal(
      config.openclaw.credentialsFile,
      path.join(os.homedir(), ".codex-im", "openclaw-credentials.wx1.json")
    );
    assert.equal(
      config.openclaw.lockDir,
      path.join(os.homedir(), ".codex-im", "openclaw-bot.wx1.lock")
    );
    assert.equal(
      config.openclaw.heartbeatFile,
      path.join(os.homedir(), ".codex-im", "openclaw-bot.wx1.lock", "heartbeat.json")
    );
    assert.equal(config.openclaw.logFile, "/tmp/codex-im-openclaw-wx1.log");
    assert.equal(config.openclaw.envFile, path.join(os.homedir(), ".codex-im", "openclaw-wx1.env"));
    assert.equal(config.openclaw.launchdLabel, "com.dy3000.codex-im.openclaw.wx1");
  } finally {
    process.argv = previousArgv;
    restoreEnv(previousEnv);
  }
});

test("readConfig defaults workspace root to the current startup directory when env is unset", () => {
  const previousArgv = process.argv.slice();
  const previousCwd = process.cwd();
  const workspaceRoot = path.join(previousCwd, "test");
  const previousEnv = {
    CODEX_IM_DEFAULT_WORKSPACE_ROOT: process.env.CODEX_IM_DEFAULT_WORKSPACE_ROOT,
  };

  delete process.env.CODEX_IM_DEFAULT_WORKSPACE_ROOT;
  process.argv = [previousArgv[0], previousArgv[1], "openclaw-bot"];
  process.chdir(workspaceRoot);

  try {
    const config = readConfig();
    assert.equal(config.defaultWorkspaceRoot, workspaceRoot);
  } finally {
    process.chdir(previousCwd);
    process.argv = previousArgv;
    restoreEnv(previousEnv);
  }
});

test("readConfig defaults openclaw to ACP desktop session mode", () => {
  const previousArgv = process.argv.slice();
  const previousEnv = {
    CODEX_IM_OPENCLAW_MINIMAL_MODE: process.env.CODEX_IM_OPENCLAW_MINIMAL_MODE,
    CODEX_IM_OPENCLAW_THREAD_SOURCE: process.env.CODEX_IM_OPENCLAW_THREAD_SOURCE,
    CODEX_IM_OPENCLAW_REPLY_FLUSH_DELAY_MS: process.env.CODEX_IM_OPENCLAW_REPLY_FLUSH_DELAY_MS,
    CODEX_IM_OPENCLAW_PROGRESS_NOTICE_DELAY_MS: process.env.CODEX_IM_OPENCLAW_PROGRESS_NOTICE_DELAY_MS,
    CODEX_IM_OPENCLAW_TURN_STALL_TIMEOUT_MS: process.env.CODEX_IM_OPENCLAW_TURN_STALL_TIMEOUT_MS,
    CODEX_IM_OPENCLAW_TURN_STALL_CHECK_INTERVAL_MS: process.env.CODEX_IM_OPENCLAW_TURN_STALL_CHECK_INTERVAL_MS,
    CODEX_IM_OPENCLAW_INSTANCE_ID: process.env.CODEX_IM_OPENCLAW_INSTANCE_ID,
  };

  process.argv = [previousArgv[0], previousArgv[1], "openclaw-bot"];
  delete process.env.CODEX_IM_OPENCLAW_MINIMAL_MODE;
  delete process.env.CODEX_IM_OPENCLAW_THREAD_SOURCE;
  delete process.env.CODEX_IM_OPENCLAW_REPLY_FLUSH_DELAY_MS;
  delete process.env.CODEX_IM_OPENCLAW_PROGRESS_NOTICE_DELAY_MS;
  delete process.env.CODEX_IM_OPENCLAW_TURN_STALL_TIMEOUT_MS;
  delete process.env.CODEX_IM_OPENCLAW_TURN_STALL_CHECK_INTERVAL_MS;
  delete process.env.CODEX_IM_OPENCLAW_INSTANCE_ID;

  try {
    const config = readConfig();
    assert.equal(config.openclaw.threadSource, "acpx");
    assert.equal(config.openclawReplyFlushDelayMs, 50);
    assert.equal(config.openclawProgressNoticeDelayMs, 200);
    assert.equal(config.openclaw.turnStallTimeoutMs, 30 * 60 * 1000);
    assert.equal(config.openclaw.turnStallCheckIntervalMs, 30 * 1000);
  } finally {
    process.argv = previousArgv;
    restoreEnv(previousEnv);
  }
});

test("readConfig enables minimal mode and defaults OpenClaw to codex thread source", () => {
  const previousArgv = process.argv.slice();
  const previousEnv = {
    CODEX_IM_OPENCLAW_MINIMAL_MODE: process.env.CODEX_IM_OPENCLAW_MINIMAL_MODE,
    CODEX_IM_OPENCLAW_THREAD_SOURCE: process.env.CODEX_IM_OPENCLAW_THREAD_SOURCE,
  };

  process.argv = [previousArgv[0], previousArgv[1], "openclaw-bot"];
  process.env.CODEX_IM_OPENCLAW_MINIMAL_MODE = "true";
  delete process.env.CODEX_IM_OPENCLAW_THREAD_SOURCE;

  try {
    const config = readConfig();
    assert.equal(config.openclaw.minimalMode, true);
    assert.equal(config.openclaw.threadSource, "codex");
  } finally {
    process.argv = previousArgv;
    restoreEnv(previousEnv);
  }
});

test("readConfig keeps an explicit thread source in minimal mode", () => {
  const previousArgv = process.argv.slice();
  const previousEnv = {
    CODEX_IM_OPENCLAW_MINIMAL_MODE: process.env.CODEX_IM_OPENCLAW_MINIMAL_MODE,
    CODEX_IM_OPENCLAW_THREAD_SOURCE: process.env.CODEX_IM_OPENCLAW_THREAD_SOURCE,
  };

  process.argv = [previousArgv[0], previousArgv[1], "openclaw-bot"];
  process.env.CODEX_IM_OPENCLAW_MINIMAL_MODE = "true";
  process.env.CODEX_IM_OPENCLAW_THREAD_SOURCE = "acpx";

  try {
    const config = readConfig();
    assert.equal(config.openclaw.minimalMode, true);
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

test("openclaw instance helpers derive isolated file paths and labels", () => {
  assert.equal(resolveOpenClawDefaultSessionsFile("wx2"), path.join(os.homedir(), ".codex-im", "openclaw-sessions.wx2.json"));
  assert.equal(resolveOpenClawDefaultCredentialsFile("wx2"), path.join(os.homedir(), ".codex-im", "openclaw-credentials.wx2.json"));
  assert.equal(resolveOpenClawDefaultLockDir("wx2"), path.join(os.homedir(), ".codex-im", "openclaw-bot.wx2.lock"));
  assert.equal(
    resolveOpenClawDefaultHeartbeatFile("wx2"),
    path.join(os.homedir(), ".codex-im", "openclaw-bot.wx2.lock", "heartbeat.json")
  );
  assert.equal(resolveOpenClawDefaultLogFile("wx2"), "/tmp/codex-im-openclaw-wx2.log");
  assert.equal(resolveOpenClawDefaultEnvFile("wx2"), path.join(os.homedir(), ".codex-im", "openclaw-wx2.env"));
  assert.equal(resolveOpenClawLaunchdLabel("wx2"), "com.dy3000.codex-im.openclaw.wx2");
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
