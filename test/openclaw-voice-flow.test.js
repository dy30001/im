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
