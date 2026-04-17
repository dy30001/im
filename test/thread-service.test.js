const assert = require("node:assert/strict");
const test = require("node:test");

const {
  createWorkspaceThread,
  handleSwitchCommand,
  handleNewCommand,
  ensureThreadAndSendMessage,
  refreshWorkspaceThreads,
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

test("resolveWorkspaceThreadState keeps an existing recovery thread when it is not desktop-visible", async () => {
  const bindingKey = "binding-1";
  const workspaceRoot = "/repo";
  const normalized = {
    chatId: "chat-1",
    messageId: "msg-1",
    text: "继续聊天",
  };

  const threadAssignments = new Map([[workspaceRoot, "session-recovery"]]);
  const syncSelections = [];
  let clearCalls = 0;

  const sessions = [
    {
      id: "session-read",
      writable: false,
      acpSessionId: "",
      acpxRecordId: "record-read",
      cwd: workspaceRoot,
      updatedAt: 100,
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
      },
      clearThreadIdForWorkspace: () => {
        clearCalls += 1;
      },
    },
    usesDesktopSessionSource: () => true,
    resolveThreadIdForBinding: (_bindingKey, currentWorkspaceRoot) => threadAssignments.get(currentWorkspaceRoot) || "",
    listDesktopSessionsForWorkspace: async () => sessions,
    resolveDesktopSessionById: () => null,
    hydrateDesktopSession: async () => null,
    setThreadBindingKey: () => {},
    setThreadWorkspaceRoot: () => {},
    rememberSelectedThreadForSync: (_binding, _root, threadId, options = {}) => {
      syncSelections.push({ threadId, options });
    },
  };

  const result = await resolveWorkspaceThreadState(runtime, {
    bindingKey,
    workspaceRoot,
    normalized,
    autoSelectThread: true,
  });

  assert.equal(result.selectedThreadId, "session-recovery");
  assert.equal(result.threadId, "session-recovery");
  assert.equal(threadAssignments.get(workspaceRoot), "session-recovery");
  assert.equal(clearCalls, 0);
  assert.deepEqual(syncSelections, [{
    threadId: "session-recovery",
    options: { desktopVisibleExpected: false },
  }]);
});

test("resolveWorkspaceThreadState skips desktop sessions already claimed by another binding when shared reuse is disabled", async () => {
  const bindingKey = "binding-2";
  const workspaceRoot = "/repo";
  const normalized = {
    chatId: "chat-2",
    messageId: "msg-2",
    text: "继续聊天",
  };

  const threadAssignments = new Map([
    ["binding-1:/repo", "session-1"],
    ["binding-2:/repo", ""],
  ]);
  const updates = [];
  const sessions = [
    {
      id: "session-1",
      writable: true,
      acpSessionId: "session-1",
      acpxRecordId: "record-1",
      cwd: workspaceRoot,
      updatedAt: 200,
    },
    {
      id: "session-2",
      writable: true,
      acpSessionId: "session-2",
      acpxRecordId: "record-2",
      cwd: workspaceRoot,
      updatedAt: 100,
    },
  ];

  const runtime = {
    config: {
      openclaw: {
        threadSource: "acpx",
      },
    },
    sessionStore: {
      getThreadIdForWorkspace: (currentBindingKey, currentWorkspaceRoot) => (
        threadAssignments.get(`${currentBindingKey}:${currentWorkspaceRoot}`) || ""
      ),
      setThreadIdForWorkspace: (currentBindingKey, currentWorkspaceRoot, threadId) => {
        threadAssignments.set(`${currentBindingKey}:${currentWorkspaceRoot}`, threadId);
        updates.push([currentBindingKey, currentWorkspaceRoot, threadId]);
      },
      clearThreadIdForWorkspace: () => {},
      listBindings: () => ([
        {
          bindingKey: "binding-1",
          binding: {
            threadIdByWorkspaceRoot: {
              [workspaceRoot]: threadAssignments.get("binding-1:/repo") || "",
            },
          },
        },
        {
          bindingKey: "binding-2",
          binding: {
            threadIdByWorkspaceRoot: {
              [workspaceRoot]: threadAssignments.get("binding-2:/repo") || "",
            },
          },
        },
      ]),
    },
    usesDesktopSessionSource: () => true,
    resolveThreadIdForBinding: (currentBindingKey, currentWorkspaceRoot) => (
      threadAssignments.get(`${currentBindingKey}:${currentWorkspaceRoot}`) || ""
    ),
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
    rememberSelectedThreadForSync: () => {},
  };

  const result = await resolveWorkspaceThreadState(runtime, {
    bindingKey,
    workspaceRoot,
    normalized,
    autoSelectThread: true,
    allowClaimedThreadReuse: false,
  });

  assert.equal(result.selectedThreadId, "");
  assert.equal(result.threadId, "session-2");
  assert.deepEqual(updates, [["binding-2", "/repo", "session-2"]]);
});

test("resolveWorkspaceThreadState clears a shared selected desktop session when shared reuse is disabled", async () => {
  const bindingKey = "binding-2";
  const workspaceRoot = "/repo";
  const normalized = {
    chatId: "chat-2",
    messageId: "msg-2",
    text: "继续聊天",
  };

  const threadAssignments = new Map([
    ["binding-1:/repo", "session-1"],
    ["binding-2:/repo", "session-1"],
  ]);
  let clearCalls = 0;
  const sessions = [
    {
      id: "session-1",
      writable: true,
      acpSessionId: "session-1",
      acpxRecordId: "record-1",
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
      getThreadIdForWorkspace: (currentBindingKey, currentWorkspaceRoot) => (
        threadAssignments.get(`${currentBindingKey}:${currentWorkspaceRoot}`) || ""
      ),
      setThreadIdForWorkspace: () => {
        throw new Error("should not reassign a claimed desktop session");
      },
      clearThreadIdForWorkspace: (currentBindingKey, currentWorkspaceRoot) => {
        clearCalls += 1;
        threadAssignments.set(`${currentBindingKey}:${currentWorkspaceRoot}`, "");
      },
      listBindings: () => ([
        {
          bindingKey: "binding-1",
          binding: {
            threadIdByWorkspaceRoot: {
              [workspaceRoot]: threadAssignments.get("binding-1:/repo") || "",
            },
          },
        },
        {
          bindingKey: "binding-2",
          binding: {
            threadIdByWorkspaceRoot: {
              [workspaceRoot]: threadAssignments.get("binding-2:/repo") || "",
            },
          },
        },
      ]),
    },
    usesDesktopSessionSource: () => true,
    resolveThreadIdForBinding: (currentBindingKey, currentWorkspaceRoot) => (
      threadAssignments.get(`${currentBindingKey}:${currentWorkspaceRoot}`) || ""
    ),
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
    rememberSelectedThreadForSync: () => {},
  };

  const result = await resolveWorkspaceThreadState(runtime, {
    bindingKey,
    workspaceRoot,
    normalized,
    autoSelectThread: true,
    allowClaimedThreadReuse: false,
  });

  assert.equal(result.selectedThreadId, "session-1");
  assert.equal(result.threadId, "");
  assert.equal(clearCalls, 1);
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

test("resolveWorkspaceThreadState skips threads already claimed by another binding when shared reuse is disabled", async () => {
  const bindingKey = "binding-2";
  const workspaceRoot = "/repo";
  const normalized = {
    chatId: "chat-2",
    messageId: "msg-2",
    text: "继续聊天",
  };

  const threadAssignments = new Map([
    ["binding-1:/repo", "thread-1"],
    ["binding-2:/repo", ""],
  ]);
  const updates = [];

  const runtime = {
    sessionStore: {
      getThreadIdForWorkspace: (currentBindingKey, currentWorkspaceRoot) => (
        threadAssignments.get(`${currentBindingKey}:${currentWorkspaceRoot}`) || ""
      ),
      setThreadIdForWorkspace: (currentBindingKey, currentWorkspaceRoot, threadId) => {
        threadAssignments.set(`${currentBindingKey}:${currentWorkspaceRoot}`, threadId);
        updates.push([currentBindingKey, currentWorkspaceRoot, threadId]);
      },
      listBindings: () => ([
        {
          bindingKey: "binding-1",
          binding: {
            threadIdByWorkspaceRoot: {
              [workspaceRoot]: threadAssignments.get("binding-1:/repo") || "",
            },
          },
        },
        {
          bindingKey: "binding-2",
          binding: {
            threadIdByWorkspaceRoot: {
              [workspaceRoot]: threadAssignments.get("binding-2:/repo") || "",
            },
          },
        },
      ]),
    },
    resolveThreadIdForBinding: (currentBindingKey, currentWorkspaceRoot) => (
      threadAssignments.get(`${currentBindingKey}:${currentWorkspaceRoot}`) || ""
    ),
    workspaceThreadListCacheByKey: new Map(),
    workspaceThreadRefreshStateByKey: new Map(),
    workspaceThreadSharedCacheByKey: new Map(),
    workspaceThreadRefreshPromiseByKey: new Map(),
    resumedThreadIds: new Set(),
    codex: {
      listThreads: async () => ({
        result: {
          data: [
            {
              id: "thread-1",
              cwd: workspaceRoot,
              name: "Thread 1",
              updatedAt: 200,
            },
            {
              id: "thread-2",
              cwd: workspaceRoot,
              name: "Thread 2",
              updatedAt: 100,
            },
          ],
          nextCursor: "",
        },
      }),
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
    allowClaimedThreadReuse: false,
  });

  assert.equal(result.selectedThreadId, "");
  assert.equal(result.threadId, "thread-2");
  assert.deepEqual(updates, [["binding-2", "/repo", "thread-2"]]);
});

test("resolveWorkspaceThreadState ignores a shared selected thread when shared reuse is disabled", async () => {
  const bindingKey = "binding-2";
  const workspaceRoot = "/repo";
  const normalized = {
    chatId: "chat-2",
    messageId: "msg-2",
    text: "继续聊天",
  };

  const threadAssignments = new Map([
    ["binding-1:/repo", "thread-1"],
    ["binding-2:/repo", "thread-1"],
  ]);

  const runtime = {
    sessionStore: {
      getThreadIdForWorkspace: (currentBindingKey, currentWorkspaceRoot) => (
        threadAssignments.get(`${currentBindingKey}:${currentWorkspaceRoot}`) || ""
      ),
      setThreadIdForWorkspace: () => {
        throw new Error("should not reassign a claimed thread");
      },
      listBindings: () => ([
        {
          bindingKey: "binding-1",
          binding: {
            threadIdByWorkspaceRoot: {
              [workspaceRoot]: threadAssignments.get("binding-1:/repo") || "",
            },
          },
        },
        {
          bindingKey: "binding-2",
          binding: {
            threadIdByWorkspaceRoot: {
              [workspaceRoot]: threadAssignments.get("binding-2:/repo") || "",
            },
          },
        },
      ]),
    },
    resolveThreadIdForBinding: (currentBindingKey, currentWorkspaceRoot) => (
      threadAssignments.get(`${currentBindingKey}:${currentWorkspaceRoot}`) || ""
    ),
    workspaceThreadListCacheByKey: new Map(),
    workspaceThreadRefreshStateByKey: new Map(),
    workspaceThreadSharedCacheByKey: new Map(),
    workspaceThreadRefreshPromiseByKey: new Map(),
    resumedThreadIds: new Set(),
    codex: {
      listThreads: async () => ({
        result: {
          data: [
            {
              id: "thread-1",
              cwd: workspaceRoot,
              name: "Thread 1",
              updatedAt: 200,
            },
          ],
          nextCursor: "",
        },
      }),
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
    allowClaimedThreadReuse: false,
  });

  assert.equal(result.selectedThreadId, "thread-1");
  assert.equal(result.threadId, "");
});

test("refreshWorkspaceThreads reuses a fresh cache without calling Codex again", async () => {
  const bindingKey = "binding-1";
  const workspaceRoot = "/repo";
  const normalized = {
    chatId: "chat-1",
    messageId: "msg-1",
    text: "继续聊天",
  };

  let listCalls = 0;
  const runtime = {
    workspaceThreadListCacheByKey: new Map(),
    workspaceThreadRefreshStateByKey: new Map(),
    sessionStore: {
      getThreadIdForWorkspace: () => "",
      setThreadIdForWorkspace: () => {},
      clearThreadIdForWorkspace: () => {},
    },
    codex: {
      listThreads: async () => {
        listCalls += 1;
        return {
          result: {
            data: [
              {
                id: "thread-1",
                cwd: workspaceRoot,
                name: "Thread 1",
                updatedAt: 100,
              },
            ],
            nextCursor: "",
          },
        };
      },
    },
    setThreadBindingKey: () => {},
    setThreadWorkspaceRoot: () => {},
    rememberSelectedThreadForSync: () => {},
  };

  const first = await refreshWorkspaceThreads(runtime, bindingKey, workspaceRoot, normalized);
  const second = await refreshWorkspaceThreads(runtime, bindingKey, workspaceRoot, normalized);

  assert.equal(listCalls, 1);
  assert.deepEqual(first, second);
  assert.equal(runtime.workspaceThreadRefreshStateByKey.get(`${bindingKey}::${workspaceRoot}`).fromCache, true);
});

test("refreshWorkspaceThreads forceRefresh bypasses a fresh cache", async () => {
  const bindingKey = "binding-1";
  const workspaceRoot = "/repo";
  const normalized = {
    chatId: "chat-1",
    messageId: "msg-1",
    text: "继续聊天",
  };

  let listCalls = 0;
  const runtime = {
    workspaceThreadListCacheByKey: new Map(),
    workspaceThreadRefreshStateByKey: new Map(),
    sessionStore: {
      getThreadIdForWorkspace: () => "",
      setThreadIdForWorkspace: () => {},
      clearThreadIdForWorkspace: () => {},
    },
    codex: {
      listThreads: async () => {
        listCalls += 1;
        return {
          result: {
            data: [
              {
                id: `thread-${listCalls}`,
                cwd: workspaceRoot,
                name: `Thread ${listCalls}`,
                updatedAt: 100 + listCalls,
              },
            ],
            nextCursor: "",
          },
        };
      },
    },
    setThreadBindingKey: () => {},
    setThreadWorkspaceRoot: () => {},
    rememberSelectedThreadForSync: () => {},
  };

  const first = await refreshWorkspaceThreads(runtime, bindingKey, workspaceRoot, normalized);
  const second = await refreshWorkspaceThreads(runtime, bindingKey, workspaceRoot, normalized, {
    forceRefresh: true,
  });

  assert.equal(listCalls, 2);
  assert.equal(first[0].id, "thread-1");
  assert.equal(second[0].id, "thread-2");
  assert.equal(runtime.workspaceThreadRefreshStateByKey.get(`${bindingKey}::${workspaceRoot}`).fromCache, false);
});

test("refreshWorkspaceThreads previewOnly uses a single Codex page and skips full cache persistence", async () => {
  const bindingKey = "binding-1";
  const workspaceRoot = "/repo";
  const normalized = {
    chatId: "chat-1",
    messageId: "msg-1",
    text: "继续聊天",
  };

  let listCalls = 0;
  const runtime = {
    workspaceThreadListCacheByKey: new Map(),
    workspaceThreadRefreshStateByKey: new Map(),
    codex: {
      listThreads: async () => {
        listCalls += 1;
        return {
          result: {
            data: [
              {
                id: "thread-1",
                cwd: workspaceRoot,
                name: "Thread 1",
                updatedAt: 100,
              },
            ],
            nextCursor: "next-page",
          },
        };
      },
    },
  };

  const threads = await refreshWorkspaceThreads(runtime, bindingKey, workspaceRoot, normalized, {
    previewOnly: true,
  });

  assert.equal(listCalls, 1);
  assert.equal(threads.length, 1);
  assert.equal(runtime.workspaceThreadListCacheByKey.has(`${bindingKey}::${workspaceRoot}`), false);
});

test("refreshWorkspaceThreads reuses a fresh shared cache across bindings for the same workspace", async () => {
  const workspaceRoot = "/repo";
  const normalized = {
    chatId: "chat-1",
    messageId: "msg-1",
    text: "继续聊天",
  };

  let listCalls = 0;
  const runtime = {
    workspaceThreadListCacheByKey: new Map(),
    workspaceThreadSharedCacheByKey: new Map(),
    workspaceThreadRefreshStateByKey: new Map(),
    workspaceThreadRefreshPromiseByKey: new Map(),
    sessionStore: {
      getThreadIdForWorkspace: () => "",
      setThreadIdForWorkspace: () => {},
      clearThreadIdForWorkspace: () => {},
    },
    codex: {
      listThreads: async () => {
        listCalls += 1;
        return {
          result: {
            data: [
              {
                id: "thread-1",
                cwd: workspaceRoot,
                name: "Thread 1",
                updatedAt: 100,
              },
            ],
            nextCursor: "",
          },
        };
      },
    },
    setThreadBindingKey: () => {},
    setThreadWorkspaceRoot: () => {},
    rememberSelectedThreadForSync: () => {},
  };

  const first = await refreshWorkspaceThreads(runtime, "binding-1", workspaceRoot, normalized);
  const second = await refreshWorkspaceThreads(runtime, "binding-2", workspaceRoot, normalized);

  assert.equal(listCalls, 1);
  assert.deepEqual(first, second);
  assert.equal(runtime.workspaceThreadRefreshStateByKey.get("binding-2::/repo").fromCache, true);
});

test("refreshWorkspaceThreads de-duplicates concurrent refreshes for the same workspace", async () => {
  const workspaceRoot = "/repo";
  const normalized = {
    chatId: "chat-1",
    messageId: "msg-1",
    text: "继续聊天",
  };

  let listCalls = 0;
  const runtime = {
    workspaceThreadListCacheByKey: new Map(),
    workspaceThreadSharedCacheByKey: new Map(),
    workspaceThreadRefreshStateByKey: new Map(),
    workspaceThreadRefreshPromiseByKey: new Map(),
    sessionStore: {
      getThreadIdForWorkspace: () => "",
      setThreadIdForWorkspace: () => {},
      clearThreadIdForWorkspace: () => {},
    },
    codex: {
      listThreads: async () => {
        listCalls += 1;
        await new Promise((resolve) => setTimeout(resolve, 10));
        return {
          result: {
            data: [
              {
                id: "thread-1",
                cwd: workspaceRoot,
                name: "Thread 1",
                updatedAt: 100,
              },
            ],
            nextCursor: "",
          },
        };
      },
    },
    setThreadBindingKey: () => {},
    setThreadWorkspaceRoot: () => {},
    rememberSelectedThreadForSync: () => {},
  };

  const [first, second] = await Promise.all([
    refreshWorkspaceThreads(runtime, "binding-1", workspaceRoot, normalized, {
      forceRefresh: true,
    }),
    refreshWorkspaceThreads(runtime, "binding-2", workspaceRoot, normalized, {
      forceRefresh: true,
    }),
  ]);

  assert.equal(listCalls, 1);
  assert.deepEqual(first, second);
});

test("createWorkspaceThread invalidates the cached thread list", async () => {
  const bindingKey = "binding-1";
  const workspaceRoot = "/repo";
  const normalized = {
    chatId: "chat-1",
    messageId: "msg-1",
    text: "继续聊天",
  };
  const cacheKey = `${bindingKey}::${workspaceRoot}`;
  let listCalls = 0;

  const runtime = {
    workspaceThreadListCacheByKey: new Map([
      [cacheKey, {
        threads: [{
          id: "thread-old",
          cwd: workspaceRoot,
          name: "Thread old",
          updatedAt: 1,
        }],
        updatedAt: new Date().toISOString(),
      }],
    ]),
    workspaceThreadSharedCacheByKey: new Map([
      ["codex::/repo::full", {
        threads: [{
          id: "thread-old",
          cwd: workspaceRoot,
          name: "Thread old",
          updatedAt: 1,
        }],
        updatedAt: new Date().toISOString(),
      }],
    ]),
    workspaceThreadRefreshStateByKey: new Map(),
    sessionStore: {
      getThreadIdForWorkspace: () => "",
      setThreadIdForWorkspace: () => {},
      clearThreadIdForWorkspace: () => {},
    },
    codex: {
      startThread: async ({ cwd }) => {
        assert.equal(cwd, workspaceRoot);
        return {
          result: {
            thread: {
              id: "thread-new",
            },
          },
        };
      },
      listThreads: async () => {
        listCalls += 1;
        return {
          result: {
            data: [
              {
                id: "thread-new",
                cwd: workspaceRoot,
                name: "Thread new",
                updatedAt: 2,
              },
            ],
            nextCursor: "",
          },
        };
      },
    },
    config: {
      defaultCodexAccessMode: "default",
    },
    resumedThreadIds: new Set(),
    setPendingThreadContext: () => {},
    setThreadBindingKey: () => {},
    setThreadWorkspaceRoot: () => {},
    rememberSelectedThreadForSync: () => {},
  };

  await createWorkspaceThread(runtime, { bindingKey, workspaceRoot, normalized });
  assert.equal(runtime.workspaceThreadListCacheByKey.has(cacheKey), false);
  assert.equal(runtime.workspaceThreadSharedCacheByKey.has("codex::/repo::full"), false);

  await refreshWorkspaceThreads(runtime, bindingKey, workspaceRoot, normalized);
  assert.equal(listCalls, 1);
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

test("ensureThreadAndSendMessage avoids switching to a desktop session claimed by another binding", async () => {
  const bindingKey = "binding-2";
  const workspaceRoot = "/repo";
  const normalized = {
    chatId: "chat-2",
    messageId: "msg-2",
    text: "继续聊天",
  };

  const threadAssignments = new Map([
    ["binding-1:/repo", "session-write"],
    ["binding-2:/repo", "session-read"],
  ]);
  const sentMessages = [];
  const warnings = [];
  const originalWarn = console.warn;

  const sessions = [
    {
      id: "session-read",
      writable: false,
      acpSessionId: "",
      acpxRecordId: "record-read",
      cwd: workspaceRoot,
      updatedAt: 200,
    },
    {
      id: "session-write",
      writable: true,
      acpSessionId: "session-write",
      acpxRecordId: "record-write",
      cwd: workspaceRoot,
      updatedAt: 100,
    },
  ];

  const runtime = {
    config: {
      defaultCodexAccessMode: "default",
      openclaw: {
        threadSource: "acpx",
      },
    },
    sessionStore: {
      getThreadIdForWorkspace: (currentBindingKey, currentWorkspaceRoot) => (
        threadAssignments.get(`${currentBindingKey}:${currentWorkspaceRoot}`) || ""
      ),
      setThreadIdForWorkspace: (currentBindingKey, currentWorkspaceRoot, threadId) => {
        threadAssignments.set(`${currentBindingKey}:${currentWorkspaceRoot}`, threadId);
      },
      clearThreadIdForWorkspace: () => {},
      listBindings: () => ([
        {
          bindingKey: "binding-1",
          binding: {
            threadIdByWorkspaceRoot: {
              [workspaceRoot]: threadAssignments.get("binding-1:/repo") || "",
            },
          },
        },
        {
          bindingKey: "binding-2",
          binding: {
            threadIdByWorkspaceRoot: {
              [workspaceRoot]: threadAssignments.get("binding-2:/repo") || "",
            },
          },
        },
      ]),
    },
    usesDesktopSessionSource: () => true,
    resolveThreadIdForBinding: (currentBindingKey, currentWorkspaceRoot) => (
      threadAssignments.get(`${currentBindingKey}:${currentWorkspaceRoot}`) || ""
    ),
    listDesktopSessionsForWorkspace: async () => sessions,
    resolveDesktopSessionById: (_currentWorkspaceRoot, sessionId) => (
      sessions.find((session) => (
        session.id === sessionId
        || session.acpSessionId === sessionId
        || session.acpxRecordId === sessionId
      )) || null
    ),
    hydrateDesktopSession: async (session) => session,
    codex: {
      startThread: async () => ({
        result: {
          thread: {
            id: "session-new",
          },
        },
      }),
      sendUserMessage: async ({ threadId, text }) => {
        sentMessages.push({ threadId, text });
      },
      resumeThread: async () => ({}),
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
    assert.equal(threadAssignments.get("binding-2:/repo"), "session-new");
    assert.equal(threadAssignments.get("binding-1:/repo"), "session-write");
    assert.deepEqual(sentMessages, [{ threadId: "session-new", text: "继续聊天" }]);
    assert.equal(warnings.some((entry) => /auto-switched to writable session session-write/.test(entry)), false);
    assert.equal(warnings.some((entry) => /created writable recovery session session-new/.test(entry)), true);
  } finally {
    console.warn = originalWarn;
  }
});

test("ensureThreadAndSendMessage reuses an existing recovery thread when it is still writable", async () => {
  const bindingKey = "binding-1";
  const workspaceRoot = "/repo";
  const normalized = {
    chatId: "chat-1",
    messageId: "msg-1",
    text: "继续聊天",
  };

  const threadAssignments = new Map([[workspaceRoot, "session-recovery"]]);
  const sentMessages = [];
  const resumedThreads = [];
  let startedThreads = 0;
  const syncSelections = [];

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
    listDesktopSessionsForWorkspace: async () => [],
    resolveDesktopSessionById: () => null,
    hydrateDesktopSession: async () => null,
    codex: {
      resumeThread: async ({ threadId }) => {
        resumedThreads.push(threadId);
        return {};
      },
      startThread: async () => {
        startedThreads += 1;
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
    rememberSelectedThreadForSync: (_binding, _root, threadId, options = {}) => {
      syncSelections.push({ threadId, options });
    },
    resumedThreadIds: new Set(),
  };

  const threadId = await ensureThreadAndSendMessage(runtime, {
    bindingKey,
    workspaceRoot,
    normalized,
    threadId: "session-recovery",
    forceRecoverThread: true,
  });

  assert.equal(threadId, "session-recovery");
  assert.equal(startedThreads, 0);
  assert.deepEqual(resumedThreads, ["session-recovery"]);
  assert.deepEqual(sentMessages, [{ threadId: "session-recovery", text: "继续聊天" }]);
  assert.equal(threadAssignments.get(workspaceRoot), "session-recovery");
  assert.deepEqual(syncSelections, [{
    threadId: "session-recovery",
    options: { desktopVisibleExpected: false },
  }]);
});

test("ensureThreadAndSendMessage creates a recovery session when no desktop session is visible", async () => {
  const bindingKey = "binding-1";
  const workspaceRoot = "/repo";
  const normalized = {
    chatId: "chat-1",
    messageId: "msg-1",
    text: "继续聊天",
  };

  const threadAssignments = new Map();
  const sentMessages = [];
  const warnings = [];
  const originalWarn = console.warn;

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
    listDesktopSessionsForWorkspace: async () => [],
    resolveDesktopSessionById: () => null,
    hydrateDesktopSession: async () => null,
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
      threadId: "",
      forceRecoverThread: true,
    });

    assert.equal(threadId, "session-new");
    assert.equal(threadAssignments.get(workspaceRoot), "session-new");
    assert.deepEqual(sentMessages, [{ threadId: "session-new", text: "继续聊天" }]);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /no desktop session visible; created writable recovery session session-new/);
  } finally {
    console.warn = originalWarn;
  }
});

test("handleNewCommand creates a new thread in desktop session mode", async () => {
  const infoMessages = [];
  const statusCalls = [];

  const runtime = {
    sessionStore: {
      buildBindingKey: () => "binding-1",
      setThreadIdForWorkspace: () => {},
    },
    resolveWorkspaceRootForBinding: () => "/repo",
    usesDesktopSessionSource: () => true,
    codex: {
      startThread: async ({ cwd }) => {
        assert.equal(cwd, "/repo");
        return {
          result: {
            thread: {
              id: "thread-new",
            },
          },
        };
      },
    },
    resumedThreadIds: new Set(),
    setPendingThreadContext: () => {},
    setThreadBindingKey: () => {},
    setThreadWorkspaceRoot: () => {},
    rememberSelectedThreadForSync: () => {},
    sendInfoCardMessage: async (message) => {
      infoMessages.push(message);
    },
    showStatusPanel: async (_normalized, options) => {
      statusCalls.push(options);
    },
  };

  await handleNewCommand(runtime, {
    chatId: "chat-1",
    messageId: "msg-1",
  });

  assert.equal(infoMessages.length, 1);
  assert.match(infoMessages[0].text, /已创建新线程并切换到它/);
  assert.match(infoMessages[0].text, /thread: thread-new/);
  assert.deepEqual(statusCalls, [{ replyToMessageId: "msg-1" }]);
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
