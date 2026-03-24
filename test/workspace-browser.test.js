const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { buildWorkspaceBrowserCard } = require("../src/presentation/card/builders");
const { normalizeFeishuTextEvent } = require("../src/presentation/message/normalizers");
const workspaceService = require("../src/domain/workspace/workspace-service");

test("normalizeFeishuTextEvent recognizes /codex browse", () => {
  const normalized = normalizeFeishuTextEvent({
    message: {
      message_type: "text",
      content: JSON.stringify({ text: "/codex browse" }),
      chat_id: "chat-1",
      message_id: "msg-1",
      root_id: "",
    },
    sender: {
      sender_id: {
        open_id: "user-1",
      },
    },
  }, {
    defaultWorkspaceId: "default",
  });

  assert.equal(normalized.command, "browse");
});

test("handleBrowseCommand renders allowed roots when multiple allowlist roots exist", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-im-browse-roots-"));
  const firstRoot = path.join(tempDir, "alpha");
  const secondRoot = path.join(tempDir, "beta");
  fs.mkdirSync(firstRoot);
  fs.mkdirSync(secondRoot);

  const sentCards = [];
  const runtime = createBrowseRuntime({
    workspaceAllowlist: [firstRoot, secondRoot],
    onSendInteractiveCard: (payload) => sentCards.push(payload),
  });

  await workspaceService.handleBrowseCommand(runtime, createNormalizedEvent());

  assert.equal(sentCards.length, 1);
  const cardJson = JSON.stringify(sentCards[0].card);
  assert.match(cardJson, /alpha/);
  assert.match(cardJson, /beta/);
  assert.match(cardJson, /browse_open/);
});

test("handleBrowseCommand rejects browse paths outside the allowlist", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-im-browse-deny-"));
  const allowedRoot = path.join(tempDir, "allowed");
  const deniedRoot = path.join(tempDir, "denied");
  fs.mkdirSync(allowedRoot);
  fs.mkdirSync(deniedRoot);

  const sentInfo = [];
  const runtime = createBrowseRuntime({
    workspaceAllowlist: [allowedRoot],
    onSendInfoCardMessage: (payload) => sentInfo.push(payload),
  });

  await workspaceService.handleBrowseCommand(runtime, createNormalizedEvent(), {
    browsePath: deniedRoot,
  });

  assert.equal(sentInfo.length, 1);
  assert.equal(sentInfo[0].text, "该目录不在允许浏览的范围内。");
});

test("handleBrowseCommand lists directories before files inside the allowed root", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-im-browse-list-"));
  const repoDir = path.join(tempDir, "repo");
  const noteFile = path.join(tempDir, "notes.txt");
  fs.mkdirSync(repoDir);
  fs.writeFileSync(noteFile, "hello");

  const sentCards = [];
  const runtime = createBrowseRuntime({
    workspaceAllowlist: [tempDir],
    onSendInteractiveCard: (payload) => sentCards.push(payload),
  });

  await workspaceService.handleBrowseCommand(runtime, createNormalizedEvent());

  assert.equal(sentCards.length, 1);
  const cardJson = JSON.stringify(sentCards[0].card);
  const repoIndex = cardJson.indexOf("repo");
  const noteIndex = cardJson.indexOf("notes\\\\.txt");
  assert.notEqual(repoIndex, -1);
  assert.notEqual(noteIndex, -1);
  assert.ok(repoIndex < noteIndex);
  assert.match(cardJson, /browse_bind/);
});

function createBrowseRuntime({
  workspaceAllowlist,
  onSendInteractiveCard = () => {},
  onSendInfoCardMessage = () => {},
}) {
  return {
    config: {
      workspaceAllowlist,
    },
    getBindingContext() {
      return {
        bindingKey: "binding:1",
        workspaceRoot: "",
      };
    },
    resolveReplyToMessageId(normalized, replyToMessageId = "") {
      return replyToMessageId || normalized.messageId;
    },
    async resolveWorkspaceStats(workspaceRoot) {
      try {
        const stats = await fs.promises.stat(workspaceRoot);
        return {
          exists: true,
          isDirectory: stats.isDirectory(),
        };
      } catch (error) {
        if (error?.code === "ENOENT") {
          return { exists: false, isDirectory: false };
        }
        throw error;
      }
    },
    buildWorkspaceBrowserCard,
    async sendInteractiveCard(payload) {
      onSendInteractiveCard(payload);
    },
    async sendInfoCardMessage(payload) {
      onSendInfoCardMessage(payload);
    },
  };
}

function createNormalizedEvent() {
  return {
    provider: "feishu",
    workspaceId: "default",
    chatId: "chat-1",
    threadKey: "",
    senderId: "user-1",
    messageId: "msg-1",
    text: "/codex browse",
    command: "browse",
    receivedAt: new Date().toISOString(),
  };
}
