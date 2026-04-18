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

function buildResumeResponse(userText, assistantText, {
  threadId = "thread-1",
  name = "",
  cwd = "",
  updatedAt = 0,
} = {}) {
  return {
    result: {
      thread: {
        id: threadId,
        name,
        cwd,
        updatedAt,
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

test("OpenClaw selected thread sync skips workspace refresh when resume already includes thread metadata", async () => {
  const runtime = createRuntime();
  const sentMessages = [];
  let refreshCalls = 0;
  let currentUpdatedAt = 100;
  const originalDateNow = Date.now;
  let now = 1_700_000_000_000;
  let currentResumeResponse = buildResumeResponse("桌面提问 1", "桌面回答 1", {
    name: "Resume Thread",
    cwd: "/repo",
    updatedAt: currentUpdatedAt,
  });

  Date.now = () => now;
  try {
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
    runtime.refreshWorkspaceThreads = async () => {
      refreshCalls += 1;
      return [{
        id: "thread-1",
        cwd: "/repo",
        title: "Desktop Thread",
        updatedAt: currentUpdatedAt,
      }];
    };
    runtime.codex = {
      resumeThread: async () => currentResumeResponse,
    };
    runtime.sendTextMessage = async (payload) => {
      sentMessages.push(payload);
    };

    await runtime.syncSelectedThreads({ aborted: false });
    assert.equal(refreshCalls, 0);
    assert.equal(sentMessages.length, 0);

    currentUpdatedAt = 200;
    currentResumeResponse = buildResumeResponse("桌面提问 2", "桌面回答 2", {
      name: "Resume Thread",
      cwd: "/repo",
      updatedAt: currentUpdatedAt,
    });
    now += 5_000;
    await runtime.syncSelectedThreads({ aborted: false });

    assert.equal(refreshCalls, 0);
    assert.equal(sentMessages.length, 1);
    assert.match(sentMessages[0].text, /Resume Thread/);
    assert.match(sentMessages[0].text, /桌面回答 2/);
  } finally {
    Date.now = originalDateNow;
  }
});

test("OpenClaw selected thread sync sends one summary when the desktop thread changes", async () => {
  const runtime = createRuntime();
  const sentMessages = [];
  let refreshCalls = 0;
  let currentUpdatedAt = 100;
  const originalDateNow = Date.now;
  let now = 1_700_000_000_000;
  let currentResumeResponse = buildResumeResponse("桌面提问 1", "桌面回答 1");

  Date.now = () => now;
  try {
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
    runtime.refreshWorkspaceThreads = async () => {
      refreshCalls += 1;
      return [{
        id: "thread-1",
        cwd: "/repo",
        title: "Desktop Thread",
        updatedAt: currentUpdatedAt,
      }];
    };
    runtime.codex = {
      resumeThread: async () => currentResumeResponse,
    };
    runtime.sendTextMessage = async (payload) => {
      sentMessages.push(payload);
    };

    runtime.rememberSelectedThreadForSync("binding-1", "/repo", "thread-1");

    await runtime.syncSelectedThreads({ aborted: false });
    assert.equal(sentMessages.length, 0);
    assert.equal(refreshCalls, 1);

    currentUpdatedAt = 200;
    currentResumeResponse = buildResumeResponse("桌面提问 2", "桌面回答 2");
    now += 5_000;

    await runtime.syncSelectedThreads({ aborted: false });

    assert.equal(sentMessages.length, 1);
    assert.equal(refreshCalls, 1);
    assert.equal(sentMessages[0].chatId, "chat-1@im.wechat");
    assert.equal(sentMessages[0].useChatContext, false);
    assert.match(sentMessages[0].text, /检测到电脑端更新/);
    assert.match(sentMessages[0].text, /Desktop Thread/);
    assert.match(sentMessages[0].text, /桌面回答 2/);
  } finally {
    Date.now = originalDateNow;
  }
});

test("OpenClaw selected thread sync clears a mismatched workspace thread before sending a summary", async () => {
  const runtime = createRuntime();
  const sentMessages = [];
  const cleared = [];
  let selectedThreadId = "thread-1";
  let currentUpdatedAt = 100;
  const originalDateNow = Date.now;
  let now = 1_700_000_000_000;
  let currentResumeResponse = buildResumeResponse("桌面提问 1", "桌面回答 1", {
    name: "Cross Repo Thread",
    cwd: "/repo-other",
    updatedAt: currentUpdatedAt,
  });

  Date.now = () => now;
  try {
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
      getActiveWorkspaceRoot: () => "/repo",
      getThreadIdForWorkspace: () => selectedThreadId,
      clearThreadIdForWorkspace: (bindingKey, workspaceRoot) => {
        cleared.push([bindingKey, workspaceRoot]);
        selectedThreadId = "";
      },
    };
    runtime.refreshWorkspaceThreads = async () => [{
      id: "thread-1",
      cwd: "/repo-other",
      title: "Cross Repo Thread",
      updatedAt: currentUpdatedAt,
    }];
    runtime.codex = {
      resumeThread: async () => currentResumeResponse,
    };
    runtime.sendTextMessage = async (payload) => {
      sentMessages.push(payload);
    };

    await runtime.syncSelectedThreads({ aborted: false });

    currentUpdatedAt = 200;
    currentResumeResponse = buildResumeResponse("桌面提问 2", "桌面回答 2", {
      name: "Cross Repo Thread",
      cwd: "/repo-other",
      updatedAt: currentUpdatedAt,
    });
    now += 5_000;
    await runtime.syncSelectedThreads({ aborted: false });

    assert.ok(cleared.length >= 1);
    assert.deepEqual(cleared[0], ["binding-1", "/repo"]);
    assert.equal(sentMessages.length, 0);
  } finally {
    Date.now = originalDateNow;
  }
});

test("OpenClaw selected thread sync pauses while the same binding is dispatching a phone message", async () => {
  const runtime = createRuntime();
  let resumeCalls = 0;

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
  runtime.inFlightBindingDispatchKeys = new Set(["binding-1"]);
  runtime.codex = {
    resumeThread: async () => {
      resumeCalls += 1;
      return buildResumeResponse("桌面提问", "桌面回答", {
        name: "Resume Thread",
        cwd: "/repo",
        updatedAt: 100,
      });
    },
  };

  await runtime.syncSelectedThreads({ aborted: false });
  assert.equal(resumeCalls, 0);

  runtime.inFlightBindingDispatchKeys.clear();
  await runtime.syncSelectedThreads({ aborted: false });
  assert.equal(resumeCalls, 1);
});

test("OpenClaw selected thread sync pauses while the binding still has queued phone messages", async () => {
  const runtime = createRuntime();
  let resumeCalls = 0;

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
  runtime.pendingMessageQueueByBindingKey = new Map([
    ["binding-1", [{ bindingKey: "binding-1", workspaceRoot: "/repo", normalized: { messageId: "msg-2" } }]],
  ]);
  runtime.codex = {
    resumeThread: async () => {
      resumeCalls += 1;
      return buildResumeResponse("桌面提问", "桌面回答", {
        name: "Resume Thread",
        cwd: "/repo",
        updatedAt: 100,
      });
    },
  };

  await runtime.syncSelectedThreads({ aborted: false });
  assert.equal(resumeCalls, 0);

  runtime.pendingMessageQueueByBindingKey.clear();
  await runtime.syncSelectedThreads({ aborted: false });
  assert.equal(resumeCalls, 1);
});

test("OpenClaw selected thread sync skips the next update after local activity", async () => {
  const runtime = createRuntime();
  const sentMessages = [];
  let currentUpdatedAt = 100;
  const originalDateNow = Date.now;
  let now = 1_700_000_000_000;
  let currentResumeResponse = buildResumeResponse("微信提问 1", "微信回答 1");

  Date.now = () => now;
  try {
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
    now += 5_000;
    await runtime.syncSelectedThreads({ aborted: false });

    assert.equal(sentMessages.length, 1);
    assert.match(sentMessages[0].text, /桌面回答 3/);
  } finally {
    Date.now = originalDateNow;
  }
});

test("OpenClaw selected thread sync backs off idle resume polling for unchanged threads", async () => {
  const runtime = createRuntime();
  let resumeCalls = 0;
  const originalDateNow = Date.now;
  let now = 1_700_000_000_000;

  Date.now = () => now;
  try {
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
    runtime.refreshWorkspaceThreads = async () => {
      throw new Error("refresh should not run when resume metadata is present");
    };
    runtime.codex = {
      resumeThread: async () => {
        resumeCalls += 1;
        return buildResumeResponse("桌面提问 1", "桌面回答 1", {
          name: "Resume Thread",
          cwd: "/repo",
          updatedAt: 100,
        });
      },
    };
    runtime.sendTextMessage = async () => {
      throw new Error("should not send sync text for unchanged signature");
    };

    await runtime.syncSelectedThreads({ aborted: false });
    assert.equal(resumeCalls, 1);

    now += 5_000;
    await runtime.syncSelectedThreads({ aborted: false });
    assert.equal(resumeCalls, 2);

    now += 5_000;
    await runtime.syncSelectedThreads({ aborted: false });
    assert.equal(resumeCalls, 2);

    now += 5_000;
    await runtime.syncSelectedThreads({ aborted: false });
    assert.equal(resumeCalls, 3);
  } finally {
    Date.now = originalDateNow;
  }
});

test("OpenClaw selected thread sync backs off repeated delivery failures for the same signature", async () => {
  const runtime = createRuntime();
  let sendAttempts = 0;
  let currentUpdatedAt = 100;
  let currentResumeResponse = buildResumeResponse("桌面提问 1", "桌面回答 1", {
    name: "Resume Thread",
    cwd: "/repo",
    updatedAt: currentUpdatedAt,
  });
  const errorLogs = [];
  const originalConsoleError = console.error;
  const originalDateNow = Date.now;
  let now = 1_700_000_000_000;

  Date.now = () => now;
  console.error = (...args) => {
    errorLogs.push(args.join(" "));
  };
  try {
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
    runtime.refreshWorkspaceThreads = async () => {
      throw new Error("refresh should not run when resume metadata is present");
    };
    runtime.codex = {
      resumeThread: async () => currentResumeResponse,
    };
    runtime.sendTextMessage = async () => {
      sendAttempts += 1;
      throw new Error("sendMessage errcode=-2: unknown error");
    };

    await runtime.syncSelectedThreads({ aborted: false });

    currentUpdatedAt = 200;
    currentResumeResponse = buildResumeResponse("桌面提问 2", "桌面回答 2", {
      name: "Resume Thread",
      cwd: "/repo",
      updatedAt: currentUpdatedAt,
    });
    now += 5_000;
    await runtime.syncSelectedThreads({ aborted: false });
    assert.equal(sendAttempts, 1);

    now += 5_000;
    await runtime.syncSelectedThreads({ aborted: false });
    assert.equal(sendAttempts, 1);

    now += 61_000;
    await runtime.syncSelectedThreads({ aborted: false });
    assert.equal(sendAttempts, 2);
    assert.deepEqual(errorLogs, []);
  } finally {
    console.error = originalConsoleError;
    Date.now = originalDateNow;
  }
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

test("OpenClaw selected thread sync verifies missing threads with a forced refresh before warning", async () => {
  const runtime = createRuntime();
  const sentMessages = [];
  let refreshCalls = 0;

  runtime.sessionStore = {
    listBindings: () => [{
      bindingKey: "binding-1",
      binding: {
        provider: "openclaw",
        workspaceId: "default",
        chatId: "chat-1@im.wechat",
        activeWorkspaceRoot: "/repo",
        threadIdByWorkspaceRoot: {
          "/repo": "thread-missing",
        },
      },
    }],
  };
  runtime.refreshWorkspaceThreads = async (_bindingKey, _workspaceRoot, _normalized, options = {}) => {
    refreshCalls += 1;
    assert.equal(options.forceRefresh, true);
    return [];
  };
  runtime.codex = {
    resumeThread: async () => {
      throw new Error("thread not found");
    },
  };
  runtime.sendTextMessage = async (payload) => {
    sentMessages.push(payload);
  };

  await runtime.syncSelectedThreads({ aborted: false });

  assert.equal(refreshCalls, 1);
  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0].useChatContext, false);
  assert.match(sentMessages[0].text, /当前选中的线程已不可用/);
  assert.match(sentMessages[0].text, /thread-missing/);
});

test("OpenClaw desktop session sync auto-detects hidden recovery threads after restart", async () => {
  const runtime = createRuntime();
  const sentMessages = [];
  const resumedThreads = [];

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
  runtime.codex = {
    resumeThread: async ({ threadId }) => {
      resumedThreads.push(threadId);
      return buildResumeResponse("微信提问", "桌面回答");
    },
  };
  runtime.sendTextMessage = async (payload) => {
    sentMessages.push(payload);
  };
  runtime.resumedThreadIds = new Set();

  await runtime.syncSelectedThreads({ aborted: false });

  assert.deepEqual(resumedThreads, ["thread-recovery"]);
  assert.equal(sentMessages.length, 0);
  assert.equal(runtime.resumedThreadIds.has("thread-recovery"), true);
  assert.equal(
    runtime.threadSyncStateByKey.get("binding-1::/repo")?.desktopVisibleExpected,
    false
  );
});

test("OpenClaw desktop session sync skips hydration when the session timestamp is unchanged", async () => {
  const runtime = createRuntime();
  const sentMessages = [];
  let hydrateCalls = 0;

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
          "/repo": "session-1",
        },
      },
    }],
  };
  runtime.listDesktopSessionsForWorkspace = async () => [{
    id: "session-1",
    file: "session-1.json",
    acpSessionId: "session-1",
    acpxRecordId: "record-1",
    cwd: "/repo",
    title: "Desktop Session",
    updatedAt: 100,
    sourceKind: "desktopSession",
  }];
  runtime.hydrateDesktopSession = async (session, options = {}) => {
    hydrateCalls += 1;
    assert.deepEqual(options, { includeBridgeStatus: false });
    return {
      ...session,
      recentMessages: [
        { role: "user", text: "desktop says hi" },
        { role: "assistant", text: "codex replies" },
      ],
    };
  };
  runtime.sendTextMessage = async (payload) => {
    sentMessages.push(payload);
  };

  runtime.rememberSelectedThreadForSync("binding-1", "/repo", "session-1");

  await runtime.syncSelectedThreads({ aborted: false });
  await runtime.syncSelectedThreads({ aborted: false });

  assert.equal(hydrateCalls, 1);
  assert.equal(sentMessages.length, 0);
});

test("OpenClaw desktop session sync suppresses retryable delivery errors from top-level logs", async () => {
  const runtime = createRuntime();
  let sendAttempts = 0;
  const errorLogs = [];
  const originalConsoleError = console.error;
  const originalDateNow = Date.now;
  let now = 1_700_000_000_000;
  let currentUpdatedAt = 100;
  let recentMessages = [
    { role: "user", text: "desktop says hi 1" },
    { role: "assistant", text: "codex replies 1" },
  ];

  Date.now = () => now;
  console.error = (...args) => {
    errorLogs.push(args.join(" "));
  };

  try {
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
            "/repo": "session-1",
          },
        },
      }],
    };
    runtime.listDesktopSessionsForWorkspace = async () => [{
      id: "session-1",
      file: "session-1.json",
      acpSessionId: "session-1",
      acpxRecordId: "record-1",
      cwd: "/repo",
      title: "Desktop Session",
      updatedAt: currentUpdatedAt,
      sourceKind: "desktopSession",
    }];
    runtime.hydrateDesktopSession = async (session) => ({
      ...session,
      updatedAt: currentUpdatedAt,
      recentMessages,
    });
    runtime.sendTextMessage = async () => {
      sendAttempts += 1;
      throw new Error("sendMessage errcode=-2: unknown error");
    };

    runtime.rememberSelectedThreadForSync("binding-1", "/repo", "session-1");

    await runtime.syncSelectedThreads({ aborted: false });
    assert.equal(sendAttempts, 0);

    currentUpdatedAt = 200;
    recentMessages = [
      { role: "user", text: "desktop says hi 2" },
      { role: "assistant", text: "codex replies 2" },
    ];
    now += 5_000;
    await runtime.syncSelectedThreads({ aborted: false });
    assert.equal(sendAttempts, 1);

    now += 5_000;
    await runtime.syncSelectedThreads({ aborted: false });
    assert.equal(sendAttempts, 1);

    now += 61_000;
    await runtime.syncSelectedThreads({ aborted: false });
    assert.equal(sendAttempts, 2);
    assert.deepEqual(errorLogs, []);
  } finally {
    console.error = originalConsoleError;
    Date.now = originalDateNow;
  }
});

test("OpenClaw desktop session sync warnings skip chat-level context fallback", async () => {
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
          "/repo": "thread-missing",
        },
      },
    }],
  };
  runtime.listDesktopSessionsForWorkspace = async () => [];
  runtime.codex = {
    resumeThread: async () => {
      throw new Error("thread missing");
    },
  };
  runtime.sendTextMessage = async (payload) => {
    sentMessages.push(payload);
  };

  await runtime.syncSelectedThreads({ aborted: false });

  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0].useChatContext, false);
  assert.match(sentMessages[0].text, /当前选中的桌面会话已不可用/);
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
