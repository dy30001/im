const assert = require("node:assert/strict");
const test = require("node:test");

const { normalizeOpenClawTextEvent } = require("../src/presentation/message/normalizers");

test("normalizeOpenClawTextEvent maps a Weixin text message into a codex-im event", () => {
  const normalized = normalizeOpenClawTextEvent(
    {
      seq: 7,
      message_id: 42,
      from_user_id: "wx-user-1",
      to_user_id: "wx-bot-1",
      create_time_ms: 1_711_111_111_111,
      session_id: "session-1",
      message_type: 1,
      message_state: 0,
      context_token: "ctx-123",
      item_list: [
        {
          type: 1,
          text_item: {
            text: "/codex where",
          },
        },
      ],
    },
    {
      defaultWorkspaceId: "default",
    }
  );

  assert.deepEqual(normalized, {
    provider: "openclaw",
    workspaceId: "default",
    chatId: "wx-user-1",
    threadKey: "session-1",
    senderId: "wx-user-1",
    messageId: "42",
    text: "/codex where",
    command: "where",
    receivedAt: new Date(1_711_111_111_111).toISOString(),
    contextToken: "ctx-123",
  });
});

test("normalizeOpenClawTextEvent ignores bot messages and non-text payloads", () => {
  assert.equal(
    normalizeOpenClawTextEvent(
      {
        from_user_id: "wx-user-1",
        message_id: 1,
        message_type: 2,
        item_list: [{ type: 1, text_item: { text: "hello" } }],
      },
      { defaultWorkspaceId: "default" }
    ),
    null
  );

  assert.equal(
    normalizeOpenClawTextEvent(
      {
        from_user_id: "wx-user-1",
        message_id: 1,
        message_type: 1,
        item_list: [{ type: 2 }],
      },
      { defaultWorkspaceId: "default" }
    ),
    null
  );
});

test("normalizeOpenClawTextEvent recognizes supported natural-language commands", () => {
  const bindNormalized = normalizeOpenClawTextEvent(
    {
      from_user_id: "wx-user-1",
      message_id: 2,
      message_type: 1,
      item_list: [{ type: 1, text_item: { text: "帮我绑定到 /Users/dy3000/Documents/test/私人事务/codex-im" } }],
    },
    { defaultWorkspaceId: "default" }
  );
  assert.equal(bindNormalized?.command, "bind");

  const whereNormalized = normalizeOpenClawTextEvent(
    {
      from_user_id: "wx-user-1",
      message_id: 3,
      message_type: 1,
      item_list: [{ type: 1, text_item: { text: "当前在哪个项目" } }],
    },
    { defaultWorkspaceId: "default" }
  );
  assert.equal(whereNormalized?.command, "where");
});

test("normalizeOpenClawTextEvent keeps explicit /codex parsing ahead of natural-language fallback", () => {
  const normalized = normalizeOpenClawTextEvent(
    {
      from_user_id: "wx-user-1",
      message_id: 4,
      message_type: 1,
      item_list: [{ type: 1, text_item: { text: "/codex 帮我绑定到 /Users/dy3000/Documents/test/私人事务/codex-im" } }],
    },
    { defaultWorkspaceId: "default" }
  );
  assert.equal(normalized?.command, "unknown_command");
});

test("normalizeOpenClawTextEvent keeps ordinary natural-language questions as message", () => {
  const normalized = normalizeOpenClawTextEvent(
    {
      from_user_id: "wx-user-1",
      message_id: 5,
      message_type: 1,
      item_list: [{ type: 1, text_item: { text: "帮我看一下这个项目结构" } }],
    },
    { defaultWorkspaceId: "default" }
  );
  assert.equal(normalized?.command, "message");
});
