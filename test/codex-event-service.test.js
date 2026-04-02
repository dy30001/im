const assert = require("node:assert/strict");
const test = require("node:test");

const {
  deliverToProvider,
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
