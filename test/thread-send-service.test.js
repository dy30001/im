const assert = require("node:assert/strict");
const test = require("node:test");

const {
  createWorkspaceThread,
  ensureCodexThreadAndSendMessage,
  ensureThreadResumed,
} = require("../src/domain/thread/thread-send-service");

test("createWorkspaceThread forwards the caller visibility flag to thread sync state", async () => {
  const rememberedSelections = [];
  const storedThreads = [];
  const runtime = {
    workspaceThreadListCacheByKey: new Map(),
    workspaceThreadSharedCacheByKey: new Map(),
    sessionStore: {
      setThreadIdForWorkspace: (_bindingKey, _workspaceRoot, threadId) => {
        storedThreads.push(threadId);
      },
    },
    codex: {
      startThread: async () => ({
        result: {
          thread: {
            id: "thread-new",
          },
        },
      }),
    },
    resumedThreadIds: new Set(),
    setPendingThreadContext: () => {},
    setThreadBindingKey: () => {},
    setThreadWorkspaceRoot: () => {},
    rememberSelectedThreadForSync: (_bindingKey, _workspaceRoot, threadId, options = {}) => {
      rememberedSelections.push({ threadId, options });
    },
  };

  const threadId = await createWorkspaceThread(runtime, {
    bindingKey: "binding-1",
    workspaceRoot: "/repo",
    normalized: {
      chatId: "chat-1",
      messageId: "msg-1",
      text: "继续聊天",
    },
    desktopVisibleExpected: false,
  });

  assert.equal(threadId, "thread-new");
  assert.deepEqual(storedThreads, ["thread-new"]);
  assert.deepEqual(rememberedSelections, [{
    threadId: "thread-new",
    options: { desktopVisibleExpected: false },
  }]);
});

test("ensureThreadResumed skips already resumed threads", async () => {
  let resumeCalls = 0;
  const runtime = {
    pendingChatContextByThreadId: new Map(),
    resumedThreadIds: new Set(["thread-1"]),
    codex: {
      resumeThread: async () => {
        resumeCalls += 1;
        return {};
      },
    },
  };

  const result = await ensureThreadResumed(runtime, "thread-1");

  assert.equal(result, null);
  assert.equal(resumeCalls, 0);
});

test("ensureCodexThreadAndSendMessage recreates stale codex threads", async () => {
  const clearedThreads = [];
  const sentThreadIds = [];
  const storedThreadIds = [];
  const runtime = {
    config: {
      defaultCodexAccessMode: "default",
    },
    getCodexParamsForWorkspace: () => ({
      model: "gpt-5.3-codex",
      effort: "medium",
    }),
    workspaceThreadListCacheByKey: new Map(),
    workspaceThreadSharedCacheByKey: new Map(),
    pendingChatContextByThreadId: new Map(),
    resumedThreadIds: new Set(),
    sessionStore: {
      setThreadIdForWorkspace: (_bindingKey, _workspaceRoot, threadId) => {
        storedThreadIds.push(threadId);
      },
      clearThreadIdForWorkspace: (bindingKey, workspaceRoot) => {
        clearedThreads.push([bindingKey, workspaceRoot]);
      },
    },
    codex: {
      resumeThread: async () => ({}),
      startThread: async () => ({
        result: {
          thread: {
            id: "thread-new",
          },
        },
      }),
      sendUserMessage: async ({ threadId }) => {
        sentThreadIds.push(threadId);
        if (threadId === "thread-stale") {
          throw new Error("thread not found");
        }
        return {};
      },
    },
    setPendingThreadContext: () => {},
    setThreadBindingKey: () => {},
    setThreadWorkspaceRoot: () => {},
    rememberSelectedThreadForSync: () => {},
  };

  const threadId = await ensureCodexThreadAndSendMessage(runtime, {
    bindingKey: "binding-1",
    workspaceRoot: "/repo",
    normalized: {
      chatId: "chat-1",
      messageId: "msg-1",
      text: "继续聊天",
    },
    threadId: "thread-stale",
  });

  assert.equal(threadId, "thread-new");
  assert.deepEqual(clearedThreads, [["binding-1", "/repo"]]);
  assert.deepEqual(sentThreadIds, ["thread-stale", "thread-new"]);
  assert.deepEqual(storedThreadIds, ["thread-new"]);
});
