const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { OpenClawBotRuntime } = require("../src/app/openclaw-bot-runtime");
const { threadSyncLoop } = require("../src/app/openclaw-thread-sync-service");

function createRuntime() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-im-openclaw-sync-"));
  return new OpenClawBotRuntime({
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
      threadSource: "codex",
      longPollTimeoutMs: 35000,
    },
    defaultWorkspaceId: "default",
    openclawStreamingOutput: false,
    sessionsFile: path.join(tempDir, "sessions.json"),
  });
}

function buildResumeResponse(userText, assistantText) {
  return {
    result: {
      thread: {
        turns: [
          {
            items: [
              {
                type: "userMessage",
                content: [{ type: "text", text: userText }],
              },
              {
                type: "agentMessage",
                text: assistantText,
              },
            ],
          },
        ],
      },
    },
  };
}

test("OpenClaw selected thread sync sends one summary when the desktop thread changes", async () => {
  const runtime = createRuntime();
  const sentMessages = [];
  let currentUpdatedAt = 100;
  let currentResumeResponse = buildResumeResponse("桌面提问 1", "桌面回答 1");

  runtime.sessionStore = {
    listBindings: () => [{
      bindingKey: "binding-1",
      binding: {
        provider: "openclaw",
        workspaceId: "default",
        chatId: "chat-1@im.wechat",
        activeWorkspaceRoot: "/repo",
        threadIdByWorkspaceRoot: {
          "/repo": "thread-1",
        },
      },
    }],
  };
  runtime.refreshWorkspaceThreads = async () => [{
    id: "thread-1",
    cwd: "/repo",
    title: "Desktop Thread",
    updatedAt: currentUpdatedAt,
  }];
  runtime.codex = {
    resumeThread: async () => currentResumeResponse,
  };
  runtime.sendTextMessage = async (payload) => {
    sentMessages.push(payload);
  };

  runtime.rememberSelectedThreadForSync("binding-1", "/repo", "thread-1");

  await runtime.syncSelectedThreads({ aborted: false });
  assert.equal(sentMessages.length, 0);

  currentUpdatedAt = 200;
  currentResumeResponse = buildResumeResponse("桌面提问 2", "桌面回答 2");

  await runtime.syncSelectedThreads({ aborted: false });

  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0].chatId, "chat-1@im.wechat");
  assert.match(sentMessages[0].text, /检测到电脑端更新/);
  assert.match(sentMessages[0].text, /Desktop Thread/);
  assert.match(sentMessages[0].text, /桌面回答 2/);
});

test("OpenClaw selected thread sync skips the next update after local activity", async () => {
  const runtime = createRuntime();
  const sentMessages = [];
  let currentUpdatedAt = 100;
  let currentResumeResponse = buildResumeResponse("微信提问 1", "微信回答 1");

  runtime.sessionStore = {
    listBindings: () => [{
      bindingKey: "binding-1",
      binding: {
        provider: "openclaw",
        workspaceId: "default",
        chatId: "chat-1@im.wechat",
        activeWorkspaceRoot: "/repo",
        threadIdByWorkspaceRoot: {
          "/repo": "thread-1",
        },
      },
    }],
  };
  runtime.refreshWorkspaceThreads = async () => [{
    id: "thread-1",
    cwd: "/repo",
    title: "Desktop Thread",
    updatedAt: currentUpdatedAt,
  }];
  runtime.codex = {
    resumeThread: async () => currentResumeResponse,
  };
  runtime.sendTextMessage = async (payload) => {
    sentMessages.push(payload);
  };

  runtime.rememberSelectedThreadForSync("binding-1", "/repo", "thread-1");

  await runtime.syncSelectedThreads({ aborted: false });
  runtime.markThreadSyncLocalActivity("thread-1");

  currentUpdatedAt = 200;
  currentResumeResponse = buildResumeResponse("微信提问 2", "微信回答 2");
  await runtime.syncSelectedThreads({ aborted: false });
  assert.equal(sentMessages.length, 0);

  currentUpdatedAt = 300;
  currentResumeResponse = buildResumeResponse("桌面提问 3", "桌面回答 3");
  await runtime.syncSelectedThreads({ aborted: false });

  assert.equal(sentMessages.length, 1);
  assert.match(sentMessages[0].text, /桌面回答 3/);
});

test("OpenClaw desktop session sync ignores recovery threads that are not desktop-visible", async () => {
  const runtime = createRuntime();
  const sentMessages = [];

  runtime.config.openclaw.threadSource = "acpx";
  runtime.sessionStore = {
    listBindings: () => [{
      bindingKey: "binding-1",
      binding: {
        provider: "openclaw",
        workspaceId: "default",
        chatId: "chat-1@im.wechat",
        activeWorkspaceRoot: "/repo",
        threadIdByWorkspaceRoot: {
          "/repo": "thread-recovery",
        },
      },
    }],
  };
  runtime.listDesktopSessionsForWorkspace = async () => [];
  runtime.sendTextMessage = async (payload) => {
    sentMessages.push(payload);
  };

  runtime.rememberSelectedThreadForSync("binding-1", "/repo", "thread-recovery", {
    desktopVisibleExpected: false,
  });

  await runtime.syncSelectedThreads({ aborted: false });

  assert.equal(sentMessages.length, 0);
});

test("OpenClaw selected thread sync ignores bindings that belong to other providers", async () => {
  const runtime = createRuntime();
  const syncedBindingKeys = [];

  runtime.sessionStore = {
    listBindings: () => [
      {
        bindingKey: "feishu-binding",
        binding: {
          provider: "feishu",
          chatId: "oc_feishu_chat",
          senderId: "ou_feishu_user",
          activeWorkspaceRoot: "/repo",
          threadIdByWorkspaceRoot: {
            "/repo": "thread-feishu",
          },
        },
      },
      {
        bindingKey: "openclaw-binding",
        binding: {
          provider: "openclaw",
          chatId: "user@im.wechat",
          senderId: "user@im.wechat",
          activeWorkspaceRoot: "/repo",
          threadIdByWorkspaceRoot: {
            "/repo": "thread-openclaw",
          },
        },
      },
    ],
  };

  runtime.syncSelectedThreadBinding = async ({ bindingKey }) => {
    syncedBindingKeys.push(bindingKey);
  };

  await runtime.syncSelectedThreads({ aborted: false });

  assert.deepEqual(syncedBindingKeys, ["openclaw-binding"]);
});

test("OpenClaw selected thread sync keeps legacy bindings without provider and skips Feishu-like ids", async () => {
  const runtime = createRuntime();
  const syncedBindingKeys = [];

  runtime.sessionStore = {
    listBindings: () => [
      {
        bindingKey: "legacy-feishu-binding",
        binding: {
          chatId: "oc_feishu_chat",
          senderId: "ou_feishu_user",
          threadKey: "om_feishu_thread",
          activeWorkspaceRoot: "/repo",
          threadIdByWorkspaceRoot: {
            "/repo": "thread-feishu",
          },
        },
      },
      {
        bindingKey: "legacy-openclaw-binding",
        binding: {
          chatId: "wxid_legacy_user",
          senderId: "wxid_legacy_user",
          threadKey: "legacy-session-id",
          activeWorkspaceRoot: "/repo",
          threadIdByWorkspaceRoot: {
            "/repo": "thread-openclaw",
          },
        },
      },
    ],
  };

  runtime.syncSelectedThreadBinding = async ({ bindingKey }) => {
    syncedBindingKeys.push(bindingKey);
  };

  await runtime.syncSelectedThreads({ aborted: false });

  assert.deepEqual(syncedBindingKeys, ["legacy-openclaw-binding"]);
});

test("OpenClaw thread sync loop runs immediately before the first interval delay", async () => {
  const runtime = {
    isStopping: false,
    sessionStore: {
      listBindings: () => [{
        bindingKey: "binding-1",
        binding: {
          provider: "openclaw",
          chatId: "chat-1@im.wechat",
          senderId: "chat-1@im.wechat",
          activeWorkspaceRoot: "/repo",
          threadIdByWorkspaceRoot: {
            "/repo": "thread-1",
          },
        },
      }],
    },
    isRuntimeBindingEntry: () => true,
    syncSelectedThreadBinding: async ({ bindingKey }) => {
      calls.push(bindingKey);
      controller.abort();
    },
  };
  const calls = [];
  const controller = new AbortController();
  const startedAt = Date.now();

  await threadSyncLoop(runtime, controller.signal, 1_000);

  assert.deepEqual(calls, ["binding-1"]);
  assert.ok(Date.now() - startedAt < 200);
});
