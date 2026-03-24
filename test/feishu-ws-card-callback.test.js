const assert = require("node:assert/strict");
const test = require("node:test");

const { patchWsClientForCardCallbacks } = require("../src/infra/feishu/client-adapter");

test("patchWsClientForCardCallbacks keeps card headers on callback responses", async () => {
  const sentMessages = [];
  const invokedPayloads = [];
  const originalCalls = [];
  const wsClient = {
    dataCache: {
      mergeData: ({ message_id, trace_id }) => ({
        event: {
          message_id,
          trace_id,
        },
        event_type: "card.action.trigger",
      }),
    },
    eventDispatcher: {
      invoke: async (payload, options) => {
        invokedPayloads.push({ payload, options });
        return {
          toast: {
            type: "info",
            content: "ok",
          },
        };
      },
    },
    sendMessage: (message) => {
      sentMessages.push(message);
    },
    handleEventData: async (data) => {
      originalCalls.push(data);
    },
  };

  patchWsClientForCardCallbacks(wsClient);

  await wsClient.handleEventData({
    headers: [
      { key: "type", value: "card" },
      { key: "message_id", value: "msg-1" },
      { key: "trace_id", value: "trace-1" },
      { key: "sum", value: "1" },
      { key: "seq", value: "0" },
    ],
    payload: new TextEncoder().encode(JSON.stringify({ open_message_id: "om_1" })),
  });

  assert.equal(originalCalls.length, 0);
  assert.equal(invokedPayloads.length, 1);
  assert.deepEqual(invokedPayloads[0].options, { needCheck: false });
  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0].headers.find((header) => header.key === "type")?.value, "card");
  const responsePayload = JSON.parse(new TextDecoder().decode(sentMessages[0].payload));
  assert.equal(responsePayload.code, 200);
  assert.ok(typeof responsePayload.data === "string" && responsePayload.data.length > 0);
});
