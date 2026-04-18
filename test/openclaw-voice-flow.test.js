const assert = require("node:assert/strict");
const test = require("node:test");

const appDispatcher = require("../src/app/dispatcher");
const { normalizeOpenClawTextEvent } = require("../src/presentation/message/normalizers");

test("normalizeOpenClawTextEvent uses voice_item.text as plain text", () => {
  const normalized = normalizeOpenClawTextEvent(
    {
      from_user_id: "wx-user-1",
      message_id: 6,
      message_type: 3,
      item_list: [
        {
          type: 4,
          voice_item: {
            text: "当前在哪个项目",
          },
        },
      ],
    },
    { defaultWorkspaceId: "default" }
  );

  assert.equal(normalized?.inputKind, "text");
  assert.equal(normalized?.text, "当前在哪个项目");
  assert.equal(normalized?.command, "where");
});

test("normalizeOpenClawTextEvent prefers explicit text over voice text", () => {
  const normalized = normalizeOpenClawTextEvent(
    {
      from_user_id: "wx-user-1",
      message_id: 10,
      message_type: 1,
      item_list: [
        {
          type: 1,
          text_item: {
            text: "/codex where",
          },
        },
        {
          type: 4,
          voice_item: {
            text: "当前在哪个项目",
          },
        },
      ],
    },
    { defaultWorkspaceId: "default" }
  );

  assert.equal(normalized?.inputKind, "text");
  assert.equal(normalized?.text, "/codex where");
  assert.equal(normalized?.command, "where");
});

test("onOpenClawTextEvent routes voice_item.text into the normal text chain", async () => {
  const seen = {
    remembered: 0,
    command: "",
    text: "",
  };
  const runtime = {
    isStopping: false,
    config: {
      defaultWorkspaceId: "default",
      verboseCodexLogs: false,
    },
    rememberInboundContext() {
      seen.remembered += 1;
    },
    async dispatchTextCommand(normalized) {
      seen.command = normalized?.command || "";
      seen.text = normalized?.text || "";
      return true;
    },
  };

  await appDispatcher.onOpenClawTextEvent(runtime, {
    from_user_id: "wx-user-1",
    message_id: 11,
    message_type: 3,
    item_list: [
      {
        type: 4,
        voice_item: {
          text: "当前在哪个项目",
        },
      },
    ],
  });

  assert.equal(seen.remembered, 1);
  assert.equal(seen.command, "where");
  assert.equal(seen.text, "当前在哪个项目");
});

test("onOpenClawTextEvent sends an immediate receipt ack for inbound file attachments", async () => {
  const seen = {
    ackCalls: [],
    prepared: null,
    threadStateRequest: null,
  };
  const runtime = {
    isStopping: false,
    config: {
      defaultWorkspaceId: "default",
      verboseCodexLogs: false,
    },
    supportsInteractiveCards() {
      return false;
    },
    rememberInboundContext() {},
    async dispatchTextCommand() {
      return false;
    },
    sessionStore: {
      buildBindingKey() {
        return "binding-1";
      },
    },
    async resolveWorkspaceContext() {
      return {
        bindingKey: "binding-1",
        workspaceRoot: "/repo",
        replyTarget: "201",
      };
    },
    async sendInfoCardMessage(payload) {
      seen.ackCalls.push(payload);
    },
    async prepareInboundMessage(normalized) {
      seen.prepared = normalized;
      return {
        ...normalized,
        text: "用户发送了以下附件，请先查看这些本地文件再继续处理：\n\n[文件 1] /repo/.codex-im/inbound/msg-201-1-report.pdf",
      };
    },
    async resolveWorkspaceThreadState() {
      seen.threadStateRequest = arguments[0];
      return {
        threadId: "thread-1",
      };
    },
    setPendingBindingContext() {},
    setPendingThreadContext() {},
    async addPendingReaction() {},
    async ensureThreadAndSendMessage() {
      return "thread-1";
    },
    movePendingReactionToThread() {},
    async clearPendingReactionForBinding() {},
  };

  await appDispatcher.onOpenClawTextEvent(runtime, {
    from_user_id: "wx-user-1",
    message_id: 201,
    message_type: 1,
    item_list: [
      {
        type: 4,
        file_item: {
          file_name: "report.pdf",
          media: {
            full_url: "https://cdn.example.com/path/report",
          },
        },
      },
    ],
  });

  assert.equal(seen.ackCalls.length, 1);
  assert.equal(seen.ackCalls[0].chatId, "wx-user-1");
  assert.equal(seen.ackCalls[0].replyToMessageId, "201");
  assert.equal(seen.ackCalls[0].kind, "progress");
  assert.match(seen.ackCalls[0].text, /已收到文件/);
  assert.equal(seen.threadStateRequest?.allowClaimedThreadReuse, false);
  assert.equal(seen.prepared?.openclawReceiptAcked, true);
});

test("onOpenClawTextEvent queues a new inbound file while the selected thread is already running", async () => {
  const seen = {
    notices: [],
    prepared: 0,
    ensured: 0,
    pendingReactions: 0,
  };
  const runtime = {
    isStopping: false,
    config: {
      defaultWorkspaceId: "default",
      verboseCodexLogs: false,
    },
    activeTurnIdByThreadId: new Map([
      ["thread-1", "turn-1"],
    ]),
    pendingApprovalByThreadId: new Map(),
    pendingMessageQueueByBindingKey: new Map(),
    inFlightBindingDispatchKeys: new Set(),
    supportsInteractiveCards() {
      return false;
    },
    rememberInboundContext() {},
    async dispatchTextCommand() {
      return false;
    },
    sessionStore: {
      buildBindingKey() {
        return "binding-1";
      },
    },
    async resolveWorkspaceContext() {
      return {
        bindingKey: "binding-1",
        workspaceRoot: "/repo",
        replyTarget: "301",
      };
    },
    async resolveWorkspaceThreadState() {
      return {
        threadId: "thread-1",
      };
    },
    async sendInfoCardMessage(payload) {
      seen.notices.push(payload);
    },
    async prepareInboundMessage() {
      seen.prepared += 1;
      return null;
    },
    setPendingBindingContext() {},
    setPendingThreadContext() {},
    async addPendingReaction() {
      seen.pendingReactions += 1;
    },
    async ensureThreadAndSendMessage() {
      seen.ensured += 1;
      return "thread-1";
    },
    movePendingReactionToThread() {},
    async clearPendingReactionForBinding() {},
  };

  await appDispatcher.onOpenClawTextEvent(runtime, {
    from_user_id: "wx-user-1",
    message_id: 301,
    message_type: 1,
    item_list: [
      {
        type: 4,
        file_item: {
          file_name: "report.pdf",
          media: {
            full_url: "https://cdn.example.com/path/report",
          },
        },
      },
    ],
  });

  assert.equal(seen.notices.length, 1);
  assert.equal(seen.notices[0].replyToMessageId, "301");
  assert.match(seen.notices[0].text, /已加入队列/);
  assert.match(seen.notices[0].text, /上一条消息还在处理中/);
  assert.match(seen.notices[0].text, /前面还有 1 条消息/);
  assert.equal(runtime.pendingMessageQueueByBindingKey.get("binding-1")?.length, 1);
  assert.equal(runtime.pendingMessageQueueByBindingKey.get("binding-1")?.[0]?.workspaceRoot, "/repo");
  assert.equal(runtime.pendingMessageQueueByBindingKey.get("binding-1")?.[0]?.normalized?.messageId, "301");
  assert.equal(runtime.inFlightBindingDispatchKeys.has("binding-1"), true);
  assert.equal(seen.prepared, 0);
  assert.equal(seen.pendingReactions, 0);
  assert.equal(seen.ensured, 0);
});

test("onOpenClawTextEvent queues a duplicate message while the binding dispatch lock is still held", async () => {
  const seen = {
    notices: [],
    resolvedThreads: 0,
  };
  const runtime = {
    isStopping: false,
    config: {
      defaultWorkspaceId: "default",
      verboseCodexLogs: false,
    },
    inFlightBindingDispatchKeys: new Set(["binding-1"]),
    activeTurnIdByThreadId: new Map(),
    pendingApprovalByThreadId: new Map(),
    pendingMessageQueueByBindingKey: new Map(),
    supportsInteractiveCards() {
      return false;
    },
    rememberInboundContext() {},
    async dispatchTextCommand() {
      return false;
    },
    sessionStore: {
      buildBindingKey() {
        return "binding-1";
      },
    },
    async resolveWorkspaceContext() {
      return {
        bindingKey: "binding-1",
        workspaceRoot: "/repo",
        replyTarget: "401",
      };
    },
    async resolveWorkspaceThreadState() {
      seen.resolvedThreads += 1;
      return {
        threadId: "thread-1",
      };
    },
    async sendInfoCardMessage(payload) {
      seen.notices.push(payload);
    },
  };

  await appDispatcher.onOpenClawTextEvent(runtime, {
    from_user_id: "wx-user-1",
    message_id: 401,
    message_type: 1,
    item_list: [
      {
        type: 1,
        text_item: {
          text: "继续处理",
        },
      },
    ],
  });

  assert.equal(seen.notices.length, 1);
  assert.match(seen.notices[0].text, /已加入队列/);
  assert.match(seen.notices[0].text, /上一条消息刚开始处理/);
  assert.match(seen.notices[0].text, /前面还有 1 条消息/);
  assert.equal(runtime.pendingMessageQueueByBindingKey.get("binding-1")?.length, 1);
  assert.equal(runtime.pendingMessageQueueByBindingKey.get("binding-1")?.[0]?.workspaceRoot, "/repo");
  assert.equal(runtime.pendingMessageQueueByBindingKey.get("binding-1")?.[0]?.normalized?.messageId, "401");
  assert.equal(seen.resolvedThreads, 0);
});

test("onOpenClawTextEvent creates a fresh thread when the auto-selected thread is locally claimed by another binding", async () => {
  const seen = {
    ensured: [],
    notices: [],
    resolvedThreads: 0,
  };
  const existingClaim = {
    bindingKey: "binding-2",
    workspaceRoot: "/repo",
    claimedAt: Date.now(),
    keys: ["thread-1"],
  };
  const runtime = {
    isStopping: false,
    config: {
      defaultWorkspaceId: "default",
      verboseCodexLogs: false,
    },
    inFlightBindingDispatchKeys: new Set(),
    inFlightThreadDispatchClaimsById: new Map([
      ["thread-1", existingClaim],
    ]),
    activeTurnIdByThreadId: new Map(),
    pendingApprovalByThreadId: new Map(),
    pendingMessageQueueByBindingKey: new Map(),
    supportsInteractiveCards() {
      return false;
    },
    rememberInboundContext() {},
    async dispatchTextCommand() {
      return false;
    },
    sessionStore: {
      buildBindingKey() {
        return "binding-1";
      },
    },
    async resolveWorkspaceContext() {
      return {
        bindingKey: "binding-1",
        workspaceRoot: "/repo",
        replyTarget: "451",
      };
    },
    async resolveWorkspaceThreadState() {
      seen.resolvedThreads += 1;
      return {
        threadId: "thread-1",
      };
    },
    async sendInfoCardMessage(payload) {
      seen.notices.push(payload);
    },
    async prepareInboundMessage() {
      return null;
    },
    setPendingBindingContext() {},
    setPendingThreadContext() {
      throw new Error("should not bind the conflicting thread before recovery");
    },
    async addPendingReaction() {},
    async ensureThreadAndSendMessage(payload) {
      seen.ensured.push(payload);
      return "thread-new";
    },
    movePendingReactionToThread() {},
    async clearPendingReactionForBinding() {},
  };

  await appDispatcher.onOpenClawTextEvent(runtime, {
    from_user_id: "wx-user-1",
    message_id: 451,
    message_type: 1,
    item_list: [
      {
        type: 1,
        text_item: {
          text: "继续处理",
        },
      },
    ],
  });

  assert.equal(seen.resolvedThreads, 2);
  assert.equal(seen.notices.length, 0);
  assert.equal(seen.ensured.length, 1);
  assert.equal(seen.ensured[0].threadId, "");
  assert.equal(runtime.pendingMessageQueueByBindingKey.size, 0);
  assert.equal(runtime.inFlightBindingDispatchKeys.has("binding-1"), true);
});

test("onOpenClawTextEvent releases the local thread dispatch claim when message send fails", async () => {
  const failures = [];
  const runtime = {
    isStopping: false,
    config: {
      defaultWorkspaceId: "default",
      verboseCodexLogs: false,
    },
    inFlightBindingDispatchKeys: new Set(),
    inFlightThreadDispatchClaimsById: new Map(),
    activeTurnIdByThreadId: new Map(),
    pendingApprovalByThreadId: new Map(),
    pendingMessageQueueByBindingKey: new Map(),
    supportsInteractiveCards() {
      return false;
    },
    rememberInboundContext() {},
    async dispatchTextCommand() {
      return false;
    },
    sessionStore: {
      buildBindingKey() {
        return "binding-1";
      },
    },
    async resolveWorkspaceContext() {
      return {
        bindingKey: "binding-1",
        workspaceRoot: "/repo",
        replyTarget: "461",
      };
    },
    async resolveWorkspaceThreadState() {
      return {
        threadId: "thread-1",
      };
    },
    async sendInfoCardMessage(payload) {
      failures.push(payload);
    },
    async prepareInboundMessage() {
      return null;
    },
    setPendingBindingContext() {},
    setPendingThreadContext() {},
    async addPendingReaction() {},
    async ensureThreadAndSendMessage() {
      throw new Error("send failed");
    },
    movePendingReactionToThread() {},
    async clearPendingReactionForBinding() {},
  };

  await assert.rejects(() => appDispatcher.onOpenClawTextEvent(runtime, {
    from_user_id: "wx-user-1",
    message_id: 461,
    message_type: 1,
    item_list: [
      {
        type: 1,
        text_item: {
          text: "继续处理",
        },
      },
    ],
  }), /send failed/);

  assert.equal(runtime.inFlightThreadDispatchClaimsById.size, 0);
  assert.equal(failures.length, 1);
  assert.match(failures[0].text, /处理失败/);
});

test("drainQueuedMessagesForBinding starts the next queued message in order", async () => {
  const seen = {
    ackCalls: [],
    ensured: [],
  };
  const runtime = {
    isStopping: false,
    config: {
      defaultWorkspaceId: "default",
      verboseCodexLogs: false,
    },
    pendingMessageQueueByBindingKey: new Map([
      ["binding-1", [{
        bindingKey: "binding-1",
        workspaceRoot: "/repo",
        normalized: {
          provider: "openclaw",
          chatId: "wx-user-1",
          messageId: "501",
          contextToken: "ctx-501",
          command: "message",
          text: "请继续处理这个文件",
          attachments: [
            {
              kind: "file",
              name: "report.pdf",
              url: "https://cdn.example.com/path/report",
            },
          ],
        },
      }]],
    ]),
    inFlightBindingDispatchKeys: new Set(["binding-1"]),
    activeTurnIdByThreadId: new Map(),
    pendingApprovalByThreadId: new Map(),
    supportsInteractiveCards() {
      return false;
    },
    async dispatchTextCommand() {
      return false;
    },
    sessionStore: {
      buildBindingKey() {
        return "binding-1";
      },
    },
    resolveWorkspaceRootForBinding() {
      return "/repo";
    },
    async resolveWorkspaceContext() {
      return {
        bindingKey: "binding-1",
        workspaceRoot: "/repo",
      };
    },
    async resolveWorkspaceThreadState() {
      return {
        threadId: "thread-1",
      };
    },
    async sendInfoCardMessage(payload) {
      seen.ackCalls.push(payload);
    },
    async prepareInboundMessage(normalized) {
      return {
        ...normalized,
        text: "用户发送了以下附件，请先查看这些本地文件再继续处理：\n\n[文件 1] /repo/.codex-im/inbound/msg-501-1-report.pdf",
      };
    },
    setPendingBindingContext() {},
    setPendingThreadContext() {},
    async addPendingReaction() {},
    async ensureThreadAndSendMessage(payload) {
      seen.ensured.push(payload);
      return "thread-1";
    },
    movePendingReactionToThread() {},
    async clearPendingReactionForBinding() {},
  };

  const drained = await appDispatcher.drainQueuedMessagesForBinding(runtime, "binding-1");

  assert.equal(drained, true);
  assert.equal(seen.ackCalls.length, 1);
  assert.match(seen.ackCalls[0].text, /已收到文件/);
  assert.equal(seen.ensured.length, 1);
  assert.equal(runtime.pendingMessageQueueByBindingKey.has("binding-1"), false);
  assert.equal(runtime.inFlightBindingDispatchKeys.has("binding-1"), true);
});

test("drainQueuedMessagesForBinding drops stale queued messages after the active workspace changes", async () => {
  const seen = {
    ensured: 0,
  };
  const runtime = {
    isStopping: false,
    config: {
      defaultWorkspaceId: "default",
      verboseCodexLogs: false,
    },
    pendingMessageQueueByBindingKey: new Map([
      ["binding-1", [{
        bindingKey: "binding-1",
        workspaceRoot: "/repo/alpha",
        normalized: {
          provider: "openclaw",
          chatId: "wx-user-1",
          messageId: "601",
          command: "message",
          text: "继续处理 alpha",
        },
      }]],
    ]),
    inFlightBindingDispatchKeys: new Set(["binding-1"]),
    activeTurnIdByThreadId: new Map(),
    pendingApprovalByThreadId: new Map(),
    supportsInteractiveCards() {
      return false;
    },
    async dispatchTextCommand() {
      return false;
    },
    resolveWorkspaceRootForBinding() {
      return "/repo/beta";
    },
    sessionStore: {
      buildBindingKey() {
        return "binding-1";
      },
    },
    async resolveWorkspaceContext() {
      throw new Error("stale queued message should not resolve workspace context");
    },
    async ensureThreadAndSendMessage() {
      seen.ensured += 1;
      return "thread-1";
    },
  };

  const drained = await appDispatcher.drainQueuedMessagesForBinding(runtime, "binding-1");

  assert.equal(drained, false);
  assert.equal(seen.ensured, 0);
  assert.equal(runtime.pendingMessageQueueByBindingKey.has("binding-1"), false);
  assert.equal(runtime.inFlightBindingDispatchKeys.has("binding-1"), false);
});
