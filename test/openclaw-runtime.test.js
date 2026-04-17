const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const appDispatcher = require("../src/app/dispatcher");
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
    accountId: "account-1",
    userId: "user-1",
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
  assert.equal(runtime.config.openclaw.accountId, "account-1");
  assert.equal(runtime.config.openclaw.userId, "user-1");
  assert.equal(runtime.openclawAdapter.token, "fresh-token");
  assert.equal(runtime.syncCursor, "");
});

test("OpenClawBotRuntime reports a failed credential recovery when QR re-login does not succeed", async () => {
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

  runtime.ensureOpenClawCredentials = async () => {
    throw new Error("扫码登录超时，请重试");
  };

  const recovered = await runtime.tryRecoverFromPollError(
    new Error("getUpdates errcode=-14: session timeout")
  );

  assert.equal(recovered, false);
  assert.equal(runtime.config.openclaw.token, "same-token");
});

test("OpenClawBotRuntime falls back to QR re-login when stored credentials are also expired", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-im-openclaw-qr-recover-"));
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

  const ensureCalls = [];
  runtime.ensureOpenClawCredentials = async (options = {}) => {
    ensureCalls.push(options);
    runtime.applyOpenClawCredentials({
      token: "qr-token",
      baseUrl: "https://ilinkai.weixin.qq.com",
      accountId: "account-9",
      userId: "user-9",
    });
  };

  const recovered = await runtime.tryRecoverFromPollError(
    new Error("getUpdates errcode=-14: session timeout")
  );

  assert.equal(recovered, true);
  assert.deepEqual(ensureCalls, [{ forceRefresh: true }]);
  assert.equal(runtime.config.openclaw.token, "qr-token");
  assert.equal(runtime.config.openclaw.accountId, "account-9");
});

test("OpenClawBotRuntime does not auto override an explicit env token during credential recovery", async () => {
  const previousEnvToken = process.env.CODEX_IM_OPENCLAW_TOKEN;
  process.env.CODEX_IM_OPENCLAW_TOKEN = "env-token";

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-im-openclaw-env-token-"));
  const credentialsFile = path.join(tempDir, "openclaw-credentials.json");
  saveOpenClawCredentials(credentialsFile, {
    token: "env-token",
    baseUrl: "https://ilinkai.weixin.qq.com",
  });

  try {
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
        token: "env-token",
        longPollTimeoutMs: 35000,
        credentialsFile,
      },
      defaultWorkspaceId: "default",
      openclawStreamingOutput: false,
      sessionsFile: path.join(tempDir, "sessions.json"),
    });

    let ensureCalled = false;
    runtime.ensureOpenClawCredentials = async () => {
      ensureCalled = true;
    };

    const recovered = await runtime.tryRecoverFromPollError(
      new Error("getUpdates errcode=-14: session timeout")
    );

    assert.equal(recovered, false);
    assert.equal(ensureCalled, false);
  } finally {
    if (previousEnvToken === undefined) {
      delete process.env.CODEX_IM_OPENCLAW_TOKEN;
    } else {
      process.env.CODEX_IM_OPENCLAW_TOKEN = previousEnvToken;
    }
  }
});

test("OpenClawBotRuntime sends messages with the bot account id", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-im-openclaw-send-from-id-"));
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
      accountId: "account-1",
      userId: "user-1",
      longPollTimeoutMs: 35000,
    },
    defaultWorkspaceId: "default",
    openclawStreamingOutput: false,
    sessionsFile: path.join(tempDir, "sessions.json"),
  });

  const sendCalls = [];
  runtime.openclawAdapter = {
    sendTextMessage: async (payload) => {
      sendCalls.push({ ...payload });
      return { ret: 0 };
    },
  };
  runtime.markHeartbeat = async () => {};

  const response = await runtime.sendTextMessage({
    chatId: "wx-user-1",
    text: "hello",
  });

  assert.deepEqual(response, { ret: 0 });
  assert.equal(sendCalls.length, 1);
  assert.equal(sendCalls[0].fromUserId, "account-1");
  assert.equal(sendCalls[0].toUserId, "wx-user-1");
});

test("OpenClawBotRuntime writes heartbeat metadata to disk", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-im-openclaw-heartbeat-"));
  const heartbeatFile = path.join(tempDir, "heartbeat.json");
  const previousHeartbeatFile = process.env.CODEX_IM_OPENCLAW_HEARTBEAT_FILE;
  process.env.CODEX_IM_OPENCLAW_HEARTBEAT_FILE = heartbeatFile;

  try {
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

    await runtime.markHeartbeat("poll");

    const heartbeat = JSON.parse(fs.readFileSync(heartbeatFile, "utf8"));
    assert.equal(heartbeat.reason, "poll");
    assert.equal(heartbeat.pid, process.pid);
    assert.equal(typeof heartbeat.updatedAt, "number");
    assert.ok(heartbeat.updatedAt > 0);
  } finally {
    if (previousHeartbeatFile === undefined) {
      delete process.env.CODEX_IM_OPENCLAW_HEARTBEAT_FILE;
    } else {
      process.env.CODEX_IM_OPENCLAW_HEARTBEAT_FILE = previousHeartbeatFile;
    }
  }
});

test("OpenClawBotRuntime.start skips optional background loops in minimal mode", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-im-openclaw-minimal-start-"));
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
      minimalMode: true,
      threadSource: "codex",
      longPollTimeoutMs: 35000,
      turnStallTimeoutMs: 60 * 60 * 1000,
      turnStallCheckIntervalMs: 60 * 1000,
    },
    defaultWorkspaceId: "default",
    openclawStreamingOutput: true,
    sessionsFile: path.join(tempDir, "sessions.json"),
  });

  const calls = [];
  runtime.ensureOpenClawCredentials = async () => {
    calls.push("credentials");
  };
  runtime.codex = {
    connect: async () => {
      calls.push("connect");
    },
    initialize: async () => {
      calls.push("initialize");
    },
    close: async () => {
      calls.push("close");
    },
    onMessage: () => {},
  };
  runtime.markHeartbeat = async (reason) => {
    calls.push(reason);
  };
  runtime.startPolling = function startPollingStub() {
    calls.push("poll");
    this.pollAbortController = {
      abort: () => {
        calls.push("abort");
      },
    };
    this.pollLoopPromise = Promise.resolve();
  };
  runtime.sessionStore = {
    close: async () => {
      calls.push("session-close");
    },
  };

  await runtime.start();

  assert.deepEqual(calls, ["credentials", "connect", "initialize", "runtime-ready", "poll"]);
  assert.equal(runtime.threadSyncLoopPromise, null);
  assert.equal(runtime.turnStallWatchdogTimer, null);

  await runtime.stop();
});

test("OpenClawBotRuntime pollLoop does not block message dispatch on heartbeat writes", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-im-openclaw-poll-heartbeat-"));
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
      threadSource: "codex",
    },
    defaultWorkspaceId: "default",
    openclawStreamingOutput: false,
    sessionsFile: path.join(tempDir, "sessions.json"),
  });

  const events = [];
  const controller = new AbortController();
  runtime.openclawAdapter = {
    getUpdates: async () => ({
      get_updates_buf: "cursor-2",
      msgs: [{
        message_id: "msg-1",
        from_user_id: "wx-user-1",
        to_user_id: "wx-bot-1",
        session_id: "session-1",
        message_type: 2,
        item_list: [{
          type: 1,
          text_item: {
            text: "hello",
          },
        }],
      }],
    }),
  };
  runtime.markHeartbeat = async (reason) => {
    events.push(`heartbeat:${reason}:start`);
    await new Promise((resolve) => setTimeout(resolve, 50));
    events.push(`heartbeat:${reason}:end`);
  };
  runtime.dispatchTextCommand = async () => true;

  const originalOnOpenClawTextEvent = appDispatcher.onOpenClawTextEvent;
  appDispatcher.onOpenClawTextEvent = async () => {
    events.push("dispatch");
    controller.abort();
  };

  try {
    await runtime.pollLoop(controller.signal);
    await new Promise((resolve) => setTimeout(resolve, 60));
  } finally {
    appDispatcher.onOpenClawTextEvent = originalOnOpenClawTextEvent;
  }

  assert.deepEqual(events.slice(0, 2), [
    "heartbeat:poll:start",
    "dispatch",
  ]);
  assert.ok(events.includes("heartbeat:poll:end"));
});

test("OpenClawBotRuntime retries sendTextMessage without context token on OpenClaw sendMessage failure", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-im-openclaw-send-retry-"));
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

  runtime.messageContextByMessageId = new Map([
    ["reply-1", {
      contextToken: "ctx-1",
    }],
  ]);
  runtime.openclawAdapter = {
    sendTextMessage: async (payload) => {
      runtime.__sendCalls = runtime.__sendCalls || [];
      runtime.__sendCalls.push({ ...payload });
      if (payload.contextToken) {
        throw new Error("sendMessage errcode=-2: unknown error");
      }
      return { ret: 0 };
    },
  };
  const heartbeatReasons = [];
  runtime.markHeartbeat = async (reason) => {
    heartbeatReasons.push(reason);
  };

  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => {
    warnings.push(args.join(" "));
  };

  try {
    const response = await runtime.sendTextMessage({
      chatId: "wx-user-1",
      replyToMessageId: "reply-1",
      text: "hello",
    });
    const repeatedResponse = await runtime.sendTextMessage({
      chatId: "wx-user-1",
      replyToMessageId: "reply-1",
      text: "hello again",
    });

    assert.equal(runtime.__sendCalls.length, 4);
    assert.equal(runtime.__sendCalls[0].contextToken, "ctx-1");
    assert.equal(runtime.__sendCalls[1].contextToken, "");
    assert.equal(runtime.__sendCalls[2].contextToken, "ctx-1");
    assert.equal(runtime.__sendCalls[3].contextToken, "");
    assert.equal(runtime.__sendCalls[0].clientId, runtime.__sendCalls[1].clientId);
    assert.equal(runtime.__sendCalls[2].clientId, runtime.__sendCalls[3].clientId);
    assert.notEqual(runtime.__sendCalls[0].clientId, runtime.__sendCalls[2].clientId);
    assert.equal(runtime.__sendCalls[0].toUserId, "wx-user-1");
    assert.deepEqual(response, { ret: 0 });
    assert.deepEqual(repeatedResponse, { ret: 0 });
  } finally {
    console.warn = originalWarn;
  }

  assert.equal(warnings.length, 1);
  assert.deepEqual(heartbeatReasons, ["send-retry", "send-retry"]);
});

test("OpenClawBotRuntime retries sendTextMessage after recovering expired credentials", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-im-openclaw-send-credential-recover-"));
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

  const sendCalls = [];
  runtime.openclawAdapter = {
    sendTextMessage: async (payload) => {
      sendCalls.push({ ...payload });
      if (sendCalls.length === 1) {
        throw new Error("sendMessage invalid token");
      }
      return { ret: 0 };
    },
  };

  const heartbeatReasons = [];
  runtime.markHeartbeat = async (reason) => {
    heartbeatReasons.push(reason);
  };

  const recoveryErrors = [];
  runtime.tryRecoverFromPollError = async (error) => {
    recoveryErrors.push(error.message);
    return true;
  };

  const response = await runtime.sendTextMessage({
    chatId: "wx-user-1",
    text: "hello",
  });

  assert.deepEqual(response, { ret: 0 });
  assert.equal(sendCalls.length, 2);
  assert.deepEqual(recoveryErrors, ["sendMessage invalid token"]);
  assert.deepEqual(heartbeatReasons, ["send-recover"]);
});

test("OpenClawBotRuntime can skip chat-level context fallback for proactive sends", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-im-openclaw-send-no-chat-context-"));
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

  runtime.latestMessageContextByChatId = new Map([
    ["wx-user-1", {
      contextToken: "ctx-chat-1",
    }],
  ]);
  const sendCalls = [];
  runtime.openclawAdapter = {
    sendTextMessage: async (payload) => {
      sendCalls.push({ ...payload });
      return { ret: 0 };
    },
  };

  const response = await runtime.sendTextMessage({
    chatId: "wx-user-1",
    text: "system notice",
    useChatContext: false,
  });

  assert.deepEqual(response, { ret: 0 });
  assert.equal(sendCalls.length, 1);
  assert.equal(sendCalls[0].contextToken, "");
});

test("OpenClawBotRuntime restarts itself when a running turn has been inactive for over 1 hour", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-im-openclaw-stall-"));
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
      turnStallTimeoutMs: 60 * 60 * 1000,
      turnStallCheckIntervalMs: 60 * 1000,
    },
    defaultWorkspaceId: "default",
    openclawStreamingOutput: false,
    sessionsFile: path.join(tempDir, "sessions.json"),
  });

  const now = Date.now();
  const heartbeatReasons = [];
  const notices = [];
  const exits = [];
  runtime.activeTurnIdByThreadId.set("thread-1", "turn-1");
  runtime.activeTurnStartedAtByThreadId.set("thread-1", now - (65 * 60 * 1000));
  runtime.lastTurnActivityAtByThreadId.set("thread-1", now - (62 * 60 * 1000));
  runtime.pendingChatContextByThreadId.set("thread-1", {
    chatId: "wx-user-1",
    messageId: "msg-1",
    contextToken: "ctx-1",
  });
  runtime.markHeartbeat = async (reason) => {
    heartbeatReasons.push(reason);
  };
  runtime.sendInfoCardMessage = async (payload) => {
    notices.push(payload);
  };
  runtime.exitForSupervisorRestart = async (code) => {
    exits.push(code);
  };

  const result = await runtime.checkForStalledTurns(now);

  assert.deepEqual(result, {
    threadId: "thread-1",
    turnId: "turn-1",
    inactiveMs: 62 * 60 * 1000,
    timeoutMs: 60 * 60 * 1000,
  });
  assert.deepEqual(heartbeatReasons, ["stalled-turn"]);
  assert.equal(notices.length, 1);
  assert.equal(notices[0].chatId, "wx-user-1");
  assert.match(notices[0].text, /自动重启/);
  assert.match(notices[0].text, /1 小时/);
  assert.deepEqual(exits, [1]);
  assert.equal(runtime.pendingSupervisorRestart, true);
});

test("OpenClawBotRuntime keeps running when the current turn is still active recently", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-im-openclaw-stall-safe-"));
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
      turnStallTimeoutMs: 60 * 60 * 1000,
      turnStallCheckIntervalMs: 60 * 1000,
    },
    defaultWorkspaceId: "default",
    openclawStreamingOutput: false,
    sessionsFile: path.join(tempDir, "sessions.json"),
  });

  const now = Date.now();
  let exited = false;
  runtime.activeTurnIdByThreadId.set("thread-1", "turn-1");
  runtime.activeTurnStartedAtByThreadId.set("thread-1", now - (65 * 60 * 1000));
  runtime.lastTurnActivityAtByThreadId.set("thread-1", now - (2 * 60 * 1000));
  runtime.exitForSupervisorRestart = async () => {
    exited = true;
  };

  const result = await runtime.checkForStalledTurns(now);

  assert.equal(result, null);
  assert.equal(exited, false);
  assert.equal(runtime.pendingSupervisorRestart, false);
});

test("OpenClawBotRuntime does not restart while the turn is waiting for approval", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-im-openclaw-stall-approval-"));
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
      turnStallTimeoutMs: 60 * 60 * 1000,
      turnStallCheckIntervalMs: 60 * 1000,
    },
    defaultWorkspaceId: "default",
    openclawStreamingOutput: false,
    sessionsFile: path.join(tempDir, "sessions.json"),
  });

  const now = Date.now();
  let exited = false;
  runtime.activeTurnIdByThreadId.set("thread-1", "turn-1");
  runtime.activeTurnStartedAtByThreadId.set("thread-1", now - (65 * 60 * 1000));
  runtime.lastTurnActivityAtByThreadId.set("thread-1", now - (62 * 60 * 1000));
  runtime.pendingApprovalByThreadId.set("thread-1", {
    requestId: 1,
  });
  runtime.exitForSupervisorRestart = async () => {
    exited = true;
  };

  const result = await runtime.checkForStalledTurns(now);

  assert.equal(result, null);
  assert.equal(exited, false);
  assert.equal(runtime.pendingSupervisorRestart, false);
});
