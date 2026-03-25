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
    inputKind: "text",
    voiceAttachment: null,
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

test("normalizeOpenClawTextEvent recognizes a voice payload and keeps it as message input", () => {
  const normalized = normalizeOpenClawTextEvent(
    {
      from_user_id: "wx-user-1",
      message_id: 6,
      message_type: 3,
      item_list: [
        {
          type: 4,
          voice_item: {
            download_url: "https://ilinkai.weixin.qq.com/media/voice-1",
            mime_type: "audio/ogg",
            file_name: "voice-1.ogg",
            duration_ms: 1200,
          },
        },
      ],
    },
    { defaultWorkspaceId: "default" }
  );

  assert.deepEqual(normalized, {
    provider: "openclaw",
    workspaceId: "default",
    chatId: "wx-user-1",
    threadKey: "",
    senderId: "wx-user-1",
    messageId: "6",
    text: "",
    command: "message",
    receivedAt: normalized.receivedAt,
    contextToken: "",
    inputKind: "voice",
    voiceAttachment: {
      kind: "voice",
      itemType: 4,
      downloadUrl: "https://ilinkai.weixin.qq.com/media/voice-1",
      dataUrl: "",
      base64Data: "",
      mimeType: "audio/ogg",
      fileName: "voice-1.ogg",
      mediaId: "",
      durationMs: 1200,
    },
  });
});

test("normalizeOpenClawTextEvent ignores non-audio file/media payloads", () => {
  const normalized = normalizeOpenClawTextEvent(
    {
      from_user_id: "wx-user-1",
      message_id: 9,
      message_type: 3,
      item_list: [
        {
          type: 5,
          file_item: {
            media_id: "file-1",
            mime_type: "application/pdf",
            file_name: "doc.pdf",
          },
        },
      ],
    },
    { defaultWorkspaceId: "default" }
  );

  assert.equal(normalized, null);
});

test("normalizeOpenClawTextEvent keeps text priority when text and voice coexist", () => {
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
            download_url: "https://ilinkai.weixin.qq.com/media/voice-10",
            mime_type: "audio/ogg",
            file_name: "voice-10.ogg",
          },
        },
      ],
    },
    { defaultWorkspaceId: "default" }
  );

  assert.equal(normalized?.inputKind, "text");
  assert.equal(normalized?.command, "where");
  assert.equal(normalized?.voiceAttachment, null);
});

test("normalizeOpenClawTextEvent accepts sender/message id aliases for voice payloads", () => {
  const normalized = normalizeOpenClawTextEvent(
    {
      from_id: "wx-user-alias-1",
      msg_id: 188,
      sessionId: "session-alias-1",
      message_type: 3,
      item_list: [
        {
          type: 4,
          voice_item: {
            media_id: 99123,
            mime_type: "audio/ogg",
          },
        },
      ],
    },
    { defaultWorkspaceId: "default" }
  );

  assert.equal(normalized?.chatId, "wx-user-alias-1");
  assert.equal(normalized?.messageId, "188");
  assert.equal(normalized?.threadKey, "session-alias-1");
  assert.equal(normalized?.inputKind, "voice");
  assert.equal(normalized?.voiceAttachment?.mediaId, "99123");
});

test("normalizeOpenClawTextEvent accepts voice payload with recordItem camelCase fields", () => {
  const normalized = normalizeOpenClawTextEvent(
    {
      from_user_id: "wx-user-camel",
      message_id: 300,
      message_type: 3,
      item_list: [
        {
          type: 4,
          recordItem: {
            fileUrl: "https://ilinkai.weixin.qq.com/media/voice-camel",
            mimeType: "audio/ogg",
            fileName: "voice-camel.ogg",
            mediaId: "voice-camel-id",
          },
        },
      ],
    },
    { defaultWorkspaceId: "default" }
  );

  assert.equal(normalized?.inputKind, "voice");
  assert.equal(normalized?.voiceAttachment?.downloadUrl, "https://ilinkai.weixin.qq.com/media/voice-camel");
  assert.equal(normalized?.voiceAttachment?.mediaId, "voice-camel-id");
});

test("normalizeOpenClawTextEvent accepts fallback item-level voice fields", () => {
  const normalized = normalizeOpenClawTextEvent(
    {
      from_user_id: "wx-user-fallback",
      message_id: 301,
      message_type: 3,
      item_list: [
        {
          type: 4,
          download_url: "https://ilinkai.weixin.qq.com/media/voice-fallback",
          mime_type: "audio/ogg",
          file_name: "voice-fallback.ogg",
          media_id: "voice-fallback-id",
        },
      ],
    },
    { defaultWorkspaceId: "default" }
  );

  assert.equal(normalized?.inputKind, "voice");
  assert.equal(normalized?.voiceAttachment?.downloadUrl, "https://ilinkai.weixin.qq.com/media/voice-fallback");
  assert.equal(normalized?.voiceAttachment?.mediaId, "voice-fallback-id");
});

test("normalizeOpenClawTextEvent accepts nested voice_item.media payloads", () => {
  const normalized = normalizeOpenClawTextEvent(
    {
      from_user_id: "wx-user-nested-media",
      message_id: 302,
      message_type: 3,
      item_list: [
        {
          type: 3,
          voice_item: {
            media: {
              download_url: "https://ilinkai.weixin.qq.com/media/voice-nested",
              mime_type: "audio/ogg",
              file_name: "voice-nested.ogg",
              media_id: "voice-nested-id",
            },
            text: "你好",
          },
        },
      ],
    },
    { defaultWorkspaceId: "default" }
  );

  assert.equal(normalized?.inputKind, "voice");
  assert.equal(normalized?.voiceAttachment?.downloadUrl, "https://ilinkai.weixin.qq.com/media/voice-nested");
  assert.equal(normalized?.voiceAttachment?.mediaId, "voice-nested-id");
});

test("normalizeOpenClawTextEvent falls back to voice_item.text when attachment metadata is not downloadable", () => {
  const normalized = normalizeOpenClawTextEvent(
    {
      from_user_id: "wx-user-voice-text",
      message_id: 303,
      message_type: 1,
      item_list: [
        {
          type: 3,
          voice_item: {
            media: {
              aes_key: "aes-key",
              encrypt_query_param: "encrypt-query",
            },
            text: "你好",
          },
        },
      ],
    },
    { defaultWorkspaceId: "default" }
  );

  assert.equal(normalized?.inputKind, "text");
  assert.equal(normalized?.text, "你好");
  assert.equal(normalized?.command, "message");
  assert.equal(normalized?.voiceAttachment, null);
});
