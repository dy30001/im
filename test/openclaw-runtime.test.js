const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { OpenClawBotRuntime } = require("../src/app/openclaw-bot-runtime");
const { saveOpenClawCredentials } = require("../src/infra/openclaw/token-store");

test("OpenClawBotRuntime.stop closes session state and codex once", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-im-openclaw-runtime-"));
  const runtime = new OpenClawBotRuntime({
    mode: "openclaw-bot",
    workspaceAllowlist: [],
    codexEndpoint: "",
    codexCommand: "codex",
    defaultCodexModel: "gpt-5.3-codex",
    defaultCodexEffort: "medium",
    defaultCodexAccessMode: "default",
    verboseCodexLogs: false,
    openclaw: {
      baseUrl: "https://ilinkai.weixin.qq.com",
      token: "token",
      longPollTimeoutMs: 35000,
    },
    defaultWorkspaceId: "default",
    openclawStreamingOutput: false,
    sessionsFile: path.join(tempDir, "sessions.json"),
  });

  const calls = [];
  runtime.pollAbortController = {
    abort: () => {
      calls.push("abort");
    },
  };
  runtime.codex = {
    close: async () => {
      calls.push("codex");
    },
  };
  runtime.sessionStore = {
    close: async () => {
      calls.push("close");
    },
  };

  await runtime.stop();
  await runtime.stop();

  assert.equal(runtime.isStopping, true);
  assert.deepEqual(calls, ["abort", "codex", "close"]);
});

test("OpenClawBotRuntime reloads stored credentials after a credential failure", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-im-openclaw-reload-"));
  const credentialsFile = path.join(tempDir, "openclaw-credentials.json");
  saveOpenClawCredentials(credentialsFile, {
    token: "fresh-token",
    baseUrl: "https://ilinkai.weixin.qq.com",
  });

  const runtime = new OpenClawBotRuntime({
    mode: "openclaw-bot",
    workspaceAllowlist: [],
    codexEndpoint: "",
    codexCommand: "codex",
    defaultCodexModel: "gpt-5.3-codex",
    defaultCodexEffort: "medium",
    defaultCodexAccessMode: "default",
    verboseCodexLogs: false,
    openclaw: {
      baseUrl: "https://ilinkai.weixin.qq.com",
      token: "stale-token",
      longPollTimeoutMs: 35000,
      credentialsFile,
    },
    defaultWorkspaceId: "default",
    openclawStreamingOutput: false,
    sessionsFile: path.join(tempDir, "sessions.json"),
  });

  runtime.syncCursor = "cursor-1";

  const recovered = await runtime.tryRecoverFromPollError(
    new Error("getUpdates errcode=-14: session timeout")
  );

  assert.equal(recovered, true);
  assert.equal(runtime.config.openclaw.token, "fresh-token");
  assert.equal(runtime.openclawAdapter.token, "fresh-token");
  assert.equal(runtime.syncCursor, "");
});

test("OpenClawBotRuntime reports non-recoverable credential failures when no newer token exists", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-im-openclaw-no-reload-"));
  const credentialsFile = path.join(tempDir, "openclaw-credentials.json");
  saveOpenClawCredentials(credentialsFile, {
    token: "same-token",
    baseUrl: "https://ilinkai.weixin.qq.com",
  });

  const runtime = new OpenClawBotRuntime({
    mode: "openclaw-bot",
    workspaceAllowlist: [],
    codexEndpoint: "",
    codexCommand: "codex",
    defaultCodexModel: "gpt-5.3-codex",
    defaultCodexEffort: "medium",
    defaultCodexAccessMode: "default",
    verboseCodexLogs: false,
    openclaw: {
      baseUrl: "https://ilinkai.weixin.qq.com",
      token: "same-token",
      longPollTimeoutMs: 35000,
      credentialsFile,
    },
    defaultWorkspaceId: "default",
    openclawStreamingOutput: false,
    sessionsFile: path.join(tempDir, "sessions.json"),
  });

  const recovered = await runtime.tryRecoverFromPollError(
    new Error("getUpdates errcode=-14: session timeout")
  );

  assert.equal(recovered, false);
  assert.equal(runtime.config.openclaw.token, "same-token");
});

test("OpenClawBotRuntime warns when local faster-whisper is disabled", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-im-openclaw-voice-warn-"));
  const runtime = new OpenClawBotRuntime({
    mode: "openclaw-bot",
    workspaceAllowlist: [],
    codexEndpoint: "",
    codexCommand: "codex",
    defaultCodexModel: "gpt-5.3-codex",
    defaultCodexEffort: "medium",
    defaultCodexAccessMode: "default",
    verboseCodexLogs: false,
    openclaw: {
      baseUrl: "https://ilinkai.weixin.qq.com",
      token: "token",
      longPollTimeoutMs: 35000,
      transcription: {
        localFasterWhisperEnabled: false,
      },
    },
    defaultWorkspaceId: "default",
    openclawStreamingOutput: false,
    sessionsFile: path.join(tempDir, "sessions.json"),
  });

  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => {
    warnings.push(args.join(" "));
  };
  try {
    runtime.reportVoiceTranscriptionStatus();
  } finally {
    console.warn = originalWarn;
  }

  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /voice transcription disabled/i);
});

test("OpenClawBotRuntime does not warn when local faster-whisper is enabled", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-im-openclaw-voice-ok-"));
  const runtime = new OpenClawBotRuntime({
    mode: "openclaw-bot",
    workspaceAllowlist: [],
    codexEndpoint: "",
    codexCommand: "codex",
    defaultCodexModel: "gpt-5.3-codex",
    defaultCodexEffort: "medium",
    defaultCodexAccessMode: "default",
    verboseCodexLogs: false,
    openclaw: {
      baseUrl: "https://ilinkai.weixin.qq.com",
      token: "token",
      longPollTimeoutMs: 35000,
      transcription: {
        localFasterWhisperEnabled: true,
        localFasterWhisperModel: "base",
        localFasterWhisperPythonBin: "python3",
        localFasterWhisperScriptPath: "/tmp/local-faster-whisper-transcribe.py",
        localFasterWhisperCacheDir: "/tmp/local-faster-whisper-cache",
      },
    },
    defaultWorkspaceId: "default",
    openclawStreamingOutput: false,
    sessionsFile: path.join(tempDir, "sessions.json"),
  });

  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => {
    warnings.push(args.join(" "));
  };
  try {
    runtime.reportVoiceTranscriptionStatus();
  } finally {
    console.warn = originalWarn;
  }

  assert.deepEqual(warnings, []);
});
