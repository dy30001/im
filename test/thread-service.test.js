const assert = require("node:assert/strict");
const test = require("node:test");

const {
  handleSwitchCommand,
  ensureThreadAndSendMessage,
  resolveWorkspaceThreadState,
} = require("../src/domain/thread/thread-service");

test("resolveWorkspaceThreadState auto-switches from read-only desktop sessions to writable ones", async () => {
  const bindingKey = "binding-1";
  const workspaceRoot = "/repo";
  const normalized = {
    chatId: "chat-1",
    messageId: "msg-1",
    text: "继续聊天",
  };

  const threadAssignments = new Map([[workspaceRoot, "session-read"]]);
  const updates = [];
  const syncSelections = [];
  const warnings = [];
  const originalWarn = console.warn;

  const sessions = [
    {
      id: "session-read",
      writable: false,
      acpSessionId: "",
      acpxRecordId: "record-read",
      cwd: workspaceRoot,
      updatedAt: 100,
    },
    {
      id: "session-write",
      writable: true,
      acpSessionId: "session-write",
      acpxRecordId: "record-write",
      cwd: workspaceRoot,
      updatedAt: 200,
    },
  ];

  const runtime = {
    config: {
      openclaw: {
        threadSource: "acpx",
      },
    },
    sessionStore: {
      getThreadIdForWorkspace: (_bindingKey, currentWorkspaceRoot) => threadAssignments.get(currentWorkspaceRoot) || "",
      setThreadIdForWorkspace: (_bindingKey, currentWorkspaceRoot, threadId) => {
        threadAssignments.set(currentWorkspaceRoot, threadId);
        updates.push([currentWorkspaceRoot, threadId]);
      },
      clearThreadIdForWorkspace: () => {},
    },
    usesDesktopSessionSource: () => true,
    resolveThreadIdForBinding: (_bindingKey, currentWorkspaceRoot) => threadAssignments.get(currentWorkspaceRoot) || "",
    listDesktopSessionsForWorkspace: async () => sessions,
    resolveDesktopSessionById: (_currentWorkspaceRoot, sessionId) => (
      sessions.find((session) => (
        session.id === sessionId
        || session.acpSessionId === sessionId
        || session.acpxRecordId === sessionId
      )) || null
    ),
    hydrateDesktopSession: async (session) => session,
    setThreadBindingKey: () => {},
    setThreadWorkspaceRoot: () => {},
    rememberSelectedThreadForSync: (_binding, _root, threadId) => {
      syncSelections.push(threadId);
    },
  };

  console.warn = (...args) => {
    warnings.push(args.join(" "));
  };

  try {
    const result = await resolveWorkspaceThreadState(runtime, {
      bindingKey,
      workspaceRoot,
      normalized,
      autoSelectThread: true,
    });

    assert.equal(result.selectedThreadId, "session-read");
    assert.equal(result.threadId, "session-write");
    assert.equal(threadAssignments.get(workspaceRoot), "session-write");
    assert.deepEqual(updates, [[workspaceRoot, "session-write"]]);
    assert.deepEqual(syncSelections, ["session-write"]);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /auto-switched to writable session session-write/);
  } finally {
    console.warn = originalWarn;
  }
});

test("resolveWorkspaceThreadState skips refreshing the thread list when the current thread is already selected", async () => {
  const bindingKey = "binding-1";
  const workspaceRoot = "/repo";
  const normalized = {
    chatId: "chat-1",
    messageId: "msg-1",
    text: "继续聊天",
  };

  const threadAssignments = new Map([[workspaceRoot, "thread-1"]]);
  let refreshCalls = 0;

  const runtime = {
    sessionStore: {
      getThreadIdForWorkspace: (_bindingKey, currentWorkspaceRoot) => threadAssignments.get(currentWorkspaceRoot) || "",
      setThreadIdForWorkspace: (_bindingKey, currentWorkspaceRoot, threadId) => {
        threadAssignments.set(currentWorkspaceRoot, threadId);
      },
    },
    resolveThreadIdForBinding: (_bindingKey, currentWorkspaceRoot) => threadAssignments.get(currentWorkspaceRoot) || "",
    refreshWorkspaceThreads: async () => {
      refreshCalls += 1;
      return [];
    },
    setThreadBindingKey: () => {},
    setThreadWorkspaceRoot: () => {},
    rememberSelectedThreadForSync: () => {},
  };

  const result = await resolveWorkspaceThreadState(runtime, {
    bindingKey,
    workspaceRoot,
    normalized,
    autoSelectThread: true,
    refreshThreadList: false,
  });

  assert.equal(refreshCalls, 0);
  assert.equal(result.selectedThreadId, "thread-1");
  assert.equal(result.threadId, "thread-1");
});

test("ensureThreadAndSendMessage creates a writable recovery session when no desktop session can continue", async () => {
  const bindingKey = "binding-1";
  const workspaceRoot = "/repo";
  const normalized = {
    chatId: "chat-1",
    messageId: "msg-1",
    text: "继续聊天",
  };

  const threadAssignments = new Map([[workspaceRoot, "session-read"]]);
  const sentMessages = [];
  const warnings = [];
  const originalWarn = console.warn;

  const readOnlySession = {
    id: "session-read",
    writable: false,
    acpSessionId: "",
    acpxRecordId: "record-read",
    cwd: workspaceRoot,
    updatedAt: 100,
  };

  const runtime = {
    config: {
      openclaw: {
        threadSource: "acpx",
      },
    },
    sessionStore: {
      getThreadIdForWorkspace: (_bindingKey, currentWorkspaceRoot) => threadAssignments.get(currentWorkspaceRoot) || "",
      setThreadIdForWorkspace: (_bindingKey, currentWorkspaceRoot, threadId) => {
        threadAssignments.set(currentWorkspaceRoot, threadId);
      },
      clearThreadIdForWorkspace: () => {},
    },
    usesDesktopSessionSource: () => true,
    resolveThreadIdForBinding: (_bindingKey, currentWorkspaceRoot) => threadAssignments.get(currentWorkspaceRoot) || "",
    listDesktopSessionsForWorkspace: async () => [readOnlySession],
    resolveDesktopSessionById: (_currentWorkspaceRoot, sessionId) => {
      if (sessionId === "session-read") {
        return readOnlySession;
      }
      return null;
    },
    hydrateDesktopSession: async (session) => session,
    codex: {
      startThread: async ({ cwd }) => {
        assert.equal(cwd, workspaceRoot);
        return {
          result: {
            thread: {
              id: "session-new",
            },
          },
        };
      },
      sendUserMessage: async ({ threadId, text }) => {
        sentMessages.push({ threadId, text });
      },
    },
    getCodexParamsForWorkspace: () => ({ model: "", effort: "" }),
    setPendingThreadContext: () => {},
    setThreadBindingKey: () => {},
    setThreadWorkspaceRoot: () => {},
    rememberSelectedThreadForSync: () => {},
    resumedThreadIds: new Set(),
  };

  console.warn = (...args) => {
    warnings.push(args.join(" "));
  };

  try {
    const threadId = await ensureThreadAndSendMessage(runtime, {
      bindingKey,
      workspaceRoot,
      normalized,
      threadId: "session-read",
      forceRecoverThread: true,
    });

    assert.equal(threadId, "session-new");
    assert.equal(threadAssignments.get(workspaceRoot), "session-new");
    assert.deepEqual(sentMessages, [{ threadId: "session-new", text: "继续聊天" }]);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /created writable recovery session session-new/);
  } finally {
    console.warn = originalWarn;
  }
});

test("handleSwitchCommand accepts ordinal thread selection", async () => {
  const threadAssignments = new Map([["/repo", "session-1"]]);
  const statusCards = [];
  const sessions = [
    {
      id: "session-1",
      writable: false,
      acpSessionId: "session-1",
      acpxRecordId: "record-1",
      cwd: "/repo",
      updatedAt: 300,
    },
    {
      id: "session-2",
      writable: true,
      acpSessionId: "session-2",
      acpxRecordId: "record-2",
      cwd: "/repo",
      updatedAt: 200,
    },
    {
      id: "session-3",
      writable: true,
      acpSessionId: "session-3",
      acpxRecordId: "record-3",
      cwd: "/repo",
      updatedAt: 100,
    },
  ];

  const runtime = {
    config: {
      openclaw: {
        threadSource: "acpx",
      },
    },
    usesDesktopSessionSource: () => true,
    resolveReplyToMessageId: (_normalized, replyToMessageId = "") => replyToMessageId || "reply-1",
    getBindingContext: () => ({ bindingKey: "binding-1", workspaceRoot: "/repo" }),
    sessionStore: {
      buildBindingKey: () => "binding-1",
      getThreadIdForWorkspace: (_bindingKey, workspaceRoot) => threadAssignments.get(workspaceRoot) || "",
      setThreadIdForWorkspace: (_bindingKey, workspaceRoot, threadId) => {
        threadAssignments.set(workspaceRoot, threadId);
      },
      setActiveWorkspaceRoot: () => {},
      clearThreadIdForWorkspace: () => {},
    },
    resolveThreadIdForBinding: (_bindingKey, workspaceRoot) => threadAssignments.get(workspaceRoot) || "",
    listDesktopSessionsForWorkspace: async () => sessions,
    resolveDesktopSessionById: (_workspaceRoot, sessionId) => (
      sessions.find((session) => (
        session.id === sessionId
        || session.acpSessionId === sessionId
        || session.acpxRecordId === sessionId
      )) || null
    ),
    hydrateDesktopSession: async (session) => session,
    setThreadBindingKey: () => {},
    setThreadWorkspaceRoot: () => {},
    rememberSelectedThreadForSync: () => {},
    showStatusPanel: async (normalized, options) => {
      statusCards.push({ normalized, options });
    },
    sendInfoCardMessage: async () => {
      throw new Error("unexpected info card");
    },
    resumedThreadIds: new Set(),
  };

  await handleSwitchCommand(runtime, {
    chatId: "chat-1",
    messageId: "msg-1",
    text: "切换第二个线程",
  });

  assert.equal(threadAssignments.get("/repo"), "session-2");
  assert.equal(statusCards.length, 1);
  assert.match(statusCards[0].options.noticeText, /已切换到桌面会话/);
});

test("handleSwitchCommand accepts a bare ordinal when the remembered selection context is threads", async () => {
  const threadAssignments = new Map([["/repo", "session-1"]]);
  const statusCards = [];
  const sessions = [
    {
      id: "session-1",
      writable: false,
      acpSessionId: "session-1",
      acpxRecordId: "record-1",
      cwd: "/repo",
      updatedAt: 300,
    },
    {
      id: "session-2",
      writable: true,
      acpSessionId: "session-2",
      acpxRecordId: "record-2",
      cwd: "/repo",
      updatedAt: 200,
    },
  ];

  const runtime = {
    config: {
      openclaw: {
        threadSource: "acpx",
      },
    },
    usesDesktopSessionSource: () => true,
    resolveReplyToMessageId: (_normalized, replyToMessageId = "") => replyToMessageId || "reply-1",
    getBindingContext: () => ({ bindingKey: "binding-1", workspaceRoot: "/repo" }),
    resolveSelectionContext: () => ({ command: "threads" }),
    sessionStore: {
      buildBindingKey: () => "binding-1",
      getThreadIdForWorkspace: (_bindingKey, workspaceRoot) => threadAssignments.get(workspaceRoot) || "",
      setThreadIdForWorkspace: (_bindingKey, workspaceRoot, threadId) => {
        threadAssignments.set(workspaceRoot, threadId);
      },
      setActiveWorkspaceRoot: () => {},
      clearThreadIdForWorkspace: () => {},
    },
    resolveThreadIdForBinding: (_bindingKey, workspaceRoot) => threadAssignments.get(workspaceRoot) || "",
    listDesktopSessionsForWorkspace: async () => sessions,
    resolveDesktopSessionById: (_workspaceRoot, sessionId) => (
      sessions.find((session) => (
        session.id === sessionId
        || session.acpSessionId === sessionId
        || session.acpxRecordId === sessionId
      )) || null
    ),
    hydrateDesktopSession: async (session) => session,
    setThreadBindingKey: () => {},
    setThreadWorkspaceRoot: () => {},
    rememberSelectedThreadForSync: () => {},
    showStatusPanel: async (normalized, options) => {
      statusCards.push({ normalized, options });
    },
    sendInfoCardMessage: async () => {
      throw new Error("unexpected info card");
    },
    resumedThreadIds: new Set(),
  };

  await handleSwitchCommand(runtime, {
    chatId: "chat-1",
    messageId: "msg-1",
    text: "第二个",
  });

  assert.equal(threadAssignments.get("/repo"), "session-2");
  assert.equal(statusCards.length, 1);
  assert.match(statusCards[0].options.noticeText, /已切换到桌面会话/);
});
