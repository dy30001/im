const assert = require("node:assert/strict");
const test = require("node:test");

const appDispatcher = require("../src/app/dispatcher");
const {
  dispatchOpenClawMessages,
} = require("../src/app/openclaw-polling-service");

test("dispatchOpenClawMessages processes different bindings in parallel", async () => {
  const previousHandler = appDispatcher.onOpenClawTextEvent;
  let active = 0;
  let maxActive = 0;

  appDispatcher.onOpenClawTextEvent = async (_runtime, message) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await delay(message.from_user_id === "wx-user-1" ? 30 : 20);
    active -= 1;
  };

  try {
    await dispatchOpenClawMessages(createPollingRuntime(), [
      buildOpenClawMessage({ fromUserId: "wx-user-1", messageId: "101", text: "hello-1" }),
      buildOpenClawMessage({ fromUserId: "wx-user-2", messageId: "102", text: "hello-2" }),
    ]);
  } finally {
    appDispatcher.onOpenClawTextEvent = previousHandler;
  }

  assert.equal(maxActive, 2);
});

test("dispatchOpenClawMessages preserves order within the same binding", async () => {
  const previousHandler = appDispatcher.onOpenClawTextEvent;
  const seen = [];
  let active = 0;
  let maxActive = 0;

  appDispatcher.onOpenClawTextEvent = async (_runtime, message) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    seen.push(`start:${message.message_id}`);
    await delay(20);
    seen.push(`end:${message.message_id}`);
    active -= 1;
  };

  try {
    await dispatchOpenClawMessages(createPollingRuntime(), [
      buildOpenClawMessage({ fromUserId: "wx-user-1", messageId: "201", text: "hello-1" }),
      buildOpenClawMessage({ fromUserId: "wx-user-1", messageId: "202", text: "hello-2" }),
    ]);
  } finally {
    appDispatcher.onOpenClawTextEvent = previousHandler;
  }

  assert.equal(maxActive, 1);
  assert.deepEqual(seen, [
    "start:201",
    "end:201",
    "start:202",
    "end:202",
  ]);
});

function createPollingRuntime() {
  return {
    config: {
      defaultWorkspaceId: "default",
      verboseCodexLogs: false,
    },
    sessionStore: {
      buildBindingKey(normalized) {
        return `${normalized.workspaceId}:${normalized.chatId}:${normalized.threadKey || normalized.senderId}`;
      },
    },
  };
}

function buildOpenClawMessage({ fromUserId, messageId, text }) {
  return {
    from_user_id: fromUserId,
    session_id: `session-${fromUserId}`,
    message_id: messageId,
    message_type: 1,
    item_list: [
      {
        type: 1,
        text_item: {
          text,
        },
      },
    ],
  };
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
