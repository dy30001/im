const assert = require("node:assert/strict");
const test = require("node:test");

const {
  deliverToProvider,
  handleCodexMessage,
  logProviderDeliveryFailureOnce,
} = require("../src/app/codex-event-service");

test("logProviderDeliveryFailureOnce de-duplicates repeated provider delivery failures", () => {
  const runtime = {};
  const outbound = {
    type: "im.agent_reply",
    payload: {
      threadId: "thread-1",
    },
  };
  const error = new Error("sendMessage errcode=-2: unknown error");
  const errors = [];
  const originalError = console.error;
  console.error = (...args) => {
    errors.push(args.join(" "));
  };

  try {
    assert.equal(logProviderDeliveryFailureOnce(runtime, outbound, error), true);
    assert.equal(logProviderDeliveryFailureOnce(runtime, outbound, error), false);
    assert.equal(logProviderDeliveryFailureOnce(runtime, outbound, error), false);
  } finally {
    console.error = originalError;
  }

  assert.equal(errors.length, 1);
  assert.match(errors[0], /failed to deliver provider message/);
});

test("deliverToProvider forwards OpenClaw streaming state even when streaming output is disabled", async () => {
  const calls = [];
  const runtime = {
    isStopping: false,
    supportsInteractiveCards() {
      return false;
    },
    config: {
      feishuStreamingOutput: false,
      openclawStreamingOutput: false,
    },
    upsertAssistantReplyCard: async (payload) => {
      calls.push({ ...payload });
    },
  };

  await deliverToProvider(runtime, {
    type: "im.run_state",
    payload: {
      threadId: "thread-1",
      turnId: "turn-1",
      chatId: "chat-1",
      state: "streaming",
    },
  });

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], {
    threadId: "thread-1",
    turnId: "turn-1",
    chatId: "chat-1",
    state: "streaming",
    deferFlush: true,
  });
});

test("handleCodexMessage drains the next queued message after a terminal turn", async () => {
  const seen = {
    delivered: [],
    drained: [],
    cleaned: [],
  };
  const runtime = {
    isStopping: false,
    config: {
      verboseCodexLogs: false,
    },
    activeTurnIdByThreadId: new Map([
      ["thread-1", "turn-1"],
    ]),
    pendingApprovalByThreadId: new Map(),
    currentRunKeyByThreadId: new Map(),
    bindingKeyByThreadId: new Map([
      ["thread-1", "binding-1"],
    ]),
    pendingChatContextByThreadId: new Map([
      ["thread-1", {
        chatId: "chat-1",
        threadKey: "thread-key-1",
      }],
    ]),
    pruneRuntimeMapSizes() {},
    async clearPendingReactionForThread() {},
    async deliverToProvider(event) {
      seen.delivered.push(event);
    },
    cleanupThreadRuntimeState(threadId) {
      seen.cleaned.push(threadId);
    },
    async drainQueuedMessagesForBinding(bindingKey) {
      seen.drained.push(bindingKey);
    },
  };

  handleCodexMessage(runtime, {
    method: "turn/completed",
    params: {
      threadId: "thread-1",
      turnId: "turn-1",
      turn: {
        id: "turn-1",
        status: "completed",
      },
    },
  });

  await delay(0);

  assert.equal(seen.delivered.length, 1);
  assert.equal(seen.cleaned.length, 1);
  assert.deepEqual(seen.cleaned, ["thread-1"]);
  assert.deepEqual(seen.drained, ["binding-1"]);
});

test("handleCodexMessage tracks turn activity timestamps for running turns", async () => {
  const runtime = {
    isStopping: false,
    config: {
      verboseCodexLogs: false,
    },
    activeTurnIdByThreadId: new Map(),
    activeTurnStartedAtByThreadId: new Map(),
    lastTurnActivityAtByThreadId: new Map(),
    pendingApprovalByThreadId: new Map(),
    currentRunKeyByThreadId: new Map(),
    pendingChatContextByThreadId: new Map(),
    pruneRuntimeMapSizes() {},
    async clearPendingReactionForThread() {},
    async deliverToProvider() {},
    cleanupThreadRuntimeState() {},
  };

  handleCodexMessage(runtime, {
    method: "turn/start",
    params: {
      threadId: "thread-1",
      turnId: "turn-1",
    },
  });

  await delay(0);

  assert.equal(runtime.activeTurnIdByThreadId.get("thread-1"), "turn-1");
  assert.equal(typeof runtime.activeTurnStartedAtByThreadId.get("thread-1"), "number");
  assert.equal(typeof runtime.lastTurnActivityAtByThreadId.get("thread-1"), "number");
  assert.ok(runtime.lastTurnActivityAtByThreadId.get("thread-1") >= runtime.activeTurnStartedAtByThreadId.get("thread-1"));
});

test("handleCodexMessage suppresses provider delivery for threads outside the active workspace", async () => {
  const seen = {
    delivered: [],
    cleaned: [],
    drained: [],
  };
  const runtime = {
    isStopping: false,
    config: {
      verboseCodexLogs: false,
    },
    activeTurnIdByThreadId: new Map([
      ["thread-1", "turn-1"],
    ]),
    pendingApprovalByThreadId: new Map(),
    currentRunKeyByThreadId: new Map(),
    bindingKeyByThreadId: new Map([
      ["thread-1", "binding-1"],
    ]),
    pendingChatContextByThreadId: new Map([
      ["thread-1", {
        chatId: "chat-1",
        threadKey: "thread-key-1",
      }],
    ]),
    pruneRuntimeMapSizes() {},
    shouldDeliverThreadEventForActiveWorkspace() {
      return false;
    },
    async clearPendingReactionForThread() {},
    async deliverToProvider(event) {
      seen.delivered.push(event);
    },
    cleanupThreadRuntimeState(threadId) {
      seen.cleaned.push(threadId);
    },
    async drainQueuedMessagesForBinding(bindingKey) {
      seen.drained.push(bindingKey);
    },
  };

  handleCodexMessage(runtime, {
    method: "turn/completed",
    params: {
      threadId: "thread-1",
      turnId: "turn-1",
      turn: {
        id: "turn-1",
        status: "completed",
      },
    },
  });

  await delay(0);

  assert.deepEqual(seen.delivered, []);
  assert.deepEqual(seen.cleaned, ["thread-1"]);
  assert.deepEqual(seen.drained, ["binding-1"]);
});

test("handleCodexMessage suppresses provider delivery for non-selected threads in the active workspace", async () => {
  const seen = {
    delivered: [],
    cleaned: [],
    drained: [],
  };
  const runtime = {
    isStopping: false,
    config: {
      verboseCodexLogs: false,
    },
    activeTurnIdByThreadId: new Map([
      ["thread-old", "turn-1"],
    ]),
    pendingApprovalByThreadId: new Map(),
    currentRunKeyByThreadId: new Map(),
    bindingKeyByThreadId: new Map([
      ["thread-old", "binding-1"],
    ]),
    pendingChatContextByThreadId: new Map([
      ["thread-old", {
        chatId: "chat-1",
        threadKey: "thread-key-1",
      }],
    ]),
    pruneRuntimeMapSizes() {},
    shouldDeliverThreadEventForActiveWorkspace() {
      return false;
    },
    async clearPendingReactionForThread() {},
    async deliverToProvider(event) {
      seen.delivered.push(event);
    },
    cleanupThreadRuntimeState(threadId) {
      seen.cleaned.push(threadId);
    },
    async drainQueuedMessagesForBinding(bindingKey) {
      seen.drained.push(bindingKey);
    },
  };

  handleCodexMessage(runtime, {
    method: "turn/completed",
    params: {
      threadId: "thread-old",
      turnId: "turn-1",
      turn: {
        id: "turn-1",
        status: "completed",
      },
    },
  });

  await delay(0);

  assert.deepEqual(seen.delivered, []);
  assert.deepEqual(seen.cleaned, ["thread-old"]);
  assert.deepEqual(seen.drained, ["binding-1"]);
});

test("handleCodexMessage restores the selected thread when the active workspace binding is empty", async () => {
  const delivered = [];
  const setCalls = [];
  const runtime = {
    isStopping: false,
    config: {
      verboseCodexLogs: false,
    },
    activeTurnIdByThreadId: new Map(),
    activeTurnStartedAtByThreadId: new Map(),
    lastTurnActivityAtByThreadId: new Map(),
    pendingApprovalByThreadId: new Map(),
    currentRunKeyByThreadId: new Map(),
    bindingKeyByThreadId: new Map([
      ["thread-1", "binding-1"],
    ]),
    workspaceRootByThreadId: new Map([
      ["thread-1", "/Users/dy3000/code/读书"],
    ]),
    pendingChatContextByThreadId: new Map([
      ["thread-1", {
        provider: "openclaw",
        workspaceId: "default",
        chatId: "chat-1",
        threadKey: "",
        senderId: "sender-1",
      }],
    ]),
    sessionStore: {
      getActiveWorkspaceRoot(bindingKey) {
        return bindingKey === "binding-1" ? "/Users/dy3000/code/读书" : "";
      },
      getThreadIdForWorkspace() {
        return "";
      },
      setThreadIdForWorkspace(bindingKey, workspaceRoot, threadId, extra) {
        setCalls.push({ bindingKey, workspaceRoot, threadId, extra });
      },
      buildBindingKey(context) {
        return `${context.workspaceId}:${context.chatId}:sender:${context.senderId}`;
      },
    },
    resolveWorkspaceRootForThread(threadId) {
      return this.workspaceRootByThreadId.get(threadId) || "";
    },
    pruneRuntimeMapSizes() {},
    async clearPendingReactionForThread() {},
    async deliverToProvider(event) {
      delivered.push(event);
    },
    cleanupThreadRuntimeState() {},
  };

  handleCodexMessage(runtime, {
    method: "turn/start",
    params: {
      threadId: "thread-1",
      turnId: "turn-1",
    },
  });

  await delay(0);

  assert.equal(delivered.length, 1);
  assert.deepEqual(setCalls, [{
    bindingKey: "binding-1",
    workspaceRoot: "/Users/dy3000/code/读书",
    threadId: "thread-1",
    extra: {
      provider: "openclaw",
      workspaceId: "default",
      chatId: "chat-1",
      threadKey: "",
      senderId: "sender-1",
    },
  }]);
});

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
