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
    CODEX_IM_OPENCLAW_TRANSCRIPTION_LANGUAGE: process.env.CODEX_IM_OPENCLAW_TRANSCRIPTION_LANGUAGE,
    CODEX_IM_OPENCLAW_TRANSCRIPTION_MAX_BYTES: process.env.CODEX_IM_OPENCLAW_TRANSCRIPTION_MAX_BYTES,
    CODEX_IM_OPENCLAW_TRANSCRIPTION_LOCAL_FASTER_WHISPER: process.env.CODEX_IM_OPENCLAW_TRANSCRIPTION_LOCAL_FASTER_WHISPER,
    CODEX_IM_OPENCLAW_TRANSCRIPTION_LOCAL_FASTER_WHISPER_MODEL: process.env.CODEX_IM_OPENCLAW_TRANSCRIPTION_LOCAL_FASTER_WHISPER_MODEL,
    CODEX_IM_OPENCLAW_TRANSCRIPTION_LOCAL_FASTER_WHISPER_PYTHON: process.env.CODEX_IM_OPENCLAW_TRANSCRIPTION_LOCAL_FASTER_WHISPER_PYTHON,
    CODEX_IM_OPENCLAW_TRANSCRIPTION_LOCAL_FASTER_WHISPER_SCRIPT: process.env.CODEX_IM_OPENCLAW_TRANSCRIPTION_LOCAL_FASTER_WHISPER_SCRIPT,
    CODEX_IM_OPENCLAW_TRANSCRIPTION_LOCAL_FASTER_WHISPER_CACHE_DIR: process.env.CODEX_IM_OPENCLAW_TRANSCRIPTION_LOCAL_FASTER_WHISPER_CACHE_DIR,
    CODEX_IM_OPENCLAW_STREAMING_OUTPUT: process.env.CODEX_IM_OPENCLAW_STREAMING_OUTPUT,
    CODEX_IM_SESSIONS_FILE: process.env.CODEX_IM_SESSIONS_FILE,
  };

  process.argv = [previousArgv[0], previousArgv[1], "openclaw-bot"];
  process.env.CODEX_IM_OPENCLAW_BASE_URL = "https://ilinkai.weixin.qq.com";
  process.env.CODEX_IM_OPENCLAW_TOKEN = "bot-token";
  process.env.CODEX_IM_OPENCLAW_THREAD_SOURCE = "codex";
  process.env.CODEX_IM_OPENCLAW_LONG_POLL_TIMEOUT_MS = "42000";
  process.env.CODEX_IM_OPENCLAW_TRANSCRIPTION_LOCAL_FASTER_WHISPER = "1";
  process.env.CODEX_IM_OPENCLAW_TRANSCRIPTION_LOCAL_FASTER_WHISPER_MODEL = "large-v3";
  process.env.CODEX_IM_OPENCLAW_TRANSCRIPTION_LOCAL_FASTER_WHISPER_PYTHON = "python3.12";
  process.env.CODEX_IM_OPENCLAW_TRANSCRIPTION_LOCAL_FASTER_WHISPER_SCRIPT = "/tmp/local-faster-whisper-transcribe.py";
  process.env.CODEX_IM_OPENCLAW_TRANSCRIPTION_LOCAL_FASTER_WHISPER_CACHE_DIR = "/tmp/codex-im-hf-cache";
  process.env.CODEX_IM_OPENCLAW_TRANSCRIPTION_LANGUAGE = "zh";
  process.env.CODEX_IM_OPENCLAW_TRANSCRIPTION_MAX_BYTES = "123456";
  process.env.CODEX_IM_OPENCLAW_STREAMING_OUTPUT = "false";
  delete process.env.CODEX_IM_SESSIONS_FILE;

  try {
    const config = readConfig();
    assert.equal(config.mode, "openclaw-bot");
    assert.equal(config.openclaw.baseUrl, "https://ilinkai.weixin.qq.com");
    assert.equal(config.openclaw.token, "bot-token");
    assert.equal(config.openclaw.threadSource, "codex");
    assert.equal(config.openclaw.longPollTimeoutMs, 42000);
    assert.deepEqual(config.openclaw.transcription, {
      localFasterWhisperEnabled: true,
      localFasterWhisperModel: "large-v3",
      localFasterWhisperPythonBin: "python3.12",
      localFasterWhisperScriptPath: "/tmp/local-faster-whisper-transcribe.py",
      localFasterWhisperCacheDir: "/tmp/codex-im-hf-cache",
      language: "zh",
      maxBytes: 123456,
    });
    assert.equal(config.openclawStreamingOutput, false);
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
    CODEX_IM_OPENCLAW_TRANSCRIPTION_LOCAL_FASTER_WHISPER:
      process.env.CODEX_IM_OPENCLAW_TRANSCRIPTION_LOCAL_FASTER_WHISPER,
    CODEX_IM_OPENCLAW_TRANSCRIPTION_LOCAL_WHISPER:
      process.env.CODEX_IM_OPENCLAW_TRANSCRIPTION_LOCAL_WHISPER,
  };

  process.argv = [previousArgv[0], previousArgv[1], "openclaw-bot"];
  delete process.env.CODEX_IM_OPENCLAW_THREAD_SOURCE;
  delete process.env.CODEX_IM_OPENCLAW_TRANSCRIPTION_LOCAL_FASTER_WHISPER;
  delete process.env.CODEX_IM_OPENCLAW_TRANSCRIPTION_LOCAL_WHISPER;

  try {
    const config = readConfig();
    assert.equal(config.openclaw.threadSource, "acpx");
    assert.equal(config.openclaw.transcription.localFasterWhisperModel, "base");
    assert.equal(config.openclaw.transcription.localFasterWhisperEnabled, false);
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
