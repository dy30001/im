const assert = require("node:assert/strict");
const test = require("node:test");

const { dispatchCardAction, handleThreadCardAction } = require("../src/app/command-dispatcher");

function createRuntime() {
  const feedbacks = [];
  const calls = [];
  let pendingTask = null;

  return {
    feedbacks,
    calls,
    handleThreadCardAction(action, normalized) {
      return handleThreadCardAction(this, action, normalized);
    },
    getCurrentThreadContext: () => ({ threadId: "thread-current" }),
    showThreadPicker: async (normalized, options) => {
      calls.push({ type: "showThreadPicker", normalized, options });
    },
    switchThreadById: async (normalized, threadId, options) => {
      calls.push({ type: "switchThreadById", normalized, threadId, options });
    },
    queueCardActionWithFeedback: (_normalized, feedback, task) => {
      feedbacks.push({ type: "progress", text: feedback });
      pendingTask = Promise.resolve(task()).finally(() => {
        pendingTask = null;
      });
      return { ok: true };
    },
    runCardActionTask: (taskPromise) => {
      pendingTask = Promise.resolve(taskPromise).finally(() => {
        pendingTask = null;
      });
    },
    sendCardActionFeedbackByContext: async (_normalized, text, kind) => {
      feedbacks.push({ type: "feedback", text, kind });
    },
    buildCardToast: (text) => ({
      toast: {
        type: "info",
        content: text,
      },
    }),
    buildCardResponse: () => ({ ok: true }),
    flushPendingTask: async () => {
      if (pendingTask) {
        await pendingTask;
      }
    },
  };
}

test("dispatchCardAction forwards thread refresh pagination state", async () => {
  const runtime = createRuntime();
  const normalized = {
    chatId: "chat-1",
    messageId: "msg-1",
  };

  const response = dispatchCardAction(runtime, {
    kind: "thread",
    action: "refresh",
    threadId: "",
    page: 3,
  }, normalized);
  await runtime.flushPendingTask();

  assert.deepEqual(response, { ok: true });
  assert.deepEqual(runtime.calls, [
    {
      type: "showThreadPicker",
      normalized,
      options: {
        replyToMessageId: "msg-1",
        page: 3,
      },
    },
  ]);
});

test("dispatchCardAction rejects switch without threadId", async () => {
  const runtime = createRuntime();
  const normalized = {
    chatId: "chat-1",
    messageId: "msg-1",
  };

  const response = dispatchCardAction(runtime, {
    kind: "thread",
    action: "switch",
    threadId: "",
    page: 0,
  }, normalized);
  await runtime.flushPendingTask();

  assert.deepEqual(response, {
    toast: {
      type: "info",
      content: "未读取到线程 ID，请刷新后重试。",
    },
  });
  assert.deepEqual(runtime.calls, []);
  assert.deepEqual(runtime.feedbacks, [
    {
      type: "feedback",
      text: "未读取到线程 ID，请刷新后重试。",
      kind: "error",
    },
  ]);
});
