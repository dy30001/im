const assert = require("node:assert/strict");
const test = require("node:test");

const { buildThreadPickerCard, buildThreadPickerText } = require("../src/presentation/card/builders");
const { normalizeFeishuTextEvent, extractCardAction } = require("../src/presentation/message/normalizers");
const { showThreadPicker } = require("../src/domain/workspace/workspace-service");

test("normalizeFeishuTextEvent recognizes /codex threads", () => {
  const normalized = normalizeFeishuTextEvent({
    message: {
      message_type: "text",
      content: JSON.stringify({ text: "/codex threads" }),
      chat_id: "chat-1",
      message_id: "msg-1",
      root_id: "",
    },
    sender: {
      sender_id: {
        open_id: "user-1",
      },
    },
  }, {
    defaultWorkspaceId: "default",
  });

  assert.equal(normalized.command, "threads");
});

test("extractCardAction keeps thread pagination state", () => {
  const action = extractCardAction({
    action: {
      value: {
        kind: "thread",
        action: "next_page",
        threadId: "",
        page: 2,
      },
    },
  });

  assert.deepEqual(action, {
    kind: "thread",
    action: "next_page",
    threadId: "",
    page: 2,
  });
});

test("extractCardAction normalizes invalid thread pagination state to page 0", () => {
  const action = extractCardAction({
    action: {
      value: {
        kind: "thread",
        action: "refresh",
        page: "oops",
      },
    },
  });

  assert.deepEqual(action, {
    kind: "thread",
    action: "refresh",
    threadId: "",
    page: 0,
  });
});

test("buildThreadPickerCard shows total count and pagination controls", () => {
  const threads = Array.from({ length: 10 }, (_, index) => ({
    id: `thread-${index + 1}`,
    title: `Thread ${index + 1}`,
    updatedAt: Math.floor(Date.now() / 1000) - index * 60,
  }));

  const card = buildThreadPickerCard({
    workspaceRoot: "/repo",
    threads,
    currentThreadId: "thread-1",
    page: 1,
    pageSize: 4,
  });

  const cardJson = JSON.stringify(card);
  assert.match(cardJson, /共 10 条，第 2\/3 页/);
  assert.match(cardJson, /prev_page/);
  assert.match(cardJson, /next_page/);
  assert.match(cardJson, /"action":"refresh","page":"1"/);
  assert.match(cardJson, /thread-5/);
  assert.match(cardJson, /thread-8/);
  assert.doesNotMatch(cardJson, /thread-1/);
  assert.doesNotMatch(cardJson, /"threadId":""/);
});

test("buildThreadPickerCard shows stale refresh notice when rendering cached threads", () => {
  const card = buildThreadPickerCard({
    workspaceRoot: "/repo",
    threads: [{ id: "thread-1", title: "Thread 1", updatedAt: 1 }],
    currentThreadId: "thread-1",
    page: 0,
    noticeText: "线程列表刷新失败，当前展示最近一次成功结果。",
  });

  const cardJson = JSON.stringify(card);
  assert.match(cardJson, /最近一次成功结果/);
});

test("showThreadPicker distinguishes refresh failure from empty history", async () => {
  const infoMessages = [];
  const runtime = {
    resolveReplyToMessageId: (_normalized, replyToMessageId = "") => replyToMessageId || "reply-1",
    getBindingContext: () => ({ bindingKey: "binding-1", workspaceRoot: "/repo" }),
    refreshWorkspaceThreads: async () => [],
    getWorkspaceThreadRefreshState: () => ({ ok: false, fromCache: false, error: "network error" }),
    resolveThreadIdForBinding: () => "",
    buildThreadPickerCard,
    sendInteractiveCard: async () => {},
    sendInfoCardMessage: async (payload) => {
      infoMessages.push(payload);
    },
  };
  const normalized = {
    chatId: "chat-1",
    messageId: "msg-1",
  };

  await showThreadPicker(runtime, normalized, { replyToMessageId: "reply-1", page: 0 });

  assert.equal(infoMessages.length, 1);
  assert.match(infoMessages[0].text, /线程列表刷新失败/);
  assert.doesNotMatch(infoMessages[0].text, /还没有可切换的历史线程/);
});

test("showThreadPicker renders cached threads when refresh falls back", async () => {
  const cards = [];
  const runtime = {
    resolveReplyToMessageId: (_normalized, replyToMessageId = "") => replyToMessageId || "reply-1",
    getBindingContext: () => ({ bindingKey: "binding-1", workspaceRoot: "/repo" }),
    refreshWorkspaceThreads: async () => [
      { id: "thread-1", title: "Thread 1", updatedAt: 1, cwd: "/repo" },
    ],
    getWorkspaceThreadRefreshState: () => ({ ok: false, fromCache: true, error: "network error" }),
    resolveThreadIdForBinding: () => "thread-1",
    buildThreadPickerCard,
    sendInteractiveCard: async (payload) => {
      cards.push(payload);
    },
    sendInfoCardMessage: async () => {},
  };
  const normalized = {
    chatId: "chat-1",
    messageId: "msg-1",
  };

  await showThreadPicker(runtime, normalized, { replyToMessageId: "reply-1", page: 0 });

  assert.equal(cards.length, 1);
  assert.match(JSON.stringify(cards[0].card), /最近一次成功结果/);
});

test("showThreadPicker uses a text summary for providers without interactive cards", async () => {
  const infoMessages = [];
  const runtime = {
    resolveReplyToMessageId: (_normalized, replyToMessageId = "") => replyToMessageId || "reply-1",
    getBindingContext: () => ({ bindingKey: "binding-1", workspaceRoot: "/repo" }),
    refreshWorkspaceThreads: async () => [
      { id: "thread-1", title: "Desktop Thread", updatedAt: 1, cwd: "/repo" },
    ],
    getWorkspaceThreadRefreshState: () => ({ ok: true, fromCache: false, error: "" }),
    resolveThreadIdForBinding: () => "thread-1",
    buildThreadPickerCard,
    buildThreadPickerText,
    supportsInteractiveCards: () => false,
    sendInteractiveCard: async () => {
      throw new Error("should not render interactive cards");
    },
    sendInfoCardMessage: async (payload) => {
      infoMessages.push(payload);
    },
  };
  const normalized = {
    chatId: "chat-1",
    messageId: "msg-1",
  };

  await showThreadPicker(runtime, normalized, { replyToMessageId: "reply-1", page: 0 });

  assert.equal(infoMessages.length, 1);
  assert.match(infoMessages[0].text, /thread-1/);
  assert.match(infoMessages[0].text, /\/codex switch <threadId>/);
});
