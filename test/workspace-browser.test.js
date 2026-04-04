const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { buildWorkspaceBrowserCard } = require("../src/presentation/card/builders");
const browserRuntime = require("../src/domain/workspace/browser-service");
const { normalizeFeishuTextEvent } = require("../src/presentation/message/normalizers");
const {
  handleBindCommand,
  handleBrowseCommand,
  handleWorkspacesCommand,
  resolveWorkspaceContext,
} = require("../src/domain/workspace/workspace-service");

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

  await handleBrowseCommand(runtime, createNormalizedEvent());

  assert.equal(sentCards.length, 1);
  assert.deepEqual(sentCards[0].selectionContext, {
    bindingKey: "binding:1",
    command: "browse",
  });
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

  await handleBrowseCommand(runtime, createNormalizedEvent(), {
    browsePath: deniedRoot,
  });

  assert.equal(sentInfo.length, 1);
  assert.equal(sentInfo[0].text, "该目录不在允许浏览的范围内。");
});

test("handleBindCommand rejects direct binds outside the default browse root when the allowlist is empty", async () => {
  const outsideHomeDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-im-bind-deny-"));
  const sentInfo = [];
  const runtime = createBrowseRuntime({
    workspaceAllowlist: [],
    onSendInfoCardMessage: (payload) => sentInfo.push(payload),
  });

  await handleBindCommand(runtime, {
    ...createNormalizedEvent(),
    text: `/codex bind ${outsideHomeDir}`,
    command: "bind",
  });

  assert.equal(sentInfo.length, 1);
  assert.equal(sentInfo[0].text, "该项目不在允许绑定的范围内。");
});

test("handleBindCommand keeps allowing direct binds inside the home directory when the allowlist is empty", async () => {
  let activeWorkspaceRoot = "";
  const sentCards = [];
  const refreshCalls = [];
  const runtime = createBrowseRuntime({
    workspaceAllowlist: [],
    onSendInteractiveCard: (payload) => sentCards.push(payload),
  });
  runtime.sessionStore.getCodexParamsForWorkspace = () => ({ model: "", effort: "" });
  runtime.sessionStore.getAvailableModelCatalog = () => null;
  runtime.sessionStore.setActiveWorkspaceRoot = (_bindingKey, workspaceRoot) => {
    activeWorkspaceRoot = workspaceRoot;
  };
  runtime.sessionStore.setThreadIdForWorkspace = () => {};
  runtime.sessionStore.clearThreadIdForWorkspace = () => {};
  runtime.getCodexParamsForWorkspace = () => ({ model: "", effort: "" });
  runtime.getBindingContext = () => ({
    bindingKey: "binding:1",
    workspaceRoot: activeWorkspaceRoot,
  });
  runtime.describeWorkspaceStatus = () => ({ code: "idle", label: "空闲" });
  runtime.buildStatusPanelCard = ({ workspaceRoot }) => ({ workspaceRoot });
  runtime.refreshWorkspaceThreads = async (_bindingKey, _workspaceRoot, _normalized, options) => {
    refreshCalls.push(options);
    return [];
  };
  runtime.resolveThreadIdForBinding = () => "";
  runtime.setThreadBindingKey = () => {};
  runtime.setThreadWorkspaceRoot = () => {};
  runtime.rememberSelectedThreadForSync = () => {};

  await handleBindCommand(runtime, {
    ...createNormalizedEvent(),
    text: `/codex bind ${os.homedir()}`,
    command: "bind",
  });

  assert.equal(activeWorkspaceRoot, os.homedir());
  assert.equal(sentCards.length, 1);
  assert.equal(refreshCalls.length, 1);
  assert.deepEqual(refreshCalls[0], {
    previewOnly: true,
    allowStaleCache: false,
  });
});

test("resolveWorkspaceContext auto-binds the configured default workspace root", async () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codex-im-default-bind-"));
  let activeWorkspaceRoot = "";
  const savedCodexParams = [];
  const runtime = createBrowseRuntime({
    workspaceAllowlist: [workspaceRoot],
    defaultWorkspaceRoot: workspaceRoot,
  });
  runtime.sessionStore.getCodexParamsForWorkspace = () => ({ model: "", effort: "" });
  runtime.sessionStore.setCodexParamsForWorkspace = (bindingKey, targetWorkspaceRoot, params) => {
    savedCodexParams.push({ bindingKey, workspaceRoot: targetWorkspaceRoot, params });
  };
  runtime.sessionStore.setActiveWorkspaceRoot = (_bindingKey, workspaceRootValue) => {
    activeWorkspaceRoot = workspaceRootValue;
  };
  runtime.getBindingContext = () => ({
    bindingKey: "binding:1",
    workspaceRoot: activeWorkspaceRoot,
  });
  runtime.config.defaultCodexModel = "gpt-5.4";
  runtime.config.defaultCodexEffort = "xhigh";

  const context = await resolveWorkspaceContext(runtime, createNormalizedEvent(), {
    replyToMessageId: "reply-1",
    missingWorkspaceText: "missing",
  });

  assert.deepEqual(context, {
    bindingKey: "binding:1",
    workspaceRoot,
    replyTarget: "reply-1",
    autoBound: true,
  });
  assert.equal(activeWorkspaceRoot, workspaceRoot);
  assert.deepEqual(savedCodexParams, [
    {
      bindingKey: "binding:1",
      workspaceRoot,
      params: {
        model: "gpt-5.4",
        effort: "xhigh",
      },
    },
  ]);
});

test("resolveWorkspaceContext falls back to the missing-workspace guide when the default workspace root is outside the allowlist", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-im-default-bind-deny-"));
  const allowedRoot = path.join(tempDir, "allowed");
  const deniedRoot = path.join(tempDir, "denied");
  fs.mkdirSync(allowedRoot);
  fs.mkdirSync(deniedRoot);

  const sentInfo = [];
  const runtime = createBrowseRuntime({
    workspaceAllowlist: [allowedRoot],
    defaultWorkspaceRoot: deniedRoot,
    onSendInfoCardMessage: (payload) => sentInfo.push(payload),
  });

  const context = await resolveWorkspaceContext(runtime, createNormalizedEvent(), {
    replyToMessageId: "reply-1",
    missingWorkspaceText: "missing",
  });

  assert.equal(context, null);
  assert.equal(sentInfo.length, 1);
  assert.equal(sentInfo[0].text, "missing");
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

  await handleBrowseCommand(runtime, createNormalizedEvent());

  assert.equal(sentCards.length, 1);
  const cardJson = JSON.stringify(sentCards[0].card);
  const repoIndex = cardJson.indexOf("repo");
  const noteIndex = cardJson.indexOf("notes\\\\.txt");
  assert.notEqual(repoIndex, -1);
  assert.notEqual(noteIndex, -1);
  assert.ok(repoIndex < noteIndex);
  assert.match(cardJson, /browse_bind/);
});

test("handleBrowseCommand opens the second allowed root by ordinal selection", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-im-browse-select-"));
  const firstRoot = path.join(tempDir, "alpha");
  const secondRoot = path.join(tempDir, "beta");
  fs.mkdirSync(firstRoot);
  fs.mkdirSync(secondRoot);
  fs.writeFileSync(path.join(secondRoot, "nested.txt"), "hello");

  const sentCards = [];
  const runtime = createBrowseRuntime({
    workspaceAllowlist: [firstRoot, secondRoot],
    onSendInteractiveCard: (payload) => sentCards.push(payload),
  });

  await handleBrowseCommand(runtime, {
    ...createNormalizedEvent(),
    text: "打开第二个",
    command: "browse",
  });

  assert.equal(sentCards.length, 1);
  const cardJson = JSON.stringify(sentCards[0].card);
  assert.match(cardJson, /beta/);
  assert.ok(cardJson.includes("nested\\\\.txt"));
  assert.doesNotMatch(cardJson, /alpha/);
});

test("resolveBrowseRoots normalizes allowlist entries and falls back to home when empty", () => {
  const allowlistRuntime = createBrowseRuntime({
    workspaceAllowlist: ["/tmp/repo/", "/tmp/repo", "relative/path"],
  });
  const fallbackRuntime = createBrowseRuntime({
    workspaceAllowlist: [],
  });

  assert.deepEqual(browserRuntime.resolveBrowseRoots(allowlistRuntime), ["/tmp/repo"]);
  assert.deepEqual(browserRuntime.resolveBrowseRoots(fallbackRuntime), [os.homedir()]);
});

test("handleWorkspacesCommand selects a workspace by ordinal", async () => {
  const switched = [];
  const runtime = {
    sessionStore: {
      buildBindingKey: () => "binding-1",
      getBinding: () => ({}),
    },
    listBoundWorkspaces: () => ([
      { workspaceRoot: "/repo/alpha", isActive: true, threadId: "thread-1" },
      { workspaceRoot: "/repo/beta", isActive: false, threadId: "thread-2" },
      { workspaceRoot: "/repo/gamma", isActive: false, threadId: "thread-3" },
    ]),
    resolveReplyToMessageId: (_normalized, replyToMessageId = "") => replyToMessageId || "reply-1",
    switchWorkspaceByPath: async (_normalized, workspaceRoot, options) => {
      switched.push({ workspaceRoot, options });
    },
    sendInteractiveCard: async () => {
      throw new Error("should not render workspace list when selecting by ordinal");
    },
    sendInfoCardMessage: async () => {
      throw new Error("unexpected info card");
    },
  };

  await handleWorkspacesCommand(runtime, {
    chatId: "chat-1",
    messageId: "msg-1",
    text: "选择第二绑定",
  });

  assert.equal(switched.length, 1);
  assert.equal(switched[0].workspaceRoot, "/repo/beta");
});

test("handleWorkspacesCommand accepts a bare ordinal when the remembered selection context is workspace", async () => {
  const switched = [];
  const runtime = {
    sessionStore: {
      buildBindingKey: () => "binding-1",
      getBinding: () => ({}),
    },
    listBoundWorkspaces: () => ([
      { workspaceRoot: "/repo/alpha", isActive: true, threadId: "thread-1" },
      { workspaceRoot: "/repo/beta", isActive: false, threadId: "thread-2" },
      { workspaceRoot: "/repo/gamma", isActive: false, threadId: "thread-3" },
    ]),
    resolveReplyToMessageId: (_normalized, replyToMessageId = "") => replyToMessageId || "reply-1",
    resolveSelectionContext: () => ({ command: "workspace" }),
    switchWorkspaceByPath: async (_normalized, workspaceRoot, options) => {
      switched.push({ workspaceRoot, options });
    },
    sendInteractiveCard: async () => {
      throw new Error("should not render workspace list when selecting by bare ordinal");
    },
    sendInfoCardMessage: async () => {
      throw new Error("unexpected info card");
    },
  };

  await handleWorkspacesCommand(runtime, {
    chatId: "chat-1",
    messageId: "msg-1",
    text: "第二个",
  });

  assert.equal(switched.length, 1);
  assert.equal(switched[0].workspaceRoot, "/repo/beta");
});

test("handleWorkspacesCommand tags the workspace list with selection context", async () => {
  const sentCards = [];
  const runtime = {
    sessionStore: {
      buildBindingKey: () => "binding-1",
      getBinding: () => ({}),
    },
    listBoundWorkspaces: () => ([
      { workspaceRoot: "/repo/alpha", isActive: true, threadId: "thread-1" },
      { workspaceRoot: "/repo/beta", isActive: false, threadId: "thread-2" },
    ]),
    resolveReplyToMessageId: (_normalized, replyToMessageId = "") => replyToMessageId || "reply-1",
    buildWorkspaceBindingsCard: (items) => ({ items }),
    sendInteractiveCard: async (payload) => {
      sentCards.push(payload);
    },
    sendInfoCardMessage: async () => {
      throw new Error("unexpected info card");
    },
  };

  await handleWorkspacesCommand(runtime, {
    chatId: "chat-1",
    messageId: "msg-1",
    text: "查看绑定列表",
  });

  assert.equal(sentCards.length, 1);
  assert.deepEqual(sentCards[0].selectionContext, {
    bindingKey: "binding-1",
    command: "workspace",
  });
});

function createBrowseRuntime({
  workspaceAllowlist,
  defaultWorkspaceRoot = "",
  onSendInteractiveCard = () => {},
  onSendInfoCardMessage = () => {},
}) {
  return {
    config: {
      workspaceAllowlist,
      defaultWorkspaceRoot,
      defaultCodexModel: "",
      defaultCodexEffort: "",
    },
    sessionStore: {
      buildBindingKey: () => "binding:1",
      getBinding: () => ({}),
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
