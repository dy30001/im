const assert = require("node:assert/strict");
const test = require("node:test");

const {
  disposeReplyRunState,
  sendInfoCardMessage,
  upsertAssistantReplyCard,
} = require("../src/presentation/card/card-service");

test("sendInfoCardMessage forwards contextToken when falling back to text", async () => {
  const calls = [];
  const runtime = {
    supportsInteractiveCards() {
      return false;
    },
    async sendTextMessage(payload) {
      calls.push(payload);
      return { ok: true };
    },
  };

  await sendInfoCardMessage(runtime, {
    chatId: "wx-user-1",
    replyToMessageId: "8",
    contextToken: "ctx-8",
    text: "语音转写失败：收到语音消息，但当前 payload 没有可下载的媒体地址。",
  });

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], {
    chatId: "wx-user-1",
    replyToMessageId: "8",
    contextToken: "ctx-8",
    text: "语音转写失败：收到语音消息，但当前 payload 没有可下载的媒体地址。",
  });
});

test("upsertAssistantReplyCard sends a delayed progress notice for OpenClaw turns", async () => {
  const calls = [];
  const runtime = createOpenClawReplyRuntime({
    openclawProgressNoticeDelayMs: 1,
  }, calls);

  await upsertAssistantReplyCard(runtime, {
    threadId: "thread-1",
    turnId: "turn-1",
    chatId: "chat-1",
    state: "streaming",
  });

  await delay(20);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].chatId, "chat-1");
  assert.equal(calls[0].replyToMessageId, "user-msg-1");
  assert.equal(calls[0].contextToken, "ctx-1");
  assert.match(calls[0].text, /处理中/);
  assert.match(calls[0].text, /正在处理/);
});

test("upsertAssistantReplyCard sends a delayed follow-up progress notice for long OpenClaw turns", async () => {
  const calls = [];
  const runtime = createOpenClawReplyRuntime({
    openclawProgressNoticeDelayMs: 1,
    openclawProgressFollowupDelayMs: 10,
  }, calls);

  await upsertAssistantReplyCard(runtime, {
    threadId: "thread-1",
    turnId: "turn-1",
    chatId: "chat-1",
    state: "streaming",
  });

  await delay(40);

  assert.equal(calls.length, 2);
  assert.match(calls[0].text, /处理中/);
  assert.match(calls[0].text, /正在处理/);
  assert.match(calls[1].text, /5 分钟/);
  assert.match(calls[1].text, /还在继续/);
});

test("upsertAssistantReplyCard cancels the delayed follow-up progress notice when the turn completes", async () => {
  const calls = [];
  const runtime = createOpenClawReplyRuntime({
    openclawProgressNoticeDelayMs: 1,
    openclawProgressFollowupDelayMs: 50,
  }, calls);

  await upsertAssistantReplyCard(runtime, {
    threadId: "thread-1",
    turnId: "turn-1",
    chatId: "chat-1",
    state: "streaming",
  });

  await delay(15);

  await upsertAssistantReplyCard(runtime, {
    threadId: "thread-1",
    turnId: "turn-1",
    chatId: "chat-1",
    text: "最终回复",
    state: "completed",
  });

  await delay(80);

  assert.equal(calls.length, 2);
  assert.match(calls[0].text, /处理中/);
  assert.equal(calls[1].text, "最终回复");
});

function createOpenClawReplyRuntime(configOverrides, calls) {
  const runtime = {
    supportsInteractiveCards() {
      return false;
    },
    config: {
      openclawStreamingOutput: false,
      openclawProgressNoticeDelayMs: 2500,
      openclawProgressFollowupDelayMs: 5 * 60 * 1000,
      ...configOverrides,
    },
    replyCardByRunKey: new Map(),
    currentRunKeyByThreadId: new Map(),
    replyFlushTimersByRunKey: new Map(),
    replyProgressTimersByRunKey: new Map(),
    replyProgressFollowupTimersByRunKey: new Map(),
    pendingChatContextByThreadId: new Map([
      ["thread-1", {
        messageId: "user-msg-1",
        contextToken: "ctx-1",
      }],
    ]),
    activeTurnIdByThreadId: new Map(),
    setReplyCardEntry(runKey, entry) {
      this.replyCardByRunKey.set(runKey, entry);
    },
    setCurrentRunKeyForThread(threadId, runKey) {
      this.currentRunKeyByThreadId.set(threadId, runKey);
    },
    disposeReplyRunState(runKey, threadId) {
      disposeReplyRunState(this, runKey, threadId);
    },
    async sendTextMessage(payload) {
      calls.push({ ...payload });
      return { ok: true };
    },
  };

  return runtime;
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
