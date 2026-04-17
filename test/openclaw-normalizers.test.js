const assert = require("node:assert/strict");
const test = require("node:test");

const { normalizeOpenClawTextEvent } = require("../src/presentation/message/normalizers");

test("normalizeOpenClawTextEvent maps a Weixin text message into a codex-im event", () => {
  const normalized = normalizeOpenClawTextEvent(
    {
      message_id: 42,
      from_user_id: "wx-user-1",
      create_time_ms: 1_711_111_111_111,
      session_id: "session-1",
      message_type: 1,
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
    inputKind: "text",
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
        item_list: [{ type: 99 }],
      },
      { defaultWorkspaceId: "default" }
    ),
    null
  );
});

test("normalizeOpenClawTextEvent keeps image attachments instead of dropping them", () => {
  const normalized = normalizeOpenClawTextEvent(
    {
      from_user_id: "wx-user-1",
      message_id: 101,
      message_type: 1,
      item_list: [
        {
          type: 2,
          image_item: {
            aeskey: "00112233445566778899aabbccddeeff",
            media: {
              full_url: "https://cdn.example.com/path/image.jpg",
            },
          },
        },
      ],
    },
    { defaultWorkspaceId: "default" }
  );

  assert.equal(normalized?.command, "message");
  assert.equal(normalized?.inputKind, "image");
  assert.equal(normalized?.text, "");
  assert.deepEqual(normalized?.attachments, [
    {
      kind: "image",
      downloadUrl: "https://cdn.example.com/path/image.jpg",
      aesKey: "00112233445566778899aabbccddeeff",
      mimeType: "image/jpeg",
      originalFilename: "",
    },
  ]);
});

test("normalizeOpenClawTextEvent keeps file attachments instead of dropping them", () => {
  const normalized = normalizeOpenClawTextEvent(
    {
      from_user_id: "wx-user-1",
      message_id: 102,
      message_type: 1,
      item_list: [
        {
          type: 4,
          file_item: {
            file_name: "report.pdf",
            media: {
              aes_key: "MDAxMTIyMzM0NDU1NjY3Nzg4OTlhYWJiY2NkZGVlZmY=",
              full_url: "https://cdn.example.com/path/report",
            },
          },
        },
      ],
    },
    { defaultWorkspaceId: "default" }
  );

  assert.equal(normalized?.command, "message");
  assert.equal(normalized?.inputKind, "file");
  assert.deepEqual(normalized?.attachments, [
    {
      kind: "file",
      downloadUrl: "https://cdn.example.com/path/report",
      aesKey: "MDAxMTIyMzM0NDU1NjY3Nzg4OTlhYWJiY2NkZGVlZmY=",
      mimeType: "application/pdf",
      originalFilename: "report.pdf",
    },
  ]);
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

  const browseNormalized = normalizeOpenClawTextEvent(
    {
      from_user_id: "wx-user-1",
      message_id: 20,
      message_type: 1,
      item_list: [{ type: 1, text_item: { text: "打开第二个" } }],
    },
    { defaultWorkspaceId: "default" }
  );
  assert.equal(browseNormalized?.command, "browse");

  const workspaceNormalized = normalizeOpenClawTextEvent(
    {
      from_user_id: "wx-user-1",
      message_id: 21,
      message_type: 1,
      item_list: [{ type: 1, text_item: { text: "选择第二绑定" } }],
    },
    { defaultWorkspaceId: "default" }
  );
  assert.equal(workspaceNormalized?.command, "workspace");

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

test("normalizeOpenClawTextEvent recognizes natural-language commands after a /codex prefix", () => {
  const bindNormalized = normalizeOpenClawTextEvent(
    {
      from_user_id: "wx-user-1",
      message_id: 4,
      message_type: 1,
      item_list: [{ type: 1, text_item: { text: "/codex 帮我绑定到 /Users/dy3000/Documents/test/私人事务/codex-im" } }],
    },
    { defaultWorkspaceId: "default" }
  );
  assert.equal(bindNormalized?.command, "bind");

  const statusNormalized = normalizeOpenClawTextEvent(
    {
      from_user_id: "wx-user-1",
      message_id: 10,
      message_type: 1,
      item_list: [{ type: 1, text_item: { text: "/codex status" } }],
    },
    { defaultWorkspaceId: "default" }
  );
  assert.equal(statusNormalized?.command, "status");

  const threadsNormalized = normalizeOpenClawTextEvent(
    {
      from_user_id: "wx-user-1",
      message_id: 11,
      message_type: 1,
      item_list: [{ type: 1, text_item: { text: "现在有哪几个线程" } }],
    },
    { defaultWorkspaceId: "default" }
  );
  assert.equal(threadsNormalized?.command, "threads");

  const switchNormalized = normalizeOpenClawTextEvent(
    {
      from_user_id: "wx-user-1",
      message_id: 12,
      message_type: 1,
      item_list: [{ type: 1, text_item: { text: "切换第二个线程" } }],
    },
    { defaultWorkspaceId: "default" }
  );
  assert.equal(switchNormalized?.command, "switch");

  const approveNormalized = normalizeOpenClawTextEvent(
    {
      from_user_id: "wx-user-1",
      message_id: 13,
      message_type: 1,
      item_list: [{ type: 1, text_item: { text: "/codex 请同意工作区" } }],
    },
    { defaultWorkspaceId: "default" }
  );
  assert.equal(approveNormalized?.command, "approve");
});

test("normalizeOpenClawTextEvent recognizes natural-language approval replies", () => {
  const approved = normalizeOpenClawTextEvent(
    {
      from_user_id: "wx-user-1",
      message_id: 14,
      message_type: 1,
      item_list: [{ type: 1, text_item: { text: "同意" } }],
    },
    { defaultWorkspaceId: "default" }
  );
  assert.equal(approved?.command, "approve");

  const rejected = normalizeOpenClawTextEvent(
    {
      from_user_id: "wx-user-1",
      message_id: 15,
      message_type: 1,
      item_list: [{ type: 1, text_item: { text: "拒绝" } }],
    },
    { defaultWorkspaceId: "default" }
  );
  assert.equal(rejected?.command, "reject");
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
      message_id: 7,
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
