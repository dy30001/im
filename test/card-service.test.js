const assert = require("node:assert/strict");
const test = require("node:test");

const { sendInfoCardMessage } = require("../src/presentation/card/card-service");

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
